# KKT ERP v2 — Phase 11E (four redesigns · Customer 360 polish · regression)

## Implemented (24 Oct 2026)
- **Reports v2** (`pages/Reports.jsx`): six grouped nav sections (Collections · Dues & Ageing · Inventory · Sales & Leads · Operations[coming soon] · Activity), report header + description, filter bar with Today/This month/FY/Custom presets + catalogue-style selects, KPI StatTiles per report, kit-styled recharts card, zebra table with sticky header/ink totals row, CSV/PDF/Print, saved views as pills with inline rename (PATCH `/api/reports/presets/{id}` added) and delete. Data contracts unchanged.
- **Settings → Catalogues structured editors** (`pages/master/*`): MasterPage v2 (breadcrumb, cards/table toggle, search, usage counts via `?include_usage=true`, guarded deactivate dialog). FlatTypeForm: rooms (L×W→sq ft), areas with duplicate + carpet ≤ built-up ≤ super validation (submit disabled on error), specification multi-select chips, live totals and sticky indicative price. FloorPlanForm: live preview grid + positions with flat-type/facing/corner. GenericMasterForm: v2 sheet, Lucide icon picker for amenities/room types, masked bank account.
- **Users & Roles v2** (`pages/Users.jsx`, `pages/Roles.jsx`): user cards (avatar, role pill, scope chips, last login, MFA state) with invite / edit / reset-password sheet; role cards + grouped permission matrix (area × action) with group toggles, search, +n/−n diff summary and a diff-preview dialog before save; Super Admin read-only.
- **Service v2 kanban** (`pages/ServiceRequests.jsx`): native HTML5 drag-drop between status columns, Resolved prompts a mandatory resolution note (stored as `resolution_note` + internal thread message; backend `SRStatusIn.note`), Closed blocked unless Resolved, rating stars on closed cards, SLA countdown chips, swimlanes-by-priority toggle.
- **Customer 360 polish**: booking card property line 15/600 primary, "Next · stage" gold pill, more breathing room around the paid line, KYC rows with baseline-aligned lock icons.
- **Sweep**: deleted legacy `Bookings/Dashboard/CustomerDetail/Customers/Projects/Leads/Payments` pages (v2 replacements only); booking wizard now uses `components/v2/QuickCustomerSheet.jsx`; AppShell crumbs name every master. One visual language end-to-end; 390px scrollWidth = 390 on all checked pages; production build clean (AuthContext warnings pre-existing).
- Tests: backend 66 passed + testing agent's `tests/test_phase_11e.py` 7/7; frontend flows (reports export/presets, flat-type edit + validation, users invite/role edit/reset, roles matrix + diff save, service drag/resolve/close guard/swimlanes, Customer 360, quick customer) passed. Reseeded to pristine at end.

## Honest self-scores (1440, 100% zoom)
Reports 8/10 · Masters 8/10 · Users & Roles 8/10 · Service 8/10 · Customer 360 8.5/10.

## Phase 11F regression fixes (25 Oct 2026)
- Add customer 422: `CustomerIn` legacy literals (salutation, gender, occupation, income band, source) relaxed to free text; `source_id` added to `ProfileIn` (validated against `lead_source`); UI sends `source_id` in the profile PATCH. GET returns all profile ids/segments/preferences. Covered by `tests/test_phase_11f.py` (4 tests) + UI test (every dropdown, Bihar→Patna→Boring Road dependent filtering).
- Projects: new `default_cash_percent` (seed SGH 60, GGV 0; editable in Project Setup → basics). Booking wizard pre-fills the split in percent mode with a slider and project-default hint; cash+account must still equal the agreement.
- Post Payment: over-cap state shows the backend's full message ("… already received ₹X; cannot accept ₹Y. Revise agreement first.") inline and in the error toast, with a permission-gated "Revise agreement" link → `/bookings/{id}?revise=1` auto-opens the revision dialog.
- Cancel booking from UI verified (reason sheet → Cancelled). Select options expose only the label as accessible name.
- Reseeded to pristine after testing (QA customers 0, no BK-2627/SGB-2627 artefacts).

## Gaps
- Reports "Operations" group has no backend report yet (shows "Coming soon").
- Flat-type validation ignores rows whose area type is still blank (by design); blank rows fail on server validation.
- Service DnD is native HTML5 — no touch drag on mobile (use the status select in ticket detail).
- Floor-plan preview is schematic (no real geometry).
