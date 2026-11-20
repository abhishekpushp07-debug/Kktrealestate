# Phase 3F report speed — kkt_volume — 2026-11-20 12:52 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 223 | 227 | 13 | 15 | yes |
| Customers | customer-statement | 18 | 18 | 21 | 8 | 9 | yes |
| Customers | customer-ageing | 1,497 | 160 | 164 | 13 | 14 | yes |
| Customers | advance-holders | 888 | 154 | 160 | 9 | 10 | yes |
| Customers | call-list | 1,497 | 184 | 187 | 13 | 14 | yes |
| Customers | kyc-pending | 1,499 | 183 | 188 | 13 | 14 | yes |
| Customers | payment-behaviour | 1,490 | 221 | 234 | 6 | 8 | yes |
| Customers | customer-directory | 1,975 | 176 | 179 | 8 | 9 | yes |
| Customers | cancelled-customers | 1 | 20 | 21 | 3 | 3 | yes |
| Finance | collections | 10,498 | 117 | 136 | 13 | 14 | yes |
| Finance | day-book | 231 | 84 | 85 | 3 | 4 | yes |
| Finance | bank-receipts | 4 | 124 | 132 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 134 | 139 | 13 | 14 | yes |
| Finance | bills-vs-collection | 115 | 172 | 175 | 3 | 4 | yes |
| Finance | outstanding | 1,499 | 178 | 185 | 13 | 14 | yes |
| Finance | cash-vs-account | 1,499 | 114 | 116 | 13 | 14 | yes |
| Finance | other-charges | 1,497 | 133 | 134 | 14 | 14 | yes |
| Finance | receivables-forecast | 5,903 | 216 | 221 | 13 | 15 | yes |
| Finance | waivers | 0 | 40 | 46 | 3 | 3 | yes |
| Bookings | booking-register | 1,500 | 196 | 199 | 13 | 14 | yes |
| Bookings | sales-summary | 160 | 175 | 177 | 3 | 4 | yes |
| Bookings | discount-register | 25 | 48 | 49 | 4 | 4 | yes |
| Bookings | plan-position | 1,499 | 192 | 195 | 13 | 14 | yes |
| Bookings | agreements | 1,499 | 192 | 196 | 13 | 15 | yes |
| Bookings | cancellations | 0 | 40 | 44 | 3 | 3 | yes |
| Bookings | transfers | 0 | 187 | 188 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 119 | 122 | 3 | 3 | yes |
| Bookings | realised-rate | 1,499 | 192 | 196 | 13 | 14 | yes |
| Bookings | booking-health | 1,499 | 194 | 202 | 13 | 15 | yes |
| Project & inventory | project-statement | 174 | 53 | 59 | 4 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 152 | 156 | 14 | 14 | yes |
| Project & inventory | stacking-plan | 2,170 | 154 | 155 | 14 | 14 | yes |
| Project & inventory | price-list | 669 | 136 | 138 | 6 | 6 | yes |
| Project & inventory | hold-register | 4 | 131 | 134 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 131 | 133 | 3 | 3 | yes |
| Project & inventory | parking | 132 | 18 | 20 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 128 | 155 | 3 | 4 | yes |
| Project & inventory | stage-bills | 36 | 150 | 158 | 3 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 140 | 143 | 3 | 3 | yes |
| Leads | lead-funnel | 7 | 112 | 113 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 61 | 68 | 3 | 4 | yes |
| Leads | source-performance | 5 | 112 | 119 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 56 | 62 | 3 | 4 | yes |
| Leads | visit-register | 15 | 60 | 61 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 43 | 49 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 56 | 62 | 2 | 3 | yes |
| Leads | response-time | 1,498 | 59 | 67 | 3 | 3 | yes |
| Leads | team-pipeline | 2 | 114 | 120 | 2 | 3 | yes |
| Leads | lead-ageing | 7 | 57 | 58 | 2 | 3 | yes |
| Customers | service-sla | 9 | 41 | 47 | 3 | 3 | yes |

**50/50 within budget**
