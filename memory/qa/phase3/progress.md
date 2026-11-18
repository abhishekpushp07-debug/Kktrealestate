# Phase 3 progress

## Chunk 3-1 — Work screens (booking page, Customer 360, project page)

| Step | Commit | State |
|---|---|---|
| Action inventory (before → after, 73 entries, lost 0) | 2cfdd00 | done — `action_inventory.md` |
| Booking page: 5 tabs, Record payment main, More, server reasons (`GET /bookings/{id}/actions`, `services/booking_rules.py` shared with the handlers), VOID + Pay refund, Overview balance / next due, Ledger law foot, one-number header | 2cfdd00 | done |
| Customer 360: 5 tabs, main action (Record payment / New booking), More | 2cfdd00 | done |
| Project page: 5 tabs, floor × flat inventory grid + drawer, Construction tab | 2cfdd00 | done |
| Ye / no-booking empty states, tower rows wrap on phones, screenshots + timings | c23aaf0 | done |
| Tester iteration_39 fixes (AA chips, next due, plan name, visible reasons, wording, stacked-card labels) | ab913df | done |
| Tester iteration_40 fixes (ledger stacked rows overlap, labels on every stack-table via one observer, receipts card clipped, hero plan pill, C360 key strip wrap, "demand" wording) | this commit | done |

### Proof
- `yarn lint` 0 errors / 0 warnings; `yarn build` ok (main 115.44 kB).
- Connection matrix: 506 green, 0 red.
- `tests/test_phase3_booking_page.py` + `tests/test_theme_contrast.py` pass.
- Testing agent: iteration_39 (JRN-62…68 full), iteration_40 (retest) → remaining items fixed in this commit, verified by `frontend/scripts/p3_stack_check.py` (0 overlap, every headed cell labelled, 0 overflow at 390 px).
- Screenshots: `screens/` — booking, customer360, project, project-ye × light/night × 1440/390 (+ ledger/bills/money 390).
- Warm click → content (ms, median of 3): booking 193, Customer 360 184, project 119, Ye 28. First (cold chunk) click ≈ 785–790.
- Full pytest not run (per instruction).

## Chunk 3-2 — 3D restyle + simplify · 3E master audit

| Step | Commit | State |
|---|---|---|
| Carry-overs: payment twin rows deduped (receipt number + time key, C360 events + journey) with a test; readable checklist / Connected-to labels | 9780994 | done |
| Shared AmountInput (₹, Indian grouping while typing, exact value; jest test) on every ₹ amount field; searchable parking picker; RowMenu on Bills raised / Documents / Masters / templates | 9780994, e571daf | done |
| Used in N + active switch on all masters, templates (+ restore) and catalogues; master edit note; typed lead source / lost reason / drawn-on bank + Save to master (server count) | 9780994, 1400502 | done |
| Master audit (`master_audit.md`), parking slot type default price | 1400502 | done |
| Matrix master-change: new entry offered new GST, old booking unchanged | ec2323e | done (506/0) |
| Internal-words scan: rendered (69 screens × Light × 1440/390) + static source check; owner wording sweep | 56713fa, e571daf, 3ccef6a | 0 hits |
| Tester iteration_41/42 fixes | e571daf, 3ccef6a, this | done |

## Chunk 3-3 — 3F Next step · 3G Reports hub by journey · 3H Phone sweep

| Step | Commit | State |
|---|---|---|
| Shared NextStep prompt (dismissible, 15 s, non-blocking) wired on lead, booking, payment, stage complete, cancel with refund, refund paid | b58d888 | done |
| Reports hub grouped Sales → Money → Construction → Inventory → Admin with journey steps | b58d888 | done |
| Phone sweep 50 routes × Light/Night at 390 × 844 (`phone_sweep.md`) + every content table → cards on phones | b58d888 | 100/100 |
| Items: (i) wizard cost-sheet re-checked on screen (1440 + 390), (ii) template rename as idempotent seed migration, (iii) app date picker on payment / instrument / bill due / register dates | b58d888 | done |
| Tieout tool: reversal rows with no category count as Other (same rule as `services/ledger.py`) | b58d888 | 332/332 · reports 82/82 |
| Tester iteration_43/44 fixes (totals card, pay=1 once, refund letter prefill, permission-aware prompts, 390 cut-offs, Overdue step, nested scroll on phones, colSpan labels, breakdown gaps) | 9d65660, this | done |

Proof 3-3: lint 0/0 · build ok · matrix 506/0 · tieout 332/332 (reports 82/82) · reports contract test pass · internal-words scan 0 (rendered + static) · phone sweep 100/100 · testing agent iteration_43 (JRN-74…76) + iteration_44 (retest, all pass).

## Chunk 3-4 — 3I click-through · Phase 3 closing proof

| Step | Commit | State |
|---|---|---|
| Click-through gate `tests_e2e/clickthrough/` (12 steps through the real screens on a private copy, log `clickthrough.md`) + "Nov 2026" drill title | 603d502 | 12/12 PASS |
| Ledger law on Other-category refunds (`two_sided` rebases other Udhar), `tests/test_refund_other_law.py` (full + partial), matrix action "refund of an Other-category payment", tieout tool counts Other refunds, refund mode labels | 9c42881 | 529/529 · tieout 332/332 |
| Full-pytest fixes (English ledger-law labels, format gates, openapi + permission snapshots, tower-scoped refund assertions), PRD/HANDOFF | 8938f89 | 799 passed / 0 failed |

Proof (one heavy job at a time): yarn lint 0/0 · CI=true yarn build + yarn build ok · connection matrix 23 × 23 = 529 green / 0 red · tieout 332/332, reports 82/82 · integrity 0 findings · chronology (story logic) 0 problems · internal words 0 (rendered + static) · phone sweep 100/100 · click-through 12/12 · perf `qa/perf/phase3_end.md` (no > 10 % regressions; work screens median 24–184 ms ≤ 800) · full pytest -n 2: 799 passed, 5 skipped, 0 failed (15 m 19 s) · peak memory: cgroup 8.59 GB (limit, incl. page cache), anon 5.84 GB.
