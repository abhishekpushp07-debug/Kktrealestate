# Phase 2: Connection proof + Calm Light / Night + new shell + Home Command Center

Version: phase-2. Features: F-42, F-9, F-10, F-11, F-12 (see `../overview.md`). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10. Gates: `../ALL_PHASES_TODO.md` "Gates". Phase 1 closed on the India business day (`services/clock`, `frontend/src/lib/businessDay.js`) and one outstanding number (`definitions.ageing_for_bookings`); everything here builds on those.

## Goal
Prove that every owner action shows the same number on every screen, then give the app its calm new look (Light / Night), a clean shell, and a Home that tells each role exactly what needs doing today, where every number opens the list that adds up to it.

Build order inside the phase: 2A → 2B + 2C → 2D → 2E. 2A comes first because the owner's main pain is "features not talking to each other".

## Functional requirements

### 2A Connection proof (F-42)
- REQ-67 [always] The system shall carry a committed connection matrix (`tools/connection_matrix.py` + pytest) that, for each action in REQ-68, records every surface in REQ-69 before and after and asserts the expected change on each.
- REQ-68 [always] The matrix shall cover these actions: create booking; payment Cash; payment Cheque; payment NEFT/RTGS; payment UPI; cheque clear; cheque bounce; receipt reversal; stage complete → bills; stage undo; cancel → refund; cancel → forfeit; transfer; agreement revision; change plan; hold; release; hold expiry; unsold flat price change; lead → visit → booking; master change (e.g. charge head GST %) affecting new entries only.
- REQ-69 [always] The matrix shall check these surfaces: booking page; Customer 360; booking ledger (Udhar/Jama); Bills raised; Received; Cheque register; Roznamcha; Demand register; Home widgets; Home trends; Collections; Outstanding & ageing; Project statement; Cancellations & refunds; Hold register; Lead funnel; project / tower / flat status and counters; inventory value; receipt / demand / statement PDFs; documents register; audit "Where this entry went"; notifications.
- REQ-70 [always] Direct reads shall reflect an action immediately and Home / read models within 5 s (interpreted).
- REQ-71 [unwanted] If any surface differs from the expected value after the freshness budget, then the matrix shall fail naming the action, surface, expected and actual value.
- REQ-72 [always] The system shall save the matrix result to `memory/qa/phase2/connection_matrix.md` with every cell green, and the matrix test shall run in every later phase.
- REQ-73 [always] Every red cell shall be fixed at its root (event → invalidation → read model), never by a test-side wait or a relaxed expected value.

### 2B Calm Light + Night mode (F-9)
- REQ-74 [always] The system shall style every screen from one set of CSS-variable tokens: warm off-white canvas, white cards, hairline borders, one accent token, Due red, Advance green, status colours, spacing, radius, shadow (mockups in `../overview.md` UI/UX Rules).
- REQ-75 [always] The system shall render numbers in a modern sans with tabular figures from self-hosted fonts using `font-display: swap`.
- REQ-76 [always] The theme switch shall offer exactly two choices: "Light" and "Night" (owner, 2026-11-15: no Auto).
- REQ-77 [event] When a user switches theme, the system shall save the choice on that user's server profile.
- REQ-78 [unwanted] If the profile save fails, then the system shall keep the chosen theme for the session and show "Theme not saved — will retry".
- REQ-79 [event] When a user logs in on any browser, the system shall apply their saved theme before first paint (no flash of the other theme).
- REQ-80 [always] Switching theme shall change no data, no number and no layout width.
- REQ-81 [always] Text and charts shall meet WCAG AA contrast in both themes, checked by an automated contrast test.
- REQ-82 [always] The accent shall be a single token so Phase 5 can set it per company.

### 2C New app shell (F-10)
- REQ-83 [always] The system shall show a light collapsible sidebar with the locked 9 areas in this order: Home · Projects · Customers · Bookings · Payments (Received · Bills raised · Roznamcha) · Construction · Documents · Reports · Masters · Admin (Admin only for users with admin permission).
- REQ-84 [event] When a user collapses or expands the sidebar, the system shall remember that state for the next visit.
- REQ-85 [always] The top bar shall hold: ⌘K search, a "New" menu, the notifications bell, the profile menu, the theme switch, and an empty reserved slot for the Phase 4 company switcher.
- REQ-86 [event] When a user presses ⌘K / Ctrl+K (or clicks search) and types a name, phone, booking number, receipt number or flat number, the system shall list matching customers, bookings, flats and receipts, grouped, keyboard-navigable.
- REQ-87 [unwanted] If nothing matches, then search shall show "No match for '<text>'" with "New customer" and "New lead" shortcuts.
- REQ-88 [always] The "New" menu shall offer exactly: Booking, Payment, Lead, Customer, Site visit — each opening the existing flow (3-step booking wizard, 5-field payment) unchanged.
- REQ-89 [always] Every route shall be lazy-loaded with a skeleton while loading (never a blank screen) and prefetch on hover / intent.
- REQ-90 [always] Menu items, New-menu entries and search results shall appear only where the user's role permits them (existing RBAC).

### 2D Home Command Center (F-11, F-12)
Every number comes from `services/definitions.py` (one definition per figure) and opens the list that adds up to it.
- REQ-91 [always] Widget 1 "Money today" shall show received today with its Cash / Account / Other split and cheques to clear (count, ₹).
- REQ-92 [always] Widget 2 "This month due vs received" shall show bills falling due this month, received this month, and % recovery.
- REQ-93 [always] Widget 3 "Overdue by age" shall show Not due, 0-30, 31-60, 61-90, 90+ with ₹ and booking count each, equal to Reports → Outstanding & ageing to the rupee.
- REQ-94 [always] Widget 4 "Call today" shall list overdue customers by priority (highest overdue ₹ first, interpreted), follow-ups due and site visits today, each with a tap-to-call link and a WhatsApp link (link only; messaging stays not configured).
- REQ-95 [always] Widget 5 "Next 30 days inflow" shall show not-yet-due bills falling due in the next 30 days plus cheques pending clearance.
- REQ-96 [always] Widget 6 "Next billing milestone" shall show, per tower, the next pending stage, the bookings affected and the expected bill ₹ (same numbers as the stage-complete preview).
- REQ-97 [always] Widget 7 "Inventory by tower" shall show Available / Hold / Booked / Sold counts and unsold value per tower.
- REQ-98 [always] Widget 8 "Flat status" shall show a compact floor × flat colour grid per project / tower using the same statuses as Inventory.
- REQ-99 [always] Widget 9 "Construction progress" shall show % of stages complete per tower with the last completed stage and its date.
- REQ-100 [always] Widget 10 "Sales pipeline" shall show leads → visits → bookings for the period, conversion %, and lost leads with reasons.
- REQ-101 [always] Widget 11 "Needs attention" shall list holds expiring within 48 h, bounced cheques not replaced, and part-paid bills stuck (part-paid with no receipt for 30 days, interpreted), with TDS and commission rows reserved for Phases 6–7.
- REQ-102 [event] When a user clicks any number on Home, the system shall open the list of entries whose total equals that number.
- REQ-103 [always] Home shall offer a period switch (Today / This month / FY) and a project filter that apply to every period-based widget.
- REQ-104 [always] Home shall open with a role default layout: Owner = all 11; Accounts = money widgets (1, 2, 3, 4, 5, 11); Sales = Call today, Sales pipeline, Inventory by tower, Flat status (owner, 2026-11-15); Site engineer = Next billing milestone, Construction progress, Flat status (interpreted).
- REQ-105 [event] When a user customizes Home (show / hide / reorder), the system shall save it per user and restore it on next login.
- REQ-106 [unwanted] If a user lacks permission for a widget's data, then the system shall not offer that widget, even in Customize.
- REQ-107 [unwanted] If a widget has nothing to show, then it shall say what is missing and offer the next step (e.g. "No cheques to clear"), never a bare ₹0.
- REQ-108 [always] Home numbers shall equal the matching reports and the `demo_journeys.md` headline to the rupee, enforced by tie-outs in `tools/tieout.py`.
- REQ-109 [always] Home shall load from one bundle endpoint.
- REQ-110 [unwanted] If one widget's data fails, then only that widget shall show "Couldn't load — Retry"; the rest of Home stays usable.

### Carry-overs into this phase
- REQ-111 [always] Create booking shall complete within its 600 ms p95 write budget (pre-existing miss: 1.3 s at Phase 1 end).

## Quality requirements
```
Q-13 Tag: Connection.Matrix
     Scale: red cells in the connection matrix (actions × surfaces)
     Meter: tools/connection_matrix.py + pytest, every phase gate
     Must: 0
     Plan: 0
Q-14 Tag: Money.HomeTieOut
     Scale: paise difference between any Home widget figure and its report / drill-down list total
     Meter: tools/tieout.py (extended per widget) + e2e drill-down sums
     Must: 0
     Plan: 0
Q-15 Tag: Speed.HomeBundle
     Scale: ms server time p95 of the Home bundle endpoint (warm, preview)
     Meter: tools/perf_budget.py, 30 trials
     Must: ≤ 200
     Plan: ≤ 120
Q-16 Tag: Speed.HomeFirstContent
     Scale: ms from login submit to first widget content / all widgets (warm, desktop)
     Meter: Playwright timing, 5 trials, median
     Must: ≤ 1000 / ≤ 1800
     Plan: ≤ 700 / ≤ 1200
Q-17 Tag: Speed.Search
     Scale: ms from keystroke to results shown (⌘K)
     Meter: Playwright timing over 10 queries (name, phone, BK no., receipt no., flat no.)
     Must: ≤ 200 server / ≤ 400 on screen (estimate)
     Plan: ≤ 120 / ≤ 250
Q-18 Tag: Speed.InitialJS
     Scale: KB gzip of initial JS
     Meter: build stats after `yarn build`
     Must: ≤ 250
     Plan: ≤ 200
Q-19 Tag: Speed.CreateBooking
     Scale: ms p95 create booking (warm, preview)
     Meter: tools/perf_budget.py, 30 trials
     Must: ≤ 600
     Plan: ≤ 400
Q-20 Tag: Access.Contrast
     Scale: text / chart elements below WCAG AA in Light or Night
     Meter: automated contrast check (axe or token-pair test) on Home, booking, Customer 360, Reports, Masters
     Must: 0
     Plan: 0
Q-21 Tag: UX.ThemeFlash
     Scale: frames painted in the wrong theme after login / reload
     Meter: Playwright screenshot at first paint, Night user, 5 trials
     Must: 0
     Plan: 0
Q-22 Tag: Device.NarrowWidth
     Scale: px of horizontal page scroll at 390 px on Home and the shell
     Meter: Playwright at 390 × 844
     Must: 0
     Plan: 0
Q-23 Tag: Access.RoleExposure
     Scale: widgets / menu items / search results shown to a role without permission for their data
     Meter: e2e as sales@kkt.in and an Accounts user vs admin@kkt.in
     Must: 0
     Plan: 0
Q-24 Tag: Regression.OwnerLogic
     Scale: changed behaviour in booking, payment, allocation, ledger, pricing, cancellation, numbering (HANDOFF §3/§5)
     Meter: full pytest -n 2 (incl. tests/test_ledger_example.py) + connection matrix
     Must: 0
     Plan: 0
Q-25 Tag: UX.Cosmetic
     Scale: screens in either theme with clipped text, overlapping elements, unreadable chart labels or a bare ₹0 tile
     Meter: e2e screenshots of Home (all 11 widgets), shell, booking, Customer 360, Reports in Light + Night at 1440 px and 390 px
     Must: 0
     Plan: 0
```
