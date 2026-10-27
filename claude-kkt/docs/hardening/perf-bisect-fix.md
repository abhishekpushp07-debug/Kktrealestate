The pipeline part of the regression is found and fixed, but most of the reported 30–55 % drop turned out to be the box itself being slower on the day of the re-run. I re-measured the baseline commit `1a7d012` on today's box: `/auth/me` does 1,586–1,792 rps in one process (the doc's tuning run says 2,571), and 2,982–3,123 rps with 4 workers (doc: 5,319). Measured side by side, the hardened bundle (`1f4d32b`) was about 5–20 % slower on the pipeline, and that cost is now gone. Typecheck, lint (0/0), format:check, the API unit tests (120) and all 46 API integration files (588 tests, `kkt_perf_test`, Redis db 26, `--no-file-parallelism`) pass.

Throughput on this 4-vCPU box moved by about ±10 % between back-to-back runs of the same bundle. So besides req/s I measured API CPU time per request at a fixed request rate, which doesn't depend on box speed.

## Bisect (one process, `kkt_perf`)

| Stage                 | `/auth/me` rps | `/public/projects` rps | `/projects` rps | `/bookings` rps | CPU µs/req: `/auth/me` · `/public/projects` · `/projects` |
| --------------------- | -------------- | ---------------------- | --------------- | --------------- | --------------------------------------------------------- |
| `1a7d012` baseline    | 1,586          | 5,948                  | 725             | 218             | 1,011 · 260 · 2,085                                       |
| `c788f31` foundation  | 1,735          | 5,384                  | 756             | 210             | 1,028 · 253 · 1,936                                       |
| `e744975` tracks      | 1,555          | 4,560                  | 666             | 455             | 1,053 · 250 · 2,034                                       |
| `36010c0` integration | 1,646          | 4,640                  | 708             | 492             | 1,040 · 276 · 2,101                                       |
| `1f4d32b` verify      | 1,525          | 4,776                  | 704             | 487             | 1,077 · 293 · 2,079                                       |
| fix                   | 1,533          | 5,549                  | 687             | 442             | 1,029 · 223 · 2,099                                       |

The cost came in with `e744975` (auth Redis wrappers, telemetry plugin, JWT key ring) and with `36010c0`/`1f4d32b` (per-command Redis timeout, `cached()` budget). The foundation stage costs nothing measurable. `/bookings` got faster from `e744975` on because the list now sends compact rows.

## Root causes (file:line in `1f4d32b`) and fixes

1. **`lib/rateLimit.ts:20`**: the rate limit sent five Redis commands (`MULTI`, `INCR`, `EXPIRE`, `GET`, `EXEC`) on every public request, each now with its own ioredis timer. That was about 40 of 242 µs on the cached public route. It is now one Lua script call (`EVALSHA`, loaded with `EVAL` the first time), with the same keys, weighting, expiry and 429 behaviour.
2. **`plugins/auth.ts:88-110` and `:294-312`, `lib/cache.ts:24-36`**: every hot-path Redis call (2–3 per request) paid for an async wrapper, a `Promise.race`, an extra promise and a timer. `withinBudget` is now one promise and one timer, and the auth plugin reuses it.
3. **Same budgets**: they were timing the busy event loop rather than Redis. Under load the 250 ms auth timer fired while Redis's reply was already waiting, and the request fell back to the database query. That happened 3,056 times in the `1f4d32b` 1,000-connection run. The rejection now waits one event-loop step, so a reply that has already arrived wins. The final 1,000-connection run had 0 fallbacks, and the Redis-outage tests pass unchanged.
4. **`plugins/telemetry.ts:50-58`, `lib/metrics.ts:111`**: each request did two in-flight gauge updates, two active-span lookups, and built and validated label objects twice. Now the gauge reads a plain counter when scraped, there is one span lookup, and the counter/histogram children are cached per route/method/status. Metric names, labels and values are unchanged.
5. **`lib/jwt.ts:53`, `:89`**: the key ring was rebuilt and joined on every request, and the token header was decoded twice. Now there's an allocation-free check, and with a single key the header lookup is skipped.
6. **`plugins/loadShed.ts:28`** (minor): one closure per request is now one shared function.

I checked these and found no cost:

- Redis and Postgres round trips per request are identical to the baseline.
- The idempotency plugin does no I/O on GET.
- Database timeouts are per-connection startup settings, and prepared statements are still on.
- With no OTEL endpoint, tracing does nothing.
- The pino mixin only runs per log line.
- Zod is not in jitless mode.
- Trust-proxy parsing, the error reporter and hook style cost nothing measurable.
- The ioredis per-command timeout makes no measurable difference, so I kept it.

I tried ioredis auto-pipelining and dropped it: +12 % on `/auth/me`, but −7 % on `/projects`.

## Final numbers

- **One process, three interleaved rounds** (baseline → `1f4d32b` → fix):
  - `/auth/me`: 1,596 → 1,524 → 1,533 (−4.0 %)
  - `/public/projects`: 5,310 → 4,649 → 5,549 (+4.5 %)
  - `/projects`: 720 → 669 → 687 (−4.6 %)
  - `/bookings`: 208 → 454 → 442
  - All four are within 5 % of the baseline or better, but `/auth/me` and `/projects` only just, and both are inside the ±10 % run-to-run noise.
- **CPU per request vs baseline**: `/auth/me` +1.8 %, `/public/projects` −14 %, `/projects` +0.7 %.
- **Full load test, 4 workers, 200 connections** (fix vs `1f4d32b` vs two baseline runs):
  - `/auth/me` 3,265 vs 2,932 vs 3,123 / 2,982
  - `/projects` 1,752 vs 1,758 vs ~1,600
  - `/public/projects` 13,493 vs 10,836 vs 11,350 / 12,967
- **Full load test, 1,000 connections**: `/auth/me` 3,819 vs 3,600 vs 3,695 / 3,808. The baseline had 440 and 866 failed or timed-out requests on the bookings list at this level; the fix had none.

## Open problems

- **`/bookings/:id` and its ledger are still 20–30 % slower than the baseline.** They run the same number of queries; the hardening round added fields to the booking detail response, which costs more to build and serialise. That is module work, not pipeline overhead, so I didn't change it.
- **`/customers?search=` is 5–15 % slower and `POST /payments` 3–30 % slower** in the full-load comparisons. I left them alone and didn't profile them. My guess is module work like the booking routes (payments now take ordered locks and write an idempotency row), but that is unverified.
- **The final full run had a stuck request.** At 200 connections there were 22 failures on `POST /payments` (11 client timeouts). Then the 1,000-connection half aborted because one request (`GET /masters/payment-modes`) got no answer for 300 s; I re-ran that half separately and it was clean. My best guess is the `/search` statement cancel, which already existed in the baseline and can hit a neighbouring query on the same database connection. A targeted search stress test didn't reproduce the hang on either the fix or the baseline.
- **The server can lock itself into refusing everything.** The overload guard in `app.ts`, unchanged since the baseline, can latch into answering every request with 503 under sustained saturation. My benchmarks pause between runs to avoid it.

## Files and docs

- **Code** (in `/home/user/Kktrealestate/claude-kkt/apps/api/src`): `lib/rateLimit.ts`, `lib/cache.ts`, `lib/jwt.ts`, `lib/metrics.ts`, `plugins/auth.ts`, `plugins/telemetry.ts`, `plugins/loadShed.ts`, `plugins/redis.ts` (comment only).
- **Tests**: new `apps/api/test/unit/rate-limit.test.ts`; additions to `test/unit/cache.test.ts` and `test/unit/metrics.test.ts`.
- **Docs**: `docs/PERFORMANCE.md` has the new "Regression fix" section (bisect table, root causes, before/after, open items) plus the fix's 200- and 1,000-connection run tables, formatted with prettier. `docs/STATUS.md`'s load-test row and open item are updated.

A WIP checkpoint commit (`facae5f`) already contains most of the source changes and tests. The event-loop budget fix in `lib/cache.ts`, the cache test, a formatting change to the metrics test, and both docs are still uncommitted. The worktrees are removed, as are the temporary databases `kkt_lt` and `kkt_perf_tpl`; `kkt_perf` is kept.
