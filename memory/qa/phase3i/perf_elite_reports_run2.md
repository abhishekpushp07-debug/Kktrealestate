# Phase 3F report speed — kkt_volume — 2026-11-19 15:46 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 193 | 271 | 15 | 16 | yes |
| Customers | customer-statement | 18 | 22 | 27 | 8 | 9 | yes |
| Customers | customer-ageing | 1,497 | 176 | 254 | 14 | 15 | yes |
| Customers | advance-holders | 888 | 172 | 386 | 172 | 255 | NO |
| Customers | call-list | 1,497 | 204 | 287 | 202 | 281 | NO |
| Customers | kyc-pending | 1,499 | 202 | 285 | 203 | 284 | NO |
| Customers | payment-behaviour | 1,490 | 264 | 356 | 262 | 340 | NO |
| Customers | customer-directory | 1,975 | 198 | 276 | 200 | 279 | NO |
| Customers | cancelled-customers | 1 | 23 | 69 | 22 | 24 | yes |
| Finance | collections | 10,498 | 124 | 218 | 132 | 228 | NO |
| Finance | day-book | 231 | 98 | 176 | 100 | 124 | NO |
| Finance | bank-receipts | 4 | 139 | 153 | 138 | 141 | NO |
| Finance | cheques | 3,585 | 256 | 466 | 18 | 36 | NO |
| Finance | bills-vs-collection | 115 | 280 | 367 | 5 | 9 | NO |
| Finance | outstanding | 1,499 | 217 | 331 | 15 | 31 | NO |
| Finance | cash-vs-account | 1,499 | 130 | 132 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 153 | 170 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 248 | 249 | 15 | 16 | yes |
| Finance | waivers | 0 | 45 | 49 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 218 | 231 | 15 | 16 | yes |
| Bookings | sales-summary | 160 | 199 | 202 | 4 | 5 | yes |
| Bookings | discount-register | 25 | 55 | 57 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 215 | 218 | 15 | 17 | yes |
| Bookings | agreements | 1,499 | 214 | 217 | 13 | 15 | yes |
| Bookings | cancellations | 0 | 44 | 49 | 3 | 4 | yes |
| Bookings | transfers | 0 | 209 | 211 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 224 | 228 | 4 | 4 | yes |
| Bookings | realised-rate | 1,499 | 217 | 219 | 13 | 15 | yes |
| Bookings | booking-health | 1,499 | 220 | 222 | 13 | 15 | yes |
| Project & inventory | project-statement | 174 | 60 | 67 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 172 | 173 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 173 | 175 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 154 | 156 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 151 | 155 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 146 | 152 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 19 | 21 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 148 | 154 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 168 | 170 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 157 | 162 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 122 | 123 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 66 | 73 | 3 | 4 | yes |
| Leads | source-performance | 5 | 122 | 128 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 61 | 67 | 3 | 3 | yes |
| Leads | visit-register | 9 | 64 | 65 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 48 | 58 | 4 | 4 | yes |
| Leads | lost-leads | 1 | 62 | 69 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 66 | 72 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 125 | 126 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 62 | 69 | 3 | 4 | yes |
| Customers | service-sla | 9 | 47 | 54 | 4 | 5 | yes |

**39/50 within budget** — over: advance-holders, call-list, kyc-pending, payment-behaviour, customer-directory, collections, day-book, bank-receipts, cheques, bills-vs-collection, outstanding
