# Phase 3F report speed — test_database — 2026-11-18 07:09 UTC

Scratch copy of `test_database`, private backend. first = first page after a write (6 samples, every cache stale); cached = 20 repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ 300 ms, cached ≤ 100 ms.

| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |
|---|---|---|---|---|---|---|---|
| Customers | customer-status | 80 | 44 | 76 | 25 | 27 | yes |
| Customers | customer-statement | 36 | 7 | 11 | 5 | 6 | yes |
| Customers | customer-ageing | 42 | 23 | 24 | 5 | 6 | yes |
| Customers | advance-holders | 5 | 22 | 23 | 4 | 5 | yes |
| Customers | call-list | 42 | 25 | 26 | 5 | 6 | yes |
| Customers | kyc-pending | 80 | 28 | 29 | 6 | 6 | yes |
| Customers | payment-behaviour | 80 | 46 | 48 | 5 | 5 | yes |
| Customers | customer-directory | 82 | 27 | 34 | 5 | 6 | yes |
| Customers | cancelled-customers | 5 | 9 | 13 | 4 | 5 | yes |
| Finance | collections | 1,071 | 112 | 138 | 13 | 14 | yes |
| Finance | day-book | 211 | 35 | 40 | 5 | 6 | yes |
| Finance | bank-receipts | 5 | 66 | 84 | 12 | 14 | yes |
| Finance | cheques | 144 | 32 | 68 | 6 | 7 | yes |
| Finance | bills-vs-collection | 31 | 46 | 47 | 23 | 24 | yes |
| Finance | outstanding | 80 | 59 | 65 | 6 | 7 | yes |
| Finance | cash-vs-account | 80 | 26 | 29 | 6 | 7 | yes |
| Finance | other-charges | 81 | 28 | 117 | 6 | 7 | yes |
| Finance | receivables-forecast | 164 | 68 | 74 | 6 | 6 | yes |
| Finance | waivers | 5 | 13 | 14 | 4 | 4 | yes |
| Bookings | booking-register | 82 | 28 | 32 | 7 | 8 | yes |
| Bookings | sales-summary | 19 | 26 | 26 | 4 | 5 | yes |
| Bookings | discount-register | 26 | 18 | 20 | 5 | 5 | yes |
| Bookings | plan-position | 80 | 27 | 28 | 7 | 7 | yes |
| Bookings | agreements | 80 | 27 | 28 | 7 | 8 | yes |
| Bookings | cancellations | 0 | 15 | 16 | 4 | 4 | yes |
| Bookings | transfers | 2 | 230 | 237 | 4 | 5 | yes |
| Bookings | sales-team | 3 | 40 | 53 | 4 | 5 | yes |
| Bookings | realised-rate | 80 | 28 | 28 | 7 | 7 | yes |
| Bookings | booking-health | 80 | 27 | 28 | 7 | 8 | yes |
| Project & inventory | project-statement | 12 | 19 | 25 | 5 | 6 | yes |
| Project & inventory | inventory-status | 186 | 22 | 27 | 7 | 8 | yes |
| Project & inventory | stacking-plan | 186 | 23 | 23 | 8 | 9 | yes |
| Project & inventory | price-list | 105 | 21 | 22 | 6 | 6 | yes |
| Project & inventory | hold-register | 3 | 21 | 22 | 4 | 4 | yes |
| Project & inventory | landowner | 0 | 19 | 20 | 4 | 4 | yes |
| Project & inventory | parking | 132 | 10 | 12 | 5 | 6 | yes |
| Project & inventory | construction-vs-plan | 57 | 36 | 37 | 5 | 5 | yes |
| Project & inventory | stage-bills | 4 | 25 | 120 | 4 | 4 | yes |
| Project & inventory | sales-velocity | 6 | 21 | 25 | 4 | 4 | yes |
| Leads | lead-funnel | 7 | 16 | 37 | 4 | 5 | yes |
| Leads | lead-register | 135 | 17 | 18 | 5 | 6 | yes |
| Leads | source-performance | 6 | 16 | 17 | 4 | 5 | yes |
| Leads | follow-ups | 1 | 16 | 16 | 4 | 4 | yes |
| Leads | visit-register | 27 | 18 | 19 | 4 | 4 | yes |
| Leads | visit-conversion | 2 | 18 | 18 | 4 | 4 | yes |
| Leads | lost-leads | 9 | 16 | 16 | 4 | 4 | yes |
| Leads | response-time | 64 | 15 | 16 | 4 | 4 | yes |
| Leads | team-pipeline | 3 | 16 | 16 | 4 | 4 | yes |
| Leads | lead-ageing | 34 | 15 | 16 | 4 | 5 | yes |
| Customers | service-sla | 7 | 15 | 16 | 4 | 4 | yes |

**50/50 within budget**
