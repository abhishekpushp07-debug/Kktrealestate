# Journey load test — http://127.0.0.1:8033 — 20261113_080429
Project `LOADTEST-20261113_080429` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 3 VUs — 31s · 100 req · 3.3 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| breakdown | 22 | 9.3 | 12.6 | 13.1 |
| customers | 25 | 19.4 | 23.5 | 23.6 |
| leads | 50 | 28.5 | 37.4 | 37.6 |
| login | 3 | 235.3 | 235.7 | 235.7 |

Errors: `422`×22
Assertions: `integrity_ok_after_stage:ok`×1, `journey_exception:FAIL`×22, `lead_converted:ok`×25, `lead_created:ok`×25
