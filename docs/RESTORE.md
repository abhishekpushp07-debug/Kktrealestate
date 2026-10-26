# Backup & restore (app level)

**Scope.** `tools/backup.py` produces an application-level export of the app database (`mongodump --gzip --archive`) with a SHA-256 manifest. It runs nightly as job `BACKUP` (after `DAILY_DUES` / `NIGHTLY_INTEGRITY`), writes to `BACKUP_DIR` (default `/app/backups`; mount object storage there in production) and keeps `BACKUP_RETENTION` archives (default 14).

**Managed Atlas.** If the deployment runs on MongoDB Atlas, Atlas cloud backups / point-in-time restore remain the primary disaster-recovery mechanism. The app-level export exists for portability, for restore drills that exercise *our* integrity checks, and for self-hosted Mongo. It does not replace Atlas snapshots.

## Commands
```bash
cd /app/backend
python tools/backup.py --out /app/backups              # manual backup; prints the manifest
python tools/restore_drill.py --scratch kkt_restore_drill   # restore latest archive into a scratch DB + verify
python tools/restore_drill.py --archive /app/backups/<db>-<stamp>.archive.gz
```

## Restore drill (what it proves)
1. `mongorestore --nsFrom=<db>.* --nsTo=<scratch>.*` into a scratch database (live DB untouched).
2. Verification: document counts for bookings/payments/demands/ledger_entries/customers/audit_logs/users vs live (drift ≤ 0.1 %), and ledger totals by type match.
3. `services.integrity.integrity_report()` executed against the scratch DB.
4. A `job_runs` record `RESTORE_DRILL` (OK / FAILED with item errors) and `settings.last_restore_drill`.

## Real restore (runbook)
1. Stop writers: `sudo supervisorctl stop backend`.
2. Pick the archive; verify `sha256sum <archive>` equals the manifest.
3. `mongorestore --uri=$MONGO_URL --archive=<archive> --gzip --drop` (same DB name) — or restore into a new DB and switch `DB_NAME`.
4. Start the backend; startup re-applies indexes, invariants and validators idempotently.
5. Run `python tools/tieout.py` and check System Health → integrity ok, job_runs, backup card.

## Observability
System Health (`GET /api/admin/ops` → `backup`) shows last backup, age, `stale` (> 26 h) and the last drill. Alert rule `backup_stale` in `ops/alerts.yaml` notifies Super Admin.

## Env
`BACKUP_ENABLED=1|0`, `BACKUP_DIR`, `BACKUP_RETENTION`.
