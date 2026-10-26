# KKT v2 — Backups and restore

What is protected, how often, and the exact steps to get it back. The PITR mechanics and the backup script were rehearsed on
PostgreSQL 16 while writing this document (see "Drills"); the Compose-specific wrappers (`docker compose exec`, volume swaps) could not
be executed in the build environment (no Docker daemon). Repeat the drills on your own infrastructure before you rely on them.

## What is backed up

| Data                 | Mechanism (Compose production, `docker-compose.prod.yml`)                                                                                                                                                       | Recovery point | Where                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------ |
| Database, continuous | WAL archiving: Postgres copies every completed WAL segment to the `backups` volume (`archive_mode=on`, `archive_timeout=300`)                                                                                   | ≤ 5 minutes    | `/backups/wal`                             |
| Database, physical   | `pg_basebackup` (tar + gzip, WAL streamed) every `BASEBACKUP_WEEKDAY` (Sunday) and on the first run; the newest `BASE_BACKUPS_KEEP` (2) are kept, older WAL is pruned                                           | base for PITR  | `/backups/base/<UTC timestamp>/`           |
| Database, logical    | `pg_dump -Fc` every night at `BACKUP_TIME_UTC` (21:00 UTC = 02:30 IST), SHA-256 file next to it, kept `DUMP_RETENTION_DAYS` (14)                                                                                | ≤ 24 hours     | `/backups/dumps/kkt-<UTC timestamp>.dump`  |
| Restore drill        | every nightly dump is restored into a scratch database (`kkt_restore_check`), checked (tables, company row, ledger sequence uniqueness) and dropped; a failure marks the run failed                             | —              | backup service log, `/backups/status.prom` |
| Uploaded files       | object storage (`STORAGE_DRIVER=s3`): enable **bucket versioning** and a lifecycle rule keeping non-current versions ≥ 30 days; files are written once under uuid keys and deleted only by erasure/cleanup jobs | per write      | the bucket                                 |
| Off-site copy        | `BACKUP_UPLOAD_CMD` runs after every successful cycle (e.g. `rclone sync /backups remote:kkt-backups` or `aws s3 sync /backups s3://kkt-backups/` from an image that has the tool)                              | per night      | your second region / provider              |
| Application export   | `POST /api/v1/admin/backup` (Super Admin): a ZIP with one file per table, manifest with row counts and checksums                                                                                                | on demand      | object storage, signed link                |

Monitoring: the backup service writes `/backups/status.prom` (`kkt_backup_last_success_timestamp_seconds`, dump size, WAL file count);
node-exporter's textfile collector exposes it and the alert **KktBackupStale** fires when no successful dump + drill happened for 26 h
(docs/OBSERVABILITY.md). Kubernetes deployments use the managed database's automated backups and point-in-time recovery instead (set
the retention to ≥ 14 days) and keep the application export for portability.

Run a backup cycle now (e.g. before an upgrade): `docker compose -f docker-compose.prod.yml exec backup sh /opt/kkt/backup.sh once`.

## Recovery objectives (Compose production)

| Incident                                                                         | Procedure                                | RPO         | RTO (≈ 50 GB database) |
| -------------------------------------------------------------------------------- | ---------------------------------------- | ----------- | ---------------------- |
| A bad release or an operator mistake changed data at a known time                | Point-in-time recovery to just before it | ≤ 5 min     | 30–90 min              |
| The database host/volume is lost, backups volume survives (or its off-site copy) | PITR to the end of the archive           | ≤ 5 min     | 30–90 min              |
| Backups volume lost too, off-site copy of last night                             | Restore the nightly dump                 | ≤ 24 h      | 15–60 min              |
| Move one company to another installation                                         | Application export + restore CLI         | export time | minutes                |

## 1. Restore a nightly dump

1. Stop everything that writes: `docker compose -f docker-compose.prod.yml stop api worker web`.
2. Pick the dump and check it: `cd /backups/dumps && sha256sum -c kkt-20261025T210000Z.dump.sha256` (inside the `backup` container:
   `docker compose -f docker-compose.prod.yml exec backup sh`).
3. Restore into a **new** database next to the old one (never over it), as the owner role. The roles script runs first (it creates
   the extensions as the superuser and the default privileges for `kkt_app`); the dump's extension entries are skipped because only a
   superuser may create `pg_stat_statements` or comment on an extension; the script runs again afterwards (grants on the restored
   tables, idempotent):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres sh -c '
     set -e
     DUMP=/backups/dumps/kkt-20261025T210000Z.dump
     createdb -U postgres -O kkt_owner kkt_restored
     psql -q -U postgres -d kkt_restored -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-roles.sql
     pg_restore -l "$DUMP" | grep -v " EXTENSION " > /tmp/kkt-restore.list
     pg_restore -U postgres --dbname=kkt_restored --no-owner --role=kkt_owner --exit-on-error -L /tmp/kkt-restore.list "$DUMP"
     psql -q -U postgres -d kkt_restored -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-roles.sql'
   ```
   (Rehearsed on PostgreSQL 16: every table comes back owned by `kkt_owner`, `kkt_app` has DML but no `TRUNCATE`, and all triggers
   are present. Without the list, `pg_restore --role=kkt_owner` stops at `CREATE EXTENSION pg_stat_statements` / `COMMENT ON
EXTENSION`.)
4. Swap the databases (keeps the broken one for investigation):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "
     SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'kkt' AND pid <> pg_backend_pid();" -c "
     ALTER DATABASE kkt RENAME TO kkt_broken_$(date +%Y%m%d);" -c "ALTER DATABASE kkt_restored RENAME TO kkt;"
   docker compose -f docker-compose.prod.yml restart pgbouncer
   ```
5. Run the migrate job (no-op unless the dump is older than the running release), start the services, check:
   `docker compose -f docker-compose.prod.yml up -d migrate api worker web` → ERP → Admin → Integrity report must show zero findings;
   `curl -s https://erp.<domain>/api/v1/ready`.
6. Everything written after the dump (up to 24 h) is gone: reconcile payments/receipts from bank statements and the receipt numbers
   (gaps in `sequences`), or use PITR instead when the WAL archive survived.

## 2. Point-in-time recovery (PITR) from the WAL archive

Use when you know _when_ things went wrong (e.g. "the bulk edit at 14:32 IST was a mistake") or when the database volume is lost but
`/backups` (or its off-site copy) survived. Times are in UTC in the commands; 14:32 IST = 09:02 UTC.

1. Stop writers and Postgres: `docker compose -f docker-compose.prod.yml stop api worker web pgbouncer postgres`.
2. Keep the current data directory for investigation, start from an empty one:
   ```bash
   docker volume create kkt_pgdata_restore
   ```
   and in `docker-compose.prod.yml` (temporarily) mount `kkt_pgdata_restore` instead of `pgdata` for `postgres` (declare it under
   `volumes:` with `external: true`).
3. Unpack the newest base backup taken **before** the target time, plus its WAL, into the new volume (volume names carry the Compose
   project prefix: `docker volume ls | grep backups`):
   ```bash
   docker run --rm -i -u 70:70 -v kkt_pgdata_restore:/var/lib/postgresql/data -v kkt_backups:/backups postgres:16-alpine sh -s <<'EOF'
   set -e
   B=/backups/base/20261020T210000Z          # newest base backup before the target time
   D=/var/lib/postgresql/data
   chmod 700 "$D"
   tar xzf "$B/base.tar.gz" -C "$D"
   tar xzf "$B/pg_wal.tar.gz" -C "$D/pg_wal"
   cat >> "$D/postgresql.auto.conf" <<'CONF'
   restore_command = 'cp /backups/wal/%f %p'
   recovery_target_time = '2026-10-25 09:02:00+00'
   recovery_target_action = 'promote'
   CONF
   touch "$D/recovery.signal"
   EOF
   ```
   (Omit `recovery_target_time` to replay everything in the archive, e.g. after losing the database volume.)
4. Start Postgres alone and watch it replay: `docker compose -f docker-compose.prod.yml up -d postgres && docker compose -f docker-compose.prod.yml logs -f postgres`
   until `recovery stopping before commit of transaction …, time …` and `archive recovery complete`. The server is promoted and
   accepts writes on a new timeline.
5. Remove the three recovery lines from `postgresql.auto.conf`
   (`docker compose … exec postgres sed -i '/restore_command\|recovery_target/d' /var/lib/postgresql/data/postgresql.auto.conf`),
   restart Postgres, take a fresh backup cycle (`… exec backup sh /opt/kkt/backup.sh once`: the new timeline needs a new base backup),
   then start PgBouncer, the migrate job, the API, the worker and the website, and check the integrity report as in step 5 above.

Kubernetes / managed Postgres: use the provider's PITR (e.g. `aws rds restore-db-instance-to-point-in-time --target-db-instance-identifier
kkt-restored --source-db-instance-identifier kkt --restore-time 2026-10-25T09:02:00Z`), run `infra/postgres/init/01-roles.sql` +
passwords if the roles are missing, point the `postgres` ExternalName Service at the new endpoint, restart PgBouncer, run the migrate
Job, roll the Deployments.

## 3. Application-level restore (one company, another installation)

`POST /api/v1/admin/backup` produces a ZIP (one NDJSON file per table, `manifest.json` with schema version, row counts and SHA-256
per file). One backup per company runs at a time (a second request while one is queued or running is 409 JOB_ALREADY_RUNNING). The restore CLI loads it into an **empty** database:

```bash
pnpm --filter @kkt/api restore -- --file kkt-backup-2026-10-25.zip --database-url postgres://kkt_owner:…@host:5432/kkt_new --confirm
```

It verifies every checksum, refuses a target that holds any row BEFORE touching it, migrates the target, loads the tables in foreign-key order in one transaction (the append-only triggers
do not block inserts, so no trigger is disabled), compares the row counts with the manifest and runs the integrity report; exit code 0
only when every count matches and the report is clean. Run it as the owner role. Files referenced by documents are not inside the ZIP:
copy the bucket (or the `storage` volume) separately. (The CLI ships with the platform track: `apps/api/src/cli/restore.ts`; inside the
API image run it from a source checkout with Node 22 and `pnpm install`, it is not part of the runtime bundle.)

## Drills

- **Automatic, nightly**: every dump is restored into `kkt_restore_check` and checked before the run counts as successful.
- **Rehearsed for this document** (PostgreSQL 16.15): a scratch cluster with `archive_mode=on`; base backup; rows 1 and 2 committed;
  target time taken; then row 3 inserted and row 1 deleted; recovery with the commands above stopped
  "before commit of transaction 733" and the table contained exactly `{1,2}`. `backup.sh once` against a seeded database produced a
  282 KB dump, restored it into the scratch database (78 tables, 1 company) and a 114 MB base backup.
- **Quarterly, by hand**: restore last night's dump and do a PITR to "one hour ago" on a spare VM; log in to the ERP, open a booking
  statement, compare the integrity report and the latest receipt number with production. Record the time it took (your real RTO).
