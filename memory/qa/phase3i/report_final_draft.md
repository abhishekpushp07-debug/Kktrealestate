# Phase 3I — Speed everywhere (F-59) · FINAL report (2026-11-20, close-out)

Final code: `913cc23` (close-out commits `d5da81f…913cc23` on top of the 3I code `7b2a2b5`). Supersedes the 14:28 report of
2026-11-19. Every heavy run ran alone, in the background, checkpointed in `closing_final.state` (driver
`run_closeout.sh`, log `closeout.log`; it survived 2 pod restarts by resuming).

## 1 · What the close-out changed

| Change | Why | Where |
|---|---|---|
| **Kept-ready Bills raised** — the last answer per filter set is kept per booking with each booking's *marker* (`ledger_rev`, `money_rev`, `version`, `updated_at`, all in the database). After a save that moved only money figures (receipts, reversals, waivers, refunds…) a server re-reads only the bookings whose marker moved; any other save (bills, bookings, inventory, customers…) or a new day reads everything as before. | Bills raised first-after-save p95 220–248 ms → **68 ms** | `routers/demand_register.py` (`_register_rows`, `_assemble`, `_bridge_parts`), `services/booking_marks.py` |
| **Kept-ready Home ageing** — per-booking ageing bands kept under the booking marker + day; only moved bookings are recomputed. Used by Home, Outstanding, ageing reports alike. | Home month first-after-save 220 ms → **74 ms** | `services/definitions.py::ageing_for_bookings` |
| Home "static" widgets (inventory, construction, pipeline, next milestone) no longer dropped by every local receipt event (key `hstatic:`; the domain stamp already keeps them right on every server). | they were recomputed after every receipt on the writing server | `routers/home_bundle.py` |
| The ledger rebuild moves `ledger_rev` on the booking in the same update that writes the summary (inside the unit of work / ordered writes) — the marker. The nightly in-step check also moves `money_rev` when it repairs a booking, so anything kept for that booking on any server recomputes. | crash-safe / self-repair | `services/ledger.py`, `services/money_snapshot.py` |
| Legacy Home / dashboard: on a new business day, project summaries computed on an earlier day are refreshed before the snapshot is served. | tieout on `kkt_volume` found yesterday's overdue on today's legacy Home (gate finding, fixed) | `services/read_models.py::get_dashboard` |
| **Owner decision A:** Advances report adds an **"Other charges advance"** column; total = Outstanding "advance held". Waiver GST credit is whole rupees (`rupees_whole`), never more than the GST line. Tieout: Advances-total law (3 parts) + "credit notes in whole rupees" law (notes issued before 2026-11-20 are issued documents and keep their paise: 1 on `kkt_medium`, WV-2627-0006). Test `test_account_waiver_on_paid_gst_is_whole_rupees_and_advances_equal_outstanding`. | preview tieout failed since the 03:00 demo refresh: ₹754.50 other-charge advance from an Account waiver on paid GST | `routers/reports.py`, `services/waivers.py`, `tools/tieout.py`, `pages/Reports.jsx` |
| System Health "Report figures" line is written once at start-up on a database the nightly check has not reached yet (preview now shows `Report figures: in step`, 82 checked, 0 differences). | tester visibility | `server.py::_money_snapshots` |
| Engagement drill (JRN-196 / M-12) added to `tools/db_audit_drills.py engagement`. | proof | |
| Server-Timing spans `dreg_read/group/serial`, `hb_*`, `w_<widget>` for the two hot paths. | profiling | |

No owner money rule, allocation, ledger order or wording changed except the owner-approved Advances column (decision A) and the
whole-rupee GST credit (rule 8).

Equivalence of kept-ready vs from-source: `tests/test_phase3i_kept_ready.py` (receipt + reversal, company + project scope, read on
server A and a second server B, compared field-by-field with a never-before-read filter set; Home ageing total == Σ outstanding from
the database on both servers).

## 2 · Elite performance (scratch copy of `kkt_volume`, 1,500 bookings, 2 workers, cores 0,1, no reload)

| Must | Result | Budget | Evidence |
|---|---|---|---|
| Home Command Center month, first after a save | p50 68 · **p95 74 ms** (Redis: 79) | ≤ 200 (plan ≤ 180) | `perf_elite_budget_final.md`, `…_redis.md` |
| Bills raised, first after a save | p50 65 · **p95 68 ms** (Redis: 70) | ≤ 200 | same |
| Every hot read warm (11 paths) | p95 ≤ 33 ms (Project list 32.7) | ≤ 200 | same |
| Post payment / Create booking / Stage complete 33 | p95 **67 / 212 / 445 ms** (Redis 71 / 211 / 432) | ≤ 111 / 259 / 526 | same |
| 50 reports, first open after a write | **50/50 ≤ 300**, slowest p95 236 / 234 / 233 ms (payment-behaviour) | ≤ 300 | `perf_elite_reports_final1.md`, `…2.md`, `…3_redis.md` |
| 50 reports, repeat | 50/50, max p95 15 / 15 / 19 ms | ≤ 300 | same |
| Initial JS | **112.7 KB gzip** | ≤ 250 KB | budget files |

Note (honest): the very first Bills raised call after a process start (nothing kept, cold) is 204–210 ms; that is the cold
"first" column, not a hot read or first-after-save; repeat and after-save are ≤ 70 ms. Load test / soak figures are unchanged
from the 2026-11-19 runs (`perf_load_*`, report §6 of that run): 0 errors, p95 within budget.

## 3 · Correctness gates (final code)

| Gate | Result | Evidence |
|---|---|---|
| Equivalence, 3I-before-close-out (`7b2a2b5`, itself equal to 3H) vs final, v3 reports + Bills raised (17 filter sets) + Home (5) + Home legacy + Outstanding | **438 requests × 3 DBs, 0 differences** (`kkt_medium`, `kkt_volume`, preview copy). One earlier run showed `greeting_date` (a clock timestamp) — now ignored as a clock field. | `equiv_final_*.log` |
| Tieout | preview **PASS (exit 0)**, `kkt_medium` PASS after the issued-notes rule (see §1), `kkt_volume` PASS | `tieout_preview.md`, `tieout_kkt_*.md`, `gate_runs.log` |
| Report tie-outs / As-of replay / exports | exit 0 on preview, medium, volume | `preview_gate_runs.log`, `gate_runs.log` |
| Demo refresh on preview (after decision A) | **done** (tieout inside the refresh passes) | `job_runs` DEMO_REFRESH 2026-11-20 |

## 4 · Two servers — drills (3G race / stale, JRN-188; engagement JRN-196)

| Drill | Standalone | Standalone + Redis | Replica set (`KKT_TXN_STRICT=1`) | Replica set + Redis |
|---|---|---|---|---|
| Races R1–R9, 20 reps | integrity_bad 0 everywhere | 0 | 0 | 0 |
| Stale: 11 surfaces × 3 actions × 10 reps, seconds stale on B | **0 s** all | 0 s | 0 s | 0 s |
| Engagement score on B right after stage complete / undo on A (8 customers, 10 reps → 20 checks) | **20/20 identical**, score moved 80× | 20/20 | 20/20 | 20/20 |

Logs `drills_final.log`; JSON `memory/qa/db_audit/drill_{races,stale,engagement}_final[_rs][_redis].json`.

## 5 · Full suite, both modes

SUITE_PLACEHOLDER

## 6 · Open (honest)

OPEN_PLACEHOLDER
