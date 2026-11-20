# Phase 3F report speed — kkt_volume — 2026-11-19 20:00 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 189 | 227 | 14 | 15 | yes |
| Customers | customer-statement | 18 | 21 | 24 | 8 | 9 | yes |
| Customers | customer-ageing | 1,497 | 179 | 182 | 14 | 16 | yes |
| Customers | advance-holders | 888 | 173 | 176 | 10 | 11 | yes |
| Customers | call-list | 1,497 | 206 | 209 | 14 | 15 | yes |
| Customers | kyc-pending | 1,499 | 207 | 214 | 14 | 15 | yes |
| Customers | payment-behaviour | 1,490 | 256 | 267 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 197 | 200 | 9 | 10 | yes |
| Customers | cancelled-customers | 1 | 20 | 24 | 4 | 4 | yes |
| Finance | collections | 10,498 | 130 | 146 | 14 | 16 | yes |
| Finance | day-book | 231 | 94 | 96 | 4 | 5 | yes |
| Finance | bank-receipts | 4 | 148 | 161 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 153 | 161 | 13 | 16 | yes |
| Finance | bills-vs-collection | 115 | 165 | 171 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 198 | 203 | 13 | 15 | yes |
| Finance | cash-vs-account | 1,499 | 130 | 132 | 14 | 16 | yes |
| Finance | other-charges | 1,497 | 151 | 153 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 243 | 248 | 14 | 16 | yes |
| Finance | waivers | 0 | 44 | 49 | 3 | 4 | yes |
| Bookings | booking-register | 1,500 | 216 | 221 | 15 | 18 | yes |
| Bookings | sales-summary | 160 | 201 | 204 | 4 | 4 | yes |
| Bookings | discount-register | 25 | 55 | 57 | 4 | 5 | yes |
| Bookings | plan-position | 1,499 | 216 | 220 | 13 | 15 | yes |
| Bookings | agreements | 1,499 | 215 | 219 | 14 | 15 | yes |
| Bookings | cancellations | 0 | 45 | 50 | 3 | 4 | yes |
| Bookings | transfers | 0 | 210 | 216 | 3 | 4 | yes |
| Bookings | sales-team | 2 | 224 | 229 | 3 | 4 | yes |
| Bookings | realised-rate | 1,499 | 215 | 223 | 14 | 17 | yes |
| Bookings | booking-health | 1,499 | 220 | 223 | 14 | 16 | yes |
| Project & inventory | project-statement | 174 | 60 | 73 | 6 | 7 | yes |
| Project & inventory | inventory-status | 2,170 | 172 | 177 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 175 | 181 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 156 | 161 | 7 | 7 | yes |
| Project & inventory | hold-register | 4 | 150 | 157 | 3 | 4 | yes |
| Project & inventory | landowner | 0 | 149 | 153 | 3 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 22 | 3 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 150 | 161 | 4 | 5 | yes |
| Project & inventory | stage-bills | 36 | 167 | 172 | 4 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 161 | 163 | 3 | 4 | yes |
| Leads | lead-funnel | 7 | 124 | 126 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 67 | 74 | 3 | 4 | yes |
| Leads | source-performance | 5 | 125 | 131 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 62 | 68 | 3 | 4 | yes |
| Leads | visit-register | 15 | 65 | 66 | 3 | 4 | yes |
| Leads | visit-conversion | 2 | 48 | 57 | 3 | 4 | yes |
| Leads | lost-leads | 1 | 62 | 68 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 65 | 70 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 125 | 132 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 63 | 70 | 3 | 4 | yes |
| Customers | service-sla | 9 | 48 | 56 | 4 | 4 | yes |

**50/50 within budget**
