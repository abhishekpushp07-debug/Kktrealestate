# Perf budget — 2026-11-17 23:34 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 20 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 3.9 | 4.9 | 138.8 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 3.9 | 4.2 | 146.6 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 3.6 | 3.9 | 118.5 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 2.8 | 3.2 | 40.1 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 6.4 | 6.9 | 7.5 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a` | 12.3 | 20.1 | 15.6 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/02b8ab7d-f964-416e-a3e7-a1e5c3bffd5e` | 7.6 | 8.2 | 7.7 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/e52d5a65-97ce-44d6-ae44-ec6d4fa3712c` | 5.8 | 6.4 | 12.5 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 18.5 | 18.8 | 66.6 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 4.8 | 5.2 | 8.5 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.9 | 5.9 | 25.7 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-17` | 3.2 | 3.4 | 53.5 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 5.0 | 5.2 | 26.3 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 42.6 | 44.7 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 268.9 | 296.6 |  | ≤ 600 | yes |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 27.3 | 44.4 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.6 KB** (budget ≤ 250 KB) — /static/js/main.d50ed4e5.js
