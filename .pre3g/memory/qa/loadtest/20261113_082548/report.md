# Journey load test — http://127.0.0.1:8033 — 20261113_082548
Project `LOADTEST-20261113_082548` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 20 VUs — 65s · 1704 req · 26.3 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 150 | 375.1 | 1206.7 | 1408.3 |
| breakdown | 140 | 22.8 | 47.9 | 54.3 |
| construction | 11 | 10.0 | 4482.7 | 4482.7 |
| customers | 278 | 25.6 | 53.4 | 70.9 |
| demand_register | 133 | 7.3 | 16.2 | 22.3 |
| documents | 5 | 5.7 | 14.0 | 14.0 |
| flats | 138 | 12.1 | 38.9 | 51.0 |
| leads | 280 | 46.3 | 143.6 | 156.6 |
| ledger | 138 | 7.1 | 18.2 | 29.0 |
| login | 20 | 237.9 | 241.2 | 241.2 |
| payments | 140 | 247.9 | 411.0 | 502.9 |
| project_statement | 133 | 20.6 | 49.6 | 60.0 |
| receipt_pdf | 138 | 8.8 | 22.6 | 40.6 |

Errors: none
Assertions: `booking_created:ok`×140, `booking_total_matches_preview:ok`×140, `c360_shows_booking:ok`×138, `demand_register:ok`×133, `documents_register:ok`×5, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×138, `lead_converted:ok`×140, `lead_created:ok`×140, `ledger_bill_raised_positive:ok`×138, `ledger_received_equals_payment:ok`×138, `payment_posted:ok`×140, `project_statement:ok`×133, `receipt_pdf:ok`×138, `stage_demands_match_active_bookings:ok`×5

## 50 VUs — 62s · 2903 req · 46.8 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 500 | 16.3 | 3014.8 | 5009.0 |
| breakdown | 500 | 22.3 | 146.9 | 264.8 |
| construction | 1 | 11.1 | 11.1 | 11.1 |
| customers | 555 | 39.6 | 172.3 | 220.7 |
| demand_register | 46 | 16.1 | 109.9 | 211.0 |
| flats | 46 | 137.4 | 299.9 | 317.2 |
| leads | 1018 | 52.3 | 297.8 | 401.4 |
| ledger | 46 | 63.0 | 139.8 | 153.3 |
| login | 50 | 239.6 | 254.3 | 276.3 |
| payments | 49 | 2227.7 | 2751.8 | 2792.5 |
| project_statement | 46 | 55.7 | 226.9 | 309.7 |
| receipt_pdf | 46 | 79.0 | 196.4 | 200.6 |

Errors: `409`×447, `client:RemoteProtocolError`×4
Assertions: `booking_created:FAIL`×451, `booking_created:ok`×49, `booking_total_matches_preview:ok`×49, `c360_shows_booking:ok`×46, `demand_register:ok`×46, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×46, `lead_converted:ok`×509, `lead_created:ok`×509, `ledger_bill_raised_positive:ok`×46, `ledger_received_equals_payment:ok`×46, `payment_posted:ok`×49, `project_statement:ok`×46, `receipt_pdf:ok`×46
