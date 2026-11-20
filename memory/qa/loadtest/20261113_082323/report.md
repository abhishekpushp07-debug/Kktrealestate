# Journey load test — http://127.0.0.1:8033 — 20261113_082323
Project `LOADTEST-20261113_082323` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 20 VUs — 25s · 564 req · 22.8 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 52 | 354.1 | 506.6 | 524.3 |
| breakdown | 48 | 20.9 | 41.6 | 49.9 |
| construction | 4 | 537.2 | 1169.3 | 1169.3 |
| customers | 90 | 23.1 | 38.4 | 61.9 |
| demand_register | 41 | 5.7 | 11.8 | 36.0 |
| documents | 2 | 9.0 | 9.0 | 9.0 |
| flats | 42 | 11.8 | 33.7 | 41.8 |
| leads | 96 | 43.3 | 169.9 | 173.0 |
| ledger | 42 | 6.7 | 15.7 | 18.7 |
| login | 20 | 235.9 | 272.1 | 272.1 |
| payments | 44 | 222.1 | 317.2 | 341.4 |
| project_statement | 41 | 14.7 | 37.4 | 42.4 |
| receipt_pdf | 42 | 8.2 | 21.0 | 28.9 |

Errors: none
Assertions: `booking_created:ok`×48, `booking_total_matches_preview:ok`×48, `c360_shows_booking:ok`×42, `demand_register:ok`×41, `documents_register:ok`×2, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×42, `lead_converted:ok`×48, `lead_created:ok`×48, `ledger_bill_raised_positive:ok`×42, `ledger_received_equals_payment:FAIL`×1, `ledger_received_equals_payment:ok`×41, `payment_posted:ok`×44, `project_statement:ok`×41, `receipt_pdf:ok`×42, `stage_demands_match_active_bookings:ok`×2

## 50 VUs — 22s · 496 req · 22.7 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 51 | 2420.5 | 3965.9 | 4110.4 |
| breakdown | 50 | 144.0 | 236.0 | 254.4 |
| construction | 1 | 40.5 | 40.5 | 40.5 |
| customers | 81 | 80.3 | 121.1 | 179.0 |
| demand_register | 15 | 37.4 | 110.2 | 110.2 |
| flats | 27 | 117.1 | 194.0 | 199.2 |
| leads | 100 | 311.0 | 414.2 | 417.2 |
| ledger | 30 | 48.6 | 77.7 | 94.7 |
| login | 50 | 237.3 | 239.5 | 240.3 |
| payments | 49 | 1276.3 | 2052.4 | 2160.0 |
| project_statement | 15 | 77.3 | 167.4 | 167.4 |
| receipt_pdf | 27 | 79.2 | 151.2 | 166.3 |

Errors: none
Assertions: `booking_created:ok`×50, `booking_total_matches_preview:ok`×50, `c360_shows_booking:ok`×31, `demand_register:ok`×15, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×27, `lead_converted:ok`×50, `lead_created:ok`×50, `ledger_bill_raised_positive:ok`×30, `ledger_received_equals_payment:ok`×30, `payment_posted:ok`×49, `project_statement:ok`×15, `receipt_pdf:ok`×27
