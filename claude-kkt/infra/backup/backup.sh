#!/bin/sh
# KKT database backups (docker-compose.prod.yml services "backup" and "postgres"; docs/RESTORE.md).
#
# Every day at BACKUP_TIME_UTC (default 21:00 UTC = 02:30 IST):
#   1. pg_dump -Fc of the whole database, encrypted while it streams   -> /backups/dumps/kkt-<UTC timestamp>.dump.age (+ .sha256)
#   2. restore drill: the encrypted dump is decrypted on the fly into a scratch database and sanity-checked, then dropped
#      (VERIFY_RESTORE=true) — so every night proves that the key decrypts and the dump restores
#   3. on BASEBACKUP_WEEKDAY (default 7 = Sunday, `date +%u`) a physical base backup for point-in-time recovery, WAL included,
#      gzip-compressed and encrypted while it streams              -> /backups/base/<UTC timestamp>/base.tar.gz.age (+ WAL_START)
#   4. retention: dumps older than DUMP_RETENTION_DAYS (14); base backups beyond BASE_BACKUPS_KEEP (2), and archived WAL older than the
#      oldest kept base backup (pg_archivecleanup)
#   5. status for monitoring: /backups/status.prom (node_exporter textfile format) and an optional BACKUP_UPLOAD_CMD (e.g. an rclone or
#      `aws s3 sync /backups s3://…` command in a sidecar image) for an off-site copy — it only ever sees ciphertext.
# Postgres archives WAL continuously through `backup.sh wal-push %p %f` (archive_command; encrypted the same way), so the recovery point
# objective is ≤ 5 minutes with PITR and ≤ 24 h with the nightly dump alone.
#
# Encryption (audit B9): nothing leaves Postgres unencrypted. BACKUP_ENCRYPTION_KEY_FILE names the key (a Docker/Kubernetes secret file):
#   * an age identity ("AGE-SECRET-KEY-1…", `age-keygen`): age (X25519 + ChaCha20-Poly1305, authenticated, streaming) — the default; the
#     kkt-backup image (infra/backup/Dockerfile) carries age. Files end in .age.
#   * any other value (≥ 32 characters, e.g. `openssl rand -hex 32`): openssl fallback for images without age — AES-256-CTR with a
#     PBKDF2-derived key (`openssl enc` cannot do GCM), authenticated encrypt-then-MAC with HMAC-SHA256 in a `<file>.hmac` sidecar that
#     is checked BEFORE any byte is decrypted. Files end in .enc.
#   BACKUP_ENCRYPTION=none turns encryption off explicitly (development only); without a key and without that opt-out the script refuses
#   to run, so an unconfigured host never writes plaintext backups.
#
# Commands:
#   backup.sh                      scheduler (the backup service)
#   backup.sh once                 one cycle now (before an upgrade; drills)
#   backup.sh base                 one encrypted base backup now (e.g. after KktBaseBackupStale), then retention
#   backup.sh wal-push %p %f       archive_command: encrypt one WAL segment into /backups/wal
#   backup.sh wal-fetch %f %p      restore_command (PITR): decrypt one archived segment
#   backup.sh decrypt IN OUT|-     decrypt a dump / base backup / WAL file (verifies authenticity first); "-" = stdout
#   backup.sh encrypt IN|- OUT     encrypt a file (e.g. a manual pg_dump before maintenance)
#   backup.sh drill FILE           restore drill of one (encrypted) dump into the scratch database
#   backup.sh prune                retention only (old dumps, base backups beyond BASE_BACKUPS_KEEP, WAL older than the oldest kept)
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
: "${BACKUP_ENCRYPTION:=auto}"
: "${BACKUP_PBKDF2_ITER:=200000}"
KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:-}"
export PGHOST PGPORT PGUSER PGDATABASE
if [ -n "${PGPASSWORD_FILE:-}" ] && [ -z "${PGPASSWORD:-}" ]; then PGPASSWORD="$(tr -d '\r\n' < "$PGPASSWORD_FILE")"; export PGPASSWORD; fi

DUMPS="$BACKUP_DIR/dumps"; BASES="$BACKUP_DIR/base"; WAL="$BACKUP_DIR/wal"

# logs go to stderr: stdout carries data for `decrypt … -` (piped into pg_restore / tar)
log() { printf '{"time":"%s","service":"kkt-backup","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ---- encryption ---------------------------------------------------------------------------------------------------------------------

# MODE = age | openssl | none, EXT = the file suffix of encrypted files
resolve_mode() {
  case "$BACKUP_ENCRYPTION" in
    none) MODE=none; EXT=""; return 0 ;;
    auto | age | openssl) ;;
    *) die "BACKUP_ENCRYPTION must be auto, age, openssl or none (got $BACKUP_ENCRYPTION)" ;;
  esac
  [ -n "$KEY_FILE" ] || die "BACKUP_ENCRYPTION_KEY_FILE is not set (backups are encrypted; set BACKUP_ENCRYPTION=none to opt out in development)"
  [ -r "$KEY_FILE" ] || die "cannot read the backup encryption key $KEY_FILE"
  if grep -q '^AGE-SECRET-KEY-1' "$KEY_FILE"; then MODE=age; else MODE=openssl; fi
  if [ "$BACKUP_ENCRYPTION" != auto ] && [ "$BACKUP_ENCRYPTION" != "$MODE" ]; then
    die "BACKUP_ENCRYPTION=$BACKUP_ENCRYPTION but the key file holds a key for $MODE"
  fi
  if [ "$MODE" = age ]; then
    command -v age > /dev/null 2>&1 || die "the key is an age identity but age is not installed (use the kkt-backup image)"
    EXT=".age"
  else
    command -v openssl > /dev/null 2>&1 || die "openssl is not installed"
    [ "$(tr -d '\r\n' < "$KEY_FILE" | wc -c)" -ge 32 ] || die "the backup encryption key must be at least 32 characters"
    EXT=".enc"
  fi
}

# hex HMAC key derived from the secret (separate from the PBKDF2 encryption key)
mac_key() { printf 'kkt-backup-mac:%s' "$(tr -d '\r\n' < "$KEY_FILE")" | openssl dgst -sha256 -r | cut -d' ' -f1; }
mac_of() { openssl dgst -sha256 -mac HMAC -macopt "hexkey:$(mac_key)" -r "$1" | cut -d' ' -f1; }

# encrypt_file IN|- OUT: writes OUT (and OUT.hmac in openssl mode) atomically via OUT.partial. Every step is checked explicitly: the
# function is mostly called where `set -e` is suspended (a pipeline followed by ||, `if`), so a cipher that fails at the very end (ENOSPC
# on the last block) must still fail the call instead of publishing a truncated file — with a valid MAC — as a good backup.
encrypt_file() {
  in="$1"; out="$2"
  rm -f "$out.partial"
  case "$MODE" in
    none)
      if [ "$in" = - ]; then cat > "$out.partial" || return 1; else cat "$in" > "$out.partial" || return 1; fi ;;
    age)
      recipient=$(age-keygen -y "$KEY_FILE") || return 1
      [ -n "$recipient" ] || return 1
      if [ "$in" = - ]; then age -e -r "$recipient" -o "$out.partial" || return 1
      else age -e -r "$recipient" -o "$out.partial" "$in" || return 1; fi ;;
    openssl)
      # stdin / stdout are openssl's defaults: naming /dev/stdin or /dev/stdout fails (ENXIO) when they are sockets (e.g. a process
      # spawned by node, systemd or a container runtime)
      if [ "$in" = - ]; then set --; else set -- -in "$in"; fi
      openssl enc -aes-256-ctr -pbkdf2 -iter "$BACKUP_PBKDF2_ITER" -salt -pass "file:$KEY_FILE" "$@" -out "$out.partial" || return 1
      mac=$(mac_of "$out.partial") || return 1
      # mac_of is a pipeline (its status is cut's): an empty or malformed digest means openssl dgst failed
      case "$mac" in "" | *[!0-9a-f]*) return 1 ;; esac
      [ "${#mac}" -eq 64 ] || return 1
      printf '%s\n' "$mac" > "$out.hmac" || return 1 ;;
  esac
  mv "$out.partial" "$out" || return 1
}

# decrypt_file IN OUT|-: refuses a file whose authentication fails (age: per-chunk tags; openssl: the HMAC sidecar, checked first)
decrypt_file() {
  in="$1"; out="$2"
  [ -f "$in" ] || die "$in does not exist"
  case "$in" in
    *.age) need=age ;;
    *.enc) need=openssl ;;
    *) need=none ;;
  esac
  case "$need" in
    none) if [ "$out" = - ]; then cat "$in"; else cp "$in" "$out"; fi ;;
    age)
      if [ "$out" = - ]; then age -d -i "$KEY_FILE" "$in"; else age -d -i "$KEY_FILE" -o "$out" "$in"; fi ;;
    openssl)
      [ -f "$in.hmac" ] || die "$in.hmac is missing: refusing an unauthenticated file"
      [ "$(mac_of "$in")" = "$(cat "$in.hmac")" ] || die "$in failed authentication (wrong key, corrupted or modified)"
      if [ "$out" = - ]; then set --; else set -- -out "$out"; fi
      openssl enc -d -aes-256-ctr -pbkdf2 -iter "$BACKUP_PBKDF2_ITER" -pass "file:$KEY_FILE" -in "$in" "$@" ;;
  esac
}

# ---- status -------------------------------------------------------------------------------------------------------------------------

latest() { ls -t "$@" 2>/dev/null | head -1; }

write_status() { # $1 = ok|failed|base (ok = a full dump cycle succeeded; the others keep the last success time), $2 = what
  now=$(date -u +%s)
  tmp="$BACKUP_DIR/.status.prom.tmp"
  last_dump=$(latest "$DUMPS"/kkt-*.dump "$DUMPS"/kkt-*.dump.age "$DUMPS"/kkt-*.dump.enc)
  # newest complete base backup (directory names are UTC timestamps; *.partial = in progress or crashed)
  base_ts=0
  for d in "$BASES"/*/; do
    case "$d" in *.partial/) continue ;; esac
    for f in "$d"base.tar.gz "$d"base.tar.gz.age "$d"base.tar.gz.enc; do [ -f "$f" ] && base_ts=$(stat -c %Y "$f"); done
  done
  # archived WAL segments on disk (HMAC sidecars of the openssl mode excluded)
  wal_files=0
  for f in "$WAL"/*; do
    [ -f "$f" ] || continue
    case "$f" in *.hmac) ;; *) wal_files=$((wal_files + 1)) ;; esac
  done
  {
    echo "# HELP kkt_backup_last_run_timestamp_seconds Unix time of the last backup run."
    echo "# TYPE kkt_backup_last_run_timestamp_seconds gauge"
    echo "kkt_backup_last_run_timestamp_seconds $now"
    echo "# HELP kkt_backup_last_success_timestamp_seconds Unix time of the last fully successful backup run (dump + verify)."
    echo "# TYPE kkt_backup_last_success_timestamp_seconds gauge"
    if [ "$1" = ok ]; then echo "kkt_backup_last_success_timestamp_seconds $now"; echo "$now" > "$BACKUP_DIR/.last_success";
    else echo "kkt_backup_last_success_timestamp_seconds $(cat "$BACKUP_DIR/.last_success" 2>/dev/null || echo 0)"; fi
    echo "# HELP kkt_backup_last_dump_bytes Size of the latest logical dump (encrypted)."
    echo "# TYPE kkt_backup_last_dump_bytes gauge"
    echo "kkt_backup_last_dump_bytes $(if [ -n "$last_dump" ]; then stat -c %s "$last_dump"; else echo 0; fi)"
    echo "# HELP kkt_backup_last_base_backup_timestamp_seconds Unix time of the newest complete base backup (PITR starting point; 0 = none)."
    echo "# TYPE kkt_backup_last_base_backup_timestamp_seconds gauge"
    echo "kkt_backup_last_base_backup_timestamp_seconds $base_ts"
    echo "# HELP kkt_backup_encrypted 1 when dumps, base backups and WAL are written encrypted (age or openssl)."
    echo "# TYPE kkt_backup_encrypted gauge"
    echo "kkt_backup_encrypted $(if [ "$MODE" = none ]; then echo 0; else echo 1; fi)"
    echo "# HELP kkt_backup_wal_archive_files Archived WAL segments on disk."
    echo "# TYPE kkt_backup_wal_archive_files gauge"
    echo "kkt_backup_wal_archive_files $wal_files"
  } > "$tmp" && mv "$tmp" "$BACKUP_DIR/status.prom"
  log "status: $1 ($2)"
}

# ---- backup steps ---------------------------------------------------------------------------------------------------------------------

# runs "$@" with stdout into encrypt_file - OUT; fails when either side fails (POSIX sh has no pipefail)
encrypt_from() { # OUT command…
  out="$1"; shift
  rc_file="$BACKUP_DIR/.rc.$$"
  echo 1 > "$rc_file"
  enc_ok=1
  { "$@" && echo 0 > "$rc_file"; } | encrypt_file - "$out" || enc_ok=0
  rc=$(cat "$rc_file"); rm -f "$rc_file"
  if [ "$rc" != 0 ] || [ "$enc_ok" != 1 ]; then rm -f "$out" "$out.partial" "$out.hmac"; return 1; fi
}

# pg_basebackup as one tar on stdout (data directory + the WAL to make it consistent), gzip-compressed
pg_base_gz() { # label
  rcb="$BACKUP_DIR/.rcb.$$"
  echo 1 > "$rcb"
  { pg_basebackup --pgdata=- --format=tar --wal-method=fetch --checkpoint=fast --label="$1" --no-password && echo 0 > "$rcb"; } | gzip -6
  r=$(cat "$rcb"); rm -f "$rcb"
  [ "$r" = 0 ]
}

dump() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  file="$DUMPS/kkt-$ts.dump$EXT"
  log "pg_dump start -> $file"
  start=$(date +%s)
  # explicit checks: dump() runs inside `if dump && verify` where `set -e` is suspended, so a failed step must return 1 itself
  if ! encrypt_from "$file" pg_dump --format=custom --compress=6 --no-owner --no-privileges "$PGDATABASE"; then
    log "pg_dump FAILED (dump or encryption)"; return 1
  fi
  if ! (cd "$DUMPS" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256"); then
    rm -f "$file" "$file.hmac" "$file.sha256"; log "pg_dump FAILED (checksum)"; return 1
  fi
  log "pg_dump done ($(stat -c %s "$file") bytes, $(( $(date +%s) - start )) s, encryption $MODE)"
  LAST_DUMP="$file"
}

drill() { # FILE: decrypt into the scratch database and check it
  file="$1"
  scratch="${RESTORE_CHECK_DB:-kkt_restore_check}"
  log "restore drill of $(basename "$file") into $scratch"
  start=$(date +%s)
  dropdb --if-exists "$scratch"
  createdb "$scratch"
  rc_file="$BACKUP_DIR/.rc.$$"
  echo 1 > "$rc_file"
  # --no-owner/--no-privileges: the scratch copy belongs to the backup user; the triggers come back with the schema
  { decrypt_file "$file" - && echo 0 > "$rc_file"; } | pg_restore --no-owner --no-privileges --exit-on-error --dbname="$scratch" || echo 1 > "$rc_file"
  rc=$(cat "$rc_file"); rm -f "$rc_file"
  if [ "$rc" != 0 ]; then dropdb --if-exists "$scratch"; log "restore drill FAILED (decrypt or pg_restore)"; return 1; fi
  tables=$(psql -tAc "select count(*) from pg_tables where schemaname = 'public'" "$scratch")
  companies=$(psql -tAc "select count(*) from companies" "$scratch")
  ledger_ok=$(psql -tAc "select count(*) = 0 from (select booking_id, epoch from ledger_entries group by booking_id, epoch having count(*) <> count(distinct seq)) t" "$scratch" 2>/dev/null ||
    psql -tAc "select count(*) = 0 from (select booking_id from ledger_entries group by booking_id having count(*) <> count(distinct seq)) t" "$scratch" 2>/dev/null || echo t)
  dropdb --if-exists "$scratch"
  if [ "${tables:-0}" -lt 40 ] || [ "${companies:-0}" -lt 1 ] || [ "$ledger_ok" != "t" ]; then
    log "restore drill FAILED (tables=$tables companies=$companies ledger_ok=$ledger_ok)"; return 1
  fi
  log "restore drill ok (tables=$tables companies=$companies, $(( $(date +%s) - start )) s)"
}

verify() {
  [ "$VERIFY_RESTORE" = "true" ] || return 0
  drill "$LAST_DUMP"
}

basebackup() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  dir="$BASES/$ts"
  log "pg_basebackup start -> $dir"
  mkdir -p "$dir.partial"
  touch "$dir.partial/.started"
  # one tar (data directory + the WAL needed to make it consistent) on stdout → gzip → encryption: no plaintext touches the disk
  if ! encrypt_from "$dir.partial/base.tar.gz$EXT" pg_base_gz "kkt-$ts"; then
    rm -rf "$dir.partial"; log "pg_basebackup FAILED"; return 1
  fi
  # the backup history file Postgres archives for this base backup marks the first WAL segment it needs (name without the suffix);
  # the archiver may take a moment to push it
  hist=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    hist=$(find "$WAL" -maxdepth 1 -name "*.backup$EXT" -newer "$dir.partial/.started" | sort | tail -1)
    [ -n "$hist" ] && break
    sleep 5
  done
  if [ -n "$hist" ]; then basename "$hist" "$EXT" > "$dir.partial/WAL_START"; else log "no backup history file archived yet: WAL before this base backup is kept"; fi
  rm -f "$dir.partial/.started"
  mv "$dir.partial" "$dir"
  log "pg_basebackup done ($(du -sh "$dir" | cut -f1))"
}

retention() {
  find "$DUMPS" -maxdepth 1 -name 'kkt-*.dump*' -mtime +"$DUMP_RETENTION_DAYS" -print -delete | sed 's/^/deleted /' || true
  # base backups that crashed half-way (a .partial directory older than a day: never a running one) only waste space
  find "$BASES" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mtime +0 -print -exec rm -rf {} \; | sed 's/^/deleted /' || true
  # keep the newest BASE_BACKUPS_KEEP base backups (directory names are UTC timestamps: glob order = oldest first)
  total=0
  for d in "$BASES"/*/; do
    case "$d" in *.partial/) continue ;; esac
    [ -d "$d" ] && total=$((total + 1))
  done
  excess=$((total - BASE_BACKUPS_KEEP))
  oldest=""
  for d in "$BASES"/*/; do
    case "$d" in *.partial/) continue ;; esac
    [ -d "$d" ] || continue
    if [ "$excess" -gt 0 ]; then log "deleting base backup $d"; rm -rf "$d"; excess=$((excess - 1)); continue; fi
    [ -n "$oldest" ] || oldest="$d"
  done
  if [ -n "$oldest" ] && [ -s "$oldest/WAL_START" ]; then
    if [ -n "$EXT" ]; then set -- -x "$EXT"; else set --; fi
    pg_archivecleanup "$@" "$WAL" "$(cat "$oldest/WAL_START")" && log "archived WAL before $(cat "$oldest/WAL_START") removed"
    # MAC sidecars of removed segments (openssl mode)
    for h in "$WAL"/*.hmac; do [ -e "$h" ] && [ ! -e "${h%.hmac}" ] && rm -f "$h"; done
  fi
  return 0
}

has_base_backup() {
  for d in "$BASES"/*/; do
    case "$d" in *.partial/) continue ;; esac
    [ -d "$d" ] && return 0
  done
  return 1
}

cycle() {
  if dump && verify; then
    # weekly, and whenever no complete base backup exists yet (first run, or only crashed .partial attempts); a failure keeps the dump
    # cycle green but shows in kkt_backup_last_base_backup_timestamp_seconds (alert KktBaseBackupStale)
    if [ "$(date -u +%u)" = "$BASEBACKUP_WEEKDAY" ] || ! has_base_backup; then basebackup || log "pg_basebackup FAILED"; fi
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

# ---- WAL archive (run by Postgres as archive_command / restore_command) -----------------------------------------------------------------

wal_push() { # %p %f
  src="$1"; name="$2"; dest="$WAL/$name$EXT"
  if [ -f "$dest" ]; then
    # archived before (e.g. Postgres crashed before noting it): success only when the archived copy has the same content
    if decrypt_file "$dest" - 2> /dev/null | cmp -s - "$src"; then exit 0; fi
    log "wal-push: $dest exists with different content"; exit 1
  fi
  encrypt_file "$src" "$dest"
}

wal_fetch() { # %f %p
  name="$1"; dest="$2"
  for cand in "$WAL/$name.age" "$WAL/$name.enc" "$WAL/$name"; do
    if [ -f "$cand" ]; then decrypt_file "$cand" "$dest"; exit $?; fi
  done
  exit 1 # not archived (normal at the end of recovery)
}

cmd="${1:-}"
case "$cmd" in
  wal-push) resolve_mode; wal_push "$2" "$3"; exit 0 ;;
  wal-fetch) wal_fetch "$2" "$3" ;;
  decrypt) decrypt_file "$2" "$3"; exit 0 ;;
  encrypt) resolve_mode; encrypt_file "$2" "$3"; exit 0 ;;
esac

resolve_mode
mkdir -p "$DUMPS" "$BASES" "$WAL"

case "$cmd" in
  once) cycle; exit $? ;;
  # refreshes status.prom (base-backup timestamp) without claiming a dump success
  base) basebackup && retention && write_status base "base backup on demand"; exit $? ;;
  drill) drill "$2"; exit $? ;;
  prune) retention; exit 0 ;;
  "") ;;
  *) die "unknown command $cmd (once | base | drill FILE | prune | wal-push %p %f | wal-fetch %f %p | encrypt IN OUT | decrypt IN OUT)" ;;
esac

log "scheduler started: daily at $BACKUP_TIME_UTC UTC, base backup on weekday $BASEBACKUP_WEEKDAY, dumps kept $DUMP_RETENTION_DAYS days, encryption $MODE"
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
