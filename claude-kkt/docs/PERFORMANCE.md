# KKT v2 — Performance

Targets (from the spec): 1,000 concurrent staff, list pages < 300 ms server time, ERP pages < 1.5 s, website settles < 2 s. Design headroom for 5 lakh concurrent public/portal readers is described in `ARCHITECTURE.md §6`.

Runs below are produced by `pnpm loadtest` (autocannon) against a locally seeded API on the build machine (4 vCPU shared with Postgres and Redis). Each run appends a table.

## How the numbers are produced

- Server: `pnpm --filter @kkt/api build`, then `node apps/api/dist/server.js` in `NODE_ENV=production` against a freshly migrated + seeded database (`kkt_load`, docs/SEED.md: 2 projects, 130 flats, 12 customers, 10 bookings, 316 payments). Logging at `warn`. `WRITE_RATE_LIMIT_PER_MIN` and `PUBLIC_RATE_LIMIT_PER_MIN` are raised for the run because one load generator looks like one user on one IP (they are deployment knobs; the limits themselves are untouched).
- Client: `apps/api/loadtest/run.ts` (autocannon) on the same box. Each scenario runs for 30 s at the stated connection count with no think time, so "1,000 connections" means a thousand clients each re-sending the moment a response arrives — far harsher than 1,000 logged-in staff. Between scenarios the runner waits until the server has drained the previous scenario's backlog, so each row measures only itself.
- Columns: autocannon's p50 / p97.5 / p99 and req/s; p95 is computed from every sampled response (autocannon's histogram object does not expose it). `non-2xx` counts failed statuses plus socket errors and 30 s timeouts; a `304` is a success in the `If-None-Match` scenario.
- The write scenario posts ₹100 `FLAT_VALUE`/`CASH` payments with a fresh `Idempotency-Key` per request to the one ACTIVE booking with the most cash headroom (so the bucket cap is never the reason a payment fails), at 50 connections.

## What profiling found (before tuning)

`--cpu-prof` on the single-process server plus in-process timing of the `GET /bookings` page (docs: `apps/api/loadtest/run.ts` run with `SCENARIOS` filters) showed no single hot function — the cost was structural:

| Finding                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                               | Fix                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every query was re-planned by Postgres.** Drizzle's postgres-js driver runs ad-hoc queries through `client.unsafe(query, params, { prepare: false })`.                                                                                                                                                                    | `EXPLAIN ANALYZE` of the five-join bookings page: _Planning 1.3 ms, Execution 0.3 ms_. The page query cost 3.07 ms through Drizzle vs 0.6 ms raw.      | `packages/db/src/client.ts` wraps the postgres.js client (root, transaction and savepoint scopes) so every parameterised query is a named prepared statement; postgres.js caches them per connection. `DATABASE_PREPARE=false` turns it off for PgBouncer < 1.21 in transaction mode. Page query 3.07 → 1.23 ms; `paginate()` 3.15 → 1.29 ms. |
| **A list page fanned out eight parallel "related" queries** (co-applicants, parking, revision counts, pending cheques, other charges, demands, tower stages, completer names), each taking a pool connection — a contention multiplier at 1,000 connections.                                                                | `loadBookingRelated` 2.98 ms per page; 8 of the 20 pool connections busy per request.                                                                  | One statement with eight JSON-aggregating scalar subqueries (`apps/api/src/modules/money/services/views.ts`, `recordFromJson` maps `to_jsonb(row)` back onto Drizzle record shapes). 2.98 → 1.66 ms and one connection. Output verified byte-identical before/after.                                                                          |
| **`GET /search` leaked queries.** Five parallel queries raced a 150 ms timer; on timeout the promise was abandoned but the queries kept running, so under load a 30 s search scenario left ~200k queued statements in the pool — the following scenario (payments, 1,000-connection baseline) completed 0 requests in 30 s. | `search: … exceeded 150 ms budget` warnings; `POST /payments` row of the first 1,000-connection run.                                                   | One `UNION ALL` statement per search (one connection, ordered branches, same per-type limits); on timeout the statement is **cancelled server-side** (`query.cancel()`, SQLSTATE 57014) and an empty result returned.                                                                                                                         |
| **`paginate()` asked `pg_class` for the table's row estimate on every list request** (three round trips per list).                                                                                                                                                                                                          | —                                                                                                                                                      | The estimate only decides exact vs estimated counting; it is cached per process for 60 s (`apps/api/src/lib/list.ts`).                                                                                                                                                                                                                        |
| **One Node process.** Fastify + Zod + Drizzle + postgres.js + JWT verify + Redis cost ≈ 0.7 ms of CPU per simple authenticated request, so a single process saturates at ~1.5k req/s on `GET /auth/me` regardless of the database.                                                                                          | `--cpu-prof`: 16 % socket writes, 19 % drizzle query building/mapping, 8 % GC; the Zod response serializer was only 0.46 ms for a 65 KB bookings page. | `API_WORKERS` (`node:cluster`, `apps/api/src/server.ts`): the primary runs migrations + seed once and forks N HTTP workers (`auto` = one per CPU); the in-process job worker runs in worker 0 only. Default stays `1` for dev/test.                                                                                                           |
| **Load shedding watched the wrong signal.** `@fastify/under-pressure` sheds on event-loop delay, but at 1,000 connections the loop was healthy while thousands of requests queued on the database pool (p99 16 s, 30 s timeouts).                                                                                           | 1,000-connection rows for `GET /bookings`.                                                                                                             | `API_MAX_INFLIGHT` (`apps/api/src/plugins/loadShed.ts`): a per-process cap on requests in flight; the excess gets `503 SERVICE_UNAVAILABLE` + `Retry-After: 2` at once, so admitted requests keep their latency. Off by default; the last table below shows it on.                                                                            |

Also fixed on the way: the production bundle did not start (`dist/` could not find `drizzle/meta/_journal.json`, the module loader looked in the wrong directory, and the admin reseed loader sniffed `src/seed/run.ts` by path). `tsup` now copies the migrations next to the bundle, `packages/db` resolves its folders in source, bundle and Docker layouts, and the loader finds `dist/modules/*/index.js`.

Not changed, and why: no new indexes were needed (every list filter/sort already has a matching compound index and the seeded tables are tiny — `EXPLAIN ANALYZE` execution times are 0.1–0.3 ms); the estimated-count path for > 10k rows already exists and cannot be exercised on seed data; booking/payment detail endpoints already page their ledgers; the dashboard was already cached in Redis for 15 s. The `ETag`/`If-None-Match` scenario shows that a 304 saves bandwidth but not server time — `@fastify/etag` hashes the body after the handler ran, and staff responses are `Cache-Control: no-store` for PII, so browsers do not revalidate anyway; the ERP relies on its 15 s client cache instead. A cheaper 304 would need a per-list version source (e.g. `max(updated_at)`) and is left as future work.

## Before / after (same box, same seed)

| Scenario                                 | 200 conns, before (1 proc)           | 200 conns, after (1 proc) | 200 conns, after (`API_WORKERS=auto`) | 1,000 conns, before (1 proc)                      | 1,000 conns, after (`API_WORKERS=auto`) |
| ---------------------------------------- | ------------------------------------ | ------------------------- | ------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| `GET /auth/me`                           | p95 178 ms · 1,445 rps               | p95 99 ms · 2,571 rps     | **p95 61 ms · 5,319 rps**             | p95 755 ms · 1,489 rps                            | **p95 238 ms · 6,031 rps**              |
| `GET /projects`                          | p95 483 ms · 449 rps                 | p95 277 ms · 1,022 rps    | **p95 102 ms · 2,703 rps**            | p95 2,893 ms · 458 rps                            | p95 493 ms · 2,820 rps                  |
| `GET /flats` (filtered, 50/page)         | p95 603 ms · 364 rps                 | p95 421 ms · 677 rps      | **p95 209 ms · 1,449 rps**            | p95 4,305 ms · 348 rps                            | p95 832 ms · 1,568 rps                  |
| `GET /blocks/:id/grid`                   | p95 363 ms · 600 rps                 | p95 260 ms · 985 rps      | **p95 137 ms · 1,917 rps**            | p95 2,210 ms · 605 rps                            | p95 621 ms · 2,122 rps                  |
| `GET /customers?search=`                 | p95 389 ms · 589 rps                 | p95 249 ms · 1,152 rps    | **p95 111 ms · 2,574 rps**            | p95 2,507 ms · 516 rps                            | p95 469 ms · 2,984 rps                  |
| `GET /bookings` (25/page)                | p95 1,333 ms · 155 rps               | p95 911 ms · 323 rps      | p95 404 ms · 657 rps                  | p95 9,213 ms · 142 rps                            | p95 1,731 ms · 708 rps                  |
| `GET /bookings/:id`                      | p95 730 ms · 294 rps                 | p95 299 ms · 905 rps      | **p95 142 ms · 1,919 rps**            | p95 8,093 ms · 238 rps                            | p95 596 ms · 2,214 rps                  |
| `GET /bookings/:id/ledger`               | p95 813 ms · 280 rps                 | p95 276 ms · 960 rps      | **p95 146 ms · 1,830 rps**            | p95 5,252 ms · 250 rps                            | p95 615 ms · 2,148 rps                  |
| `GET /dashboard` (Redis 15 s)            | p95 62 ms · 3,440 rps                | p95 58 ms · 3,727 rps     | **p95 34 ms · 9,212 rps**             | p95 186 ms · 2,435 rps                            | **p95 160 ms · 8,057 rps**              |
| `GET /public/projects` (Redis 60 s)      | p95 32 ms · 7,393 rps                | p95 31 ms · 7,397 rps     | **p95 15 ms · 21,585 rps**            | p95 162 ms · 6,540 rps                            | **p95 79 ms · 20,443 rps**              |
| `GET /search?q=`                         | p95 214 ms · 1,076 rps               | p95 62 ms · 4,166 rps     | **p95 50 ms · 6,212 rps**             | p95 1,223 ms · 1,529 rps (+ leak)                 | **p95 182 ms · 8,311 rps**              |
| `POST /payments` (50 conns, one booking) | p95 671 ms · p97.5 **17 s** · 43 rps | p95 514 ms · 131 rps      | p95 747 ms · 106 rps                  | 0 requests completed (queue flood from `/search`) | p95 749 ms · 103 rps                    |

(The single-process "after" column at 200 connections comes from the run labelled _after tuning … API_WORKERS=1_; exact rows are in the tables below.)

## Honest assessment against the targets

- **List pages < 300 ms at 200 concurrent hammering connections: met** for every list and detail endpoint except the 25-row bookings page (p95 404 ms; 65 KB per page with plan and flat snapshots per row). Per-request server time of that page is ≈ 4 ms when not queued, well under the "< 300 ms server time" wording of the spec; what the table shows at 200 connections is queueing on 4 cores.
- **List pages p95 < 300 ms at 1,000 connections: not met on this box.** With zero think time, 1,000 connections need > 3,300 req/s _per endpoint_ for a 300 ms p95; four workers on a 4-vCPU box that also runs Postgres, Redis and autocannon reach 1.5–3k req/s on the list endpoints (6–8k on cached ones, which do meet it). The gap is CPU, not SQL: execution times stay at 0.1–0.3 ms. Scaling is horizontal by design (stateless workers, Redis-backed caches), so the same code on two 4-vCPU API nodes with the database on its own machine would roughly double every row; and 1,000 real staff sessions (a request every few seconds each) are ~200–500 req/s, which this box serves well inside the target.
- **Writes**: payments to a single booking are serialised on purpose (`pg_advisory_xact_lock` per booking, SPEC §11, plus the receipt-number sequence), so the ₹100 scenario measures one booking's serial throughput (~100–130 payments/s, 8–10 ms each including audit row, notification and ledger append) and its queueing at 50 connections — not the system's write ceiling across bookings.
- **Load shedding** (`API_MAX_INFLIGHT`) is a latency bound, not a throughput gain. The last table (1,000 connections, `API_MAX_INFLIGHT=64` per worker, deliberately low so shedding is visible) shows what happens with a generator that ignores `Retry-After` and re-sends instantly: ~85–90 % of requests are answered 503 in ~1 ms, those answers cost CPU (15–26k responses/s), so admitted throughput drops (e.g. `/auth/me` 6,031 → 2,170 admitted rps) while the admitted requests' tail improves where queueing was worst (`GET /bookings` p95 1,731 → 870 ms, p99 16.5 s → 6.5 s; `/flats` p95 832 → 475 ms). Real clients back off on 503, which is why the knob exists; it stays off by default, and a production value (256 per worker) would not have shed at all in this test. The latency columns of that table mix admitted and shed responses — read the `admitted …` figures in the `non-2xx` cell.
- Postgres was left at its container defaults (`shared_buffers` 128 MB, `work_mem` 4 MB); `infra/postgres/postgresql.conf` holds the production tuning. With seed-sized tables it makes no measurable difference here.

## Hardening round re-run (2026-10-26, verify stage)

Same box, same runner, `NODE_ENV=production` bundle with `API_WORKERS=auto` (4 HTTP workers), `kkt_load` re-created and seeded by the
production migrate job with `SEED_ON_BOOT=true SEED_DEMO=true` (10 bookings, 36 payments, 130 flats, 12 customers). Full tables: the two
"hardening round" runs at the end of this file. "Before" is the `API_WORKERS=auto` column of the table above (end of the tuning round).

| Scenario                    | 200 conns before       | 200 conns now            | 1,000 conns before     | 1,000 conns now            |
| --------------------------- | ---------------------- | ------------------------ | ---------------------- | -------------------------- |
| `GET /auth/me`              | p95 61 ms · 5,319 rps  | p95 122 ms · 2,940 rps   | p95 238 ms · 6,031 rps | p95 371 ms · 3,522 rps     |
| `GET /projects`             | p95 102 ms · 2,703 rps | p95 181 ms · 1,628 rps   | p95 493 ms · 2,820 rps | p95 832 ms · 1,692 rps     |
| `GET /flats` (50/page)      | p95 209 ms · 1,449 rps | p95 337 ms · 829 rps     | p95 832 ms · 1,568 rps | p95 1,520 ms · 884 rps     |
| `GET /blocks/:id/grid`      | p95 137 ms · 1,917 rps | p95 233 ms · 1,387 rps   | p95 621 ms · 2,122 rps | p95 1,019 ms · 1,330 rps   |
| `GET /customers?search=`    | p95 111 ms · 2,574 rps | p95 219 ms · 1,429 rps   | p95 469 ms · 2,984 rps | p95 767 ms · 1,761 rps     |
| `GET /bookings` (25/page)   | p95 404 ms · 657 rps   | **p95 330 ms · 858 rps** | p95 1,731 ms · 708 rps | **p95 1,432 ms · 992 rps** |
| `GET /bookings/:id`         | p95 142 ms · 1,919 rps | p95 317 ms · 865 rps     | p95 596 ms · 2,214 rps | p95 1,353 ms · 984 rps     |
| `GET /bookings/:id/ledger`  | p95 146 ms · 1,830 rps | p95 302 ms · 972 rps     | p95 615 ms · 2,148 rps | p95 1,257 ms · 1,031 rps   |
| `GET /dashboard`            | p95 34 ms · 9,212 rps  | p95 59 ms · 5,451 rps    | p95 160 ms · 8,057 rps | p95 284 ms · 4,631 rps     |
| `GET /public/projects`      | p95 15 ms · 21,585 rps | p95 32 ms · 11,230 rps   | p95 79 ms · 20,443 rps | p95 151 ms · 10,477 rps    |
| `GET /search?q=`            | p95 50 ms · 6,212 rps  | p95 76 ms · 4,499 rps    | p95 182 ms · 8,311 rps | p95 264 ms · 5,010 rps     |
| `POST /payments` (50 conns) | p95 747 ms · 106 rps   | p95 1,248 ms · 70 rps    | p95 749 ms · 103 rps   | p95 1,472 ms · 62 rps      |

- **Bookings list payload:** the list now sends compact rows by default (`view=full` keeps every field): the seeded page is 10.2 KB
  instead of 65.6 KB (≈ 1 KB per row). It is the only list that got faster (p95 404 → 330 ms and +31 % throughput at 200 connections,
  +40 % at 1,000) even though every other row lost throughput.
- **Indexes:** the `(company_id, sort DESC, id DESC)` and trigram indexes of migration 0002 make no measurable difference on seed-sized
  tables (execution stays at 0.1–0.3 ms); they exist for production row counts, where `ILIKE '%term%'` search and the default sort
  would otherwise scan.
- **Regression, honestly:** every other endpoint lost 30–55 % of its throughput, including the Redis-cached `/public/projects` that does
  no SQL, and a single process shows the same drop (`/auth/me` 2,571 → 1,453 rps, `/dashboard` 3,727 → 2,196, `/public/projects`
  7,397 → 4,367 at 200 connections, 15 s). The extra cost sits in the shared request pipeline that the hardening round extended, not in
  the database. Candidates, not yet bisected: per-route prom-client histograms; per-command Redis timeouts plus 150 ms read budgets
  (two timers per Redis call); the security-client lookups and the Redis rate-limit `MULTI` (≈ 13 % of CPU on the cached public path
  in a `--cpu-prof` sample); the version-policy, docs-gate, deprecation and trace-id hooks. Payments additionally write the
  Postgres-backed idempotency claim row and take the money track's ordered locks (≈ 70 payments/s on one booking instead of ≈ 105).
  Bisected and fixed in "Regression fix" below (most of the gap was the box; the pipeline part is fixed). Every list and detail endpoint still meets p95 < 300 ms at 200
  connections except `/flats`, `/bookings`, `/bookings/:id` and `/bookings/:id/ledger` (302–337 ms); at 1,000 zero-think-time
  connections only `/dashboard`, `/public/projects` and `/search` do (`/public/projects/:slug` p95 329 ms, `/auth/me` 371 ms).

## Regression fix (2026-10-26)

**Method.** Database `kkt_perf` (migrated + demo seed), Redis db 25, production bundle of every stage built in its own git worktree
(`pnpm install --offline --frozen-lockfile`, `pnpm --filter @kkt/api build`; the older bundles read the newer schema without problems),
`NODE_ENV=production`, `LOG_LEVEL=warn`, raised write/public rate limits as in the runs above, `SEED_ON_BOOT=false`,
`RUN_MIGRATIONS_ON_BOOT=false`. Three measurements:

- **Throughput, one process** (`API_WORKERS=1`): autocannon, 100 connections × 15 s, each endpoint twice with a 3 s pause before each
  run, best run kept. The pause matters: with no gap, `@fastify/under-pressure` (event-loop utilisation > 0.98) can stay latched and
  answer every request 503 (see the open items), which shows up as a five-figure "throughput".
- **CPU per request, one process**: a fixed request rate (800 rps `/auth/me`, 1,500 rps `/public/projects`, 400 rps `/projects`),
  15 s after a 5 s warm-up. Ticks in `/proc/<pid>/stat` of the API, `redis-server` and the Postgres backends, divided by the requests
  served. This number does not depend on the box's speed of the moment, so it is the one to compare stages with: the shared 4-vCPU box
  moved by ±10 % in throughput between back-to-back runs of the same bundle.
- **The full load test** (`apps/api/loadtest/run.ts`, `API_WORKERS=auto`, 200 and 1,000 connections × 30 s) on a fresh copy of the
  seeded database for every run.

**First finding: most of the reported 30–55 % was the box, not the code.** The baseline commit `1a7d012`, re-measured today on the same
box, does `/auth/me` at 1,586–1,792 rps in one process (the tuning-day table above says 2,571) and 2,982–3,123 rps with 4 workers at
200 connections (tuning day: 5,319); `/public/projects` 11,350–12,967 rps (tuning day: 21,585). The "Hardening round re-run" compared
runs made on different days; measured side by side the hardening bundle was 6–13 % slower on `/auth/me`, 5–22 % slower on the Redis-only
public routes, unchanged on database-bound lists, and 20–30 % slower on `/bookings/:id` and its ledger (module work, see below).

### Bisect (one process, `kkt_perf`)

| Stage                                   | `/auth/me` rps | `/public/projects` rps | `/projects` rps | `/bookings` rps | `/auth/me` CPU µs/req | `/public/projects` CPU µs/req | `/projects` CPU µs/req |
| --------------------------------------- | -------------- | ---------------------- | --------------- | --------------- | --------------------- | ----------------------------- | ---------------------- |
| `1a7d012` baseline                      | 1,586          | 5,948                  | 725             | 218             | 1,011                 | 260                           | 2,085                  |
| `c788f31` foundation                    | 1,735          | 5,384                  | 756             | 210             | 1,028                 | 253                           | 1,936                  |
| `e744975` tracks                        | 1,555          | 4,560                  | 666             | 455             | 1,053                 | 250                           | 2,034                  |
| `36010c0` integration                   | 1,646          | 4,640                  | 708             | 492             | 1,040                 | 276                           | 2,101                  |
| `1f4d32b` verify (the regressed bundle) | 1,525          | 4,776                  | 704             | 487             | 1,077                 | 293                           | 2,079                  |
| this fix                                | see below      | see below              | see below       | see below       | 1,029                 | 223                           | 2,099                  |

Throughput columns: one run per stage (best of two), so ±10 % is noise. CPU columns: mean of 2 rounds (4 for the baseline, `1f4d32b` and
the fix), API process only (Redis ≈ 31–38 µs and Postgres ≈ 140–180 µs per `/auth/me` in every stage; the fix's Lua script costs Redis
≈ 5 µs more per public request than MULTI/EXEC). `/bookings` is faster from `e744975` on because the list sends compact rows. The cost
came in with `e744975` (auth Redis budgets, telemetry plugin, key-ring JWT verification: `/auth/me` +40–60 µs) and `36010c0`/`1f4d32b`
(per-command Redis timeout, `cached()` budget: `/public/projects` +30 µs). The foundation stage (`c788f31`, trust proxy, DB timeouts as
startup parameters, transaction retry) costs nothing measurable.

### Root causes (file:line in `1f4d32b`) and fixes

1. **Rate limit = five Redis commands per public request**: `lib/rateLimit.ts:20` ran `MULTI / INCR / EXPIRE / GET / EXEC` for every
   public request, and since `36010c0` each of those commands also arms and clears an ioredis command timer. In a `--cpu-prof` sample of
   the cached public route it was ≈ 40 µs of 242 µs per request. **Fix:** one `EVALSHA` of a three-line Lua script (same keys, same
   two-window weighting, same expiry refresh, atomic like MULTI), loaded with `EVAL` on `NOSCRIPT`. Unit test:
   `test/unit/rate-limit.test.ts`; behaviour (429 + Retry-After, fail-open on errors) unchanged.
2. **Every Redis call on the hot path paid for an async wrapper, a `Promise.race`, an extra promise and a timer**:
   `plugins/auth.ts:88-110` (`redisTry`: auth cache + revocation `MGET`), `plugins/auth.ts:294-312` (rate limit) and
   `lib/cache.ts:24-36` (`withinBudget`, used by `cached()`, `loadCompany` and the public cache version) — 2–3 per request.
   **Fix:** `withinBudget` is one promise and one timer, and the auth plugin uses it instead of its own copies.
3. **The Redis budgets measured the event loop, not Redis**: timers run before I/O in an event-loop iteration, so under load the 250 ms
   auth budget fired while the `MGET` reply was already in the socket, and the request fell back to the (much more expensive) database
   query — 3,056 times in the `1f4d32b` 1,000-connection run (`"redis auth mget exceeded 250 ms"`), adding load exactly when the process
   was saturated. **Fix:** the rejection is deferred by one `setImmediate` (after the poll phase), so a reply that is already there wins;
   a dead or slow Redis still costs at most the budget plus one loop iteration (`test/unit/cache.test.ts`). Final 1,000-connection run:
   0 fallbacks. The Redis-outage tests (`security-hardening`, `security-review`, `platform`, `cross-track`) pass unchanged.
4. **Per-request telemetry bookkeeping**: `plugins/telemetry.ts:50-51` updated a prom-client gauge twice per request (label hashing) and
   allocated a closure for it, and looked up the active span twice (`:53`, `:58`); `lib/metrics.ts:111` built and validated a label
   object for the counter and again for the histogram on every request. **Fix:** the in-flight gauge reads a plain counter in its
   `collect()` at scrape time (one shared `close` listener per request), one span lookup whose result is reused (nothing else runs
   without an SDK), and the counter/histogram children are cached per route/method/status. The metric names, labels and values are the
   same (`test/unit/metrics.test.ts`).
5. **JWT key ring rebuilt per request**: `lib/jwt.ts:52-53` built `[JWT_SECRET, ...JWT_PREVIOUS_SECRETS]` and joined it on every
   verification, and `:89` base64/JSON-decoded the token header that `jwtVerify` decodes again. **Fix:** an allocation-free comparison
   with the secrets the ring was built from, and with a single key (no rotation in progress) the `kid` lookup is skipped — that key is the
   only candidate either way. Rotation (`test/unit/key-rotation.test.ts`) is unchanged.
6. Minor: `plugins/loadShed.ts:28` allocated a release closure per request; it is now one function per plugin instance.

**Checked and not a cost** (so left alone): Redis and Postgres round trips per request are identical in the baseline and `1f4d32b`
(`INFO commandstats` and `pg_stat_database.xact_commit` over 2,000 requests: `/auth/me` 1 `MGET` + 1 `GET` + 1 query; `/public/projects`
the rate-limit transaction + 2 `GET`; `/projects` ≈ 5 queries; `/bookings` ≈ 3 queries); the idempotency plugin returns before any I/O
on GET; the database client sends `statement_timeout` / `lock_timeout` / `idle_in_transaction_session_timeout` as startup parameters (per
connection, no `SET` per query or transaction) and still uses prepared statements; with `OTEL_EXPORTER_OTLP_ENDPOINT` unset no SDK and no
AsyncLocalStorage context manager is registered and `lib/routes.ts` returns the handler unwrapped; the pino trace mixin runs per log
line only (none per request at `warn`; it must return a fresh object because pino merges into it); Zod is not jitless; trust proxy
(`proxy-addr`) only walks `X-Forwarded-For` when the header is present; the error reporter registers no hooks without
`ERROR_WEBHOOK_URL`; async vs callback hooks differ by ≤ 0.2 µs per hook in a micro-benchmark (not converted); removing the ioredis
`commandTimeout` changed nothing measurable (kept: it bounds un-budgeted writes during an outage).

**Tried and rejected:** ioredis `enableAutoPipelining` gave +12 % on `/auth/me` and +5 % on `/public/projects` but cost `/projects` 7 %
(688 → 634 rps, three interleaved rounds): commands wait for `setImmediate` and only one batch per client is in flight, which lengthens
the critical path of requests that then wait for the database pool.

### Before / after

One process, three interleaved rounds (baseline → `1f4d32b` → fix, repeated), mean of the best-of-two per round, 100 connections × 15 s
(this campaign ran before item 3 above, which matters only under saturation):

| Endpoint           | `1a7d012` | `1f4d32b`      | fix                |
| ------------------ | --------- | -------------- | ------------------ |
| `/auth/me`         | 1,596     | 1,524 (−4.5 %) | 1,533 (−4.0 %)     |
| `/public/projects` | 5,310     | 4,649 (−12 %)  | **5,549 (+4.5 %)** |
| `/projects`        | 720       | 669 (−7 %)     | 687 (−4.6 %)       |
| `/bookings`        | 208       | 454            | 442                |

CPU per request (the stable measure, 4 interleaved rounds): `/auth/me` 1,011 → 1,077 → **1,029 µs** (+1.8 % vs the baseline),
`/public/projects` 260 → 293 → **223 µs** (−14 %), `/projects` 2,085 → 2,079 → **2,099 µs** (+0.7 %).

Four workers, 200 connections × 20 s, two interleaved rounds (`/auth/me`, `/projects`, `/bookings`, `/bookings/:id`, `/public/projects`):
baseline 3,102 / 1,575 / 406 / 1,147 / 12,341 rps; `1f4d32b` 2,698 / 1,610 / 915 / 781 / 9,597; fix (before item 3) 2,943 / 1,641 /
834 / 902 / 13,585.

Full load test, same day, fresh database copy per run (req/s; the fix's two tables are the last runs in this file; the baseline and
`1f4d32b` tables are not appended — they would only repeat these columns):

| Scenario                     | 200: `1a7d012` (2 runs) | 200: `1f4d32b` | 200: fix | 1,000: `1a7d012` (2 runs) | 1,000: `1f4d32b` | 1,000: fix |
| ---------------------------- | ----------------------- | -------------- | -------- | ------------------------- | ---------------- | ---------- |
| `GET /auth/me`               | 3,123 / 2,982           | 2,932          | 3,265    | 3,695 / 3,808             | 3,600            | 3,819      |
| `GET /projects`              | 1,601 / 1,591           | 1,758          | 1,752    | 1,768 / 1,791             | 1,655            | 1,926      |
| `GET /flats`                 | 821 / 867               | 911            | 896      | 998 / 1,014               | 969              | 1,044      |
| `GET /blocks/:id/grid`       | 1,479 / 1,413           | 1,604          | 1,466    | 1,379 / 1,383             | 1,284            | 1,739      |
| `GET /customers?search=`     | 1,624 / 1,622           | 1,473          | 1,370    | 2,016 / 1,769             | 1,747            | 1,724      |
| `GET /bookings`              | 400 / 409               | 1,026          | 854      | 494 / 445                 | 946              | 1,056      |
| `GET /bookings/:id`          | 1,109 / 1,187           | 861            | 879      | 1,355 / 1,287             | 1,029            | 1,011      |
| `GET /bookings/:id/ledger`   | 1,180 / 1,250           | 965            | 931      | 1,417 / 1,270             | 1,236            | 1,139      |
| `GET /dashboard`             | 5,325 / 6,117           | 5,255          | 5,495    | 4,768 / 5,058             | 4,423            | 4,436      |
| `GET /public/projects`       | 11,350 / 12,967         | 10,836         | 13,493   | 12,137 / 11,470           | 10,619           | 10,509     |
| `GET /public/projects/:slug` | 5,121 / 5,324           | 5,037          | 5,221    | 4,980 / 5,018             | 4,765            | 4,003      |
| `GET /search?q=`             | 4,239 / 3,853           | 4,129          | 3,894    | 5,583 / 5,484             | 5,451            | 5,098      |
| `POST /payments`             | 75 / 75                 | 70             | 71       | 73 / 73                   | 61               | 51         |

At 1,000 zero-think-time connections the box (4 API workers, Postgres, Redis and autocannon on 4 vCPUs) swings by 10–20 % between runs
of the same bundle (an earlier run of the fix, before item 3, did 13,584 rps on `/public/projects` there); read that half for errors
and tail latency, not for single-digit differences. The fix run had no non-2xx at 200 connections except 22 on `POST /payments`
(11 client timeouts in the run that hit the stuck request, see the open items) and 2 on `/search` at 1,000; the baseline had 440 and 866
non-2xx (client timeouts) on the two bookings-list scenarios at 1,000 connections in its two runs, the fix none. `POST /payments` is
lock-bound on one booking and runs last, after the 1,000-connection storm: 51–65 rps over the fix's runs against 61–73 for the others.

**Not the pipeline (left for module work, done in "Reliability fixes" below):** `/bookings/:id` and `/bookings/:id/ledger` are 20–30 % slower than the baseline with the same
number of queries (4): the money track's detail payload (price deviation, plan revisions, schedule forecast) costs more Drizzle query
building and a larger Zod response serialisation (≈ 150 vs 112 µs per request); `/customers?search=` and `POST /payments` (ordered
locks, Postgres idempotency claim) are 5–15 % slower for the same kind of reason. These are features, not overhead, and were not traded
away here.

**Open items found on the way** (all three, and the slow module paths above, are fixed in "Reliability fixes" below):

- `@fastify/under-pressure` with `maxEventLoopUtilization: 0.98` (`app.ts`, unchanged since the baseline) can latch under sustained
  saturation: the 503s are cheap, so utilisation stays above the threshold and every request is refused until the load drops. Seen in one
  process at 100 connections and with 4 workers at 400 connections; the benchmarks pause between runs to avoid it.
- `/search` cancels its statement after 150 ms with `query.cancel()` (`modules/search/index.ts`, unchanged since the baseline). Postgres
  cancels whatever the backend runs when the cancel arrives, and postgres.js pipelines other requests' queries on the same connection, so a
  late cancel can hit a neighbour: one `GET /search` 1,000-connection run logged a `companies` query failing inside postgres.js
  (`DataRow … reading 'length'`), and one run (14,829 cancellations at 200 connections) left a request without an answer for 300 s, which
  aborted that run's 1,000-connection half (re-run separately, clean). A targeted search storm (3 × 20 s at 400 connections) did not
  reproduce a hang on the fix or on the baseline. Running the search on a reserved connection, or with `SET LOCAL statement_timeout`
  inside a transaction instead of an out-of-band cancel, would remove the race.

### Run 2026-10-25T20:00:05.847Z — 200 connections × 30s per scenario — before tuning

| Scenario                                     | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 200   | 43360    | 0       | 130    | 178.2  | 217      | 236    | 1445  |
| GET /projects                                | 200   | 13479    | 0       | 440    | 482.9  | 499      | 541    | 449   |
| GET /flats (list, filtered)                  | 200   | 10929    | 0       | 532    | 603.2  | 619      | 929    | 364   |
| GET /blocks/:id/grid                         | 200   | 18004    | 0       | 327    | 362.7  | 370      | 382    | 600   |
| GET /customers (search)                      | 200   | 17658    | 0       | 329    | 388.5  | 396      | 410    | 589   |
| GET /bookings (list)                         | 200   | 4652     | 0       | 1258   | 1332.7 | 1359     | 1766   | 155   |
| GET /bookings (list, If-None-Match → 304)    | 200   | 4823     | 0       | 1188   | 1321.6 | 1870     | 2200   | 161   |
| GET /bookings/:id                            | 200   | 8817     | 0       | 643    | 730.2  | 890      | 1610   | 294   |
| GET /bookings/:id/ledger                     | 200   | 8385     | 0       | 694    | 813.4  | 828      | 913    | 280   |
| GET /dashboard                               | 200   | 103171   | 0       | 50     | 62.1   | 73       | 87     | 3440  |
| GET /public/projects (no auth, cached)       | 200   | 221772   | 0       | 25     | 32.1   | 35       | 40     | 7393  |
| GET /public/projects/:slug (no auth, cached) | 200   | 81341    | 0       | 67     | 88.7   | 96       | 107    | 2712  |
| GET /search?q=                               | 200   | 32271    | 0       | 171    | 213.7  | 287      | 505    | 1076  |
| POST /payments (₹100, 50 conns)              | 50    | 1304     | 0       | 539    | 670.5  | 16981    | 17323  | 43    |

### Run 2026-10-25T20:07:08.078Z — 1000 connections × 30s per scenario — before tuning

| Scenario                                     | Conns | Requests | non-2xx                   | p50 ms | p95 ms  | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------------------------- | ------ | ------- | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 44672    | 0                         | 652    | 754.6   | 960      | 1137   | 1489  |
| GET /projects                                | 1000  | 13748    | 0                         | 2093   | 2892.5  | 3792     | 4650   | 458   |
| GET /flats (list, filtered)                  | 1000  | 10441    | 0                         | 2660   | 4304.6  | 4830     | 5522   | 348   |
| GET /blocks/:id/grid                         | 1000  | 18139    | 0                         | 1637   | 2209.7  | 3321     | 4911   | 605   |
| GET /customers (search)                      | 1000  | 15490    | 0                         | 1852   | 2506.7  | 3957     | 5132   | 516   |
| GET /bookings (list)                         | 1000  | 4246     | 0                         | 6205   | 9213.3  | 10072    | 10601  | 142   |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 4034     | 0                         | 6058   | 10151.0 | 10935    | 11253  | 134   |
| GET /bookings/:id                            | 1000  | 7144     | 0                         | 3282   | 8093.0  | 8337     | 8459   | 238   |
| GET /bookings/:id/ledger                     | 1000  | 7487     | 0                         | 3647   | 5252.2  | 5906     | 6405   | 250   |
| GET /dashboard                               | 1000  | 73055    | 480 (err×240 timeout×240) | 134    | 186.2   | 202      | 6065   | 2435  |
| GET /public/projects (no auth, cached)       | 1000  | 196168   | 0                         | 131    | 161.6   | 172      | 180    | 6540  |
| GET /public/projects/:slug (no auth, cached) | 1000  | 80366    | 22 (err×11 timeout×11)    | 243    | 357.5   | 375      | 1750   | 2679  |
| GET /search?q=                               | 1000  | 45882    | 402 (err×201 timeout×201) | 347    | 1222.6  | 1433     | 2579   | 1529  |
| POST /payments (₹100, 50 conns)              | 50    | 0        | 100 (err×50 timeout×50)   | 0      | 0.0     | 0        | 0      | 0     |

### Run 2026-10-25T20:25:49.672Z — 200 connections × 30s per scenario — after tuning (prepared statements, 1-query related loads, UNION search), API_WORKERS=1

| Scenario                                     | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 200   | 77120    | 0       | 74     | 99.1   | 105      | 117    | 2571  |
| GET /projects                                | 200   | 30646    | 0       | 189    | 276.8  | 301      | 334    | 1022  |
| GET /flats (list, filtered)                  | 200   | 20316    | 0       | 284    | 420.6  | 455      | 501    | 677   |
| GET /blocks/:id/grid                         | 200   | 29547    | 0       | 200    | 259.5  | 271      | 287    | 985   |
| GET /customers (search)                      | 200   | 34568    | 0       | 166    | 248.6  | 269      | 290    | 1152  |
| GET /bookings (list)                         | 200   | 9685     | 0       | 603    | 911.3  | 963      | 1024   | 323   |
| GET /bookings (list, If-None-Match → 304)    | 200   | 10478    | 0       | 557    | 842.6  | 894      | 959    | 349   |
| GET /bookings/:id                            | 200   | 27140    | 0       | 214    | 299.3  | 316      | 338    | 905   |
| GET /bookings/:id/ledger                     | 200   | 28810    | 0       | 202    | 276.2  | 296      | 320    | 960   |
| GET /dashboard                               | 200   | 111804   | 0       | 50     | 57.8   | 69       | 84     | 3727  |
| GET /public/projects (no auth, cached)       | 200   | 221882   | 0       | 26     | 31.2   | 33       | 38     | 7397  |
| GET /public/projects/:slug (no auth, cached) | 200   | 87088    | 0       | 65     | 79.9   | 90       | 98     | 2903  |
| GET /search?q=                               | 200   | 124961   | 0       | 47     | 61.8   | 65       | 70     | 4166  |
| POST /payments (₹100, 50 conns)              | 50    | 3939     | 0       | 431    | 513.9  | 527      | 590    | 131   |

### Run 2026-10-25T20:33:41.841Z — 1000 connections × 30s per scenario — after tuning, API_WORKERS=1

| Scenario                                     | Conns | Requests | non-2xx                | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ---------------------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 79674    | 0                      | 365    | 495.4  | 524      | 555    | 2656  |
| GET /projects                                | 1000  | 39788    | 0                      | 731    | 980.7  | 1030     | 1101   | 1326  |
| GET /flats (list, filtered)                  | 1000  | 20807    | 0                      | 1397   | 1803.1 | 1991     | 2317   | 694   |
| GET /blocks/:id/grid                         | 1000  | 29318    | 0                      | 1014   | 1270.2 | 1339     | 1500   | 977   |
| GET /customers (search)                      | 1000  | 38656    | 0                      | 764    | 890.8  | 917      | 962    | 1289  |
| GET /bookings (list)                         | 1000  | 14179    | 4556 (503×4556)        | 2148   | 3420.8 | 3568     | 3776   | 473   |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 12851    | 2563 (503×2563)        | 2436   | 3557.0 | 3888     | 4279   | 428   |
| GET /bookings/:id                            | 1000  | 28843    | 0                      | 1009   | 1332.0 | 1383     | 1464   | 961   |
| GET /bookings/:id/ledger                     | 1000  | 30496    | 0                      | 966    | 1261.3 | 1314     | 1381   | 1017  |
| GET /dashboard                               | 1000  | 87169    | 0                      | 256    | 329.5  | 742      | 3803   | 2906  |
| GET /public/projects (no auth, cached)       | 1000  | 204988   | 0                      | 137    | 171.5  | 184      | 206    | 6833  |
| GET /public/projects/:slug (no auth, cached) | 1000  | 74303    | 0                      | 362    | 420.1  | 439      | 2767   | 2477  |
| GET /search?q=                               | 1000  | 139221   | 26 (err×13 timeout×13) | 172    | 231.2  | 249      | 304    | 4641  |
| POST /payments (₹100, 50 conns)              | 50    | 3589     | 0                      | 413    | 566.9  | 599      | 634    | 120   |

### Run 2026-10-25T20:42:04.502Z — 200 connections × 30s per scenario — after tuning, API_WORKERS=auto (4 processes on the 4-vCPU box shared with Postgres, Redis and autocannon)

| Scenario                                     | Conns | Requests | non-2xx             | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------------------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 200   | 159563   | 0                   | 34     | 61.3   | 72       | 89     | 5319  |
| GET /projects                                | 200   | 81088    | 0                   | 71     | 102.4  | 114      | 130    | 2703  |
| GET /flats (list, filtered)                  | 200   | 43461    | 0                   | 134    | 209.0  | 227      | 254    | 1449  |
| GET /blocks/:id/grid                         | 200   | 57494    | 0                   | 101    | 137.0  | 147      | 161    | 1917  |
| GET /customers (search)                      | 200   | 77195    | 0                   | 74     | 110.6  | 122      | 139    | 2574  |
| GET /bookings (list)                         | 200   | 19695    | 0                   | 294    | 403.8  | 433      | 477    | 657   |
| GET /bookings (list, If-None-Match → 304)    | 200   | 22390    | 0                   | 261    | 352.5  | 376      | 414    | 746   |
| GET /bookings/:id                            | 200   | 57561    | 0                   | 100    | 141.8  | 153      | 169    | 1919  |
| GET /bookings/:id/ledger                     | 200   | 54887    | 0                   | 106    | 145.9  | 159      | 178    | 1830  |
| GET /dashboard                               | 200   | 276354   | 0                   | 19     | 33.8   | 38       | 44     | 9212  |
| GET /public/projects (no auth, cached)       | 200   | 647531   | 0                   | 8      | 15.3   | 17       | 21     | 21585 |
| GET /public/projects/:slug (no auth, cached) | 200   | 280691   | 0                   | 19     | 33.5   | 38       | 46     | 9357  |
| GET /search?q=                               | 200   | 186352   | 6 (err×3 timeout×3) | 30     | 50.2   | 55       | 63     | 6212  |
| POST /payments (₹100, 50 conns)              | 50    | 3194     | 0                   | 410    | 747.3  | 810      | 920    | 106   |

### Run 2026-10-25T20:49:48.141Z — 1000 connections × 30s per scenario — after tuning, API_WORKERS=auto

| Scenario                                     | Conns | Requests | non-2xx                 | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ----------------------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 180933   | 0                       | 157    | 237.5  | 261      | 297    | 6031  |
| GET /projects                                | 1000  | 84573    | 0                       | 329    | 492.7  | 542      | 628    | 2820  |
| GET /flats (list, filtered)                  | 1000  | 47043    | 0                       | 551    | 832.2  | 925      | 2900   | 1568  |
| GET /blocks/:id/grid                         | 1000  | 63651    | 0                       | 433    | 620.8  | 667      | 1071   | 2122  |
| GET /customers (search)                      | 1000  | 89495    | 0                       | 306    | 469.0  | 515      | 625    | 2984  |
| GET /bookings (list)                         | 1000  | 21236    | 120 (err×60 timeout×60) | 934    | 1730.7 | 3296     | 16538  | 708   |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 22787    | 100 (err×50 timeout×50) | 869    | 1651.8 | 3766     | 16298  | 760   |
| GET /bookings/:id                            | 1000  | 66416    | 0                       | 414    | 596.0  | 644      | 756    | 2214  |
| GET /bookings/:id/ledger                     | 1000  | 64425    | 0                       | 422    | 614.5  | 678      | 1018   | 2148  |
| GET /dashboard                               | 1000  | 241681   | 0                       | 102    | 160.3  | 188      | 272    | 8057  |
| GET /public/projects (no auth, cached)       | 1000  | 613272   | 0                       | 45     | 78.7   | 87       | 102    | 20443 |
| GET /public/projects/:slug (no auth, cached) | 1000  | 227912   | 0                       | 122    | 184.0  | 199      | 225    | 7598  |
| GET /search?q=                               | 1000  | 249308   | 58 (err×29 timeout×29)  | 107    | 181.9  | 201      | 231    | 8311  |
| POST /payments (₹100, 50 conns)              | 50    | 3101     | 0                       | 438    | 748.8  | 817      | 895    | 103   |

### Run 2026-10-25T21:12:20.388Z — 1000 connections × 30s per scenario — after tuning, API_WORKERS=auto, API_MAX_INFLIGHT=64 per worker (load shedding on: excess answered 503 + Retry-After; the non-2xx cell also reports the admitted requests' own throughput and latency)

| Scenario                                     | Conns | Requests | non-2xx                                                                                           | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 619691   | 554145 (503×554145; admitted 65546 = 2170 rps @ p50 131 / p95 243 / p99 435 ms)                   | 35     | 138.1  | 170      | 211    | 20658 |
| GET /projects                                | 1000  | 476279   | 437465 (503×437465; admitted 38814 = 1289 rps @ p50 219 / p95 362 / p99 457 ms)                   | 41     | 204.6  | 258      | 318    | 15876 |
| GET /flats (list, filtered)                  | 1000  | 353746   | 327522 (503×327522; admitted 26224 = 869 rps @ p50 346 / p95 475 / p99 546 ms)                    | 59     | 315.3  | 381      | 438    | 11792 |
| GET /blocks/:id/grid                         | 1000  | 381727   | 356463 (503×356463; admitted 25264 = 840 rps @ p50 346 / p95 536 / p99 678 ms)                    | 49     | 295.7  | 378      | 457    | 12724 |
| GET /customers (search)                      | 1000  | 458329   | 421415 (503×421415; admitted 36914 = 1227 rps @ p50 229 / p95 376 / p99 551 ms)                   | 42     | 212.9  | 266      | 329    | 15278 |
| GET /bookings (list)                         | 1000  | 174914   | 159810 (503×159810; admitted 15104 = 502 rps @ p50 620 / p95 870 / p99 6477 ms)                   | 107    | 598.4  | 703      | 807    | 5831  |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 167052   | 150121 (503×150121; admitted 16931 = 563 rps @ p50 547 / p95 816 / p99 7708 ms)                   | 102    | 556.9  | 657      | 772    | 5569  |
| GET /bookings/:id                            | 1000  | 425243   | 396969 (503×396969; admitted 28274 = 940 rps @ p50 297 / p95 473 / p99 704 ms)                    | 44     | 256.9  | 325      | 400    | 14176 |
| GET /bookings/:id/ledger                     | 1000  | 423516   | 396799 (503×396799; admitted 26717 = 888 rps @ p50 320 / p95 497 / p99 598 ms)                    | 45     | 264.4  | 347      | 423    | 14118 |
| GET /dashboard                               | 1000  | 632000   | 535264 (503×535264; admitted 96736 = 3212 rps @ p50 96 / p95 168 / p99 224 ms)                    | 34     | 115.3  | 137      | 175    | 21068 |
| GET /public/projects (no auth, cached)       | 1000  | 796038   | 631325 (503×631325; admitted 164713 = 5463 rps @ p50 63 / p95 123 / p99 168 ms)                   | 29     | 87.9   | 104      | 125    | 26536 |
| GET /public/projects/:slug (no auth, cached) | 1000  | 606866   | 504037 (503×504037; admitted 102829 = 3409 rps @ p50 95 / p95 158 / p99 201 ms)                   | 38     | 112.7  | 132      | 156    | 20231 |
| GET /search?q=                               | 1000  | 673892   | 602755 (503×602749; err×3; timeout×3; admitted 71143 = 2357 rps @ p50 124 / p95 228 / p99 337 ms) | 31     | 128.5  | 157      | 201    | 22463 |
| POST /payments (₹100, 50 conns)              | 50    | 3416     | 0                                                                                                 | 342    | 1309.2 | 1619     | 1930   | 114   |

### Run 2026-10-26T08:41:07.761Z — 200 connections × 30s per scenario — hardening round (verify stage): compact bookings list, sort + trigram indexes, NODE_ENV=production, API_WORKERS=auto (4 processes on the shared 4-vCPU box)

| Scenario                                     | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 200   | 88182    | 0       | 59     | 122.4  | 147      | 184    | 2940  |
| GET /projects                                | 200   | 48835    | 0       | 116    | 180.5  | 200      | 232    | 1628  |
| GET /flats (list, filtered)                  | 200   | 24864    | 0       | 230    | 337.1  | 370      | 429    | 829   |
| GET /blocks/:id/grid                         | 200   | 41610    | 0       | 139    | 233.2  | 252      | 279    | 1387  |
| GET /customers (search)                      | 200   | 42869    | 0       | 131    | 218.6  | 237      | 259    | 1429  |
| GET /bookings (list)                         | 200   | 25725    | 0       | 223    | 330.1  | 356      | 397    | 858   |
| GET /bookings (list, If-None-Match → 304)    | 200   | 30436    | 0       | 190    | 273.9  | 292      | 319    | 1015  |
| GET /bookings/:id                            | 200   | 25964    | 0       | 223    | 317.1  | 339      | 370    | 865   |
| GET /bookings/:id/ledger                     | 200   | 29165    | 0       | 197    | 301.5  | 323      | 349    | 972   |
| GET /dashboard                               | 200   | 163527   | 0       | 33     | 59.3   | 66       | 78     | 5451  |
| GET /public/projects (no auth, cached)       | 200   | 336887   | 0       | 16     | 32.0   | 36       | 43     | 11230 |
| GET /public/projects/:slug (no auth, cached) | 200   | 150212   | 0       | 35     | 65.2   | 74       | 88     | 5007  |
| GET /search?q=                               | 200   | 134978   | 0       | 41     | 75.8   | 86       | 103    | 4499  |
| POST /payments (₹100, 50 conns)              | 50    | 2112     | 0       | 591    | 1247.7 | 1377     | 1486   | 70    |

### Run 2026-10-26T08:49:12.219Z — 1000 connections × 30s per scenario — hardening round (verify stage): compact bookings list, sort + trigram indexes, NODE_ENV=production, API_WORKERS=auto

| Scenario                                     | Conns | Requests | non-2xx                                                                              | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------ | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 105650   | 0                                                                                    | 248    | 370.6  | 403      | 463    | 3522  |
| GET /projects                                | 1000  | 50765    | 0                                                                                    | 499    | 831.8  | 984      | 2945   | 1692  |
| GET /flats (list, filtered)                  | 1000  | 26527    | 0                                                                                    | 840    | 1520.3 | 1975     | 12976  | 884   |
| GET /blocks/:id/grid                         | 1000  | 39900    | 0                                                                                    | 653    | 1018.5 | 1171     | 4381   | 1330  |
| GET /customers (search)                      | 1000  | 52817    | 0                                                                                    | 499    | 766.7  | 849      | 2028   | 1761  |
| GET /bookings (list)                         | 1000  | 29757    | 0                                                                                    | 862    | 1431.9 | 1652     | 4393   | 992   |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 29457    | 0                                                                                    | 741    | 1303.7 | 1691     | 12423  | 982   |
| GET /bookings/:id                            | 1000  | 29527    | 0                                                                                    | 838    | 1353.4 | 1655     | 8014   | 984   |
| GET /bookings/:id/ledger                     | 1000  | 30926    | 0                                                                                    | 843    | 1257.0 | 1439     | 6219   | 1031  |
| GET /dashboard                               | 1000  | 138918   | 0                                                                                    | 173    | 283.9  | 334      | 2161   | 4631  |
| GET /public/projects (no auth, cached)       | 1000  | 314296   | 0                                                                                    | 87     | 151.1  | 171      | 198    | 10477 |
| GET /public/projects/:slug (no auth, cached) | 1000  | 117804   | 0                                                                                    | 232    | 328.7  | 356      | 421    | 3928  |
| GET /search?q=                               | 1000  | 150305   | 50 (err×25; timeout×25; admitted 150305 = 4987 rps @ p50 150 / p95 264 / p99 360 ms) | 149    | 264.3  | 303      | 359    | 5010  |
| POST /payments (₹100, 50 conns)              | 50    | 1849     | 0                                                                                    | 646    | 1471.6 | 1571     | 1659   | 62    |

### Run 2026-10-26T13:31:16.462Z — 200 connections × 30s per scenario — regression fix: Lua rate limit, Redis budgets that measure Redis (not event-loop lag), cached metric series, one trace lookup, JWT ring fast path; NODE_ENV=production, API_WORKERS=auto

| Scenario                                     | Conns | Requests | non-2xx                                                                           | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | --------------------------------------------------------------------------------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 200   | 97922    | 0                                                                                 | 55     | 107.0  | 122      | 143    | 3265  |
| GET /projects                                | 200   | 52544    | 0                                                                                 | 109    | 169.2  | 186      | 207    | 1752  |
| GET /flats (list, filtered)                  | 200   | 26872    | 0                                                                                 | 215    | 314.6  | 336      | 370    | 896   |
| GET /blocks/:id/grid                         | 200   | 43980    | 0                                                                                 | 130    | 195.1  | 211      | 236    | 1466  |
| GET /customers (search)                      | 200   | 41102    | 0                                                                                 | 138    | 221.3  | 247      | 278    | 1370  |
| GET /bookings (list)                         | 200   | 25629    | 0                                                                                 | 224    | 327.2  | 351      | 394    | 854   |
| GET /bookings (list, If-None-Match → 304)    | 200   | 27902    | 0                                                                                 | 210    | 292.0  | 311      | 341    | 930   |
| GET /bookings/:id                            | 200   | 26370    | 0                                                                                 | 220    | 312.7  | 340      | 375    | 879   |
| GET /bookings/:id/ledger                     | 200   | 27919    | 0                                                                                 | 205    | 305.2  | 329      | 364    | 931   |
| GET /dashboard                               | 200   | 164833   | 0                                                                                 | 33     | 57.8   | 65       | 74     | 5495  |
| GET /public/projects (no auth, cached)       | 200   | 404773   | 0                                                                                 | 13     | 25.7   | 29       | 34     | 13493 |
| GET /public/projects/:slug (no auth, cached) | 200   | 156608   | 0                                                                                 | 34     | 66.8   | 78       | 93     | 5221  |
| GET /search?q=                               | 200   | 116804   | 0                                                                                 | 28     | 212.2  | 228      | 243    | 3894  |
| POST /payments (₹100, 50 conns)              | 50    | 2122     | 22 (err×11; timeout×11; admitted 2122 = 71 rps @ p50 498 / p95 869 / p99 1050 ms) | 498    | 868.8  | 961      | 1049   | 71    |

### Run 2026-10-26T14:02:12.515Z — 1000 connections × 30s per scenario — regression fix: Lua rate limit, Redis budgets that measure Redis (not event-loop lag), cached metric series, one trace lookup, JWT ring fast path; NODE_ENV=production, API_WORKERS=auto

| Scenario                                     | Conns | Requests | non-2xx                                                                           | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | --------------------------------------------------------------------------------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 114553   | 0                                                                                 | 240    | 390.2  | 429      | 515    | 3819  |
| GET /projects                                | 1000  | 57781    | 0                                                                                 | 448    | 733.4  | 836      | 1960   | 1926  |
| GET /flats (list, filtered)                  | 1000  | 31307    | 0                                                                                 | 744    | 1271.5 | 1498     | 9642   | 1044  |
| GET /blocks/:id/grid                         | 1000  | 52170    | 0                                                                                 | 505    | 759.5  | 833      | 3106   | 1739  |
| GET /customers (search)                      | 1000  | 51720    | 0                                                                                 | 487    | 751.1  | 861      | 2946   | 1724  |
| GET /bookings (list)                         | 1000  | 31668    | 0                                                                                 | 708    | 1217.1 | 1438     | 10709  | 1056  |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 30830    | 0                                                                                 | 760    | 1445.7 | 1695     | 9029   | 1028  |
| GET /bookings/:id                            | 1000  | 30335    | 0                                                                                 | 827    | 1309.8 | 1543     | 7061   | 1011  |
| GET /bookings/:id/ledger                     | 1000  | 34162    | 0                                                                                 | 774    | 1165.1 | 1298     | 3798   | 1139  |
| GET /dashboard                               | 1000  | 133069   | 0                                                                                 | 175    | 279.6  | 330      | 2843   | 4436  |
| GET /public/projects (no auth, cached)       | 1000  | 315259   | 0                                                                                 | 84     | 190.3  | 221      | 274    | 10509 |
| GET /public/projects/:slug (no auth, cached) | 1000  | 120077   | 0                                                                                 | 209    | 363.6  | 405      | 562    | 4003  |
| GET /search?q=                               | 1000  | 152933   | 2 (err×1; timeout×1; admitted 152933 = 5054 rps @ p50 143 / p95 267 / p99 387 ms) | 143    | 267.3  | 307      | 387    | 5098  |
| POST /payments (₹100, 50 conns)              | 50    | 1538     | 0                                                                                 | 929    | 1791.0 | 2134     | 2437   | 51    |

## Reliability fixes (2026-10-26)

Closes the four open items of "Regression fix": the `/search` statement cancel, the overload latch, and the slow booking, customer-search
and payment paths. Same box (4 vCPU shared with Postgres, Redis and autocannon), database `kkt_rel` (migrated + demo seed by the production
migrate job, recreated from a template copy before every measurement), Redis db 28, production bundles of the code before and after the
fix run side by side.

### 1. `/search` cancel race: the 300 s hang, reproduced and removed

- **Cause.** `modules/search/index.ts` stopped a slow search with postgres.js `query.cancel()`. That sends an out-of-band cancel request
  for the backend PID, so a cancel that lands after the search finished kills whatever that pooled connection runs next. Worse, postgres.js
  cancels a query that is still waiting in a connection's pipeline by marking it and cancelling it when it becomes active
  (`connection.js:573`), and that path leaves the query, and every query behind it on that connection, without an answer. A control
  script (old budget, 25 ms, statements sleeping 15–35 ms interleaved with ordinary queries and a transaction on a pool of two
  connections) hung the pool within 2–3 rounds in 6 of 6 runs. That is the stuck `GET /masters/payment-modes` of the earlier load test.
- **Fix** (`lib/statementBudget.ts`, used by `/search`; the API has no other `.cancel()`): the search runs on a reserved connection inside
  `BEGIN READ ONLY; SET LOCAL statement_timeout = <budget left>`, ended by `ROLLBACK`, with all three messages pipelined (one round trip).
  PostgreSQL stops only this statement; 57014 still answers 200 with no results. The 150 ms budget still covers the pool wait: a
  reservation that arrives late is released unused. The transaction ends with ROLLBACK, not COMMIT, because the `SET LOCAL` timeout also
  applies to the statement that ends it. A COMMIT cancelled by it left the connection in an aborted transaction, and the next user got
  `25P02`. The first full run showed 21 such 500s; a search-only storm reproduced 26–27 per run, and none have occurred since. If ending
  the transaction fails for any reason, the helper rolls back again before releasing the connection. The per-search budget warning is
  now one summary line per 10 s instead of one line per search (37,000 lines in one 30 s storm).
- **Proof.** `test/integration/search.test.ts`:
  - 40 rounds of statements finishing just before, at and after a 25 ms budget, interleaved with pipelined queries and a transaction on a
    2-connection pool: every foreign statement succeeds, nothing hangs, nothing is left idle in a transaction.
  - A storm of 1–6 ms budgets.
  - `GET /search` blocked by a lock on an app pool of two: it answers `[]` in budget while other routes on the same pool succeed.
  - Another session survives (added by the independent verification): a `pg_sleep(3)` on a second connection stays `active` in
    `pg_stat_activity` and returns normally while searches time out around it, and 100 ms statements queued onto the very pooled
    connections that just ran timed-out searches all succeed. A mutant that sets a session-level `statement_timeout` fails this test.
  - The same stress in a script (1,000 rounds): 3,199 timeouts, 7,000 foreign statements, 0 failures, 0 hangs.
  - `test/unit/statement-budget.test.ts` covers each failure path, including the cancelled end of the transaction.
- **Cost.** A search now reserves a connection instead of being pipelined and sends two more small statements: +13 % API CPU (638 →
  721 µs) and +10 % Postgres CPU (320 → 353 µs) per search at 800 rps in one process. Saturated throughput with 4 workers fell 10–34 %
  (4,429 / 4,425 → 3,158 / 2,921 rps at 200 connections; 4,281 → 4,121 at 1,000, of which 3,642 were admitted). That is still several
  thousand debounced command-palette searches per second. In exchange there are 0 errors and 0 client timeouts at both levels, where
  the old bundle had 4–6 at 200 connections and 46 at 1,000.

### 2. Overload latch: bounded, self-recovering shedding

- **Cause.** `@fastify/under-pressure` with `maxEventLoopUtilization: 0.98` measures utilisation **cumulatively since boot** (its
  default mode). Once a saturated process crosses 0.98 it answers 503 to every request, including `/health` and `/ready` (its hook ignores
  routes). The cheap 503s keep the loop busy, so it only lets go after idle time equal to about 2 % of the whole uptime. Reproduced with
  one process, 1,000 connections × 200 s on `/auth/me`:
  - 96 % of responses were 503 (1,373,757 of 1,427,092), and only 267 rps were admitted against 1,678 unprotected.
  - Probes answered 503 in 140 of 153 samples.
  - Everything stayed 503 for **4.1 s after the load stopped**. That time grows with uptime, and it is why the benchmarks needed pauses.
- **Fix** (`plugins/loadShed.ts`; under-pressure is no longer registered):
  - **In-flight cap** `API_MAX_INFLIGHT`, now **256 per worker by default in production** (0 elsewhere). The count is released when the
    response closes, so shedding stops the moment load drops.
  - **Event-loop pressure** `API_SHED_EVENT_LOOP_DELAY_MS` (default 500 ms), evaluated on each 500 ms window only. It lowers the cap to a
    quarter (never below 8) and restores it under half the threshold (hysteresis). It only lowers the cap, so a process never refuses
    everything, and one quiet window ends it.
  - **Probes never shed:** `/health`, `/ready` and `/metrics`, with and without `/api/v1`.
  - **Cheap 503s:** the hook runs first, the response is written straight to the socket (hijacked: no exception, error handler,
    serializer or onSend hooks), and the request is still counted in `http_requests_total{status="503"}` and in the new
    `http_requests_shed_total{reason}` / `api_event_loop_pressure`. A shed request costs 106 µs of CPU instead of 221 µs on the
    exception path (a bare Node `http` 503 costs 29 µs on this box).
  - Logging is one summary line per 10 s.
- **Result, same reproduction:**

  | 1,000 connections × 200 s on `/auth/me`, then cool-down                                    | before                    | after                                          |
  | ------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------------- |
  | One process: admitted rps                                                                  | 267 (96 % answered 503)   | **730** (cap 256; the rest are cheap 503s)     |
  | One process: probe samples with 503 during load                                            | 140 / 153                 | **0**                                          |
  | One process: time until `/health`, `/ready` and `/auth/me` answer 200 after the load stops | 4.1 s                     | **0.008 s**                                    |
  | 4 workers: admitted rps                                                                    | 3,145 (58 % answered 503) | **3,743** (no 503: 250 connections per worker) |
  | 4 workers: probe samples with 503 during load                                              | 46 / 108                  | **0**                                          |
  | 4 workers: first probes after the load                                                     | 503                       | 200                                            |

  Integration tests (`test/integration/loadshed.test.ts`):
  - Real-HTTP saturation (100 connections, cap 1): probes answer 200 throughout and the server admits again at once.
  - Sustained event-loop lag turns pressure on; probes and a lone request are still served; pressure ends by itself.
  - A single short stall is averaged out.
  - 503 envelope and metrics.
  - `test/unit/load-shed.test.ts` covers the cap rules.

- **Trade-off.** With zero-think-time clients that ignore `Retry-After`, a process at its cap spends CPU answering 503s. In the
  1,000-connection run, 20,941 of about 1.35 M responses (1.5 %) were shed, because cluster round-robin is uneven around 250 connections per
  worker. Raise `API_MAX_INFLIGHT` if a deployment's clients really keep more than 256 requests per worker in flight. The settings are in
  `docs/DEPLOY.md` (runtime knobs) and the metrics in `docs/OBSERVABILITY.md`.

### 3. Slow endpoints

Method of the "Regression fix" section: production bundle, `API_WORKERS=1`, autocannon 100 connections × 15 s, best of 2 per endpoint,
**two interleaved rounds** (before → after → before → after, fresh database copy for each). CPU per request at a fixed rate (booking and
ledger 200 rps, customers 300 rps, payments 30 rps; ticks of the API process and of all Postgres backends divided by requests served).
Every response of the four endpoints (detail and ledger of every seeded booking, compact and full bookings lists, three customer
searches) is byte-identical before and after.

| Endpoint                                  | rps before (r1 / r2) | rps after (r1 / r2) | Δ                           | API CPU µs/req before → after | Postgres CPU µs/req before → after |
| ----------------------------------------- | -------------------- | ------------------- | --------------------------- | ----------------------------- | ---------------------------------- |
| `GET /bookings/:id`                       | 478 / 532            | 960 / 968           | **+91 %**                   | 3,062 → 1,763 (−42 %)         | 1,460 → 1,247 (−15 %)              |
| `GET /bookings/:id/ledger`                | 497 / 543            | 784 / 807           | **+53 %**                   | 2,545 → 1,960 (−23 %)         | 1,522 → 1,054 (−31 %)              |
| `GET /customers?search=kumar`             | 622 / 681            | 775 / 786           | **+20 %**                   | 2,304 → 1,896 (−18 %)         | 592 → 525 (−11 %)                  |
| `POST /payments` (one booking, 100 conns) | 73 / 77              | 89 / 90             | **+19 %** (p99 2.3 → 1.8 s) | 12,278 → 11,122 (−9 %)        | 4,834 → 4,356 (−10 %)              |
| `GET /auth/me` (control, unchanged)       | 1,592 / 1,630        | 1,628 / 1,665       | +2 %                        | 1,060 → 1,072                 | 165 → 159                          |

**Profiles first.** A `--cpu-prof` of `/bookings/:id` put about 17 % of the process in Drizzle building SQL text per request
(`sqlToQuery`, `buildSelection`, `is()`), against 4–8 % in Zod serialisation. The response size (8 KB detail, 2 KB ledger) was not the
cost. On `/customers?search=` query building was 21 % (three statements built per request).

- **Bookings detail and ledger** (`money/services/views.ts`, `lib/compiledSql.ts`):
  - **Statements compiled once.** The related-data statement (co-applicants, parking, revision counts, pending cheques, other charges,
    demands, tower stages, names) is compiled to SQL text once at module load, with named placeholders, and runs as a prepared
    statement. The same goes for the compact-list variant used by `GET /bookings`.
  - **Prepared booking select.** The five-join booking select is a Drizzle prepared query, cached per executor.
  - **Fewer round trips.** The detail reads both revision histories in the same statement, so it makes two round trips instead of four
    (no N+1 anywhere).
  - **Schedule computed once.** It was computed twice per detail: once for `summary.next_installment` and once for `schedule`.
  - **Ledger summary.** It uses its own small statement (pending cheques, charge total, demands, stages) and runs alongside the page.
  - **Nothing trimmed.** The ERP reads `schedule`, `plan_snapshot`, `flat_snapshot`, `summary`, `agreement_revisions` and
    `plan_revisions`; the portal uses its own `/portal` endpoints. The only unread derived field is the ledger's `summary`. Making it
    optional would be breaking under `docs/VERSIONING.md` (required → optional), so it stays and is now cheap. The OpenAPI snapshot is
    unchanged.
- **Customer search** (`lib/list.ts`, `crm/customers.ts`, `crm/customerService.ts`):
  - **Count strategy.** A search runs its page first. A page that is not full (and not past the end) gives the exact total as offset +
    rows, so the count query is skipped. That is the usual case for a search. A full page still counts, keeping the planner estimate
    above 10,000 rows.
  - **Count without the join.** The count no longer joins the relationship manager (a to-one left join no filter reads).
  - **Prepared co-applicant load.** The co-applicant query is prepared once.
  - **Indexes.** With 200,000 customers the four trigram GIN indexes are used: a `BitmapOr` over `full_name`, `phone`, `customer_code` and
    `email` takes 7 ms for a selective term. A common term (about 1,000 hits) is answered by the planner estimate, not a 130 ms exact
    count. The column list is what the masked customer row maps, so it is unchanged.
- **Payments** (`money/services/payments.ts`, `ledger.ts`, `dues.ts`, `common.ts`):
  - **Lock statement.** The booking row lock and the booking advisory lock are one statement. A `MATERIALIZED` CTE takes `FOR UPDATE`
    before the outer select takes `pg_advisory_xact_lock`, so the lock order (row → advisory) holds by construction. The ledger instant is
    still read in its own statement after the locks, because a READ COMMITTED statement that waited for a lock keeps its old snapshot.
  - **Reads pipelined.** After the locks, every read the validation needs goes out in one pipelined round trip on the transaction's
    connection:
    - the idempotent-replay check;
    - payment mode;
    - bank account;
    - cleared bucket or charge total;
    - charge line;
    - company row;
    - notification recipients.

    The checks then run in the original order, so every request gets the same answer.

  - **No re-locking.** The ledger append no longer re-requests locks the caller holds.
  - **Writes pipelined.** Its two reads travel together, and so do its two writes. The last-payment stamp travels with the demand-status
    recompute, whose reads and updates are pipelined too. The audit row travels with the notification.
  - **Shorter critical section.** The booking critical section went from about 22 sequential round trips to about 9. The company-wide
    receipt-sequence section, from `nextNumber` to COMMIT, went from about 14 to about 6.
  - **Unchanged:** every rule (bucket cap, charge cap, date rules, mode, instrument and bank checks, idempotency key on the row, receipt
    numbers allocated last, retry on 40001/40P01) and the lock order. The money, money-hardening, money-review and cross-track-money
    suites pass unchanged, including the concurrency tests (10 parallel payments, payment + reversal, stage completion vs dues runs vs
    payments).
  - **Tried and reverted.** Running the route's two post-commit reads in parallel on the pool. In one benchmark postgres.js then failed
    two payments with `UNSAFE_TRANSACTION` (a `BEGIN` completing on a connection it no longer considered reserved). The cause sits in the
    driver's pool dispatch and was not pinned down; in 6 further runs without that change it did not recur.

### 4. Full load test (production bundle, `API_WORKERS=auto`)

Both bundles were run on the same day, each run on a fresh copy of the seeded database. The "after" tables are the last two runs in this
file. The 200-connection pair was run twice in alternating order:

| Scenario                                         | 200: before (2 runs) | 200: after (2 runs) | 1,000: before | 1,000: after (admitted)    | 1,000 p99: before → after |
| ------------------------------------------------ | -------------------- | ------------------- | ------------- | -------------------------- | ------------------------- |
| `GET /auth/me`                                   | 3,373 / 3,551        | 2,936 / 3,134       | 3,673         | 3,284 (3,241)              | 487 → 571 ms              |
| `GET /projects`                                  | 1,717 / 1,906        | 1,502 / 1,662       | 1,808         | 1,755                      | 2,607 → 1,397 ms          |
| `GET /customers?search=`                         | 1,656 / 1,631        | **1,819 / 2,142**   | 1,928         | **2,132 (2,109)**          | 1,805 → 1,378 ms          |
| `GET /bookings`                                  | 1,021 / 1,037        | 933 / 1,031         | 1,105         | 1,062 (966)                | 6,143 → 8,818 ms          |
| `GET /bookings/:id`                              | 919 / 1,012          | **1,369 / 1,333**   | 1,051         | **1,701 (1,685)**          | 5,639 → **1,187 ms**      |
| `GET /bookings/:id/ledger`                       | 1,030 / 1,101        | **1,655 / 1,259**   | 1,153         | **1,963 (1,944)**          | 5,711 → **945 ms**        |
| `GET /dashboard`                                 | 5,463 / 6,186        | 6,147 / 5,645       | 4,658         | 5,229 (5,185)              | 1,209 → 1,346 ms          |
| `GET /public/projects`                           | 14,143 / 14,885      | 15,023 / 13,332     | 12,474        | 14,200 (13,937)            | 183 → 154 ms              |
| `GET /search?q=`                                 | 4,429 / 4,425        | 3,158 / 2,921       | 4,281         | 4,121 (3,642)              | 384 → 422 ms              |
| `POST /payments` (50 conns)                      | 81 / 81              | **99 / 81**         | 67            | **104**                    | 2,600 → **1,113 ms**      |
| Failed requests (errors + client timeouts + 5xx) | 4 + 6                | **0 + 0**           | 46            | **0** (20,941 shed as 503) |                           |

**Zero-hang evidence:**

- Every run finished within its expected time (454–467 s), and no scenario waited for the 120 s "settle" deadline.
- After every run, 200 sequential `GET /masters/payment-modes` all answered within 2 s (max 15–35 ms), and `/ready` answered 200.
- `pg_stat_activity` showed no connection idle in a transaction.
- The server logs had no `UNSAFE_TRANSACTION`, no `DataRow` protocol error and no level-50 line in the final runs.

**Read with care:**

- The endpoints this round did not touch (`/auth/me`, `/projects`, `/flats`, `/blocks/:id/grid`) came out 3–13 % lower with 4 workers in
  every pairing: three alternating 15 s `/auth/me` pairs gave −1 %, −6 % and −3 %, and the full runs −12 %.
- CPU per request in one process is unchanged for them: `/auth/me` 1,060 → 1,072 µs, `/projects` 1,947 → 1,986 µs, `/public/projects`
  263 → 207 µs. So no per-request cost was found, but the 4-worker gap is not explained either; it is listed as open.
- The bookings list p99 at 1,000 connections is a queueing tail on this box: one run of either bundle has 6–10 s p99s.

### Still open

- Unexplained 3–13 % lower 4-worker throughput on untouched endpoints (see above; no per-request CPU difference measured).
- `/search` gave up 10–34 % of its saturated throughput for correctness. A dedicated small search pool would isolate its reservations
  from the main pool, but it cannot use connection-level timeouts behind PgBouncer (they are role defaults there), so it would keep the
  transaction.
- postgres.js `UNSAFE_TRANSACTION` under pool exhaustion: seen once in a benchmark with extra parallel pool reads (reverted). Not seen
  in any run since, but the driver path is not fully understood.

### Run 2026-10-26T17:45:20.842Z — 200 connections × 30s per scenario — reliability fixes: search budget via SET LOCAL statement_timeout in a read-only transaction, bounded self-recovering load shedding (API_MAX_INFLIGHT=256 production default), compiled/pipelined booking, ledger, customer and payment paths; NODE_ENV=production, API_WORKERS=auto

| Scenario                                     | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------- | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 200   | 88058    | 0       | 63     | 112.6  | 129      | 154    | 2936  |
| GET /projects                                | 200   | 45045    | 0       | 128    | 195.0  | 213      | 237    | 1502  |
| GET /flats (list, filtered)                  | 200   | 25618    | 0       | 226    | 333.4  | 360      | 399    | 854   |
| GET /blocks/:id/grid                         | 200   | 40644    | 0       | 139    | 224.3  | 256      | 301    | 1355  |
| GET /customers (search)                      | 200   | 54557    | 0       | 104    | 162.0  | 177      | 201    | 1819  |
| GET /bookings (list)                         | 200   | 27979    | 0       | 206    | 304.2  | 326      | 355    | 933   |
| GET /bookings (list, If-None-Match → 304)    | 200   | 30963    | 0       | 185    | 281.2  | 305      | 336    | 1032  |
| GET /bookings/:id                            | 200   | 41070    | 0       | 138    | 218.2  | 248      | 290    | 1369  |
| GET /bookings/:id/ledger                     | 200   | 49647    | 0       | 117    | 170.2  | 183      | 201    | 1655  |
| GET /dashboard                               | 200   | 184397   | 0       | 29     | 53.0   | 59       | 69     | 6147  |
| GET /public/projects (no auth, cached)       | 200   | 450701   | 0       | 12     | 24.8   | 28       | 33     | 15023 |
| GET /public/projects/:slug (no auth, cached) | 200   | 189401   | 0       | 28     | 54.9   | 61       | 72     | 6314  |
| GET /search?q=                               | 200   | 94713    | 0       | 54     | 128.8  | 144      | 165    | 3158  |
| POST /payments (₹100, 50 conns)              | 50    | 2960     | 0       | 513    | 1028.6 | 1221     | 1365   | 99    |

### Run 2026-10-26T17:53:13.522Z — 1000 connections × 30s per scenario — reliability fixes: search budget via SET LOCAL statement_timeout in a read-only transaction, bounded self-recovering load shedding (API_MAX_INFLIGHT=256 production default), compiled/pipelined booking, ledger, customer and payment paths; NODE_ENV=production, API_WORKERS=auto

| Scenario                                     | Conns | Requests | non-2xx                                                                        | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |
| -------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------ | ------ | ------ | -------- | ------ | ----- |
| GET /auth/me                                 | 1000  | 98498    | 419 (503×419; admitted 98079 = 3241 rps @ p50 263 / p95 411 / p99 571 ms)      | 262    | 410.4  | 453      | 571    | 3284  |
| GET /projects                                | 1000  | 52655    | 0                                                                              | 489    | 804.8  | 898      | 1397   | 1755  |
| GET /flats (list, filtered)                  | 1000  | 27835    | 490 (503×490; admitted 27345 = 903 rps @ p50 840 / p95 1415 / p99 11327 ms)    | 833    | 1410.6 | 1751     | 11211  | 928   |
| GET /blocks/:id/grid                         | 1000  | 47554    | 102 (503×102; admitted 47452 = 1573 rps @ p50 553 / p95 827 / p99 3787 ms)     | 552    | 827.3  | 911      | 3770   | 1585  |
| GET /customers (search)                      | 1000  | 63941    | 305 (503×305; admitted 63636 = 2109 rps @ p50 406 / p95 670 / p99 1418 ms)     | 404    | 670.0  | 758      | 1378   | 2132  |
| GET /bookings (list)                         | 1000  | 31869    | 2739 (503×2739; admitted 29130 = 966 rps @ p50 797 / p95 1424 / p99 9736 ms)   | 770    | 1389.6 | 1713     | 8818   | 1062  |
| GET /bookings (list, If-None-Match → 304)    | 1000  | 33787    | 1132 (503×1132; admitted 32655 = 1083 rps @ p50 711 / p95 1261 / p99 8590 ms)  | 702    | 1254.0 | 1457     | 8273   | 1126  |
| GET /bookings/:id                            | 1000  | 51035    | 65 (503×65; admitted 50970 = 1685 rps @ p50 529 / p95 854 / p99 1187 ms)       | 528    | 854.0  | 946      | 1187   | 1701  |
| GET /bookings/:id/ledger                     | 1000  | 58877    | 275 (503×275; admitted 58602 = 1944 rps @ p50 467 / p95 728 / p99 946 ms)      | 466    | 728.0  | 815      | 945    | 1963  |
| GET /dashboard                               | 1000  | 156865   | 229 (503×229; admitted 156636 = 5185 rps @ p50 158 / p95 265 / p99 1360 ms)    | 157    | 265.1  | 316      | 1346   | 5229  |
| GET /public/projects (no auth, cached)       | 1000  | 426003   | 1076 (503×1076; admitted 424927 = 13937 rps @ p50 64 / p95 125 / p99 155 ms)   | 64     | 125.0  | 138      | 154    | 14200 |
| GET /public/projects/:slug (no auth, cached) | 1000  | 154074   | 235 (503×235; admitted 153839 = 5018 rps @ p50 178 / p95 303 / p99 417 ms)     | 177    | 302.5  | 340      | 416    | 5136  |
| GET /search?q=                               | 1000  | 123621   | 13874 (503×13874; admitted 109747 = 3642 rps @ p50 247 / p95 354 / p99 430 ms) | 240    | 348.9  | 378      | 422    | 4121  |
| POST /payments (₹100, 50 conns)              | 50    | 3123     | 0                                                                              | 511    | 858.5  | 983      | 1113   | 104   |
