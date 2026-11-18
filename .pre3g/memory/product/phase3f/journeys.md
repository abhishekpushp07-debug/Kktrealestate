# Phase 3F: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md` (admin@kkt.in owner, accounts@kkt.in, sales@kkt.in, siteengineer@kkt.in). Read-only on preview unless a step says otherwise. Compare figures across surfaces at the same moment (data refreshes nightly). Phase 1–3E journeys stay valid.

## 3F-A / B Engine and hub
- **JRN-106** Hub is 5 calm segments
  - steps: Open Reports as owner in Night, then Day; at 1440 and 390; then as sales@kkt.in.
  - expected: Segments in order Customers · Finance · Bookings · Project & inventory · Leads, exactly 10 tiles each with live figure + scope caption; "Customer status · one click" at the top; Control room row (Activity log, Data quality) at the foot; Sales sees only its permitted tiles; no tinted / decorative tiles; old report links redirect.
- **JRN-107** Filters: all, many or few
  - steps: Open Outstanding & ageing; pick 2 projects, then Select all towers of one, then 3 floors; choose final status "Overdue" + "Due"; set days overdue ≥ 30; switch date preset Last quarter, then Custom, then As of a past date; Clear all.
  - expected: Cascades narrow correctly; chips show "N selected"; the filter sentence under the header matches; totals change consistently and equal the Outstanding definition for the same filters (tieout); Clear all returns the unfiltered grand total.
- **JRN-108** Five-level drill
  - steps: Group by Project → Tower → Floor → Flat → Customer; collapse and expand; tap down to a customer; open the booking.
  - expected: Each level has a subtotal; subtotals add up to the grand total; the last tap opens the booking page whose figures equal the row.
- **JRN-109** Export, save, share
  - steps: Export the filtered view to Excel and PDF; save it as "QA overdue SGH"; pin it to Home; copy the share link and open it in a new tab.
  - expected: Excel has numbers as numbers, ₹ format, totals and the filter sentence; PDF is landscape where wide, nothing wrapped; the saved view reopens identical from report, hub and Home; the link reopens the same view.

## 3F-C Customers
- **JRN-110** Customer status in one click
  - steps: From the hub tap "Customer status · one click"; read the first 10 rows; check totals; open 3 customers' booking pages; change As of to 31 Mar 2026; export Excel.
  - expected: Exactly the 10 owner columns in order (Customer name · Flat code · Agreement value · Cash component · Bills raised till date · Account received · Cash received · Account dues · Cash dues · Final status); Agreement = Cash component + Account component; dues = bills raised − received − waived per share; each row equals its booking page; Σ Account dues + Σ Cash dues = instalment outstanding in Outstanding & ageing; Final status equals the customer card; As of shows the 31 Mar position (equals carried-from-before at 1 Apr); Excel matches the screen.
- **JRN-111** The other 9 customer reports
  - steps: Open each of Customer statement (pick a customer with a waiver), Overdue & ageing by customer, Advance holders, Collection call list (next 15 days), KYC / agreement / documents pending, Payment behaviour, Customer directory, Service requests & SLA, Cancelled & transferred.
  - expected: Each has the engine filter bar, ≤ 10 default columns, totals, formula or totals in words, one meaningful illustration, phone cards at 390; statement running balance ends at the booking balance; advance total equals Home advance; call list totals equal the forecast for the window.

## 3F-D Finance
- **JRN-112** Finance totals unchanged and connected
  - steps: Open all 10 Finance reports for This FY and for a custom 16-day window.
  - expected: Collections, Roznamcha, Bank-wise, Cheques, Bills vs Collection, Outstanding, Cash vs Account, Other charges & GST, Receivables forecast and Waivers & credit notes show the same totals as before the move (tieout); Collections = Bank-wise + cash; Bills vs Collection bridge = Outstanding bills raised; waivers never appear in Collections or Roznamcha.

## 3F-E Bookings
- **JRN-113** Booking reports
  - steps: Open all 10 Booking reports for This FY grouped by project, then by sales person.
  - expected: Booking register count = bookings in the period; Sales summary value = Σ agreement of those bookings; Discount register = list − agreed; Plan & stage position matches each booking's plan bar; Agreements pending equals the "agreement pending" pill count; Cancellations equal the cancellation records; Realised rate = agreement ÷ area.

## 3F-F Project & inventory
- **JRN-114** Stacking plan and inventory
  - steps: Open Stacking plan for SGH; tap a Sold flat and an Available flat; open Inventory status, Price list & unsold value, Parking inventory, Sales velocity; repeat Stacking plan as sales@kkt.in.
  - expected: The grid shows floors × flats coloured by status, counts equal Inventory status and the project banner (booked or sold); tapping opens the flat / booking; unsold value = Σ list price of Available flats; as Sales the grid shows the display status.

## 3F-G Leads
- **JRN-115** Lead reports
  - steps: Open all 10 Lead reports for This FY grouped by source, then by sales person.
  - expected: Funnel counts equal Lead register counts by status; Source performance conversion = bookings ÷ leads; Follow-ups due equals Home follow-ups due; Site visit conversion equals the existing figure; Lost leads list reasons from the lost-reason list.

## 3F-H Proof
- **JRN-116** Fifty reports, proven
  - steps: Run the tieout, phone sweep, perf budget (demo + volume) and export checks.
  - expected: 50 tieout lines pass; 50 × Night/Day × 1440/390 render with no horizontal scroll; every report within budget on kkt_volume; every Excel / PDF total equals its screen.
