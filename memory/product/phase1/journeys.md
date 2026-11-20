# Phase 1 — Journeys (acceptance criteria)

Login and roles: `/app/memory/test_credentials.md` (headline numbers there will be replaced by `memory/qa/phase1/demo_journeys.md` after the rebuild). Demo projects after this phase: Shree Ganesh Heights (SGH, Towers A / B / C only) and Ganesh Green Villas (GGV). Money words: Bill raised / Received / Balance; Roznamcha.

## F-5 Test data gone

- **JRN-1** Dry run lists everything, deletes nothing
  - steps: As Super Admin call the hard purge with dry run.
  - expected: Groups with counts covering: 17 projects (S1ACC + 16 QSH*), 6 test towers in SGH (QA Tower S1, Tower M2 (test), Tower QA 92712, QA Tower, Tower S (setup test), Tower Z (test)), their flats/bookings/receipts/bills, ~77 test payment plans (60 × LT CLP L*, QA *, M2 Flexi) + template "LT CLP LA", QA masters/templates, stage "QA Terrace Slab", test leads, CUST-2627-0085 + BK-2627-0030 + KKT/2627/00590. Counts in the DB unchanged afterwards.
- **JRN-2** Every screen is clean
  - steps: Run the purge with confirm "HARD-PURGE". Open Projects; SGH → Structure; SGH → Plans; Masters (Flat Types, Floor Templates, Tower Templates, Construction Stages, Stage Plan Templates, Payment Plan Templates); Customers search "Load Test"; Leads; Admin → Audit.
  - expected: Projects shows only Shree Ganesh Heights and Ganesh Green Villas; SGH shows only Towers A, B, C; no plan or master shows "QA", "test", "LT CLP" or "Imported –"; "Load Test" customer and leads not found; Audit shows one "Test data purged" row with counts.
- **JRN-3** Purge refuses real data
  - steps: Call the purge with a selection containing SGH Tower A or one of its live bookings.
  - expected: 409 "Purge stopped: <record> is not test data"; nothing deleted.
- **JRN-4** Numbers never reused
  - steps: After the rebuild, note the highest booking and receipt numbers; create one new booking and receipt through the screens, then cancel/reverse them through the screens.
  - expected: New numbers are higher than every number ever issued (purged gaps are not refilled).

## F-6 Logical demo story

- **JRN-5** Home is alive today
  - steps: Log in as admin@kkt.in and open Home.
  - expected: "Collected this month", "Cheques to clear", "Visits today", "Follow-ups due" are non-zero; overdue banner shows a count; numbers match the headline section of `demo_journeys.md`.
- **JRN-6** One booking's journey is complete and in order
  - steps: Pick any 3 bookings from `demo_journeys.md` (one SGH Tower A, one Tower C, one GGV). For each open its lead, Customer 360, booking ledger, Bills raised rows and receipts.
  - expected: Dates run lead → visit → booking → on-booking bill → receipts → stage bills (each on/after that stage's completion date in Construction) → receipts; nothing dated after today; the booking's Balance equals Σ Bill raised − Σ Received.
- **JRN-7** Story covers every situation
  - steps: Using filters, find: a receipt of each mode (Cash, Cheque, NEFT/RTGS, UPI); a cheque still to clear; a bounced cheque and its replacement; overdue bookings in 0-30, 31-60, 61-90 and 90+; a cancellation with refund paid and one forfeited; a transferred booking; an agreement revision; an active hold expiring within 48 h; a Lost lead with reason; a site visit today.
  - expected: Each exists and appears in the matching report (Collections by mode, Cheque register, Outstanding & ageing, Cancellations & refunds, Hold register, Lead funnel).
- **JRN-8** Reports agree with the journeys
  - steps: Compare Home tiles, Reports → Collections (FY), Outstanding & ageing, Project Statement for SGH with the headline numbers in `demo_journeys.md`.
  - expected: Identical to the rupee.
- **JRN-9** Flats are priced explicitly
  - steps: Open SGH → Inventory and GGV → Inventory; open 3 unsold flats.
  - expected: Every flat shows a saleable area and price; none shows "no price"; unsold ones are Available.
- **JRN-10** Chronology check passes
  - steps: Run `tools/story_logic_check.py` against the preview DB.
  - expected: "0 problems"; integrity report 0 findings; tie-outs 100 %.

## F-3 Cash vs Account split (on the rebuilt demo)

- **JRN-11** Split receipt counts in each bucket it paid
  - steps: Note Home Cash / Account / Other. On an SGH booking with an open Cash-share instalment and an open parking/other charge bill, post a Cash-mode payment (automatic adjustment) equal to both open amounts. Refresh Home (≤ 60 s).
  - expected: Cash rises by the instalment part only; Other rises by the charge part; total rises by the full receipt; the receipt's "Applied to" lines show the same two parts.
- **JRN-12** Physical cash stays physical
  - steps: Open Roznamcha for today.
  - expected: Today's cash includes the full JRN-11 receipt amount.
- **JRN-13** Reversal removes every part
  - steps: Reverse the JRN-11 receipt with a reason; refresh Home and Roznamcha.
  - expected: Home Cash / Account / Other return exactly to the values noted before JRN-11; Roznamcha shows the reversal as a correction.
- **JRN-14** Trends and reports agree with Home
  - steps: Compare current-month Cash / Account / Other on the Home trend chart and Reports → Collections (This month) with Home.
  - expected: Identical; Cash + Account + Other = total received.
- **JRN-15** Booking summary agrees with its ledger
  - steps: On the JRN-11 booking (before reversal) compare Cash paid / Account paid with its ledger Received rows per share.
  - expected: Equal.

## F-4 Part-paid detail

- **JRN-16** Every partially paid bill explains itself
  - steps: Payments → Bills raised, status Partially Paid; open its booking's Bills tab and Customer 360.
  - expected: Every Partially Paid row shows "Cash part paid · Account ₹X open" (or the reverse) in all three places; none blank.
- **JRN-17** Backfill idempotent
  - steps: Run the backfill twice (API).
  - expected: Second run "0 changed"; Outstanding report total identical across runs.

## F-1 / F-2 No visible regression

- **JRN-18** Core flows unchanged after cleanup
  - steps: Create a booking through the 3-step wizard, post a payment, open Customer 360, Bills raised, Roznamcha, Reports, Masters; trigger a success and an error toast (e.g. save a payment plan totalling 95 %).
  - expected: Same steps and fields as before; toasts appear (one style); no blank page; browser console has no errors.

## Close-out additions (2026-11-15): Not-due bills + nightly demo refresh

- **JRN-24** Some bills are not due yet
  - steps: Open Reports → Outstanding & ageing (as of today). Then open Payments → Bills raised and filter to open bills.
  - expected: "Not due" shows more than ₹0. Each of 0-30, 31-60, 61-90 and 90+ shows ₹ > 0 with at least 1 booking. Bills raised has open bills with a due date after today: at least one due within the next 30 days. Every such bill's date is on or after its stage's completion date in Construction. Not due + all bands = Outstanding total, to the rupee.
- **JRN-25** A next billing stage is waiting
  - steps: Open Construction for each SGH tower and GGV block. On a tower with a pending stage, open the stage-complete preview without confirming it.
  - expected: At least one tower shows a next pending stage. Its preview lists the bookings affected and an expected bill total above ₹0. Nothing is raised by opening the preview.
- **JRN-26** Nightly refresh brings "today" back (preview)
  - steps: As Super Admin, trigger the demo auto-refresh job once by hand (same job the 03:00 IST schedule runs) and wait for it to finish. Open Home and Admin → System Health.
  - expected: System Health shows the last demo refresh as today with status done. Home shows non-zero "Collected this month", "Cheques to clear", "Visits today" and "Follow-ups due". A backup taken just before the refresh is listed in backups.
- **JRN-27** Refresh keeps setup and logins
  - steps: Before JRN-26 note the masters list, projects, towers, 3 unsold flat prices and the highest booking and receipt numbers. After the refresh, log in again as admin@kkt.in and sales@kkt.in and check the same items.
  - expected: Both logins work. Masters, projects, towers and those flat prices are unchanged. New booking and receipt numbers are all higher than the noted highest numbers.
- **JRN-28** Never on production, never on top of a running rebuild
  - steps: Call the auto-refresh job with the flag off (or as if on the production host). Separately, start a manual reseed and trigger the auto-refresh while it runs.
  - expected: Flag off/production → job says "disabled" and record counts are unchanged. During a running reseed → job history shows "skipped: reseed running" and only one rebuild runs.

## Close-out addition (2026-11-16): India business day

- **JRN-31** Late-night entry lands on the new India day
  - steps: Between 00:00 and 05:30 IST (or with the server clock frozen at 00:30 IST), post a Cash payment on the JRN-11 booking without changing the date, reverse it, then open Roznamcha for today and Reports → Collections (today).
  - expected: The receipt date and the reversal date both show the IST calendar date (not the previous day). Today's Roznamcha lists the receipt and its reversal correction. Collections (today) includes the receipt.
- **JRN-32** A picked date is kept
  - steps: Post a payment and pick yesterday's date on the form.
  - expected: The receipt shows yesterday's date; it appears in yesterday's Roznamcha, not today's.
- **JRN-33** Follow-ups due today in the demo
  - steps: After the demo rebuild, log in as admin@kkt.in and open Home; open the follow-ups list behind the tile.
  - expected: "Follow-ups due" is above 0 and the list behind it adds up to the tile count; every listed follow-up is due on or before today (IST).

## Builder-evidenced
- **JRN-34** Frozen-clock tests at 00:30 IST and 05:29 IST pass for receipt, reversal, cancel→refund, forfeiture, Roznamcha, cancellations report and Home tiles; the UTC-date guard test fails on a planted `now_iso()[:10]` and passes on the real code; the 3 previously failing `tests/effects/test_events.py` tests pass when the suite starts after 00:00 IST.
- **JRN-29** `story_logic_check` fails with "<band> is empty" on a DB copy where Not due (or any overdue band) is ₹0; passes on the rebuilt demo.
- **JRN-30** After a refresh to a different as-of date, one full `pytest -n 2` run → 0 failed, with no expectation loosened.
- **JRN-19** `prettier --check` and `ruff format --check` pass; 0 source lines > 160 chars; gate test fails on an unformatted file.
- **JRN-20** 3 consecutive `pytest -n 2` full runs → 0 failed (logs in `memory/qa/phase1/`).
- **JRN-21** No `components/ui/*` file without importers; one toast lib; one Button; no StatCard/StatusBadge/SiteVisits default; ESLint 0/0; `CI=true yarn build` ok.
- **JRN-22** Orchestrator's code review re-run ≥ 78/100 (estimate), 0 critical/high.
- **JRN-23** `memory/qa/perf/baseline_phase1.md` (before) and `phase1_end.md` (after) exist with p50/p95 per budget path + initial JS gzip; no path > 10 % slower without an explained cause; every `/api` response carries `Server-Timing`.

## Close-out addition (2026-11-16): tester round 1 follow-ups
- **JRN-35** Payment plan that does not total 100 % cannot be saved
  - superseded: [JRN-18 (only its "error toast for a 95 % plan" clause; the rest of JRN-18 stays)]
  - steps: In Masters → Payment Plan Templates enter instalments totalling 95 %.
  - expected: Save is disabled with the inline message "Σ 95.00% ≠ 100"; with 100 % Save is enabled and shows the "Plan saved" toast.
- **JRN-36** One outstanding number everywhere
  - steps: Compare Home "Due ageing" widget, Reports → Outstanding & ageing, and the Demand register footer, all as of today.
  - expected: Home ageing bands and total equal the report to the rupee (incl. 90+). If the Demand register covers only raised bills, it says so in its header and shows the reconciling line to Outstanding.
- **JRN-37** Refresh keeps every master and stable setup ids
  - steps: Note every master and Admin → Advanced catalogue (incl. Hold Reasons, with a custom one added) and the ids of projects, towers and 3 flats; run the demo refresh.
  - expected: Every master/catalogue entry (incl. the custom Hold Reason) is still there; project, tower and flat ids are unchanged, so a saved link like /bookings/new?flat=<id> still works.
- **JRN-38** System Health shows the refresh's backup
  - steps: Run the demo refresh; open Admin → System Health.
  - expected: "Last backup" shows the backup taken just before the refresh (not "never").
