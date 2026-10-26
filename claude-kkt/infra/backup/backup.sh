#!/bin/sh
# KKT database backups (docker-compose.prod.yml service "backup"; docs/RESTORE.md).
#
# Every day at BACKUP_TIME_UTC (default 21:00 UTC = 02:30 IST):
#   1. pg_dump -Fc of the whole database          -> /backups/dumps/kkt-<UTC timestamp>.dump (+ .sha256)
#   2. restore drill: the dump is restored into a scratch database and sanity-checked, then dropped (VERIFY_RESTORE=true)
#   3. on BASEBACKUP_WEEKDAY (default 7 = Sunday, `date +%u`) a physical base backup for point-in-time recovery
#                                                 -> /backups/base/<UTC timestamp>/ (base.tar.gz, pg_wal.tar.gz, WAL_START)
#   4. retention: dumps older than DUMP_RETENTION_DAYS (14); base backups beyond BASE_BACKUPS_KEEP (2), and archived WAL older than the
#      oldest kept base backup (pg_archivecleanup)
#   5. status for monitoring: /backups/status.prom (node_exporter textfile format) and an optional BACKUP_UPLOAD_CMD (e.g. an rclone or
#      `aws s3 sync /backups s3://…` command in a sidecar image) for an off-site copy.
# Postgres archives WAL continuously into /backups/wal (archive_mode=on, archive_timeout=300 s), so the recovery point objective is
# ≤ 5 minutes with PITR and ≤ 24 h with the nightly dump alone.
#
# `backup.sh once` runs one cycle immediately (also used by the restore drill in CI/docs).
set -eu

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=kkt}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_TIME_UTC:=21:00}"
: "${BASEBACKUP_WEEKDAY:=7}"
: "${DUMP_RETENTION_DAYS:=14}"
: "${BASE_BACKUPS_KEEP:=2}"
: "${VERIFY_RESTORE:=true}"
export PGHOST PGPORT PGUSER PGDATABASE
if [ -n "${PGPASSWORD_FILE:-}" ] && [ -z "${PGPASSWORD:-}" ]; then PGPASSWORD="$(tr -d '\r\n' < "$PGPASSWORD_FILE")"; export PGPASSWORD; fi

DUMPS="$BACKUP_DIR/dumps"; BASES="$BACKUP_DIR/base"; WAL="$BACKUP_DIR/wal"
mkdir -p "$DUMPS" "$BASES" "$WAL"

log() { printf '{"time":"%s","service":"kkt-backup","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

write_status() { # $1 = ok|failed, $2 = what
  now=$(date -u +%s)
  tmp="$BACKUP_DIR/.status.prom.tmp"
  {
    echo "# HELP kkt_backup_last_run_timestamp_seconds Unix time of the last backup run."
    echo "# TYPE kkt_backup_last_run_timestamp_seconds gauge"
    echo "kkt_backup_last_run_timestamp_seconds $now"
    echo "# HELP kkt_backup_last_success_timestamp_seconds Unix time of the last fully successful backup run (dump + verify)."
    echo "# TYPE kkt_backup_last_success_timestamp_seconds gauge"
    if [ "$1" = ok ]; then echo "kkt_backup_last_success_timestamp_seconds $now"; echo "$now" > "$BACKUP_DIR/.last_success";
    else echo "kkt_backup_last_success_timestamp_seconds $(cat "$BACKUP_DIR/.last_success" 2>/dev/null || echo 0)"; fi
    echo "# HELP kkt_backup_last_dump_bytes Size of the latest logical dump."
    echo "# TYPE kkt_backup_last_dump_bytes gauge"
    echo "kkt_backup_last_dump_bytes $(ls -t "$DUMPS"/*.dump 2>/dev/null | head -1 | xargs -r stat -c %s 2>/dev/null || echo 0)"
    echo "# HELP kkt_backup_wal_archive_files Archived WAL segments on disk."
    echo "# TYPE kkt_backup_wal_archive_files gauge"
    echo "kkt_backup_wal_archive_files $(ls "$WAL" 2>/dev/null | wc -l | tr -d ' ')"
  } > "$tmp" && mv "$tmp" "$BACKUP_DIR/status.prom"
  log "status: $1 ($2)"
}

dump() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  file="$DUMPS/kkt-$ts.dump"
  log "pg_dump start -> $file"
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$file.partial" "$PGDATABASE"
  mv "$file.partial" "$file"
  (cd "$DUMPS" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
  log "pg_dump done ($(stat -c %s "$file") bytes)"
  LAST_DUMP="$file"
}

verify() {
  [ "$VERIFY_RESTORE" = "true" ] || return 0
  scratch="kkt_restore_check"
  log "restore drill into $scratch"
  dropdb --if-exists "$scratch"
  createdb "$scratch"
  # --no-owner/--no-privileges: the scratch copy belongs to the backup user; the triggers come back with the schema
  if ! pg_restore --no-owner --no-privileges --exit-on-error --dbname="$scratch" "$LAST_DUMP"; then dropdb --if-exists "$scratch"; return 1; fi
  tables=$(psql -tAc "select count(*) from pg_tables where schemaname = 'public'" "$scratch")
  companies=$(psql -tAc "select count(*) from companies" "$scratch")
  ledger_ok=$(psql -tAc "select count(*) = 0 from (select booking_id from ledger_entries group by booking_id having count(*) <> count(distinct seq)) t" "$scratch" 2>/dev/null || echo t)
  dropdb --if-exists "$scratch"
  if [ "${tables:-0}" -lt 40 ] || [ "${companies:-0}" -lt 1 ] || [ "$ledger_ok" != "t" ]; then
    log "restore drill FAILED (tables=$tables companies=$companies ledger_ok=$ledger_ok)"; return 1
  fi
  log "restore drill ok (tables=$tables companies=$companies)"
}

basebackup() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  dir="$BASES/$ts"
  log "pg_basebackup start -> $dir"
  pg_basebackup --pgdata="$dir.partial" --format=tar --gzip --wal-method=stream --checkpoint=fast --label="kkt-$ts" --no-password
  mv "$dir.partial" "$dir"
  # the backup history file Postgres archived for this base backup marks the first WAL segment it needs
  ls -t "$WAL"/*.backup 2>/dev/null | head -1 | xargs -r basename > "$dir/WAL_START" || true
  log "pg_basebackup done ($(du -sh "$dir" | cut -f1))"
}

retention() {
  find "$DUMPS" -maxdepth 1 -name 'kkt-*.dump*' -mtime +"$DUMP_RETENTION_DAYS" -print -delete | sed 's/^/deleted /' || true
  # keep the newest BASE_BACKUPS_KEEP base backups
  count=0
  for d in $(ls -1d "$BASES"/*/ 2>/dev/null | sort -r); do
    count=$((count + 1))
    if [ "$count" -gt "$BASE_BACKUPS_KEEP" ]; then log "deleting base backup $d"; rm -rf "$d"; fi
  done
  oldest=$(ls -1d "$BASES"/*/ 2>/dev/null | sort | head -1)
  if [ -n "$oldest" ] && [ -s "$oldest/WAL_START" ]; then
    pg_archivecleanup "$WAL" "$(cat "$oldest/WAL_START")" && log "archived WAL before $(cat "$oldest/WAL_START") removed"
  fi
}

cycle() {
  if dump && verify; then
    if [ "$(date -u +%u)" = "$BASEBACKUP_WEEKDAY" ] || [ -z "$(ls -A "$BASES" 2>/dev/null)" ]; then basebackup || log "pg_basebackup FAILED"; fi
    retention
    if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
      if sh -c "$BACKUP_UPLOAD_CMD"; then log "off-site upload ok"; else log "off-site upload FAILED"; fi
    fi
    write_status ok "dump $(basename "$LAST_DUMP")"
  else
    write_status failed "dump or restore drill"
    return 1
  fi
}

if [ "${1:-}" = "once" ]; then cycle; exit $?; fi

log "scheduler started: daily at $BACKUP_TIME_UTC UTC, base backup on weekday $BASEBACKUP_WEEKDAY, dumps kept $DUMP_RETENTION_DAYS days"
until pg_isready -q; do sleep 5; done
[ -s "$BACKUP_DIR/status.prom" ] || write_status failed "no backup yet"
last_day=""
while true; do
  today=$(date -u +%Y-%m-%d)
  if [ "$(date -u +%H:%M)" = "$BACKUP_TIME_UTC" ] && [ "$today" != "$last_day" ]; then
    last_day="$today"
    cycle || log "backup cycle failed; next attempt tomorrow (alert KktBackupStale fires after 26 h)"
  fi
  sleep 30
done
