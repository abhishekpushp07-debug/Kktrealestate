# Phase 3F report speed — kkt_volume — 2026-11-18 20:31 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-statement | 18 | 24 | 30 | 10 | 11 | yes |
| Finance | outstanding | 1,499 | 354 | 475 | 23 | 27 | NO |
| Finance | other-charges | 1,497 | 207 | 351 | 24 | 26 | NO |
| Bookings | plan-position | 1,499 | 238 | 385 | 21 | 23 | NO |
| Bookings | transfers | 0 | 284 | 473 | 3 | 4 | NO |
| Bookings | sales-team | 2 | 229 | 433 | 3 | 4 | NO |
| Bookings | booking-health | 1,499 | 241 | 468 | 22 | 23 | NO |
| Project & inventory | stacking-plan | 2,170 | 176 | 420 | 27 | 28 | NO |
| Project & inventory | landowner | 0 | 143 | 145 | 3 | 3 | yes |
| Project & inventory | sales-velocity | 36 | 156 | 402 | 4 | 4 | NO |
| Leads | follow-ups | 7 | 64 | 67 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 129 | 375 | 3 | 4 | NO |

**3/12 within budget** — over: outstanding, other-charges, plan-position, transfers, sales-team, booking-health, stacking-plan, sales-velocity, team-pipeline
