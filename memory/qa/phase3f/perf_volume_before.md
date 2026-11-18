# Phase 3F report speed — kkt_volume — 2026-11-18 07:12 UTC

Scratch copy of `kkt_volume`, private backend. first = first page after a write (5 samples, every cache stale); cached = 20 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 360 | 417 | 151 | 165 | NO |
| Customers | customer-statement | 18 | 48 | 53 | 26 | 43 | yes |
| Customers | customer-ageing | 1,497 | 241 | 336 | 38 | 50 | NO |
| Customers | advance-holders | 888 | 237 | 413 | 26 | 39 | NO |
| Customers | call-list | 1,497 | 284 | 358 | 39 | 52 | NO |
| Customers | kyc-pending | 1,499 | 283 | 366 | 40 | 62 | NO |
| Customers | payment-behaviour | 1,490 | 441 | 542 | 20 | 36 | NO |
| Customers | customer-directory | 1,975 | 269 | 411 | 23 | 31 | NO |
| Customers | cancelled-customers | 1 | 38 | 148 | 6 | 15 | yes |
| Finance | collections | 9,482 | 1220 | 1233 | 137 | 152 | NO |
| Finance | day-book | 231 | 126 | 313 | 6 | 10 | NO |
| Finance | bank-receipts | 5 | 618 | 759 | 515 | 682 | NO |
| Finance | cheques | 3,585 | 640 | 809 | 63 | 84 | NO |
| Finance | bills-vs-collection | 115 | 258 | 458 | 108 | 130 | NO |
| Finance | outstanding | 1,499 | 654 | 836 | 38 | 49 | NO |
| Finance | cash-vs-account | 1,499 | 276 | 286 | 39 | 60 | yes |
| Finance | other-charges | 1,497 | 256 | 274 | 42 | 54 | yes |
| Finance | receivables-forecast | 5,904 | 1827 | 1954 | 49 | 64 | NO |
| Finance | waivers | 0 | 55 | 75 | 6 | 14 | yes |
| Bookings | booking-register | 1,500 | 268 | 508 | 46 | 64 | NO |
| Bookings | sales-summary | 160 | 244 | 458 | 7 | 18 | NO |
| Bookings | discount-register | 25 | 74 | 86 | 6 | 19 | yes |
| Bookings | plan-position | 1,499 | 278 | 483 | 38 | 50 | NO |
| Bookings | agreements | 1,499 | 277 | 530 | 39 | 46 | NO |
| Bookings | cancellations | 0 | 63 | 71 | 5 | 12 | yes |
| Bookings | transfers | 0 | 317 | 600 | 5 | 12 | NO |
| Bookings | sales-team | 2 | 300 | 596 | 5 | 9 | NO |
| Bookings | realised-rate | 1,499 | 261 | 574 | 39 | 50 | NO |
| Bookings | booking-health | 1,499 | 267 | 596 | 38 | 50 | NO |
| Project & inventory | project-statement | 174 | 85 | 129 | 11 | 25 | yes |
| Project & inventory | inventory-status | 2,170 | 209 | 512 | 52 | 69 | NO |
| Project & inventory | stacking-plan | 2,170 | 207 | 208 | 60 | 72 | yes |
| Project & inventory | price-list | 669 | 177 | 198 | 18 | 26 | yes |
| Project & inventory | hold-register | 4 | 175 | 184 | 5 | 13 | yes |
| Project & inventory | landowner | 0 | 183 | 489 | 5 | 7 | NO |
| Project & inventory | parking | 132 | 25 | 39 | 7 | 20 | yes |
| Project & inventory | construction-vs-plan | 46 | 270 | 329 | 6 | 18 | NO |
| Project & inventory | stage-bills | 36 | 242 | 624 | 5 | 6 | NO |
| Project & inventory | sales-velocity | 36 | 180 | 186 | 6 | 11 | yes |
| Leads | lead-funnel | 7 | 78 | 216 | 7 | 21 | yes |
| Leads | lead-register | 1,498 | 88 | 107 | 18 | 20 | yes |
| Leads | source-performance | 5 | 95 | 411 | 8 | 14 | NO |
| Leads | follow-ups | 7 | 80 | 424 | 6 | 16 | NO |
| Leads | visit-register | 6 | 91 | 418 | 6 | 7 | NO |
| Leads | visit-conversion | 2 | 80 | 88 | 6 | 11 | yes |
| Leads | lost-leads | 1 | 74 | 85 | 5 | 14 | yes |
| Leads | response-time | 1,498 | 80 | 87 | 8 | 22 | yes |
| Leads | team-pipeline | 2 | 79 | 100 | 6 | 16 | yes |
| Leads | lead-ageing | 7 | 77 | 83 | 5 | 17 | yes |
| Customers | service-sla | 9 | 60 | 70 | 5 | 15 | yes |

**21/50 within budget** — over: customer-status, customer-ageing, advance-holders, call-list, kyc-pending, payment-behaviour, customer-directory, collections, day-book, bank-receipts, cheques, bills-vs-collection, outstanding, receivables-forecast, booking-register, sales-summary, plan-position, agreements, transfers, sales-team, realised-rate, booking-health, inventory-status, landowner, construction-vs-plan, stage-bills, source-performance, follow-ups, visit-register
