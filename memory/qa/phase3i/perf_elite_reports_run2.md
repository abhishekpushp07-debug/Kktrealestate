# Phase 3F report speed — kkt_volume — 2026-11-19 20:02 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 190 | 231 | 13 | 14 | yes |
| Customers | customer-statement | 18 | 20 | 25 | 8 | 9 | yes |
| Customers | customer-ageing | 1,497 | 178 | 181 | 13 | 15 | yes |
| Customers | advance-holders | 888 | 172 | 177 | 10 | 11 | yes |
| Customers | call-list | 1,497 | 205 | 209 | 14 | 15 | yes |
| Customers | kyc-pending | 1,499 | 206 | 213 | 13 | 15 | yes |
| Customers | payment-behaviour | 1,490 | 259 | 270 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 198 | 201 | 8 | 10 | yes |
| Customers | cancelled-customers | 1 | 21 | 24 | 4 | 4 | yes |
| Finance | collections | 10,498 | 129 | 147 | 15 | 15 | yes |
| Finance | day-book | 231 | 94 | 96 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 166 | 176 | 4 | 5 | yes |
| Finance | cheques | 3,585 | 153 | 159 | 14 | 15 | yes |
| Finance | bills-vs-collection | 115 | 163 | 169 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 194 | 199 | 13 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 132 | 134 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 152 | 153 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 246 | 251 | 14 | 16 | yes |
| Finance | waivers | 0 | 44 | 48 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 216 | 220 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 198 | 206 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 53 | 56 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 216 | 221 | 14 | 16 | yes |
| Bookings | agreements | 1,499 | 215 | 219 | 14 | 21 | yes |
| Bookings | cancellations | 0 | 44 | 51 | 3 | 4 | yes |
| Bookings | transfers | 0 | 211 | 214 | 4 | 4 | yes |
| Bookings | sales-team | 2 | 227 | 233 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 216 | 222 | 14 | 15 | yes |
| Bookings | booking-health | 1,499 | 219 | 222 | 13 | 15 | yes |
| Project & inventory | project-statement | 174 | 61 | 70 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 173 | 175 | 14 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 174 | 179 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 155 | 160 | 6 | 8 | yes |
| Project & inventory | hold-register | 4 | 150 | 155 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 149 | 153 | 3 | 3 | yes |
| Project & inventory | parking | 132 | 20 | 22 | 4 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 150 | 160 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 166 | 169 | 4 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 159 | 163 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 124 | 125 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 69 | 76 | 3 | 4 | yes |
| Leads | source-performance | 5 | 125 | 134 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 62 | 68 | 3 | 3 | yes |
| Leads | visit-register | 15 | 66 | 67 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 48 | 56 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 64 | 69 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 66 | 72 | 4 | 4 | yes |
| Leads | team-pipeline | 2 | 127 | 130 | 4 | 4 | yes |
| Leads | lead-ageing | 7 | 65 | 75 | 3 | 3 | yes |
| Customers | service-sla | 9 | 48 | 54 | 3 | 4 | yes |

**50/50 within budget**
