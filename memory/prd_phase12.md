# KKT — Phase 12 (deployment package · outstanding ERP items · deeper polish)

## A. Deployment packaging — DONE (25 Oct 2026)
- ONE build from `/app/frontend`: `yarn build` → `build/` = marketing site (root, `/site-assets`), `build/erp/` (PUBLIC_URL=/erp), `build/portal/` (Expo web export, baseUrl `/portal`). Inline router-loader in root `<head>` picks the surface; static hosting with root-index SPA fallback is enough.
- `yarn package:assets` refreshed `deploy-assets/{site,portal}` (build fails loudly if missing). `scripts/dev.js` now serves the packaged bundle 1:1 (root-index fallback for every non-/api path) → preview = production.
- Same-origin API for site + portal (`window.location.origin`; Expo preview host keeps `EXPO_PUBLIC_BACKEND_URL`). `portal_url` defaults to `<origin>/portal`; `PORTAL_PUBLIC_URL=` key in backend `.env`.
- Startup idempotency test extended (catalogues, read models, `default_cash_percent` on projects+blocks, visit settings) — green.
- Verified in browser: `/` site, `/erp/login` + deep-link reload, `/portal/` login same-origin + reload keeps session, assets 200, zero console errors. README "Deploy checklist" added.

## B. Outstanding ERP items — DONE
1. Operations reports: **Service SLA** (`/api/reports/service-sla`: by category, SLA met %, avg resolution h, ratings, status counts) and **Construction progress** (`/api/reports/construction-progress`: per-tower stage status, planned/actual + variance days, photos, demands per stage; tower cards). CSV/PDF work.
2. Touch/keyboard kanban (Service + Leads): "Move to…" menu < 1024px; ArrowLeft/Right on focused cards (`components/v2/KanbanMove.jsx`).
3. Customer 360 completeness ring (gold) with missing-fields popover → opens Edit at the section (`FormSection` ids + hash scroll).
4. Post Payment: live "Room in this bucket: ₹X" hint; field turns red with the full backend sentence and submit disabled the moment it exceeds; "Revise agreement →" link.
5. Tower `default_cash_percent` override (project setup → Pricing step, falls back to project) — wizard shows "Tower default 35% …"; stepper now allows jumping to any step on existing projects. Locality inline quick-add (permission-gated) already present in `Select` — verified.

## C. Polish — partially done
- ⌘K palette now has Actions (New booking, Post payment, New customer, New lead, Log a call, Mark stage, Roznamcha) + Pages + search; `g p/c/b/h/y/l/s/r` go-to; `?` shortcuts sheet.
- Settings → Appearance: Comfortable/Compact density, persisted per browser profile (`useDensity`).
- First-run Home card ("Set up your first project") when the company has 0 projects.
- Print styles: branded header, warm table header, ink totals, chrome hidden (`@media print`).
- Catalogues cached in IndexedDB with ETag/version (`lib/idb.js`, `useCatalogues`); sidebar hover/focus prefetches route chunks (`lib/prefetch.js`).
- Toaster `aria-live` region labelled; micro-interactions (press states, card lift, sheet slide) already in the kit from 11C.
- **TTI (prod build, preview host, warm cache)**: Home ≈ 1.37 s · Customer 360 ≈ 1.38 s · Booking detail ≈ 1.4 s (navigation commit → key content visible; ~1.1 s of that is shell + auth bootstrap).

## Phase 13 — Documentation (25 Oct 2026)
- Review fixes (v12.1): §14.1 corrected to ₹60 L **cash** + ₹40 L **account**, cumulative CLP 10/15/25/30/40/50/60/75/85/100 %, ledger rows from seeded BK-2526-0001 with advance narrative (rows 3, 6, 8); §17–20 (Notifications, Reports & PDFs, Website+CMS, Customer portal) written in full; edge-case tables added to §11/§13/§14; DejaVu fonts embedded so ₹ renders. 92 pages, TOC page numbers verified against body.
- `/app/docs/KKT_Technical_Documentation.md` (Parts I–IV from Phase 9 scaffold, updated; new **Part V — ERP v2 Phases 10–12** in `docs/part5.md`; generated appendices: collections/indexes, permissions & role matrix, API map from OpenAPI, errors, enums, settings, tests) → `/app/backend/docs/build_docs_pdf.py` (reportlab, Royal Black cover, auto TOC with page numbers, running header/footer "page x of y", zebra tables, code blocks, callouts, flow/state diagrams) → **85-page** branded A4 PDF at `/app/docs/KKT_Technical_Documentation.pdf`, copy in `/app/memory/docs/`.
- ERP → Settings → Documentation card (Super Admin): Download PDF / Markdown / Regenerate via `GET /api/admin/docs/technical.pdf|.md`, `POST /api/admin/docs/regenerate` (audited).
- Fixed: inline-markdown parser crashed on `*` inside code spans; TOC excluded per-collection headings; header reset per build pass.
- Gap: 85 pages is at the lower end of the 80–120 target; module chapters (Part III) could be deepened with more pseudo-code.


- Toast "undo" for status changes and optimistic rollback not added (status moves are optimistic with reload; no undo).
- Bootstrap (`/api/bootstrap`) not yet cached in IndexedDB (catalogues are).
- Accessibility pass was partial: new components labelled; no full audit of legacy forms.
- Print view checked via CSS only, not pixel-compared with PDFs.
- Service SLA report counts SLA from `sla_due_at` only (no per-category SLA targets).

## Verification
Testing agent iteration 16: all flows passed; 3 action items fixed (palette permission codes, stepper jump, cap sentence spacing). Backend suites green (timeline null-`at` bug fixed in `crm.py`). 390 px: no overflow; zero console errors. Screenshots `/app/memory/qa/v3/`. Reseeded to pristine at end.
