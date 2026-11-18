# Perf budget — 2026-11-16 05:59 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| write | Create booking | `POST /api/bookings` | 1428.8 | 1657.9 |  | ≤ 600 | NO |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.2 KB** (budget ≤ 250 KB) — /static/js/main.6d150af0.js

## Server-Timing spans (median ms over measured requests)
| span | p50 | p95 |
|---|---|---|
| total | 1428.8 | 1657.9 |
| db | 982.7 | 1238.9 |
| bk_dues | 948.8 | 1204.0 |
| ev_surface_snapshot | 952.6 | 1058.2 |
| app | 416.3 | 484.7 |
| bk_docs | 270.7 | 330.1 |
| bk_audit | 110.3 | 120.5 |
| ev_notifications | 60.1 | 71.6 |
| bk_lead | 13.5 | 15.4 |
| bk_uow | 10.4 | 12.3 |
| bk_rebuild | 9.0 | 10.7 |
| ev_read_models | 8.5 | 9.6 |
| bk_validate | 5.1 | 6.0 |
| bk_doc | 1.6 | 2.7 |
| ev_cache | 0.4 | 0.4 |
