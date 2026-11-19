# Phase 3F report speed — kkt_volume — 2026-11-19 13:25 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 180 | 211 | 13 | 24 | yes |
| Customers | customer-statement | 18 | 17 | 25 | 7 | 8 | yes |
| Customers | customer-ageing | 1,497 | 167 | 180 | 12 | 14 | yes |
| Customers | advance-holders | 888 | 160 | 169 | 9 | 10 | yes |
| Customers | call-list | 1,497 | 178 | 182 | 12 | 13 | yes |
| Customers | kyc-pending | 1,499 | 178 | 184 | 12 | 12 | yes |
| Customers | payment-behaviour | 1,490 | 211 | 223 | 6 | 7 | yes |
| Customers | customer-directory | 1,975 | 173 | 176 | 7 | 8 | yes |
| Customers | cancelled-customers | 1 | 18 | 20 | 3 | 3 | yes |
| Finance | collections | 10,498 | 108 | 120 | 12 | 12 | yes |
| Finance | day-book | 231 | 80 | 87 | 3 | 4 | yes |
| Finance | bank-receipts | 4 | 116 | 124 | 3 | 3 | yes |
| Finance | cheques | 3,585 | 128 | 133 | 12 | 12 | yes |
| Finance | bills-vs-collection | 115 | 149 | 152 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 175 | 181 | 12 | 13 | yes |
| Finance | cash-vs-account | 1,499 | 111 | 116 | 12 | 13 | yes |
| Finance | other-charges | 1,497 | 128 | 136 | 13 | 14 | yes |
| Finance | receivables-forecast | 5,903 | 198 | 203 | 12 | 13 | yes |
| Finance | waivers | 0 | 37 | 43 | 3 | 3 | yes |
| Bookings | booking-register | 1,500 | 187 | 192 | 12 | 13 | yes |
| Bookings | sales-summary | 160 | 174 | 179 | 3 | 3 | yes |
| Bookings | discount-register | 25 | 44 | 48 | 3 | 4 | yes |
| Bookings | plan-position | 1,499 | 186 | 190 | 12 | 12 | yes |
| Bookings | agreements | 1,499 | 186 | 189 | 12 | 13 | yes |
| Bookings | cancellations | 0 | 37 | 42 | 3 | 3 | yes |
| Bookings | transfers | 0 | 183 | 185 | 3 | 3 | yes |
| Bookings | sales-team | 2 | 196 | 203 | 3 | 3 | yes |
| Bookings | realised-rate | 1,499 | 186 | 193 | 12 | 13 | yes |
| Bookings | booking-health | 1,499 | 189 | 194 | 12 | 13 | yes |
| Project & inventory | project-statement | 174 | 50 | 61 | 4 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 156 | 162 | 13 | 14 | yes |
| Project & inventory | stacking-plan | 2,170 | 155 | 160 | 12 | 17 | yes |
| Project & inventory | price-list | 669 | 138 | 141 | 5 | 6 | yes |
| Project & inventory | hold-register | 4 | 134 | 136 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 132 | 136 | 2 | 3 | yes |
| Project & inventory | parking | 132 | 16 | 19 | 3 | 3 | yes |
| Project & inventory | construction-vs-plan | 46 | 127 | 133 | 3 | 3 | yes |
| Project & inventory | stage-bills | 36 | 147 | 152 | 3 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 142 | 146 | 3 | 3 | yes |
| Leads | lead-funnel | 7 | 107 | 110 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 59 | 67 | 3 | 3 | yes |
| Leads | source-performance | 5 | 104 | 110 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 52 | 58 | 3 | 3 | yes |
| Leads | visit-register | 9 | 55 | 57 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 40 | 48 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 52 | 58 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 53 | 57 | 3 | 3 | yes |
| Leads | team-pipeline | 2 | 103 | 105 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 51 | 57 | 3 | 3 | yes |
| Customers | service-sla | 9 | 39 | 44 | 3 | 3 | yes |

**50/50 within budget**
