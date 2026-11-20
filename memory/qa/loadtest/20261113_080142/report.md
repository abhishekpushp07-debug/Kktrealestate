# Journey load test — http://127.0.0.1:8033 — 20261113_080142
Project `LOADTEST-20261113_080142` (load_test:true, hidden from reports) · 400 flats · generator: preview pod (shared CPU) — client-side queueing inflates p95 at high VU counts; server `db` timings are not separated here.

## 3 VUs — 31s · 75 req · 2.4 rps
| endpoint group | n | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| leads | 72 | 25.9 | 32.9 | 37.9 |
| login | 3 | 234.6 | 234.7 | 234.7 |

Errors: none
Assertions: `integrity_ok_after_stage:ok`×1, `lead_converted:FAIL`×36, `lead_created:ok`×36
