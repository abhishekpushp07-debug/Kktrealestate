# Phase 3F report speed — kkt_volume — 2026-11-19 17:46 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 192 | 234 | 196 | 201 | NO |
| Customers | customer-statement | 18 | 20 | 23 | 20 | 21 | yes |
| Customers | customer-ageing | 1,497 | 178 | 188 | 181 | 187 | NO |
| Customers | advance-holders | 888 | 177 | 183 | 176 | 183 | NO |
| Customers | call-list | 1,497 | 209 | 214 | 14 | 22 | yes |
| Customers | kyc-pending | 1,499 | 210 | 220 | 15 | 18 | yes |
| Customers | payment-behaviour | 1,490 | 261 | 293 | 7 | 9 | yes |
| Customers | customer-directory | 1,975 | 198 | 208 | 8 | 9 | yes |
| Customers | cancelled-customers | 1 | 20 | 23 | 4 | 4 | yes |
| Finance | collections | 10,498 | 153 | 180 | 14 | 15 | yes |
| Finance | day-book | 231 | 94 | 98 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 139 | 149 | 4 | 4 | yes |
| Finance | cheques | 3,585 | 153 | 160 | 14 | 15 | yes |
| Finance | bills-vs-collection | 115 | 179 | 187 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 199 | 204 | 14 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 130 | 132 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 151 | 154 | 14 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 251 | 252 | 14 | 15 | yes |
| Finance | waivers | 0 | 43 | 49 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 216 | 228 | 14 | 16 | yes |
| Bookings | sales-summary | 160 | 198 | 205 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 54 | 57 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 213 | 220 | 14 | 15 | yes |
| Bookings | agreements | 1,499 | 214 | 224 | 13 | 15 | yes |
| Bookings | cancellations | 0 | 45 | 49 | 3 | 4 | yes |
| Bookings | transfers | 0 | 208 | 211 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 221 | 228 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 215 | 224 | 14 | 15 | yes |
| Bookings | booking-health | 1,499 | 217 | 222 | 15 | 16 | yes |
| Project & inventory | project-statement | 174 | 61 | 72 | 6 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 177 | 181 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 179 | 189 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 158 | 160 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 152 | 155 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 151 | 154 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 19 | 21 | 4 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 148 | 156 | 4 | 5 | yes |
| Project & inventory | stage-bills | 36 | 166 | 173 | 4 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 161 | 163 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 125 | 127 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 68 | 76 | 3 | 4 | yes |
| Leads | source-performance | 5 | 124 | 131 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 62 | 68 | 3 | 3 | yes |
| Leads | visit-register | 9 | 65 | 66 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 47 | 54 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 62 | 70 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 64 | 70 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 126 | 128 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 62 | 69 | 3 | 3 | yes |
| Customers | service-sla | 9 | 46 | 54 | 3 | 4 | yes |

**47/50 within budget** — over: customer-status, customer-ageing, advance-holders
