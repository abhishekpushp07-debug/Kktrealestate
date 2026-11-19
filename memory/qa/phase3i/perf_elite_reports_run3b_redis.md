# Phase 3F report speed — kkt_volume — 2026-11-19 17:50 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 207 | 257 | 199 | 210 | NO |
| Customers | customer-statement | 18 | 20 | 24 | 20 | 21 | yes |
| Customers | customer-ageing | 1,497 | 182 | 191 | 184 | 189 | NO |
| Customers | advance-holders | 888 | 174 | 180 | 176 | 182 | NO |
| Customers | call-list | 1,497 | 209 | 219 | 15 | 27 | yes |
| Customers | kyc-pending | 1,499 | 207 | 226 | 15 | 17 | yes |
| Customers | payment-behaviour | 1,490 | 281 | 315 | 8 | 9 | NO |
| Customers | customer-directory | 1,975 | 198 | 209 | 9 | 10 | yes |
| Customers | cancelled-customers | 1 | 22 | 25 | 4 | 4 | yes |
| Finance | collections | 10,498 | 153 | 182 | 14 | 15 | yes |
| Finance | day-book | 231 | 91 | 98 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 135 | 148 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 152 | 158 | 14 | 15 | yes |
| Finance | bills-vs-collection | 115 | 169 | 172 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 196 | 201 | 14 | 14 | yes |
| Finance | cash-vs-account | 1,499 | 131 | 132 | 15 | 15 | yes |
| Finance | other-charges | 1,497 | 150 | 151 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 247 | 250 | 14 | 16 | yes |
| Finance | waivers | 0 | 45 | 51 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 219 | 227 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 199 | 204 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 54 | 58 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 213 | 218 | 14 | 15 | yes |
| Bookings | agreements | 1,499 | 212 | 218 | 14 | 15 | yes |
| Bookings | cancellations | 0 | 44 | 51 | 4 | 4 | yes |
| Bookings | transfers | 0 | 209 | 215 | 4 | 4 | yes |
| Bookings | sales-team | 2 | 226 | 230 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 216 | 218 | 14 | 15 | yes |
| Bookings | booking-health | 1,499 | 218 | 222 | 14 | 16 | yes |
| Project & inventory | project-statement | 174 | 60 | 71 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 179 | 186 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 182 | 184 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 160 | 165 | 6 | 8 | yes |
| Project & inventory | hold-register | 4 | 156 | 158 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 154 | 155 | 3 | 3 | yes |
| Project & inventory | parking | 132 | 20 | 21 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 148 | 155 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 167 | 170 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 166 | 167 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 127 | 127 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 70 | 76 | 4 | 5 | yes |
| Leads | source-performance | 5 | 128 | 132 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 64 | 70 | 3 | 3 | yes |
| Leads | visit-register | 9 | 67 | 68 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 48 | 55 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 63 | 68 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 66 | 72 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 128 | 129 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 63 | 72 | 3 | 4 | yes |
| Customers | service-sla | 9 | 47 | 53 | 4 | 4 | yes |

**46/50 within budget** — over: customer-status, customer-ageing, advance-holders, payment-behaviour
