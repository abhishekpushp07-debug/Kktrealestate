# Phase 3F report speed — kkt_volume — 2026-11-18 23:13 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 10 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 299 | 462 | 25 | 30 | NO |
| Finance | collections | 10,498 | 1027 | 1106 | 23 | 24 | NO |
| Finance | bank-receipts | 4 | 158 | 433 | 3 | 4 | NO |
| Finance | cheques | 3,585 | 200 | 499 | 22 | 23 | NO |
| Finance | outstanding | 1,499 | 291 | 592 | 22 | 23 | NO |
| Finance | receivables-forecast | 5,903 | 245 | 587 | 22 | 23 | NO |
| Bookings | transfers | 0 | 235 | 592 | 4 | 4 | NO |
| Bookings | booking-health | 1,499 | 193 | 576 | 22 | 24 | NO |

**0/8 within budget** — over: customer-status, collections, bank-receipts, cheques, outstanding, receivables-forecast, transfers, booking-health
