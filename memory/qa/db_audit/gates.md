# Phase 3G — gates (close-out run 2026-11-18, 14:00–15:45 UTC)

Environment first: mongod `nofile` raised to 65536 with `prlimit` (ENV-01; soft limit was 1024 after the pod restart);
backend healthy (`/api/health` ok); `GET /api/openapi.json` reachable through the preview URL (200, OpenAPI 3.1).
Local Redis for the Redis-mode drill: redis-server 7.2.5 built from source into `/root/redis` (no apt package), port 6390,
drill only, stopped afterwards. Throw-away copy for every drill: `kkt_audit_scratch` (from `kkt_volume`), dropped at the end.
Artefacts are under `memory/qa/db_audit/` unless a path says otherwise; the pre-fix JSONs (`<db>.json`, `drill_*_before/after.json`)
are kept unchanged; the close-out re-runs are in `gate/` and `drill_*_final*.json`.

| # | Gate (journey) | Command | Result | Artefact |
|---|---|---|---|---|
| 1 | 3G fix tests alone | `pytest tests/test_phase3g_integrity.py -n 0` | **PASS** 16/16 (17 with the new monthly-bucket repair test, also passing) | `pytest_3g_after.log` |
| 2 | Full pytest, sequential (JRN-134) | `python -m pytest -q -p no:cacheprovider -n 0` | **PASS** 945 passed / 5 skipped / **0 failed** (was 938/6/5). No skip / xfail added; one skip fewer | `../pytest_full_3g_final.log` |
| 3 | Audit read-only, 0 Critical / 0 High (JRN-117/132) | `python -m tools.db_audit --db <db> --out memory/qa/db_audit/gate` (preview with the backend **stopped**) | **PASS** "read-only: verified" on all three; Critical 0 · High 0; Medium 6 / 6 / 5; 11.2 s / 14.3 s / 7.5 s | `gate/{test_database,kkt_medium,kkt_volume}.json`, `gate/audit_*.log` |
| 4 | Tieout 100 %, figures identical to pre-3G (JRN-120/134) | `python tools/tieout.py` (preview :8001; medium/volume via a private backend :8002, `gate/run_tieouts.sh`); compare `python tools/tieout_compare.py BEFORE AFTER` | **PASS** preview 503/0 FAIL, medium 608/0, volume 951/0. Preview vs pre-3G (`journey/tieout_raw.md`, 2026-11-18 03:20): 282 common rows, **0 figures differ**. Volume vs pre-3G (`perf/tieout_volume.md`, 2026-11-17): every money total identical (collections FY ₹4,26,47,26,350 = same; outstanding ₹1,17,62,51,324 = same); the 45 rows that moved are all day-dependent (ageing bands, "today", next-30-days inflow — the pre-file is from the previous day); 5 rows only renamed in 3F, same values. Medium: no pre-3G tieout artefact existed (cannot compare to a before); its first run had **1 FAIL** (trends current month) → repaired, see row 13 | `gate/tieout_*.md/.log`, `gate/tieout_compare_*.txt`, `gate/tieout_*_pre3g.md` |
| 5 | Connection matrix 100 % green | inside the full suite (`tests/test_connection_matrix.py`) | **PASS** 28 actions × 26 surfaces = 728 cells, 728 green / 0 red | `gate/connection_matrix.md` |
| 6 | Chronology | `python tools/story_logic_check.py --db test_database` | **PASS** 0 problems | `gate/story_logic_check.log` |
| 7 | Integrity | `GET /api/admin/integrity-report?fresh=true` (preview) | **PASS** ok, 79 bookings checked, 0 findings | `gate/integrity_test_database.json` |
| 8 | Race drills, 20 reps, 2 processes (JRN-124…130) | `tools.db_audit_drills setup` then `races --label final --reps 20` | **PASS** R1 one receipt 20/20 · R2 integrity 0/20, every 409 = `BUCKET_EXCEEDS_AGREED` (owner cap), never "busy" · R3 one live booking 20/20 · R4 one approval, loser "Already approved" 20/20; approve vs reject consistent 20/20 · R5 distinct CN 20/20, 0 duplicates · R6 0 duplicate bills / GST parts (6 towers), second caller 409 · R7 receipt during cancel accounted 10/10 · R8 0/20 duplicate sequences · R9/R10 DB refuses duplicates | `drill_races_final.json`, `gate/races_final.log` |
| 9 | Stale window 0 s, no Redis (JRN-137) | `stale --label final --reps 10` | **PASS for every money figure**: 11 surfaces × 3 actions × 10 reps, 0.0 s. **One non-money exception**: Customer 360 `engagement_score` (CRM score, not money) differed between A and B in 3 of 10 stage-complete reps (A showed the previous score) → new finding M-12 | `drill_stale_final.json` |
| 10 | Stale window 0 s, `REDIS_URL` (JRN-137) | `stale --label final --reps 10 --redis redis://127.0.0.1:6390/0` | **PASS for every money figure** 0.0 s; same `engagement_score` exception in 4 of 10 stage-complete reps (M-12) | `drill_stale_final_redis.json` |
| 11 | Duplicates at startup (JRN-133 / Q-40) | `dupstart` (new): drop `uniq_ledger_seq` on the copy, insert a repeated (booking, seq), start the backend | **PASS** health ok; bookings list + Home 200; System Health (`/api/admin/ops` → `uniqueness`) shows `uniq_ledger_seq` "Uniqueness rule not applied — duplicates found" with the example key; the log names the rule; the other 4 rules applied | `drill_dupstart_after.json` |
| 12 | 2 processes start together × 10 (JRN-138 / Q-42) | `startup --label final --reps 10` | **PASS** both serve 10/10; one scheduler lease owner 10/10; index sets unchanged 10/10; jobs run twice 0. The counter "start errors=2" is the passlib/bcrypt 4.x version warning traceback, printed once per process at import (`(trapped) error reading bcrypt version`), not a startup error | `drill_startup_final.json` |
| 13 | Data repair (REQ-306): `kkt_medium` trends | dry run = tieout FAIL "trends current month split" (bucket written 09:32:01, last receipt 09:32:06 — the seed backend killed before its flush, G-07); repair = `POST /api/admin/recompute-read-models` ×2 (`gate/run_medium_repair.sh`) | **PASS** bucket 2026-11 = Σ allocation parts after run 1; run 2 identical (idempotent); payments 1,749 / demands 669 / ledger rows 3,254 / Σ outstanding ₹8,18,68,755 identical before and after (money-neutral); tieout 608/0 | `gate/medium_repair.log`, `gate/tieout_kkt_medium_dryrun.log` |
| 14 | PRE-01 dry run (owner decision A) | `python -m tools.pre01_dryrun --db test_database kkt_medium kkt_volume` | **PASS** 0 manual bills, 0 bookings whose Outstanding changes on all three | `gate/pre01_dryrun.txt` |
| 15 | Nothing deleted (JRN-135) | counts vs the first 3G audit JSONs; list of expiry indexes | **PASS** no history count lower on any DB (preview audit_logs 421,531 → 421,531, login_events 11,267 → 11,270, notifications 16,599 → 16,599, job_runs 5,537 → 5,932); no expiry index on audit_logs / archive / login_events / notifications / job_runs / messages. **Correction to the journey text:** there are 12 pre-existing expiry indexes on preview (refresh keys ×2, portal refresh keys ×2, double-click guards `idempotency_claims` + `idempotency_keys`, `cache`, `report_cache`, `rate_limits`, `uploads`, `backups`, `brochure_tokens`) — all short-lived tokens / caches defined before 3G (`db.py`, `routers/visits.py`), none on history; 3G added none | `gate/nothing_deleted.txt` |
| 16 | Writes p95 ≤ 600 ms and ≤ +10 % vs pre-3G (Q-38) | `tools/perf_budget.py --source kkt_volume --runs 20` (same config as `perf/phase3e_volume.md`) | **≤ 600 ms: PASS** (100.6 / 293.0 / 565.3). **≤ +10 %: NOT MET** — Post payment +74 %, Create booking +27 %, Stage complete +21 %; stated cause (lease + persisted marks + shared data stamp, the price of G-02…G-08) — attributed by code reading, not span-proven; listed as M-13 for 3I | `../perf/phase3g_volume.md`, `../perf/baseline_3g_elite.md` §1 |
| 17 | ESLint 0 / `CI=true yarn build` ok | `yarn lint`; `CI=true yarn build` | **PASS** lint exit 0; build ok (initial JS 112.7 KB gzip) | `../fe_lint_3g_final.log`, `../fe_build_3g_final.log` |
| 18 | Elite speed baseline (JRN-140 / REQ-317) | `tools/perf_budget.py … --workers 2 --cpus 0,1`, `tools/perf_reports_v3.py … --workers 2 --cpus 0,1 --cold 10 --warm 30` | **DONE** (measured, nothing fixed): hot reads all ≤ 200 ms; writes ≤ 600 ms; reports repeat p95 50/50 ≤ 300 ms, first-open p95 17/50 ≤ 300 ms. 5 slowest: receivables-forecast 1,785 · collections 1,517 · bank-receipts 837 · booking-health 764 · transfers 758 ms | `../perf/baseline_3g_elite.md` (+ `_budget.md`, `_reports.md`) |

## The 5 full-suite failures (before → root cause → fix)

1. `test_connection_matrix_all_green` (create booking × documents / journey) — **test-harness timing, not a product regression.**
   "create booking" is the first matrix action; its setup builds the matrix tower (30 flat-price PATCHes = 30 after-commit
   surface snapshots, ~0.3 s each, run one at a time). The baseline `_settled()` compared surfaces only, so the act's own
   auto letters (allotment, cost sheet, schedule, demand letter) queued behind ~9 s of setup snapshots and landed 8.9 s after
   the booking — outside the act's 5 s freshness window. Fix: `_settled()` drains the after-commit queue
   (`POST /api/admin/ops/after-commit/drain`) before taking the baseline, as its docstring already promised.
2. `test_phase_11a::test_document_project_scope_404` — **test-order dependency.** It took the 2nd project with a website slug
   and assumed it had a booking; projects added by earlier tests move the list order (newest first), so the 2nd project was
   "Ye" with 0 bookings → `StopIteration`. Fix: pick the project that has a booking, scope the user to a different one.
3. `test_phase_11f::test_cancel_booking_flow` — **fixture predating the 3E discount rule.** It books at ₹25 L on an SGH flat
   listed higher; REQ-236 (3E) needs a discount reason below list price. Fix: the fixture states `discount_reason`.
4. `test_phase_i_reports::test_outstanding_three_balances_law` — **pre-existing engine gap (PRE-01), owner decision A.**
   A manual bill added Udhar but not Outstanding. Fixed in `services/ledger.py` (see report PRE-01); new test
   `test_manual_bill_counts_in_outstanding_and_ageing`; tieout row added; integrity counts manual bills in "raised".
5. `test_phase_ps_pricing::test_legacy_patch_accepts_pricing_fields` — **test-order dependency (flat pool exhausted).** It took
   the first 50 Available flats company-wide; in a full session every rate-priced one was already claimed by earlier tests
   → `StopIteration`. Fix: the test builds its own tower (`flat_claims.own_flats`).

Found and fixed during the close-out (not in the list of 5):
- `test_fuzz_walker::test_write_routes_never_500` timed out once on `POST /api/customers/portal/bulk-enable` (20.8 s): bcrypt
  hashing (~0.22 s per customer) ran **on the event loop**, freezing every other request on that process for the whole
  run (at 1,500 bookings ≈ 5 min). Fix: hashes run in worker threads (8 at a time; bcrypt releases the GIL) → 4.1 s in the
  same suite, the server keeps serving meanwhile. No behaviour change.
- Format gate: two new tool files (fixed).
- `services/read_models.recompute_all()` did not rebuild monthly buckets (trends), so the documented read-model repair left
  `kkt_medium` trends stale after the pre-3G lost flush (G-07). Fix + test
  `test_phase3g_integrity::test_recompute_read_models_repairs_stale_monthly_buckets` (fails on the old code — verified by
  swapping the file — passes now).

## Could not verify / limits
- JRN-125 "both receipts saved": the drill posts ₹7 L + ₹9 L cash, which is above the remaining Cash share on most volume
  bookings, so in 19 of 20 pairs at least one is refused by the owner's cap (`BUCKET_EXCEEDS_AGREED`); 0 integrity problems,
  0 "booking busy". "Both saved" is proven by `test_receipt_waits_for_the_other_process_writing_the_booking`, not by the drill.
- R6 (stage twice) ran on the 6 towers that still had a pending stage, not 20 reps.
- M-12: `engagement_score` cross-process difference (non-money) — root cause not found in this phase.
- Write slow-down cause is attributed by code reading, not by Server-Timing spans (M-13).
- Medium has no pre-3G tieout artefact, so "identical to pre-3G" is proven for preview and volume only.
- Crash-drill coverage limits stay as in report §9 (not re-run in the close-out).

## Standing gate (from 3I, REQ-379) — both database modes before any phase closes
- Full suite on **standalone** Mongo (preview mode: ordered writes + compensation): 0 failed.
- Full suite on a **single-node replica set** (live mode: multi-document transactions) with `KKT_TXN_STRICT=1`: 0 failed.
  Runner: `memory/qa/phase3i/run_replset.sh` (data dir in /tmp; check `df` first; scratch copies dropped after).
- 3G race drills (20 reps) and the 2-process stale drill in **both** modes: 0 duplicates, 0 s stale, 0 × 500, 0 timeouts.
- Rules the gate protects: every multi-write flow runs through `uow.transactional` (retry on transient conflict,
  commit retried on unknown result, follow-up work fires only after commit); the open transaction's session is
  attached to every collection call by `services/txn_ctx` (strict mode rejects an explicit opt-out); business
  numbers come from atomic counters; a duplicate business key is a 409, never a 500.
