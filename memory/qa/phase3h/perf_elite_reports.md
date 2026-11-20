# Phase 3F report speed — kkt_volume — 2026-11-18 20:28 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 347 | 440 | 24 | 25 | NO |
| Customers | customer-statement | 18 | 26 | 91 | 11 | 12 | yes |
| Customers | customer-ageing | 1,497 | 227 | 312 | 24 | 25 | NO |
| Customers | advance-holders | 888 | 227 | 268 | 17 | 18 | yes |
| Customers | call-list | 1,497 | 260 | 347 | 24 | 25 | NO |
| Customers | kyc-pending | 1,499 | 259 | 350 | 23 | 24 | NO |
| Customers | payment-behaviour | 1,490 | 396 | 521 | 11 | 12 | NO |
| Customers | customer-directory | 1,975 | 248 | 372 | 12 | 13 | NO |
| Customers | cancelled-customers | 1 | 22 | 62 | 3 | 4 | yes |
| Finance | collections | 10,498 | 1167 | 1393 | 23 | 25 | NO |
| Finance | day-book | 231 | 97 | 104 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 159 | 166 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 423 | 772 | 21 | 22 | NO |
| Finance | bills-vs-collection | 115 | 158 | 171 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 337 | 710 | 22 | 24 | NO |
| Finance | cash-vs-account | 1,499 | 232 | 243 | 23 | 24 | yes |
| Finance | other-charges | 1,497 | 202 | 597 | 23 | 24 | NO |
| Finance | receivables-forecast | 5,903 | 923 | 971 | 22 | 23 | NO |
| Finance | waivers | 0 | 43 | 45 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 244 | 667 | 22 | 23 | NO |
| Bookings | sales-summary | 160 | 214 | 676 | 4 | 4 | NO |
| Bookings | discount-register | 25 | 54 | 66 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 238 | 763 | 22 | 23 | NO |
| Bookings | agreements | 1,499 | 239 | 241 | 22 | 23 | yes |
| Bookings | cancellations | 0 | 44 | 45 | 3 | 4 | yes |
| Bookings | transfers | 0 | 284 | 870 | 3 | 4 | NO |
| Bookings | sales-team | 2 | 231 | 827 | 3 | 4 | NO |
| Bookings | realised-rate | 1,499 | 239 | 242 | 22 | 23 | yes |
| Bookings | booking-health | 1,499 | 243 | 882 | 22 | 23 | NO |
| Project & inventory | project-statement | 174 | 67 | 69 | 6 | 7 | yes |
| Project & inventory | inventory-status | 2,170 | 175 | 180 | 25 | 26 | yes |
| Project & inventory | stacking-plan | 2,170 | 186 | 866 | 27 | 28 | NO |
| Project & inventory | price-list | 669 | 157 | 161 | 10 | 10 | yes |
| Project & inventory | hold-register | 4 | 149 | 153 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 153 | 830 | 3 | 4 | NO |
| Project & inventory | parking | 132 | 20 | 23 | 4 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 144 | 150 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 210 | 220 | 4 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 164 | 848 | 4 | 4 | NO |
| Leads | lead-funnel | 7 | 134 | 136 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 76 | 78 | 4 | 4 | yes |
| Leads | source-performance | 5 | 122 | 125 | 4 | 4 | yes |
| Leads | follow-ups | 7 | 63 | 743 | 4 | 4 | NO |
| Leads | visit-register | 9 | 65 | 66 | 4 | 4 | yes |
| Leads | visit-conversion | 2 | 48 | 49 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 62 | 63 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 64 | 65 | 4 | 4 | yes |
| Leads | team-pipeline | 2 | 123 | 830 | 4 | 4 | NO |
| Leads | lead-ageing | 7 | 63 | 64 | 4 | 4 | yes |
| Customers | service-sla | 9 | 48 | 49 | 3 | 4 | yes |

**28/50 within budget** — over: customer-status, customer-ageing, call-list, kyc-pending, payment-behaviour, customer-directory, collections, cheques, outstanding, other-charges, receivables-forecast, booking-register, sales-summary, plan-position, transfers, sales-team, booking-health, stacking-plan, landowner, sales-velocity, follow-ups, team-pipeline
