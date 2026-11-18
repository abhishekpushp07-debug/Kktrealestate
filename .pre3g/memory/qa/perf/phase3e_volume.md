# Perf budget — 2026-11-17 23:48 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 20 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 7.8 | 8.0 | 568.1 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 8.0 | 8.2 | 427.4 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 4.4 | 4.4 | 145.4 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 3.1 | 3.1 | 196.5 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 30.5 | 30.8 | 31.5 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 14.5 | 14.8 | 18.8 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 5.9 | 6.2 | 6.4 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 7.1 | 7.5 | 13.8 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 132.0 | 132.3 | 453.8 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 4.7 | 4.9 | 8.9 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 6.0 | 6.3 | 25.7 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-17` | 3.3 | 3.5 | 420.1 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 63.5 | 63.8 | 256.2 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 46.4 | 57.9 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 152.2 | 230.0 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 395.6 | 468.1 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.6 KB** (budget ≤ 250 KB) — /static/js/main.d50ed4e5.js
