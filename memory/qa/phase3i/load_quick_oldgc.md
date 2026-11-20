# 3I load test — no Redis
50 users × 6.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 3174 requests, 8.8 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 483 | 10 | 41 | 382 |
| bookings_list | 476 | 30 | 94 | 329 |
| home | 642 | 361 | 619 | 1863 |
| ledger | 295 | 9 | 38 | 150 |
| payment | 164 | 92 | 248 | 511 |
| report | 779 | 141 | 389 | 1307 |
| search | 335 | 9 | 38 | 158 |

RSS MB per worker: start [10.7, 167.7, 273.7] · 10 min None · 20 min [10.7, 949.9, 694.6]
