# Phase 3F report speed — kkt_volume — 2026-11-19 13:27 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 168 | 197 | 12 | 13 | yes |
| Customers | customer-statement | 18 | 17 | 21 | 6 | 7 | yes |
| Customers | customer-ageing | 1,497 | 157 | 163 | 12 | 12 | yes |
| Customers | advance-holders | 888 | 151 | 158 | 9 | 9 | yes |
| Customers | call-list | 1,497 | 180 | 181 | 12 | 12 | yes |
| Customers | kyc-pending | 1,499 | 181 | 188 | 12 | 12 | yes |
| Customers | payment-behaviour | 1,490 | 217 | 229 | 6 | 7 | yes |
| Customers | customer-directory | 1,975 | 174 | 177 | 8 | 13 | yes |
| Customers | cancelled-customers | 1 | 18 | 22 | 4 | 4 | yes |
| Finance | collections | 10,498 | 104 | 112 | 12 | 13 | yes |
| Finance | day-book | 231 | 81 | 85 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 130 | 150 | 4 | 4 | yes |
| Finance | cheques | 3,585 | 128 | 133 | 12 | 12 | yes |
| Finance | bills-vs-collection | 115 | 149 | 155 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 175 | 181 | 12 | 13 | yes |
| Finance | cash-vs-account | 1,499 | 110 | 125 | 13 | 14 | yes |
| Finance | other-charges | 1,497 | 131 | 150 | 13 | 15 | yes |
| Finance | receivables-forecast | 5,903 | 211 | 215 | 13 | 15 | yes |
| Finance | waivers | 0 | 39 | 44 | 4 | 4 | yes |
| Bookings | booking-register | 1,500 | 190 | 196 | 13 | 14 | yes |
| Bookings | sales-summary | 160 | 175 | 178 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 48 | 56 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 185 | 189 | 12 | 13 | yes |
| Bookings | agreements | 1,499 | 186 | 190 | 12 | 12 | yes |
| Bookings | cancellations | 0 | 38 | 42 | 3 | 3 | yes |
| Bookings | transfers | 0 | 182 | 184 | 3 | 3 | yes |
| Bookings | sales-team | 2 | 197 | 202 | 3 | 3 | yes |
| Bookings | realised-rate | 1,499 | 188 | 193 | 12 | 12 | yes |
| Bookings | booking-health | 1,499 | 191 | 198 | 12 | 13 | yes |
| Project & inventory | project-statement | 174 | 51 | 61 | 4 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 145 | 156 | 12 | 13 | yes |
| Project & inventory | stacking-plan | 2,170 | 146 | 150 | 12 | 13 | yes |
| Project & inventory | price-list | 669 | 132 | 136 | 5 | 6 | yes |
| Project & inventory | hold-register | 4 | 128 | 131 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 128 | 130 | 2 | 3 | yes |
| Project & inventory | parking | 132 | 17 | 19 | 3 | 3 | yes |
| Project & inventory | construction-vs-plan | 46 | 125 | 134 | 3 | 4 | yes |
| Project & inventory | stage-bills | 36 | 146 | 154 | 3 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 137 | 143 | 3 | 3 | yes |
| Leads | lead-funnel | 7 | 102 | 110 | 2 | 3 | yes |
| Leads | lead-register | 1,498 | 56 | 62 | 3 | 3 | yes |
| Leads | source-performance | 5 | 103 | 107 | 2 | 3 | yes |
| Leads | follow-ups | 7 | 52 | 57 | 2 | 3 | yes |
| Leads | visit-register | 9 | 54 | 55 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 39 | 46 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 52 | 58 | 2 | 3 | yes |
| Leads | response-time | 1,498 | 54 | 59 | 3 | 3 | yes |
| Leads | team-pipeline | 2 | 103 | 106 | 2 | 3 | yes |
| Leads | lead-ageing | 7 | 52 | 57 | 3 | 3 | yes |
| Customers | service-sla | 9 | 39 | 43 | 3 | 3 | yes |

**50/50 within budget**
