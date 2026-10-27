# Phase 7 — adversarial review of the FRONTEND track

Scope: `docs/hardening/phase7-frontend.md` and the audit v3 findings it was assigned — C "ERP ledger", H3 "unsaved edits", H5 "money
short forms", H4 "front-end errors invisible", D1 "browser sessions / PII at rest", F4 "versions" (client side), G1 "import templates",
C9 "frontend performance" — read against `git diff 34c075e`, contracts C1/C2/C6/C7 and the API code they talk to. Databases
`kkt_p7_rfrontend` / `kkt_p7_rfrontend_acc`, Redis 24 / 25; QA stack on ports 4730 (API) / 5730 (ERP preview) / 8730 (portal export).

## Verdict per finding

| Finding                                        | Verdict                       | Notes                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C ERP ledger shows wrong dues on long bookings | **closed** (one defect fixed) | Dues come from the C7 `summary` / `epoch_totals`, the three tabs page through every row, epoch label + switcher + rebuild history work (browser QA). Defect 4 below: switching bookings kept the previous booking's page / epoch and showed its rows and dues while the new one loaded. Portal: open on the API side (cross-track 1).              |
| H3 unsaved edits lost                          | **closed**                    | Data router, one blocker host, sheet/dialog prompts verified in the browser at both widths. Residual (documented, not changed): any successful mutation resets a sheet's "any edit" tracking and opens a 1.5 s grace window for navigation.                                                                                                        |
| H5 money short forms disagree                  | **closed**                    | One BigInt formatter; golden table + 2,000-value sweep across contracts, domain, ERP, portal and website; edge cases re-derived by hand (₹99,95,000 / ₹99,96,000 → ₹1 Cr, ₹99,999.50 → ₹1 L, −49 paise → ₹0, `MAX_SAFE_INTEGER`). No defect.                                                                                                       |
| H4 front-end errors invisible                  | **closed**                    | C2 bodies match `ClientErrorReportSchema` (strict); route/boundary/window reporting, chunk reload guard and Retry-After retries verified. No defect.                                                                                                                                                                                               |
| D1 browser sessions / PII at rest              | **closed after fixes**        | Three defects (1, 2, 3 below): transient refresh failures signed ERP users out, portal sign-out with an expired access token left the session and the HttpOnly cookie alive, and the ERP kept customer names/phones (palette recents) and another user's booking draft in localStorage. Plus defect 5 (a refresh can return another user's token). |
| F4 versions (client side)                      | **closed**                    | Every foundation-listed route the ERP calls sends `If-Match: "v<n>"` / the body version (checked call site by call site and by the full browser walk: no 428 anywhere).                                                                                                                                                                            |
| G1 import templates                            | **closed**                    | The dialog reads `GET /masters/{path}/import-template`; ERP slugs equal the API's paths for all 16 kinds.                                                                                                                                                                                                                                          |
| C9 frontend performance                        | **closed**                    | Rebuilt: first load 259.2 KB JS gzip (budget 275), budget script runs in `pnpm build`.                                                                                                                                                                                                                                                             |

## Defects found and fixed

1. **A transient refresh failure signed the ERP user out** (`apps/erp/src/lib/api.ts`). `refreshSession` treated every 4xx as a dead
   session, so a 429 (the refresh route is rate-limited per IP — an office behind one NAT) or a 409 (refresh-token lock timeout) cleared
   the session; and when the refresh failed for any reason (503, network) `execute` went on to clear the session on the request's own 401. The API was fixed for the same class in the security review (it keeps the cookie for non-401s); the client undid it.
   Fix: `isDeadRefreshStatus` (400/401/403/404 end the session; 408/409/425/429/5xx/network keep it), the transient error is thrown to
   the caller (React Query's Retry-After policy then applies) instead of a token-less retry and a sign-out. Session restore on load
   (`lib/auth.tsx`) retries transient failures with backoff (Retry-After first, ≤ 30 s in all) instead of rendering an "authenticated"
   shell with no user, then falls back to the sign-in page.
2. **Portal sign-out with an expired access token left the session alive** (`apps/portal/src/api/client.ts`). `logout` was sent with
   `noRefresh`; `POST /portal/auth/logout` needs a live bearer, so a customer who left the app open past the access-token lifetime got a
   401 — the refresh family stayed valid server-side and, on the web, the HttpOnly `kkt_prt` cookie stayed in the browser for up to
   `REFRESH_ABSOLUTE_TTL_DAYS` (anyone at that browser could resume the session). Fix: logout refreshes first like any call (also on a
   cold start with only the hint), so the API revokes the family and clears the cookie.
3. **PII and another user's data at rest in the ERP's localStorage** (`apps/erp/src/lib/browserData.ts` new,
   `components/ui/command-palette.tsx`, `features/bookings/wizard/useBookingDraft.ts`, `lib/auth.tsx`). The command palette persisted
   every picked search hit (customer name + phone, bookings, flats) under `kkt.erp.recent` forever, shared by every user of the
   browser — a project-scoped user signing in after an all-projects user saw other projects' customers (SPEC: scoped users must not
   learn other projects exist). The booking wizard's local draft fallback was offered to whoever signed in next. Fix: the palette
   persists navigation entries only (search hits stay in memory; lists written by older builds are purged on load); the user-scoped
   keys carry an owner id (`kkt.erp.owner`) and are wiped when a different user (or an unknown owner) signs in, and on an explicit
   sign-out. A forced sign-out keeps the draft for the same user.
4. **Booking B showed booking A's ledger while loading** (`features/bookings/BookingDetailPage.tsx`, `features/bookings/api.ts`). The
   ledger / demands / payments tabs were not keyed by booking and used `placeholderData: previous`, so moving from one booking to
   another (palette, link, back button) kept A's page, page size and epoch and showed A's rows and C7 dues under B's header until B's
   page arrived (and requested A's epoch for B — a 404 when B has fewer epochs). Fix: the tabs remount per booking (`key={row.id}`) and
   `previousPageOfSameBooking` keeps a previous page only for the same booking.
5. **A refresh can return another user's token** (ERP `lib/api.ts` + `lib/auth.tsx`; portal `api/session.ts`, `api/client.ts`,
   `auth/AuthProvider.tsx`). The refresh cookie is shared by every tab of the origin: after signing out and in as someone else in tab A,
   tab B's next refresh returned user Y's access token and `execute` re-sent B's pending call (e.g. a payment) as Y while B still showed
   X's screens. Fix: the refresh compares the token subject (`sub`, read only for comparison); on a change the pending call is not
   re-sent (409 `SESSION_CHANGED`, client-side code), the app drops the previous user's cache and loads the new user ("user-changed"
   auth/session event).
6. Prettier: two files of the track were not formatted (`ServiceRequestDetail.tsx`, `LoginPage.tsx`; the report said "green").
   Formatted. Stale comment in `apps/portal/src/lib/storage.web.ts` ("refresh token in localStorage") corrected.

## Changes (file list)

- ERP: `src/lib/api.ts` (dead vs transient refresh, `tokenSubject`, `SESSION_CHANGED`, "user-changed" event), `src/lib/auth.tsx`
  (restore backoff, browser-data claim/forget, user switch), `src/lib/browserData.ts` (new), `src/components/ui/command-palette.tsx`
  (`persistRecent`, `storedRecents`), `src/features/bookings/wizard/useBookingDraft.ts` (key from browserData),
  `src/features/bookings/api.ts` (`previousPageOfSameBooking`), `src/features/bookings/BookingDetailPage.tsx` (tabs keyed per booking),
  `src/features/service/ServiceRequestDetail.tsx` and `src/pages/LoginPage.tsx` (Prettier only), `README.md`,
  `src/lib/__tests__/review-phase7.test.ts` (new).
- Portal: `src/api/client.ts` (logout refreshes first; subject check on refresh), `src/api/session.ts` (`tokenSubject`, `SessionEvent`,
  `notifyUserChanged`), `src/auth/AuthProvider.tsx` (user switch), `src/lib/storage.web.ts` (comment), `README.md`,
  `test/client-logout.test.ts` (new).
- QA: `docs/qa/erp/browser-qa.cjs`, `docs/qa/portal/browser-qa.cjs` (review assertions), `docs/qa/erp.md`, `docs/qa/portal.md`.

## Tests added

- `apps/erp/src/lib/__tests__/review-phase7.test.ts` (17): status classification; 429/409/503 and network failures of the refresh keep
  the session and surface the error, no token-less retry, no sign-out event; restore on load (hint only) with a 503; a 401 / TOKEN_REUSED
  still signs out; restore backoff (Retry-After first, capped, ≤ 30 s); another user's token → `SESSION_CHANGED`, no re-send,
  "user-changed"; same user → normal retry; browser data claimed / kept / purged / forgotten; palette persists navigation only and
  purges stored search hits; placeholder kept only for the same booking (ledger, demands, payments keys); tabs keyed per booking.
- `apps/portal/test/client-logout.test.ts` (3, React Native modules mocked): logout after a 401 TOKEN_EXPIRED refreshes and logs out
  again with the cookie transport; cold-start logout restores first; another customer's token → `SESSION_CHANGED`, no re-send,
  "user-changed". Both portal logout tests fail on the track's code (verified by reverting the fix).
- Browser QA: `docs/qa/erp/browser-qa.cjs` phase7 section (+4 assertions per width: a customer picked in the palette is not stored, the
  data names its owner, sign-out leaves no user-scoped key, sign-out clears `kkt_rt`); `docs/qa/portal/browser-qa.cjs` phase-7 block
  (+2 at 1440 px: sign-out after a 401 TOKEN_EXPIRED refreshes and logs out with 204, `kkt_prt` cleared and the sign-in page shown).

## Suites run

| Suite                                                                                                       | Result                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kkt/erp test`                                                                               | **387/387** in 27 files (track 370 + 17 review)                                                                      |
| `pnpm --filter @kkt/portal test`                                                                            | **72/72** in 9 files (track 69 + 3 review)                                                                           |
| `pnpm --filter @kkt/contracts test` / `@kkt/domain` / `@kkt/web`                                            | 244/244 · 140/140 · 40/40 (shared money formatter)                                                                   |
| typecheck + ESLint `--max-warnings 0`: erp, portal; Prettier on `apps/erp`, `apps/portal`, the touched docs | green                                                                                                                |
| `pnpm --filter @kkt/erp build` (tsc + vite + bundle budget)                                                 | green; first load 259.2 KB JS + 15.1 KB CSS gzip (budget 275 / 20)                                                   |
| Portal web export (`expo export --platform web`)                                                            | green                                                                                                                |
| ERP browser QA, full walk, fresh seed (API :4730 on `kkt_p7_rfrontend` / Redis 24, preview :5730)           | **585 page checks, 217/217 assertions, 0 defects, 0 console errors, 0 failed requests; axe 534 scans, 0 violations** |
| Portal browser QA (export on :8730 with a same-origin `/api` proxy, after the ERP walk)                     | **50 page checks, 99 assertions, 0 defects; axe 50 scans, 0 violations**                                             |

The API integration and acceptance suites were not run: this review changed no API code (frontend scope; `kkt_p7_rfrontend_acc` was
created and is unused). The first full ERP walk was stopped and restarted on a fresh seed because the API ran without `API_PUBLIC_URL`
(signed file links pointed at :4000); that was a stack setting, not a defect.

## Decisions

- **Dead vs transient refresh answers** follow the API's own split (`auth/cookies.ts isDeadSession` clears the cookie only on 401):
  the client signs out on 400/401/403/404 and keeps the session otherwise. A permanent 5xx would retry forever only as often as the
  user acts; the restore-on-load loop gives up after ~30 s and shows the sign-in page.
- **Recents keep navigation only** rather than encrypting or per-user-keying search hits: names and phones of customers have no place at
  rest in a shared browser, and a navigation recent list keeps the palette useful.
- **Draft ownership by user id**, not cleared on every forced sign-out: an expired session must not cost the same user an unsynced
  draft; a different user never sees it.
- **Native portal persistence not widened back.** SPEC §16 asks the portal to open instantly from cached data; the phase-7 task forbids
  persisting booking/payment/demand/KYC/document data on any platform, so the track's allow-list stays. Flagged for the owner below.

## Not fixed / residual

- Any successful mutation resets the "any edit" tracking of an open sheet and opens a 1.5 s navigation grace window (track design);
  a sheet that runs a sub-action (upload, inline status change) and still holds unsaved field edits can then close without asking.
  A per-sheet mutation scope would fix it; left as is (low impact, needs a wider refactor of ~60 dialogs).
- SPEC §16 "cached last data so the app opens instantly" now holds only for notices, request categories and construction progress;
  money and profile screens show a skeleton on a cold start (memory cache within a session). Owner decision: allow native
  (sandboxed AsyncStorage) to persist booking screens again, or keep the stricter rule.
- Portal bundle (≈ 714 KB gzip first load) unchanged (out of the track's scope, as reported).

## Cross-track items (exact changes, outside my file set)

1. **apps/api/src/modules/portal/bookings.ts `portalLedger` (money / portal API)** — still reads every epoch:
   `where: eq(ledgerEntries.bookingId, owned.booking.id)` returns the superseded rows too, ordered by `seq`, which restarts at 1 per
   epoch, so after any rebuild the customer sees duplicated, interleaved rows, and the portal's fallback "last row of the complete
   ledger" can be a superseded row (wrong dues on the customer's screen). Change to `where: epochRows(owned.booking.id,
owned.booking.ledgerEpoch)` (from `../money/index.js`) and add the C7 `summary` (`cash_due_paise, account_due_paise, total_due_paise,
other_charges_due_paise, cash_paid_paise, account_paid_paise` from the booking summary, as in `money/routes/bookings.ts` GET
   `/bookings/:id/ledger`) to the response; `PortalLedgerResponseSchema = listEnvelope(PortalLedgerRowSchema).extend({ summary:
LedgerTotalsSchema.optional() })` in `packages/contracts/src/modules/portal.ts`. The portal already prefers `summary`
   (`apps/portal/src/api/paging.ts ledgerTotals`). Same item as the money review's cross-track 1.
2. **docs/ARCHITECTURE.md §8 (owner of docs)** — "browser storage holds only a 'signed in on this browser' flag" → add: "the ERP also
   keeps an owner id (`kkt.erp.owner`), layout preferences, navigation recents and the booking wizard's local draft, all wiped when
   another user signs in and on sign-out; customer/booking search hits are never stored". And under Sessions: "a refresh answer of
   409/429/5xx keeps the session (only 400/401/403/404 sign out); a refresh that returns another user's token is not used for the
   pending call (the tab reloads its user)".
3. **apps/api/src/app.ts CORS (platform)** — still open from the track and the security review: `credentials: true` and
   `allowedHeaders` += `X-KKT-Session`, `x-kkt-company` for cross-origin ERP/portal deployments and local dev on two ports.
4. **Optional, packages/contracts/src/errors.ts** — `SESSION_CHANGED` is a client-side code (409) raised by the ERP and portal API
   clients, never by the API; add it to the error registry only if the API ever needs it.

## Contract shapes the frontends rely on (unchanged by this review)

C1 as specified (`kkt_rt` / `kkt_prt`, `X-KKT-Session: cookie`, body mode on native); C2 `ClientErrorReport`; C6 `If-Match: "v<n>"`,
409 `details.current_version`, 428 `VERSION_REQUIRED`; C7 `LedgerResponse` (`epoch`, `current_epoch`, `summary` with the six totals,
`epoch_totals`) and `GET /bookings/:id/ledger/rebuilds`. Client-side only: `SESSION_CHANGED` (409) and the auth events
`"unauthenticated" | "user-changed"`.
