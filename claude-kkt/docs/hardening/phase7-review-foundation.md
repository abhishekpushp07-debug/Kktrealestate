# Phase 7 review — FOUNDATION stage

Adversarial review of the foundation stage (docs/hardening/phase7-foundation.md): online migrations, migration 0005, privileges, error
mapping, contracts, required versions (C6), tenant resolution (C4). Diff reviewed: `git diff 34c075e` restricted to the foundation's
files (packages/db, apps/api/src/lib/{errors,pgErrors,version,tenant}.ts, apps/api/src/plugins/etag.ts,
packages/contracts/src/{errors,rules}.ts and their tests), plus the call sites they serve. Databases kkt_p7_rfoundation /
kkt_p7_rfoundation_acc, Redis 28 / 29.

## Verdict

The foundation mostly holds: every PATCH/DELETE route checks a real version, 428/409 shapes match C6, the error map covers the CHECK
constraints and class-22 errors, the rule registry is enforced by the compiler, privileges deny what they claim, the schema has no drift
(`drizzle-kit generate`: no changes) and the reported test counts reproduce. But the "online migrations" claim did not survive testing:
re-applying the trigger file and the online file locked the busiest tables, migration DDL waited for locks without any timeout,
partitioned tables were indexed with a blocking build, a full-table session backfill ran inside the migration transaction, and the slug
backfill could fail the unique build forever. Three smaller API defects (IN_USE count forced a sequential scan, 304 on writes, unbounded
tenant cache) were also real. All eight are fixed below, each with a test that fails on the old code.

## Defects found and fixed

1. **Re-running the trigger file locked five hot tables (SHARE lock behind writers).** `0001_triggers.sql` repeated the partial unique
   indexes as `CREATE UNIQUE INDEX IF NOT EXISTS …`. PostgreSQL takes the SHARE lock on the table _before_ it notices the index exists,
   so each re-run (any checksum change, and every deploy that brings a new drizzle migration) queued behind open write transactions on
   bookings, demands, rate_cards, bank_accounts and construction_stages, and every write arriving meanwhile queued behind it — with
   `kkt_owner`'s `lock_timeout = 0`, indefinitely. Verified with psql (2 s lock timeout hit on an existing index). Fix: a DO block that
   creates only indexes `to_regclass()` does not find.
2. **Re-running the online file took ACCESS EXCLUSIVE on ledger_entries.** The ledger swap ended with an unguarded
   `ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS …` (lock first, look later — blocks reads too), and the partitioned branch
   re-ran `CREATE INDEX IF NOT EXISTS`, `DROP INDEX IF EXISTS`, `DROP TRIGGER` + `CREATE TRIGGER` on every re-apply. Fix: every ALTER /
   DROP / CREATE TRIGGER is guarded by a `pg_constraint` / `pg_trigger` lookup; the partitioned branch only replaces the trigger function
   (no lock) and creates the trigger when missing, keeping the plain `(booking_id, seq)` index the partitioning made (it serves the
   trigger's lookup) instead of building a new index over every partition with a blocking build.
3. **Migration DDL had no lock timeout.** `runMigrations` opened its pool with `timeouts: false` and the migrate role has
   `lock_timeout = 0`, so an `ALTER TABLE` of the drizzle journal queued behind one long transaction would block every later reader and
   writer of that table until it got its lock — the classic online-migration outage. Fix (`packages/db/src/migrate.ts`):
   `MigrateOptions.lockTimeoutMs` (default 5 s) + `lockRetries` (default 8, backoff 0.5 s … 30 s) + `lockRetryDelayMs`; `withLockRetry`
   retries a step on 55P03. The drizzle journal (one transaction) runs with the lock timeout as a connection parameter and is retried
   whole; each `src/sql` file (one implicit transaction) and each non-CONCURRENTLY online statement run on one reserved connection under
   the timeout and are retried; `CREATE/DROP INDEX CONCURRENTLY` run with `lock_timeout = 0` (their waits block nobody). No new env var:
   the defaults suit the migrate job; callers can pass options.
4. **Indexes on partitioned tables were built with a blocking `CREATE INDEX`.** The runner stripped `CONCURRENTLY` on a partitioned
   table, i.e. a SHARE lock on every partition of ledger_entries / audit_logs for the whole build. Fix: the PostgreSQL-documented online
   procedure — `CREATE INDEX … ON ONLY parent` (catalog only), then per partition `CREATE INDEX CONCURRENTLY` + `ALTER INDEX … ATTACH
PARTITION` (lock-timed and retried), recursing into sub-partitions; resumable (attached partitions are kept, an INVALID partition
   index is dropped and rebuilt, a valid parent is left alone). New action `applied-per-partition` with `partitionIndexes`; partition
   index names are `<partition>_<index>`, hashed down to 63 bytes (`partitionIndexName`). UNIQUE on a partitioned table is still skipped.
5. **The refresh-token backfill rewrote the whole table inside the migration transaction.** `UPDATE refresh_tokens … FROM (SELECT
family_id, min(created_at) … GROUP BY family_id)` touched every session row and held their row locks until the drizzle transaction
   committed, stalling every sign-in and refresh (the app's 5 s lock timeout turns them into 409 LOCK_TIMEOUT) — against the stage's own
   rule "backfills of more than a few thousand rows run in batches outside the migration". Fix: the UPDATE left
   `drizzle/0005_online_foundation.sql` (phase 7 is unreleased, so no deployed database has it; on test databases the changed hash only
   re-applies the idempotent `src/sql` files once) and moved to `src/sql/online/0005_indexes.sql` as a DO block that walks families in
   uuid order, 2,000 per batch, `COMMIT` after each batch (transaction control in a top-level DO block). Re-runs only touch rows that
   still differ.
6. **The slug backfill could make the unique build fail on every deploy.** Numbering equal slugs gives `acme`, `acme-2`; a company named
   "Acme 2" also slugifies to `acme-2`, so `CREATE UNIQUE INDEX CONCURRENTLY companies_slug_uq` failed (leaving an INVALID index, dropped
   and failed again next deploy). Fix: a DO block before the unique build gives any remaining duplicate the next free suffix
   (`acme-2-2`), in creation order; a no-op once the index exists.
7. **IN_USE usage counts forced a sequential scan.** `withUsageCount` compared `<fk column>::text = $key`, which no index can serve, so
   every refused delete of a referenced row (e.g. a role used by thousands of users, a flat type used by every flat) scanned the whole
   referencing table — on the error path, with the request's statement timeout. Fix: the key is cast to the column's own type
   (`format_type`, validated) so the FK index of migration 0005 serves it, and the count stops at `USAGE_COUNT_CAP` = 10,000.
8. **The body-hash ETag answered 304 to writes.** `plugins/etag.ts` short-circuited any 200 whose body hash matched `If-None-Match`,
   POST/PATCH included: a write that had already run returned no body. Fix: only GET/HEAD are answered 304 (RFC 9110 §13.1.2).
9. **The tenant cache grew without bound.** `lib/tenant.ts` cached every slug / Host lookup, misses included, in a Map that was never
   pruned; slugs (`x-kkt-company`) and hosts come from unauthenticated requests, so random names grew process memory for the life of the
   process. Fix: at most `TENANT_CACHE_MAX_ENTRIES` = 1,000 entries, oldest evicted (a refresh re-inserts); `tenantCacheSize()` for tests.

## Tests added (each fails on the pre-fix code; verified by swapping the old file in)

`packages/db/test/online.test.ts` (29 tests, was 22):

- "re-applying the trigger file and the online file while writers hold the busiest tables takes no blocking lock" — a second connection
  holds ROW EXCLUSIVE on bookings, demands, rate_cards, bank_accounts, construction_stages, companies, ledger_entries, payments; both files
  are re-applied with `lockTimeoutMs: 500, lockRetries: 0`. Old 0001 → 55P03; old online file → 55P03; new → applied.
- "a blocking statement gives up after lock_timeout … (55P03 without retries)" and "…is retried with backoff until the lock is free"
  (log line `retry 1/10`, `lockRetries ≥ 1`).
- "CREATE INDEX CONCURRENTLY is never cut off by the lock timeout" (open writer, 100 ms lock timeout, build succeeds).
- partitioned table: "builds the index online partition by partition (ON ONLY + CONCURRENTLY + ATTACH)" (parent and both partition indexes
  valid and attached, re-run builds nothing, a new partition inherits the index); "an interrupted partition-wise build resumes";
  "long partition index names stay within 63 bytes and stable".
- upgrade from 0004: a company named "Shree Ganesh Builders 2" next to two "Shree Ganesh Builders" (→ `…-2-2`), and 4,500 extra
  two-token families (three backfill batches): every row's `family_started_at` = its family's first `created_at`.

`apps/api/test/integration/foundation-review.test.ts` (new, 4 tests): IN_USE count SQL casts the key (`CAST($1 AS uuid)`, no `::text`,
`LIMIT 10000`) and its plan reaches users.role_id through an index; If-None-Match gives 304 on GET but the POST returns 200 with its body;
1,200 unknown slugs/hosts keep the tenant cache ≤ 1,000 and a real slug still resolves; an unknown `x-kkt-company` stays 400
COMPANY_REQUIRED.

## Checked and found sound (no change)

- Every staff PATCH (24 routes) and DELETE (8 routes) handler compares a real stored version (`applyUpdate` / `assertVersion`);
  `optionalExpectedVersion` survives only in portal `PATCH /profile` (documented exemption). Auth runs in `onRequest`, so 401/403 come
  before 428.
- `requestVersion` precedence (body `version` → `expected_version` → If-Match), `parseIfMatch` forms, 428 / 409 `current_version`
  shapes; idempotent replays are sent as objects, so they carry `ETag: "v<n>"` too.
- `bump_version` does not double-bump `applyUpdate` writes; `line_version` is checked under `FOR UPDATE`.
- Error map: 23514/23503/23505/23502/class 22 through real queries; domain `DateError` / `NumberingError` / `ISTError` cannot be reached
  from validated input (contracts use `z.iso.date()` and constrained numbering patterns); `LedgerError` is an invariant breach and
  correctly a 500.
- Privileges: no API code UPDATEs/DELETEs the append-only books; GRANT/REVOKE take no table lock (measured).
- Rule registry, `ApiError.invalid` sites, `BucketCapDetailsSchema` against the real 409, `drizzle-kit generate` → no schema changes,
  migration lint clean on the changed files.

## Remaining observations (not defects in this scope, or deliberate)

- Class-22 errors become 400 VALIDATION_ERROR and are logged at `info`; a class-22 raised by a server-side bug (e.g. a report dividing
  by zero) is then invisible in error dashboards. Consider `warn` for them.
- 23503 is classified (IN_USE vs missing reference) from PostgreSQL's English message/detail text; a server with non-English
  `lc_messages` would misclassify. Production images use the default English messages.
- Restrict-violation `23001` raised by the append-only / payment guard triggers stays a 500 on purpose (it means application code tried
  to rewrite the books).
- The single-company fallback is cached for 30 s: when a second company is added, configure `hosts` / send `x-kkt-company` first,
  otherwise unauthenticated requests resolve to the first company for up to 30 s and then answer 400 COMPANY_REQUIRED.
- `migrateHandle` with a caller-supplied handle (packages/db `reset`) runs the drizzle journal under the handle's own lock timeout; the
  production paths (`runMigrations`: migrate job, server boot, restore, seed CLI) all get it.

## Cross-track items (outside the files this review may edit)

1. `apps/api/src/app.ts` (platform/security) — CORS still has `credentials: false` and `allowedHeaders` without `X-KKT-Session` and
   `x-kkt-company` (listed as pending in phase7-security.md item 1): cross-origin ERP/portal cookie sessions (C1) and the tenant header
   (C4) cannot work from a browser on another origin until `credentials: true` and both headers are added.
2. `apps/api/src/modules/service/notices.ts` `DELETE /notices/:id` — the route summary still says "(If-Match optional)" while the
   version is required (428 without); change the summary to "(version required: If-Match or body version)" and regenerate OpenAPI in the
   verify stage.

## Contract shapes (unchanged for clients except as noted)

- `IN_USE` from a database foreign key: `details.usage_count` is now at most 10,000 ("at least" beyond that); other fields unchanged.
- Body-hash ETags: `If-None-Match` is honoured on GET/HEAD only.
- packages/db exports: `withLockRetry`, `partitionIndexName`, `DEFAULT_MIGRATION_LOCK_TIMEOUT_MS`, `DEFAULT_MIGRATION_LOCK_RETRIES`,
  types `OnlineSqlOptions`, `LockRetryOptions`; `MigrateOptions` gains `lockTimeoutMs`, `lockRetries`, `lockRetryDelayMs`;
  `applyOnlineSql(sql, text, options?)`; `OnlineStatementResult.action` is `applied | applied-per-partition |
skipped-unique-on-partitioned` (`applied-without-concurrently` is gone) with optional `partitionIndexes`, `lockRetries`.
- apps/api `lib/tenant.ts` exports `TENANT_CACHE_MAX_ENTRIES`, `tenantCacheSize()`; `lib/pgErrors.ts` exports `USAGE_COUNT_CAP`.

## Files changed

- packages/db/src/migrate.ts, packages/db/src/index.ts
- packages/db/src/sql/0001_triggers.sql, packages/db/src/sql/online/0005_indexes.sql, packages/db/drizzle/0005_online_foundation.sql
- packages/db/test/online.test.ts, packages/db/partitions/README.md
- apps/api/src/lib/pgErrors.ts, apps/api/src/lib/tenant.ts, apps/api/src/plugins/etag.ts
- apps/api/test/integration/foundation-review.test.ts (new)
- docs/DATA-MODEL.md (§J lock timeouts, partitioned builds, guarded re-runs; refresh-token backfill; IN_USE cap),
  docs/API-CONVENTIONS.md (304 on GET/HEAD only; tenant cache bound)

## Suites (databases kkt_p7_rfoundation / kkt_p7_rfoundation_acc, Redis 28 / 29)

| Suite                                                                                                    | Result                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (all 7 packages)                                                                        | green                                                                                                                                                                 |
| ESLint `--max-warnings 0` (packages/db; apps/api lib, plugins, new test); Prettier on every touched file | clean                                                                                                                                                                 |
| `node scripts/ci/lint-migrations.mjs` on the changed migration files; `scripts/ci/ci-scripts.test.mjs`   | 0 problems; pass                                                                                                                                                      |
| `drizzle-kit generate`                                                                                   | no schema changes                                                                                                                                                     |
| packages/db (kkt_p7_rfoundation_acc)                                                                     | 100/100 (online.test.ts 29)                                                                                                                                           |
| packages/contracts / packages/domain                                                                     | 244/244 / 139/139                                                                                                                                                     |
| apps/api unit                                                                                            | 172/172 in 27 files                                                                                                                                                   |
| apps/api integration, full, `--no-file-parallelism` (kkt_p7_rfoundation, Redis 28)                       | 762/762 in 61 files (baseline before the fixes, same checkout: 752/752 in 59 files; the difference is this review's file and one added concurrently by another track) |
| apps/api acceptance (kkt_p7_rfoundation_acc, Redis 29)                                                   | 55/55 in 13 files                                                                                                                                                     |
