# Phase 3J: Flat cost & booking price — one costing, set once in Masters, used at booking

Version: phase-3J. Feature: F-60, F-61, F-62 (see `../overview.md`, owner decisions 2026-11-20). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10 — this phase changes §5 rule 2 (Masters hub gains one master "Flat cost & parking") and the §3 "Flat pricing" / "Booking pricing snapshot" model for new bookings, by explicit owner instruction. Owner mockups (approved direction): Parking & flats `https://static.prod-images.emergentagent.com/jobs/90518795-f9b3-40f3-9c5d-e1eeb6a74f82/images/4add623614dec95bcc9239c4d2905e36de0399c45b5428a1c051ada4efba439a.jpeg`, Flat cost `https://static.prod-images.emergentagent.com/jobs/90518795-f9b3-40f3-9c5d-e1eeb6a74f82/images/982ad28cb7a80c54f87022c30041758bf1aa84eaf61efbb55f30cb6b165fcd95.jpeg`, Booking price v2 (after owner feedback) `https://static.prod-images.emergentagent.com/jobs/90518795-f9b3-40f3-9c5d-e1eeb6a74f82/images/400947817970ef1a42795087acabd975e87c04bbe4993aa11927ff67f2c2b402.jpeg`.

## Goal
Owner: "this is the most sensitive part". Two stages, never mixed: (1) **back office, in Masters** — every flat gets its parking attached and its full cost set (flat rate, parking, maintenance, other costs); only then is the flat "Ready for booking"; (2) **at booking** — the sales person picks customer → project → tower → floor → flat, and the flat's costing fills in by itself, locked; the only things the sales person may change are the discount (one place, just below the flat rate), the cash / in-account split, and the GST rates. The customer-facing side shows only the saleable area. Every amount is per sq ft of saleable area unless a clear rupee amount is typed.

## The money model (new bookings) — the single source of truth
All amounts in whole rupees (HANDOFF rule 8). "Per sq ft" always means × the flat's saleable area.
```
Flat value          = flat rate per sq ft × saleable area   (or a fixed ₹ amount; project rounding applies)   LOCKED at booking
Discount            = ₹ per sq ft × saleable area  ⇄  ₹ total                                                  EDITABLE (reason required if > 0)
Flat after discount = Flat value − Discount
Parking             = per sq ft × saleable area  or fixed ₹ (one line for all parking attached to the flat)    LOCKED
Flat + parking      = Flat after discount + Parking
Cash component      = typed ₹ (empty until typed; 0 allowed)                                                    EDITABLE
In account (RERA)   = Flat + parking − Cash component      (typing either one fills the other)                EDITABLE
GST on account      = In account × GST rate;  rate auto = 1 % if In account ≤ ₹45,00,000, else 5 %            RATE EDITABLE
Agreement value     = In account + GST on account
Package deal cost   = Agreement value + Cash component
Maintenance         = per sq ft × saleable area  or fixed ₹  (no months multiplier)                            LOCKED
Maintenance GST     = Maintenance × rate; rate auto 18 %                                                       RATE EDITABLE
Other costs         = Σ lines, each per sq ft × saleable area or fixed ₹                                       LOCKED
Other costs GST     = per line × rate; rate auto 18 %                                                          RATE EDITABLE (interpreted: same as maintenance)
Final cost          = Package deal cost + Maintenance + Maintenance GST + Other costs + Other costs GST
```
Worked example (owner's mockup): 1,250 sq ft × ₹4,500 = ₹56,25,000; discount ₹100/sq ft = ₹1,25,000 → ₹55,00,000; parking ₹3,00,000 → ₹58,00,000; cash ₹14,00,000 → account ₹44,00,000; GST 1 % = ₹44,000; agreement ₹44,44,000; package ₹58,44,000; maintenance ₹150/sq ft = ₹1,87,500 + GST 18 % ₹33,750; other costs ₹87,500 + GST 18 % ₹15,750; **final cost ₹61,68,500**.

## Functional requirements

### 3J-A Masters → "Flat cost & parking" (one master, two tabs)
- REQ-386 [always] The Masters hub shall have one master "Flat cost & parking" with two tabs, "Flat cost" and "Parking & flats"; it shall be the only place where a flat's cost and its parking are edited, and the project Pricing tab and the flat drawer shall show the same figures read-only with "Edit in Flat cost". (interpreted: one place, no two editors)
- REQ-387 [always] "Parking & flats" shall list flats (filter Project → Tower → Floor) with their saleable area and attached parking chips, and a "Free parking" list; a flat may have 0, 1 or many parking slots; a slot belongs to at most one flat.
- REQ-388 [event] When the user attaches or detaches a slot, the system shall save it immediately and show the flat's chips and the free list updated; a slot taken by another flat in the meantime shall be refused with "This parking was just attached to another flat".
- REQ-389 [always] "Flat cost" shall show for one flat: project · tower · floor · flat · type and its saleable area, then four sections in this order: 1 Flat rate, 2 Parking, 3 Maintenance, 4 Other costs, and a summary card (Flat, Parking, Maintenance, Other costs, Total) with "Save cost".
- REQ-390 [always] Every cost line (flat rate, parking, maintenance, each other cost) shall offer "Per sq ft" or "Fixed amount"; typing the per-sq-ft rate shall fill the total (× saleable area) and typing the total shall fill the rate (total ÷ saleable area, shown to 2 decimals); the mode the user typed in is the one stored.
- REQ-391 [always] Maintenance shall have no months multiplier; the old "per sq ft × months" method shall be retired and the line named "Maintenance". (interpreted from owner: "Future months … khatam, rename")
- REQ-392 [always] Other costs shall be lines picked from the existing charge-type master (Club, Legal, Development, Electricity & water, Other …), each with its per-sq-ft or fixed amount and its billing time (On booking / On possession / With a stage / By hand) taken from the charge type, with "+ Add other cost".
- REQ-393 [state] While a flat has no saleable area, the system shall disable per-sq-ft entry with "Add the saleable area first".
- REQ-394 [always] A flat shall be "Ready for booking" only when its saleable area > 0 and its flat value > 0 have been saved; the status shows on the Flat cost screen, the unit grid and the stacking plan.
- REQ-395 [always] "Apply to many flats" shall set the same cost lines on every selected flat (by tower, floor or flat type), recomputing per-sq-ft lines with each flat's own saleable area, after a preview of the flats and totals affected.
- REQ-396 [state] While a flat is Booked or Sold, its cost and parking shall be locked with "Booked — change the price through the booking's agreement revision" (HANDOFF rule 9).
- REQ-397 [always] Editing a flat's cost shall never change an existing booking (the booking keeps its own snapshot).
- REQ-398 [always] Only users with the pricing permission (Owner / Admin / Accounts by default) shall edit Flat cost and Parking & flats; Sales shall see them read-only.

### 3J-B Booking → step 1 "Who" and step 2 "Price & Plan" (3 steps kept, HANDOFF rule 4)
- REQ-399 [always] Step 1 shall ask, in this order: customer, then project → tower → floor → flat; only Available flats that are Ready for booking shall be selectable; others shall show why ("Cost not set", "On hold", "Booked").
- REQ-400 [always] After the flat is picked, the booking shall show only the saleable area as the flat's area (no carpet / built-up / other areas) on screen, on every customer-facing document and in the portal.
- REQ-401 [always] Step 2 "Price" shall fill in from the flat's cost: flat rate × saleable area and flat value (locked), parking with its slot chips (locked), maintenance (locked), other costs (locked), each with a lock icon.
- REQ-402 [always] The discount shall be one field just below the flat value, as ₹ per sq ft ⇄ ₹ total, applying to the flat value only, with the 3E discount reason required when the discount is > 0; it can't exceed the flat value.
- REQ-403 [always] "Cash and account" shall show Flat + parking, then Cash component (₹, empty until typed, 0 allowed) and In account (RERA) (₹); typing either fills the other so they always add up to Flat + parking.
- REQ-404 [always] GST on account shall be auto-set to 1 % when In account ≤ ₹45,00,000 and 5 % when above, recalculated live as the split changes, with the rate editable (0–28 %); once the user edits the rate, it stays as typed and shows "set by you · use auto".
- REQ-405 [always] Maintenance GST and each other cost's GST shall be auto-set to 18 % and editable (0–28 %), with the same "set by you · use auto".
- REQ-406 [always] Totals shall show, in this order: Agreement value (account + GST), Cash component, Package deal cost, Maintenance, Maintenance GST, Other costs, Other costs GST, Final cost — exactly the money model above.
- REQ-407 [unwanted] If Cash component is empty, or the split doesn't add up, then Next shall stay disabled with the reason shown under it.
- REQ-408 [always] The server shall recompute every figure from the flat's saved cost and the three editable inputs (discount, cash/account, GST rates) and refuse a booking whose locked lines differ from the flat's saved cost ("The flat's cost changed — review the price").
- REQ-409 [always] The booking shall store a complete price snapshot (every line, mode, rate, area, GST rate + source auto/set by you, and every total) so later flat-cost edits never move it.

### 3J-C Bills, payments and everything downstream
- REQ-410 [always] Plan instalments shall be raised per share: Cash bills = plan % × Cash component (no GST); Account bills = plan % × In account, with GST on account raised in the same proportion; parking is inside the split (no separate parking bill). Last line absorbs remainders (rule 8).
- REQ-411 [always] Maintenance + GST and other costs + GST shall be raised as their own bills at their billing time, always on the Account side, as today.
- REQ-412 [always] Auto allocation, outstanding, ageing, waivers, credit notes, receipts, refunds, cancellation (forfeit = other income), transfer and agreement revision shall work unchanged on the new snapshot; agreement revision shall use the same price card (discount, split, GST rates editable; locked lines locked).
- REQ-413 [always] Every surface that shows agreement / cash / account / GST / parking / charges (booking page, Customer 360, Bills raised, Roznamcha, Home, all 50 reports incl. Customer status, Bills vs Collection, Price list & unsold stock, Discount register, Cash vs Account, documents: cost sheet, booking form, allotment letter, demand letters, receipts, portal) shall use the money model's names and figures: "Agreement value" = account + GST everywhere.
- REQ-414 [always] Documents shall keep today's rule for which documents show the cash part, and show only the saleable area. (interpreted: no change to cash visibility rules)
- REQ-415 [always] Price list & unsold stock value shall show Flat value, Parking and Flat + parking per flat, and a "Cost not set" count.

### 3J-D Start fresh (owner: "all bookings so far are test — delete them")
- REQ-416 [always] On preview, all existing bookings and everything hanging off them (bills, receipts, allocations, ledger, waivers, credit notes, refunds, cancellations, transfers, booking documents, member numbers, parking allotments) shall be removed after a full backup; flats return to Available and parking to their flats / free; projects, towers, flats, parking slots, customers, leads, visits, masters, users and the activity log are kept.
- REQ-417 [always] The preview demo story shall be rebuilt on the new model: every demo flat costed through the Flat cost master, every demo booking made through the new price step, so every report, journey and tie-out has examples (cash-heavy split at 1 %, account > ₹45 lakh at 5 %, a GST rate set by hand, a flat with 0 parking, a flat with 2 parking, per-sq-ft and fixed lines, cancellations, a transfer, a waiver, cheques in hand).
- REQ-418 [always] Admin shall offer "Start fresh — remove all bookings" for production use by the Super Admin only: automatic backup first, typed confirmation "DELETE ALL BOOKINGS", shows counts before, keeps an activity-log entry; never runs by itself. (interpreted: owner runs it on billpe.com after publishing)
- REQ-419 [always] Old-model bookings that still exist on a database (production until Start fresh) shall open and report without errors, labelled "Old price model", read-only in price.

### 3J-E Proof
- REQ-420 [always] A pricing test table shall prove the money model to the rupee for ≥ 30 cases incl. the owner's examples (cash ₹60 lakh / account ₹40 lakh → 1 %; ₹50 lakh / ₹50 lakh → 5 %; account exactly ₹45,00,000 → 1 %; ₹45,00,001 → 5 %), every per-sq-ft ⇄ fixed pair, 0 / 1 / 2 parking, discount per sq ft and total, GST set by hand, rounding modes.
- REQ-421 [always] Booking create p95 shall stay ≤ 259 ms and all 3I gates (50/50 reports ≤ 300 ms, Home ≤ 200) shall hold; full suites 0 failed in both modes; tieout / connection matrix / integrity / db audit clean on the rebuilt demo, medium and volume (medium and volume rebuilt on the new model).

## Quality requirements
```
Q-59  Tag: Money.PriceModel
      Scale: cases where any booking figure differs from the money-model formula by ≥ ₹1
      Meter: pricing test table (≥ 30 cases) + every booking on preview / medium / volume recomputed from its snapshot
      Must: 0
      Plan: 0
Q-60  Tag: Money.OneSource
      Scale: surfaces (screens, reports, documents, portal) that show agreement / cash / account / GST / parking / charges differing from the booking snapshot
      Meter: tieout laws (new: Flat + parking = Cash + Account; Agreement = Account + GST; Package = Agreement + Cash; Final = Package + charges + their GST) + connection matrix
      Must: 0
      Plan: 0
Q-61  Tag: UX.LockedMeansLocked
      Scale: locked lines that can be changed at booking by any route (UI or API)
      Meter: Playwright + API tamper tests (send changed locked lines → refused)
      Must: 0
      Plan: 0
Q-62  Tag: Perf.BookingCreate
      Scale: p95 ms create booking, Elite shape
      Meter: tools/perf_budget.py
      Must: ≤ 259
      Plan: ≤ 230
Q-63  Tag: Ops.StartFresh
      Scale: kept records (projects, flats, parking, customers, leads, masters, users, activity log) lost by Start fresh
      Meter: counts before / after on a copy
      Must: 0
      Plan: 0
```

## Non-goals
TDS (Phase 6 — base for the new model decided there) · broker commission (Phase 7) · company scoping (Phase 4) · changing the payment-plan templates · changing allocation order · deleting anything except bookings and their dependent records.
