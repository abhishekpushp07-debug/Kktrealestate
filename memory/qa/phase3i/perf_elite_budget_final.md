# Perf budget — 2026-11-20 13:34 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 6.1 | 6.3 | 114.0 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 6.3 | 6.7 | 110.8 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=40d134fe-edbd-4103-a07e-a7c7b1e24060` | 4.4 | 4.6 | 70.1 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 3.7 | 4.0 | 107.7 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 32.0 | 32.7 | 33.9 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 13.9 | 14.6 | 18.3 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 5.1 | 5.3 | 5.7 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 6.9 | 8.2 | 8.1 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 3.7 | 4.0 | 204.4 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=54e7ef57-ef1c-4639-8ae3-abd23bf0ad59&page_size=200` | 5.2 | 5.6 | 9.1 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 4.9 | 5.0 | 26.4 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-20` | 3.2 | 3.5 | 350.1 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 17.6 | 18.1 | 120.8 | ≤ 100 | yes |
| after_save | Home Command Center (month) — first after a save | `/api/home/bundle?period=month` | 68.1 | 74.4 |  | ≤ 200 | yes |
| after_save | Bills raised page — first after a save | `/api/demands/register?page_size=50` | 65.0 | 68.1 |  | ≤ 200 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 62.0 | 66.6 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 131.3 | 212.4 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 352.6 | 445.3 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.de0d683e.js
