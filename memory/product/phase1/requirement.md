# Phase 1 — Clean foundation

Version: phase-1
Product context: `/app/memory/product/overview.md` (F-1 … F-8). Architecture + locked rules: `/app/memory/HANDOFF.md` §2–§5, §10. Baseline review: `phase1/code_review_baseline.md`.
No visual redesign in this phase (that is Phase 2–3); screens must look and behave the same except where a requirement below says otherwise.

## Goal
Make the base trustworthy before the redesign: readable code with one UI kit, every money split computed from real allocations, every old bill showing its part-paid detail, every trace of test data gone, a fresh KKT demo built from complete logical journeys up to today, and a test suite that never flakes.

## Functional requirements

### F-1 Readable code
- REQ-1 [always] The system shall have every file under `frontend/src` formatted by Prettier (printWidth 100, one shared config committed) with no line over 160 characters outside generated/vendor files.
- REQ-2 [always] The system shall have every backend Python file formatted by `ruff format` (line length 120) with imports sorted (`ruff --select I`).
- REQ-3 [always] The system shall fail its test suite when any file is not formatted (format-check gate test for both stacks).
- REQ-4 [unwanted] If formatting changes behaviour, then the system shall show it as a failing existing test (formatting commits contain no hand edits; full suite + `yarn build` green after each).

### F-2 One UI kit, no dead code
- REQ-5 [always] The system shall contain no `components/ui/*` file with zero importers.
- REQ-6 [always] The system shall use one toast system (sonner) everywhere; `ui/toast.jsx`, `ui/toaster.jsx`, `hooks/use-toast.js` removed.
- REQ-7 [always] The system shall use one Button component everywhere; the `.btn` CSS class family is removed or becomes the single Button's implementation (interpreted).
- REQ-8 [always] The system shall use `StatTile` / `StatusPill` only; the `StatCard` / `StatusBadge` alias shims and the local `Stat` in BookingDetail are removed.
- REQ-9 [always] The system shall not contain the unrouted default `SiteVisits` page component (named exports used by Leads stay).
- REQ-10 [always] The system shall have CRB-5 (`routers/public.py:90` fallback), CRB-6 (`routers/graph.py:36`, NaN comment) and CRB-7 (blind `except` / `except: pass` narrowed with logging, file writes in context managers) fixed.
- REQ-11 [always] The system shall have every frontend import of a deleted file removed, verified by `yarn build` (CI=true) and ESLint 0 errors / 0 warnings.

### F-3 Cash vs Account split from allocations
- REQ-12 [always] The system shall compute Cash share / Account share / Other charges of a set of receipts through one shared function in `services/` that sums each cleared receipt's `allocations[]` parts by category (a receipt without `allocations[]` counts wholly in its single target's category).
- REQ-13 [always] The system shall use that function for the Home collections figures.
- REQ-14 [always] The system shall use that function for the trends / monthly buckets split.
- REQ-15 [always] The system shall use that function for every collections report (`routers/reports.py`, `routers/reports_i.py`).
- REQ-16 [always] The system shall use that function for the booking summary Cash paid / Account paid (`routers/payments.py`).
- REQ-17 [always] The system shall keep Roznamcha cash-in-hand based on physical payment mode (Cash receipts in, cash refunds out).
- REQ-18 [always] The system shall make Cash + Account + Other equal the sum of cleared receipts for the same period, to the paise.
- REQ-19 [unwanted] If a receipt is reversed or bounced, then the system shall remove every one of its allocation parts from Home, trends and reports.

### F-4 Part-paid detail on old bills
- REQ-20 [event] When the one-time backfill runs, the system shall store `paid_parts` on every demand (demands without it = 0).
- REQ-21 [always] The system shall show the part-paid detail (e.g. "Cash part paid · Account ₹1,83,750 open") on every Partially Paid bill in Bills raised, the booking page and Customer 360.
- REQ-22 [unwanted] If the backfill runs again, then the system shall change nothing and report "0 changed".
- REQ-23 [unwanted] If rebuilding a booking during backfill would change its outstanding or advance, then the system shall skip saving it and list it in the backfill report (interpreted).

### F-5 Test data gone for good
Test data found in the preview DB on 2026-11-13 (the purge must cover all of it):
- 17 projects: "S1 Acceptance Park" (S1ACC) + 16 × "QA Story Heights ####" (QSH*), with all towers, flats, bookings, bills, receipts, ledger rows, documents, files, summaries.
- 6 test towers inside Shree Ganesh Heights: "QA Tower S1", "Tower M2 (test)", "Tower QA 92712", "QA Tower", "Tower S (setup test)", "Tower Z (test)" — including their live bookings and money.
- Payment plans: 60 × "LT CLP L*", every "QA *" plan, "M2 Flexi"; payment plan template "LT CLP LA".
- Masters/templates named with "QA" / "test" (17 tower templates incl. "G+14 like SGH QA Tower S1", 17 floor templates, 17 flat types, 17 stage plan templates, 17 construction stage plans, stage "QA Terrace Slab").
- Leads "Load Test", "Y2 Buyer QA", "QA Ramesh ####"; customer CUST-2627-0085 "Load Test" (+ BK-2627-0030, receipt KKT/2627/00590); every customer whose only bookings are in purged towers/projects.
- REQ-24 [event] When a Super Admin runs the hard purge as a dry run, the system shall return every record it would delete grouped by type with counts, deleting nothing.
- REQ-25 [event] When the hard purge is confirmed (`confirm: "HARD-PURGE"`), the system shall permanently delete every listed record with all child records (towers, floors, flats, parking slots, bookings, demands, payments, refunds, ledger entries, documents, stored files, read-model summaries).
- REQ-26 [always] The system shall keep every existing audit history row and write one "Test data purged" audit row with counts per type and the numbers removed.
- REQ-27 [unwanted] If the selection reaches a record that is not test lineage (named list above, `load_test` / `qa` tag, or children of those), then the system shall refuse with "Purge stopped: <record> is not test data" and delete nothing.
- REQ-28 [always] The system shall never reuse a purged booking, receipt, customer or bill number.
- REQ-29 [always] The system shall rename migration-made plan names that start with "Imported – " to their plain name (no duplicates created).

### F-6 Fresh KKT demo built from complete journeys (owner: "random data sheet mat karna, must always be logical")
- REQ-30 [event] When the demo rebuild runs (after the purge), the system shall replace all demo transactions (leads, visits, customers, bookings, bills, receipts, refunds, documents, construction progress) with a new deterministic story dated from project launch up to today (server date).
- REQ-31 [always] The system shall create every demo business record through the same API endpoints the screens use (per-flat pricing sheet → 3-step booking API → auto-allocated payments → construction stage completion raising bills; any missing setup via the template appliers), never by direct database inserts; the existing SGH / GGV structure (Towers A/B/C, Villa Blocks P/V) may be kept when it carries clean template lineage (interpreted).
- REQ-32 [always] The system shall give every demo booking a complete journey in date order: lead (with source) → site visit → booking → on-booking bill → receipts → stage bills as its tower's stages complete → receipts (or overdue).
- REQ-33 [always] The system shall include in the story at least: every payment mode (Cash, Cheque, NEFT/RTGS, UPI); cheques still to clear today; one bounced cheque later replaced; overdue bookings in each band (0-30, 31-60, 61-90, 90+); two cancellations (one refund paid, one forfeited); one booking transfer; one agreement revision; active holds incl. one expiring within 48 h; attached parking; at least one Lost lead with reason; receipts dated today and this month; site visits and follow-ups due today.
- REQ-34 [always] The system shall give every demo flat an explicit saleable area and price set through the pricing sheet (no silent defaults); unsold flats remain Available with their price.
- REQ-35 [always] The system shall write `/app/memory/qa/phase1/demo_journeys.md` listing, per booking, the customer, flat, source, key dates, total value, received, balance and status, plus the expected headline numbers for Home and reports.
- REQ-36 [always] The system shall provide a chronology check (`tools/story_logic_check.py` + a test) that fails when any record breaks date order: future-dated entries, receipt before its booking, bill before its stage completion, booking before its lead/visit, cheque cleared before deposit, refund before cancellation.
- REQ-37 [unwanted] If the chronology check, integrity report (0 findings) or tie-outs (100 %) fail after the rebuild, then the system shall report the rebuild as failed (status "failed" with the first failing record).
- REQ-38 [always] The system shall rebuild to identical numbers when run twice with the same as-of date (deterministic).

### F-7 Deterministic tests
- REQ-39 [always] The system's automated suite shall pass with 0 failures in 3 consecutive full parallel runs (`python -m pytest -n 2`), with module/session fixtures honouring the `load_sensitive` lock, and story/headline tests updated to the new deterministic demo numbers.

### F-8 Review re-run
- REQ-40 [always] The system shall reach an Emergent code review score ≥ 78/100 with no open critical/high finding (orchestrator re-runs the reviewer; estimate).

### F-41 Performance baseline (first step of the phase, before any change)
- REQ-41 [always] The system shall include a committed perf script (`backend/tools/perf_budget.py`) that measures p50/p95 server time (from `Server-Timing` or response timing, 30 warm requests each) for every path in overview.md "Performance & Architecture Standards", plus initial JS gzip size from the production build.
- REQ-42 [event] When Phase 1 starts, the system shall record the baseline to `/app/memory/qa/perf/baseline_phase1.md` before any code change.
- REQ-43 [event] When Phase 1 ends, the system shall record the same measurements to `/app/memory/qa/perf/phase1_end.md`.
- REQ-44 [unwanted] If any Phase 1 change makes a measured path slower than its baseline by more than 10 %, then the system shall list it in the phase report with the cause (no silent regressions).
- REQ-45 [always] The system shall emit a `Server-Timing` header (total + db time) on every `/api` response so budgets are measurable (interpreted).

### Phase 1 close-out additions (owner, 2026-11-15)
Not-due demo bills (company `demand_due_days` = 15, so "not due" means a bill raised within its due window):
- REQ-46 [always] The demo story shall contain open bills still inside their due window, so Outstanding "Not due" is above ₹0, with some due within the next 30 days and some due later (interpreted).
- REQ-47 [always] The demo story shall keep every overdue band (0-30, 31-60, 61-90, 90+) non-empty in ₹ and booking count.
- REQ-48 [always] The demo story shall leave at least one tower with a real next pending stage whose stage-complete preview shows the bookings affected and the expected bill ₹.
- REQ-49 [unwanted] If Not due is ₹0 or any overdue band is empty after a rebuild, then `story_logic_check` shall fail with "<band> is empty".
- REQ-50 [always] The demo shall reach this through the same API path as the rest of the story (recent stage completions), never by editing due dates directly.

Nightly demo refresh (owner chose "Auto-refresh demo every night", preview only):
- REQ-51 [optional] Where the demo auto-refresh flag is on (preview environment only), the system shall rebuild the demo story as of the current date every night at 03:00 IST through the existing reseed path (interpreted time).
- REQ-52 [unwanted] If the host is production (billpe.com) or the flag is absent, then the system shall never run the demo auto-refresh (job reports "disabled", changes nothing).
- REQ-53 [unwanted] If a reseed or a test snapshot is already running at refresh time, then the system shall skip that night and record "skipped: <reason>" in the job history.
- REQ-54 [event] When the nightly refresh starts, the system shall take a backup first (interpreted).
- REQ-55 [unwanted] If the nightly rebuild fails chronology, integrity or tie-outs, then the system shall record "failed" with the first failing record and show it on Admin → System Health.
- REQ-56 [always] The system shall show the last demo refresh date and its status on Admin → System Health (interpreted).
- REQ-57 [always] The system shall keep logins, roles, masters, projects, towers, flats with prices and plans unchanged across a refresh, with every number counter only going up.
- REQ-58 [always] The system's automated tests shall stay green after a refresh to any as-of date, deriving expected numbers from that as-of date (never loosened).
- REQ-59 [event] When a refresh completes, the system shall regenerate `memory/qa/phase1/demo_journeys.md` and the STORY block in `memory/test_credentials.md` for the new as-of date.

#### Business day = India calendar day (owner, 2026-11-16: "New day, India clock")
- REQ-60 [always] The system shall derive every server-side "today" / as-of / default entry date from one business-day function whose time zone comes from a company setting defaulting to Asia/Kolkata (interpreted: the field is ready for Phase 4).
- REQ-61 [event] When an entry (receipt, reversal, bounce, cancellation, refund, forfeiture, stage completion, hold, follow-up, document, notice) is saved between 00:00 and 05:30 IST without a user-picked date, the system shall stamp it with the new IST calendar date.
- REQ-62 [unwanted] If the user picks a date on the form, then the system shall keep the picked date unchanged.
- REQ-63 [always] The system shall filter Roznamcha, Demand register, notifications, every report's "today" / "as of" and the Home tiles by the same business day as REQ-61.
- REQ-64 [unwanted] If any server code derives a date from the UTC clock (`now_iso()[:10]`, `date.today()`, `datetime.now(timezone.utc).date()`), then a guard test shall fail naming the file and line (interpreted).
- REQ-65 [always] The demo story shall contain follow-ups due on the as-of business day, so Home "Follow-ups due" is above 0 after every rebuild.
- REQ-66 [unwanted] If "Follow-ups due" is 0 after a rebuild, then `story_logic_check` shall fail with "follow-ups due today is empty".

## Quality requirements
```
Q-9  Tag: Data.DemoFreshness
     Scale: days between the demo's as-of date and today on preview
     Meter: Admin → System Health last refresh date, checked at phase end
     Must: ≤ 1
     Plan: 0
Q-10 Tag: Safety.ProductionUntouched
     Scale: demo auto-refresh runs against production
     Meter: job history + host/flag guard test
     Must: 0
     Plan: 0
Q-11 Tag: Data.DueWindowCoverage
     Scale: empty buckets among Not due, 0-30, 31-60, 61-90, 90+ after any rebuild
     Meter: story_logic_check after every rebuild (manual or nightly)
     Must: 0
     Plan: 0
Q-12 Tag: Data.BusinessDay
     Scale: entries / report rows dated to a day other than the IST calendar day when saved at 00:30 IST and 05:29 IST
     Meter: frozen-clock pytest at 00:30 IST and 05:29 IST across receipt, reversal, cancel→refund, forfeiture, Roznamcha, cancellations report, Home tiles
     Must: 0
     Plan: 0
Q-1  Tag: Money.SplitCorrectness
     Scale: paise difference between Home/trends/reports Cash, Account, Other and Σ allocation parts per category
     Meter: new tie in tools/tieout.py + pytest, every gate run
     Must: 0
     Plan: 0
Q-2  Tag: Money.TieOuts
     Scale: % of tie-outs passing (tools/tieout.py)
     Meter: after F-3, after purge, after demo rebuild
     Must: 100 %
     Plan: 100 %
Q-3  Tag: Data.Logic
     Scale: records failing the chronology check
     Meter: tools/story_logic_check.py on preview DB after rebuild
     Must: 0
     Plan: 0
Q-4  Tag: Data.PurgeCompleteness
     Scale: records whose name/code matches QA / test / Load Test / LT CLP / QSH / S1ACC after purge (all collections)
     Meter: scan script output saved to memory/qa/phase1/purge.md
     Must: 0
     Plan: 0
Q-5  Tag: Test.Determinism
     Scale: failed tests across 3 consecutive `pytest -n 2` full runs
     Meter: builder, logs in memory/qa/phase1/
     Must: 0
     Plan: 0
Q-6  Tag: Code.Readability
     Scale: frontend/backend source lines > 160 chars (excluding vendor/generated)
     Meter: awk scan in the format gate test
     Must: 0
     Plan: 0
Q-7  Tag: Code.ReviewScore
     Scale: Emergent code review score /100
     Meter: orchestrator re-run at phase end, same method as baseline
     Must: ≥ 72 (estimate)
     Plan: ≥ 78
Q-8  Tag: Regression.Behaviour
     Scale: screens/API responses that changed outside F-3/F-4/F-5/F-6
     Meter: full pytest + OpenAPI snapshot diff + e2e browser checks of booking, payment, Home
     Must: 0
     Plan: 0
```
