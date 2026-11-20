# Phase 3F report speed — kkt_volume — 2026-11-19 11:10 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 231 | 276 | 13 | 17 | yes |
| Customers | customer-statement | 18 | 18 | 22 | 7 | 9 | yes |
| Customers | customer-ageing | 1,497 | 219 | 229 | 12 | 14 | yes |
| Customers | advance-holders | 888 | 202 | 219 | 9 | 14 | yes |
| Customers | call-list | 1,497 | 244 | 277 | 13 | 14 | yes |
| Customers | kyc-pending | 1,499 | 249 | 257 | 12 | 20 | yes |
| Customers | payment-behaviour | 1,490 | 269 | 280 | 6 | 9 | yes |
| Customers | customer-directory | 1,975 | 212 | 222 | 7 | 10 | yes |
| Customers | cancelled-customers | 1 | 18 | 22 | 3 | 6 | yes |
| Finance | collections | 10,498 | 245 | 249 | 12 | 16 | yes |
| Finance | day-book | 231 | 84 | 88 | 3 | 6 | yes |
| Finance | bank-receipts | 4 | 154 | 166 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 158 | 192 | 12 | 16 | yes |
| Finance | bills-vs-collection | 115 | 150 | 159 | 3 | 4 | yes |
| Finance | outstanding | 1,499 | 234 | 249 | 12 | 13 | yes |
| Finance | cash-vs-account | 1,499 | 110 | 132 | 12 | 13 | yes |
| Finance | other-charges | 1,497 | 151 | 157 | 12 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 278 | 286 | 12 | 16 | yes |
| Finance | waivers | 0 | 38 | 47 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 248 | 262 | 12 | 16 | yes |
| Bookings | sales-summary | 160 | 204 | 221 | 3 | 7 | yes |
| Bookings | discount-register | 25 | 48 | 51 | 4 | 8 | yes |
| Bookings | plan-position | 1,499 | 249 | 266 | 12 | 16 | yes |
| Bookings | agreements | 1,499 | 248 | 254 | 12 | 16 | yes |
| Bookings | cancellations | 0 | 41 | 46 | 3 | 6 | yes |
| Bookings | transfers | 0 | 212 | 226 | 3 | 6 | yes |
| Bookings | sales-team | 2 | 211 | 226 | 3 | 5 | yes |
| Bookings | realised-rate | 1,499 | 251 | 261 | 12 | 16 | yes |
| Bookings | booking-health | 1,499 | 254 | 264 | 12 | 15 | yes |
| Project & inventory | project-statement | 174 | 55 | 65 | 5 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 205 | 218 | 13 | 14 | yes |
| Project & inventory | stacking-plan | 2,170 | 203 | 211 | 13 | 14 | yes |
| Project & inventory | price-list | 669 | 168 | 174 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 154 | 170 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 154 | 162 | 3 | 5 | yes |
| Project & inventory | parking | 132 | 17 | 21 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 139 | 156 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 172 | 178 | 3 | 6 | yes |
| Project & inventory | sales-velocity | 36 | 163 | 174 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 109 | 117 | 3 | 6 | yes |
| Leads | lead-register | 1,498 | 60 | 69 | 3 | 5 | yes |
| Leads | source-performance | 5 | 108 | 115 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 54 | 58 | 3 | 7 | yes |
| Leads | visit-register | 9 | 58 | 64 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 42 | 49 | 3 | 7 | yes |
| Leads | lost-leads | 1 | 54 | 59 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 58 | 70 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 111 | 116 | 3 | 6 | yes |
| Leads | lead-ageing | 7 | 55 | 65 | 3 | 4 | yes |
| Customers | service-sla | 9 | 44 | 45 | 3 | 5 | yes |

**50/50 within budget**
