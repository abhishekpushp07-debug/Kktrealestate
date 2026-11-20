# Phase 3F report speed — kkt_volume — 2026-11-19 11:19 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 197 | 280 | 13 | 14 | yes |
| Customers | customer-statement | 18 | 19 | 23 | 7 | 9 | yes |
| Customers | customer-ageing | 1,497 | 172 | 193 | 12 | 14 | yes |
| Customers | advance-holders | 888 | 169 | 178 | 10 | 12 | yes |
| Customers | call-list | 1,497 | 192 | 208 | 12 | 13 | yes |
| Customers | kyc-pending | 1,499 | 193 | 204 | 12 | 12 | yes |
| Customers | payment-behaviour | 1,490 | 233 | 259 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 177 | 191 | 8 | 13 | yes |
| Customers | cancelled-customers | 1 | 19 | 22 | 3 | 4 | yes |
| Finance | collections | 10,498 | 239 | 245 | 12 | 13 | yes |
| Finance | day-book | 231 | 81 | 89 | 3 | 4 | yes |
| Finance | bank-receipts | 4 | 92 | 102 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 130 | 135 | 12 | 13 | yes |
| Finance | bills-vs-collection | 115 | 149 | 159 | 3 | 6 | yes |
| Finance | outstanding | 1,499 | 175 | 182 | 12 | 13 | yes |
| Finance | cash-vs-account | 1,499 | 111 | 117 | 12 | 18 | yes |
| Finance | other-charges | 1,497 | 126 | 133 | 13 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 204 | 210 | 12 | 13 | yes |
| Finance | waivers | 0 | 38 | 43 | 3 | 6 | yes |
| Bookings | booking-register | 1,500 | 191 | 200 | 12 | 16 | yes |
| Bookings | sales-summary | 160 | 179 | 187 | 3 | 3 | yes |
| Bookings | discount-register | 25 | 45 | 50 | 3 | 3 | yes |
| Bookings | plan-position | 1,499 | 193 | 200 | 12 | 14 | yes |
| Bookings | agreements | 1,499 | 188 | 198 | 12 | 14 | yes |
| Bookings | cancellations | 0 | 38 | 43 | 3 | 3 | yes |
| Bookings | transfers | 0 | 192 | 206 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 210 | 219 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 189 | 204 | 12 | 18 | yes |
| Bookings | booking-health | 1,499 | 193 | 208 | 12 | 13 | yes |
| Project & inventory | project-statement | 174 | 55 | 64 | 5 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 161 | 176 | 13 | 14 | yes |
| Project & inventory | stacking-plan | 2,170 | 163 | 184 | 13 | 13 | yes |
| Project & inventory | price-list | 669 | 142 | 175 | 6 | 7 | yes |
| Project & inventory | hold-register | 4 | 140 | 150 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 136 | 144 | 3 | 5 | yes |
| Project & inventory | parking | 132 | 17 | 19 | 3 | 5 | yes |
| Project & inventory | construction-vs-plan | 46 | 131 | 146 | 3 | 4 | yes |
| Project & inventory | stage-bills | 36 | 154 | 158 | 3 | 6 | yes |
| Project & inventory | sales-velocity | 36 | 144 | 150 | 3 | 5 | yes |
| Leads | lead-funnel | 7 | 107 | 117 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 59 | 68 | 3 | 3 | yes |
| Leads | source-performance | 5 | 105 | 112 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 56 | 66 | 3 | 4 | yes |
| Leads | visit-register | 9 | 63 | 73 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 42 | 49 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 54 | 59 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 59 | 64 | 3 | 5 | yes |
| Leads | team-pipeline | 2 | 110 | 113 | 2 | 3 | yes |
| Leads | lead-ageing | 7 | 53 | 57 | 3 | 3 | yes |
| Customers | service-sla | 9 | 41 | 46 | 3 | 5 | yes |

**50/50 within budget**
