# Perf budget — 2026-11-19 13:29 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 6.8 | 10.0 | 221.0 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 6.9 | 10.3 | 180.6 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=40d134fe-edbd-4103-a07e-a7c7b1e24060` | 4.8 | 5.4 | 112.1 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 4.1 | 15.3 | 154.1 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 33.7 | 38.5 | 35.1 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 15.1 | 17.6 | 19.8 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 5.4 | 10.6 | 5.7 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 7.5 | 8.4 | 8.5 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 3.5 | 4.6 | 248.2 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=54e7ef57-ef1c-4639-8ae3-abd23bf0ad59&page_size=200` | 5.2 | 5.5 | 9.2 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.0 | 5.5 | 25.3 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-19` | 3.4 | 3.7 | 362.8 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 17.9 | 18.7 | 207.1 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 69.6 | 108.9 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 202.9 | 239.2 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 468.6 | 535.6 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.8cd2334f.js
