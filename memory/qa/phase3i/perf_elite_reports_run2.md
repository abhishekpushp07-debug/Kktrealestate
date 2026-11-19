# Phase 3F report speed — kkt_volume — 2026-11-19 18:16 UTC

Scratch copy of `kkt_volume`, private backend (2 process(es), CPUs 0,1). first = first page after a write (10 samples, every cache stale); cached = 30 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 1,499 | 188 | 229 | 14 | 15 | yes |
| Customers | customer-statement | 18 | 20 | 25 | 7 | 8 | yes |
| Customers | customer-ageing | 1,497 | 176 | 179 | 14 | 15 | yes |
| Customers | advance-holders | 888 | 172 | 175 | 10 | 10 | yes |
| Customers | call-list | 1,497 | 204 | 206 | 14 | 15 | yes |
| Customers | kyc-pending | 1,499 | 202 | 210 | 14 | 14 | yes |
| Customers | payment-behaviour | 1,490 | 253 | 259 | 7 | 8 | yes |
| Customers | customer-directory | 1,975 | 195 | 199 | 9 | 10 | yes |
| Customers | cancelled-customers | 1 | 21 | 24 | 4 | 4 | yes |
| Finance | collections | 10,498 | 129 | 154 | 15 | 15 | yes |
| Finance | day-book | 231 | 93 | 96 | 4 | 5 | yes |
| Finance | bank-receipts | 4 | 139 | 150 | 3 | 4 | yes |
| Finance | cheques | 3,585 | 153 | 159 | 14 | 15 | yes |
| Finance | bills-vs-collection | 115 | 160 | 167 | 4 | 4 | yes |
| Finance | outstanding | 1,499 | 191 | 201 | 14 | 16 | yes |
| Finance | cash-vs-account | 1,499 | 128 | 130 | 15 | 16 | yes |
| Finance | other-charges | 1,497 | 147 | 148 | 15 | 16 | yes |
| Finance | receivables-forecast | 5,903 | 239 | 253 | 15 | 16 | yes |
| Finance | waivers | 0 | 43 | 48 | 4 | 4 | yes |
| Bookings | booking-register | 1,500 | 216 | 222 | 14 | 16 | yes |
| Bookings | sales-summary | 160 | 197 | 199 | 4 | 5 | yes |
| Bookings | discount-register | 25 | 52 | 57 | 4 | 4 | yes |
| Bookings | plan-position | 1,499 | 213 | 215 | 14 | 15 | yes |
| Bookings | agreements | 1,499 | 211 | 215 | 14 | 15 | yes |
| Bookings | cancellations | 0 | 44 | 49 | 3 | 4 | yes |
| Bookings | transfers | 0 | 209 | 220 | 4 | 4 | yes |
| Bookings | sales-team | 2 | 222 | 228 | 4 | 5 | yes |
| Bookings | realised-rate | 1,499 | 215 | 219 | 14 | 15 | yes |
| Bookings | booking-health | 1,499 | 218 | 229 | 14 | 16 | yes |
| Project & inventory | project-statement | 174 | 62 | 73 | 6 | 7 | yes |
| Project & inventory | inventory-status | 2,170 | 177 | 188 | 15 | 16 | yes |
| Project & inventory | stacking-plan | 2,170 | 178 | 187 | 15 | 16 | yes |
| Project & inventory | price-list | 669 | 159 | 168 | 7 | 13 | yes |
| Project & inventory | hold-register | 4 | 153 | 160 | 4 | 4 | yes |
| Project & inventory | landowner | 0 | 152 | 156 | 4 | 4 | yes |
| Project & inventory | parking | 132 | 20 | 23 | 4 | 4 | yes |
| Project & inventory | construction-vs-plan | 46 | 171 | 178 | 5 | 6 | yes |
| Project & inventory | stage-bills | 36 | 167 | 172 | 5 | 5 | yes |
| Project & inventory | sales-velocity | 36 | 162 | 163 | 4 | 10 | yes |
| Leads | lead-funnel | 7 | 122 | 123 | 3 | 4 | yes |
| Leads | lead-register | 1,498 | 66 | 76 | 3 | 4 | yes |
| Leads | source-performance | 5 | 122 | 129 | 3 | 3 | yes |
| Leads | follow-ups | 7 | 62 | 68 | 3 | 3 | yes |
| Leads | visit-register | 9 | 65 | 66 | 4 | 4 | yes |
| Leads | visit-conversion | 2 | 48 | 56 | 4 | 4 | yes |
| Leads | lost-leads | 1 | 63 | 69 | 3 | 4 | yes |
| Leads | response-time | 1,498 | 66 | 72 | 3 | 4 | yes |
| Leads | team-pipeline | 2 | 125 | 132 | 3 | 4 | yes |
| Leads | lead-ageing | 7 | 63 | 65 | 3 | 3 | yes |
| Customers | service-sla | 9 | 46 | 52 | 3 | 4 | yes |

**50/50 within budget**
