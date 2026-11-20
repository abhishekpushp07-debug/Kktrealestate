# KKT ERP v2 — Phase 11B: Design system, shell, Home, Project workspace, Setup wizard, Catalogues

Status: implemented & tested (iteration_12.json, 2026-10-24). Screenshots: `/app/memory/qa/v2/*-1440.jpg`, `*-390.jpg`.

## Design system "Royal Black & Warm White"
- Tokens in `tailwind.config.js` + `index.css`: ink-950/900/800/700, warm-50/100/200, gold (#C9A227/#D8B64A), semantic sage/amber/brick/slate.
- Fonts: Manrope (UI), Fraunces (display numbers/headlines). Cards 16px radius, warm shadows. Motion 160–220ms ease-out, skeleton shimmer.
- Kit: `src/components/v2/index.jsx` (PageHero, StatTile, Card, EntityCard, ProgressRing, StatusPill, Money, Tabs, Stepper, Timeline, EmptyState, Skeleton, MiniBar…) + `components/v2/Select.jsx` (searchable catalogue select) + `hooks/useCatalogues.js` (/api/catalogues, ETag-cached).

## Shell & navigation (`components/layout/AppShell.jsx`)
- Royal-black sidebar 260px ⇄ 72px (`sidebar-toggle`), grouped nav (`nav-*`), top bar with breadcrumb, ⌘K search pill, quick-create (`quick-new`), notifications, user menu. Mobile drawer at <1024px. `<main>` is `min-w-0 overflow-x-clip` so legacy pages never overflow at 390px.

## Screens
- Login v2 (`pages/Login.jsx`) — split black/warm, gold grain; demo chips dev-only; MFA flow preserved.
- Home v2 (`pages/v2/Home.jsx`) ← `GET /api/dashboard/home` (`routers/home.py`): KPI tiles, projects strip, 12-month collections chart, ageing, needs-attention (overdue/bounced/unassigned), recent activity. Role-aware via permissions.
- Projects v2 (`pages/v2/Projects.jsx`) — card grid, status chips, progress ring, collected/outstanding.
- Project workspace (`pages/v2/ProjectWorkspace.jsx`) — hero band + tabs: overview, towers, inventory (FlatsTable, page_size 200), construction (per-tower stage timeline, reuses ConstructionStatusPanel), plans, pricing, customers, bookings, collections, website.
- Project Setup wizard (`pages/v2/ProjectSetup.jsx`) at `/erp/projects/new` and `/erp/projects/:id/setup` — 7 steps; each step persists (`PUT /api/projects/{id}/setup/{towers|stages|plans|pricing}`, blocks POST/PATCH); resumable; review checklist.
- Settings → Catalogues (`pages/v2/Catalogues.jsx`) at `/erp/settings/catalogues` — type nav, inline add, edit, reorder, deactivate, CSV export/import; links to structured masters.

## Fixes made during QA
- `routers/project_setup.py`: `$setOnInsert` collided with `$set` on `is_active` → 500 on plans save. Fixed.
- `FlatsTable` requested page_size 500 (API cap 200) → 422. Fixed.
- Setup step 2 no longer PATCHes unchanged existing towers (avoided VERSION_CONFLICT); reload after save.
- 390px overflow on Home/Workspace tabs/Catalogues fixed with `min-w-0`/`max-w-full`.
- Home overdue rows: `customer_name` coalesced from booking.

## Not in scope / deferred
- Phase 10 single-domain packaging and the documentation PDF remain cancelled.
- `/app/mobile` untouched.
- Legacy pages (customers, bookings, payments, leads, service, reports, website, masters) still use the old components inside the new shell — redesign pending (Phase 11C candidates).
