# Perf budget — 2026-11-19 19:09 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 6.8 | 7.2 | 168.5 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 7.0 | 7.4 | 172.8 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=40d134fe-edbd-4103-a07e-a7c7b1e24060` | 5.3 | 5.8 | 87.3 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 4.6 | 4.9 | 163.5 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 37.1 | 37.9 | 37.9 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 16.6 | 18.3 | 21.2 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 6.4 | 7.3 | 7.3 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 8.2 | 8.5 | 9.3 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 4.4 | 5.1 | 222.8 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=54e7ef57-ef1c-4639-8ae3-abd23bf0ad59&page_size=200` | 6.1 | 6.8 | 10.5 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.6 | 5.7 | 28.5 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-19` | 3.9 | 4.6 | 401.3 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 19.2 | 19.6 | 222.0 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 76.0 | 132.6 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 207.5 | 287.3 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 482.5 | 568.4 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.8cd2334f.js
