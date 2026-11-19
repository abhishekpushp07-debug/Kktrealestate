# Phase 3F report speed — kkt_volume — 2026-11-19 15:43 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 199 | 236 | 199 | 204 | NO |
| Customers | customer-statement | 18 | 21 | 24 | 21 | 22 | yes |
| Customers | customer-ageing | 1,497 | 181 | 188 | 180 | 188 | NO |
| Customers | advance-holders | 888 | 177 | 184 | 176 | 182 | NO |
| Customers | call-list | 1,497 | 207 | 223 | 15 | 20 | yes |
| Customers | kyc-pending | 1,499 | 208 | 216 | 14 | 20 | yes |
| Customers | payment-behaviour | 1,490 | 267 | 277 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 201 | 210 | 9 | 10 | yes |
| Customers | cancelled-customers | 1 | 21 | 23 | 4 | 4 | yes |
| Finance | collections | 10,498 | 127 | 171 | 14 | 16 | yes |
| Finance | day-book | 231 | 92 | 94 | 3 | 4 | yes |
| Finance | bank-receipts | 4 | 126 | 134 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 153 | 156 | 14 | 16 | yes |
| Finance | bills-vs-collection | 115 | 172 | 179 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 198 | 204 | 14 | 16 | yes |
| Finance | cash-vs-account | 1,499 | 130 | 132 | 14 | 15 | yes |
| Finance | other-charges | 1,497 | 148 | 150 | 15 | 15 | yes |
| Finance | receivables-forecast | 5,903 | 243 | 244 | 14 | 15 | yes |
| Finance | waivers | 0 | 44 | 50 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 217 | 230 | 14 | 16 | yes |
| Bookings | sales-summary | 160 | 197 | 201 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 53 | 56 | 4 | 4 | yes |
| Bookings | plan-position | 1,499 | 213 | 217 | 14 | 16 | yes |
| Bookings | agreements | 1,499 | 212 | 216 | 14 | 16 | yes |
| Bookings | cancellations | 0 | 44 | 50 | 3 | 4 | yes |
| Bookings | transfers | 0 | 207 | 211 | 4 | 4 | yes |
| Bookings | sales-team | 2 | 224 | 229 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 215 | 221 | 13 | 15 | yes |
| Bookings | booking-health | 1,499 | 218 | 220 | 14 | 15 | yes |
| Project & inventory | project-statement | 174 | 61 | 71 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 170 | 175 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 172 | 178 | 16 | 16 | yes |
| Project & inventory | price-list | 669 | 152 | 158 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 147 | 152 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 147 | 153 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 21 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 147 | 153 | 4 | 5 | yes |
| Project & inventory | stage-bills | 36 | 168 | 172 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 156 | 160 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 124 | 125 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 68 | 75 | 3 | 4 | yes |
| Leads | source-performance | 5 | 124 | 130 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 62 | 68 | 3 | 4 | yes |
| Leads | visit-register | 9 | 66 | 66 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 48 | 57 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 63 | 69 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 67 | 74 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 127 | 129 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 63 | 70 | 3 | 4 | yes |
| Customers | service-sla | 9 | 48 | 54 | 3 | 4 | yes |

**47/50 within budget** — over: customer-status, customer-ageing, advance-holders
