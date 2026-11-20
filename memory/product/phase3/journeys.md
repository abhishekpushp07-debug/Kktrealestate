# Phase 3: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md` (admin@kkt.in, accounts@kkt.in, sales@kkt.in, siteengineer@kkt.in). Seed facts: `/app/memory/qa/phase1/demo_journeys.md`, found by role tag. Phase 1 and 2 journeys stay valid unless listed under `superseded`.

## 3A Booking page (F-13)
- **JRN-62** Booking page is calm
  - steps: Open the JRN-11 booking (story:ontime) as admin@kkt.in.
  - expected: Exactly 5 tabs (Overview · Bills & Receipts · Ledger · Documents · Activity); one main button "Record payment"; "More" holds Mark agreement signed, Revise agreement, Change plan, Transfer, Cancel, Print / Share cost sheet & letters; Overview shows price snapshot, Balance, next due bill and part-paid text.
- **JRN-63** Ledger law visible
  - steps: Open the Ledger tab.
  - expected: Rows in the words Bill raised / Received / Balance; the foot shows Σ Udhar − Σ Jama = outstanding − advance and it adds up.
- **JRN-64** Not-allowed actions explain themselves
  - steps: Open a booking with a paid instalment and open "More"; open a Cancelled booking (story:cancel).
  - expected: Change plan is disabled with the reason "an instalment is already paid"; the Cancelled booking shows VOID, its main action is "Pay refund" only if a refund is due, and other actions are disabled with reasons.
- **JRN-65** Record payment from the booking page
  - steps: Click "Record payment", post ₹10,000 Cash, then reverse it.
  - expected: The 5-field sheet opens with the booking pre-selected; after saving, the next-step prompt offers "Print / share receipt"; Balance, Bills & Receipts and Ledger update; the reversal restores every number.

## 3B Customer 360 (F-14)
- **JRN-66** Customer 360 is calm
  - steps: Open the customer of the JRN-11 booking; then a customer with no booking (create one if needed and leave it).
  - expected: Exactly 5 tabs (Overview · Bookings · Money · Documents & KYC · Activity); main action "Record payment" for the first and "New booking" for the second; "More" holds Edit, Co-applicants, Statements.
- **JRN-67** KYC masking unchanged
  - steps: Open Documents & KYC as sales@kkt.in.
  - expected: PAN / Aadhaar stay masked.

## 3C Project page (F-15)
- **JRN-68** Project page ≤ 5 tabs with a flat grid
  - steps: Open SGH.
  - expected: Tabs Overview · Structure · Inventory · Plans & Pricing · Construction; Inventory shows a floor × flat colour grid per tower whose counts equal the Inventory by tower widget; clicking a flat opens its drawer with price and status.

## 3D Restyle + simplify (F-16)
- **JRN-69** Flows unchanged, typing easier
  - steps: Start a booking on a free flat up to Confirm (then cancel out); open the payment sheet; type 123456 in an amount field; open the parking picker and search.
  - expected: Wizard still 3 steps; payment sheet still 5 fields; the amount shows ₹1,23,456 while typing; parking picker filters as you type.
- **JRN-70** No internal words
  - steps: Read booking, Customer 360, project, Bills raised, Roznamcha, Reports and Masters screens.
  - expected: No ids, snake_case keys, "paise" or "demand" visible; owner words used (Bill raised, Received, Balance, Saleable area, Roznamcha).

## 3E Master audit (F-43)
- **JRN-71** Every master earns its place
  - steps: Open `memory/qa/phase3/master_audit.md`, then Masters.
  - expected: Each of the 13 masters and every Advanced catalogue is listed as repeatable or one-off with its logic and where-used; every repeatable master shows "Used in N" and active / inactive; nothing one-off is left as a required master.
- **JRN-72** Save to master inline
  - steps: On an entry form with a free-text field backed by a master (e.g. a charge or lead source), type the same new value on 3 entries.
  - expected: On the 3rd, "Save to master" appears inline; clicking it adds the value to the master and selects it without leaving the form; the master shows it with "Used in 1+".
- **JRN-73** Master change affects new entries only
  - steps: Change a charge head's GST % (or default amount); create a new booking that uses it; open an older booking that used it.
  - expected: The new booking uses the new value; the older booking keeps its snapshot; the master edit screen said "affects new entries only". Restore the value afterwards.

## 3F Next step (F-17)
- **JRN-74** Every save says what's next
  - steps: Save a lead, a booking, a payment; complete a stage (on a tower with a billable pending stage, then undo); cancel a booking with a refund due.
  - expected: Prompts: "Book site visit"; "Record booking amount" + "Print allotment letter"; "Print / share receipt"; "N bills raised · Print demand letters"; "Pay refund". Each opens its flow with the record pre-selected and can be dismissed.

## 3G Reports hub (F-18)
- **JRN-75** Reports by journey
  - steps: Open Reports.
  - expected: Groups Sales, Money, Construction, Inventory, Admin in journey order; every report still exports JSON / CSV / PDF and drills down; Outstanding and Collections totals are unchanged.

## 3H Phone (F-19)
- **JRN-76** Every screen on a phone
  - steps: Sweep every route at 390 × 844 in Light and Night.
  - expected: No horizontal page scroll; tables become cards; the main action is reachable; no bottom tab bar.

## 3I Click-through (F-20)
- **JRN-77** Owner's 10-step story by clicking (builder-evidenced, re-runnable)
  - steps: Run the committed Playwright click-through.
  - expected: All 10 steps pass by filling the real forms; no residue on the demo; the log is saved in `memory/qa/phase3/clickthrough.md`.

## Builder-evidenced
- **JRN-78** Full `pytest -n 2` 0 failed; connection matrix green incl. the master-change action; tieout 100 %; integrity 0; chronology 0; action inventory before vs after shows 0 lost actions; ESLint 0/0; build ok; perf within budget (`memory/qa/perf/phase3_end.md`).

## 3L Design excellence (owner, 2026-11-17)
- **JRN-79** Beautiful project cards
  - steps: Open Projects in Light, then Night, at 1440 and 390 px.
  - expected: Each card has a cover (SGH towers, GGV villas, Ye planning default unless a photo was uploaded), status chip, name, location · RERA, inventory bar with counts "of N" equal to the project page, Collected / Outstanding / Next bill · stage equal to the project page and reports, tower pills with %; Ye says "No bookings yet · Start selling"; segments All / Under construction / Planning show correct counts.
- **JRN-80** Upload a project cover
  - steps: Edit project → upload a cover photo for Ye; open Projects and Ye's page.
  - expected: The photo shows on the card and the hero; removing it brings back the default.
- **JRN-81** Beautiful customer cards with segments
  - steps: Open Customers (default segment), then each segment.
  - expected: Default is Needs attention sorted by overdue ₹; each card shows flat chips, "Received ₹X of ₹Y billed", Balance ("Due ₹X" + "Overdue N days", "Advance ₹X" or "All clear" — never ₹0), Next line, RM + Call / WhatsApp / Record payment; segment counts add up to All; a card's Due equals that customer's Customer 360 Balance.
- **JRN-82** Booking cards show the plan
  - steps: Open Bookings and its segments.
  - expected: Each card has a plan bar with one segment per instalment coloured by status, "Stage k of n · next: <stage>", Balance per JRN-81; segment counts add up; Cancelled shows VOID.
- **JRN-83** Payment plan timeline on the booking page
  - steps: Open the JRN-11 booking Overview.
  - expected: One row per instalment in plan order with trigger, %, ₹, stage status and bill status matching Bills & Receipts and Construction; the money strip shows exactly Agreement, Billed, Received, Balance + Cash · Account · Other; no duplicate tiles and one Record payment button.
- **JRN-84** Calm, consistent design
  - steps: Look at Projects, Customers, Bookings, a booking, Customer 360 and a project page.
  - expected: Sidebar grouped (Overview, Sell, Money, Build, Records, Setup) in the locked order; labels in sentence case; ≤ 3 chips per card header; no bare ₹0; no score rings without meaning.

## 3M Consistency fixes
- **JRN-85** Cancel with an explicit 0 deduction
  - steps: On a test booking with a payment, cancel and type deduction 0; compare the preview refund with the saved refund; repeat with the deduction left blank.
  - expected: Typed 0 → saved refund equals the preview (full refund); blank → policy deduction, saved equals preview.
- **JRN-86** Stage undo voids its letters; preview shows GST
  - steps: Complete a billable stage (note the dialog total), then undo it.
  - expected: The dialog shows instalment + GST share = total, equal to the bills raised; after undo, the auto-generated bill letters of those bills show VOID.

## 3N / 3O KKT Elite design + project photos
- **JRN-87** The app looks like the approved reference
  - steps: Open login, Home, Customers, Projects, a customer page and Reports → Outstanding & ageing in Night (default), then switch to Day; compare with `/design/elite.html`.
  - expected: Figtree only (no serif); grey spaced section caps; bold lowercase page titles; one Elite hero per screen (dark in Day too); sapphire for interaction, gold only on member card № / banner caps / diamond ornament; coral Due, orange "OVERDUE N DAYS", mint Advance; pill money buttons with amounts; the switch offers exactly Night / Day and a new user starts in Night.
- **JRN-88** Report sheet explains its total
  - steps: Open Outstanding & ageing and Collections.
  - expected: Header sheet with From / To and filters; GRAND TOTAL with the formula in words whose numbers add up exactly to the totals; table; legend line; PDF / Excel still export.
- **JRN-89** Add project photos while creating a project
  - steps: Create a project named "QA test Photos" and add 3 photos; choose the 2nd as cover; reorder; remove one; try a 20 MB file and a PDF.
  - expected: Cover shows on the banner and hero; gallery on Overview; the big file and the PDF are refused with "Photo must be an image under 15 MB"; delete the test project afterwards via the test purge.
- **JRN-90** Member card front and back
  - steps: Open the JRN-11 customer; look at the card; tap it; tap again.
  - expected: Front shows KKT logo, diamond, project in spaced caps, sapphire rule + tower · flat, homeowner since, name, № NNN / M (M = project units); the back shows the booking bullets, a scannable RERA QR (or the "RERA no. not added" frame) and the company line; tapping again returns to the front; numbers never change between refreshes of the page.

## 3Q Home rework (interpreted)
- **JRN-93** Home is a silver hero + widgets (interpreted)
  - steps: As admin@kkt.in open Home in Night; look at the hero against the page; scroll; tap the Call today widget, then Outstanding, then Ready to bill; switch to Day; open Home at 390 px; log out and log in as the Sales user; as owner use Customize to hide one widget and move another, log out and back in.
  - expected: The hero shows a silver sheen fading from its top-left with a silver edge and clearly stands apart from the background (still dark metal in Day); below it there are only widgets (no lists) in groups Money · Today's work · Sales & stock · Construction with counts equal to their widgets; each widget has icon, tag, big figure, label, caption; Call today opens the customer list with call / WhatsApp, Ready to bill opens the towers with Raise; every opened list totals exactly the widget figure; 4 per row on desktop, 2 per row at 390 px with no horizontal scroll; Sales sees only its role widgets; the Customize change survives re-login; coral appears only on overdue figures.
  - superseded: [the Home-list part of JRN-87]

## 3R Other-charge ageing (owner decision 2026-11-18)
- **JRN-94** Each charge part ages from its own bill date
  - steps: Open Shalini Thakur (GGV V6) → booking → Bills & Receipts; open Outstanding & Ageing and find her row; open her customer card; on a private copy, complete a stage on a tower with a live booking and check the new GST part; move the clock past its days-to-pay by one India day.
  - expected: Her GST parts each show their own bill date and due date; her overdue days count from the oldest unpaid part's due date (not her booking date); the new GST part shows Not due until its due date and enters 0–30 the next India day; the card, customer page, booking page, Home and Outstanding all show the same overdue ₹ and days; no amount or balance changed.
- **JRN-95** Overdue looks real
  - steps: After a demo refresh, open Customers (all segments), Home (Money widgets) and Outstanding & Ageing.
  - expected: "on track" is no longer empty; overdue customers are a realistic minority with customers in every ageing band; other charges show payments received (Collections shows other-charge receipts); chip partition = All; card overdue total = ageing overdue total = Home overdue; two refreshes for the same as-of date give identical figures.

## 3P Reports hub, lists, forms (interpreted)
- **JRN-91** Reports hub reads at a glance (interpreted)
  - steps: Open Reports in Night, then in Day; tap the Outstanding tile; go back; tap the Collections tile.
  - expected: Groups in order Sales → Money → Construction → Inventory → Admin, each with spaced caps + report count equal to its tiles; every tile has one line icon, a live figure, the name and "tap for details"; the Outstanding tile figure equals the Outstanding & ageing GRAND TOTAL exactly and the Collections tile equals the Collections total for the period shown in the header; every tile has the same surface (no tinted / gradient / pastel tile); only coral / mint figures carry colour; tapping opens that report.
- **JRN-92** Lists and forms feel like one product (interpreted)
  - steps: Open Customers, Bookings, Leads and Payments; filter Bookings to a status with no rows; open New booking and Record payment.
  - expected: Same header pattern on every list (title + summary, one primary action, ≤ 4 figures, filters, tabs with counts that add up to the total); the empty filter shows a next-step empty state, not a blank table; New booking is still exactly 3 steps with titled section cards and live amounts; Record payment still has exactly 5 fields; action inventory shows 0 lost actions.
