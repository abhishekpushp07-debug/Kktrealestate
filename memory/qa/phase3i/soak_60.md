# 3I load test — no Redis
50 users × 60.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 32075 requests, 8.9 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 4931 | 11 | 52 | 675 |
| bookings_list | 4733 | 35 | 118 | 928 |
| home | 6427 | 373 | 618 | 1481 |
| ledger | 3156 | 10 | 47 | 1073 |
| payment | 1611 | 80 | 264 | 612 |
| report | 8080 | 56 | 326 | 1017 |
| search | 3137 | 9 | 43 | 297 |

RSS MB per worker: start [10.7, 196.6, 264.3] · 10 min [10.7, 294.5, 267.3] · end (60 min) [10.7, 294.4, 272.1]
Re-sign-ins after token expiry: 22
RSS curve (minute, MB per process): 5: [10.7, 293.7, 269.4] · 10: [10.7, 294.5, 267.3] · 15: [10.7, 295.6, 272.9] · 20: [10.7, 298.2, 271.4] · 25: [10.7, 300.8, 271.2] · 30: [10.7, 297.2, 268.3] · 35: [10.7, 299.6, 258.0] · 40: [10.7, 299.1, 250.9] · 45: [10.7, 299.2, 256.4] · 50: [10.7, 297.9, 261.2] · 55: [10.7, 298.6, 255.4] · 60: [10.7, 294.4, 272.1]
