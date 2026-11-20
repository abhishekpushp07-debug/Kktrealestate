# Phase 3F report speed — kkt_volume — 2026-11-19 20:04 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 189 | 230 | 14 | 15 | yes |
| Customers | customer-statement | 18 | 20 | 26 | 7 | 8 | yes |
| Customers | customer-ageing | 1,497 | 179 | 184 | 13 | 14 | yes |
| Customers | advance-holders | 888 | 172 | 178 | 11 | 12 | yes |
| Customers | call-list | 1,497 | 205 | 208 | 14 | 15 | yes |
| Customers | kyc-pending | 1,499 | 206 | 214 | 15 | 16 | yes |
| Customers | payment-behaviour | 1,490 | 256 | 271 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 196 | 202 | 8 | 9 | yes |
| Customers | cancelled-customers | 1 | 20 | 22 | 3 | 4 | yes |
| Finance | collections | 10,498 | 127 | 145 | 14 | 16 | yes |
| Finance | day-book | 231 | 94 | 97 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 137 | 147 | 4 | 5 | yes |
| Finance | cheques | 3,585 | 153 | 158 | 14 | 16 | yes |
| Finance | bills-vs-collection | 115 | 165 | 170 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 200 | 202 | 14 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 129 | 130 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 151 | 155 | 16 | 17 | yes |
| Finance | receivables-forecast | 5,903 | 241 | 244 | 14 | 16 | yes |
| Finance | waivers | 0 | 44 | 49 | 3 | 5 | yes |
| Bookings | booking-register | 1,500 | 218 | 220 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 202 | 211 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 54 | 55 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 217 | 219 | 14 | 18 | yes |
| Bookings | agreements | 1,499 | 214 | 223 | 13 | 16 | yes |
| Bookings | cancellations | 0 | 44 | 51 | 3 | 4 | yes |
| Bookings | transfers | 0 | 210 | 215 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 224 | 228 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 218 | 223 | 15 | 16 | yes |
| Bookings | booking-health | 1,499 | 218 | 221 | 14 | 15 | yes |
| Project & inventory | project-statement | 174 | 60 | 70 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 166 | 170 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 171 | 174 | 16 | 17 | yes |
| Project & inventory | price-list | 669 | 151 | 154 | 6 | 8 | yes |
| Project & inventory | hold-register | 4 | 147 | 150 | 4 | 4 | yes |
| Project & inventory | landowner | 0 | 146 | 151 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 22 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 148 | 155 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 168 | 174 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 156 | 158 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 123 | 125 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 68 | 74 | 3 | 4 | yes |
| Leads | source-performance | 5 | 124 | 130 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 63 | 68 | 3 | 4 | yes |
| Leads | visit-register | 15 | 65 | 67 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 47 | 56 | 4 | 4 | yes |
| Leads | lost-leads | 1 | 62 | 68 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 65 | 72 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 127 | 136 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 63 | 64 | 3 | 4 | yes |
| Customers | service-sla | 9 | 47 | 53 | 4 | 4 | yes |

**50/50 within budget**
