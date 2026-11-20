# Phase 3F report speed — kkt_volume — 2026-11-20 12:54 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 224 | 229 | 13 | 14 | yes |
| Customers | customer-statement | 18 | 18 | 21 | 7 | 8 | yes |
| Customers | customer-ageing | 1,497 | 162 | 174 | 14 | 15 | yes |
| Customers | advance-holders | 888 | 156 | 161 | 10 | 11 | yes |
| Customers | call-list | 1,497 | 185 | 188 | 13 | 15 | yes |
| Customers | kyc-pending | 1,499 | 184 | 190 | 14 | 14 | yes |
| Customers | payment-behaviour | 1,490 | 226 | 233 | 7 | 9 | yes |
| Customers | customer-directory | 1,975 | 178 | 182 | 8 | 9 | yes |
| Customers | cancelled-customers | 1 | 19 | 21 | 3 | 4 | yes |
| Finance | collections | 10,498 | 114 | 133 | 13 | 14 | yes |
| Finance | day-book | 231 | 84 | 88 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 157 | 168 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 137 | 158 | 13 | 14 | yes |
| Finance | bills-vs-collection | 115 | 170 | 174 | 3 | 5 | yes |
| Finance | outstanding | 1,499 | 178 | 183 | 14 | 14 | yes |
| Finance | cash-vs-account | 1,499 | 114 | 119 | 14 | 14 | yes |
| Finance | other-charges | 1,497 | 133 | 138 | 15 | 15 | yes |
| Finance | receivables-forecast | 5,903 | 213 | 216 | 13 | 14 | yes |
| Finance | waivers | 0 | 39 | 44 | 3 | 3 | yes |
| Bookings | booking-register | 1,500 | 194 | 201 | 13 | 14 | yes |
| Bookings | sales-summary | 160 | 176 | 178 | 3 | 4 | yes |
| Bookings | discount-register | 25 | 47 | 49 | 4 | 4 | yes |
| Bookings | plan-position | 1,499 | 192 | 200 | 13 | 14 | yes |
| Bookings | agreements | 1,499 | 192 | 196 | 14 | 15 | yes |
| Bookings | cancellations | 0 | 41 | 44 | 3 | 4 | yes |
| Bookings | transfers | 0 | 190 | 193 | 3 | 3 | yes |
| Bookings | sales-team | 2 | 120 | 125 | 3 | 3 | yes |
| Bookings | realised-rate | 1,499 | 192 | 201 | 14 | 19 | yes |
| Bookings | booking-health | 1,499 | 192 | 199 | 14 | 14 | yes |
| Project & inventory | project-statement | 174 | 53 | 60 | 5 | 5 | yes |
| Project & inventory | inventory-status | 2,170 | 150 | 154 | 14 | 15 | yes |
| Project & inventory | stacking-plan | 2,170 | 150 | 153 | 14 | 15 | yes |
| Project & inventory | price-list | 669 | 134 | 136 | 6 | 6 | yes |
| Project & inventory | hold-register | 4 | 130 | 133 | 3 | 3 | yes |
| Project & inventory | landowner | 0 | 128 | 130 | 2 | 3 | yes |
| Project & inventory | parking | 132 | 18 | 19 | 3 | 3 | yes |
| Project & inventory | construction-vs-plan | 46 | 130 | 138 | 3 | 4 | yes |
| Project & inventory | stage-bills | 36 | 151 | 156 | 3 | 4 | yes |
| Project & inventory | sales-velocity | 36 | 138 | 139 | 3 | 3 | yes |
| Leads | lead-funnel | 7 | 113 | 114 | 2 | 3 | yes |
| Leads | lead-register | 1,498 | 62 | 67 | 3 | 3 | yes |
| Leads | source-performance | 5 | 114 | 116 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 57 | 62 | 3 | 3 | yes |
| Leads | visit-register | 15 | 59 | 60 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 42 | 50 | 3 | 3 | yes |
| Leads | lost-leads | 1 | 56 | 61 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 59 | 64 | 3 | 3 | yes |
| Leads | team-pipeline | 2 | 114 | 118 | 3 | 3 | yes |
| Leads | lead-ageing | 7 | 56 | 57 | 2 | 3 | yes |
| Customers | service-sla | 9 | 42 | 48 | 3 | 4 | yes |

**50/50 within budget**
