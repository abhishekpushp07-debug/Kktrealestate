# Phase 3F report speed — kkt_volume — 2026-11-19 16:59 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 198 | 241 | 201 | 260 | NO |
| Customers | customer-statement | 18 | 22 | 25 | 21 | 22 | yes |
| Customers | customer-ageing | 1,497 | 186 | 190 | 184 | 192 | NO |
| Customers | advance-holders | 888 | 177 | 190 | 177 | 183 | NO |
| Customers | call-list | 1,497 | 214 | 268 | 15 | 18 | yes |
| Customers | kyc-pending | 1,499 | 214 | 226 | 14 | 19 | yes |
| Customers | payment-behaviour | 1,490 | 274 | 293 | 8 | 9 | yes |
| Customers | customer-directory | 1,975 | 204 | 210 | 9 | 10 | yes |
| Customers | cancelled-customers | 1 | 21 | 25 | 4 | 4 | yes |
| Finance | collections | 10,498 | 134 | 170 | 14 | 15 | yes |
| Finance | day-book | 231 | 92 | 93 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 146 | 155 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 154 | 160 | 14 | 15 | yes |
| Finance | bills-vs-collection | 115 | 177 | 184 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 197 | 204 | 15 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 132 | 133 | 15 | 17 | yes |
| Finance | other-charges | 1,497 | 152 | 153 | 14 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 250 | 254 | 13 | 15 | yes |
| Finance | waivers | 0 | 45 | 60 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 219 | 223 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 198 | 201 | 3 | 5 | yes |
| Bookings | discount-register | 25 | 54 | 62 | 4 | 4 | yes |
| Bookings | plan-position | 1,499 | 214 | 217 | 14 | 16 | yes |
| Bookings | agreements | 1,499 | 215 | 217 | 14 | 15 | yes |
| Bookings | cancellations | 0 | 45 | 50 | 4 | 4 | yes |
| Bookings | transfers | 0 | 210 | 215 | 4 | 5 | yes |
| Bookings | sales-team | 2 | 227 | 233 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 216 | 219 | 14 | 16 | yes |
| Bookings | booking-health | 1,499 | 220 | 226 | 15 | 16 | yes |
| Project & inventory | project-statement | 174 | 62 | 76 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 172 | 176 | 16 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 173 | 176 | 14 | 16 | yes |
| Project & inventory | price-list | 669 | 153 | 155 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 149 | 150 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 149 | 151 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 22 | 4 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 150 | 163 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 168 | 172 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 158 | 160 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 125 | 126 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 68 | 75 | 3 | 4 | yes |
| Leads | source-performance | 5 | 126 | 131 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 63 | 68 | 3 | 4 | yes |
| Leads | visit-register | 9 | 65 | 66 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 48 | 56 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 64 | 70 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 67 | 72 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 126 | 132 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 63 | 64 | 3 | 4 | yes |
| Customers | service-sla | 9 | 47 | 53 | 3 | 4 | yes |

**47/50 within budget** — over: customer-status, customer-ageing, advance-holders
