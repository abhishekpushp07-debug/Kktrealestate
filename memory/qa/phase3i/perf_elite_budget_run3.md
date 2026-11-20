# Perf budget — 2026-11-19 20:09 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 8.2 | 8.9 | 180.1 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 8.0 | 8.6 | 182.0 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=flat-ledger-11--18pq6xp9` | 5.6 | 7.0 | 92.5 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 5.5 | 6.5 | 174.7 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 38.9 | 41.5 | 39.0 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 18.1 | 19.3 | 27.8 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 6.6 | 7.9 | 6.9 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 10.4 | 12.3 | 12.5 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 5.3 | 7.2 | 221.5 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=flat-ledger-11--18pq6xp9&page_size=200` | 6.7 | 8.1 | 12.1 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 6.9 | 8.1 | 30.3 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-19` | 4.4 | 5.2 | 418.1 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 19.9 | 20.8 | 234.2 | ≤ 100 | yes |
| after_save | Home Command Center (month) — first after a save | `/api/home/bundle?period=month` | 195.8 | 204.5 |  | ≤ 200 | NO |
| after_save | Bills raised page — first after a save | `/api/demands/register?page_size=50` | 153.9 | 229.7 |  | ≤ 200 | NO |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 83.8 | 105.2 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 179.0 | 254.6 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 416.6 | 436.6 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.8cd2334f.js
