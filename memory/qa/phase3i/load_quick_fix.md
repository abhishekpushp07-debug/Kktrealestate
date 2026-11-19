# 3I load test — no Redis
50 users × 6.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 3171 requests, 8.8 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 462 | 11 | 51 | 203 |
| bookings_list | 473 | 43 | 120 | 270 |
| home | 669 | 458 | 791 | 1735 |
| ledger | 297 | 13 | 63 | 221 |
| payment | 153 | 87 | 265 | 571 |
| report | 807 | 139 | 401 | 1011 |
| search | 310 | 11 | 53 | 132 |

RSS MB per worker: start [10.7, 190.5, 280.2] · 10 min None · 20 min [10.7, 308.6, 301.5]
