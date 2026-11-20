# Phase 3E: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md` (admin@kkt.in = owner / Super Admin, accounts@kkt.in, sales@kkt.in, siteengineer@kkt.in). Records created by testers start with "QA ". Never edit the owner project "Ye". Phase 1–3 journeys stay valid unless listed under `superseded`.

## 3E-A / 3E-B Entry completion
- **JRN-96** Every form is checked before Save
  - steps: Open Record payment, choose a non-cash mode and leave Bank account empty; choose a cheque mode with no reference; open New customer and type a PAN already used; open the booking wizard and stop on a step with a missing field; open Roznamcha contra with no amount.
  - expected: Save is blocked with a plain message on the form (no server error toast); the PAN warning offers "open this profile"; every greyed-out button says why (tooltip on desktop, line under it at 390 px).
- **JRN-97** No browser controls left
  - steps: Visit every entry screen and filter (booking wizard, change plan, transfer, refund, cancellation, construction, photos, customer form, documents, service requests, masters, plan forms, Home project filter, report filters) at 1440 and 390 in Night and Day.
  - expected: Every dropdown and date is the Elite control; the automated scan reports 0 browser selects / date inputs.
- **JRN-98** Booking actions are complete
  - steps: On a QA booking: Mark agreement signed with a past date; Change plan (where allowed) typing a reason; restore a voided manual bill with a reason.
  - expected: The signed date shows as chosen (future and before-booking dates refused); the plan change shows the typed reason in Activity; the bill is back with an audit row.
- **JRN-99** Customers can be kept clean
  - steps: Try to deactivate a customer with a live booking; deactivate one with none and reactivate; as admin merge two "QA " duplicate customers.
  - expected: The first is blocked with the reason; the second hides from active lists and comes back; after merge every booking, payment, document and lead is under the survivor, the old record opens read-only pointing to the survivor, and tieout totals are unchanged.
- **JRN-100** Leads, visits, front desk
  - steps: Edit a QA lead; complete a visit choosing an outcome; create a service request from the front desk, reply, close; set Monday slots and a holiday for a project and book a visit on the website and in the ERP.
  - expected: The lead edit saves; the outcome shows on the visit and in the conversion report; the request shows its thread and closes; the holiday and full slots cannot be booked.
- **JRN-101** Roznamcha mistakes are undone, never edited
  - steps: Post a QA contra deposit, undo it with a reason, post the correct one.
  - expected: Day book shows the original, its reversing entry and the new one; opening + in − out = closing stays exact.

## 3E-C Discount given
- **JRN-102** Discount recorded at booking
  - steps: In the booking wizard pick a priced flat, type an agreed total below the list price, try to save without a reason, then pick a reason and save.
  - expected: List price, agreed total and "discount ₹Y (Z%)" update live; Save is blocked until a reason is chosen; the booking overview shows "List ₹X · discount ₹Y (Z%) · reason"; agreement value, shares, bills and GST equal a booking made at that agreed price with no discount feature; the Discount register and the Home widget include it.
- **JRN-103** Discount on revision
  - steps: Revise a QA booking's agreement down by ₹1 L with a reason, then another up by ₹50,000.
  - expected: The register shows "discount on revision ₹1 L" and "price increase ₹50,000" with reasons; the money effects are exactly the existing Revise agreement effects.

## 3E-D Waiver with owner approval
- **JRN-104** Waiver goes through approval
  - steps: As accounts@kkt.in give a waiver on the Account share of an open bill of a QA booking; check the bill and ledger; as accounts try to approve it; as admin@kkt.in approve it; open the credit-note PDF.
  - expected: While pending, no balance changes and the bill says "waiver ₹X pending approval"; accounts cannot approve their own; after approval the ledger has a Jama "Waiver · CN-FY-NNNN" for the amount plus the matching GST part; the bill's open amount, Outstanding, the customer card, Home overdue and the Bills vs Collection bridge all fall by the same amount; Roznamcha and Collections are unchanged; the PDF shows taxable + GST, reason, requester, approver and the GST-adjustable-until date.
- **JRN-105** Reject, cancel and limits
  - steps: Reject a pending waiver with a reason; cancel an approved one; try to waive more than the open amount; try on a fully paid bill and on a cancelled booking; record a payment after an approved waiver.
  - expected: Reject changes no money and notifies the requester; cancel posts exact reverse entries and keeps the CN number marked Cancelled; the limits are blocked with reasons; the payment settles the reduced bill oldest-first; Σ Udhar − Σ Jama = outstanding − advance throughout; the Waiver register shows every state.
