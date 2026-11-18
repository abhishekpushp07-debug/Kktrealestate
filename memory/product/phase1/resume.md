# Phase 1 — resume note (orchestrator) — THIRD FORK, 2026-11-15 ~20:40 UTC

Read in this order: this file → `/app/memory/product/ALL_PHASES_TODO.md` → `/app/memory/qa/phase1/closeout_progress.md` → `overview.md` (F-44 + "Owner decisions 2026-11-15") → `phase1/requirement.md` (REQ-46…59) + `phase1/journeys.md` (JRN-24…30) → `/app/memory/HANDOFF.md` (top "Update 2026-11-15" block, then §3, §5, §10) → top section of `/app/memory/PRD.md` → `/app/memory/qa/phase1/closeout_fixes.md`.

## Why this fork
The builder `web_app_dev` stopped after a pod restart (~19:52 UTC; services came back ~20:18 UTC). Status says "stopped, no result", while the name stays "held by a live instance". send_message did not wake it and cancel_subagent did not release it. This is the third time. In a new job the builder starts fresh. Use `web_app_dev`, background true.
- Probable cause: memory. The cgroup limit is 8 GB, mongod holds ~3 GB, and `yarn build` peaked at ~1.5 GB at the same time as other jobs (`memory/qa/phase1/mem_samples_run8b.log`: cg=7.4 GB at 19:51:55).
- Tell the builder: one heavy job at a time (never yarn build + pytest + reseed together); build with `GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=2048`; long jobs detached with `setsid nohup … < /dev/null &` + polling; commit after every step.

## Owner answers this job (2026-11-15) — do not re-ask
- Demo freshness: **auto-refresh the demo every night on preview only** (F-44). Built.
- Theme switch: **Light / Night only** (no Auto). Applies in Phase 2.
- Home default for **Sales** = only their work: Call today, Sales pipeline, Inventory by tower, Flat status. Applies in Phase 2.
- Principle: "logic works best simple, elegant, powerful". Owner says "best effort dena" and wants no custom logic lost.

## Owner answers, 4th job (2026-11-16, ~03:10 IST). Do not re-ask
- Default date for an entry saved after midnight: **the new day on the India clock** (calendar day changes at 00:00 IST; no late-night cutoff). A date the user picks on a form is always kept as picked.
- If the builder freezes a 4th time: **stop and tell the owner right away** (no silent workaround).
- Preview at this job (tool truth): `https://kkt-reports-hub--7kz2bq77.preview.emergentagent.com`, env_slug `kkt-homebase--9vc8be7x`. Git history was collapsed again at fork (HEAD `9ba3e33 post fork init`).

## Phase 1 close-out — state at fork (git HEAD 2f1ea22, 14 commits since `ee3ccf8 post fork init`)
DONE and committed:
- P1-1: docs committed (19005a0).
- P1-2 not-due demo bills (568e469). In `tools/story_seed.py`:
  - SGH Tower C stages are completed 50, 25 and 6 days before the as-of date, through the real stage endpoint.
  - Tower C home-loan buyers are on the plan "CLP home loan (45 days to pay)" (per-instalment `due_days` 45, an existing dues-engine rule).
  - `story_logic_check` fails with "<band> is empty" / "next billing stage is empty".
- P1-2b nightly demo refresh (f2fc469). `routers/demo_refresh.py`:
  - runs at 03:00 IST under the leader lease
  - requires `DEMO_AUTO_REFRESH=true` AND every served host is a demo host (`served_hosts`); otherwise "disabled"
  - "skipped" while a reseed or test snapshot runs (lock files `/tmp/kkt_reseed.lock`, `/tmp/kkt_test_snapshot.lock`)
  - backup first → existing `_reseed(story, as_of=today IST)` → verify (chronology + integrity + tie-outs) → `demo_journeys.py`
  - run now: `POST /api/admin/demo-refresh/run` (perm `admin.demo_refresh.run`, Super Admin); status: `GET /api/admin/demo-refresh`; "Demo data" card on System Health
  - guard tests `tests/test_demo_refresh.py`
- Root fixes:
  - read-model flush inherited the seeder's X-As-Of (592374b)
  - job_runs survive a reseed (74b86eb)
  - 2 test-order races (f9090b7)
  - lump-sum villas get an explicit lump_sum pricing sheet (ae147b8)
  - IST business day in tieout / story_logic_check / conftest (767878c, 2cf96f9)
  - conftest DB copy streamed in 1000-doc batches (OOM, 2f1ea22)
- P1-3: rebuild proofs: tieout 118/118, integrity 0, chronology 0, purge `{}`, determinism IDENTICAL (3 rebuilds); users / roles / projects / towers / plans / flat prices SAME across refreshes; counters never lowered (`closeout_*.txt`, `closeout_determinism.txt`, `closeout_refresh_keeps_setup.txt`, `closeout_skip_proof.json`).

Current demo (`memory/qa/phase1/demo_journeys.md`, as-of **2026-11-16**, generated just after IST midnight):
- 80 bookings (78 Active / 2 Cancelled)
- Collected this month ₹1,54,85,546 (Cash ₹93,47,802 / Account ₹60,97,744 / Other ₹40,000); today ₹5,76,496
- 1 cheque to clear ₹40,000; visits today 1; **follow-ups due 0** (see open item 2)
- FY ₹18,75,11,936
- Outstanding ₹7,69,34,315; overdue ₹6,21,91,215
- Ageing:
  - Not due ₹1,47,43,100 (25 bookings; 25 with a bill due ≤ 30 days, 2 with one due later)
  - 0-30 ₹46,14,414 (10)
  - 31-60 ₹54,62,161 (10)
  - 61-90 ₹88,23,725 (12)
  - 90+ ₹4,32,90,915 (68)
- Next billing stage: Tower B Plastering (16 bookings, ₹1,46,83,726); Tower C Plastering (30 bookings, ₹2,51,23,680)
- JRN-11 booking: BK-2526-1283 (story:ontime), Cash open ₹2,94,528 + Club Membership open ₹1,03,000
- Free flat for JRN-4/18: Tower A · A-803 · ₹50,66,250
- Numbers change on every refresh. Always find records by role tag.

## OPEN (builder) — in this order
1. **IST "today" bug (real product bug, P0).** In `pytest_final2_run1.log` (started 19:17 UTC = 00:47 IST): 718 passed, **3 failed**, all in `tests/effects/test_events.py`:
   - `test_payment_reverse_effects`: the reversal is not in Roznamcha for TODAY
   - `test_cancel_creates_refund_and_payout_posts_contra`: the booking is missing from /reports/cancellations for TODAY
   - `test_forfeiture_when_nothing_refundable`

   Root cause (confirmed by grep): `services/clock.today()` is IST, but **19 server places use `now_iso()[:10]` (= UTC date)**: `routers/bootstrap.py`, `reports_n.py` (4 ×), `demand_register.py` (3 ×), `messaging.py`, `notifications.py`, `project_setup.py`, `customers.py`, `docgen.py`, `services/documents.py` (2 ×), `services/messaging/outbox.py`, `seed_phase5.py`. Also `date.today()` in `routers/messaging.py:285`, `datetime.now(timezone.utc).date()` in `routers/files.py:439` and `reports_n.py:244`, and `TODAY` in `routers/public.py:32`. Reversal / cancel / refund date stamping and the Roznamcha / report day filters must be checked too.

   Between 00:00 and 05:30 IST, entries are dated to the previous day. Fix:
   - one "business today" helper (`clock.today()`, timezone from a company field defaulting to Asia/Kolkata, ready for Phase 4)
   - used everywhere the server derives today / as-of
   - a frozen-clock test at 00:30 IST
   - no booking/payment rule changes; never loosen assertions
   - rename the failed log `pytest_final2_run1_FAILED_ist_window.log`
2. **Follow-ups due = 0** in the 2026-11-16 demo (JRN-5 needs it > 0). Probably the same IST/UTC day issue (story follow-ups dated on the UTC day), or the story doesn't create a follow-up for the as-of day. Fix at the root in the story / clock, then re-check after a rebuild.
3. C2: one full `pytest -n 2` = 0 failed → `pytest_final2_run1.log`.
4. C3: ESLint 0/0, `CI=true yarn build`, `yarn build`, browser smoke (0 console errors).
5. C4: `tools/perf_budget.py` → `memory/qa/perf/phase1_end.md`.
6. C5: PRD + HANDOFF + test_credentials STORY block, git clean. Uncommitted at fork: `mem_sampler.sh`, `mem_samples_run8*.log`, `pytest_final2_run1.log`.

## OPEN (orchestrator) after the builder reports
- P1-8: e2e_tester in 3 batches (≤ 8 rows each), one row per JRN; seed facts from `demo_journeys.md`:
  - (a) JRN-2, 3, 5, 6, 8, 9, 24, 25
  - (b) JRN-11…17
  - (c) JRN-4, 7, 18, 26, 27, 28
  - Builder-evidenced: JRN-1, 10, 19–23, 29, 30.
- P1-9: code review re-run (target ≥ 78/100, 0 critical/high) → findings to the builder.
- P1-10: tell the owner in 5 lines. Then write the phase2 docs and start Phase 2 with no stop (owner order).

## 4th job progress (2026-11-16)
- Chunk 1 (IST business day, follow-ups, rebuild) DONE: commits f0fc280…3374f26.
- Chunk 2 (backup memory spike, transfer money-law fix, refresh catch-up, greeting, full pytest 738/0, ESLint/build, perf) DONE: HEAD 4c973a1.
- e2e_tester Phase 1: iteration_1 (batch a: 13 pass/2 fail), iteration_2 (batch b: 5/4), iteration_3 (batch c: 10/2). Fix round 1 = items E0–E13 sent to builder (Home ageing ≠ report; seed audit rows dated tomorrow; refresh wipes Hold Reasons master; setup ids regenerate; holds without expiry; frontend UTC dates; part-paid text on booking tab; Other series in trend chart; Reports buckets gross vs net; last_backup null; refresh running row; audit labels; JRN-11 seed fact). New JRN-35…38.
- After fix round 1: retest failed rows (iteration_1/2/3 suites) → code review (≥78) → owner 5-line note → Phase 2.

## PHASE 1 CLOSED (2026-11-16, ~11:30 IST)
- Closing proof: pytest_final2_run6.log 760 passed / 6 skipped / 0 failed; tieout 120/120; integrity 0; chronology 0; purge {}.
- e2e_tester iterations 1–5 (all failures fixed; last fix K1 verified by builder's tester iteration_33 7/7).
- Code review close-out ≈78/100, 0 critical/high (phase1/code_review_closeout.md); MEDIUM N+1 fixed.
- Known: full pytest peaks at the 8 GB cgroup (mostly page cache; mongod ~3.65 GB; largest worker 294 MB).
- Phase 2 started: docs phase2/requirement.md + journeys.md; chunk 2A (connection matrix + create-booking speed) sent to builder.
