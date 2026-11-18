# Phase 3E: Entry completion — every entry verified, complete and elegant · Discount given · Waiver with owner approval

Version: phase-3E. Features: F-45, F-46, F-47 (see `../overview.md`). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10 and the money rules in `../overview.md`. Gates: `../ALL_PHASES_TODO.md` "Gates". Tracker for every gap: `../ENTRY_TODO.md` (A owner decisions, B missing screens/buttons, C Elite polish). Builds on Phase 3: Elite design system, connection matrix (598 cells), tieout, phone sweep, click-through, §3R per-part ageing (`definitions.oc_parts`, `due_on`, `bill_day`).

## Goal
Every entry a builder's team makes — masters, project setup, customers, leads, visits, bookings, payments, construction, documents, settings — can be done fully from the screens, is checked before it is saved, explains every greyed-out button, says what to do next, and looks Elite. Two new money entries the owner asked for: **Discount given** is recorded at booking (and on price revision) and shown in reports, and a **Waiver** on a bill goes through owner approval, posts a numbered credit note, and shows everywhere the money shows.

Owner decisions 2026-11-18: waiver — yes, with reason and owner approval, shown in ledger and reports · late-payment interest — **no, not now** · discount at booking — record as "discount given" and show in reports · site expenses / purchases / challans / daily kharch — **not in this ERP now** · order — finish entry completely, then the reports round. Owner: "world's best real estate ERP … powerful, elegant … do not rush, plan the best."

Unchanged (locked): booking, payment, oldest-first allocation, Cash / Account / Other shares, staging, plan, pricing, GST-with-stages billing, ledger, cancellation refund calculation (system-controlled; zero refund = forfeited), transfer, receipt / booking numbering, append-only money entries. The only new money effect in this phase is an **approved waiver**. Discount given is a record and changes no money.

## Functional requirements

### 3E-A Verified entry audit (first, before any code)
- REQ-214 [always] Before changing code, the builder shall read every entry form end to end and confirm, correct or add to every item in `ENTRY_TODO.md` (B, C and ✱ items) with path:line evidence, and send the verified list to the orchestrator; `ENTRY_TODO.md` stays the single tracker.
- REQ-215 [always] Every entry form shall: show the fields the server accepts that a user needs; check every server rule on the form and block Save with a plain message before the server would reject it; use Elite dropdowns and the Elite date picker; group fields in titled section cards; show a next-step prompt after save; offer edit and deactivate where the record may change; work at 390 px.
- REQ-216 [unwanted] If a button is disabled, then it shall say why (tooltip on desktop, a line under it on phones).
- REQ-217 [always] No browser `<select>`, `type="date"` or `type="datetime-local"` shall remain in the active UI (including the Home project filter and phone report filters, D-23); an automated scan in the gates shall fail on any new one.

### 3E-B Missing screens and buttons (no money-logic change)
- REQ-218 [event] When "Mark agreement signed" is used, the system shall ask for the signing date (Elite date picker, default today, not in the future, not before the booking date) and store it as `signed_on`.
- REQ-219 [event] When "Change plan" is used, the user shall type the reason (at least 3 characters), chosen with an Elite dropdown for the plan.
- REQ-220 [event] When a customer is deactivated, the system shall block it with the reason while the customer has a live booking, keep history read-only, and allow reactivation.
- REQ-221 [event] When a Super Admin merges two customer records, the system shall move every booking, payment, document, lead, visit, service request and note to the surviving customer, keep the merged record read-only pointing to the survivor, write an audit row, and change no money total (tieout before = after).
- REQ-222 [always] The customer form shall warn live about an existing PAN (like phone), with "open this profile".
- REQ-223 [always] Leads shall be editable from the screen; completing a site visit shall capture its outcome from the Visit outcome list.
- REQ-224 [event] When front-desk staff create a service request for a customer / booking, the system shall save it with category, priority and assignee; staff shall be able to reply on a request and close it.
- REQ-225 [event] When a voided manual bill is restored ("Un-void"), the system shall require a reason and permission and write an audit row.
- REQ-226 [always] Project visit slots shall be set per weekday (start, end, slot length, capacity) with holidays picked as dates; the website and ERP visit booking shall respect them.
- REQ-227 [event] When a Roznamcha contra (deposit / withdrawal) or opening entry is wrong, the user shall undo it with a reason, which posts a reversing entry, and then post the correct one; nothing is edited in place.
- REQ-228 [always] Record payment shall block Save with a plain message when a non-cash mode has no bank account or a mode that needs a reference has none.
- REQ-229 [always] Settings shall label days-to-pay as "Days to pay after the bill date".
- REQ-230 [always] The booking wizard shall record the sales person (default: the signed-in user) and the lead it came from (pre-filled when converted from a lead).
- REQ-231 [always] Stage completion shall offer "Show this update to customers".
- REQ-232 [always] Refund payment modes shall come from the Payment Modes master.
- REQ-233 [always] Every repeatable value typed on a form (found in the audit) shall offer "Save to master" on its 3rd use, using the shared `TypedMasterInput`.
- REQ-234 [always] Quick create shall use the new plan forms; the legacy plan forms are retired.

### 3E-C Discount given (F-46)
- REQ-235 [always] The booking wizard shall show the chosen flat's **list price** from the existing pricing (rate card / flat price, PLC, chosen parking and charges as priced today), the **agreed total** (Cash + Account), and **Discount given = list − agreed** in ₹ and %, live as the user types.
- REQ-236 [event] When the discount is above ₹0, the user shall pick or type a reason (Discount reasons list, typed allowed, Save to master) before Save.
- REQ-237 [always] The booking shall store a discount snapshot: list price breakdown, agreed total, amount, %, reason, sales person, recorded by, date; it is never recomputed when prices change later.
- REQ-238 [event] When "Revise agreement" lowers the price, the system shall record a "discount on revision" with its reason; when it raises the price, a "price increase".
- REQ-239 [always] Discount given shall change no money: agreement value, shares, bills, GST and receipts stay exactly as today.
- REQ-240 [always] Discount given shall show on the booking page overview ("List ₹X · discount ₹Y (Z%) · reason"), in a **Discount register** report (Sales group: by booking, sales person, project, month; formula "list − agreed = discount"), and as a Home Sales & stock widget "discount given · this month".
- REQ-241 [unwanted] If the list price cannot be worked out (flat without a price), then the wizard shall say "List price not set — discount not recorded" and the booking still saves.
- REQ-242 [always] Existing bookings shall show "discount not recorded" unless a stored price snapshot allows an exact back-fill (audited, idempotent, no money change).

### 3E-D Waiver with owner approval (F-47)
- REQ-243 [event] When a user with the "Request waiver" right chooses "Give waiver" on an open bill (instalment bill or other-charge part), the system shall take the share (Cash / Account / Other charge — only shares with an open amount), the amount (≤ that share's open amount on that bill), a reason (Waiver reasons list, typed allowed, Save to master) and a note, and save it as **pending approval** numbered WV-FY-NNNN.
- REQ-244 [state] While a waiver is pending, no balance shall change; the bill shows "waiver ₹X pending approval".
- REQ-245 [event] When a user with the "Approve waiver" right (the owner by default) approves it, the system shall post a credit entry (Jama) "Waiver · CN-FY-NNNN" against that bill and share on the approval date; the bill's open amount falls by that amount and later payments settle bills oldest-first as today.
- REQ-246 [event] When the approver rejects it, the system shall record the reason, notify the requester, and change no money.
- REQ-247 [always] The requester shall not approve their own waiver; a Super Admin owner's own waiver is approved on save and audited as self-approved.
- REQ-248 [always] GST: a waiver on the Account share shall also reduce that bill's GST-on-agreement part at the booking's GST rate (5 % today); a waiver on an other charge that carries GST shall reduce its GST in proportion; the credit note shows taxable value + GST; a Cash-share waiver carries no GST. (interpreted)
- REQ-249 [always] The credit note shall show whether its GST can still be adjusted in returns (Section 34: until 30 Nov after the end of the FY of the original bill) or is "commercial only". (interpreted)
- REQ-250 [always] Credit-note numbers shall run in sequence per FY and never be reused; a cancelled waiver keeps its number marked Cancelled.
- REQ-251 [event] When the owner cancels an approved waiver with a reason, the system shall post the exact reverse entries.
- REQ-252 [unwanted] If the bill is fully paid, the booking is cancelled, or the amount exceeds the open amount, then "Give waiver" shall be disabled or blocked with the reason.
- REQ-253 [always] An approved waiver shall show in: booking ledger (Jama "Waiver"), Bills & Receipts (bill shows "waived ₹X"), customer page and statement, Outstanding & Ageing (reduces), Bills vs Collection bridge ("− waived"), carried-from-before ("billed − received − waived"), Cash / Account split, a **Waiver register** report (Money group: pending / approved / rejected / cancelled), Home "Needs attention · waivers to approve", and a notification to the approver; never in Roznamcha or Collections (no money was received).
- REQ-254 [always] The ledger law shall hold with waivers: Σ Udhar − Σ Jama (receipts + waivers) = outstanding − advance, in tieout and the connection matrix.
- REQ-255 [always] The refund on cancellation shall be worked out on money actually received (a waiver is never refunded); for transfer, the builder shall report how approved waivers move under the locked transfer rule before building it, and stop to ask if it is not clear.
- REQ-256 [always] Each approved waiver shall have a credit-note PDF on the letterhead: customer, booking, bill, share, taxable, GST, total, reason, requested by, approved by, dates.

### 3E-E Demo and proof
- REQ-257 [always] The demo story shall include, through the real API and repeatable per as-of date: bookings with discounts (several reasons, one discount on revision, one price increase) and waivers approved (Cash, Account with GST, other charge), pending, rejected and cancelled.
- REQ-258 [always] The connection matrix, tieout, phone sweep, click-through and perf budget shall cover discount recording and waiver request / approve / reject / cancel.

## Non-goals (this phase)
Late-payment interest · site expenses, purchases, challans, daily kharch · TDS (Phase 6) · Tally export (Phase 6) · channel-partner commission (Phase 7) · company scoping (Phase 4) · discount approval limits (not asked).
