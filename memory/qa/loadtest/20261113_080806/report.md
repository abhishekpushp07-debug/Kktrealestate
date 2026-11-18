# Journey load test — http://127.0.0.1:8033 — 20261113_080806
Project `LOADTEST-20261113_080806` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 3 VUs — 31s · 101 req · 3.3 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| bookings | 14 | 200.0 | 220.2 | 220.2 |
| breakdown | 14 | 16.1 | 19.5 | 19.5 |
| customers | 27 | 18.5 | 26.4 | 30.8 |
| leads | 30 | 31.1 | 53.1 | 58.1 |
| login | 3 | 233.8 | 237.5 | 237.5 |
| payments | 13 | 123.9 | 146.1 | 146.1 |

Errors: none
Assertions: `booking_created:ok`×14, `booking_total_matches_preview:ok`×14, `integrity_ok_after_stage:ok`×1, `journey_exception:FAIL`×12, `lead_converted:ok`×15, `lead_created:ok`×15, `payment_posted:ok`×13
