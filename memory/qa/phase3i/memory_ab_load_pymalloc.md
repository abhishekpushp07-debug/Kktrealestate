# 3I load test — no Redis
50 users × 6.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 3133 requests, 8.7 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 500 | 17 | 130 | 334 |
| bookings_list | 465 | 52 | 225 | 496 |
| home | 658 | 578 | 1243 | 2220 |
| ledger | 284 | 16 | 122 | 246 |
| payment | 162 | 122 | 542 | 790 |
| report | 768 | 210 | 616 | 2056 |
| search | 296 | 14 | 108 | 299 |

RSS MB per worker: start [10.8, 193.8, 325.0] · 10 min None · 20 min [10.8, 890.5, 914.0]
