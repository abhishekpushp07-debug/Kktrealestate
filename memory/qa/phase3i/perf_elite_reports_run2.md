# Phase 3F report speed — kkt_volume — 2026-11-19 17:48 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 195 | 229 | 198 | 203 | NO |
| Customers | customer-statement | 18 | 21 | 23 | 21 | 22 | yes |
| Customers | customer-ageing | 1,497 | 185 | 290 | 181 | 188 | NO |
| Customers | advance-holders | 888 | 177 | 188 | 176 | 185 | NO |
| Customers | call-list | 1,497 | 208 | 235 | 15 | 31 | yes |
| Customers | kyc-pending | 1,499 | 210 | 244 | 14 | 17 | yes |
| Customers | payment-behaviour | 1,490 | 265 | 288 | 8 | 8 | yes |
| Customers | customer-directory | 1,975 | 202 | 212 | 9 | 10 | yes |
| Customers | cancelled-customers | 1 | 21 | 24 | 4 | 4 | yes |
| Finance | collections | 10,498 | 152 | 169 | 14 | 15 | yes |
| Finance | day-book | 231 | 93 | 97 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 141 | 150 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 154 | 160 | 14 | 16 | yes |
| Finance | bills-vs-collection | 115 | 181 | 183 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 193 | 203 | 14 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 129 | 135 | 14 | 17 | yes |
| Finance | other-charges | 1,497 | 150 | 152 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 248 | 250 | 14 | 15 | yes |
| Finance | waivers | 0 | 43 | 50 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 217 | 226 | 13 | 16 | yes |
| Bookings | sales-summary | 160 | 198 | 201 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 54 | 55 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 210 | 214 | 13 | 14 | yes |
| Bookings | agreements | 1,499 | 212 | 219 | 15 | 16 | yes |
| Bookings | cancellations | 0 | 45 | 50 | 4 | 4 | yes |
| Bookings | transfers | 0 | 210 | 221 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 223 | 226 | 4 | 5 | yes |
| Bookings | realised-rate | 1,499 | 213 | 217 | 14 | 16 | yes |
| Bookings | booking-health | 1,499 | 217 | 218 | 13 | 15 | yes |
| Project & inventory | project-statement | 174 | 62 | 71 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 179 | 183 | 14 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 180 | 188 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 159 | 163 | 7 | 8 | yes |
| Project & inventory | hold-register | 4 | 151 | 159 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 150 | 154 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 22 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 153 | 158 | 4 | 5 | yes |
| Project & inventory | stage-bills | 36 | 165 | 171 | 4 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 160 | 165 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 123 | 128 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 68 | 73 | 3 | 4 | yes |
| Leads | source-performance | 5 | 124 | 130 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 62 | 67 | 3 | 3 | yes |
| Leads | visit-register | 9 | 65 | 66 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 47 | 56 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 63 | 69 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 66 | 71 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 126 | 133 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 63 | 64 | 3 | 4 | yes |
| Customers | service-sla | 9 | 46 | 53 | 4 | 4 | yes |

**47/50 within budget** — over: customer-status, customer-ageing, advance-holders
