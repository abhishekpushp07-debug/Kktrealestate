# 3I load test — no Redis
50 users × 20.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 10765 requests, 9.0 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 1648 | 9 | 91 | 293 |
| bookings_list | 1586 | 27 | 153 | 1028 |
| home | 2170 | 23 | 420 | 902 |
| ledger | 1037 | 9 | 86 | 217 |
| payment | 540 | 69 | 296 | 920 |
| report | 2720 | 48 | 316 | 852 |
| search | 1064 | 8 | 68 | 859 |

RSS MB per worker: start [10.7, 207.0, 264.6] · 10 min [10.7, 273.8, 279.2] · end (20 min) [10.7, 293.6, 291.9]
Re-sign-ins after token expiry: 7
RSS curve (minute, MB per process): 5: [10.7, 270.3, 287.9] · 10: [10.7, 273.8, 279.2] · 15: [10.7, 281.1, 289.2] · 20: [10.7, 290.6, 291.9]
