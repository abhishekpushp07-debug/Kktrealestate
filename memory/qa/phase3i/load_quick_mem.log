# 3I load test — no Redis
50 users × 6.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 3188 requests, 8.9 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 472 | 9 | 39 | 197 |
| bookings_list | 518 | 30 | 92 | 460 |
| home | 658 | 127 | 564 | 844 |
| ledger | 287 | 9 | 34 | 124 |
| payment | 149 | 94 | 255 | 425 |
| report | 810 | 114 | 364 | 1205 |
| search | 294 | 8 | 32 | 169 |

RSS MB per worker: start [10.7, 279.9, 179.0] · 10 min None · 20 min [10.7, 1147.6, 478.0]
