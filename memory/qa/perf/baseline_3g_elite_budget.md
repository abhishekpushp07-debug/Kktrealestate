# Perf budget — 2026-11-18 15:31 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 11.5 | 13.9 | 707.2 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 11.4 | 13.5 | 595.1 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=flat-ledger-11--18pq6xp9` | 7.5 | 9.4 | 188.7 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 6.0 | 7.4 | 225.8 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 38.7 | 41.3 | 38.3 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 19.8 | 21.1 | 24.5 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 6.3 | 9.1 | 9.0 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 8.5 | 10.4 | 14.6 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 133.8 | 136.1 | 499.5 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=flat-ledger-11--18pq6xp9&page_size=200` | 5.9 | 6.5 | 10.2 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 7.3 | 7.7 | 27.8 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-18` | 3.1 | 3.3 | 438.4 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 65.1 | 65.6 | 269.9 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 80.3 | 111.0 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 196.4 | 259.3 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 458.1 | 526.5 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.b98bfe98.js
