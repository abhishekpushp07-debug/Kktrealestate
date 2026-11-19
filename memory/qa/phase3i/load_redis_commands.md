# 3I load test — with local Redis (stopped 60 s at minute 10)
50 users × 8.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 4243 requests, 8.8 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 637 | 11 | 49 | 252 |
| bookings_list | 618 | 39 | 131 | 322 |
| home | 847 | 408 | 663 | 1144 |
| ledger | 418 | 11 | 47 | 236 |
| payment | 205 | 87 | 238 | 596 |
| report | 1080 | 57 | 388 | 599 |
| search | 438 | 10 | 46 | 191 |

RSS MB per worker: start [10.8, 193.6, 275.4] · 10 min None · end (8 min) [10.8, 293.8, 296.1]
Re-sign-ins after token expiry: 0
RSS curve (minute, MB per process): 5: [10.8, 286.6, 291.4]
Redis stopped at None s, back at None s. Redis card (one process): {'configured': True, 'state': 'ok', 'daily_budget': 19000, 'hit_rate': 0.003, 'commands_today': 4060, 'commands_month': 4060, 'month_budget': 500000, 'last_error': None}
Redis commandstats since it came back: cmdstat_set:calls=528 cmdstat_get:calls=3553 cmdstat_hello:calls=6 cmdstat_flushall:calls=1
