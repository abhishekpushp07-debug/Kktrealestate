# KKT ERP v2 — Phase 11D (Customer 360 correction · remaining screens · final audit)

## Original request
Correct Customer 360 (owner scored 6/10) and shared visual system; move Leads & Visits, Service, Reports, Website CMS, Settings, Masters, Roznamcha to v2; final functional/responsive/build audit; screenshots in /app/memory/qa/v2c; reseed to pristine data.

## Implemented (24 Oct 2026)
- Customer 360: single hero card (64px avatar, serif name, pills; contact row; right-aligned actions — ink "Post payment", secondary "New booking", ghost Log/Statement/Edit, overflow menu); Financial summary strip (Agreement / Paid / Due / Cheques — 2×2, fed from the combined ledger totals so it matches the ledger section); booking cards with min-width/ellipsis (no clipping at 1440/390); ledger segmented control, 4-up tiles, zebra rows, right-aligned numerals with frontend-computed running balance in Combined mode; communication/KYC empty states; code deep-links redirect to canonical id.
- Shared kit: Money ₹ prefix, Lucide-only icons, StatTile, StatusPill (added Awaiting Customer), buttons; legacy `Pill/StatCard/PageHeader/EmptyState` in `components/common/Bits.jsx` now render via the v2 kit so legacy pages inherit the v2 look (no mixed styling).
- Leads & Visits v2 (`pages/v2/Leads.jsx`): tiles, Pipeline/List/Enquiries/Site visits/Brochure downloads tabs, dropdown-first New Lead, convert prefill. `/site-visits` → `/leads?tab=visits`.
- Roznamcha v2 (`pages/Roznamcha.jsx`): date strip, opening/received/deposited/closing tiles, by-mode and by-bucket groups, contra sheet, print. `/roznamcha` → `/payments?tab=roznamcha`.
- Service: v2 ticket cards (SLA/priority/assignee), StatusPill, thread bubbles, stat tiles.
- Reports / Website CMS / Settings / Users: re-skinned through shared primitives (header, tables, pills, cards).
- Backend: admin reseed now re-runs `seed_catalogues` + phase-11 startup (catalogue_items were wiped and not reseeded before).
- Testing agent iteration 14 passed; backend suites green; production build clean (pre-existing AuthContext warnings only); 390px scrollWidth = 390 on checked pages. Reseed to pristine done at end.

## Honest gaps (not done)
- Reports: still the legacy layout re-skinned — no grouped v2 navigation redesign, saved presets UI unchanged.
- Masters (flat types, amenities, charge types, PLC, specs, floor-plan templates) still open their legacy editors from Settings → Catalogues "Structured masters"; not rewritten as v2 structured types.
- Settings → Users & Roles: table re-skin only; no card/permission-matrix group toggles.
- Service: no kanban drag-drop; internal notes/attachments use existing legacy forms.
- Reseed takes ~2 min (CMS image fetches) — call with a long timeout.

## Next
1. Reports v2 grouped navigation + chart cards. 2. Masters → structured v2 catalogue editors. 3. Users & Roles permission matrix. 4. Service kanban.
