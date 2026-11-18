# Journey load test — http://127.0.0.1:8033 — 20261113_081104
Project `LOADTEST-20261113_081104` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 20 VUs — 65s · 1689 req · 26.1 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 143 | 355.5 | 892.5 | 1204.7 |
| breakdown | 138 | 22.0 | 41.4 | 46.7 |
| construction | 11 | 14.5 | 4565.9 | 4565.9 |
| customers | 276 | 24.6 | 65.6 | 83.3 |
| demand_register | 134 | 6.5 | 12.7 | 22.1 |
| documents | 5 | 6.0 | 13.4 | 13.4 |
| flats | 138 | 13.6 | 46.1 | 63.0 |
| leads | 276 | 45.4 | 156.5 | 162.0 |
| ledger | 138 | 8.2 | 19.6 | 24.8 |
| login | 20 | 237.7 | 240.1 | 240.1 |
| payments | 138 | 215.9 | 349.0 | 360.0 |
| project_statement | 134 | 19.8 | 40.2 | 60.5 |
| receipt_pdf | 138 | 9.7 | 27.7 | 32.3 |

Errors: none
Assertions: `booking_created:ok`×138, `booking_total_matches_preview:ok`×138, `c360_shows_booking:ok`×138, `demand_register:ok`×134, `documents_register:ok`×5, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×138, `lead_converted:ok`×138, `lead_created:ok`×138, `ledger_bill_raised_positive:ok`×138, `ledger_received_equals_payment:ok`×138, `payment_posted:ok`×138, `project_statement:ok`×134, `receipt_pdf:ok`×138, `stage_demands_equal_active_bookings:FAIL`×3, `stage_demands_equal_active_bookings:ok`×2

## 50 VUs — 62s · 2942 req · 47.4 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 501 | 16.8 | 2991.1 | 6979.0 |
| breakdown | 501 | 22.2 | 126.5 | 276.0 |
| construction | 1 | 24.7 | 24.7 | 24.7 |
| customers | 563 | 40.7 | 106.6 | 242.9 |
| demand_register | 50 | 12.1 | 120.3 | 168.5 |
| flats | 50 | 68.9 | 338.1 | 443.0 |
| leads | 1026 | 54.6 | 338.0 | 419.2 |
| ledger | 50 | 34.4 | 142.3 | 181.6 |
| login | 50 | 239.7 | 245.8 | 280.1 |
| payments | 50 | 2353.9 | 2603.1 | 2633.3 |
| project_statement | 50 | 54.1 | 326.0 | 428.8 |
| receipt_pdf | 50 | 43.7 | 218.7 | 273.1 |

Errors: `409`×447, `client:RemoteProtocolError`×4
Assertions: `booking_created:FAIL`×451, `booking_created:ok`×50, `booking_total_matches_preview:ok`×50, `c360_shows_booking:ok`×50, `demand_register:ok`×50, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×50, `lead_converted:ok`×513, `lead_created:ok`×513, `ledger_bill_raised_positive:ok`×50, `ledger_received_equals_payment:ok`×50, `payment_posted:ok`×50, `project_statement:ok`×50, `receipt_pdf:ok`×50
