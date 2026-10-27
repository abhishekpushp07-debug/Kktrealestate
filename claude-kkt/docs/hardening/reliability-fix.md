All four tasks are done; nothing is committed. Typecheck, lint (0/0) and format:check pass. The API unit tests (133) and the 10 requested integration files pass (search, money ×4, crm ×2, system, loadshed, conventions; 118 tests on `kkt_rel_test`, Redis db 29, `--no-file-parallelism`). The final full load test had no errors, client timeouts or hangs at 200 or 1,000 connections.

**1. Search cancel race (fixed, and it was the 300 s hang)**

- **Reproduced:** a control script with the old `query.cancel()` budget on a 2-connection pool hung within 2–3 rounds in 6 of 6 runs. postgres.js cancels a query still queued behind others on a connection; that query, and everything behind it on that connection, never gets an answer.
- **Fix:** new `apps/api/src/lib/statementBudget.ts`. The search runs on a reserved connection inside `BEGIN READ ONLY; SET LOCAL statement_timeout = <budget left>`, ended by `ROLLBACK`, all in one round trip. Waiting for a connection still counts against the 150 ms. A timed-out search still answers 200 with no results. No other `.cancel()` exists in the API.
- **Second bug found by the load test:** the transaction first ended with COMMIT, and the `SET LOCAL` timeout can cancel the COMMIT itself. That left the connection in an aborted transaction, and the next search on it failed with 25P02 (21 server errors in the first full run). It now ends with ROLLBACK and rolls back again before releasing if anything fails; zero since.
- **Proof:**
  - Stress tests in `test/integration/search.test.ts`: interleaved timeouts on a pool of 2, a storm of 1–6 ms budgets, and a lock-blocked `GET /search` next to other routes.
  - `test/unit/statement-budget.test.ts`.
  - A 1,000-round script: 3,199 timeouts, 7,000 other statements, 0 failures, 0 hangs.
- **Cost:** each search reserves a connection instead of sharing one, so it uses about 13 % more API CPU (638 → 721 µs) and 10 % more Postgres CPU. Saturated `/search` throughput with 4 workers fell 10–34 % (about 4,400 → 2,900–3,200 rps at 200 connections). I accepted that trade.

**2. Overload latch (fixed)**

- **Cause:** under-pressure measured event-loop utilisation cumulatively since boot. Once over 0.98 it answered 503 to everything, health and ready included, until idle time made up about 2 % of uptime.
- **Before, one process at 1,000 connections × 200 s:** 96 % of responses were 503, only 267 req/s were admitted, and the server stayed 503 for 4.1 s after the load stopped.
- **Fix (`plugins/loadShed.ts`; under-pressure removed):**
  - An in-flight cap, `API_MAX_INFLIGHT`, now 256 per worker by default in production.
  - Event-loop-delay pressure (`API_SHED_EVENT_LOOP_DELAY_MS`, default 500 ms) checked per 500 ms window, with hysteresis. It only lowers the cap to a quarter (never below 8), so a worker never refuses everything.
  - Health, ready and metrics are never shed.
  - A shed response is written straight to the socket: 106 µs of CPU instead of 221 µs.
- **After:** 730 req/s admitted, probes answered 200 throughout, recovery in 0.008 s.
- **With 4 workers:** 0 503s (before: 58 %), 3,743 req/s admitted (before: 3,145), probes always 200.
- **Side effect:** at 1,000 connections, uneven spread across workers means about 1.5 % of requests now get 503s by design.
- **Docs and tests:** settings in `docs/DEPLOY.md` and `.env.example`; new metrics (`http_requests_shed_total`, `api_event_loop_pressure`) in `docs/OBSERVABILITY.md`. Recovery is covered in `test/integration/loadshed.test.ts`, including a real HTTP saturation test.

**3. Slow endpoints** (one process, 100 connections × 15 s, best of 2, two alternating before/after rounds; every response checked byte-identical before and after)

| Endpoint                   | req/s before → after | API CPU per request |
| -------------------------- | -------------------- | ------------------- |
| `GET /bookings/:id`        | ~505 → ~964 (+91 %)  | −42 %               |
| `GET /bookings/:id/ledger` | ~520 → ~796 (+53 %)  | −23 %               |
| `GET /customers?search=`   | ~652 → ~781 (+20 %)  | −18 %               |
| `POST /payments`           | ~75 → ~89.5 (+19 %)  | −9 %                |

- **Bookings:** profiling showed per-request SQL building in Drizzle, not response size, was the cost. The big related-data query is now built once and reused, and the detail makes 2 database round trips instead of 4.
- **No fields trimmed:** the ERP reads everything in the detail. The only unread field (the ledger's `summary`) can't be made optional without breaking the API versioning rules (`docs/VERSIONING.md`), so it stays and is now cheap to compute.
- **Customer search:** a page that isn't full gives the exact total, so the count query is skipped. The trigram indexes are used at 200,000 customers (7 ms).
- **Payments:** the booking row lock and advisory lock are now one statement with the same lock order. The rest of the transaction's reads and writes are sent in batches, cutting the locked section from about 22 round trips to about 9. Every money rule and every money test is unchanged.

**4. Full load test and "Reliability fixes" section**

- Both bundles were run the same day: production build, 4 workers, 200 and 1,000 connections, ports 4930–4970. The 200-connection pair was run twice.
- After every run:
  - 200 checks of `/masters/payment-modes` all answered in under 35 ms.
  - No database connection was left inside a transaction.
  - No `UNSAFE_TRANSACTION` or protocol errors in the logs.
- Before / after at 1,000 connections:
  - `/bookings/:id` p99 5.6 s → 1.2 s.
  - Ledger p99 5.7 s → 0.9 s.
  - Payments 67 → 104 req/s.
  - Failed requests 46 → 0.
- The section is appended to `docs/PERFORMANCE.md` with both final run tables and formatted with prettier.
- `docs/STATUS.md` and `docs/ARCHITECTURE.md` are updated. Two older docs (`docs/hardening/perf-bisect-fix.md`, `perf-verify.md`) only needed prettier to make format:check pass.

**Still open (recorded in the doc):**

- **Untouched endpoints slower with 4 workers:** `/auth/me` and `/projects` came out 3–13 % lower in every 4-worker comparison. CPU per request in one process is unchanged (±2 %), so I couldn't find a cause; it may be machine noise, but that isn't proven.
- **Rare postgres.js transaction error:** postgres.js twice reported `UNSAFE_TRANSACTION` (a transaction start it no longer tracked) in one payment benchmark. That run had the payment route's two reads after commit running in parallel; I reverted that and it hasn't recurred in 6 runs and the full load tests. The root cause in the driver isn't pinned down.

Pre-change and final bundles, scripts and logs are in `/tmp/claude-0/-home-user/78285bda-7231-5286-85fe-a30697a92e0b/scratchpad/rel`. Databases `kkt_rel`, `kkt_rel_test`, `kkt_rel_acc` and the template copy `kkt_rel_tpl` are kept.
