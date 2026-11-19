# Phase 3F report speed — kkt_volume — 2026-11-18 23:10 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 10 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 304 | 526 | 24 | 28 | NO |
| Finance | collections | 10,498 | 1007 | 1159 | 22 | 23 | NO |
| Finance | bank-receipts | 4 | 159 | 167 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 340 | 904 | 22 | 23 | NO |
| Finance | outstanding | 1,499 | 304 | 610 | 23 | 24 | NO |
| Finance | receivables-forecast | 5,903 | 255 | 580 | 22 | 23 | NO |
| Bookings | transfers | 0 | 238 | 591 | 3 | 4 | NO |
| Bookings | booking-health | 1,499 | 198 | 577 | 22 | 23 | NO |

**1/8 within budget** — over: customer-status, collections, cheques, outstanding, receivables-forecast, transfers, booking-health
