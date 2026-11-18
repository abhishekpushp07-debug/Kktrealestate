# Perf budget — 2026-11-16 07:32 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| write | Create booking | `POST /api/bookings` | 277.1 | 390.9 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.2 KB** (budget ≤ 250 KB) — /static/js/main.6d150af0.js

## Server-Timing spans (median ms over measured requests)
| span | p50 | p95 |
|---|---|---|
| total | 277.1 | 390.9 |
| db | 195.5 | 265.6 |
| bk_dues | 161.7 | 261.9 |
| app | 75.9 | 144.1 |
| ev_notifications | 60.2 | 95.1 |
| bk_lead | 19.9 | 44.2 |
| bk_rebuild | 16.1 | 60.0 |
| bk_audit | 17.5 | 34.9 |
| bk_uow | 12.4 | 17.4 |
| ev_read_models | 11.4 | 19.7 |
| bk_validate | 8.9 | 21.5 |
| bk_doc | 2.4 | 8.7 |
| ev_surface_snapshot | 0.9 | 3.1 |
| ev_cache | 0.2 | 0.3 |
| ev_roles_version | 0.0 | 0.0 |
| bk_docs | 0.0 | 0.0 |
