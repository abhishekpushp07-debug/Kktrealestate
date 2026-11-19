# Phase 3F report speed — kkt_volume — 2026-11-18 23:58 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 294 | 314 | 24 | 27 | NO |
| Customers | customer-statement | 18 | 23 | 28 | 10 | 15 | yes |
| Customers | customer-ageing | 1,497 | 192 | 248 | 24 | 29 | yes |
| Customers | advance-holders | 888 | 178 | 201 | 17 | 18 | yes |
| Customers | call-list | 1,497 | 203 | 211 | 24 | 24 | yes |
| Customers | kyc-pending | 1,499 | 201 | 207 | 23 | 24 | yes |
| Customers | payment-behaviour | 1,490 | 330 | 337 | 10 | 12 | NO |
| Customers | customer-directory | 1,975 | 183 | 218 | 12 | 13 | yes |
| Customers | cancelled-customers | 1 | 21 | 21 | 3 | 4 | yes |
| Finance | collections | 10,498 | 831 | 945 | 23 | 24 | NO |
| Finance | day-book | 231 | 91 | 92 | 4 | 5 | yes |
| Finance | bank-receipts | 4 | 137 | 138 | 4 | 5 | yes |
| Finance | cheques | 3,585 | 181 | 213 | 22 | 23 | yes |
| Finance | bills-vs-collection | 115 | 158 | 158 | 4 | 5 | yes |
| Finance | outstanding | 1,499 | 294 | 320 | 22 | 23 | NO |
| Finance | cash-vs-account | 1,499 | 132 | 142 | 23 | 24 | yes |
| Finance | other-charges | 1,497 | 152 | 170 | 24 | 25 | yes |
| Finance | receivables-forecast | 5,903 | 256 | 262 | 23 | 24 | yes |
| Finance | waivers | 0 | 45 | 50 | 4 | 5 | yes |
| Bookings | booking-register | 1,500 | 198 | 231 | 23 | 26 | yes |
| Bookings | sales-summary | 160 | 168 | 312 | 4 | 4 | NO |
| Bookings | discount-register | 25 | 49 | 50 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 189 | 201 | 22 | 23 | yes |
| Bookings | agreements | 1,499 | 194 | 200 | 23 | 24 | yes |
| Bookings | cancellations | 0 | 42 | 42 | 4 | 5 | yes |
| Bookings | transfers | 0 | 241 | 250 | 4 | 5 | yes |
| Bookings | sales-team | 2 | 219 | 222 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 195 | 274 | 23 | 24 | yes |
| Bookings | booking-health | 1,499 | 197 | 203 | 22 | 23 | yes |
| Project & inventory | project-statement | 174 | 59 | 66 | 7 | 7 | yes |
| Project & inventory | inventory-status | 2,170 | 167 | 176 | 25 | 26 | yes |
| Project & inventory | stacking-plan | 2,170 | 180 | 183 | 28 | 29 | yes |
| Project & inventory | price-list | 669 | 152 | 160 | 10 | 12 | yes |
| Project & inventory | hold-register | 4 | 147 | 186 | 4 | 4 | yes |
| Project & inventory | landowner | 0 | 149 | 156 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 20 | 4 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 147 | 150 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 169 | 184 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 163 | 172 | 4 | 5 | yes |
| Leads | lead-funnel | 7 | 135 | 137 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 78 | 85 | 4 | 5 | yes |
| Leads | source-performance | 5 | 124 | 134 | 4 | 4 | yes |
| Leads | follow-ups | 7 | 62 | 63 | 4 | 5 | yes |
| Leads | visit-register | 9 | 67 | 77 | 4 | 4 | yes |
| Leads | visit-conversion | 2 | 49 | 50 | 4 | 4 | yes |
| Leads | lost-leads | 1 | 63 | 74 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 64 | 66 | 4 | 4 | yes |
| Leads | team-pipeline | 2 | 124 | 135 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 63 | 68 | 4 | 4 | yes |
| Customers | service-sla | 9 | 48 | 49 | 3 | 4 | yes |

**45/50 within budget** — over: customer-status, payment-behaviour, collections, outstanding, sales-summary
