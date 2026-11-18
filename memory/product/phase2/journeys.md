# Phase 2: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md` (admin@kkt.in Owner / Super Admin, sales@kkt.in Sales, plus the Accounts and Site engineer users listed there). Seed facts: `/app/memory/qa/phase1/demo_journeys.md`; numbers change on every refresh, so find records by role tag. Business day = India calendar day. Phase 1 journeys stay valid unless listed under `superseded`.

## 2A Connection proof (F-42)
- **JRN-39** The connection matrix is green
  - steps: Run `tools/connection_matrix.py` on the preview DB (builder-evidenced), then open `memory/qa/phase2/connection_matrix.md`.
  - expected: Every action in REQ-68 × every surface in REQ-69 that it touches is green; 0 red cells; the file lists, per action, the before/after value on each surface.
- **JRN-40** One payment, every screen agrees
  - steps: Note the JRN-11 booking's Balance, Customer 360 balance, Home Money today, Collections (today), Roznamcha (today) and the tower's collected figure. Post a Cash payment through the screens, then open each place again within 5 s.
  - expected: Each moves by exactly the receipt amount (Balance down, received up); the receipt PDF "Applied to" table matches the booking's Bills tab; "Where this entry went" lists every one of those places.
- **JRN-41** Stage complete, every screen agrees
  - steps: On a tower with a pending stage, note the Next billing milestone widget, the stage-complete preview, Bills raised count and Demand register total; complete the stage.
  - expected: Bills raised gains exactly the previewed number of bills with the previewed ₹ total; Demand register, booking Bills tabs and Customer 360 show them; Next billing milestone moves to the following stage; undoing the stage (nothing paid) restores every number.
- **JRN-42** Cancel → refund, every screen agrees
  - steps: Cancel a booking with something refundable and pay the refund.
  - expected: Booking shows Cancelled; the flat becomes Available on Inventory, the Flat status widget and the tower counters; Cancellations & refunds lists it with the system-calculated refund; the refund appears in Roznamcha on that day; Outstanding drops by that booking's balance; letters show VOID.

## 2B Calm Light + Night mode (F-9)
- **JRN-43** Light / Night switch, remembered
  - steps: As admin@kkt.in open the theme switch; choose Night; log out; log in again from a fresh browser.
  - expected: The switch shows exactly "Light" and "Night"; the app opens in Night with no white flash; numbers and layout widths are identical to Light (screenshot diff only in colours).
- **JRN-44** Both themes are readable
  - steps: Open Home, a booking, Customer 360, Reports → Outstanding & ageing and Masters in Light, then in Night.
  - expected: The automated contrast check reports 0 AA failures in both themes; chart axes, legends and tooltips are readable; Due shows red and Advance green in both.
- **JRN-45** Theme save fails gracefully
  - steps: Switch theme while the profile save is blocked (builder-evidenced test or network block).
  - expected: The theme still changes for the session and the message "Theme not saved — will retry" appears; no data changes.

## 2C New shell (F-10)
- **JRN-46** Sidebar has the 9 areas and remembers its state
  - steps: As admin@kkt.in look at the sidebar; collapse it; reload. Then log in as sales@kkt.in.
  - expected: Order is Home · Projects · Customers · Bookings · Payments (Received · Bills raised · Roznamcha) · Construction · Documents · Reports · Masters · Admin; it stays collapsed after reload; Sales does not see Admin (or areas their role lacks).
- **JRN-47** ⌘K search finds anything fast
  - steps: Press Ctrl/⌘ + K; search a customer name from the demo, then a phone number, a BK number, a KKT receipt number and a flat number (e.g. "C-1604"); use arrow keys + Enter.
  - expected: Results appear grouped (Customers / Bookings / Flats / Receipts) within 400 ms on screen; Enter opens the selected record; a nonsense query shows "No match for '<text>'" with "New customer" and "New lead".
- **JRN-48** New menu opens the unchanged flows
  - steps: Open "New" and pick each entry.
  - expected: Exactly Booking, Payment, Lead, Customer, Site visit; Booking opens the 3-step wizard (Who → Price & Plan → Confirm); Payment opens the 5-field sheet; nothing else changed in those flows.
- **JRN-49** Never a blank screen
  - steps: Click through every sidebar area on a throttled network (Fast 3G).
  - expected: A skeleton shows on every route until content arrives; no blank page; no console errors; route change to content ≤ 300 ms warm.
- **JRN-50** Phone width
  - steps: Open Home and the shell at 390 × 844 in Light and Night.
  - expected: No horizontal page scroll; the sidebar becomes a menu button; the top bar stays usable.

## 2D Home Command Center (F-11, F-12)
- **JRN-51** Owner sees all 11 widgets with real numbers
  - steps: As admin@kkt.in open Home (period This month, all projects).
  - expected: The 11 widgets show in this order: Money today, This month due vs received, Overdue by age, Call today, Next 30 days inflow, Next billing milestone, Inventory by tower, Flat status, Construction progress, Sales pipeline, Needs attention. Money today = demo "Collected today" with Cash / Account / Other; Overdue by age = Outstanding & ageing per band (₹ and bookings); Next billing milestone = the demo's next stage per tower (bookings, ₹); Inventory by tower counts add up to 138 flats.
- **JRN-52** Every number opens the list that adds up to it
  - steps: Click every number on every widget (tile values, band amounts, counts).
  - expected: Each opens a filtered list whose total (or row count) equals the clicked number exactly.
- **JRN-53** Period and project filters
  - steps: Switch Today → This month → FY, then pick SGH, then GGV.
  - expected: Period widgets change to the matching report figure for that period and project (Collections FY = demo FY figure for all projects); stock widgets (inventory, flat status, overdue) follow the project filter only.
- **JRN-54** Role defaults
  - steps: Log in as sales@kkt.in, then as the Accounts user, then as the Site engineer user; open Home.
  - expected: Sales sees only Call today, Sales pipeline, Inventory by tower, Flat status (no money widgets); Accounts sees Money today, This month due vs received, Overdue by age, Call today, Next 30 days inflow, Needs attention (interpreted); Site engineer sees Next billing milestone, Construction progress, Flat status (interpreted); Customize never offers a widget whose data the role can't see.
- **JRN-55** Customize is saved per user
  - steps: As admin@kkt.in hide Sales pipeline and move Needs attention to the top; log out and in.
  - expected: The layout is kept; another user's layout is unchanged; "Reset to default" restores the Owner layout.
- **JRN-56** Call today is actionable
  - steps: Open Call today.
  - expected: It lists the top overdue customers (highest overdue ₹ first), the follow-ups due today (count = demo follow-ups due) and today's site visits; each row has a call link (tel:) and a WhatsApp link (wa.me); clicking a name opens Customer 360.
- **JRN-57** Needs attention catches what is stuck
  - steps: Open Needs attention.
  - expected: It lists the demo hold expiring within 48 h, any bounced cheque not yet replaced, and part-paid bills with no receipt for 30 days; each row opens its record; nothing is listed for TDS or commission yet.
- **JRN-58** No bare zero
  - steps: Filter Home to a project or period with no cheques / no visits (e.g. GGV, Today).
  - expected: Empty widgets say what is missing with a next step (e.g. "No site visits today · Book a visit"), never a lone "₹0" or "0".
- **JRN-59** One widget fails, Home survives
  - steps: Builder-evidenced: force one widget's data to fail.
  - expected: Only that widget shows "Couldn't load — Retry"; the other widgets render; Retry loads it.
- **JRN-60** Home is fast
  - steps: Log in (warm) and time Home; run `tools/perf_budget.py`.
  - expected: First content ≤ 1.0 s, all widgets ≤ 1.8 s; Home bundle ≤ 200 ms server p95; initial JS ≤ 250 KB gzip; Create booking p95 ≤ 600 ms; results in `memory/qa/perf/phase2_end.md`.

## Builder-evidenced
- **JRN-61** Full `pytest -n 2` 0 failed (incl. `tests/test_ledger_example.py` unchanged), tieout 100 % incl. every Home widget figure, integrity 0, chronology 0, connection matrix green, ESLint 0/0, `CI=true yarn build` ok.
