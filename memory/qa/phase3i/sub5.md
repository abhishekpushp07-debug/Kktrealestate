# Phase 3F report speed — kkt_volume — 2026-11-18 23:17 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 10 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Finance | outstanding | 1,499 | 310 | 342 | 22 | 29 | NO |
| Finance | receivables-forecast | 5,903 | 281 | 309 | 22 | 54 | NO |
| Bookings | transfers | 0 | 258 | 287 | 3 | 4 | yes |
| Bookings | booking-health | 1,499 | 239 | 260 | 21 | 22 | yes |

**2/4 within budget** — over: outstanding, receivables-forecast
