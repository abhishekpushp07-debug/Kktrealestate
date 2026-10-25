# FOUNDATION track report (resumed from WIP checkpoint 9d255a8)

The foundation work is finished and every verification the task asked for passes. Most of it was already in the checkpoint, and I kept it after checking it. This session wrote the docs and `.env.example`, ran all the verifications, re-applied migration 0002 to a seeded database, and fixed one acceptance-test assertion that was already wrong. All paths below are under /home/user/Kktrealestate/claude-kkt. Nothing new is committed: this session's edits are still in the working tree.

## Changes (file list)
**From the checkpoint, reviewed and kept:**
- **Config:** `apps/api/src/config.ts`.
- **Error-code renames:** `apps/api/src/modules/documents/service.ts` (UNSUPPORTED_MEDIA becomes UNSUPPORTED_MEDIA_TYPE) and `apps/api/src/modules/money/services/roznamcha.ts` (INSUFFICIENT_CASH becomes CASH_INSUFFICIENT).
- **Client IP:** `apps/api/src/lib/rateLimit.ts`. `clientIp()` now just returns Fastify's proxy-aware `req.ip`.
- **Users search:** `apps/api/src/modules/users/index.ts` searches `email::text` so the email trigram index is used.
- **Portal error type:** `apps/portal/src/api/client.ts`. `ClientErrorCode` now also accepts unknown codes.
- **Contracts:** `packages/contracts/src/errors.ts` and `packages/contracts/test/registry.test.ts`, plus a small addition in `packages/contracts/src/enums.ts`.
- **packages/db:**
  - `src/client.ts`, `src/migrate.ts`, `src/index.ts`, `src/reset.ts`
  - schema files: `_common.ts`, `bookings.ts`, `customers.ts`, `enums.ts`, `identity.ts`, `inventory.ts`, `leads.ts`, `misc.ts`, `money.ts`, `service.ts`
  - `drizzle/0002_foundation_hardening.sql`, `drizzle/meta/0002_snapshot.json`, `drizzle/meta/_journal.json`
  - tests: `test/hardening.test.ts`, `test/data-model.test.ts`, `test/migrate.test.ts`
- **Lint setup:** `eslint.config.mjs`, `.prettierignore`, root `package.json`, and a `"lint": "eslint ."` script in every package's `package.json`.
- **Tests:** `apps/api/test/unit/config.test.ts`, `apps/api/test/unit/error-registry.test.ts`, and updated expectations in the integration tests `documents.test.ts`, `money.test.ts` and `web-adversarial.test.ts`.

**This session:**
- `.env.example`: every new variable, plus a note about the `_FILE` form.
- `docs/DEPLOY.md`: new environment tables (required in production, production defaults, `_FILE` secrets, first boot, network and storage, DB/Redis limits, key rotation, observability) and a note on the migration lock.
- `docs/DATA-MODEL.md`: the new columns, constraints and indexes on each table, the `exports` table, invariants 7 and 8, and a new section "I. Search and list indexes".
- `docs/API-CONVENTIONS.md`: the error registry and how clients parse unknown codes.
- `docs/SECURITY.md`: how the client IP and `TRUST_PROXY` work.
- `apps/api/test/acceptance/09-stage-jump-undo-integrity.test.ts`: this test was failing before my changes. The route returns `{count}` (as SPEC Appendix C says) but the test read `.unread`. I changed the test to read `count`.

## Tests and results
- **Typecheck** passes for contracts, db, domain, api, erp, web and portal.
- **Contracts tests:** 183/183 pass.
- **packages/db tests** (against kkt_h0): 69/69 pass. `hardening.test.ts` covers:
  - every CHECK constraint and both partial unique indexes
  - the new columns
  - trigram indexes exist for every searched column, and the planner uses them
  - the backfills
  - three concurrent `runMigrations` calls running one after another
  - the connection timeouts
  - `withTransactionRetry`: a real deadlock is retried, 40001 retries back off, any other error is never retried
- **API unit tests:** 42/42 pass. This includes `config.test.ts` (trust-proxy parsing, production requirements, `_FILE`, S3, bootstrap, key rings) and `error-registry.test.ts`.
- **Integration** (kkt_h0, Redis 21): seed, central, money, crm, conventions, security and masters: 115/115 pass. I also ran documents, web-adversarial, auth and idempotency, since the checkpoint touched them: 59/59 pass.
- **Acceptance** (kkt_h0_acc, Redis 21): 54/55 on the first run. The one failure was the scenario 9 test mismatch above; after the fix, scenario 9 passes 6/6.
- **Migration on real data:**
  1. Seeded kkt_h0 with `pnpm --filter @kkt/api seed`: 10 bookings, 58 demands, 12 customers.
  2. Rolled 0002 back by hand and removed its journal row.
  3. Re-ran `pnpm --filter @kkt/db migrate`.

  Every CHECK constraint validated on the seeded data. `list_price_paise` was backfilled on 10 of 10 bookings, each matching `flat_snapshot.price_paise`. `manage_token_expires_at` was backfilled on 10 of 10 visits. A second migrate run does nothing. Migrating an empty database is covered by `migrate.test.ts`.
- **Schema drift:** `drizzle-kit generate` reports "No schema changes".

## ESLint counts (errors / warnings)
I did not fix any lint findings, as the task says.

| Package | Errors | Warnings | Main rules |
|---|---|---|---|
| contracts, domain, db | 0 | 0 | — |
| api | 12 | 42 | all 42 warnings are `kkt/module-boundaries`; errors: no-unused-vars 7, no-useless-assignment 4, preserve-caught-error 1 |
| erp | 68 | 9 | react-hooks/set-state-in-effect 51, incompatible-library 7, refs 5, purity 4, plus a few others |
| web | 16 | 0 | set-state-in-effect 7, preserve-manual-memoization 2, `@next/next/no-img-element` 2, others |
| portal | 25 | 0 | react-hooks/immutability 11, refs 10, others |

The two `@next/next/no-img-element` errors come from eslint-disable comments that name a Next.js lint rule; the Next ESLint plugin isn't loaded, so ESLint reports them as unknown rules. The verify stage should either remove those comments or add the plugin, which would need a package install.

## What the tracks can rely on
**New environment variables** (validated in `apps/api/src/config.ts`):
- **Production defaults:** `SEED_ON_BOOT`, `SEED_DEMO`, `RUN_JOBS_IN_API` default to false and `API_WORKERS` to `"auto"` (parsed as 0). Outside production they default to true, true, true and 1.
- **First boot:** `BOOTSTRAP_COMPANY_NAME`, plus `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`. The email and password must be set together; the password needs at least 12 characters.
- **`TRUST_PROXY`** parses to `boolean | string[]` (default `["loopback"]`) and is passed to Fastify's `trustProxy`. An unknown entry stops the boot.
- **DB limits:** `DB_STATEMENT_TIMEOUT_MS=15000`, `DB_LOCK_TIMEOUT_MS=5000`, `DB_IDLE_IN_TX_TIMEOUT_MS=30000`, `DB_CONNECT_TIMEOUT_S=10`.
- **Redis:** `REDIS_SECURITY_URL` is optional.
- **Observability:**
  - `METRICS_TOKEN` (at least 16 characters)
  - `METRICS_PORT` (default 9464)
  - `OTEL_EXPORTER_OTLP_ENDPOINT` (a URL)
  - `OTEL_SERVICE_NAME` (default kkt-api)
  - `ERROR_WEBHOOK_URL` (a URL)
  - `INTERNAL_API_TOKEN` (at least 32 characters)
- **Key rotation:**
  - `JWT_PREVIOUS_SECRETS` parses to `string[]`, each at least 32 characters.
  - `FIELD_ENCRYPTION_KEYS` parses to `{kid, secret}[]`.
  - The derived `config.FIELD_KEY_RING` lists the active key first, and `FIELD_ENCRYPTION_KEY` is always key `k1`.
- **Production requirements:** `DATABASE_URL` and `REDIS_URL` are required. `STORAGE_DRIVER=s3` requires `S3_BUCKET` and `S3_REGION`; the S3 keys are optional but must be set as a pair.
- **`_FILE` secrets:** the list is exported as `SECRET_FILE_VARS`. Setting both `NAME` and `NAME_FILE` is an error.
- **For tests:** `loadConfig(env, { readFile })` is exported.

**`@kkt/db` exports:**
- `withTransactionRetry<T>(db: DB, fn: (tx: Tx, attempt: number) => Promise<T>, opts?: { retries?=3; baseDelayMs?=25; maxDelayMs?=1000; isolationLevel?; onRetry?; sleep? }): Promise<T>`. It retries only on 40001/40P01, using full-jitter backoff, and finds the code through Drizzle's `cause` wrappers. Because `fn` can run more than once, do any side effects outside the database (queues, Redis, notifications) after it resolves.
- `retryableTransactionError(err)`
- `RETRYABLE_TRANSACTION_SQLSTATES`
- `withSessionAdvisoryLock(handle, key, fn)`. The pool must have at least 2 connections.
- `dbTimeoutsFromEnv()`
- `DEFAULT_DB_TIMEOUTS`
- `createDb(url, { max, timeouts?: Partial<DbTimeouts> | false, idleTimeout, prepare })`
- `migrateHandle(handle)`
- `MIGRATION_LOCK_KEY = "kkt:migrate"`

**New columns:**
- `bookings.list_price_paise bigint NULL` (backfilled), `bookings.price_deviation_reason text`, `bookings.price_deviation_by uuid`
- `site_visits.manage_token_expires_at timestamptz` (backfilled to slot end + 1 day IST)
- `customers.kyc_submitted_by uuid`, `customers.kyc_submitted_at timestamptz`
- `version int NOT NULL DEFAULT 1` on `co_applicants` and `booking_drafts`
- a new table `exports`: id, company_id, user_id (cascades on user delete), path, query jsonb, status `export_status` (QUEUED/RUNNING/DONE/FAILED, default QUEUED), row_count, storage_key, error, created_at, finished_at, expires_at

**Constraint names:**
- `bookings_agreement_split_chk`, `bookings_agreed_nonneg_chk`, `bookings_list_price_nonneg_chk`
- `demands_split_chk`, `demands_amounts_nonneg_chk`
- `booking_other_charges_total_chk`, `booking_other_charges_nonneg_chk`
- `flats_price_nonneg_chk`, `parking_slots_price_nonneg_chk`
- `exports_row_count_nonneg_chk`

**Unique indexes:**
- `payments_company_idempotency_key_uq`
- `customers_company_phone_live_uq` (WHERE erased_at IS NULL)
- `customers_company_pan_hash_live_uq` (WHERE erased_at IS NULL AND pan_hash IS NOT NULL)

These match `assertNoDuplicate`. A race the application check misses now fails with a Postgres unique violation (23505).

**Other indexes:**
- `flats_hold_until_idx`
- `(company_id, sort DESC, id DESC)` indexes for the default sort of bookings, customers, leads, enquiries, service_requests, audit_logs, payments, demands and site_visits
- trigram indexes named `<table>_<col>_trgm_idx`

**Error codes:**
- `ApiErrorSchema.error.code` now accepts any UPPER_SNAKE string. `ErrorCode` is still the documented union, and `isKnownErrorCode()` is exported.
- 19 codes were added: METHOD_NOT_ALLOWED, CONFLICT, NOT_IMPLEMENTED, SUPER_ADMIN_ONLY, PUBLISH_REQUIREMENTS, DUPLICATE_CUSTOMER, DUPLICATE_LEAD, DUPLICATE_PRESET, HAS_ACTIVE_BOOKING, JOB_ALREADY_RUNNING, ALREADY_DEMANDED, PARKING_NOT_AVAILABLE, PAYMENT_NOT_CLEARED, PAYMENT_NOT_PENDING, REGENERATE_BLOCKED, UNDO_NOT_LATEST, TICKET_CLOSED, REOPEN_WINDOW_CLOSED, ALREADY_RATED.
- Tracks adding codes must append them to `ERROR_CODES` and `ERROR_STATUS`; the registry test fails otherwise.

## Decisions and deviations
- **Migration layout:** the `pg_trgm` extension and the two backfills are hand-written lines inside the drizzle migration 0002, not a separate `src/sql/0002_*.sql` file. They only need to run once. `migrate.ts` also runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` before the drizzle migrations, so it stays idempotent.
- **Migration 0002 also replaces three existing indexes:** it drops `ledger_entries_booking_seq_idx` and rebuilds `audit_logs_company_created_idx` and `payments_company_date_idx` with `id DESC` added as a tie-breaker. Note: the index is dropped with no replacement; the task's later notes didn't cover it.
- **No trigram indexes on small tables:** I skipped them on master and CMS tables, and also on site_visits and enquiries, whose searches are small.
- **Migrations run without statement or lock timeouts** (`timeouts: false`). The advisory-lock wait has no limit, because another replica may be mid-migration.

## Not done; for the tracks and integration stage
- **Bootstrap (Track task 6):** `server.ts` and `seed/*` don't use `SEED_DEMO` or `BOOTSTRAP_*` yet. Until that lands, production with `SEED_ON_BOOT=true` would still run the demo seed.
- **Variables that are validated but not yet used by anything:** `REDIS_SECURITY_URL`, `METRICS_*`, `OTEL_*`, `ERROR_WEBHOOK_URL`, `INTERNAL_API_TOKEN`, `JWT_PREVIOUS_SECRETS` and `FIELD_KEY_RING`. The security and observability tracks need to wire them in.
- **Columns no code reads or writes yet:** the API doesn't use any of the new columns, and the `exports` table has no routes or worker yet.
- **Verify stage:** clear the lint findings, flip `kkt/module-boundaries` to `"error"`, and deal with the `@next/next` disable comments.
- **Frontends:** branch on `UNSUPPORTED_MEDIA_TYPE` and `CASH_INSUFFICIENT` (the old spellings are gone). Show the server's `message` for any code you don't recognise.