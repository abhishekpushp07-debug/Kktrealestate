# Journey load test — http://127.0.0.1:8033 — 20261113_080552
Project `LOADTEST-20261113_080552` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 3 VUs — 31s · 150 req · 4.9 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 14 | 194.7 | 343.8 | 343.8 |
| breakdown | 11 | 13.0 | 17.6 | 17.6 |
| construction | 6 | 48.0 | 226.8 | 226.8 |
| customers | 23 | 17.9 | 28.0 | 31.0 |
| demand_register | 11 | 5.0 | 8.3 | 8.3 |
| documents | 3 | 5.4 | 5.9 | 5.9 |
| flats | 11 | 7.9 | 8.8 | 8.8 |
| leads | 24 | 31.9 | 43.5 | 44.4 |
| ledger | 11 | 4.8 | 5.6 | 5.6 |
| login | 3 | 236.1 | 236.7 | 236.7 |
| payments | 11 | 123.1 | 143.6 | 143.6 |
| project_statement | 11 | 10.5 | 13.2 | 13.2 |
| receipt_pdf | 11 | 5.6 | 8.9 | 8.9 |

Errors: none
Assertions: `booking_created:ok`×11, `booking_total_matches_preview:ok`×11, `c360_shows_booking:FAIL`×11, `demand_register:ok`×11, `documents_register:ok`×3, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×11, `lead_converted:ok`×12, `lead_created:ok`×12, `ledger_bill_raised_positive:ok`×11, `ledger_received_equals_payment:ok`×11, `payment_posted:ok`×11, `project_statement:ok`×11, `receipt_pdf:ok`×11, `stage_demands_equal_active_bookings:ok`×3
