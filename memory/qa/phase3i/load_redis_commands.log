# 3I load test — with local Redis (stopped 60 s at minute 10)
50 users × 9.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 4809 requests, 8.9 req/s. **User-visible errors: 0** 

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 741 | 10 | 81 | 400 |
| bookings_list | 698 | 34 | 134 | 537 |
| home | 966 | 273 | 704 | 1197 |
| ledger | 442 | 10 | 67 | 417 |
| payment | 255 | 75 | 275 | 941 |
| report | 1231 | 163 | 507 | 1449 |
| search | 476 | 9 | 47 | 192 |

RSS MB per worker: start [10.7, 292.1, 190.0] · 10 min None · 20 min [10.7, 1682.2, 775.5]
Redis stopped at None s, back at None s. Redis card (one process): {'configured': True, 'state': 'ok', 'hit_rate': 0.018, 'commands_today': 18791, 'commands_month': 18791, 'month_budget': 500000, 'last_error': None}
