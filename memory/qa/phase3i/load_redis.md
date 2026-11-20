# 3I load test — with local Redis (stopped 60 s at minute 10)
50 users × 20.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 10769 requests, 9.0 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 1647 | 9 | 38 | 265 |
| bookings_list | 1604 | 27 | 82 | 642 |
| home | 2156 | 40 | 329 | 1009 |
| ledger | 1042 | 9 | 27 | 218 |
| payment | 550 | 65 | 246 | 637 |
| report | 2756 | 46 | 310 | 677 |
| search | 1014 | 8 | 35 | 194 |

RSS MB per worker: start [10.7, 209.0, 275.4] · 10 min [10.7, 324.7, 279.3] · end (20 min) [10.7, 326.7, 295.5]
Re-sign-ins after token expiry: 6
RSS curve (minute, MB per process): 5: [10.7, 326.5, 289.3] · 10: [10.7, 324.7, 279.3] · 15: [10.7, 323.4, 288.4] · 20: [10.7, 325.9, 295.0]
Redis stopped at 600 s, back at 660 s. Redis card (one process): {'configured': True, 'state': 'ok', 'daily_budget': 19000, 'hit_rate': 0.12, 'commands_today': 7260, 'commands_month': 7260, 'month_budget': 500000, 'last_error': 'ConnectionError: Error UNKNOWN while writing to socket. Connection lost.'}
Redis commandstats since it came back: cmdstat_hello:calls=5 cmdstat_get:calls=2939 cmdstat_set:calls=508
