# H7 cross-track fixes: report

All eight numbered fixes are done, and item 9 fixed the API/packages defects listed below; each change has a test. Every run passes:

| Suite                                                              | Result                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Root `pnpm typecheck`                                              | all 7 packages green (contracts, domain, db, api, erp, web, portal) |
| API unit                                                           | 114/114 (19 files)                                                  |
| Contracts                                                          | 183/183                                                             |
| Domain                                                             | 130/130                                                             |
| DB (own scratch database `kkt_h7_db`, dropped afterwards)          | 70/70                                                               |
| Full API integration (`kkt_h7`, Redis 23, `--no-file-parallelism`) | 588/588 (46 files)                                                  |
| Acceptance (`kkt_h7_acc`, Redis 24)                                | 55/55                                                               |

ESLint on my files: no errors; one existing module-boundaries warning in `reports/common.ts`. Nothing is committed. Paths are under `/home/user/Kktrealestate/claude-kkt`.

## Changes by item

**1. First boot**

- New `apps/api/src/seed/firstBoot.ts`; `server.ts` rewired.
- If the database has no company, the single process, the cluster primary and `server.ts migrate` always run `ensureBootstrap`, whatever `SEED_ON_BOOT` says. Production uses `BOOTSTRAP_*` and refuses to start without them (exit 1, nothing written).
- With `SEED_ON_BOOT=true` the bootstrap also runs when a company exists; it is idempotent and re-syncs the system roles.
- The demo dataset, and the demo logins in production, are created only when `SEED_ON_BOOT` and `SEED_DEMO` are both true.
- The primary and the migrate job check with a 2-connection pool and build a full app only for the demo seed. The in-process job worker now gets the app (`startWorker({ app })`).
- The procedure is in the new "First boot" section of `docs/DEPLOY.md`.

**2. One-time secrets are never stored by the idempotency store**

- New route option `oneTimeSecrets` (`lib/routes.ts`). The plugin stores those fields as `"[redacted]"` in both the Postgres row and the Redis copy. A replay returns 409 `IDEMPOTENT_SECRET_REPLAY` with the redacted original in `details`.
- Declared on `POST /users` (`temp_password`), `POST /site-visits` (`manage_url`), `POST /public/site-visits` (`manage_url`, `ics_url`) and `POST /public/site-visits/:token/reschedule` (`manage_url`, `manage_token`, `ics_url`).
- If a response carried no secret this time (e.g. `POST /users` with a password given), it is stored and replayed normally.
- Portal enable/reset, bulk enable and `POST /users/:id/reset-password` are not idempotent at all, so a key there stores nothing; a test confirms this.
- The route registry now records idempotency facts, and a test fails if an idempotent route returns a secret-looking field it has not declared.
- New error code `IDEMPOTENT_SECRET_REPLAY` (409), appended to `ERROR_CODES` and `ERROR_STATUS`.

**3. API docs exposure**

- New config `DOCS_PUBLIC`: default false in production, true elsewhere.
- When false, `/api/v1/openapi.json` and everything under `/api/v1/docs*` need a staff token with `admin.tools`: anonymous gets 401, other staff 403. The document is then served `private, no-store`.

**4. Observability**

- `runJob` calls `recordJobRun` for every OK and FAILED attempt.
- Every log line now carries `trace_id` and `span_id` through a pino mixin in `lib/logger.ts`, including module-level and job loggers. I removed the old per-request binding in `app.ts` so lines don't get duplicate keys.
- New job status `ABANDONED` (migration `0003_job_run_abandoned.sql`, journal and snapshot) and new job `JOB_RUN_SWEEP`, scheduled every 15 minutes.
  - Each job has a time budget (`JOB_TIMEOUT_MS`): 5 min for hold expiry, 1 h for the dues/integrity/reconciliation jobs, 2 h for backups, re-encryption and the ledger rebuild, 30 min otherwise.
  - A run still RUNNING after twice its budget is marked ABANDONED.
  - Admin job stats and `kkt_job_failures_24h` count ABANDONED as a failure.
- The boot-job lock key is `DEPLOY_ID`, else `GIT_SHA`, else the process start time; both variables were added to config.

**5. Redis outage latency**

- `cached()` gives Redis 150 ms, skips a client it knows is disconnected, and skips the cache write after a slow read.
- The auth path, rate limit, idempotency fast path and public cache-version read also skip a disconnected client immediately.
- The Redis clients get `commandTimeout` from a new `REDIS_COMMAND_TIMEOUT_MS` (default 2000).
- Measured with Redis on a dead port: `/auth/me`, a cached public list and a staff list each answer in under 300 ms.

**6. Report exports**

- `reportPaging` now links back to `req.query`, so the cheques and activity reports (audit rows, logins, failed logins) send the `X-Export-*` headers and work with the async export.
- CSV caps are adjustable for tests (`csvExportLimits`). CORS now exposes the four `X-Export-*` headers and `Content-Disposition`.

**7. `LEDGER_REBUILD`**

- New admin job (`money/services/ledgerRebuild.ts`). It works in batches and each booking runs in its own retrying transaction.
- It rewrites only ledgers that differ from the canonical rebuild, writes an audit row `booking.ledger_rebuilt` per rewrite, and supports `dry_run`.
- Its result separates `order_changed` from `figures_changed`. A second run does nothing.
- The demo seed runs it before validating. On a fresh seed it checked 10 bookings, rebuilt 0, and the integrity report showed zero findings.

**8. Integrity snapshot**

- `checkBooking` now runs per booking in one REPEATABLE READ, READ ONLY transaction (`onSnapshot`). The startup reconciliation uses the same snapshot.
- The test injects a real payment between the reads. Without the snapshot this produces a mismatch (the test's control case); with it the report stays clean.

**9. Other defects fixed**

- The restore CLI now ships in the bundle as `dist/cli/restore.js`; I built it and ran `--help`.
- The standalone worker checks storage at startup, like the API.
- Account lockouts use a new `SECURITY_ALERT` bell type instead of `INTEGRITY_FINDINGS`.
- Plain socket errors (which can come from Redis too) now say "A backing service is unavailable" with `reason: dependency_unavailable`, instead of blaming the database.
- The migration-lock test in `packages/db` now only counts advisory locks in its own database; it failed whenever other suites were running.

**Docs updated:** `DEPLOY.md`, `API-CONVENTIONS.md`, `SECURITY.md`, `OBSERVABILITY.md`, `DATA-MODEL.md`, `SEED.md`, `TODO-integration.md` (new item 14), and `.env.example`.

## Tests added or updated

- New integration files: `first-boot.test.ts` (6, including an end-to-end `server.ts migrate` in production mode on a scratch database), `cross-track.test.ts` (10), `cross-track-money.test.ts` (5).
- New unit files: `cache.test.ts` (4), `logger-trace.test.ts` (3).
- Updated: `visits.test.ts` (the replay is now 409), `security-hardening.test.ts` (`SECURITY_ALERT`), `config.test.ts`, `jobs.test.ts`, contracts `adversarial.test.ts`, and db `migrate.test.ts` / `hardening.test.ts` for migration 0003.

## Decisions and deviations

- **Redis offline queue (item 5):** I kept it on and did not set `enableOfflineQueue=false`. Some writes run after a commit with no fallback (cache invalidation, permission-version bump). With the queue off, a sub-second Redis reconnect would turn those into 500s after the data was already saved. Fast failure comes from skipping disconnected clients plus the time budgets and `commandTimeout` instead. The <300 ms test passes.
- **Brochure download link:** `POST /public/brochure-requests` → `download_url` is deliberately not treated as a secret. It is a 15-minute signed link to public marketing material, and replaying it to the same visitor is the point of the key. It is allow-listed in the registry test.
- **Swagger UI in production:** a browser cannot send a bearer token, so the UI only works there with `DOCS_PUBLIC=true`. The JSON document works with a token.
- **`docs/DEPLOY.md`:** if an API replica starts before the migrate job has bootstrapped the database, it now refuses to start and the orchestrator restarts it until the migrate job is done.

## Not finished, and decisions for the owner

- **Infra (outside my paths):**
  - Grant `kkt_app` read access to `drizzle.__drizzle_migrations` in `infra/postgres/init/01-roles.sql`.
  - Set `DEPLOY_ID` from the deploy pipeline.
  - Set `DOCS_PUBLIC` in Compose/k8s if browsable docs are wanted.
- **Not fixed:**
  - The worker has no health/heartbeat port.
  - `PARTITIONING_ENABLED`, `JOB_BACKOFF_MS`, `PDF_WORKER_*` and `SHUTDOWN_*` are still read straight from the environment, not from config.
  - Hindi (Devanagari) text in PDFs needs a Noto font package install.
  - The bookings list payload is still close to its 25 KB target.
  - The dependency metrics query load per replica is unchanged.
- **Product decisions:**
  - Erasing a customer does not scrub ticket text or audit snapshots.
  - A MANUAL other-charge line that was never demanded does not block handover.
  - The in-flight login guard is per process.
  - Idempotency takeover after 60 s can run a still-alive slow request twice.
  - Backups of `idempotency_keys` and `job_runs` are not tenant-scoped (fine while single-company).

## For the frontend agent and the integration stage

- **409 `IDEMPOTENT_SECRET_REPLAY`**, with header `Idempotent-Replayed: true` and body `{error:{code, message, details:{original_status, redacted_fields:[...], original:{...first response with "[redacted]" values}}}}`.
  - ERP, retried `POST /users`: show "User created — reset the password for a new temporary password" and open `details.original.id`.
  - Website, retried `POST /public/site-visits` or `/reschedule`: show the confirmation from `details.original` (visit_number, date, slot) without the manage link.
- **New enum values:**
  - Job run status `ABANDONED` (label "Abandoned"); filter with `GET /admin/jobs/runs?status=ABANDONED`.
  - Job names `JOB_RUN_SWEEP` and `LEDGER_REBUILD`.
    - Run-now: `POST /admin/jobs/LEDGER_REBUILD/run {data:{dry_run?:boolean, company_id?:uuid, batch_size?:number}}`.
    - The run result is `{dry_run, batches, bookings_checked, bookings_rebuilt, order_changed_count, figures_changed_count, order_changed:[{booking_id, booking_number, first_position, fields}], figures_changed:[…]}`.
  - Notification type `SECURITY_ALERT` (staff bell; entity `user` or `portal_user`).
- **Docs access:** in production, `GET /api/v1/openapi.json` and `/api/v1/docs/*` return 401/403 unless `DOCS_PUBLIC=true` or the caller has a staff token with `admin.tools`.
- **Exports:** CORS now exposes the `X-Export-*` headers. "Export all" can use `POST /exports {path:"/api/v1/reports/cheques"|"/api/v1/reports/activity", query:{…}}`.
- **New env vars** (in `config.ts`, `.env.example` and `DEPLOY.md`): `DOCS_PUBLIC`, `DEPLOY_ID`, `GIT_SHA`, `REDIS_COMMAND_TIMEOUT_MS`.
- **Restore CLI:** `node dist/cli/restore.js` is now in the bundle.
- **Not mine:** `docs/qa/web/browser-qa.cjs` shows as modified in the working tree.
