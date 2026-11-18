# Phase 3 action inventory: booking page, Customer 360, project page (Q-27)

"Before" lists every action, button, link and tab on the screens as they were at commit `92890c4`, including role-gated items, per-row actions and menus. "After" gives where each one lives after chunk 3-1. Lost = 0 is the gate.

## 3A Booking page (`pages/BookingDetail.jsx`)

| # | Before (where) | Gate | After (where) |
|---|---|---|---|
| B1 | Statement PDF (header button `statement-pdf-btn`) | — | More › Print / Share › Statement |
| B2 | Allotment PDF (header `allotment-pdf-btn`) | — | More › Print / Share › Allotment letter |
| B3 | Cost sheet PDF (header `cost-sheet-pdf-btn`) | — | More › Print / Share › Cost sheet |
| B4 | History (header HistoryButton) | — | Activity tab (history timeline) and the header History button (kept) |
| B5 | Mark agreement signed + mode select (header) | sales.booking.create, Active | More › Mark agreement signed (dialog with the same mode select) |
| B6 | Agreement signed pill (header) | signed | header pill (unchanged) |
| B7 | Transfer unit (header) | sales.booking.transfer, Active | More › Transfer |
| B8 | Post payment (header, primary) | finance.payment.create, Active | Main action "Record payment" (same PostPayment sheet) |
| B9 | Revise (header) | sales.agreement.revise, Active | More › Revise agreement |
| B10 | Handover / complete (header) | sales.booking.edit, Active | Overview › Unit card "Handover" button (same rule) |
| B11 | Cancel (header) | sales.booking.cancel, Active | More › Cancel |
| B12 | Context bar: Post payment link | finance.payment.create | Main action "Record payment" |
| B13 | Context bar: Raise manual demand | demands.register.create | Bills & Receipts tab toolbar |
| B14 | Context bar: Generate document | documents.document.generate | Documents tab toolbar |
| B15 | Context bar: Send reminder | messaging.message.send | Bills & Receipts tab toolbar |
| B16 | Context bar: Where this entry went | admin.audit.view | Activity tab toolbar |
| B17 | Context bar: Customer 360 | sales.customer.view | header customer-name link and Overview › Customer card |
| B18 | Context bar: Project Statement | reports.project_statement.view | Overview › Unit card link |
| B19 | "Connected to" details | — | Activity tab |
| B20 | Tab Overview | — | Overview tab |
| B21 | Tab Ledgers (three ledgers) | — | Ledger tab (three ledgers above the statement) |
| B22 | Tab Schedule | — | Bills & Receipts tab (schedule section) |
| B23 | Tab Statement (ledger table) | — | Ledger tab |
| B24 | Tab Demands + per-row print / PDF / history | — | Bills & Receipts › Bills (same per-row actions) |
| B25 | Tab Payments + per-row print, PDF, clear, bounce, reverse | perms as before | Bills & Receipts › Receipts (same per-row actions, plus "Where this entry went") |
| B26 | Tab Charges + per-row "Demand now" | sales.booking.edit | Bills & Receipts › Other charges (same) |
| B27 | Tab Refunds (+ pay refund) | finance.refund.pay | Bills & Receipts › Refunds and main action "Pay refund" when cancelled with a refund due |
| B28 | Tab Documents (upload / list) | sales.booking.edit | Documents tab |
| B29 | Tab Revisions | — | Activity tab (agreement revisions) |
| B30 | Tab History | — | Activity tab |
| B31 | Breadcrumb "Bookings" link | — | header breadcrumb (unchanged) |
| B32 | `?revise=1` deep link opens revision | sales.agreement.revise | unchanged |
| B33 | (new) Change plan | masters.payment_plan.assign | More › Change plan (dialog), disabled with the server's reason when not allowed |

## 3B Customer 360 (`pages/v2/Customer360.jsx`)

| # | Before | Gate | After |
|---|---|---|---|
| C1 | Context: New booking (primary) | sales.booking.create | Main action when the customer has no active booking, otherwise More › New booking |
| C2 | Context: Post payment | finance.payment.create | Main action "Record payment" (active booking pre-selected) |
| C3 | Context: Raise manual demand | demands.register.create | Money tab toolbar |
| C4 | Context: Generate document | documents.document.generate | Documents & KYC tab toolbar |
| C5 | Context: Add co-applicant | sales.customer.edit | More › Co-applicants (opens the co-applicants section) |
| C6 | Context: Add note | sales.customer.edit | Activity tab toolbar "Add note" |
| C7 | Context: Send reminder | messaging.message.send | Money tab toolbar |
| C8 | Include cancelled toggle | — | unchanged, above the tabs |
| C9 | Key strip tiles with spark drill links | — | unchanged |
| C10 | Tab Overview (+ pay from overview) | — | Overview |
| C11 | Tab Bookings | — | Bookings |
| C12 | Tab Ledger | — | Money › Ledger |
| C13 | Tab Demands | — | Money › Bills |
| C14 | Tab Receipts & Documents | — | Money › Receipts and Documents & KYC › Documents |
| C15 | Tab Construction | — | Bookings (construction progress per booking) |
| C16 | Tab Service | — | Activity › Service requests |
| C17 | Tab Timeline | — | Activity |
| C18 | Tab KYC & Profile (edit profile, reveal, KYC slots) | sales.customer.edit / customer.kyc_view | Documents & KYC; More › Edit opens the profile editor there |
| C19 | Tab Co-applicants | — | Documents & KYC › Co-applicants (More › Co-applicants jumps there) |
| C20 | Tab Notes | — | Activity › Notes |
| C21 | Keyboard 1–0,- tab shortcuts | — | keys 1–5 for the five tabs |
| C22 | Header actions (portal invite / communication / reveal etc.) | as before | unchanged header, and More › Statements per booking |

## 3C Project page (`pages/v2/ProjectWorkspace.jsx`)

| # | Before | Gate | After |
|---|---|---|---|
| P1 | Edit project (hero) | masters.project.edit | unchanged (hero) |
| P2 | New booking (hero) | sales.booking.create | unchanged (hero main action) |
| P3 | History (hero chip) | — | unchanged |
| P4 | Context: Structure | masters.project.view | Structure tab |
| P5 | Context: Plans | masters.stage_plan.view | Plans & Pricing tab |
| P6 | Context: Construction update | construction.stage.update | Construction tab "Open construction update" |
| P7 | Context: New booking | sales.booking.create | hero New booking |
| P8 | Context: New lead | sales.lead.create | Overview › Report links "New lead" |
| P9 | Context: Project Statement | reports.project_statement.view | Overview › report links |
| P10 | Tab Overview + Connected to | — | Overview |
| P11 | Tab Structure | — | Structure |
| P12 | Tab Plans | — | Plans & Pricing |
| P13 | Tab Pricing (pricing setup, rate cards, parking) | — | Plans & Pricing |
| P14 | Tab Inventory (flats table) | — | Inventory (floor × flat grid per tower and the same flats table below) |
| P15 | Tab Customers & Bookings | — | Overview › Customers & bookings section |
| P16 | Tab Collections | — | Overview › Collections section |
| P17 | Tab Reports (6 links) | — | Overview › Report links |
| P18 | Tower card links (to structure) | — | Overview tower cards (unchanged) |

**Before: 73 entries (B 33 incl. the new Change plan, C 22, P 18). After: all 73 reachable. Lost: 0.**
