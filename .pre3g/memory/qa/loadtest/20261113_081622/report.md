# Journey load test — http://127.0.0.1:8033 — 20261113_081622
Project `LOADTEST-20261113_081622` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 50 VUs — 32s · 1074 req · 33.7 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 101 | 1883.6 | 2781.0 | 2923.9 |
| breakdown | 101 | 112.7 | 217.2 | 243.2 |
| construction | 2 | 3648.5 | 3648.5 | 3648.5 |
| customers | 179 | 69.6 | 171.0 | 222.1 |
| demand_register | 62 | 10.4 | 64.9 | 106.3 |
| documents | 1 | 16.8 | 16.8 | 16.8 |
| flats | 75 | 113.6 | 231.0 | 250.5 |
| leads | 204 | 97.0 | 393.0 | 399.2 |
| ledger | 77 | 50.1 | 96.9 | 158.0 |
| login | 50 | 236.1 | 239.6 | 269.8 |
| payments | 85 | 1049.5 | 1823.9 | 1933.8 |
| project_statement | 62 | 33.5 | 168.5 | 211.0 |
| receipt_pdf | 75 | 73.2 | 149.1 | 182.5 |

Errors: none
Assertions: `booking_created:ok`×100, `booking_total_matches_preview:ok`×100, `c360_shows_booking:ok`×77, `demand_register:ok`×62, `documents_register:ok`×1, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×75, `lead_converted:ok`×102, `lead_created:ok`×102, `ledger_bill_raised_positive:ok`×77, `ledger_received_equals_payment:ok`×77, `payment_posted:ok`×85, `project_statement:ok`×62, `receipt_pdf:ok`×75, `stage_demands_equal_active_bookings:FAIL`×1
