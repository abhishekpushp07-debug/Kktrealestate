# Journey load test — http://127.0.0.1:8033 — 20261113_081833
Project `LOADTEST-20261113_081833` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 20 VUs — 65s · 1705 req · 26.3 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 151 | 396.9 | 908.5 | 1137.6 |
| breakdown | 141 | 22.0 | 38.1 | 46.4 |
| construction | 10 | 751.0 | 4250.7 | 4250.7 |
| customers | 278 | 25.6 | 55.6 | 74.2 |
| demand_register | 133 | 6.9 | 13.0 | 34.3 |
| documents | 5 | 8.1 | 9.6 | 9.6 |
| flats | 137 | 15.4 | 33.7 | 40.6 |
| leads | 282 | 44.9 | 150.6 | 160.2 |
| ledger | 137 | 8.2 | 17.5 | 20.3 |
| login | 20 | 237.8 | 241.5 | 241.5 |
| payments | 141 | 246.3 | 347.7 | 378.7 |
| project_statement | 133 | 22.2 | 40.3 | 46.3 |
| receipt_pdf | 137 | 9.7 | 21.6 | 30.2 |

Errors: none
Assertions: `booking_created:ok`×141, `booking_total_matches_preview:ok`×141, `c360_shows_booking:ok`×137, `demand_register:ok`×133, `documents_register:ok`×5, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×137, `lead_converted:ok`×141, `lead_created:ok`×141, `ledger_bill_raised_positive:ok`×137, `ledger_received_equals_payment:ok`×137, `payment_posted:ok`×141, `project_statement:ok`×133, `receipt_pdf:ok`×137, `stage_demands_match_active_bookings:ok`×5

## 50 VUs — 62s · 2865 req · 46.2 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 501 | 17.0 | 3213.6 | 5011.1 |
| breakdown | 501 | 24.0 | 156.6 | 248.1 |
| construction | 1 | 9.4 | 9.4 | 9.4 |
| customers | 552 | 43.0 | 177.9 | 286.5 |
| demand_register | 39 | 12.7 | 154.1 | 254.5 |
| flats | 39 | 101.5 | 344.5 | 358.1 |
| leads | 1026 | 59.2 | 365.0 | 394.5 |
| ledger | 39 | 74.4 | 203.0 | 211.1 |
| login | 50 | 237.2 | 274.5 | 318.5 |
| payments | 39 | 2519.2 | 2795.5 | 2844.2 |
| project_statement | 39 | 55.8 | 305.3 | 310.3 |
| receipt_pdf | 39 | 38.4 | 200.2 | 222.9 |

Errors: `409`×451, `client:RemoteProtocolError`×11
Assertions: `booking_created:FAIL`×462, `booking_created:ok`×39, `booking_total_matches_preview:ok`×39, `c360_shows_booking:ok`×39, `demand_register:ok`×39, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×39, `lead_converted:ok`×513, `lead_created:ok`×513, `ledger_bill_raised_positive:ok`×39, `ledger_received_equals_payment:ok`×39, `payment_posted:ok`×39, `project_statement:ok`×39, `receipt_pdf:ok`×39
