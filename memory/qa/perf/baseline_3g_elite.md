# Phase 3G — speed baseline at the owner's live size (Elite) — JRN-140 / REQ-317

**This is the "before" for Phase 3I. Nothing was changed for speed in 3G.** Measured 2026-11-18 15:28–15:34 UTC.

- Data: scratch copy of `kkt_volume` (1,500 bookings, 19.5k receipts) — `kkt_perf_scratch`, dropped after the run.
- Backend: **2 uvicorn processes** (`--workers 2`), pinned with `taskset -c 0,1` (= Elite's 2 guaranteed vCPU), no reload, no Redis (live has none), demo refresh off.
- Server time = `Server-Timing: total` (what the server spends; network not included).
- Tools: `tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1` (hot reads + writes) and
  `tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30` (all 50 reports).
  Raw outputs: `baseline_3g_elite_budget.md`, `baseline_3g_elite_reports.md`, log `baseline_3g_runs.log`; runner `run_baseline_3g.sh`.
- **First open** (reports) = first page right after a data write (every cache stale; 10 samples per report, each after a fresh write).
  **Repeat open** = 30 repeats with nothing written. With 2 processes and no shared cache, a repeat can land on the other
  process and be a cold compute — this is the honest live shape.
- Owner goal from 3I (2026-11-18): **every report ≤ 300 ms p95 on every open, first and repeat.**

## 1. Hot reads (budget ≤ 200 ms) and the 3 write budgets (≤ 600 ms)

`first` = one cold call right after start; p50/p95 = 30 warm repeats.

| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |
|---|---|---|---|---|---|---|---|
| hot | Home Command Center (month) | `/api/home/bundle?period=month` | 11.5 | 13.9 | 707.2 | ≤ 200 | yes |
| hot | Home Command Center (FY) | `/api/home/bundle?period=fy` | 11.4 | 13.5 | 595.1 | ≤ 200 | yes |
| hot | Home Command Center (Today, project) | `/api/home/bundle?period=today&project_id=40d134fe-edbd-4103-a07e-a7c7b1e24060` | 7.5 | 9.4 | 188.7 | ≤ 200 | yes |
| hot | Home legacy snapshot | `/api/dashboard/home` | 6.0 | 7.4 | 225.8 | ≤ 200 | yes |
| hot | Project list | `/api/projects?page_size=50` | 38.7 | 41.3 | 38.3 | ≤ 200 | yes |
| hot | Project detail | `/api/projects/40d134fe-edbd-4103-a07e-a7c7b1e24060` | 19.8 | 21.1 | 24.5 | ≤ 200 | yes |
| hot | Booking detail | `/api/bookings/0005e168-15b5-46f1-9e33-c750f1c43a17` | 6.3 | 9.1 | 9.0 | ≤ 200 | yes |
| hot | Customer 360 | `/api/customers/156b29a3-ad82-4b3c-93c6-52e39fc044b7` | 8.5 | 10.4 | 14.6 | ≤ 200 | yes |
| hot | Bills raised page | `/api/demands/register?page_size=50` | 133.8 | 136.1 | 499.5 | ≤ 200 | yes |
| hot | Unit grid | `/api/flats?block_id=54e7ef57-ef1c-4639-8ae3-abd23bf0ad59&page_size=200` | 5.9 | 6.5 | 10.2 | ≤ 200 | yes |
| hot | Catalogues bundle | `/api/catalogues` | 7.3 | 7.7 | 27.8 | ≤ 200 | yes |
| report | FY collections | `/api/reports/collections-v2?from_date=2026-04-01&to_date=2026-11-18` | 3.1 | 3.3 | 438.4 | ≤ 100 | yes |
| report | Outstanding & ageing | `/api/reports/outstanding-v2` | 65.1 | 65.6 | 269.9 | ≤ 100 | yes |
| write | Post payment (auto allocation + ledger) | `POST /api/payments` | 80.3 | 111.0 |  | ≤ 600 | yes |
| write | Create booking | `POST /api/bookings` | 196.4 | 259.3 |  | ≤ 600 | yes |
| write | Stage complete (33 bookings) | `POST /api/blocks/{id}/construction/stage` | 458.1 | 526.5 |  | ≤ 600 | yes |

Writes, same 1-process config as the last pre-3G run (`phase3e_volume.md`, 2026-11-17, 20 runs) → `phase3g_volume.md` (20 runs):

| Write | pre-3G p95 | 3G p95 (1 process) | change | 3G p95 Elite (2 proc, 2 cores) | ≤ 600 |
|---|---|---|---|---|---|
| Post payment | 57.9 | 100.6 | +74 % | 111.0 | yes |
| Create booking | 230.0 | 293.0 | +27 % | 259.3 | yes |
| Stage complete (33 bookings) | 468.1 | 565.3 | +21 % | 526.5 | yes |

**Stated cause of the write slow-down (Q-38) — attributed by code reading, not yet proven span by span:** every money write now takes the cross-replica booking lease (G-02/03/04/05:
one guarded upsert + one delete on `locks`, taken around `POST /payments` and again re-entrantly in the ledger rebuild),
persists its read-model mark (G-07: one upsert on `read_model_marks`) and every cached read re-reads the shared data stamp
(G-08: two indexed `find_one`). These are the price of the High fixes (no duplicate ledger lines, no over-cap receipt, no
lost receipt in a cancellation across 2 replicas). All three writes stay inside the 600 ms budget, but Post payment (+74 %), Create booking (+27 %) and Stage complete (+21 %) are more than 10 % slower than pre-3G — the gate's "> 10 % slower" part is **not met**; it is reported with this cause. A span-by-span Server-Timing breakdown and making them cheaper
(e.g. one lease per request, stamp read once per request) is listed for Phase 3I.

## 2. All 50 reports — first and repeat open, 2 processes, 2 cores

| # | Segment | Report | Rows | first p50 | first p95 | repeat p50 | repeat p95 | ≤ 300 ms both |
|---|---|---|---|---|---|---|---|---|
| 1 | Finance | receivables-forecast | 5,904 | 1142 | 1785 | 24 | 33 | NO |
| 2 | Finance | collections | 9,482 | 1085 | 1517 | 24 | 34 | NO |
| 3 | Finance | bank-receipts | 5 | 552 | 837 | 4 | 11 | NO |
| 4 | Bookings | booking-health | 1,499 | 254 | 764 | 23 | 35 | NO |
| 5 | Bookings | transfers | 0 | 291 | 758 | 3 | 10 | NO |
| 6 | Project & inventory | stage-bills | 36 | 202 | 755 | 4 | 14 | NO |
| 7 | Project & inventory | stacking-plan | 2,170 | 204 | 740 | 29 | 41 | NO |
| 8 | Bookings | realised-rate | 1,499 | 254 | 730 | 23 | 34 | NO |
| 9 | Project & inventory | inventory-status | 2,170 | 178 | 730 | 26 | 39 | NO |
| 10 | Project & inventory | construction-vs-plan | 46 | 196 | 726 | 4 | 16 | NO |
| 11 | Bookings | sales-team | 2 | 258 | 725 | 4 | 8 | NO |
| 12 | Project & inventory | sales-velocity | 36 | 164 | 719 | 4 | 18 | NO |
| 13 | Finance | cheques | 3,585 | 441 | 714 | 24 | 34 | NO |
| 14 | Leads | source-performance | 5 | 140 | 713 | 3 | 6 | NO |
| 15 | Leads | team-pipeline | 2 | 136 | 708 | 4 | 13 | NO |
| 16 | Project & inventory | hold-register | 4 | 157 | 673 | 4 | 13 | NO |
| 17 | Bookings | plan-position | 1,499 | 249 | 672 | 23 | 34 | NO |
| 18 | Bookings | agreements | 1,499 | 256 | 668 | 23 | 34 | NO |
| 19 | Leads | visit-register | 6 | 81 | 634 | 4 | 8 | NO |
| 20 | Customers | service-sla | 9 | 56 | 619 | 4 | 6 | NO |
| 21 | Bookings | sales-summary | 160 | 222 | 617 | 4 | 7 | NO |
| 22 | Bookings | booking-register | 1,500 | 246 | 616 | 23 | 34 | NO |
| 23 | Finance | outstanding | 1,499 | 308 | 605 | 24 | 36 | NO |
| 24 | Finance | other-charges | 1,497 | 208 | 530 | 24 | 35 | NO |
| 25 | Customers | payment-behaviour | 1,490 | 406 | 513 | 10 | 24 | NO |
| 26 | Finance | bills-vs-collection | 115 | 248 | 507 | 5 | 17 | NO |
| 27 | Bookings | discount-register | 25 | 66 | 461 | 4 | 16 | NO |
| 28 | Customers | customer-status | 1,499 | 320 | 405 | 24 | 37 | NO |
| 29 | Customers | customer-directory | 1,975 | 242 | 371 | 13 | 26 | NO |
| 30 | Customers | kyc-pending | 1,499 | 262 | 344 | 23 | 36 | NO |
| 31 | Customers | call-list | 1,497 | 250 | 329 | 24 | 36 | NO |
| 32 | Customers | advance-holders | 888 | 224 | 316 | 18 | 32 | NO |
| 33 | Customers | customer-ageing | 1,497 | 222 | 302 | 24 | 37 | NO |
| 34 | Finance | cash-vs-account | 1,499 | 245 | 281 | 23 | 35 | yes |
| 35 | Leads | lead-funnel | 7 | 147 | 176 | 4 | 12 | yes |
| 36 | Project & inventory | landowner | 0 | 144 | 172 | 4 | 13 | yes |
| 37 | Project & inventory | price-list | 669 | 160 | 165 | 12 | 24 | yes |
| 38 | Customers | cancelled-customers | 1 | 26 | 148 | 4 | 17 | yes |
| 39 | Finance | day-book | 231 | 101 | 140 | 4 | 8 | yes |
| 40 | Project & inventory | project-statement | 174 | 74 | 104 | 7 | 19 | yes |
| 41 | Leads | lead-register | 1,498 | 87 | 92 | 4 | 5 | yes |
| 42 | Leads | lead-ageing | 7 | 67 | 89 | 4 | 16 | yes |
| 43 | Leads | visit-conversion | 2 | 51 | 86 | 4 | 10 | yes |
| 44 | Leads | lost-leads | 1 | 70 | 86 | 4 | 7 | yes |
| 45 | Leads | response-time | 1,498 | 72 | 81 | 4 | 16 | yes |
| 46 | Leads | follow-ups | 7 | 65 | 79 | 4 | 11 | yes |
| 47 | Finance | waivers | 0 | 47 | 77 | 4 | 11 | yes |
| 48 | Bookings | cancellations | 0 | 49 | 77 | 3 | 11 | yes |
| 49 | Customers | customer-statement | 18 | 25 | 39 | 10 | 22 | yes |
| 50 | Project & inventory | parking | 132 | 22 | 39 | 4 | 17 | yes |

**Against the owner's 3I goal (≤ 300 ms p95, first and repeat):** repeat opens: 50/50 within (max repeat p95 41 ms).
First opens: **17/50 within, 33 over**.

### The 5 slowest reports (first open p95)
1. **receivables-forecast** (Finance) — 1,785 ms
2. **collections** (Finance) — 1,517 ms
3. **bank-receipts** (Finance) — 837 ms
4. **booking-health** (Bookings) — 764 ms
5. **transfers** (Bookings) — 758 ms

(Next: stage-bills 755, stacking-plan 740, realised-rate 730.) These are Phase 3I's first targets.
