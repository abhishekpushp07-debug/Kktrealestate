# KKT ERP — Master To-Do (all 8 phases)

Written by the orchestrator on 2026-11-15, before the owner forks. This is the single to-do list for the whole program. It sits alongside `overview.md` (features F-1 … F-43, budgets, owner decisions), `phase1/requirement.md` and `phase1/journeys.md`, and `phase1/resume.md`.

Owner's standing orders:
- "Do not stop before completing all eight phases."
- "World best and my custom logic."
- "Only what's needed, no unnecessary steps."
- "Everything logical, all features talk to each other."
- "Repeatable things through master, and the master has logic; one-off things typed directly."

Language with the owner: Hinglish / simple English, non-technical.

---

## 0. How to resume after the fork (orchestrator)

1. Read in this order: this file → `phase1/resume.md` → `overview.md` → `phase1/requirement.md` + `journeys.md` → `/app/memory/HANDOFF.md` §3, §5 → top of `/app/memory/PRD.md` → `/app/memory/qa/phase1/step8_fixes.md`.
2. Get the preview URL with get_preview_url. The last one was `https://kkt-reports-hub--7kz2bq77.preview.emergentagent.com`, and it changes on fork: update overview.md line 3 and ask the builder to update test_credentials.md.
3. Builder: `web_app_dev`, background true. In the previous job it locked twice after a pod restart (it reported "stopped" while the name stayed "held by a live instance"). In a new job it starts fresh.
   - In its first message, say the app already exists and point it to these docs.
   - Tell it to run long commands in the background with nohup + polling.
4. Every phase follows the same loop:
   1. Write `phase{N}/requirement.md` + `journeys.md` (load the `e4-product-spec` skill first).
   2. Send the builder one full brief.
   3. The builder builds and reports back.
   4. Run e2e_tester (≤ 8 criteria per call, one row per JRN).
   5. The builder fixes what failed (max 2 rounds, then ask the owner).
   6. Close the phase.
5. Owner touchpoints are only these 3: optional publish after Phase 3, one Tally import check in Phase 6, and pressing Publish in Phase 8. Everything else runs without stopping.

## Gates every phase must pass (the "Done" bar)
| Gate | Must |
|---|---|
| Owner's custom logic (HANDOFF §3, §5) | unchanged; any change only with the owner's explicit OK |
| Money tie-outs `tools/tieout.py` | 100 % |
| Integrity report | 0 findings |
| Chronology `tools/story_logic_check.py` | 0 problems |
| Connection matrix (from Phase 2) | 100 % green |
| `python -m pytest -n 2` | 0 failed. Never weaken, skip or xfail an assertion; fix the root cause |
| ESLint / `CI=true yarn build` | 0 errors, 0 warnings / ok |
| Perf budgets (overview.md) | within budget; no path > 10 % slower than the previous phase without a stated cause |
| e2e_tester on the phase journeys | all pass, 0 blocked |
| Master rule (F-43 wording) | no one-off value forced through a master; every master carries its logic |
| Multi-company awareness | every new collection / query / number / file carries `company_id` from Phase 4 on; new code written before Phase 4 is ready for it |

---

## PHASE 1: Clean foundation (status: ~90 % done)

Done and committed (HEAD `a289596`):
- [x] Perf baseline + Server-Timing on every /api (`memory/qa/perf/baseline_phase1.md`)
- [x] Prettier (100) + ruff format (120) + format gate test, 0 lines > 160
- [x] One UI kit: 30 zero-importer ui files deleted, one toast (sonner), one Button, StatTile/StatusPill only, unrouted SiteVisits page removed. **No booking/payment/flat logic was touched.**
- [x] Cash / Account / Other split from receipt allocations through one function (`services/definitions.receipt_split`) used by Home, trends, reports and booking summary
- [x] `paid_parts` backfill (idempotent, "0 changed" on rerun)
- [x] Hard purge of all test data (dry run → HARD-PURGE, 409 on real data, audit row, numbers never reused). Scan `{}`
- [x] Logical story reseed through the real API: 78 live + 2 cancelled bookings, 1,082 payments, 556 bills, 120 leads, 87 visits, 3 holds, 56 available flats. Chronology check, counters never reset, anchors by story role
- [x] Step 8 root fixes, which were 4 real connection bugs:
  - the Outstanding report cache was not cleared on payments
  - payment-total cache (5 min) stale
  - the trends chart lagged and could lose entries during a refresh
  - the reseed was killed by the 60 s timeout; the propagation page mis-reported in-flight rows
  - plus test fixes. See `qa/phase1/step8_fixes.md`
- [x] 3 consecutive `pytest -n 2` runs at 712 passed / 6 skipped / 0 failed (`qa/phase1/pytest_final_run{1,2,3}.log`, not yet committed)
- [x] tieout 118/118 · integrity 0 · chronology 0 · Home = trends = Collections (this month) to the paise

Remaining (builder). **Status at the 3rd fork (2026-11-15 ~20:40 UTC, HEAD 2f1ea22): see `phase1/resume.md`**
- [x] P1-1 Commit the pending memory docs and the 3 run logs. (19005a0)
- [x] P1-2 **Not-due demo fix** (568e469). Details below are kept for reference. Today every bill in the demo is overdue (Not due = ₹0), which is unrealistic and starves the Phase 2 widgets. In `tools/story_seed.py`, through the same API path:
  - recent stage completions, so some bills are still inside their due window (some due ≤ 30 days, some later), using the existing due-days rule
  - every overdue band (0-30 / 31-60 / 61-90 / 90+) stays non-empty
  - at least one tower has a real next pending stage with its expected bill amount
  - `story_logic_check` fails when Not due = ₹0 or any band is empty
- [x] P1-2b **Nightly demo refresh (owner chose 2026-11-15, preview only)** (f2fc469), REQ-51 … 59 / JRN-26 … 30: 03:00 IST job under the leader lease, env flag on preview only, never on billpe.com, backup first, skip if a reseed/test snapshot runs, status on System Health, tests derive expectations from the as-of date, demo_journeys.md + STORY block regenerated.
- [x] P1-3 Rebuild on preview (f753417; tieout 118/118, integrity 0, chronology 0, purge {}, determinism identical). Then:
  - tieout 100 %, integrity 0, chronology 0, purge scan `{}`, determinism (same as-of → same numbers)
  - regenerate `qa/phase1/demo_journeys.md` + `test_credentials.md` headline numbers (incl. Not due + every band)
  - re-derive anchored test expectations (never loosen)
- [ ] P1-3b **NEW P0: IST "today" bug.** 19 server places use `now_iso()[:10]` (the UTC date) instead of `clock.today()` (IST), so entries made between 00:00 and 05:30 IST land on the previous day. 3 suite failures in `tests/effects/test_events.py` prove it. Also: Follow-ups due = 0 in the 11-16 demo. See `phase1/resume.md` OPEN 1–2.
- [ ] P1-4 ONE full `pytest -n 2` at 0 failed → `qa/phase1/pytest_final2_run1.log`.
- [ ] P1-5 ESLint 0/0, `CI=true yarn build`, `yarn build` (preview serves the build), browser smoke (login → Home → booking → Customer 360 → Bills raised → Roznamcha → Reports, 0 console errors).
- [ ] P1-6 `tools/perf_budget.py` → `memory/qa/perf/phase1_end.md` (baseline vs end, > 10 % regressions with cause).
- [ ] P1-7 PRD.md + HANDOFF.md updated, git status clean.

Remaining (orchestrator):
- [ ] P1-8 e2e_tester on Phase 1 journeys in 3 batches:
  - (a) JRN-2, 3, 5, 6, 8, 9, 24, 25
  - (b) JRN-11 … 17 (split receipt → Home/Roznamcha/reversal/trends/booking summary/part-paid/backfill)
  - (c) JRN-4, 7, 18, 26, 27, 28
  - Seed facts come from `demo_journeys.md` / `test_credentials.md`. Builder-evidenced: JRN-1, 10, 19–23, 29, 30.
- [ ] P1-9 Code review re-run (target ≥ 78/100, 0 critical/high). Send the findings to the builder.
- [ ] P1-10 Tell the owner in 5 lines: Phase 1 done, what changed, what's proven.

---

## PHASE 2: Connection proof + Calm Light / Night mode + new shell + Home Command Center (F-42, F-9 … F-12)

### 2A. Connection proof (F-42). First, because the owner's main pain is "features not talking to each other"
- [ ] Build `tools/connection_matrix.py` + pytest. For each action it notes before/after on every surface and asserts the same number everywhere within the freshness budget: direct reads immediate; read models / Home ≤ 5 s (interpreted).
- [ ] Actions:
  - create booking
  - payment Cash / Cheque / NEFT / UPI
  - cheque clear, cheque bounce
  - receipt reversal
  - stage complete → bills, stage undo
  - cancel → refund, cancel → forfeit
  - transfer, agreement revision, change plan
  - hold / release / expiry
  - flat price change (unsold)
  - lead → visit → booking
  - master change (e.g. charge head GST %, used by new entries only)
- [ ] Surfaces:
  - booking page, Customer 360, booking ledger (Udhar/Jama)
  - Bills raised, Received, Cheque register, Roznamcha, Demand register
  - Home tiles/widgets, trends
  - reports (Collections, Outstanding & ageing, Project statement, Cancellations & refunds, Hold register, Lead funnel)
  - project/tower/flat status + counters, inventory value
  - receipt / demand / statement PDFs, documents register
  - audit "Where this entry went", notifications
- [ ] Every red cell is fixed at its root (event → invalidation → read model). Matrix saved to `qa/phase2/connection_matrix.md`, and the test runs in every later phase.

### 2B. Design system "Calm Light" + Night mode (F-9)
- [ ] Tokens as CSS variables:
  - canvas warm off-white, white cards, hairline borders
  - one accent token (becomes the per-company brand colour in Phase 5)
  - Due red / Advance green, status colours
  - spacing, radius, shadow
  - modern sans with tabular numbers, self-hosted fonts with `font-display: swap`
- [ ] Night mode, per user: saved on the user profile on the server, applied before first paint (no flash). Theme switch never changes data or layout widths.
- [ ] Charts readable in both themes. WCAG AA contrast in both themes (automated contrast check).
- [ ] Mockups to follow (overview.md UI/UX Rules): calm light + night images.

### 2C. New app shell (F-10)
- [ ] Light collapsible sidebar with the locked 9-area nav (Home · Projects · Customers · Bookings · Payments (Received · Bills raised · Roznamcha) · Construction · Documents · Reports · Masters · Admin). Collapsed state remembered.
- [ ] Top bar:
  - ⌘K search over customers, bookings, flats, receipts, by number / phone / name, keyboard-first, < 200 ms
  - "New" menu: Booking, Payment, Lead, Customer, Site visit
  - notifications bell, profile, theme switch
  - an empty slot reserved for the company switcher (Phase 4)
- [ ] Route-level lazy loading, prefetch on hover, skeletons (never a blank screen). Initial JS ≤ 250 KB gzip.

### 2D. Home Command Center (F-11, F-12)
11 widgets. Every number comes from `services/definitions.py` and opens the list that adds up to it.
- [ ] 1 **Money today**: received today, with Cash / Account / Other; cheques to clear (count, ₹).
- [ ] 2 **This month due vs received**: bills falling due this month vs received this month, % recovery.
- [ ] 3 **Overdue by age**: 0-30 / 31-60 / 61-90 / 90+, ₹ and booking count each.
- [ ] 4 **Call today**: overdue customers by priority, follow-ups due, site visits today, with tap-to-call / WhatsApp link (link only; messaging stays not configured).
- [ ] 5 **Next 30 days inflow**: Not-due bills falling due in the next 30 days + cheques pending clearance.
- [ ] 6 **Next billing milestone**: per tower, the next pending stage, bookings affected, expected bill ₹.
- [ ] 7 **Inventory by tower**: Available / Hold / Booked / Sold counts + unsold value.
- [ ] 8 **Flat status**: compact floor × flat colour grid per project/tower.
- [ ] 9 **Construction progress**: % of stages complete per tower, last completed stage + date.
- [ ] 10 **Sales pipeline**: leads → visits → bookings for the period, conversion %, lost with reasons.
- [ ] 11 **Needs attention**:
  - holds expiring < 48 h
  - bounced cheques not replaced
  - part-paid bills stuck
  - (Phase 6+) TDS certificates pending > 30 days
  - (Phase 7+) commission payable
- [ ] Period switch: Today / This month / FY. Project filter.
- [ ] Role default layouts: Owner, Accounts, Sales, Site engineer. Customize (show/hide/reorder) kept and saved per user.
- [ ] No bare ₹0 tile: an empty widget says what is missing and offers the next step.
- [ ] Perf: one Home bundle endpoint ≤ 200 ms server; first content ≤ 1.0 s, all widgets ≤ 1.8 s.
- [ ] Home numbers == reports == demo_journeys.md headline, to the rupee (tie-outs extended).

### 2E. Phase 2 proof
- [ ] e2e_tester:
  - both themes
  - 390 px (no horizontal scroll)
  - every widget's drill-down sum
  - ⌘K search
  - theme remembered after re-login
  - connection matrix green
  - perf gate

---

> **Phase 1 CLOSED 2026-11-16** (pytest 760/0, tester iter 1–5). **Phase 2 CLOSED 2026-11-16** (matrix 506 green, tieout 332/332, pytest 793/0, tester iter 6–8 → 0 bugs; perf: Home bundle p95 4.9 ms, create booking p95 280 ms, initial JS 112 KB, login→first widget 438 ms).

## PHASE 3: Declutter every work screen + master audit + Next step + journey reports + phone width + real click-through (F-13 … F-20, F-43)

- [ ] 3A **Booking page**: 5 tabs, 1 main action + "More".
  - Tabs: Overview (price, Balance, next due, part-paid) · Bills & Receipts · Ledger (Udhar/Jama) · Documents · Activity
  - Main: **Record payment**
  - More: Mark agreement signed, Revise agreement, Change plan, Transfer, Cancel, Print/Share cost sheet & letters
- [ ] 3B **Customer 360**: 5 tabs.
  - Tabs: Overview · Bookings · Money (all bills / receipts / ledger) · Documents & KYC · Activity
  - Main action is contextual: Record payment, or New booking when there is none
  - More: edit, co-applicants, statements
- [ ] 3C **Project page**: ≤ 5 tabs, merging today's 6.
  - Tabs: Overview (collections + report links) · Structure · Inventory (visual floor × flat status grid, click a flat → drawer) · Plans & Pricing · Construction
- [ ] 3D **Restyle + simplify**:
  - booking wizard (still exactly 3 steps)
  - payment sheet (still 5 fields)
  - Bills raised, Roznamcha, Construction, Masters, Documents
  - searchable parking picker, ₹ formatting while typing, icon menus, no internal words
- [ ] 3E **Master audit (F-43)**:
  - Classify every master (13 + Admin → Advanced catalogues) as **repeatable** (stays; must carry its logic: defaults, calc rule, GST %, trigger, where-used, active/inactive) or **one-off** (master hop removed, typed on the entry).
  - Add inline "Save to master" when a typed value repeats.
  - Changing a master updates new entries only (bookings keep their snapshot) and shows where it's used.
  - Result table to the owner in the phase summary.
- [ ] 3F **Next step guidance (F-17)** after every save. Examples:
  - booking → "Record booking amount / Print allotment letter"
  - stage complete → "12 bills raised: print demand letters"
  - payment → "Print / share receipt"
  - cancel → "Pay refund"
  - lead → "Book site visit"
- [ ] 3G **Reports hub by journey (F-18)**:
  - Sales (Lead → Visit → Booking)
  - Money (Bill raised → Received → Balance → Overdue → Refund)
  - Construction (Stage → Bill)
  - Inventory (Flat status)
  - Admin
  - Every report keeps JSON / CSV / PDF + drill-down.
- [ ] 3H **Phone width (F-19)**: every screen at 390 px, no horizontal page scroll, tables become cards (no bottom tab bar, owner's choice).
- [ ] 3I **Real click-through (F-20)**: a Playwright suite committed in the repo that fills the real forms for the 10-step owner story (master → project → tower → flats → pricing → lead → visit → booking → stage complete → payment → reversal → reports). It runs as a gate.
- [ ] 3J e2e_tester + connection matrix + perf gate.
- [ ] 3K (Owner choice) publish milestone to billpe.com. Ask once at phase end.
- [ ] 3S **Entry completion round** (owner, 2026-11-18: "is all of the entry part done?") — every open entry gap (A owner decisions, B missing screens/buttons, C Elite polish) lives in `/app/memory/product/ENTRY_TODO.md`. Do this before the reports round. Spec: `phase3e/`.
- [ ] 3F **Reports round** — 5 segments × 10 reports on one engine + one-click Customer status. Spec: `phase3f/`. Owner: "do not stop before completing reports, but only after the entry part is complete."
- [ ] 3N–3P **KKT Elite design round** — every open design item (D-1 … D-21) and the "later" list live in `/app/memory/product/design/DESIGN_TODO.md`. Phase 3 is not closed until that list is all Done with proof.

---

## PHASE 4: Multi-company core (F-21 … F-26)

- [ ] 4A `company_id` on every business collection. The migration is idempotent and money-neutral: all existing data → "KKT Constructions". Tie-out snapshot before == after, every total, count and number identical.
- [ ] 4B Company resolution on every request (selected company + membership check). **Fail-closed:** no resolvable company → rejected. Every index has `company_id` as its first key. Uniqueness per company (phone, project code, numbers).
- [ ] 4C Memberships: one login → many companies, roles per company.
  - Company switcher in the top bar (name + logo).
  - A removed member loses access on the next request.
  - A form opened in company A can't post into B (company bound into the idempotency key / form token).
- [ ] 4D Numbering per company with its own prefixes. KKT continues `KKT/FY/NNNNN`, `BK-FY-NNNN` unchanged.
- [ ] 4E Per company, kept apart:
  - object-storage prefix for files
  - audit, reports
  - dashboards / read models
  - cache keys
  - background jobs (one company's failure never stops others)
  - backups
- [ ] 4F Scope the leftover unscoped lookups (`_lineage` users / plans, legacy routes) by company.
- [ ] 4G Platform Owner role + Companies console: list, status, users, projects, usage. Company-level facts only, never another company's customers or money.
- [ ] 4H Tagged test company "QA Builders — test" + automated leak scan (every endpoint × company B token → 404/403). Purged before production.
- [ ] 4I e2e_tester (switching, isolation, numbering) + connection matrix + perf (company_id-first indexes keep budgets).

## PHASE 5: Builder signup, approval, branding, plans, invites (F-27 … F-32)

- [ ] 5A Public signup: company name, owner name, email, phone, city → email verification code (Emergent-managed Resend) → "Pending approval".
  - Signup with an existing email → that login gets a pending membership.
- [ ] 5B Platform Owner approval queue:
  - approve / reject (reason) / suspend / reactivate, with emails
  - a suspended company is blocked but its data is kept
- [ ] 5C An approved company starts with a copy of the standard masters (with their logic; no prices, areas or demo data) + a first-run setup checklist (masters → project → tower → pricing → first booking).
- [ ] 5D Branding per company:
  - logo, letterhead (Emergent Object Storage)
  - receipt / booking prefix
  - brand colour (the accent token from Phase 2)
  - applied on screens, every PDF and emails
- [ ] 5E Plan name + limits (users, projects) recorded, with usage shown. No billing, no blocking.
- [ ] 5F The Company Super Admin invites users by email. An existing login can be added to another company.
- [ ] 5G e2e_tester (full signup → approval → setup → first booking for a second company) + leak scan + perf.

## PHASE 6: TDS 1 % + Tally export (F-33, F-34). Owner decisions locked on 2026-11-14

TDS (new Act Sec 393(1) / old 194-IA; Form 141 Sch. B / old 26QB; certificate Form 132 / old 16B):
- [ ] 6A Applies only when the booking's agreement (Account) value is ≥ ₹50 lakh; otherwise the booking shows "TDS not applicable".
- [ ] 6B **Base = Account share only**, never Cash share. On a receipt, the Account part shows "TDS 1 % ₹X" with the net received.
- [ ] 6C **Credited to the customer ledger the moment the receipt is entered:**
  - gross = net + TDS clears the bill
  - certificate status "Pending" → "Received" (certificate no., challan, date, PDF upload)
- [ ] 6D A reversal or bounce reverses its TDS credit exactly.
- [ ] 6E TDS register (per booking / month / pending certificates), with a widget in Home "Needs attention" for certificates pending > 30 days.
- [ ] 6F Demo journeys extended with TDS (incl. one pending certificate, one received). Tie-outs extended.

Tally (TallyPrime XML, file export only):
- [ ] 6G Ledger-name mapping set once per company (master, with logic).
- [ ] 6H Export bills raised (sales vouchers), receipts (receipt vouchers), refunds (payment vouchers) for a date range. **Account share + other charges only. Cash share never leaves the app.** GST + TDS ledgers included.
- [ ] 6I Safe to re-import: stable voucher IDs, no duplicates.
- [ ] 6J Owner touchpoint: he imports one file into his TallyPrime and confirms.
- [ ] 6K e2e_tester + connection matrix (TDS shows on receipt, ledger, Customer 360, register, Home) + perf.

## PHASE 7: Channel partner / broker commission (F-35, F-36). Owner decisions locked on 2026-11-14

- [ ] 7A Channel partner master (repeatable, with logic): name, firm, RERA agent no., PAN, GSTIN, bank, default commission type/rate.
- [ ] 7B At booking (wizard step 1 or 2, no new step): choose a partner (optional) + commission **chosen per booking**: % of **total value incl. Cash share**, or fixed ₹.
- [ ] 7C Commission becomes **payable once 10 % of the booking's total value is collected**. Re-checked after every receipt, reversal and bounce.
- [ ] 7D Payout entry:
  - GST 18 % when the partner has a GSTIN
  - TDS 2 % (Sec 393(1) / old 194H) deducted
  - net paid
- [ ] 7E **Cancellation = taken back:** the unpaid part is cancelled; the paid part becomes a recoverable from the partner. Commission never touches the customer's ledger.
- [ ] 7F Commission payable register + partner statement + a Home "Needs attention" entry.
- [ ] 7G Demo journeys extended (partner bookings, one payable, one paid, one clawed back). Tie-outs extended.
- [ ] 7H e2e_tester + connection matrix + perf.

## PHASE 8: Final proof + production (F-37 … F-40)

- [ ] 8A Full click-through for two companies, incl. the cross-company leak check (Playwright + e2e_tester).
- [ ] 8B Final code review (target ≥ 85/100). Fix every finding.
- [ ] 8C Security audit focused on cross-company leaks. Fix every finding.
- [ ] 8D Deployment health check (builder). `/api/health` build == HEAD.
- [ ] 8E **Owner presses Publish.** Then on production:
  - purge test data (incl. "QA Builders — test")
  - rebuild the KKT demo by journeys as of that day
  - tie-outs / integrity / chronology on production
  - staged load test, then cleanup
- [ ] 8F Final report to the owner (finish tool).

---

## Known risks / notes
- The builder instance can lock after a pod restart (it happened twice). Symptom: "stopped" plus "name held by a live instance". Fix: fork, or contact support.
- The suite takes ~12 min per `-n 2` run, so always run it in the background with logs.
- MOCKED by design: WhatsApp / SMS adapters (`not_configured`). WhatsApp buttons only open the phone's WhatsApp link.
- Email = Emergent-managed Resend (no key needed).
