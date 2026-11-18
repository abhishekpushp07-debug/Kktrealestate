# Perf budget — 2026-11-17 18:40 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 4.5 | 5.1 | 139.2 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 4.1 | 4.5 | 125.4 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 4.1 | 5.0 | 126.3 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 3.0 | 3.3 | 45.7 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 7.3 | 8.2 | 8.2 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a` | 15.3 | 17.6 | 18.5 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/01549b4a-76a5-4193-bf74-a308ce37c351` | 8.5 | 9.0 | 8.8 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/187610b8-a3a7-4ff4-814e-de062262e3b3` | 7.2 | 8.5 | 14.3 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 19.1 | 19.4 | 70.8 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 5.5 | 6.0 | 10.0 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 6.7 | 7.1 | 31.2 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-17` | 4.1 | 4.7 | 61.3 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 5.9 | 6.5 | 31.3 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 59.7 | 67.4 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 308.0 | 414.9 |  | ≤ 600 | yes |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 35.1 | 72.7 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.6 KB** (budget ≤ 250 KB) — /static/js/main.22f916bd.js
