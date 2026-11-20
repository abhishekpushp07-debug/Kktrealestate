# Perf budget — 2026-11-18 15:29 UTC

Scratch copy of the preview DB, private backend (1 worker(s), no reload), 20 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 11.2 | 11.7 | 682.6 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 11.2 | 11.9 | 542.7 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=flat-ledger-11--18pq6xp9` | 7.4 | 7.8 | 189.6 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 5.1 | 6.8 | 220.8 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 35.3 | 35.6 | 37.3 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 16.3 | 16.5 | 20.9 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 6.2 | 6.4 | 6.8 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 8.3 | 8.7 | 13.9 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 135.6 | 135.8 | 476.9 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=flat-ledger-11--18pq6xp9&page_size=200` | 6.7 | 7.6 | 11.0 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 7.9 | 8.1 | 30.7 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-18` | 3.6 | 3.7 | 435.3 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 65.3 | 65.5 | 274.7 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 79.2 | 100.6 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 218.3 | 293.0 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 490.8 | 565.3 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.b98bfe98.js
