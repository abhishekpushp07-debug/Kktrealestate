# Perf budget — 2026-11-19 20:06 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 7.3 | 8.0 | 180.2 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 7.5 | 8.1 | 180.0 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=40d134fe-edbd-4103-a07e-a7c7b1e24060` | 5.2 | 5.7 | 92.6 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 4.3 | 4.9 | 168.6 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 38.0 | 39.7 | 38.2 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 16.7 | 18.5 | 21.5 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 6.4 | 7.5 | 7.1 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 8.9 | 9.6 | 10.7 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 5.0 | 5.3 | 220.1 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=54e7ef57-ef1c-4639-8ae3-abd23bf0ad59&page_size=200` | 6.3 | 6.8 | 11.2 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.9 | 6.4 | 29.6 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-19` | 4.0 | 4.3 | 404.3 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 19.2 | 19.5 | 225.1 | ≤ 100 | yes |
| after_save | Home Command Center (month) — first after a save | `/api/home/bundle?period=month` | 184.6 | 197.7 |  | ≤ 200 | yes |
| after_save | Bills raised page — first after a save | `/api/demands/register?page_size=50` | 144.7 | 216.6 |  | ≤ 200 | NO |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 67.3 | 76.8 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 137.8 | 194.2 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 380.5 | 400.6 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.8cd2334f.js
