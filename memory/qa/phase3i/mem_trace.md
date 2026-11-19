# 3I load test — no Redis
50 users × 12.0 min, think 3-8 s, kkt_volume scratch copy, 2 processes, cores 0,1. 4108 requests, 5.7 req/s. **User-visible errors: 188** {'home RemoteProtocolError': 30, 'report 503': 41, 'payment 503': 7, 'report RemoteProtocolError': 7, 'bookings_list 503': 18, 'home 503': 21, 'search 503': 17, 'ledger 503': 13, 'booking_detail 503': 17, 'report 500': 12, 'ledger RemoteProtocolError': 1, 'payment RemoteProtocolError': 4}

| Action | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| booking_detail | 614 | 585 | 2238 | 4595 |
| bookings_list | 598 | 1382 | 4441 | 7499 |
| home | 825 | 6924 | 20661 | 29175 |
| ledger | 418 | 607 | 2528 | 6406 |
| payment | 199 | 3462 | 9843 | 13234 |
| report | 1042 | 2386 | 7254 | 29159 |
| search | 412 | 597 | 2272 | 4476 |

RSS MB per worker: start [10.7, 221.5, 171.4] · 10 min [10.7, 433.5, 421.9] · 20 min [10.7, 411.2, 493.2]
