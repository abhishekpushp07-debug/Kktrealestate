# Phase 3F report speed — kkt_volume — 2026-11-19 11:08 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 198 | 270 | 15 | 24 | yes |
| Customers | customer-statement | 18 | 24 | 45 | 10 | 18 | yes |
| Customers | customer-ageing | 1,497 | 170 | 239 | 14 | 24 | yes |
| Customers | advance-holders | 888 | 159 | 239 | 12 | 22 | yes |
| Customers | call-list | 1,497 | 199 | 274 | 15 | 23 | yes |
| Customers | kyc-pending | 1,499 | 200 | 275 | 15 | 23 | yes |
| Customers | payment-behaviour | 1,490 | 265 | 356 | 9 | 20 | NO |
| Customers | customer-directory | 1,975 | 245 | 373 | 14 | 62 | NO |
| Customers | cancelled-customers | 1 | 32 | 100 | 5 | 26 | yes |
| Finance | collections | 10,498 | 302 | 335 | 19 | 61 | NO |
| Finance | day-book | 231 | 152 | 200 | 8 | 25 | yes |
| Finance | bank-receipts | 4 | 148 | 174 | 3 | 13 | yes |
| Finance | cheques | 3,585 | 140 | 154 | 12 | 21 | yes |
| Finance | bills-vs-collection | 115 | 156 | 167 | 4 | 13 | yes |
| Finance | outstanding | 1,499 | 178 | 190 | 12 | 22 | yes |
| Finance | cash-vs-account | 1,499 | 116 | 136 | 13 | 22 | yes |
| Finance | other-charges | 1,497 | 144 | 167 | 13 | 22 | yes |
| Finance | receivables-forecast | 5,903 | 212 | 228 | 12 | 22 | yes |
| Finance | waivers | 0 | 46 | 57 | 4 | 9 | yes |
| Bookings | booking-register | 1,500 | 196 | 213 | 12 | 23 | yes |
| Bookings | sales-summary | 160 | 185 | 198 | 4 | 9 | yes |
| Bookings | discount-register | 25 | 53 | 66 | 4 | 11 | yes |
| Bookings | plan-position | 1,499 | 195 | 214 | 13 | 22 | yes |
| Bookings | agreements | 1,499 | 192 | 210 | 12 | 21 | yes |
| Bookings | cancellations | 0 | 44 | 54 | 3 | 4 | yes |
| Bookings | transfers | 0 | 190 | 207 | 3 | 7 | yes |
| Bookings | sales-team | 2 | 233 | 250 | 4 | 10 | yes |
| Bookings | realised-rate | 1,499 | 197 | 218 | 13 | 21 | yes |
| Bookings | booking-health | 1,499 | 196 | 212 | 13 | 23 | yes |
| Project & inventory | project-statement | 174 | 66 | 69 | 5 | 14 | yes |
| Project & inventory | inventory-status | 2,170 | 162 | 182 | 13 | 23 | yes |
| Project & inventory | stacking-plan | 2,170 | 158 | 172 | 13 | 23 | yes |
| Project & inventory | price-list | 669 | 146 | 159 | 6 | 15 | yes |
| Project & inventory | hold-register | 4 | 141 | 153 | 3 | 12 | yes |
| Project & inventory | landowner | 0 | 141 | 151 | 3 | 8 | yes |
| Project & inventory | parking | 132 | 17 | 34 | 3 | 8 | yes |
| Project & inventory | construction-vs-plan | 46 | 173 | 185 | 4 | 9 | yes |
| Project & inventory | stage-bills | 36 | 152 | 168 | 4 | 11 | yes |
| Project & inventory | sales-velocity | 36 | 146 | 159 | 3 | 12 | yes |
| Leads | lead-funnel | 7 | 122 | 136 | 3 | 12 | yes |
| Leads | lead-register | 1,498 | 61 | 75 | 3 | 10 | yes |
| Leads | source-performance | 5 | 118 | 132 | 3 | 12 | yes |
| Leads | follow-ups | 7 | 56 | 69 | 3 | 12 | yes |
| Leads | visit-register | 9 | 62 | 78 | 3 | 10 | yes |
| Leads | visit-conversion | 2 | 45 | 70 | 3 | 12 | yes |
| Leads | lost-leads | 1 | 63 | 74 | 3 | 9 | yes |
| Leads | response-time | 1,498 | 62 | 74 | 3 | 10 | yes |
| Leads | team-pipeline | 2 | 117 | 140 | 3 | 11 | yes |
| Leads | lead-ageing | 7 | 57 | 70 | 3 | 11 | yes |
| Customers | service-sla | 9 | 46 | 64 | 3 | 12 | yes |

**47/50 within budget** — over: payment-behaviour, customer-directory, collections
