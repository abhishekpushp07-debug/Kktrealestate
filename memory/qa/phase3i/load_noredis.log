# 3I load test — no Redis
50 users × 20 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 10753 requests, 9.0 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 1617 | 9 | 33 | 833 |
| bookings_list | 1559 | 26 | 86 | 454 |
| home | 2109 | 14 | 519 | 1089 |
| ledger | 1061 | 9 | 36 | 805 |
| payment | 528 | 87 | 213 | 818 |
| report | 2779 | 67 | 329 | 1100 |
| search | 1100 | 8 | 28 | 412 |

RSS MB per worker: start [10.7, 283.9, 156.7] · 10 min [10.7, 1757.7, 692.4] · 20 min [10.7, 2487.2, 916.8]
