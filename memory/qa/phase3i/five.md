# Phase 3F report speed — kkt_volume — 2026-11-18 23:19 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 10 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Finance | collections | 10,498 | 1004 | 1250 | 23 | 24 | NO |
| Finance | bank-receipts | 4 | 162 | 164 | 3 | 5 | yes |
| Finance | receivables-forecast | 5,903 | 260 | 477 | 22 | 23 | NO |
| Bookings | transfers | 0 | 237 | 461 | 3 | 4 | NO |
| Bookings | booking-health | 1,499 | 194 | 453 | 22 | 22 | NO |

**1/5 within budget** — over: collections, receivables-forecast, transfers, booking-health
