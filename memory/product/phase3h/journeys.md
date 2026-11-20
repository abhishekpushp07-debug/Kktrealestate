# Phase 3H: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md`. Phase 1–3G journeys stay valid unless listed under `superseded`. Money in ₹, to the paisa.

## 3H-A Received means cleared
- **JRN-141** Cheque in hand is not received
  - steps: Post a cheque receipt of ₹40,000 on a live booking (do not clear it). Open Collections and Bank-wise receipts for the current month.
  - expected: Neither report's Received total includes the ₹40,000; both show "Cheques in hand ₹X (n cheques)" where X includes this ₹40,000; tapping the line lists the cheque; booking page and Customer status do not count it as received.
- **JRN-142** Clearing moves it into Received
  - steps: Clear that cheque with a clearing date of today. Reopen Collections, Bank-wise, Roznamcha, Customer status, Outstanding, Home.
  - expected: Received goes up by exactly ₹40,000 on every surface on the very next read; "Cheques in hand" goes down by ₹40,000; Outstanding of that booking goes down by ₹40,000.
- **JRN-143** Cheque received last month, cleared this month
  - steps: Find (or create on a throw-away copy) a cheque dated in the previous month and cleared in this month. Open Collections for last month and for this month.
  - expected: It appears in this month's Received (clearing day), not last month's; last month's "Cheques in hand" (as of its month end) included it.
- **JRN-144** Bounce never counts
  - steps: Post a cheque, then bounce it. Separately, on a throw-away copy, clear a cheque and then bounce it.
  - expected: An uncleared bounced cheque is in no Received total and leaves "Cheques in hand"; a cleared-then-bounced cheque shows "Bounced after clearing −₹X" in the period of the bounce; totals still tie. (interpreted)
- **JRN-145** One identity, Collections = Bank-wise + Cash
  - steps: Open Collections for This month, last month and this FY; open Bank-wise receipts with the same filters.
  - expected: Collections shows "Bank-wise ₹A + Cash ₹B = Collections ₹C" and C equals Bank-wise total + Cash to the paisa in all three periods; any remainder is a named line; no unnamed gap.
- **JRN-146** The ₹15,000 gap explained
  - steps: Read the phase report section "₹15,000 gap".
  - expected: Names the exact receipts behind the gap the owner saw, the cause, and shows the same figures now agreeing under the cleared rule.

## 3H-B Cancelled bookings
- **JRN-147** Receipts on a cancelled booking stay where they came in
  - steps: Open Collections for the month a now-cancelled booking received money (one of the 2 story cancellations), then Cancellations & refunds.
  - expected: That receipt is inside that month's Received; the refund shows as "Refunds paid out −₹R" in the month it was paid, never subtracted inside Received; the cancellation charge shows as other income in Cancellations & refunds and Cash vs Account, not as sales.
- **JRN-148** Bills vs Collection leaves cancelled out by default
  - steps: Open Bills vs Collection (default) and Customer status for the same filters and today.
  - expected: Cancelled bookings are not listed; Bills raised (instalments) equals Customer status "Bills raised till date" to the paisa; other charges / GST, if shown, are their own columns.
- **JRN-149** "Include cancelled" switch
  - steps: Turn on "Include cancelled" on Bills vs Collection; turn it off again.
  - expected: Cancelled bookings appear and one bridge line "Cancelled bookings ₹X" explains exactly the difference from the default view; turning it off returns to the default figures; the switch state shows in the filter sentence, export title and shared link.
- **JRN-150** The ₹4.6 lakh gap explained
  - steps: Read the phase report section "₹4.6 lakh gap".
  - expected: Names the exact bookings / bills behind the gap, the cause, and shows the reports now agreeing.
- **JRN-151** A booking cancelled today disappears from sales figures
  - steps: On a throw-away copy, cancel a live booking with bills and receipts. Open Outstanding, Customer status, Bills vs Collection (default), Sales summary, Booking register.
  - expected: The booking leaves Outstanding, Customer status, Bills vs Collection default and Sales summary; Booking register headline moves from "N live · M cancelled" to "N−1 live · M+1 cancelled"; its receipts stay in Collections in their original months.

## 3H-C Outstanding "As of"
- **JRN-152** As of today = today
  - steps: Open Outstanding & ageing with As of = today.
  - expected: Totals and every band equal the default Outstanding, Home due ageing, Demand register and Customer status (dues) to the paisa.
- **JRN-153** As of a past month end
  - steps: Pick As of = last month's end; compare with Customer status As of the same date.
  - expected: Every booking's outstanding equals Customer status dues for that date; ageing bands are measured from that date; the date shows in the filter sentence, PDF / Excel title and shared link.
- **JRN-154** Cheque in hand as of a past day
  - steps: Pick As of = a day between a cheque's date and its clearing date.
  - expected: That cheque is in "Cheques in hand", not received; the booking's outstanding includes it.
- **JRN-155** Later waiver, later price change ignored
  - steps: Pick As of = a day before a waiver approval (and, on a throw-away copy, before a price revision) on a booking.
  - expected: The outstanding as of that day does not include the waiver reduction or the revision; As of today does.
- **JRN-156** Cancelled is never in Outstanding
  - steps: Pick As of = a day before one of the story cancellations.
  - expected: The cancelled booking is not listed and not in any total, even though it was live on that day.
- **JRN-157** Transferred booking counted once
  - steps: Pick As of = a day before and a day after a transfer (story or throw-away copy).
  - expected: Before: counted under the original booking; after: under the new booking; never both, never neither. (interpreted)
- **JRN-158** Future date refused
  - steps: Type tomorrow's date in As of.
  - expected: Message "As of can't be after today"; the report keeps its last valid date.
- **JRN-159** As-of replay proof
  - steps: Run the independent replay over every live booking × 12 As-of dates on volume.
  - expected: 0 bookings differ.

## 3H-D Manual bills
- **JRN-160** Manual bill counts and can be paid
  - steps: Raise a manual bill of ₹20,000 on a booking whose share is already fully paid; open Outstanding; post a ₹20,000 payment against it.
  - expected: Outstanding rises by ₹20,000, aged by its own due date; the payment is accepted and allocated to that bill; Outstanding returns to its earlier figure; statement balance (Udhar − Jama) = Outstanding − Advance.
- **JRN-161** Bounce charge counts in Outstanding
  - steps: Bounce a cheque that carries a bounce charge (or raise a bounce charge by hand).
  - expected: The bounce charge appears in Outstanding and ageing by its own due date, and in the Other charges report.
- **JRN-162** Overpayment keeps today's rule
  - steps: Try to pay more than everything owed on a booking including manual bills.
  - expected: Same behaviour and message as before this phase for the excess. (interpreted)

## 3H-E Drill levels and presentation
- **JRN-163** Floor and Flat levels
  - steps: In Outstanding and in Collections, group by Project → Tower → Floor → Flat → Booking; expand a tower and a floor.
  - expected: Each level shows subtotals that equal the sum of the level below; grand total unchanged vs no grouping.
- **JRN-164** Outstanding PDF fits
  - steps: Export Outstanding to PDF at booking level and at tower level, on preview and volume.
  - expected: A4 landscape; no money figure, date or flat code wraps; long names end with "…"; totals equal the screen.
- **JRN-165** Stacking plan without customer ids
  - steps: Open the stacking plan as admin and as sales.
  - expected: No tile shows a CUST-… reference for either role; tapping a flat still opens it where permitted. (interpreted)
- **JRN-166** Booking register headline
  - steps: Open the Booking register on preview after the demo refresh.
  - expected: Headline "80 live · 2 cancelled" (or the current story counts in that format); each part opens its list.
- **JRN-167** System Health shows rules applied
  - steps: Open System Health as admin.
  - expected: "All n uniqueness rules applied" with n = the number of rules; the not-applied warning appears only when a rule is skipped.

## 3H-F Proof of all 50
- **JRN-168** All 50 reports re-proved
  - steps: Run tieout on preview, medium, volume; export each report to Excel and PDF; run the phone sweep and screenshots.
  - expected: 0 unexplained differences; exports equal screen totals; 0 horizontal scroll at 390 px; Night + Light screenshots saved for all 50.
- **JRN-169** No report got slower
  - steps: Run the Elite perf script (2 cores, 2 processes, volume) for all 50 reports.
  - expected: No report's first-open p95 more than 10 % above `memory/qa/perf/baseline_3g_elite.md`.
- **JRN-170** Connection matrix covers the new rules
  - steps: Run the connection matrix.
  - expected: 100 % green, including cheque in hand / clear / bounce, refund paid, cancel × Bills vs Collection (default and switch), manual bill raised / paid.
