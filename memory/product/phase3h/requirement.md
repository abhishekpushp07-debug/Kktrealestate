# Phase 3H: Reports close-out — every report tells the same money story

Version: phase-3H. Feature: F-57 (see `../overview.md`, owner decisions 2026-11-18 (1)–(5) under Phase 3H/3I, Edge Cases "Collections (3H)" and "As of (3H)"). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10. Starting point: the 50-report engine from 3F (`../phase3f/requirement.md`), the 3G fixes (`/app/memory/qa/db_audit/report.md`, commit `177c467`), tie-out status `/app/memory/qa/reports/status.md`.

## Goal
The owner found two places where reports disagree (Collections vs Bank-wise + Cash: ₹15,000; Bills vs Collection vs Customer status: ≈ ₹4.6 lakh). Make every money report follow the owner's rules so any two reports that should agree do agree to the paisa, and any legitimate difference is explained by exactly one named line on screen. Add "As of" to Outstanding, Floor / Flat drill levels, and the listed presentation fixes. Then re-prove all 50 reports. Speed work is Phase 3I (this phase must not make any report slower).

## Functional requirements

### 3H-A Received means cleared (owner decision 1)
- REQ-319 [always] The system shall count a receipt as received only when its money is cleared (cash and online on their receipt day; a cheque on its bank-clearing day), in Collections, Bank-wise receipts, Roznamcha, Cash vs Account, Customer status, Outstanding, Home and every other report that shows money received.
- REQ-320 [always] Collections and Bank-wise receipts shall show cheques received but not yet cleared as one separate line "Cheques in hand ₹X (n cheques)", never inside any Received total.
- REQ-321 [event] When the user taps "Cheques in hand", the system shall open the list of those cheques (number, customer, flat, bank, cheque date, amount, days in hand) whose sum equals ₹X.
- REQ-322 [always] A bounced cheque shall never count as received in any report; a bounced cheque that had cleared before bouncing shall appear as one named line "Bounced after clearing −₹X" in the period of the bounce. (interpreted)
- REQ-323 [always] Collections total shall equal Bank-wise receipts total + Cash received for the same filters, to the paisa, and the screen shall show this identity as one line: "Bank-wise ₹A + Cash ₹B = Collections ₹C".
- REQ-324 [unwanted] If any remainder exists between Collections and Bank-wise + Cash, then the system shall show it as a named bridge line with its cause (e.g. "Reversed in period −₹X"), and the tie-out shall fail on any unnamed remainder.
- REQ-325 [always] The ₹15,000 gap the owner saw shall be traced to its exact receipts and the cause written in the phase report before the rule is changed.

### 3H-B Cancelled bookings (owner decisions 2026-11-18)
- REQ-326 [always] Money received on a booking that is later cancelled shall stay in Collections, Bank-wise and Roznamcha in the period it was received.
- REQ-327 [always] Refunds paid shall show in Collections as one separate line "Refunds paid out −₹R", never netted silently from Received.
- REQ-328 [always] Bills vs Collection shall leave cancelled bookings (their bills, receipts and waivers) out by default.
- REQ-329 [optional] Where the user turns on the "Include cancelled" switch on Bills vs Collection, the system shall add cancelled bookings back and show one bridge line "Cancelled bookings ₹X" explaining the difference from the default view.
- REQ-330 [always] In its default view, Bills vs Collection "Bills raised" (instalments) shall equal Customer status "Bills raised till date" for the same filters and date, to the paisa; any other-charge or GST part shown in Bills vs Collection shall be its own named column, never mixed into that figure. (interpreted)
- REQ-331 [always] The ≈ ₹4.6 lakh gap the owner saw shall be traced to its exact bookings / bills and the cause written in the phase report.
- REQ-332 [always] A cancellation charge (forfeit) shall show as other income in Cancellations & refunds and Cash vs Account, never as sales and never as instalment collection.

### 3H-C Outstanding "As of" (owner decisions + Edge Cases "As of (3H)")
- REQ-333 [always] Outstanding & ageing shall offer an "As of" date (default today) that shows every live booking's outstanding, advance and ageing bands as they stood at the end of that day (India business day).
- REQ-334 [always] As of a past day, a cheque dated on or before the day but cleared after it shall count as "Cheques in hand", not received.
- REQ-335 [always] As of a past day, a waiver approved after the day shall not reduce the outstanding.
- REQ-336 [always] As of a past day, a price revision or plan change made after the day shall be ignored.
- REQ-337 [always] A booking cancelled at any time shall be left out of Outstanding for every As-of date, even a date before it was cancelled (owner).
- REQ-338 [always] A transferred booking shall count under whichever booking was live on the As-of day, so the sale is counted once. (interpreted)
- REQ-339 [always] Ageing bands (Not due / 0–30 / 31–60 / 61–90 / 90+) shall be measured from the As-of day, by each bill's own due date, including manual bills, bounce charges and other extra charges (owner decisions 4, 5).
- REQ-340 [always] Outstanding As of D shall equal Customer status As of D (dues) for every D, to the paisa, and Outstanding As of today shall equal today's Outstanding, Home due ageing and Demand register.
- REQ-341 [always] The As-of date shall appear in the filter sentence, the PDF / Excel title and any shared link.
- REQ-342 [unwanted] If the user picks a date in the future, then the system shall refuse it with the message "As of can't be after today".

### 3H-D Manual bills (owner decision 5)
- REQ-343 [always] The system shall accept a payment against a manual bill even when the share it sits on was already fully paid, the share cap growing by that bill's amount.
- REQ-344 [unwanted] If a payment exceeds everything owed on the booking including manual bills, then the system shall keep the existing rule for the excess (advance or refusal, as today) with its existing message. (interpreted)

### 3H-E Drill levels and presentation
- REQ-345 [always] Outstanding and Collections shall offer the group levels Project → Tower → Floor → Flat → Booking, with subtotals at each level equal to the sum of the level below.
- REQ-346 [always] The Outstanding PDF shall fit every column on A4 landscape with no money figure, date or flat code wrapping onto a second line; long names shorten with "…". (interpreted)
- REQ-347 [always] The stacking plan shall never show customer reference numbers (CUST-…) on a flat tile, for any role. (interpreted)
- REQ-348 [always] The Booking register headline shall read "N live · M cancelled" (live = Active + Completed), e.g. "80 live · 2 cancelled", and each part shall open its list.
- REQ-349 [always] System Health shall show "All n uniqueness rules applied" when every rule is applied (3G tester note), and keep the existing "Uniqueness rule not applied — duplicates found" warning otherwise.

### 3H-F Proof of all 50
- REQ-350 [always] Every one of the 50 reports shall be re-proved on preview, `kkt_medium` and `kkt_volume`: tie-out 0 unexplained differences, Excel and PDF totals equal the screen, Night + Light screenshots at 1440 and 390 px, phone width without horizontal scroll.
- REQ-351 [always] The connection matrix shall gain cells for: cheque received → "Cheques in hand" up, cheque cleared → Received up and "Cheques in hand" down, bounce, refund paid, cancel → Bills vs Collection default unchanged / switch on adds it, manual bill raised → Outstanding up, manual bill paid → Outstanding down.
- REQ-352 [always] Before measuring and taking screenshots, the preview demo shall be refreshed through the existing demo-refresh path so test residue from earlier testers (`tscheck-3g-*`) is gone and headline numbers match the story.

## Quality requirements
```
Q-43  Tag: Money.ReportsAgree
      Scale: paise of unexplained difference between any two reports that must agree (Collections vs Bank-wise + Cash, Bills vs Collection vs Customer status, Outstanding vs Customer status vs Home, As-of today vs today)
      Meter: tools/tieout.py on preview, kkt_medium, kkt_volume, + 12 past As-of dates per DB
      Must: 0
      Plan: 0
Q-44  Tag: Money.AsOfTruth
      Scale: bookings whose As-of outstanding differs from a replay of their source records up to that day
      Meter: independent replay script over every live booking × 12 As-of dates (month ends of the FY + today), volume
      Must: 0
      Plan: 0
Q-45  Tag: Trust.NamedBridges
      Scale: report pairs whose difference is shown without a named line
      Meter: tieout bridge checks + human read of the 50 report screens
      Must: 0
      Plan: 0
Q-46  Tag: Perf.NoSlower
      Scale: % change in p95 first-open time of any report vs memory/qa/perf/baseline_3g_elite.md (Elite: 2 cores, 2 processes, volume)
      Meter: tools/perf_reports_v3.py, 30 warm requests per report
      Must: ≤ +10 % per report
      Plan: ≤ 0 %
Q-47  Tag: Print.NoWrap
      Scale: money / date / flat-code cells wrapping onto a second line in the Outstanding PDF
      Meter: PDF text extraction on preview + volume, every group level
      Must: 0
      Plan: 0
Q-48  Tag: Device.PhoneWidth
      Scale: report screens with horizontal page scroll at 390 px (Night + Light)
      Meter: phone sweep, 50 reports
      Must: 0
      Plan: 0
```

## Non-goals
Speed to ≤ 300 ms (Phase 3I) · Redis (3I) · company scoping (Phase 4) · any change to allocation order, numbering, GST rule or wording beyond the owner decisions above · deleting any history.
