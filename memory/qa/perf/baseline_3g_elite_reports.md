# Phase 3F report speed — kkt_volume — 2026-11-18 15:33 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 320 | 405 | 24 | 37 | NO |
| Customers | customer-statement | 18 | 25 | 39 | 10 | 22 | yes |
| Customers | customer-ageing | 1,497 | 222 | 302 | 24 | 37 | NO |
| Customers | advance-holders | 888 | 224 | 316 | 18 | 32 | NO |
| Customers | call-list | 1,497 | 250 | 329 | 24 | 36 | NO |
| Customers | kyc-pending | 1,499 | 262 | 344 | 23 | 36 | NO |
| Customers | payment-behaviour | 1,490 | 406 | 513 | 10 | 24 | NO |
| Customers | customer-directory | 1,975 | 242 | 371 | 13 | 26 | NO |
| Customers | cancelled-customers | 1 | 26 | 148 | 4 | 17 | yes |
| Finance | collections | 9,482 | 1085 | 1517 | 24 | 34 | NO |
| Finance | day-book | 231 | 101 | 140 | 4 | 8 | yes |
| Finance | bank-receipts | 5 | 552 | 837 | 4 | 11 | NO |
| Finance | cheques | 3,585 | 441 | 714 | 24 | 34 | NO |
| Finance | bills-vs-collection | 115 | 248 | 507 | 5 | 17 | NO |
| Finance | outstanding | 1,499 | 308 | 605 | 24 | 36 | NO |
| Finance | cash-vs-account | 1,499 | 245 | 281 | 23 | 35 | yes |
| Finance | other-charges | 1,497 | 208 | 530 | 24 | 35 | NO |
| Finance | receivables-forecast | 5,904 | 1142 | 1785 | 24 | 33 | NO |
| Finance | waivers | 0 | 47 | 77 | 4 | 11 | yes |
| Bookings | booking-register | 1,500 | 246 | 616 | 23 | 34 | NO |
| Bookings | sales-summary | 160 | 222 | 617 | 4 | 7 | NO |
| Bookings | discount-register | 25 | 66 | 461 | 4 | 16 | NO |
| Bookings | plan-position | 1,499 | 249 | 672 | 23 | 34 | NO |
| Bookings | agreements | 1,499 | 256 | 668 | 23 | 34 | NO |
| Bookings | cancellations | 0 | 49 | 77 | 3 | 11 | yes |
| Bookings | transfers | 0 | 291 | 758 | 3 | 10 | NO |
| Bookings | sales-team | 2 | 258 | 725 | 4 | 8 | NO |
| Bookings | realised-rate | 1,499 | 254 | 730 | 23 | 34 | NO |
| Bookings | booking-health | 1,499 | 254 | 764 | 23 | 35 | NO |
| Project & inventory | project-statement | 174 | 74 | 104 | 7 | 19 | yes |
| Project & inventory | inventory-status | 2,170 | 178 | 730 | 26 | 39 | NO |
| Project & inventory | stacking-plan | 2,170 | 204 | 740 | 29 | 41 | NO |
| Project & inventory | price-list | 669 | 160 | 165 | 12 | 24 | yes |
| Project & inventory | hold-register | 4 | 157 | 673 | 4 | 13 | NO |
| Project & inventory | landowner | 0 | 144 | 172 | 4 | 13 | yes |
| Project & inventory | parking | 132 | 22 | 39 | 4 | 17 | yes |
| Project & inventory | construction-vs-plan | 46 | 196 | 726 | 4 | 16 | NO |
| Project & inventory | stage-bills | 36 | 202 | 755 | 4 | 14 | NO |
| Project & inventory | sales-velocity | 36 | 164 | 719 | 4 | 18 | NO |
| Leads | lead-funnel | 7 | 147 | 176 | 4 | 12 | yes |
| Leads | lead-register | 1,498 | 87 | 92 | 4 | 5 | yes |
| Leads | source-performance | 5 | 140 | 713 | 3 | 6 | NO |
| Leads | follow-ups | 7 | 65 | 79 | 4 | 11 | yes |
| Leads | visit-register | 6 | 81 | 634 | 4 | 8 | NO |
| Leads | visit-conversion | 2 | 51 | 86 | 4 | 10 | yes |
| Leads | lost-leads | 1 | 70 | 86 | 4 | 7 | yes |
| Leads | response-time | 1,498 | 72 | 81 | 4 | 16 | yes |
| Leads | team-pipeline | 2 | 136 | 708 | 4 | 13 | NO |
| Leads | lead-ageing | 7 | 67 | 89 | 4 | 16 | yes |
| Customers | service-sla | 9 | 56 | 619 | 4 | 6 | NO |

**17/50 within budget** — over: customer-status, customer-ageing, advance-holders, call-list, kyc-pending, payment-behaviour, customer-directory, collections, bank-receipts, cheques, bills-vs-collection, outstanding, other-charges, receivables-forecast, booking-register, sales-summary, discount-register, plan-position, agreements, transfers, sales-team, realised-rate, booking-health, inventory-status, stacking-plan, hold-register, construction-vs-plan, stage-bills, sales-velocity, source-performance, visit-register, team-pipeline, service-sla
