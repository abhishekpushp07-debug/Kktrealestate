# Phase 7 — frontend track (ERP + customer portal)

Scope: the FRONTEND task of phase 7 (audit v3 findings C "ERP ledger", H3 "unsaved edits", H5 "money short forms", H4 "front-end
errors invisible", D1 "browser sessions / PII at rest", F4 "versions", G1 "import templates", C9 "frontend performance"), built against
contracts C1, C2, C6, C7 and the foundation report. This attempt resumed an interrupted one: items 1, 2, 3, 7 and the ERP side of 4, 5
and 6 were in the WIP checkpoint (`de506e7`); they were reviewed, kept and verified. The portal side of 4, 5 and 6, item 8, the QA
runs, the docs and this report were done in this attempt.

## Changes (file list)

**packages/contracts** (owned file + test)

- `src/moneyFormat.ts` (new, exported from `src/index.ts` and as the zod-free subpath `@kkt/contracts/moneyFormat`) — `formatInr`,
  `formatInrShort`, `groupIndian`, `paiseToBigInt`, `INR_GOLDEN_CASES`. BigInt arithmetic from paise; Indian grouping; short forms Cr /
  L only (no K), one decimal half-up, **round first, then promote** (₹99,96,000 → "₹1 Cr", ₹99,999.50 → "₹1 L"); hyphen-minus for
  negatives, never "-₹0". `test/moneyFormat.test.ts`.
- `packages/domain/src/money.ts` — two one-line fixes so the domain formatter agrees with the table (no "-₹0"); its tests stay green
  (139/139). The domain keeps its own copy of the algorithm (it must not depend on contracts); the golden test pins both.

**apps/erp**

- Router / unsaved edits (item 2): `src/routes.tsx` (`createAppRouter()` = `createBrowserRouter` over one pathless root with
  `errorElement`), `src/app.tsx` (`RouterProvider`), `src/components/layout/RootLayout.tsx` (root layout + `RouteErrorPage`),
  `src/components/NavigationGuard.tsx` (the single `useBlocker` + `beforeunload` host), `src/lib/unsaved.ts` (registry,
  `useUnsavedChangesGuard(dirty)`, blocker decision with a post-save grace window), `src/components/ui/dirty-close.tsx` +
  `ui/sheet.tsx` + `ui/dialog.tsx` (every `SheetContent` / `DialogContent` asks "Discard unsaved changes?" on Esc, outside click or the
  close button while dirty; `dirty` prop or "any edit inside"; `guardUnsaved={false}` opts out), guards in `SettingsPage`,
  `SiteSettingsPage`, `PostEditorPage`, `VisitSettingsTab`, `WebsiteTab`, `BookingWizard`, `BlockWizard` (their own `beforeunload`
  handlers removed).
- Ledger (item 1): `features/bookings/api.ts` (`fetchBookingLedger` per page/epoch, `useLedgerRebuilds`, `useBookingDemandsPage`,
  `useBookingPaymentsPage`, `fetchAllPages` for the demand-letter fallback), `detail/LedgerTab.tsx` (dues from `summary` /
  `epoch_totals`, pagination with totals, epoch label + switcher, rebuild-history panel, `DEMAND_VOIDED` / `LEDGER_RESTATED` rows),
  `detail/DemandsTab.tsx`, `detail/PaymentsTab.tsx` (explicit pagination), `bookingMath.ts`.
- Money (item 3): `src/lib/format.ts` delegates to `@kkt/contracts/moneyFormat`.
- Errors (item 4): `src/lib/errorReporting.ts` (C2 reporter: dedupe by signature, `VITE_CLIENT_ERROR_SAMPLE_RATE`, 10 per page load,
  path without query/fragment, bearer for attribution, 4xx/aborts not reported), `src/components/ErrorBoundary.tsx` (onError wired),
  `src/lib/chunkReload.ts` (`vite:preloadError` and route chunk errors → one reload guarded by sessionStorage), `src/lib/queryRetry.ts`
  (never a 4xx; 429/503 after Retry-After ≤ 30 s, twice; other failures once), `src/main.tsx`.
- Sessions (item 5): `src/lib/api.ts` (access token in memory, `X-KKT-Session: cookie` + `credentials: "include"` on login / refresh /
  logout, empty-body cookie refresh, single-flight + Web Lock across tabs, legacy `kkt.erp.refresh` deleted, only the flag
  `kkt.erp.session = "1"` stored, 401 `SESSION_EXPIRED` signs out), `src/lib/auth.tsx` (restore on load by refresh), `pages/LoginPage.tsx`
  (optional company code on `COMPANY_REQUIRED`, `SESSION_EXPIRED` copy).
- Versions (item 6): every call to a foundation-listed version-required route sends `version` (→ `If-Match: "v<n>"`) or the body
  version — `features/crm/customer/CoApplicantsCard.tsx`, `inventory/project/*`, `reports/PresetsMenu.tsx`, `reports/api.ts`,
  `service/ServiceRequestDetail.tsx`, `bookings/wizard/useBookingDraft.ts`, masters activate/deactivate (`masters/api.ts`), …;
  `lib/conflict-store.ts` reads `details.current_version`; 428 `VERSION_REQUIRED` has its own message.
- Import templates (item 7): `features/masters/api.ts` (`useImportTemplate` → `GET /masters/{path}/import-template`,
  `describeTemplateColumns`, `unknownColumnLines`), `CsvImportDialog.tsx` (header/types/notes/example from the API, download the
  server's CSV, `IMPORT_UNKNOWN_COLUMNS` suggestions, `ignored_columns`; template buttons 48 px on phones), `masterConfig.ts` /
  `types.ts` (hand-kept column lists removed — with them the wrong names such as `default_amount`, `base_price`, `flat_type_code` and the flattened payment-plan installment columns the importer never accepted).
- Performance (item 8): `vite.config.ts` (no catch-all vendor chunk: `react`, `query`, `ui` first-load chunks, lazy `charts` chunk with
  recharts' redux/immer/decimal.js deps, the rest split by Rollup; `@kkt/contracts` side-effect free for tree-shaking; `manifest: true`;
  `KKT_API_PROXY_TARGET` for same-origin previews), `scripts/bundle-budget.mjs` + `.d.mts` (new), `package.json` (`build` runs the
  budget, new `budget` script), `index.html` + `src/lib/fonts.ts` (Google Fonts preloaded, applied after first paint).
- Other contract follow-ups: `features/admin/PermissionMatrix.tsx` → `GET /roles/permissions`;
  `features/crm/customer/EraseCustomerDialog.tsx` → `POST /admin/customers/:id/erase` (`AdminCustomerEraseResponse`).
- Tests (new): `src/lib/__tests__/money-golden.test.ts`, `resilience.test.ts`, `router.test.tsx`, `version-wiring.test.ts`,
  `bundle-budget.test.ts`, `features/bookings/__tests__/ledger-paging.test.tsx`, `features/masters/__tests__/importTemplate.test.ts`;
  updated `api.test.ts`, `format.test.ts`, `masterConfig.test.ts`.

**apps/portal**

- `src/api/session.ts` (new) — contract C1: web = cookie mode (memory access token, `X-KKT-Session: cookie` + credentials on login /
  refresh / logout, empty refresh body, only the flag `kkt.portal.session` stored, legacy `kkt.portal.refresh` deleted on load);
  native = body mode with the refresh token in SecureStore.
- `src/api/client.ts` — uses the session, Web Lock around cookie refreshes, `If-Match` from a `version`, login body
  `PortalAuthLogin` (optional `company`), `ledgerAll` / `receiptsAll` / `demandsAll` (every page).
- `src/api/paging.ts` (new) — `fetchAllPages`, `ledgerTotals` (C7 `summary` when present, else the last row of the complete ledger).
- `src/api/persistPolicy.ts` (new) — only `notices`, `request-categories` and construction progress are persisted; cache key
  `kkt.portal.cache.v3`, the v2/v1 keys (which held booking and payment data) are deleted on start.
- `src/api/retry.ts` (new) — same retry policy as the ERP; `src/api/versions.ts` (new) — `profileVersion`, `isVersionConflict`.
- `src/api/queries.ts` — persistence allow-list, retry policy, all-pages queries, profile update with version.
- `src/auth/AuthProvider.tsx` — no user snapshot on web (deleted if an old build left one), optional company slug from
  `EXPO_PUBLIC_KKT_COMPANY`; `src/auth/loginFailure.ts` — `COMPANY_REQUIRED` copy.
- `src/lib/errorReporting.ts` (new, pure) + `src/lib/reporter.ts` (new) — C2 reporter (`app: "portal"`, dedupe, sampling
  `EXPO_PUBLIC_CLIENT_ERROR_SAMPLE_RATE`, cap, path only); `src/ui/ErrorBoundary.tsx` (new) — root boundary with a recovery screen
  ("Try again" remounts the tree, "Reload app" on web); `src/app/_layout.tsx` wires both and the web window handlers.
- `src/screens/PaymentsScreen.tsx` (dues via `ledgerTotals`), `src/screens/ProfileScreen.tsx` (sends the profile version when present;
  409 → reload + "changed somewhere else" message).
- `src/lib/format.ts` delegates to `@kkt/contracts` (checkpoint); `README.md`.
- Tests (new): `test/session.test.ts`, `test/resilience.test.ts`, `test/paging.test.ts`, `test/money-golden.test.ts`.

**apps/web** — `lib/format.ts` delegates to `@kkt/contracts/moneyFormat` (checkpoint).

**docs** — `ARCHITECTURE.md` (§8 Front ends), `PERFORMANCE.md` ("ERP bundle"), `qa/erp/browser-qa.cjs` (section `phase7`),
`qa/portal/browser-qa.cjs` (phase-7 block, cache key v3, staff replies send the ticket version), `qa/erp.md`, `qa/portal.md`, new
screenshots (`qa/erp/unsaved-sheet-prompt-1440.png`, `unsaved-settings-prompt-1440.png`, `ledger-rebuilds-1440.png`,
`qa/portal/error-boundary-1440.png`), `apps/erp/README.md`.

Found by the browser walk and fixed in this attempt: the dirty-sheet guard stayed armed after a sheet closed (`SheetContent` stays
mounted; now gated on the Radix content being open, reset by any successful save, untrusted / `aria-hidden` change events ignored —
`components/ui/dirty-close.tsx`, `lib/unsaved.ts`), and the notification bell's accessible name did not contain its visible "99+"
badge above 99 unread (`components/layout/NotificationBell.tsx`).

## Tests and results

| Suite                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kkt/erp test`                                                                                                               | **370/370** in 26 files (was 162 before phase 7). New: money golden (167: every `INR_GOLDEN_CASES` row against contracts, domain, ERP, portal, website + a 2,000-value boundary sweep), resilience (16: unsaved registry/blocker/grace window/save events and the guard gating, chunk reload, C2 reports, retry policy, wiring), router (data router, no `<BrowserRouter>`/`<Routes>`, guard in every form page/sheet/dialog), version wiring (every call to a foundation-listed route carries the version; 428 copy; `current_version`), ledger paging (a 450-row mocked ledger rendered page by page with summary dues, epoch and rebuild link; `fetchAllPages` reads 450 demands in three pages and stops at the ceiling), import templates (read from the API, column descriptions, `IMPORT_UNKNOWN_COLUMNS` lines, no hand-kept lists), bundle budget (analysis on a synthetic manifest, build wiring, heavy pages lazy, fonts not blocking) |
| `pnpm --filter @kkt/portal test`                                                                                                            | **69/69** in 8 files (was 13). New: session (cookie vs body mode, nothing token-like stored, legacy key deleted, clear/expiry), persistence allow-list (16 sensitive keys refused, v3 key, old keys deleted, no user snapshot on web), versions, retry policy, C2 reporter (valid `ClientErrorReportSchema` body, dedupe, sampling, cap, never throws, window listeners), ErrorBoundary wiring, paging (450-row ledger in three pages, empty page / ceiling stop, `summary` preferred)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm --filter @kkt/contracts test`                                                                                                         | 244/244 (incl. `moneyFormat.test.ts`, 41)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm --filter @kkt/domain test`                                                                                                            | 139/139                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm --filter @kkt/web test`                                                                                                               | 36/36                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| typecheck erp, portal, contracts, web, domain; ESLint `--max-warnings 0` erp, portal, contracts, web; Prettier on every touched source file | green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm --filter @kkt/erp build` (tsc + vite build + bundle budget)                                                                           | green; first load 258.7 KB JS gzip (budget 275)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Portal web export (`expo export --platform web`)                                                                                            | green (entry 295 KB + `__common` 419 KB gzip — unchanged, the portal bundle was not in this task)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ERP browser QA, full walk, fresh seed (API :4710 on `kkt_p7_fe` / Redis 12, preview :5710)                                                  | **585 page checks, 209/209 assertions, 0 console errors, 0 failed requests, no overflow, 0 small primary targets; axe 534 scans, 1 serious** (scrolled-table `target-size`, runner fixed) → re-run `money,phase7`: 81 checks, 64/64, **0 defects, axe 0 serious/critical** (after the bell fix)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Portal browser QA (export on :8710 with a same-origin `/api` proxy)                                                                         | **50 page checks, 97 assertions, 0 defects, 0 console errors, 0 failed requests; axe 50 scans, 0 violations**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

API integration and acceptance suites were not run: this track changed no API code (`kkt_p7_fe` was used for the QA stack; `kkt_p7_fe_acc`
was created and is unused).

## Item by item

1. **Ledger** — dues (Cash, Account, Total, Other charges) come from `summary` (current epoch) or `epoch_totals` (an older epoch), never
   a row. Ledger pages of 100 with explicit pagination and totals; demands and payments tabs paginate too (no 200 cap); the epoch
   label "Epoch n (current)" / "of m (superseded)", an epoch switcher and the rebuild history (`/ledger/rebuilds`: from → to, reason,
   actor, time, before/after totals, differences). `DEMAND_VOIDED` and `LEDGER_RESTATED` rows render. The portal reads every ledger
   page and uses `summary` when the portal ledger sends one.
2. **Unsaved edits** — data router; one blocker host; `useUnsavedChangesGuard(dirty)` in every form page; every sheet/dialog asks before
   Esc / outside click / close button; Settings blocks navigation while it shows "Unsaved changes". A successful save opens a 1.5 s
   grace window (save → navigate to the new record) and resets "any edit" tracking of an open drawer.
3. **Money** — one BigInt formatter in contracts; the ERP, portal and website delegate to it; the domain runs the same algorithm; the golden
   table covers 0, ±1/49/50 paise, 99,999 paise, ₹99,999.49/50, ₹1 L, ₹45 L, ₹99,94,999, ₹99,95,000, ₹99,96,000 → ₹1 Cr,
   ₹1,00,00,000, ₹1,20,00,000, ₹1,25,00,000, ₹100 Cr, negatives and `Number.MAX_SAFE_INTEGER`; no K unit.
4. **Errors** — ERP boundary, route error page, window error / unhandledrejection → C2 (dedupe, sampling, cap 10, path only); chunk-load
   recovery (one reload per minute, guarded by sessionStorage); portal root ErrorBoundary with recovery screen + C2 (web also window
   handlers); retries: never 4xx, 429/503 after Retry-After (≤ 30 s, twice), otherwise once (ERP) / twice (portal).
5. **Sessions** — C1 cookie transport in the ERP and portal web; access token in memory; restore on load by refresh; Web Lock across
   tabs; native portal keeps SecureStore + body mode; nothing token-like in localStorage (legacy keys deleted); the portal persists
   only notices, request categories and construction progress, and keeps no user snapshot on web.
6. **Versions** — every ERP call to a foundation-listed route sends `If-Match: "v<n>"` or the body version from the loaded row (pinned
   by `version-wiring.test.ts`); 409 `VERSION_CONFLICT` opens the reload prompt (`VersionConflictHost`), 428 has its own message. The
   portal has no version-required endpoint; it sends the profile's `version` as If-Match when the API includes one and handles 409 with
   a reload + message.
7. **Import templates** — from `GET /masters/{path}/import-template`; the dialog shows the server's header, types, enum values, notes and
   example, downloads the server's CSV, explains `IMPORT_UNKNOWN_COLUMNS` with suggestions and lists `ignored_columns`.
8. **Performance** — before/after in `docs/PERFORMANCE.md` ("ERP bundle"): first-load JS 350.4 → 258.7 KB gzip (−26 %), the 153 KB gzip
   catch-all vendor chunk gone, recharts' dependencies moved into the lazy charts chunk, contracts tree-shaken, fonts no longer
   render-blocking; budget script run by `pnpm build` and tested.

## Decisions (with reasons)

- **The portal persists an allow-list, not nothing.** SPEC asks that the portal "opens instantly" from cached data; the task forbids
  persisting booking, payment, demand, KYC and document data. Notices, request categories and construction progress carry no money or
  personal data, so they keep the instant open; every money/profile screen shows a skeleton on a cold start and is instant within a
  session (memory cache).
- **No user snapshot on the web.** It held name, phone and e-mail in localStorage; the cookie refresh restores the session in one round
  trip, so the shell waits for it instead. Native keeps the snapshot (app sandbox, like SecureStore's token).
- **Company slug for the portal comes from the build (`EXPO_PUBLIC_KKT_COMPANY`), not a login field.** A customer app is branded per
  builder; a host-mapped or single-company install needs nothing. The ERP asks for a company code only after 400 `COMPANY_REQUIRED`.
- **Dirty tracking by "any trusted edit" for sheets/dialogs without their own flag**, gated on the content being open and reset by any
  successful mutation. Forms with react-hook-form pass `formState.isDirty` where it was cheap; the heuristic covers the rest without
  touching ~60 dialogs, and `guardUnsaved={false}` opts a read-only drawer out.
- **Same-origin previews for QA.** Production serves the API under `/api` on each front-end host, so the C1 cookies are same-origin there.
  The QA stacks reproduce that (`KKT_API_PROXY_TARGET` for `vite preview`, a proxying SPA server for the portal) instead of relying on
  cross-origin CORS with credentials, which `apps/api/src/app.ts` does not allow yet (see Needs 1).
- **Bundle splitting without new packages:** `manualChunks` only for libraries every page needs (react, react-query, the Radix/sonner UI
  shell) and a lazy charts chunk; Rollup places the rest next to the lazy pages. `@kkt/contracts` is declared side-effect free in the ERP's
  Rollup options rather than in contracts' package.json (not mine), which has the same effect for the ERP bundle.
- **Fonts:** kept Google Fonts (self-hosting needs downloaded font files, which the rules forbid); preloaded and applied from `main.tsx`
  after the first paint (CSP `script-src 'self'` rules out an inline `onload`).
- **Domain money keeps its own copy** of the algorithm (packages/domain must not depend on contracts); the golden table plus a 2,000-value
  sweep in the ERP tests pins both to identical output.

## Needs from other tracks

1. **apps/api/src/app.ts (platform/security)** — CORS for C1 (already listed by security and platform): `credentials: true` and
   `allowedHeaders` += `X-KKT-Session`, `x-kkt-company`. Production is same-origin and does not need it; local dev with the ERP on
   :5173 talking to the API directly (`VITE_API_URL=http://localhost:4000`) and Expo web on :8081 does, otherwise their cookie
   login/refresh fail CORS. (Dev without it: build/preview with `VITE_API_URL=""` + `KKT_API_PROXY_TARGET`.)
2. **packages/contracts/src/modules/portal.ts** — add `version: z.int()` to `PortalProfileResponseSchema` (and send it from
   `apps/api/src/modules/portal/profile.ts`, which already honours If-Match); the portal then sends it automatically
   (`src/api/versions.ts`). Also `PortalLoginSchema.company` / optional `PortalRefreshSchema.refresh_token` (security Needs 7) — the
   portal already uses `PortalAuthLoginSchema` from auth.ts.
3. **apps/api/src/modules/portal/bookings.ts (`portalLedger`)** — read the current epoch only (money Needs 1) and, ideally, return the C7
   `summary` like the staff ledger; the portal prefers `summary` when present.
4. **packages/contracts/package.json** — optional `"sideEffects": false` so every consumer (not only the ERP's Rollup config) can
   tree-shake unused schema modules.

## Contract shapes the frontends rely on

- C1 as specified; the ERP stores only `localStorage["kkt.erp.session"] = "1"`, the portal web only `kkt.portal.session = "1"` and
  `kkt.portal.cache.v3` (notices, request categories, construction).
- C2 bodies: `{app: "erp" | "portal", message: "<Name>: <message>" (≤ 2048), stack? (≤ 8192), url: origin + path, release, user_agent?,
extra: {source: "boundary"|"route"|"window"|"unhandledrejection", component_stack?, status?, code?, request_id?, platform? (portal)}}`.
- C6: `If-Match: "v<version>"`; 409 reads `details.current_version`.
- C7: `LedgerResponse` = list envelope + `epoch`, `current_epoch`, `summary`, `epoch_totals`; `GET /bookings/:id/ledger/rebuilds`.
- Import template: `MasterImportTemplate {kind, path, key_field, columns[{name, required, type, values?, key}], header, example, csv,
notes}`.
- Env: ERP `VITE_CLIENT_ERROR_SAMPLE_RATE`, `VITE_RELEASE`, build-time `KKT_API_PROXY_TARGET` (preview/dev proxy only); portal
  `EXPO_PUBLIC_CLIENT_ERROR_SAMPLE_RATE`, `EXPO_PUBLIC_RELEASE`, `EXPO_PUBLIC_KKT_COMPANY`.

## Not done / notes

- The portal web bundle (≈ 714 KB gzip first load) was not reduced; item 8 covered the ERP. Splitting expo-router screens and trimming
  react-native-web is the next step.
- Lighthouse / Web Vitals (RUM) measurement was not added (no new packages); the bundle budget is the CI gate.
- The ERP first `pnpm build` failed twice transiently while other agents edited shared packages in the same checkout; immediate re-runs
  were green (the failure output was not captured).
- Nothing was installed or downloaded.
