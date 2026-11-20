# Phase 3F report speed — kkt_volume — 2026-11-18 23:06 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 10 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 308 | 496 | 24 | 25 | NO |
| Finance | collections | 10,498 | 1282 | 1386 | 23 | 24 | NO |
| Finance | bank-receipts | 4 | 163 | 171 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 438 | 1028 | 23 | 24 | NO |
| Finance | outstanding | 1,499 | 298 | 622 | 22 | 24 | NO |
| Finance | receivables-forecast | 5,903 | 425 | 430 | 22 | 24 | NO |
| Bookings | transfers | 0 | 242 | 590 | 4 | 5 | NO |
| Bookings | booking-health | 1,499 | 199 | 562 | 22 | 23 | NO |

**1/8 within budget** — over: customer-status, collections, cheques, outstanding, receivables-forecast, transfers, booking-health
