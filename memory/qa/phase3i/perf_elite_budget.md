# Perf budget — 2026-11-19 17:01 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 10.4 | 11.6 | 229.1 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 11.3 | 12.9 | 247.8 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=flat-ledger-11--18pq6xp9` | 8.5 | 10.3 | 214.2 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 7.5 | 8.5 | 180.6 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 42.4 | 113.8 | 43.7 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 21.6 | 22.6 | 25.7 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 8.5 | 10.0 | 9.0 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 10.4 | 14.5 | 11.8 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 174.2 | 256.2 | 242.0 | ≤ 200 | NO |
| hot | Unit grid | `/api/flats?block_id=flat-ledger-11--18pq6xp9&page_size=200` | 9.6 | 11.5 | 16.4 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 8.1 | 12.1 | 32.0 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-19` | 391.7 | 486.0 | 505.8 | ≤ 100 | NO |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 227.6 | 305.3 | 232.9 | ≤ 100 | NO |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 109.1 | 206.9 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 393.4 | 780.8 |  | ≤ 600 | NO |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 495.2 | 551.9 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.8cd2334f.js
