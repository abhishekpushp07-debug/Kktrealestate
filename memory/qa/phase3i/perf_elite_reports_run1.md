# Phase 3F report speed — kkt_volume — 2026-11-19 18:14 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 193 | 244 | 16 | 18 | yes |
| Customers | customer-statement | 18 | 21 | 26 | 8 | 10 | yes |
| Customers | customer-ageing | 1,497 | 182 | 192 | 14 | 15 | yes |
| Customers | advance-holders | 888 | 172 | 177 | 10 | 12 | yes |
| Customers | call-list | 1,497 | 206 | 207 | 14 | 16 | yes |
| Customers | kyc-pending | 1,499 | 205 | 209 | 14 | 15 | yes |
| Customers | payment-behaviour | 1,490 | 250 | 265 | 7 | 7 | yes |
| Customers | customer-directory | 1,975 | 199 | 282 | 8 | 9 | yes |
| Customers | cancelled-customers | 1 | 20 | 23 | 3 | 4 | yes |
| Finance | collections | 10,498 | 127 | 145 | 14 | 15 | yes |
| Finance | day-book | 231 | 92 | 94 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 128 | 139 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 154 | 158 | 14 | 15 | yes |
| Finance | bills-vs-collection | 115 | 161 | 170 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 195 | 201 | 14 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 128 | 129 | 16 | 17 | yes |
| Finance | other-charges | 1,497 | 151 | 152 | 15 | 17 | yes |
| Finance | receivables-forecast | 5,903 | 242 | 247 | 14 | 15 | yes |
| Finance | waivers | 0 | 43 | 49 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 217 | 222 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 196 | 199 | 4 | 5 | yes |
| Bookings | discount-register | 25 | 54 | 58 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 214 | 225 | 14 | 15 | yes |
| Bookings | agreements | 1,499 | 213 | 220 | 14 | 16 | yes |
| Bookings | cancellations | 0 | 43 | 50 | 4 | 4 | yes |
| Bookings | transfers | 0 | 212 | 217 | 4 | 5 | yes |
| Bookings | sales-team | 2 | 225 | 233 | 4 | 4 | yes |
| Bookings | realised-rate | 1,499 | 218 | 227 | 14 | 15 | yes |
| Bookings | booking-health | 1,499 | 220 | 250 | 14 | 15 | yes |
| Project & inventory | project-statement | 174 | 60 | 72 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 173 | 179 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 174 | 179 | 16 | 16 | yes |
| Project & inventory | price-list | 669 | 154 | 158 | 6 | 8 | yes |
| Project & inventory | hold-register | 4 | 147 | 154 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 146 | 153 | 3 | 3 | yes |
| Project & inventory | parking | 132 | 19 | 21 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 145 | 156 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 165 | 169 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 157 | 164 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 122 | 123 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 67 | 74 | 3 | 4 | yes |
| Leads | source-performance | 5 | 124 | 130 | 3 | 4 | yes |
| Leads | follow-ups | 7 | 63 | 68 | 3 | 4 | yes |
| Leads | visit-register | 9 | 65 | 66 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 47 | 56 | 4 | 4 | yes |
| Leads | lost-leads | 1 | 63 | 69 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 66 | 73 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 126 | 131 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 62 | 63 | 3 | 4 | yes |
| Customers | service-sla | 9 | 46 | 52 | 3 | 4 | yes |

**50/50 within budget**
