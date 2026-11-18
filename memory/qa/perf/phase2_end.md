# Perf budget — 2026-11-16 13:04 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 4.4 | 4.9 | 90.6 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 4.1 | 4.6 | 79.2 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 3.6 | 3.9 | 73.7 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 2.9 | 3.1 | 35.1 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 2.7 | 2.9 | 2.6 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a` | 10.4 | 11.0 | 12.8 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0284062b-8084-43a9-a8f9-10de08fe44bb` | 7.6 | 8.6 | 7.7 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/49b0bf9a-b654-4648-af4a-a58ca4f8be19` | 6.1 | 6.7 | 13.3 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 24.6 | 25.0 | 66.1 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 5.4 | 5.7 | 9.0 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 6.3 | 6.5 | 29.0 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-16` | 41.5 | 43.1 | 52.0 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 23.8 | 24.6 | 26.7 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 52.1 | 57.6 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 222.4 | 280.4 |  | ≤ 600 | yes |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 98.9 | 208.5 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.4 KB** (budget ≤ 250 KB) — /static/js/main.7911a6cf.js


## P2-2 additions

| tier | what | endpoint | p50 ms | p95 ms | max ms | budget | ok |
|---|---|---|---|---|---|---|---|
| hot | Global search (palette) | `/api/search?q=…` (8 queries × 5) | 6.0 | 6.8 | 13.2 | ≤ 400 | yes |

**Login → first Home widget (browser, warm, same tab, alternating users, `frontend/scripts/login_timing.py`)**: before (2D build, tester) ≈ 1.35 s; after P2-2 median **438 ms** (runs 568/449/437/409/530/440/433/407/531 ms) — budget ≤ 1.0 s.
