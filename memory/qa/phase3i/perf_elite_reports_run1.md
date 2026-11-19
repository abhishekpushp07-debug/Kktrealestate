# Phase 3F report speed — kkt_volume — 2026-11-19 13:24 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 178 | 229 | 12 | 29 | yes |
| Customers | customer-statement | 18 | 18 | 24 | 6 | 8 | yes |
| Customers | customer-ageing | 1,497 | 166 | 177 | 12 | 14 | yes |
| Customers | advance-holders | 888 | 164 | 176 | 9 | 12 | yes |
| Customers | call-list | 1,497 | 181 | 184 | 12 | 12 | yes |
| Customers | kyc-pending | 1,499 | 179 | 189 | 12 | 12 | yes |
| Customers | payment-behaviour | 1,490 | 215 | 224 | 6 | 7 | yes |
| Customers | customer-directory | 1,975 | 173 | 177 | 7 | 8 | yes |
| Customers | cancelled-customers | 1 | 18 | 21 | 3 | 3 | yes |
| Finance | collections | 10,498 | 104 | 124 | 12 | 12 | yes |
| Finance | day-book | 231 | 80 | 83 | 3 | 4 | yes |
| Finance | bank-receipts | 4 | 127 | 136 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 130 | 139 | 13 | 14 | yes |
| Finance | bills-vs-collection | 115 | 154 | 158 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 181 | 189 | 12 | 13 | yes |
| Finance | cash-vs-account | 1,499 | 111 | 114 | 13 | 14 | yes |
| Finance | other-charges | 1,497 | 129 | 132 | 13 | 14 | yes |
| Finance | receivables-forecast | 5,903 | 203 | 208 | 11 | 12 | yes |
| Finance | waivers | 0 | 37 | 41 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 188 | 193 | 12 | 13 | yes |
| Bookings | sales-summary | 160 | 173 | 176 | 3 | 3 | yes |
| Bookings | discount-register | 25 | 45 | 47 | 3 | 4 | yes |
| Bookings | plan-position | 1,499 | 187 | 192 | 12 | 13 | yes |
| Bookings | agreements | 1,499 | 187 | 192 | 12 | 12 | yes |
| Bookings | cancellations | 0 | 38 | 43 | 3 | 3 | yes |
| Bookings | transfers | 0 | 183 | 186 | 3 | 3 | yes |
| Bookings | sales-team | 2 | 197 | 203 | 3 | 3 | yes |
| Bookings | realised-rate | 1,499 | 188 | 190 | 12 | 13 | yes |
| Bookings | booking-health | 1,499 | 190 | 193 | 12 | 13 | yes |
| Project & inventory | project-statement | 174 | 53 | 63 | 4 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 160 | 165 | 13 | 15 | yes |
| Project & inventory | stacking-plan | 2,170 | 155 | 165 | 13 | 14 | yes |
| Project & inventory | price-list | 669 | 142 | 145 | 5 | 6 | yes |
| Project & inventory | hold-register | 4 | 135 | 139 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 134 | 137 | 3 | 3 | yes |
| Project & inventory | parking | 132 | 17 | 19 | 3 | 3 | yes |
| Project & inventory | construction-vs-plan | 46 | 126 | 133 | 3 | 4 | yes |
| Project & inventory | stage-bills | 36 | 147 | 151 | 3 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 144 | 147 | 3 | 3 | yes |
| Leads | lead-funnel | 7 | 104 | 108 | 3 | 3 | yes |
| Leads | lead-register | 1,498 | 58 | 63 | 3 | 3 | yes |
| Leads | source-performance | 5 | 104 | 109 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 52 | 56 | 3 | 3 | yes |
| Leads | visit-register | 9 | 57 | 58 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 40 | 49 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 52 | 58 | 2 | 3 | yes |
| Leads | response-time | 1,498 | 55 | 58 | 3 | 3 | yes |
| Leads | team-pipeline | 2 | 105 | 110 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 53 | 61 | 3 | 3 | yes |
| Customers | service-sla | 9 | 40 | 44 | 3 | 3 | yes |

**50/50 within budget**
