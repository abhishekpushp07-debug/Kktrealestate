# 3I load test — no Redis
50 users × 6.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 3186 requests, 8.8 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 464 | 11 | 52 | 231 |
| bookings_list | 461 | 34 | 125 | 435 |
| home | 641 | 244 | 674 | 1154 |
| ledger | 305 | 10 | 46 | 191 |
| payment | 167 | 74 | 238 | 441 |
| report | 804 | 146 | 470 | 1140 |
| search | 344 | 9 | 47 | 198 |

RSS MB per worker: start [10.7, 282.9, 185.7] · 10 min None · 20 min [10.7, 1168.9, 423.5]
