# Phase 3F report speed — kkt_volume — 2026-11-19 15:51 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 197 | 339 | 190 | 274 | NO |
| Customers | customer-statement | 18 | 21 | 23 | 21 | 22 | yes |
| Customers | customer-ageing | 1,497 | 178 | 258 | 177 | 254 | NO |
| Customers | advance-holders | 888 | 172 | 256 | 170 | 252 | NO |
| Customers | call-list | 1,497 | 202 | 285 | 204 | 290 | NO |
| Customers | kyc-pending | 1,499 | 206 | 279 | 207 | 289 | NO |
| Customers | payment-behaviour | 1,490 | 268 | 347 | 263 | 343 | NO |
| Customers | customer-directory | 1,975 | 199 | 280 | 200 | 282 | NO |
| Customers | cancelled-customers | 1 | 22 | 67 | 23 | 24 | yes |
| Finance | collections | 10,498 | 126 | 202 | 131 | 248 | NO |
| Finance | day-book | 231 | 100 | 111 | 100 | 125 | NO |
| Finance | bank-receipts | 4 | 242 | 369 | 4 | 12 | NO |
| Finance | cheques | 3,585 | 249 | 283 | 17 | 65 | yes |
| Finance | bills-vs-collection | 115 | 214 | 304 | 5 | 6 | NO |
| Finance | outstanding | 1,499 | 196 | 201 | 14 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 126 | 128 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 147 | 150 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 241 | 242 | 15 | 16 | yes |
| Finance | waivers | 0 | 44 | 48 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 215 | 218 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 197 | 201 | 4 | 5 | yes |
| Bookings | discount-register | 25 | 54 | 56 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 215 | 216 | 13 | 15 | yes |
| Bookings | agreements | 1,499 | 212 | 216 | 14 | 15 | yes |
| Bookings | cancellations | 0 | 45 | 50 | 3 | 4 | yes |
| Bookings | transfers | 0 | 208 | 213 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 221 | 224 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 214 | 218 | 13 | 15 | yes |
| Bookings | booking-health | 1,499 | 217 | 224 | 14 | 16 | yes |
| Project & inventory | project-statement | 174 | 61 | 70 | 5 | 7 | yes |
| Project & inventory | inventory-status | 2,170 | 171 | 175 | 14 | 15 | yes |
| Project & inventory | stacking-plan | 2,170 | 173 | 176 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 154 | 157 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 148 | 153 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 148 | 152 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 19 | 22 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 147 | 156 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 166 | 171 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 157 | 162 | 4 | 4 | yes |
| Leads | lead-funnel | 7 | 123 | 126 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 67 | 74 | 4 | 5 | yes |
| Leads | source-performance | 5 | 123 | 128 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 61 | 68 | 3 | 4 | yes |
| Leads | visit-register | 9 | 65 | 66 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 48 | 55 | 4 | 5 | yes |
| Leads | lost-leads | 1 | 62 | 68 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 65 | 71 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 124 | 127 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 62 | 68 | 3 | 4 | yes |
| Customers | service-sla | 9 | 48 | 56 | 4 | 5 | yes |

**39/50 within budget** — over: customer-status, customer-ageing, advance-holders, call-list, kyc-pending, payment-behaviour, customer-directory, collections, day-book, bank-receipts, bills-vs-collection
