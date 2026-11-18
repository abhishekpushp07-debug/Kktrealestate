# Perf budget — 2026-11-13 22:24 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home bundle | `/api/dashboard/home` | 2.9 | 3.0 | 31.8 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 2.1 | 2.3 | 2.3 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/c170483e-f746-40df-9f1f-e6d798328039` | 9.1 | 9.3 | 14.1 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/02d58183-0695-4b00-827f-9b6acdac2821` | 6.1 | 6.5 | 9.1 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/924ae5b8-9b04-421d-a75d-20ef63efe8e3` | 5.2 | 5.6 | 10.7 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 20.2 | 20.4 | 49.4 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-estate--0f7bubxm&page_size=200` | 4.5 | 4.8 | 11.0 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 6.2 | 6.4 | 28.8 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-13` | 32.6 | 34.4 | 43.0 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 17.1 | 17.8 | 21.3 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 159.1 | 168.2 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 1193.0 | 1504.1 |  | ≤ 600 | NO |
| write | Stage complete (19 bookings) | `POST /api/blocks/{id}/construction/stage` | 146.9 | 188.6 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.1 KB** (budget ≤ 250 KB) — /static/js/main.45051861.js

Over budget at baseline: **Create booking** (p95 ~1.5 s vs ≤ 600 ms). This is recorded as found. Phase 1 does not change the booking-create path.
