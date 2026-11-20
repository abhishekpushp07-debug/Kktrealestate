# Perf budget — 2026-11-17 04:18 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 3.6 | 3.8 | 109.9 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 3.6 | 3.7 | 97.8 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=kkt-reports-hub--7kz2bq77` | 3.2 | 3.3 | 92.2 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 2.5 | 2.9 | 32.2 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 6.0 | 6.7 | 6.9 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a` | 10.8 | 11.3 | 14.6 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/082f6579-e63c-4e39-91f1-7deec786c588` | 5.9 | 6.3 | 6.4 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/0ae3d89a-7354-44a0-bef6-3f88834c60ab` | 5.1 | 5.4 | 10.4 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 23.7 | 24.2 | 63.7 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 4.6 | 4.7 | 8.5 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.8 | 5.9 | 26.3 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-17` | 47.2 | 48.3 | 59.8 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 20.8 | 21.9 | 24.1 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 40.6 | 48.9 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 209.2 | 303.8 |  | ≤ 600 | yes |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 75.7 | 187.1 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.6 KB** (budget ≤ 250 KB) — /static/js/main.22ba2143.js

## Design round end vs Phase 3 end (p95 ms) — all within budget
Project list 2.4 → 6.7 (+179 %, photos list in project output; budget 200) · Project detail 9.3 → 11.3 (+22 %) · FY collections 37.4 → 48.3 (+29 %, carried-from-before formula; budget 100) · Stage complete 156 → 187 (+20 %; budget 600) · Home legacy 2.6 → 2.9 (+12 %). Everything else flat or faster.
