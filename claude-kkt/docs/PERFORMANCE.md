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
  Bisecting it is the first item for the next performance pass (docs/STATUS.md). Every list and detail endpoint still meets p95 < 300 ms at 200
  connections except `/flats`, `/bookings`, `/bookings/:id` and `/bookings/:id/ledger` (302–337 ms); at 1,000 zero-think-time
  connections only `/dashboard`, `/public/projects` and `/search` do (`/public/projects/:slug` p95 329 ms, `/auth/me` 371 ms).

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
