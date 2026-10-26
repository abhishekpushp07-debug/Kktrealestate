# Load profile — http://localhost:8002 · stages [100, 300] × 150s · 2026-10-26 01:48

Client: asyncio/httpx in-pod (shares the 1-vCPU sandbox with the server — client overhead inflates latencies at 600 users). Token pool of 8 users; writes use fresh Idempotency-Keys.

| Users | Requests | RPS | p50 ms | p95 ms | p99 ms | 5xx/exception % | worker CPU % | worker RSS MB | server-side p95 (ops) |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 17276 | 114.9 | 803.4 | 1314.0 | 1686.9 | 0.0 | None | None | 1143.3 |
| 300 | 14718 | 96.1 | 2549.8 | 6332.2 | 12757.2 | 0.0 | None | None | 3423.0 |

## 100 users — per route group

| Group | n | p50 | p95 | p99 | 5xx |
|---|---|---|---|---|---|
| booking_detail | 1457 | 686.5 | 809.9 | 984.7 | 0 |
| bookings | 1535 | 619.8 | 813.2 | 909.2 | 0 |
| bootstrap | 1255 | 1120.1 | 1334.0 | 1475.7 | 0 |
| crm | 1523 | 685.2 | 821.9 | 934.3 | 0 |
| customer_detail | 1482 | 933.6 | 1225.2 | 1322.3 | 0 |
| customers | 1478 | 1062.7 | 1263.8 | 1490.6 | 0 |
| dashboard | 1288 | 757.0 | 1752.6 | 1903.2 | 0 |
| inventory | 1398 | 911.9 | 1053.8 | 1407.3 | 0 |
| payments | 1492 | 827.4 | 958.8 | 1096.4 | 0 |
| search | 3488 | 746.9 | 1248.2 | 1371.8 | 0 |
| write_lead | 360 | 1027.7 | 1235.9 | 1383.4 | 0 |
| write_payment | 520 | 940.2 | 1117.4 | 1308.5 | 0 |

Mongo opcounters: `{'insert': 1802507, 'query': 1387441, 'update': 221598, 'delete': 58775, 'getmore': 7260, 'command': 390097}` · pool: `{'checked_out': 1, 'created': 43, 'closed': 0, 'checkout_failed': 0, 'wait_queue_timeouts': 0}`

## 300 users — per route group

| Group | n | p50 | p95 | p99 | 5xx |
|---|---|---|---|---|---|
| booking_detail | 1320 | 2212.7 | 4956.3 | 12881.6 | 0 |
| bookings | 1308 | 2058.8 | 5409.9 | 11815.0 | 0 |
| bootstrap | 1099 | 3486.5 | 7075.1 | 11910.0 | 0 |
| crm | 1285 | 2247.0 | 5075.3 | 11426.3 | 0 |
| customer_detail | 1207 | 2964.5 | 5402.3 | 12590.9 | 0 |
| customers | 1223 | 3476.9 | 6361.5 | 14403.8 | 0 |
| dashboard | 1103 | 2803.5 | 10347.4 | 15818.8 | 0 |
| inventory | 1287 | 2945.6 | 6379.7 | 12184.3 | 0 |
| payments | 1183 | 2656.0 | 5284.9 | 11449.6 | 0 |
| search | 2987 | 2409.5 | 5657.3 | 12373.9 | 0 |
| write_lead | 290 | 3313.3 | 6018.2 | 13385.7 | 0 |
| write_payment | 426 | 3005.0 | 7135.6 | 12754.3 | 0 |

Mongo opcounters: `{'insert': 1804383, 'query': 1456644, 'update': 222066, 'delete': 58868, 'getmore': 7691, 'command': 416439}` · pool: `{'checked_out': 0, 'created': 50, 'closed': 3, 'checkout_failed': 0, 'wait_queue_timeouts': 0}`
