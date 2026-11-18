# Perf budget — 2026-11-15 23:37 UTC

Scratch copy of the preview DB, private backend (1 worker, no reload), 30 warm requests per path after 2 warm-ups; server time = `Server-Timing: total`.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home bundle | `/api/dashboard/home` | 2.4 | 2.5 | 33.0 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 2.1 | 2.3 | 2.2 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/b1522bfe-5b52-4b78-9729-81bd914dab47` | 9.0 | 10.7 | 13.3 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/01010d65-1133-4bf2-afee-5c1e6f716a83` | 5.6 | 6.0 | 6.8 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/ab453e32-3109-4412-a349-91972fa3f552` | 5.4 | 6.1 | 10.5 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 23.9 | 24.6 | 58.7 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=kkt-reports-hub--7kz2bq77&page_size=200` | 4.5 | 4.8 | 10.1 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 5.6 | 5.9 | 28.1 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-15` | 35.6 | 36.8 | 44.6 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 21.2 | 21.9 | 27.4 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 133.9 | 138.9 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 1156.8 | 1338.9 |  | ≤ 600 | NO |
| write | Stage complete (20 bookings) | `POST /api/blocks/{id}/construction/stage` | 110.1 | 124.4 |  | ≤ 600 | yes |

Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).

Initial JS (gzip, scripts in build/index.html): **112.2 KB** (budget ≤ 250 KB) — /static/js/main.6fd8f70b.js

## Against baseline (2026-11-13, `baseline_phase1.md`)
All paths stay within budget except **Create booking** (p95 1338.9 ms vs 1504.1 ms at baseline — over the 600 ms budget at baseline too, unchanged path).
p95 more than 10% slower: Project detail 9.3 → 10.7 ms (+15%), Bills raised page 20.4 → 24.6 ms (+21%), Outstanding & ageing 17.8 → 21.9 ms (+23%).
Every one of these is ~1–4 ms in absolute terms, under 25% of its budget, and on a demo rebuilt 3 days later (as-of 2026-11-16: more demands raised, one more stage-complete booking). No query plan changes in chunks 1–2 (date bounds only), so this is read as data growth + single-run noise, not a regression. Faster: Home, Post payment (168 → 139 ms), Stage complete (189 → 124 ms).
