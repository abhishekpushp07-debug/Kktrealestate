# Perf budget — 2026-11-16 18:53 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 3.6 | 3.8 | 82.9 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 3.6 | 3.7 | 72.8 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 3.1 | 3.3 | 69.4 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 2.5 | 2.6 | 33.1 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 2.3 | 2.4 | 2.4 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a` | 8.7 | 9.3 | 11.9 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0284062b-8084-43a9-a8f9-10de08fe44bb` | 6.5 | 6.7 | 7.2 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/49b0bf9a-b654-4648-af4a-a58ca4f8be19` | 5.4 | 5.9 | 10.7 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 23.5 | 24.1 | 62.2 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 4.6 | 4.8 | 8.7 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.7 | 6.0 | 9.9 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-16` | 35.9 | 37.4 | 45.4 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 22.2 | 24.1 | 25.5 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 48.0 | 59.0 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 222.6 | 298.8 |  | ≤ 600 | yes |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 103.2 | 156.1 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.6 KB** (budget ≤ 250 KB) — /static/js/main.a9e454ca.js

## Phase 3 end vs Phase 2 end (p50 / p95 ms, > 10 % slower flagged)

| Path | P2 p50 | P3 p50 | P2 p95 | P3 p95 | Δ p95 | Flag |
|---|---|---|---|---|---|---|
| Home Command Center (month) | 4.4 | 3.6 | 4.9 | 3.8 | -22 % | — |
| Home Command Center (FY) | 4.1 | 3.6 | 4.6 | 3.7 | -20 % | — |
| Home Command Center (Today, project) | 3.6 | 3.1 | 3.9 | 3.3 | -15 % | — |
| Home legacy snapshot | 2.9 | 2.5 | 3.1 | 2.6 | -16 % | — |
| Project list | 2.7 | 2.3 | 2.9 | 2.4 | -17 % | — |
| Project detail | 10.4 | 8.7 | 11.0 | 9.3 | -15 % | — |
| Booking detail | 7.6 | 6.5 | 8.6 | 6.7 | -22 % | — |
| Customer 360 | 6.1 | 5.4 | 6.7 | 5.9 | -12 % | — |
| Bills raised page | 24.6 | 23.5 | 25.0 | 24.1 | -4 % | — |
| Unit grid | 5.4 | 4.6 | 5.7 | 4.8 | -16 % | — |
| Catalogues bundle | 6.3 | 5.7 | 6.5 | 6.0 | -8 % | — |
| FY collections | 41.5 | 35.9 | 43.1 | 37.4 | -13 % | — |
| Outstanding & ageing | 23.8 | 22.2 | 24.6 | 24.1 | -2 % | — |
| Post payment (auto allocation + ledger) | 52.1 | 48.0 | 57.6 | 59.0 | +2 % | — |
| Create booking | 222.4 | 222.6 | 280.4 | 298.8 | +7 % | — |
| Stage complete (20 bookings) | 98.9 | 103.2 | 208.5 | 156.1 | -25 % | — |

No path is more than 10 % slower at p95 (Create booking p95 +7 %, within run-to-run noise; budget ≤ 600 ms).
Initial JS: 112.4 KB (P2) → 112.6 KB (P3) gzip.

## Q-32 work screens (browser, click → content, warm; `frontend/scripts/phase3_screens.py`, preview, 1440 px)

| Screen | runs ms | median ms | Budget | Within |
|---|---|---|---|---|
| Booking page | 787 / 183 / 184 | 184 | ≤ 800 | yes |
| Customer 360 | 784 / 182 / 184 | 184 | ≤ 800 | yes |
| Project page | 784 / 113 / 107 | 113 | ≤ 800 | yes |
| Project page (owner's Ye) | 186 / 24 / 22 | 24 | ≤ 800 | yes |

Create booking (POST /api/bookings) p95 298.8 ms ≤ 600; Home bundle (month) p95 3.8 ms ≤ 200. Horizontal overflow 0 px on all 16 screen × theme × width combos.
