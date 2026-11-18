# Journey load test — http://127.0.0.1:8033 — 20261113_083038
Project `LOADTEST-20261113_083038` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 20 VUs — 65s · 1636 req · 25.3 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 144 | 396.6 | 1328.7 | 1510.8 |
| breakdown | 134 | 22.0 | 59.7 | 69.6 |
| construction | 10 | 1170.2 | 6744.2 | 6744.2 |
| customers | 267 | 23.9 | 54.8 | 76.8 |
| demand_register | 128 | 7.1 | 18.1 | 31.4 |
| documents | 5 | 8.9 | 11.5 | 11.5 |
| flats | 133 | 13.6 | 40.7 | 106.8 |
| leads | 268 | 44.1 | 162.2 | 171.3 |
| ledger | 133 | 7.6 | 25.3 | 49.3 |
| login | 20 | 236.6 | 239.3 | 239.3 |
| payments | 133 | 259.2 | 419.5 | 504.5 |
| project_statement | 128 | 21.5 | 48.8 | 77.8 |
| receipt_pdf | 133 | 9.0 | 31.9 | 77.2 |

Errors: none
Assertions: `booking_created:ok`×134, `booking_total_matches_preview:ok`×134, `c360_shows_booking:ok`×133, `demand_register:ok`×128, `documents_register:ok`×5, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×133, `lead_converted:ok`×134, `lead_created:ok`×134, `ledger_bill_raised_positive:ok`×133, `ledger_received_equals_payment:ok`×133, `payment_posted:ok`×133, `project_statement:ok`×128, `receipt_pdf:ok`×133, `stage_demands_match_active_bookings:ok`×5

## 50 VUs — 62s · 2069 req · 33.3 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 182 | 2729.4 | 7629.3 | 8549.2 |
| breakdown | 196 | 192.9 | 303.9 | 353.9 |
| construction | 3 | 137.3 | 195.7 | 195.7 |
| customers | 351 | 172.2 | 328.1 | 380.1 |
| demand_register | 144 | 69.9 | 140.9 | 204.9 |
| flats | 147 | 203.6 | 311.4 | 327.7 |
| leads | 408 | 288.4 | 426.0 | 487.8 |
| ledger | 147 | 95.3 | 166.2 | 198.5 |
| login | 50 | 239.6 | 245.6 | 279.4 |
| payments | 150 | 2247.6 | 2952.3 | 3179.7 |
| project_statement | 144 | 215.7 | 354.4 | 440.4 |
| receipt_pdf | 147 | 133.1 | 213.6 | 278.2 |

Errors: `client:RemoteProtocolError`×18
Assertions: `booking_created:FAIL`×18, `booking_created:ok`×164, `booking_total_matches_preview:ok`×164, `c360_shows_booking:ok`×147, `demand_register:ok`×144, `flat_dropped_from_pool`×18, `integrity_ok_after_stage:ok`×1, `inventory_flat_booked:ok`×147, `lead_converted:ok`×204, `lead_created:ok`×204, `ledger_bill_raised_positive:ok`×147, `ledger_received_equals_payment:ok`×147, `payment_posted:ok`×150, `project_statement:ok`×144, `receipt_pdf:ok`×147
