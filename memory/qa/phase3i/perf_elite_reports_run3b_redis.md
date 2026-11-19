# Phase 3F report speed — kkt_volume — 2026-11-19 18:18 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 190 | 228 | 14 | 15 | yes |
| Customers | customer-statement | 18 | 20 | 24 | 7 | 8 | yes |
| Customers | customer-ageing | 1,497 | 177 | 179 | 14 | 15 | yes |
| Customers | advance-holders | 888 | 173 | 177 | 11 | 12 | yes |
| Customers | call-list | 1,497 | 205 | 208 | 14 | 16 | yes |
| Customers | kyc-pending | 1,499 | 204 | 209 | 14 | 16 | yes |
| Customers | payment-behaviour | 1,490 | 254 | 262 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 197 | 199 | 8 | 10 | yes |
| Customers | cancelled-customers | 1 | 21 | 23 | 3 | 4 | yes |
| Finance | collections | 10,498 | 129 | 159 | 14 | 15 | yes |
| Finance | day-book | 231 | 92 | 93 | 4 | 4 | yes |
| Finance | bank-receipts | 4 | 148 | 161 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 152 | 171 | 14 | 16 | yes |
| Finance | bills-vs-collection | 115 | 168 | 173 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 195 | 200 | 14 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 128 | 130 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 149 | 151 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 247 | 250 | 14 | 15 | yes |
| Finance | waivers | 0 | 43 | 48 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 217 | 222 | 14 | 15 | yes |
| Bookings | sales-summary | 160 | 198 | 201 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 54 | 56 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 214 | 219 | 14 | 15 | yes |
| Bookings | agreements | 1,499 | 214 | 215 | 14 | 17 | yes |
| Bookings | cancellations | 0 | 44 | 49 | 3 | 4 | yes |
| Bookings | transfers | 0 | 210 | 227 | 4 | 4 | yes |
| Bookings | sales-team | 2 | 225 | 234 | 4 | 5 | yes |
| Bookings | realised-rate | 1,499 | 217 | 225 | 14 | 16 | yes |
| Bookings | booking-health | 1,499 | 218 | 227 | 14 | 15 | yes |
| Project & inventory | project-statement | 174 | 61 | 73 | 6 | 6 | yes |
| Project & inventory | inventory-status | 2,170 | 172 | 183 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 172 | 178 | 14 | 16 | yes |
| Project & inventory | price-list | 669 | 155 | 158 | 7 | 8 | yes |
| Project & inventory | hold-register | 4 | 153 | 164 | 4 | 4 | yes |
| Project & inventory | landowner | 0 | 151 | 163 | 4 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 22 | 4 | 6 | yes |
| Project & inventory | construction-vs-plan | 46 | 171 | 179 | 5 | 5 | yes |
| Project & inventory | stage-bills | 36 | 169 | 174 | 5 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 162 | 167 | 4 | 5 | yes |
| Leads | lead-funnel | 7 | 128 | 142 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 67 | 73 | 3 | 4 | yes |
| Leads | source-performance | 5 | 123 | 130 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 61 | 62 | 3 | 3 | yes |
| Leads | visit-register | 9 | 64 | 71 | 3 | 3 | yes |
| Leads | visit-conversion | 2 | 47 | 54 | 4 | 4 | yes |
| Leads | lost-leads | 1 | 62 | 64 | 3 | 3 | yes |
| Leads | response-time | 1,498 | 66 | 72 | 3 | 5 | yes |
| Leads | team-pipeline | 2 | 126 | 132 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 63 | 70 | 3 | 4 | yes |
| Customers | service-sla | 9 | 47 | 48 | 3 | 4 | yes |

**50/50 within budget**
