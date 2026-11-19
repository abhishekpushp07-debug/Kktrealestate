# Phase 3F report speed — kkt_volume — 2026-11-18 23:20 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 10 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 299 | 311 | 24 | 30 | NO |
| Finance | collections | 10,498 | 839 | 930 | 23 | 24 | NO |
| Finance | bank-receipts | 4 | 166 | 167 | 3 | 4 | yes |
| Finance | outstanding | 1,499 | 302 | 311 | 23 | 24 | NO |
| Finance | receivables-forecast | 5,903 | 250 | 260 | 22 | 24 | yes |
| Bookings | transfers | 0 | 237 | 244 | 3 | 4 | yes |
| Bookings | booking-health | 1,499 | 195 | 202 | 23 | 23 | yes |

**4/7 within budget** — over: customer-status, collections, outstanding
