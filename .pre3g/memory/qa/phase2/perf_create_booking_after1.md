# Perf budget — 2026-11-16 06:03 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| write | Create booking | `POST /api/bookings` | 208.6 | 299.7 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.2 KB** (budget ≤ 250 KB) — /static/js/main.6d150af0.js

## Server-Timing spans (median ms over measured requests)
| span | p50 | p95 |
|---|---|---|
| total | 208.6 | 299.7 |
| db | 147.7 | 234.6 |
| bk_dues | 131.8 | 211.8 |
| app | 55.0 | 79.2 |
| ev_notifications | 50.3 | 84.0 |
| bk_uow | 10.7 | 27.6 |
| bk_lead | 14.6 | 33.2 |
| bk_audit | 13.1 | 29.2 |
| bk_rebuild | 9.9 | 13.9 |
| ev_read_models | 7.7 | 17.8 |
| bk_validate | 5.8 | 15.0 |
| bk_doc | 1.7 | 3.6 |
| ev_surface_snapshot | 0.7 | 2.9 |
| ev_cache | 0.2 | 0.2 |
| ev_roles_version | 0.0 | 0.0 |
| bk_docs | 0.0 | 0.0 |
