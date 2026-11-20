# Phase 3J: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md`. Example flat: 1,250 sq ft saleable. Money in whole ₹.

## 3J-A Masters → Flat cost & parking
- **JRN-199** Attach parking to flats
  - steps: As admin open Masters → Flat cost & parking → Parking & flats; filter a tower; attach a free slot to a flat with none; attach a second slot to the same flat; detach one.
  - expected: Chips update at once; the free list shrinks / grows; a flat shows "No parking" when none; the same slot can't be attached to two flats (second attempt: "This parking was just attached to another flat").
- **JRN-200** Set a flat's cost per sq ft
  - steps: Open Flat cost for the flat; type flat rate ₹4,500 per sq ft; parking Fixed ₹3,00,000; maintenance ₹150 per sq ft; other costs Club ₹50 per sq ft and Legal Fixed ₹25,000; Save cost.
  - expected: Flat ₹56,25,000; parking ₹3,00,000; maintenance ₹1,87,500; other costs ₹87,500; total ₹62,00,000; status "Ready for booking".
- **JRN-201** Type the total, the rate fills in
  - steps: In maintenance type the total ₹3,00,000 instead of the rate.
  - expected: Rate shows ₹240.00 per sq ft; saved as a fixed amount; reopening shows ₹3,00,000 as typed.
- **JRN-202** Parking per sq ft
  - steps: Set parking to Per sq ft ₹200.
  - expected: Parking ₹2,50,000 (× 1,250 saleable).
- **JRN-203** No area, no per-sq-ft
  - steps: Open a flat without saleable area.
  - expected: Per-sq-ft entry disabled with "Add the saleable area first"; flat not Ready for booking.
- **JRN-204** Apply to many flats
  - steps: Select a tower's floors 2–5, apply rate ₹4,600 per sq ft + maintenance ₹150 per sq ft; review preview; confirm.
  - expected: Preview lists each flat with its own area-based totals; after confirm each flat's cost equals its own area × rate.
- **JRN-205** Booked flat is locked
  - steps: Open Flat cost for a booked flat; try to edit (UI and API).
  - expected: Fields locked with "Booked — change the price through the booking's agreement revision"; API refused.
- **JRN-206** One place to edit
  - steps: Open the project Pricing tab and the flat drawer for the same flat.
  - expected: Same figures, read-only, with "Edit in Flat cost" opening the master; Sales sees Flat cost read-only.

- **JRN-228** Apply to many skips booked flats (interpreted)
  - steps: In Apply to many flats, select a floor that has 1 booked flat and 3 available flats; apply a new rate; confirm.
  - expected: Preview and result say "1 booked flats skipped" (or "1 booked flat skipped"); the booked flat's cost and its booking are unchanged; the 3 others take the new rate.

## 3J-B Booking
- **JRN-207** Only ready flats can be picked
  - steps: As sales, New booking → pick customer → project → tower → floor.
  - expected: Ready Available flats are selectable; uncosted flats show "Cost not set", held / booked flats show their reason.
- **JRN-208** Price fills in and is locked
  - steps: Pick the JRN-200 flat; go to Price.
  - expected: Saleable area 1,250 sq ft (no other area shown); flat rate ₹4,500 × 1,250 = ₹56,25,000, parking ₹3,00,000, maintenance ₹1,87,500, other costs ₹87,500 — all with lock icons, not editable.
- **JRN-209** Owner's example, 1 %
  - steps: Discount ₹100 per sq ft with reason; cash ₹14,00,000.
  - expected: Discount ₹1,25,000; flat after discount ₹55,00,000; flat + parking ₹58,00,000; in account ₹44,00,000; GST 1 % ₹44,000; agreement value ₹44,44,000; package ₹58,44,000; maintenance GST 18 % ₹33,750; other costs GST 18 % ₹15,750; final cost ₹61,68,500.
- **JRN-210** Above ₹45 lakh, 5 %
  - steps: Change cash to ₹8,00,000.
  - expected: In account ₹50,00,000; GST switches to 5 % = ₹2,50,000; agreement ₹52,50,000; package ₹60,50,000; final recalculated.
- **JRN-211** Threshold edge
  - steps: Set in account to exactly ₹45,00,000, then ₹45,00,001.
  - expected: 1 % at ₹45,00,000; 5 % at ₹45,00,001.
- **JRN-212** Typing account fills cash
  - steps: Type in account ₹40,00,000.
  - expected: Cash fills ₹18,00,000; they always add up to flat + parking.
- **JRN-213** GST rate set by hand
  - steps: Change GST on account to 5 % while in account is ₹44,00,000; then change the split; then tap "use auto".
  - expected: Stays 5 % with "set by you" through split changes; "use auto" returns to the threshold rule; maintenance / other GST edits behave the same.
- **JRN-214** Discount rules
  - steps: Type a discount total, then switch to per sq ft; try a discount above the flat value; try a discount without reason.
  - expected: Per sq ft = total ÷ 1,250; above flat value refused; Next disabled with "Pick the discount reason".
- **JRN-215** Cash empty → can't continue
  - steps: Leave cash empty.
  - expected: Next disabled with "Type the cash component (0 is allowed)".
- **JRN-229** Account can't be zero (interpreted)
  - steps: Type cash equal to the whole Flat + parking (in account becomes ₹0); then send the same booking straight to the API.
  - expected: Next disabled with "In account can't be ₹0 — the agreement needs a value"; the API refuses it; no booking created.
- **JRN-216** Tamper refused
  - steps: Send POST /api/bookings with a changed flat value, parking, maintenance or other cost.
  - expected: Refused ("The flat's cost changed — review the price"); no booking created.
- **JRN-217** Booking saved = snapshot
  - steps: Confirm the JRN-209 booking; then change the flat's cost in Masters (on another flat) and reopen the booking.
  - expected: Booking page, Customer 360 and cost sheet PDF show exactly the JRN-209 figures; Masters edits never move them.

## 3J-C Bills and everything downstream
- **JRN-218** Bills per share
  - steps: On the JRN-209 booking with a plan (e.g. 10 % on booking), open Bills raised.
  - expected: Cash bill 10 % × ₹14,00,000 = ₹1,40,000 (no GST); Account bill 10 % × ₹44,00,000 = ₹4,40,000 + GST ₹4,400; no separate parking bill; maintenance + GST at its billing time.
- **JRN-219** Payments and outstanding
  - steps: Post a cash and an account receipt; open Outstanding, Customer status, booking page.
  - expected: Allocation oldest-first as today; outstanding per share correct; Customer status agreement value ₹44,44,000 and cash component ₹14,00,000.
- **JRN-220** Revision uses the same card
  - steps: Open Agreement revision on the booking; change the discount and the split.
  - expected: Same price card; locked lines locked; new figures follow the money model; bills re-based as today.
- **JRN-221** Cancel, transfer, waiver unchanged
  - steps: Run the story's cancel → refund, a transfer and a waiver on new-model bookings.
  - expected: Same behaviour and tie-outs as before 3J.
- **JRN-222** Reports and documents speak the new model
  - steps: Open Customer status, Bills vs Collection, Price list & unsold stock, Discount register, Cash vs Account; download cost sheet, booking form, allotment letter, demand letter, receipt.
  - expected: Agreement value = account + GST everywhere; price list shows Flat value / Parking / Flat + parking and "Cost not set" count; documents show only saleable area; cash shown only where it was before.

## 3J-D Start fresh
- **JRN-223** Preview starts fresh
  - steps: After the purge, open Bookings, Payments, Home, Reports.
  - expected: Only new-model demo bookings exist; projects, flats, parking, customers, leads, masters, users and activity log counts unchanged; a backup exists from just before.
- **JRN-224** Start fresh on a copy (production tool)
  - steps: As Super Admin on a throw-away copy, Admin → Start fresh; read the counts; type the confirmation.
  - expected: Backup made first; all bookings and their records removed; kept records unchanged; an activity-log entry; a second user without Super Admin can't see the action.
- **JRN-225** Old-model booking still opens
  - steps: On a copy with an old-model booking, open it and the reports.
  - expected: No errors; labelled "Old price model"; price read-only.

## 3J-E Proof
- **JRN-226** Pricing table
  - steps: Run the pricing test table.
  - expected: ≥ 30 cases, 0 differences.
- **JRN-227** Gates hold
  - steps: Run full suites (both modes), tieout, matrix, integrity, db audit on the rebuilt demo / medium / volume; Elite perf.
  - expected: 0 failed; new tie-out laws pass; booking create p95 ≤ 259 ms; 50/50 reports ≤ 300 ms; Home ≤ 200 ms.
