# Journey load test — http://127.0.0.1:8033 — 20261113_080930
Project `LOADTEST-20261113_080930` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 3 VUs — 31s · 142 req · 4.6 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 14 | 197.6 | 265.4 | 265.4 |
| breakdown | 11 | 15.9 | 19.3 | 19.3 |
| construction | 6 | 131.3 | 293.5 | 293.5 |
| customers | 22 | 18.5 | 23.9 | 27.1 |
| demand_register | 9 | 5.3 | 6.8 | 6.8 |
| documents | 3 | 5.4 | 5.8 | 5.8 |
| flats | 10 | 8.2 | 8.9 | 8.9 |
| leads | 24 | 29.9 | 44.6 | 49.4 |
| ledger | 10 | 4.8 | 5.8 | 5.8 |
| login | 3 | 233.4 | 236.2 | 236.2 |
| payments | 11 | 117.2 | 135.9 | 135.9 |
| project_statement | 9 | 10.6 | 11.3 | 11.3 |
| receipt_pdf | 10 | 5.7 | 6.7 | 6.7 |

Errors: none
Assertions: `booking_created:ok`×11, `booking_total_matches_preview:ok`×11, `c360_shows_booking:FAIL`×10, `demand_register:ok`×9, `documents_register:ok`×3, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×10, `lead_converted:ok`×12, `lead_created:ok`×12, `ledger_bill_raised_positive:ok`×10, `ledger_received_equals_payment:ok`×10, `payment_posted:ok`×11, `project_statement:ok`×9, `receipt_pdf:ok`×10, `stage_demands_equal_active_bookings:ok`×3
