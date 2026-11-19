# 3I load test — with local Redis (stopped 60 s at minute 10)
50 users × 20 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 10729 requests, 8.9 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 1650 | 9 | 52 | 518 |
| bookings_list | 1592 | 27 | 114 | 601 |
| home | 2147 | 15 | 578 | 1382 |
| ledger | 1032 | 9 | 50 | 446 |
| payment | 551 | 87 | 246 | 878 |
| report | 2710 | 87 | 398 | 1435 |
| search | 1047 | 8 | 48 | 533 |

RSS MB per worker: start [10.7, 278.5, 298.6] · 10 min [10.7, 568.5, 1849.6] · 20 min [10.7, 786.0, 2667.8]
Redis stopped at 600 s, back at 660 s. Redis card (one process): None
