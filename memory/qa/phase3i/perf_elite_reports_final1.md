# Phase 3F report speed — kkt_volume — 2026-11-20 12:51 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 223 | 229 | 13 | 14 | yes |
| Customers | customer-statement | 18 | 19 | 21 | 8 | 9 | yes |
| Customers | customer-ageing | 1,497 | 161 | 168 | 13 | 14 | yes |
| Customers | advance-holders | 888 | 156 | 158 | 10 | 10 | yes |
| Customers | call-list | 1,497 | 185 | 191 | 13 | 15 | yes |
| Customers | kyc-pending | 1,499 | 184 | 190 | 13 | 15 | yes |
| Customers | payment-behaviour | 1,490 | 224 | 236 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 177 | 180 | 8 | 9 | yes |
| Customers | cancelled-customers | 1 | 19 | 20 | 3 | 4 | yes |
| Finance | collections | 10,498 | 116 | 134 | 13 | 14 | yes |
| Finance | day-book | 231 | 82 | 86 | 3 | 4 | yes |
| Finance | bank-receipts | 4 | 126 | 138 | 3 | 3 | yes |
| Finance | cheques | 3,585 | 134 | 138 | 13 | 14 | yes |
| Finance | bills-vs-collection | 115 | 172 | 177 | 3 | 3 | yes |
| Finance | outstanding | 1,499 | 177 | 189 | 13 | 14 | yes |
| Finance | cash-vs-account | 1,499 | 113 | 117 | 13 | 15 | yes |
| Finance | other-charges | 1,497 | 134 | 144 | 15 | 15 | yes |
| Finance | receivables-forecast | 5,903 | 209 | 216 | 14 | 15 | yes |
| Finance | waivers | 0 | 40 | 43 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 197 | 200 | 13 | 14 | yes |
| Bookings | sales-summary | 160 | 175 | 176 | 3 | 4 | yes |
| Bookings | discount-register | 25 | 48 | 51 | 4 | 4 | yes |
| Bookings | plan-position | 1,499 | 191 | 196 | 12 | 14 | yes |
| Bookings | agreements | 1,499 | 190 | 196 | 14 | 14 | yes |
| Bookings | cancellations | 0 | 40 | 45 | 3 | 3 | yes |
| Bookings | transfers | 0 | 186 | 199 | 3 | 3 | yes |
| Bookings | sales-team | 2 | 117 | 120 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 189 | 193 | 13 | 14 | yes |
| Bookings | booking-health | 1,499 | 192 | 194 | 13 | 14 | yes |
| Project & inventory | project-statement | 174 | 54 | 62 | 4 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 149 | 158 | 14 | 15 | yes |
| Project & inventory | stacking-plan | 2,170 | 150 | 154 | 14 | 14 | yes |
| Project & inventory | price-list | 669 | 131 | 138 | 6 | 6 | yes |
| Project & inventory | hold-register | 4 | 127 | 133 | 2 | 3 | yes |
| Project & inventory | landowner | 0 | 126 | 132 | 2 | 3 | yes |
| Project & inventory | parking | 132 | 18 | 19 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 126 | 133 | 4 | 4 | yes |
| Project & inventory | stage-bills | 36 | 149 | 156 | 3 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 136 | 142 | 3 | 3 | yes |
| Leads | lead-funnel | 7 | 109 | 111 | 2 | 3 | yes |
| Leads | lead-register | 1,498 | 59 | 64 | 3 | 3 | yes |
| Leads | source-performance | 5 | 109 | 115 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 55 | 60 | 3 | 4 | yes |
| Leads | visit-register | 15 | 59 | 63 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 44 | 52 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 55 | 60 | 2 | 3 | yes |
| Leads | response-time | 1,498 | 57 | 62 | 3 | 3 | yes |
| Leads | team-pipeline | 2 | 111 | 116 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 55 | 56 | 3 | 3 | yes |
| Customers | service-sla | 9 | 42 | 47 | 3 | 3 | yes |

**50/50 within budget**
