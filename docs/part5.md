# Part V — ERP v2 (Phases 10–12): packaging, canonical backend, design system, new modules

> Phases 10–12 added a single-domain deployment package, a hardened "canonical" backend (catalogues, project setup, CRM, read models, bootstrap caching) and the **Royal Black & Warm White** ERP v2 experience. This part documents those additions; earlier parts remain accurate for the underlying engines.

## 24. Single-domain deployment package (`frontend/scripts/package-build.js`, `package-assets.js`, `dev.js`)

### 24.1 Goal and layout

One static build from `/app/frontend` serves all three surfaces so a single re-publish updates the domain:

| Path | Surface | Source | Build step |
|---|---|---|---|
| `/` | Marketing site (`/app/site`) | prebuilt `deploy-assets/site` | copied to `build/` root; hashed assets under `/site-assets` |
| `/erp/*` | ERP (React, this repo) | `craco build` with `PUBLIC_URL=/erp`, `REACT_APP_BASE_PATH=/erp` | written to `build/erp/` |
| `/portal/*` | Customer portal (Expo web export, `/app/mobile`) | prebuilt `deploy-assets/portal` (`npx expo export --platform web`, `experiments.baseUrl="/portal"`) | copied to `build/portal/` |
| `/api/*` | FastAPI | — | same origin, port 8001 via ingress |

```flow
yarn package:assets (site build + expo export → deploy-assets) -> yarn build (craco build, PUBLIC_URL=/erp) -> KktPackagePlugin post-build (move ERP → build/erp, copy site + portal) -> inject router-loader into root index.html -> Re-publish (static host with SPA fallback to ROOT index.html)
```

### 24.2 Router-loader

Static hosts fall back to the **root** `index.html` for unknown nested paths. The first child of the root `<head>` is an inline script (`data-kkt-loader`): if `location.pathname` starts with `/erp` it fetches `/erp/index.html`, otherwise `/portal` → `/portal/index.html`; the fetched document replaces the current one via `document.open/write/close` so the correct bundle boots with its own asset paths. Anything else lets the marketing site boot. The site's own entry is guarded the same way so a stale cached root page cannot render the wrong surface.

```
onload(root index):
  p = location.pathname
  if p starts with "/erp"    → swap(fetch("/erp/index.html"))
  elif p starts with "/portal" → swap(fetch("/portal/index.html"))
  else boot marketing site
swap(html): document.open(); document.write(html); document.close()
```

### 24.3 Same-origin API resolution

- Site (`/app/site/src/lib/api.js`) and portal (`/app/mobile/src/api/client.ts`) resolve the backend as `window.location.origin` unless running on the Expo preview host, in which case `EXPO_PUBLIC_BACKEND_URL` is used. The ERP uses `REACT_APP_BACKEND_URL`, which equals the origin in production.
- `portal_url` (site settings) defaults to `<origin>/portal` when empty; `PORTAL_PUBLIC_URL` (backend `.env`) overrides it for a separate portal host.

### 24.4 Preview = production

`scripts/dev.js` detects a packaged `build/` (`build/erp/index.html` + loader marker) and serves it exactly like a static host: hashed assets immutable, every non-`/api` path → root `index.html`. The preview environment therefore exercises the loader, deep-link reloads and same-origin portal login before publishing.

> Definition of done for every phase: run `yarn package:assets` whenever `/app/site` or `/app/mobile` changed; `yarn build` fails loudly if `deploy-assets/{site,portal}` are missing.

### 24.5 Deploy checklist (owner)

1. `cd /app/frontend && yarn package:assets` (only if site/portal changed).
2. `yarn build` → verify `build/index.html`, `build/erp/`, `build/portal/`.
3. Re-publish frontend + backend. Post-publish secrets: `PORTAL_PUBLIC_URL=` (blank → same-origin), `CORS_ORIGINS=https://<domain>`.
4. Smoke: `/`, `/erp/login`, `/portal/login`, `/api/health`, reload on `/erp/customers`.

Startup against a Phase-5-era database is idempotent (`tests/test_startup_migrations.py`): catalogues seeded, read models built, `default_cash_percent` backfilled on projects and blocks, visit settings and `portal_url` created.

## 25. Canonical backend hardening (Phase 11A)

### 25.1 Catalogues — selection-driven data entry (`routers/catalogues.py`, `catalogue_items`)

All "pick from a list" values are rows in one collection: `{id, company_id, type, code, label, parent_id, sort_order, meta, is_active}`. 44 types are seeded (salutation, gender, residency, occupation, income_band, lead_source, customer_segment, bhk_preference, facing, floor_preference, budget_band, state → city → locality (hierarchical via `parent_id`), nationality, company_type, document kinds, service categories, …).

| Endpoint | Purpose |
|---|---|
| `GET /api/catalogues` | compact bundle `{version, types:{type:[items]}}` with `ETag`; 304 when unchanged; cached client-side in IndexedDB (`hooks/useCatalogues.js`, `lib/idb.js`) |
| `GET /api/catalogues/{type}` · `POST` · `PATCH /{id}` · `POST /{id}/deactivate` | admin CRUD; `master.write` |
| `POST /api/catalogues/{type}` from the UI `Select` "Add …" option | permission-gated inline quick-add (e.g. a locality under the chosen city, `parent_id` = city id) |

Customer profiling fields are stored as ids (`salutation_id`, `gender_id`, `residency_id`, `occupation_id`, `income_band_id`, `source_id`, `state_id`, `city_id`, `locality_id`, `segment_ids[]`, `preferences{bhk_ids, facing_ids, floor_id, budget_band_id}`) via `PATCH /api/customers/{id}/profile` (`routers/crm.py`, `ProfileIn`), each validated against its catalogue type (`PROFILE_TYPES`); unknown ids → 422. Legacy free-text fields (`occupation`, `annual_income_band`, `source`) accept the catalogue label for compatibility.

### 25.2 Project setup (`routers/project_setup.py`)

`GET /api/projects/{id}/setup` returns one document for the wizard; `PUT /api/projects/{id}/setup/{section}` persists a section atomically. Sections: `basics` (incl. `default_cash_percent`), `towers` (structure), `floor_plans`, `stages`, `plans` (assignments), `pricing` (`block_rates[]` with `rate_per_sqft`, `floor_rise_per_sqft`, **`default_cash_percent` tower override**), `amenities`, `website`. Upserts exclude `$set` keys from `$setOnInsert` to avoid path conflicts (fixed in 11B).

### 25.3 CRM: communications, timeline, three ledgers (`routers/crm.py`, `services/ledgers.py`)

- **Communications** `POST/GET /api/customers/{id}/communications` — channel, direction, summary, outcome, follow-up; feeds the engagement score.
- **Timeline** `GET /api/customers/{id}/timeline?limit&cursor&types` — merged, cursor-paginated events (bookings, payments, demands, communications, visits, tickets, notices); events without a timestamp are dropped (fix 12).
- **Ledgers** `GET /api/customers/{id}/ledgers` — per booking: `cash`, `account`, `other` buckets with rows `{at, type, amount_paise, due_paise, ref}` and `totals` (`agreement_paise`, `paid_paise`, `due_paise`, pending cheques) plus a `combined` view. The UI computes the running combined balance chronologically (demand +, payment −, reversal +).

### 25.4 Read models, bootstrap and caching

| Piece | Where | Notes |
|---|---|---|
| `GET /api/bootstrap` | `routers/bootstrap.py` | user, permissions, project scope, settings, catalogue version — one call on app start, `ETag` |
| `GET /api/dashboard/home` | `routers/home.py`, `services/read_models.py` | today tiles, attention lists (overdue demands with customer names, follow-ups), ageing buckets, project snapshots (city, cover), counts incl. `projects` (drives first-run guidance) |
| Refresh | `scripts_refresh_read_models.py`, periodic loop | idempotent rebuild of `*_summaries`, `dashboard_snapshots` |
| Cursor/include/`Server-Timing` | `utils.paginate`, `infra.py` | targeted list endpoints expose `next_cursor`; `?include=` expands relations |
| Client caches | IndexedDB (`catalogues_v1` with ETag), route-chunk prefetch on sidebar hover (`lib/prefetch.js`) | catalogues render from cache instantly, revalidated with `If-None-Match` |

## 26. Design system "Royal Black & Warm White" (`frontend/src/components/v2/`)

| Token | Value | Use |
|---|---|---|
| ink-950 / 900 / 800 / 700 | `#0A0C10` `#111419` `#1A1F27` `#2A313C` | primary buttons, headings, sidebar |
| warm-50 / 100 / 200 | `#FBF9F4` `#F4F0E8` `#EAE4D8` | page background, tiles, borders |
| gold / gold-hover | `#C9A227` / `#D8B64A` | one hero CTA per page, icon tile of the primary action, ring/accent |
| Type | Manrope (UI), serif display for numerals/headlines | `Money` renders a smaller Manrope ₹ so the serif face never clips |
| Card | 1px warm-200 + `0 1px 2px rgba(20,16,8,.05), 0 10px 30px -12px rgba(20,16,8,.12)` | hover lift 160–220 ms ease-out |
| Buttons | 40 px, radius 10 | primary ink, secondary warm-100, ghost text, danger brick |
| Density | `Settings → Appearance` Comfortable/Compact (`hooks/useDensity.js`, class `density-compact`) | persisted per browser profile |

Kit components (`components/v2/index.jsx`): `Card`, `StatTile`, `StatusPill` (single semantic map), `Money`/`Num`, `Tabs`, `Stepper` (`allowJump` for edit mode), `Field`, `FormSection` (ids = slug of title → deep-linkable `#section`), `EmptyState`, `Skeleton`, `Monogram`, `Timeline`, `SegmentBar`; `Select.jsx` (searchable, hierarchical `parentId`, inline add); `CustomerBits.jsx` (`Avatar`, `Segmented`, `LedgerSection`); `KanbanMove.jsx` (touch "Move to…" menu < 1024 px, ArrowLeft/Right keyboard moves); `Completeness.jsx` (gold completeness ring + missing-field popover → `/customers/{id}/edit#section`); `PostPayment.jsx`; `QuickCustomerSheet.jsx`.

Shell (`components/layout/AppShell.jsx`): collapsible sidebar with hover prefetch, 40 px search pill, ⌘K chip, bell badge, 13 px breadcrumb (`CRUMB` map), print header (`.print-brand`). Keyboard: ⌘/Ctrl K palette (pages, records via `/api/search`, **actions**: New booking, Post payment, New customer, New lead, Log a call, Mark stage, Roznamcha), `g` + `p/c/b/h/y/l/s/r` go-to, `?` shortcuts sheet (`components/common/CommandPalette.jsx`).

## 27. v2 screens and their algorithms

### 27.1 Home (`pages/v2/Home.jsx`)
Today row (collections, demands due, visits, tickets), attention list, ageing bar, project snapshots; first-run card when `counts.projects === 0`.

### 27.2 Projects · Workspace · Setup wizard (`pages/v2/Projects.jsx`, `ProjectWorkspace.jsx`, `ProjectSetup.jsx`)
Eight-step wizard bound to §25.2; step buttons are jumpable for existing projects. Pricing step accepts per-tower rate, floor rise and cash-share override.

### 27.3 Customers list · form · Customer 360 (`pages/v2/Customers.jsx`, `CustomerForm.jsx`, `Customer360.jsx`)
- Form: dropdown-first (`Select` for every catalogue), dependent state → city → locality, multi-select segments/preferences, consent toggles. Submit = `POST /customers` then `PATCH /customers/{id}/profile`.
- 360: hero (avatar in completeness ring, lifecycle/KYC/segment pills, contact row, ink "Post payment", secondary "New booking", ghost Log/Statement/Edit), **Financial summary strip** fed by the combined ledger totals, booking cards (15/600 property line, "Next · stage" pill, cash/account/other dues), ledger section (segmented Combined/Cash/Account/Other, 4 tiles, zebra rows, running balance), communications, KYC (masked, reveal with `customer.reveal_pii`), portal access, documents. Code deep-links (`/customers/CUST-…`) redirect to the canonical id.

```
completeness(c):
  checks = [email, city, locality, occupation, income band, source, segments, preferences, PAN, Aadhaar, bank, nominee]
  pct = filled / len(checks) * 100 ; missing → links to /customers/{id}/edit#{section}
```

### 27.4 Leads & Visits (`pages/v2/Leads.jsx`)
Tiles; tabs Pipeline / List / Enquiries / Site visits / Brochure downloads; pipeline kanban (drag, touch menu, arrow keys) with guards: → Converted opens the convert sheet (prefills the customer form), → Lost asks for a reason. Dropdown-first New Lead; lead detail with timeline, follow-ups, communications, visits.

### 27.5 Bookings · wizard · detail (`pages/v2/Bookings.jsx`, `BookingWizard.jsx`, `BookingDetail.jsx`)
Wizard split default: `tower.default_cash_percent ?? project.default_cash_percent ?? 0` pre-fills percent mode with a slider; cash + account must equal the agreement. Quick customer sheet creates a customer inline. Detail: `?revise=1` auto-opens the revision dialog (used by the Post Payment cap link); cancel via reason sheet.

### 27.6 Payments · Post Payment · Roznamcha (`pages/v2/Payments.jsx`, `components/v2/PostPayment.jsx`, `pages/Roznamcha.jsx`)
Post Payment computes the bucket cap client-side from the booking summary: hint "Room in this bucket: ₹X"; the moment `amount > room` the field shows the server's exact sentence (`"<bucket> agreed ₹A; already received ₹R; cannot accept ₹X. Revise agreement first."`), submit is disabled and a permission-gated "Revise agreement →" link appears; the same message arrives as a 409 if bypassed. Roznamcha: date strip, opening/received/deposited/closing tiles, by-mode and by-bucket groups, contra sheet, print.

### 27.7 Service (`pages/ServiceRequests.jsx`)
Tiles (open, breaching SLA, awaiting customer, avg rating); kanban by status with swimlanes-by-priority toggle; SLA countdown chips; drag/touch/keyboard moves call `POST /api/service-requests/{id}/status` (`SRStatusIn{status, note}`): **Resolved requires a resolution note** (stored as `resolution_note` and as an internal thread message), **Closed only from Resolved**; closed cards show the rating.

### 27.8 Reports v2 (`pages/Reports.jsx`, `routers/reports.py`)
Grouped navigation (Collections · Dues & Ageing · Inventory · Sales & Leads · Operations · Activity), date presets Today / This month / FY / Custom, catalogue selects, KPI tiles per report, recharts card, zebra table with sticky totals, CSV/PDF/Print, saved views (pills; `POST/PATCH/DELETE /api/reports/presets`). New in Phase 12:

| Report | Rows | Totals / extras |
|---|---|---|
| `service-sla` | per category: tickets, open, resolved, SLA met % (`resolved_at ≤ sla_due_at`; open past due counts as breached), avg resolution h, avg rating | `status_counts[]` |
| `construction-progress` | per tower × stage: status, planned, completed, variance days, photos (`construction_photos` by `milestone_seq`), demands + ₹ raised (`demands.trigger_stage_id`) | `towers[]` with completion % and current stage |

### 27.9 Settings → Catalogues, structured masters, Users & Roles (`pages/v2/Catalogues.jsx`, `pages/master/*`, `pages/Users.jsx`, `pages/Roles.jsx`)
- Masters: cards/table toggle, usage counts (`GET /api/master/{kind}?include_usage=true` → `usage_count`, `usage_label`), guarded deactivate. Flat-type editor: rooms L×W → sq ft, areas with hierarchy validation (carpet ≤ built-up ≤ super built-up; duplicate area types rejected; submit disabled on error), specification chips, live totals, indicative price. Floor-plan editor: preview grid + positions (flat type, facing, corner). Amenities: Lucide icon picker.
- Users: cards (role, scope chips, last login, MFA) with invite / edit / reset-password sheet. Roles: cards + area × action permission matrix with group toggles, search, +n/−n summary and a diff-preview dialog before `PATCH /api/roles/{id}`; Super Admin is read-only.

## 28. Phase 12 polish & measurements

- Micro-interactions: button press states, card hover lift, sheet slide-in, staggered page entrance; optimistic kanban moves with reload (no undo yet).
- Accessibility: labels/aria on new controls, focus rings (`focus-visible:ring-gold`), `aria-live` toaster, keyboard kanban, option accessible names without code suffixes.
- Print: `@media print` branded header, warm table heads, ink totals, chrome hidden.
- **Time-to-interactive (production build, preview host)**: Home ≈ 1.37 s · Customer 360 ≈ 1.38 s · Booking detail ≈ 1.4 s (navigation commit → key content visible; ≈ 1.1 s is shell + auth bootstrap).
- Known gaps: no toast-undo/rollback for status changes; bootstrap not cached in IndexedDB (catalogues are); legacy forms not fully audited for a11y; print view not pixel-matched to PDFs; Service SLA has no per-category targets.
