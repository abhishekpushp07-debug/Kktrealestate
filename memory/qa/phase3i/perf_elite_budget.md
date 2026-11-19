# Perf budget — 2026-11-18 23:53 UTC

Scratch copy of the preview DB, private backend (2 worker(s), CPUs 0,1, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 11.9 | 15.3 | 451.6 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 12.0 | 15.6 | 376.4 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=40d134fe-edbd-4103-a07e-a7c7b1e24060` | 7.7 | 10.4 | 180.3 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 6.2 | 10.1 | 225.8 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 42.5 | 52.5 | 50.1 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 21.6 | 27.6 | 34.0 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 8.3 | 13.4 | 7.9 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 10.6 | 14.9 | 12.6 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 136.7 | 137.6 | 487.9 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=54e7ef57-ef1c-4639-8ae3-abd23bf0ad59&page_size=200` | 8.3 | 8.9 | 12.3 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 9.3 | 9.9 | 36.7 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-18` | 4.5 | 4.9 | 511.4 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 65.1 | 66.0 | 307.4 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 130.2 | 166.7 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 343.3 | 460.4 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 562.1 | 600.3 |  | ≤ 600 | NO |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.7 KB** (budget ≤ 250 KB) — /static/js/main.f0f4c584.js
