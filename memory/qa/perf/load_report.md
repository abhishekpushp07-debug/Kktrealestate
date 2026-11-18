# Load profile — http://localhost:8002 · stages [100, 300, 600] × 150s · 2026-10-26 00:56

Client: asyncio/httpx in-pod (shares the 1-vCPU sandbox with the server — client overhead inflates latencies at 600 users). Token pool of 8 users; writes use fresh Idempotency-Keys.

| Users | Requests | RPS | p50 ms | p95 ms | p99 ms | 5xx/exception % | worker CPU % | worker RSS MB | server-side p95 (ops) |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 15300 | 101.7 | 897.5 | 1665.2 | 1811.2 | 0.0 | 53.2 | 257.8 | 1418.2 |
| 300 | 13235 | 86.4 | 2991.4 | 5518.7 | 13038.5 | 3.69 | 68.3 | 370.1 | 4164.9 |
| 600 | 9216 | 58.0 | 10339.7 | 19241.4 | 22953.6 | 0.97 | 67.1 | 497.9 | 5030.3 |

## 100 users — per route group

| Group | n | p50 | p95 | p99 | 5xx |
|---|---|---|---|---|---|
| booking_detail | 1298 | 719.6 | 837.3 | 891.5 | 0 |
| bookings | 1354 | 765.9 | 886.6 | 965.6 | 0 |
| bootstrap | 1097 | 1290.7 | 1433.3 | 1495.5 | 0 |
| crm | 1340 | 717.5 | 844.3 | 891.9 | 0 |
| customer_detail | 1332 | 963.8 | 1270.7 | 1370.0 | 0 |
| customers | 1298 | 1224.6 | 1348.6 | 1416.5 | 0 |
| dashboard | 1130 | 1707.4 | 1858.0 | 1934.4 | 0 |
| inventory | 1238 | 969.3 | 1094.4 | 1177.1 | 0 |
| payments | 1336 | 875.2 | 996.3 | 1057.1 | 0 |
| search | 3094 | 781.3 | 1300.2 | 1367.7 | 0 |
| write_lead | 323 | 1074.3 | 1278.4 | 1310.5 | 0 |
| write_payment | 460 | 989.0 | 1141.1 | 1188.5 | 0 |

Mongo opcounters: `{'insert': 1418083, 'query': 935172, 'update': 170660, 'delete': 41063, 'getmore': 3697, 'command': 260931}` · pool: `{'checked_out': 1, 'created': 38, 'closed': 3, 'checkout_failed': 0, 'wait_queue_timeouts': 0}`

## 300 users — per route group

| Group | n | p50 | p95 | p99 | 5xx |
|---|---|---|---|---|---|
| booking_detail | 1143 | 2403.2 | 3380.2 | 13451.1 | 0 |
| bookings | 1190 | 2551.5 | 3108.2 | 12048.7 | 0 |
| bootstrap | 977 | 4086.0 | 5294.5 | 13389.8 | 1 |
| crm | 1176 | 2382.0 | 3722.1 | 11087.6 | 0 |
| customer_detail | 1077 | 3185.6 | 4748.1 | 13343.0 | 0 |
| customers | 1129 | 4046.6 | 5285.7 | 14199.2 | 0 |
| dashboard | 1006 | 5335.3 | 7021.9 | 14574.0 | 486 |
| inventory | 1154 | 3225.0 | 4237.2 | 12101.3 | 0 |
| payments | 1054 | 2907.2 | 4490.5 | 12709.6 | 0 |
| search | 2682 | 2611.0 | 4951.8 | 13254.3 | 1 |
| write_lead | 255 | 3597.1 | 5268.5 | 15537.0 | 0 |
| write_payment | 392 | 3284.6 | 4845.4 | 15643.2 | 0 |

Mongo opcounters: `{'insert': 1418997, 'query': 990369, 'update': 170893, 'delete': 41079, 'getmore': 5365, 'command': 283173}` · pool: `{'checked_out': 0, 'created': 53, 'closed': 5, 'checkout_failed': 0, 'wait_queue_timeouts': 0}`

## 600 users — per route group

| Group | n | p50 | p95 | p99 | 5xx |
|---|---|---|---|---|---|
| booking_detail | 830 | 9527.1 | 19017.6 | 21830.0 | 8 |
| bookings | 782 | 9814.2 | 19430.1 | 21637.5 | 3 |
| bootstrap | 727 | 11328.7 | 19625.3 | 23876.4 | 7 |
| crm | 815 | 9625.9 | 19262.0 | 23679.4 | 10 |
| customer_detail | 756 | 10516.8 | 19796.7 | 22181.8 | 11 |
| customers | 808 | 10846.6 | 18951.9 | 23058.6 | 6 |
| dashboard | 711 | 11778.8 | 19849.4 | 23527.0 | 7 |
| inventory | 775 | 10296.8 | 18707.8 | 23164.1 | 8 |
| payments | 788 | 10083.5 | 18855.0 | 21553.5 | 7 |
| search | 1799 | 10087.5 | 19209.4 | 22710.5 | 16 |
| write_lead | 190 | 10684.4 | 19092.1 | 21516.7 | 4 |
| write_payment | 235 | 11096.3 | 20044.9 | 23423.2 | 2 |

Mongo opcounters: `{'insert': 1419621, 'query': 1028654, 'update': 171110, 'delete': 41090, 'getmore': 6518, 'command': 299089}` · pool: `{'checked_out': 0, 'created': 55, 'closed': 5, 'checkout_failed': 0, 'wait_queue_timeouts': 0}`

## Honest reading (sandbox constraints)
- Server returned **0 × 5xx** across all stages; the "errors" column at 300/600 users are client-side connection drops (httpx RemoteProtocolError) once a single uvicorn worker saturates, plus expected 403s from role-restricted tokens.
- Throughput plateaus at ~100 rps because the preview sandbox runs **one uvicorn worker** (supervisor-managed, not changeable here) and the load generator shares the same CPU (`cpu.max` = 4 cores quota, but the Python event loop is single-threaded). Idle-latency p95 for every screen is < 80 ms; the p95 ≈ 0.8–1.8 s at 100 users is queueing, not slow queries (Mongo p95 per request stays < 30 ms per Server-Timing).
- p95 < 400 ms at 300 users is **not met** in this sandbox. Expected on a real deployment: ≥ 4 workers (`uvicorn --workers 4` / gunicorn) → ~400 rps on this profile, which would satisfy 300 concurrent users with think-time 2–5 s (≈ 60–150 rps).
- Hot-path fixes applied: ORJSON default response class; PDF `build()` moved to `asyncio.to_thread`; concurrent count+page+totals in list routes; cached integrity report; covered index for payment totals.

## Phase E0 re-run (100 / 300 users × 150 s, volume backend :8002) — `load_report_e0.md`, raw `load_raw_e0.csv`
| Users | Requests | RPS | p50 | p95 | 5xx / exceptions | Phase D |
|---|---|---|---|---|---|---|
| 100 | 17,276 | **114.9** | 803 ms | 1,314 ms | **0 / 0** | 101 rps, 0 × 5xx |
| 300 | 14,718 | 96.1 | 2,550 ms | 6,332 ms | **0 / 0** | 486 client `RemoteProtocolError` (dashboard) |

- Root cause of the Phase D "486 × 5xx": they were never server 5xx — the server log has zero 5xx; they were httpx `RemoteProtocolError`s (keep-alive race: server closed an idle connection while the client reused it) that the harness counted as errors, concentrated on the slowest group. Fix: harness retries once on a fresh connection (as browsers do); server-side the dashboard is now served from the read model + 10 s TTL cache (idle p95 61 → 5 ms).
- Hot-path cache (`services/ttlcache.cached`, Redis when `REDIS_URL`, event-bus + write-middleware invalidation): dashboard/home, bootstrap (per user, 5 s), catalogue bundle (versioned), list first pages (5 s). Hit rate during the run: 8,077 hits / 7,654 misses (51 %; 8-user token pool → mostly per-user misses).
- `dbq` (queries/request) now in Server-Timing and the ops ring; avg queries per group during the run: bookings 2.3, payments 3.2, inventory 4.9, customers 5.3, dashboard 5.8, customer_detail 6.2, bootstrap 6.9, booking_detail 7.2, search 7.5, crm 10.7 → restructured: leads board 12 → 1 aggregation (now 4 incl. auth), bootstrap counts run concurrently. Still > 6: booking_detail (7.2: booking + 3 ledgers + demands + payments + flat), search (7.5: one query per entity type) — both are intentional fan-outs; a read model is the next step.
- **Not met:** dashboard/bootstrap server-side p95 ≤ 300 ms at 100 users (measured 1.1–1.3 s). This is CPU queueing on a single uvicorn worker sharing a core with the load generator — Mongo p95 per request stayed < 200 ms and the same routes are 5–25 ms idle. RPS rose 101 → 115 (+14 %) with zero errors; the remaining gap needs ≥ 2–4 workers on the deployment target.
