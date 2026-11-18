# Journey load test — http://127.0.0.1:8033 — 20261113_080308
Project `LOADTEST-20261113_080308` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 3 VUs — 31s · 15 req · 0.5 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| breakdown | 3 | 10.3 | 27.3 | 27.3 |
| customers | 3 | 20.8 | 22.4 | 22.4 |
| leads | 6 | 41.3 | 49.1 | 49.1 |
| login | 3 | 237.2 | 239.4 | 239.4 |

Errors: `422`×3
Assertions: `integrity_ok_after_stage:ok`×1, `lead_converted:ok`×3, `lead_created:ok`×3
