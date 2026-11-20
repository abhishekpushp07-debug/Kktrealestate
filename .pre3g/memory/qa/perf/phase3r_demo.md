# Perf budget — 2026-11-17 13:12 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 3.7 | 3.8 | 118.8 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 3.6 | 3.7 | 104.6 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 3.3 | 3.4 | 106.4 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 2.7 | 2.8 | 39.0 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 6.2 | 6.9 | 7.2 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a` | 11.5 | 12.8 | 16.8 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/02fb79b7-aa37-463c-9a96-6dd3f725123c` | 6.7 | 7.2 | 8.0 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/fe53a638-9483-434e-bdf7-2148582b959a` | 5.8 | 6.3 | 12.0 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 25.8 | 26.3 | 68.6 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 4.8 | 5.0 | 8.9 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.7 | 5.8 | 29.5 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-17` | 65.5 | 68.0 | 81.8 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 22.7 | 24.0 | 26.4 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 69.2 | 82.5 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 389.0 | 470.7 |  | ≤ 600 | yes |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 121.1 | 176.2 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.6 KB** (budget ≤ 250 KB) — /static/js/main.fcd66b0b.js
