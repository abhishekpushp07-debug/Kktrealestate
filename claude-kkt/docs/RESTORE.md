# KKT v2 — Backups and restore

What is protected, how often, and the exact steps to get it back. Every procedure below was executed on PostgreSQL 16 on 2026-10-27
(see "Drills" for sizes and timings): the encrypted nightly cycle, the dump restore with the roles script, point-in-time recovery from
an encrypted base backup and encrypted WAL, and the application export → restore CLI. The Compose-specific wrappers
(`docker compose exec`, volume swaps) could not be executed in the build environment (no Docker daemon) — they run the same commands
inside the containers. Repeat the drills on your own infrastructure before you rely on them.

## Encryption

Nothing leaves Postgres unencrypted (`infra/backup/backup.sh`; image `kkt-backup:16` = `postgres:16-alpine` + age, used by both the
`postgres` and the `backup` services). The key is the secret file `infra/secrets/backup_encryption_key` (`BACKUP_ENCRYPTION_KEY_FILE`):

- an **age identity** (`AGE-SECRET-KEY-1…`, written by `gen-secrets.sh` when `age-keygen` is installed, or
  `docker run --rm kkt-backup:16 age-keygen`): files are encrypted to its public key with age (X25519 + ChaCha20-Poly1305, authenticated
  in 64 KiB chunks, streaming) and end in `.age`;
- any other value of ≥ 32 characters (`openssl rand -hex 32`, the fallback `gen-secrets.sh` writes without age): AES-256-CTR with a
  PBKDF2-derived key plus an HMAC-SHA256 `<file>.hmac` (encrypt-then-MAC; `openssl enc` cannot do GCM) that is verified before a byte is
  decrypted; files end in `.enc`.

Dumps and base backups are encrypted while they stream (no plaintext on disk), every WAL segment by `archive_command = sh
/opt/kkt/backup.sh wal-push %p %f`. A wrong key, a truncated or a modified file is refused (`decrypt` exits 1). Without a key the
script refuses to run (`BACKUP_ENCRYPTION=none` is an explicit development-only opt-out). `kkt_backup_encrypted` in `status.prom`
reports the mode. **Keep the key outside the backup host** (password manager / vault): a backup without its key is unrecoverable; keep
retired keys as long as backups made with them are retained. Helper commands (inside the `backup` or `postgres` container):
`sh /opt/kkt/backup.sh decrypt <file> <out|->`, `… encrypt <in|-> <out>`, `… drill <dump>`, `… base` (one base backup now), `… prune`,
`… wal-fetch <segment> <path>`. A step that fails is never recorded as a backup: a failed `pg_dump`, or a cipher that fails at the end
of the stream (disk full), removes the partial file and its MAC and fails the run even without the restore drill
(`scripts/ci/backup-sh.test.mjs` covers both modes, failure propagation, WAL archiving and retention).

## What is backed up

| Data                 | Mechanism (Compose production, `docker-compose.prod.yml`)                                                                                                                                                                                                      | Recovery point | Where                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------ |
| Database, continuous | WAL archiving: Postgres encrypts every completed WAL segment into the `backups` volume (`archive_mode=on`, `archive_timeout=300`, `backup.sh wal-push`)                                                                                                        | ≤ 5 minutes    | `/backups/wal/<segment>.age`               |
| Database, physical   | `pg_basebackup` (one tar incl. the WAL it needs, gzip, encrypted while streaming) every `BASEBACKUP_WEEKDAY` (Sunday) and on the first run; the newest `BASE_BACKUPS_KEEP` (2) are kept, older WAL is pruned                                                   | base for PITR  | `/backups/base/<UTC>/base.tar.gz.age`      |
| Database, logical    | `pg_dump -Fc` every night at `BACKUP_TIME_UTC` (21:00 UTC = 02:30 IST), encrypted while streaming, SHA-256 file next to it, kept `DUMP_RETENTION_DAYS` (14)                                                                                                    | ≤ 24 hours     | `/backups/dumps/kkt-<UTC>.dump.age`        |
| Restore drill        | every nightly dump is decrypted on the fly and restored into a scratch database (`kkt_restore_check`), checked (tables, company row, ledger sequence uniqueness per epoch) and dropped; a failure (including a key that does not decrypt) marks the run failed | —              | backup service log, `/backups/status.prom` |
| Uploaded files       | object storage (`STORAGE_DRIVER=s3`): enable **bucket versioning** and a lifecycle rule keeping non-current versions ≥ 30 days; files are written once under uuid keys and deleted only by erasure/cleanup jobs                                                | per write      | the bucket                                 |
| Off-site copy        | `BACKUP_UPLOAD_CMD` runs after every successful cycle (e.g. `rclone sync /backups remote:kkt-backups` or `aws s3 sync /backups s3://kkt-backups/` from an image that has the tool)                                                                             | per night      | your second region / provider              |
| Application export   | `POST /api/v1/admin/backup` (Super Admin): a ZIP with one file per table, manifest with row counts and checksums, `manifest.sig` (HMAC under `LINK_SIGNING_KEYS`)                                                                                              | on demand      | object storage, signed link                |

Monitoring: the backup service writes `/backups/status.prom` (`kkt_backup_last_success_timestamp_seconds`, dump size,
`kkt_backup_last_base_backup_timestamp_seconds`, WAL file count); node-exporter's textfile collector exposes it, the alert
**KktBaseBackupStale** fires when the newest complete base backup is older than 8 days (a failed weekly base backup does not fail the
nightly cycle; take one with `… exec backup sh /opt/kkt/backup.sh base`) and **KktBackupStale** when no successful dump + drill happened for 26 h
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
2. Pick the dump and check it: `cd /backups/dumps && sha256sum -c kkt-20261025T210000Z.dump.age.sha256` (inside the `backup` container:
   `docker compose -f docker-compose.prod.yml exec backup sh`). Restoring from the off-site copy: put the files back into the `backups`
   volume first; you need `infra/secrets/backup_encryption_key`.
3. Restore into a **new** database next to the old one (never over it), as the owner role. The roles script runs first (it creates
   the extensions as the superuser and the default privileges for `kkt_app`); the dump's extension entries are skipped because only a
   superuser may create `pg_stat_statements` or comment on an extension; the script runs again afterwards (grants on the restored
   tables, idempotent):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres sh -c '
     set -e
     DUMP=/tmp/kkt-restore.dump
     # decrypt (authenticated: a wrong key or a modified file stops here) into the container, never into the backups volume
     sh /opt/kkt/backup.sh decrypt /backups/dumps/kkt-20261025T210000Z.dump.age "$DUMP"
     createdb -U postgres -O kkt_owner kkt_restored
     psql -q -U postgres -d kkt_restored -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-roles.sql
     pg_restore -l "$DUMP" | grep -v " EXTENSION " > /tmp/kkt-restore.list
     pg_restore -U postgres --dbname=kkt_restored --no-owner --role=kkt_owner --exit-on-error -L /tmp/kkt-restore.list "$DUMP"
     psql -q -U postgres -d kkt_restored -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-roles.sql
     rm -f "$DUMP" /tmp/kkt-restore.list'
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
3. Decrypt and unpack the newest base backup taken **before** the target time (it contains the WAL it needs) into the new volume, and
   point recovery at the encrypted archive (volume names carry the Compose project prefix: `docker volume ls | grep backups`; the
   secrets directory is `./infra/secrets`):
   ```bash
   docker run --rm -i -u 70:70 -v kkt_pgdata_restore:/var/lib/postgresql/data -v kkt_backups:/backups \
     -v "$PWD/infra/secrets/backup_encryption_key:/run/secrets/backup_encryption_key:ro" \
     -e BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup_encryption_key kkt-backup:16 sh -s <<'EOF'
   set -e
   B=/backups/base/20261020T210000Z          # newest base backup before the target time
   D=/var/lib/postgresql/data
   chmod 700 "$D"
   sh /opt/kkt/backup.sh decrypt "$B/base.tar.gz.age" - | tar xzf - -C "$D"
   cat >> "$D/postgresql.auto.conf" <<'CONF'
   restore_command = 'sh /opt/kkt/backup.sh wal-fetch %f %p'
   recovery_target_time = '2026-10-25 09:02:00+00'
   recovery_target_action = 'promote'
   CONF
   touch "$D/recovery.signal"
   EOF
   ```
   (The `postgres` service already has `BACKUP_ENCRYPTION_KEY_FILE` and the key secret, so `wal-fetch` decrypts during the replay.)
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

`POST /api/v1/admin/backup` produces a ZIP (format `kkt-backup/3`: one NDJSON file per table, `manifest.json` with schema version, row
counts and SHA-256 per file, and `manifest.sig` — an HMAC-SHA256 of the exact `manifest.json` bytes under the active `LINK_SIGNING_KEYS`
key, key family `kkt-backup-manifest-v1`, with the key id). One backup per company runs at a time (a second request while one is queued
or running is 409 JOB_ALREADY_RUNNING). The restore CLI loads it into an **empty** database:

```bash
# inside the API image (it ships as dist/cli/restore.js), with the installation's environment (LINK_SIGNING_KEYS[_FILE], keys; the
# configuration's own DATABASE_URL / DATABASE_URL_FILE is left alone — the restore always connects to --database-url):
node dist/cli/restore.js --file kkt-backup-2026-10-25.zip --verify-only                 # signature + checksums, no database
node dist/cli/restore.js --file kkt-backup-2026-10-25.zip --database-url postgres://kkt_owner:…@host:5432/kkt_new --confirm
# from a checkout: pnpm --filter @kkt/api restore -- <same arguments>
```

It first verifies the signature — an archive without `manifest.sig` (including every pre-phase-7 `kkt-backup/2` archive), a manifest
edited after signing (even with recomputed checksums), a signature made with another installation's key, a key id that is not in the
ring, or a file the signed manifest does not list is refused before anything connects to the target — then every checksum. It refuses
a target that holds any row BEFORE touching it, migrates the target, loads the tables in foreign-key order in one transaction (the
append-only triggers do not block inserts, so no trigger is disabled), compares the row counts with the manifest and runs the integrity
report; exit code 0 only when every count matches and the report is clean (the JSON summary names `signed_by`, the key id). Run it as
the owner role, with the `LINK_SIGNING_KEYS` ring that was active when the backup was made (keep retired link keys while you keep such
archives). Files referenced by documents are not inside the ZIP: copy the bucket (or the `storage` volume) separately.

## Drills

- **Automatic, nightly**: every dump is decrypted and restored into `kkt_restore_check` and checked before the run counts as successful.
- **Executed 2026-10-27** (PostgreSQL 16, age 1.1.1, OpenSSL 3.0.13; source: the demo seed — 1 company, 82 tables, 2,720 rows,
  130 flats, 10 bookings, 103 ledger rows, 36 payments, 878 audit rows, database 19 MB):

  | Drill                                                                                                                                                  | Size                                    | Time                                                           | Result                                                                                                                                                                                                                     |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `backup.sh once`, age: encrypted `pg_dump`, restore drill into the scratch database, encrypted base backup                                             | dump 676 KB (`.dump.age`), base 185 MB¹ | dump < 1 s, drill 1 s, base ≈ 2 min¹                           | drill ok (82 tables, 1 company); `status.prom` success + `kkt_backup_encrypted 1`                                                                                                                                          |
  | `backup.sh once`, openssl fallback (`.enc` + `.hmac`)                                                                                                  | dump 675 KB                             | 2 s incl. drill                                                | drill ok                                                                                                                                                                                                                   |
  | Tamper / wrong key / no key                                                                                                                            | —                                       | —                                                              | one flipped byte: age "failed to decrypt and authenticate payload chunk", openssl "failed authentication"; wrong identity refused; no key file: the script refuses to run                                                  |
  | §1 dump restore: decrypt + roles script + filtered list + `pg_restore --role=kkt_owner` + roles script                                                 | 676 KB                                  | 1.4 s                                                          | 82/82 tables owned by `kkt_owner`, `kkt_app` has INSERT but not TRUNCATE on payments, 75/75 triggers, row counts of all 82 tables identical, integrity report OK (0 findings)                                              |
  | §2 PITR: scratch cluster archiving through `wal-push` (age), base backup by `backup.sh once`, rows 1–2, row 3, target time, then row 1 deleted + row 4 | base 3.1 MB, 5 WAL segments             | recovery 2 s                                                   | `wal-fetch` restored segments 2–5, "recovery stopping before commit of transaction 733", table = exactly `{1,2,3}`, promoted on timeline 2; `WAL_START` found the archived `.backup.age` and `prune` removed WAL before it |
  | §3 application export (`writeBackupArchive`, sensitive) → `restore --verify-only` → `restore --confirm` into an empty database                         | ZIP 446 KB                              | export 0.4 s, verify 3.3 s², restore 4.6 s² (2.0 s in the CLI) | `signed_by` the active key, 83 files verified; row counts of all 82 tables identical to the source; integrity report OK (0 findings)                                                                                       |

  ¹ the scratch server's whole cluster (other databases included) — a production base backup holds only the KKT database cluster.
  ² wall time including `pnpm`/`tsx` start-up; the built CLI in the image starts faster.

  WAL push is idempotent: re-archiving an identical segment succeeds, a different one under the same name is refused (Postgres retries
  and alerts via disk growth). Signed-archive refusals (unsigned, edited manifest with recomputed checksums, foreign signature, unknown
  key id, injected file) are covered by `apps/api/test/integration/backup-signing.test.ts`; the full API backup → restore round trip by
  `backup-restore.test.ts`.

- **Quarterly, by hand**: restore last night's dump and do a PITR to "one hour ago" on a spare VM; log in to the ERP, open a booking
  statement, compare the integrity report and the latest receipt number with production. Record the time it took (your real RTO).
