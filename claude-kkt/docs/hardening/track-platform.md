## Platform reliability track: report

All 11 items are done and each has tests. Every suite I ran passes:
- **API unit + integration:** 55 files, 619 tests (all serial, `kkt_h3`, Redis 18).
- **Acceptance:** 13 files, 55 tests (`kkt_h3_acc`).
- **Contracts:** 183 tests.
- **Typecheck:** clean for api, contracts, db, erp, web and portal.
- **ESLint:** 0 errors on my files. One warning remains, in `admin/erase.ts`, which belongs to the security track.

All paths below are under `/home/user/Kktrealestate/claude-kkt`. Nothing is committed.

### What changed, by item
1. **Standalone worker runs real handlers.**
   - `src/worker.ts` builds the full app without listening, then consumes the queue. It shuts down cleanly on SIGTERM.
   - `startWorker()` accepts the app, a DB handle, or an options object, so `server.ts`'s `startWorker(app.db)` call still works.
   - `jobHandler()` throws `UnregisteredJobError` for an unknown name. The worker turns that into a BullMQ `UnrecoverableError`: the run is recorded FAILED, not retried, and alerted.
2. **Retries and failure alerts.**
   - Each attempt writes a `job_runs` row whose `result` is `{attempt, max_attempts, will_retry}`, and the error is rethrown so BullMQ retries.
   - Jobs get 3 attempts with exponential backoff (`JOB_BACKOFF_MS`, default 30 s).
   - After the final failure, Super Admins get a `JOB_FAILED` bell and `ERROR_WEBHOOK_URL` receives a POST (`jobs/alerts.ts`).
   - `GET /admin/jobs` now shows, per job: last run, last success, `failure_count_24h`, `failures_since_success`, `next_run_at` and `schedule_enabled`.
   - `POST /admin/jobs/:name/run` now enqueues and returns **202** `{run_id, job_id, job_name, status:"QUEUED", queued_at}`. It returns 409 `JOB_ALREADY_RUNNING` if a manual run is already queued.
   - New route `GET /admin/jobs/runs/:id` returns a run; it is 404 until a worker starts it.
3. **Schedules and boot jobs** (`jobs/queue.ts`).
   - New schedules: `PORTAL_FILE_CLEANUP` hourly at :20, `IDEMPOTENCY_PURGE` hourly at :35, `HOLD_EXPIRY` every 5 minutes, `EXPORT_CLEANUP` daily at 03:10, and `PARTITION_MAINTENANCE` daily at 02:20 only when partitioning is enabled. A schedule whose handler isn't registered is skipped with a warning.
   - On start the worker enqueues `STARTUP_RECONCILIATION`, `NOTIFICATION_SWEEP` and the dues catch-up, once per deploy. The Redis lock key is `boot:jobs:<APP_VERSION>:<DEPLOY_ID|GIT_SHA|default>` with a 6 h TTL.
   - The catch-up is enqueued only when the last successful dues run started before the latest 00:30 IST. It uses `DUES_CATCHUP` if registered, else `DAILY_DUES`.
4. **`NOTIFICATION_SWEEP`** (`modules/notifications/sweep.ts`) runs in batches of 5,000.
   - It covers deleted or soft-deleted documents, erased customers, VOID demands, missing tickets and other missing entities. It also covers bells addressed to erased customers.
   - Unread bells are deleted; read ones are marked withdrawn.
   - Soft-deleting a document now withdraws its bells immediately.
   - The portal now sends `booking_other_charge` bells to the DEMANDS screen.
5. **Idempotency durability** (`plugins/idempotency.ts`).
   - A Postgres row marks the request IN_PROGRESS (`status_code` NULL) before the handler runs. Concurrent duplicates on any instance wait and replay, even with Redis down.
   - A non-2xx response releases the claim so the client can retry with the same key.
   - A claim older than 60 s with the same request hash is taken over by a retry.
   - Redis is now only a cache, read with a 200 ms budget.
   - `IDEMPOTENCY_PURGE` deletes expired keys in batches of 5,000.
6. **Redis.** `plugins/redis.ts` adds `app.redisSecurity` (its own client when `REDIS_SECURITY_URL` is set, otherwise the main client) and `app.jobQueue()`. BullMQ uses the main `REDIS_URL`. Rate limiting already failed open in `auth.ts` (security track); a test now confirms requests keep working with Redis down.
7. **Database error mapping** (`lib/errors.ts`):

| Database error | Response |
|---|---|
| 57014 (statement timeout) | 503 `SERVICE_UNAVAILABLE`, `Retry-After: 5` |
| Connection or pool failure (class 08, 53300, 57P0x, connect timeout, refused or reset socket) | 503, `Retry-After: 5` |
| 55P03 (lock timeout) | 409 `LOCK_TIMEOUT`, `Retry-After: 1` |
| 40001 / 40P01 (serialization failure or deadlock) | 409 `CONFLICT_RETRY` |

   All of these carry `details.retryable: true`.
8. **CSV exports** (`lib/list.ts`, `modules/documents/exports.ts`).
   - Every CSV list now sends `X-Export-Total` and `X-Export-Rows`, plus `X-Export-Truncated: true` when it was cut at 10,000 rows.
   - The async export API pages through every row. The job calls the route in-process as the requesting user, using the `X-Export-Cursor` → `X-Export-Next-Cursor` handshake. Contract shapes are in the frontend section below.
9. **Backup and restore.**
   - `POST /admin/backup` now returns 202 and enqueues `BACKUP_EXPORT`.
   - The job reads every table in one repeatable-read snapshot, through a cursor in batches of 5,000 with no row cap. It writes NDJSON per table into a ZIP (archiver) on disk, then to storage. `manifest.json` has row counts, schema version, sha256 per file and the FK load order. Format is `kkt-backup/2`.
   - `RESTORE.md` inside the archive no longer mentions `session_replication_role`.
   - `GET /admin/backups` lists backups with status. `POST /admin/backups/:id/link` returns a signed link, or 409 `EXPORT_NOT_READY` before the backup is DONE.
   - Restore CLI (`src/cli/restore.ts`, logic in `admin/restore.ts`): `pnpm --filter @kkt/api restore -- --file <zip> --database-url <empty db> --confirm [--allow-stripped]`.
   - The CLI checks every sha256, migrates the target, refuses a non-empty database, and loads in FK order in one transaction using `json_populate_recordset`. It then compares row counts and runs the integrity report.
   - The in-memory ZIP writer `admin/zip.ts` is deleted; nothing uses it now.
10. **Versions** (`lib/version.ts`).
    - A staff PATCH without `version` or `If-Match` gets 400 `VERSION_REQUIRED`. The check runs after authentication and before the handler.
    - `PATCH /documents/:id` now requires a version.
    - The policy is documented in `docs/API-CONVENTIONS.md`.
11. **Partitions** (`packages/db/partitions/`: `001_functions.sql`, `002_partition_tables.sql`, `README.md`).
    - The scripts convert `audit_logs`, `ledger_entries`, `login_events` and `notifications` without copying rows. The old table becomes a `<table>_legacy` partition covering everything up to next month (UTC); a default partition and the next months are created.
    - The ledger's `(booking_id, seq)` uniqueness can't be a unique index once partitioned, so it becomes a trigger guarded by an advisory lock. It raises the same `23505` error.
    - `PARTITION_MAINTENANCE` is registered but only runs when `PARTITIONING_ENABLED=true`.

### Tests
- **New files:**
  - `test/unit/jobs.test.ts`: registry, schedules, backoff, IST dues slot, deploy id, webhook against a real HTTP server.
  - `test/integration/platform.test.ts`: covers items 1–7 and 10 plus the sweep:
    - a real `tsx src/worker.ts` child process runs boot jobs through real handlers, registers schedules and shuts down cleanly;
    - the retry sequence FAILED, FAILED, OK; final-failure bell and webhook; an unknown job name fails without retries;
    - idempotency with Redis disconnected, claim release on non-2xx, and takeover of an abandoned claim;
    - real statement and lock timeouts;
    - a route-registry check of the PATCH version policy.
  - `test/integration/exports.test.ts`: truncation headers; a 10,050-row async export with no row duplicated or skipped; validation; owner privacy; cleanup.
  - `test/integration/backup-restore.test.ts`: demo seed, backup through the API, restore into a fresh database. Row counts per table match and the integrity report has zero findings; exact values match for bookings and ledger rows. It also checks that a tampered archive, a missing `--confirm`, a non-empty target and a stripped backup are refused, and runs the CLI end to end.
  - `test/integration/partitions.test.ts`: runs the scripts on a scratch database, re-runs them and the migrations, checks guards on every partition, the ledger rule under concurrency, and the maintenance job.
  - `test/integration/worker.ts`: helpers.
- **Updated:** `admin.test.ts`, `admin-adversarial.test.ts`, `documents.test.ts` (PATCH requests now send a version).

### Decisions and deviations
- **Edits outside my ownership:**
  - `enums.ts`: besides `JOB_NAMES` and its labels, I appended `JOB_FAILED` and `EXPORT_READY` to `NOTIFICATION_TYPES`. Without them the bell's response schema would reject these notifications. All targeted edits.
  - `errors.ts`: added `VERSION_REQUIRED` (400), `LOCK_TIMEOUT` (409), `CONFLICT_RETRY` (409), `EXPORT_NOT_READY` (409).
  - `apps/api/package.json`: added the `restore` script.
- **Global hooks without `app.ts`:** I couldn't touch `app.ts` or `routes.ts`, so the version-policy hook is installed from the idempotency plugin and the CSV export hooks from the db plugin.
- **Exports placement:** the export routes live in `modules/documents/exports.ts` and their contracts in `contracts/modules/admin.ts`, since I own neither an exports module nor `contracts/index.ts`. The routes use permission `notification.read` (every staff role has it); the real check is the target route's own permission plus a preflight request with the caller's token.
- **Backups use the `exports` table** (`path = 'admin:backup'`), because I can't add migrations. Backups are kept 24 h; list exports are kept 7 days.
- **Two PATCH routes are exempt from the version policy** for now, because the ERP doesn't send a version there: `/construction/photos/:photoId` and `/payment-plan-assignments/:id`. `PATCH /portal/profile` is exempt by design. This is noted as item 13 in `docs/TODO-integration.md`.
- **Breaking response changes** (no frontend calls these today):
  - `POST /admin/backup` and `POST /admin/jobs/:name/run` now return 202 with new shapes.
  - In `AdminBackupRow`, the file fields are nullable until the backup is DONE.
- **`PARTITIONING_ENABLED`, `JOB_BACKOFF_MS` and `DEPLOY_ID`** are read straight from `process.env`, because `config.ts` isn't mine.
- **Scratch databases:** the tests create `kkt_h3_restore`, `kkt_h3_restore_cli` and `kkt_h3_part`, and drop them afterwards.
- **One accidental run on another database:** one `platform.test.ts` run went out without my env exported. It truncated the default `kkt_api_test` database and flushed Redis db 1. Anyone using those defaults should reseed.

### What other tracks and the integration stage need to do
- **Deploy track:**
  - Add `src/cli/restore.ts` to the `tsup` entries.
  - Pass `app` to `startWorker` in `server.ts`. Today it falls back to the bound app, which works.
  - Add `PARTITIONING_ENABLED`, `JOB_BACKOFF_MS` and `DEPLOY_ID` to `config.ts`, `.env.example` and `docs/DEPLOY.md`.
  - Add `X-Export-Total`, `X-Export-Rows`, `X-Export-Truncated` and `X-Export-Next-Cursor` to CORS `exposedHeaders`.
  - Storage: `storeFile` uses the driver's `putFile(key, path, type)` or `putStream(key, readable, type)` when it has one, otherwise it reads the whole file into memory. The S3 adapter should implement one of them.
  - `docs/RESTORE.md` (theirs) already matches the CLI.
- **Frontend contracts (all in `contracts/modules/admin.ts`):**

| Endpoint | Request | Response |
|---|---|---|
| `POST /exports` | `ExportCreateRequestSchema` `{path: "/api/v1/…", query: Record<string, string\|number\|boolean\|string[]>}` | 202 `ExportRowSchema` `{id, path, query, status, row_count, file_name, error, created_at, finished_at, expires_at}` |
| `GET /exports` | `ExportFilterSchema` (`status`) | list envelope of export rows |
| `GET /exports/:id` | — | export row |
| `POST /exports/:id/link` | — | `{download_url, expires_at, file_name, row_count}` |
| `POST /admin/backup` | `{include_sensitive}` | 202 `AdminBackupRowSchema` `{id, status, file_name, size_bytes, generated_at, finished_at, storage_expires_at, include_sensitive, table_count, row_count, generated_by, error, run_id}` |
| `GET /admin/backups` | — | `{items: AdminBackupRow[]}` |
| `POST /admin/backups/:id/link` | — | `{download_url, expires_at, file_name, size_bytes}` |
| `GET /admin/jobs` | — | each job adds `schedule_enabled, last_success, failure_count_24h, failures_since_success, next_run_at` |
| `POST /admin/jobs/:name/run` | — | 202 `AdminJobEnqueuedResponseSchema` |

  - Export query keys `page`, `page_size`, `cursor`, `limit`, `format` and `exact` are reserved (400).
  - Link endpoints return 409 `EXPORT_NOT_READY` before the export or backup is DONE.
  - The new bell types are `JOB_FAILED` (link `/admin/jobs`) and `EXPORT_READY` (link `/exports` or `/admin/backups`).
- **ERP fixes:**
  - Send a version on the construction-photo toggle and the plan-assignment edit, then empty `VERSION_POLICY_EXEMPT`.
  - Fix `CoApplicantsCard`: it sends no version, so that PATCH already fails today.
  - When a CSV response carries `X-Export-Truncated`, offer `POST /exports`.