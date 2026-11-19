# 3I load test — no Redis
50 users × 6.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 3136 requests, 8.7 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 472 | 11 | 103 | 734 |
| bookings_list | 495 | 35 | 198 | 650 |
| home | 620 | 605 | 1444 | 2790 |
| ledger | 307 | 11 | 136 | 722 |
| payment | 161 | 85 | 497 | 784 |
| report | 780 | 153 | 741 | 2298 |
| search | 301 | 10 | 128 | 775 |

RSS MB per worker: start [10.7, 145.8, 155.4] · 10 min None · 20 min [10.7, 2333.3, 1015.2]
