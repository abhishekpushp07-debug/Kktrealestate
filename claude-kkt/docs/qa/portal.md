# Browser QA — customer portal (`apps/portal`, Expo web export)

**Date:** 2026-10-25 · **Build:** `EXPO_PUBLIC_API_URL=http://localhost:4200 npx expo export --platform web` (static export, served by a 20-line Node SPA server on :8081) · **API:** `@kkt/api` on :4200 with the demo seed on a dedicated database `kkt_qa_portal` (Redis db 15) · **Browser:** Playwright Chromium (headless), viewports **1440×900** and **390×844** (mobile emulation + touch) · **Script:** `docs/qa/portal/browser-qa.cjs` (Playwright, ~600 lines).

**Result of the final run: 40 screenshots, 0 defects, 0 console errors, 0 failed requests, no horizontal overflow at 390 px, 90/90 related API integration tests green** (`auth`, `portal`, `portal-adversarial`, `service`, `seed`). `pnpm --filter @kkt/contracts|@kkt/api|@kkt/portal typecheck` green; `expo export --platform web` green.

## Phase 7 frontend review 2026-10-27

Stack: API on `:4730` (fresh demo seed in `kkt_p7_rfrontend`, Redis db 24, after the ERP walk), web export
`EXPO_PUBLIC_API_URL=http://localhost:8730 npx expo export --platform web` served on `:8730` by a static SPA server that proxies `/api` to
the API (same origin). Runner: `PORTAL_URL=http://localhost:8730 API_URL=http://localhost:4730 PORTAL_DB=kkt_p7_rfrontend OUT_DIR=<outside
the repo> node docs/qa/portal/browser-qa.cjs`.

**Result: 50 page checks, 99 assertions, 0 defects, 0 console errors, 0 failed requests, no overflow; axe 50 scans, 0 violations.** New
in the phase-7 block (1440 px): the first `POST /portal/auth/logout` is answered 401 `TOKEN_EXPIRED` (an access token that expired while
the app was open); the client refreshes and logs out again (204), `kkt_prt` is cleared and the sign-in page shows. Before the review's
fix the logout was sent without a refresh, so the session and the HttpOnly cookie survived the sign-out.

## Phase 7 frontend track 2026-10-27

Stack: API on `:4710` (demo seed in `kkt_p7_fe`, Redis db 12, the same instance the ERP walk used before), web export
`EXPO_PUBLIC_API_URL=http://localhost:8710 npx expo export --platform web` served on `:8710` by a static SPA server that proxies
`/api` to the API (same origin, as `my.<domain>` behind Caddy, so the HttpOnly `kkt_prt` cookie of contract C1 applies). Runner:
`PORTAL_URL=http://localhost:8710 API_URL=http://localhost:4710 PORTAL_DB=kkt_p7_fe OUT_DIR=<outside the repo> node docs/qa/portal/browser-qa.cjs`.

**Result: 50 page checks, 97 assertions, 0 defects, 0 console errors, 0 failed requests, no overflow, no primary target under 48 px;
axe 50 scans (25 + 25), 0 violations.** Runner updates: staff replies send the ticket version (`If-Match`, now required), the
"New" status filter is matched exactly (a request left by an interrupted run is also named "New …"), the cache key is v3.

New phase-7 block (both widths, Pooja Mishra):

| Check | Result |
| --- | --- |
| Refresh token | `kkt_prt` cookie, HttpOnly, SameSite=Strict, Path=/api/v1/portal/auth |
| Browser storage | only `kkt.portal.session` (flag) and `kkt.portal.cache.v3`; no token, no `kkt.portal.user`, no `kkt.portal.refresh`, no v2 cache |
| Persisted cache | after opening Payments → Ledger, the persisted cache holds no booking number, amount, due, receipt, PAN or phone |
| Ledger | read through the paged `/ledger` calls (all 200) |
| Reload | restores the session through the cookie (booking A-803 on screen) |
| ErrorBoundary | a malformed home answer crashes the render → recovery screen (`error-boundary-1440.png`) and `POST /api/v1/client-errors` → 202; "Try again" (which drops the query cache) recovers once the data is good |

## Integration stage 2026-10-26 (phase 5 frontend wiring)

Stack: API on `:4600` (demo seed in `kkt_h6`, Redis db 22), `EXPO_PUBLIC_API_URL=http://localhost:4600 npx expo export --platform web` served by a static SPA server on `:8681`; runner `PORTAL_URL=http://localhost:8681 API_URL=http://localhost:4600 PORTAL_DB=kkt_h6 node docs/qa/portal/browser-qa.cjs`.

**Result: 40 screenshots, 0 defects, 0 console errors, 0 failed requests, no overflow, no primary target under 48 px; axe 46 scans (23 at 1440 px, 23 at 390 px), 0 violations.** New check (390 px): the runner marks the portal's `/bookings` and `/home` responses with `Deprecation: @1798761600` / `Sunset` (no v1 route is deprecated today) and expects the non-blocking **"Update available … Please update the app"** notice with the sunset date, which can be dismissed (`update-notice`).

Wired in this stage (unit tests in `apps/portal/test/hardening-wiring.test.ts`): request and trace ids on errors (`error.trace_id` / `X-Trace-Id`, `X-Request-Id`) shown under error panels as "Ref … · trace …"; 410 `GONE` asks for an app update; a 429 at sign-in (also the parallel-attempt lockout budget) reads "Too many attempts. Try again in a moment / in N seconds" (the Sign in button is disabled while a request is in flight); Zod runs JIT-less so the web build's CSP sees no `new Function` probe. Other-charge demand bells already arrive with `screen: "DEMANDS"` from the API.

## Re-run 2026-10-26 (phase 5 frontend-quality track)

Stack: API on `:4500` (fresh demo seed in `kkt_h5`, Redis db 20), `EXPO_PUBLIC_API_URL=http://localhost:4500 npx expo export --platform web` served by the SPA server on `:8581`. Runner env: `PORTAL_URL`, `API_URL`, `PORTAL_DB` (database used to restore the seed password at the end), `OUT_DIR`, `AXE=0` to skip the scans. Primary targets (tab bar and main action buttons) are now checked at **48 px** on phones and reported as defects below that.

**Result: 40 screenshots, 0 defects, 0 console errors, 0 failed requests, no overflow, no primary target under 48 px; axe-core: 45 scans (23 at 1440 px, 22 at 390 px), 0 violations.** New assertions: the login inputs carry their labels as accessible names; a failed sign-in is announced through a `role="alert"` live region; on "Raise a request" an empty submit leaves the Subject input `aria-invalid="true"` with `aria-describedby` pointing at its `role="alert"` error.

### Accessibility (axe)

`docs/qa/axe.cjs` (axe-core 4.14.0, WCAG 2.0/2.1/2.2 A + AA, reduced motion emulated while scanning). The first scans of the unchanged portal found on every screen a missing document `<title>`, plus `label-content-name-mismatch` (booking chip, "More" tab with its unread badge), `nested-interactive` (pressable home cards containing "Timeline"/"Schedule" buttons), `target-size` (18 px card-header links), `image-alt` (expo-image `<img>` without `alt`), `aria-progressbar-name` (construction ring), `aria-required-parent` (segmented-control tabs outside a `tablist`), `aria-required-attr` / `aria-input-field-name` (rating stars as an unnamed `slider`), `autocomplete-valid` (`autocomplete="password"`), `color-contrast` (gold700 labels 3.46:1) and `scrollable-region-focusable` (tables and text-only screens). Fixes:

| Rule | Fix |
|---|---|
| document-title | `<title>` in `+html.tsx`; `useDocumentTitle()` sets "Screen · KKT Customer Portal" from every `Header` and the six header-less tab screens |
| label-content-name-mismatch | booking chip named by its visible text (button only when there is more than one booking); the "More" tab's unread badge sits outside the tab (`aria-hidden`), the tab is named "More, N unread" |
| nested-interactive | inside a pressable `Card`, `CardHeader` renders its action as text (the card is the button) |
| target-size | card-header and section actions are 44 px tall pressables; `Button` `sm` is 48 px; segmented control 48 px; rating stars 48 px |
| image-alt | `accessibilityLabel` on every expo-image (empty for decorative thumbnails inside labelled buttons, "Floor plan", the photo caption in the lightbox) |
| aria-progressbar-name | `ProgressRing` has an accessible name ("Construction progress") and an integer `aria-valuenow` |
| aria-required-parent | `SegmentedControl` containers are `role="tablist"` |
| aria-required-attr / aria-input-field-name | editable rating = `radiogroup` of five `radio` stars (`aria-checked`); read-only rating = one image "4 out of 5 stars" |
| autocomplete-valid | `current-password` on the login password |
| color-contrast | `goldText` token (#7F6312) for gold text and the gold chip |
| scrollable-region-focusable | the screen scroller and wide tables are focusable on web |

Form accessibility (`src/ui/Field.tsx`): every `TextInput` gets its label as `accessibilityLabel` (`aria-label` on web), `aria-invalid` + `aria-describedby` (→ error, else hint) on web and `accessibilityHint` on native; the error text is an assertive live region (`role="alert"` on web, `accessibilityLiveRegion` on Android, `AccessibilityInfo.announceForAccessibility` on iOS). Danger/warning `Notice`s and error toasts are alerts too; other toasts are polite status regions. Label-less fields (request reply, rating comment, reopen reason) carry explicit labels.

Contrast: `node docs/qa/contrast.mjs portal` → **53/53** token pairs pass (enforced by `apps/portal/test/contrast.test.ts`) (see `docs/qa/contrast-results.md`; `inkSubtle` #8B95A5 → #636A76, `warning` → #995B00, `success` → #1B7546, new `goldText` and `dangerOnNavy`). Review pass: field borders were exempted as "informational" at 1.54:1 (`lineStrong`), the sign-in fields on navy had a 2.24:1 border (white/25) and a focused field on white turned plain gold (2.42:1) — new `fieldBorder` #857F72 (3.98:1 on white, 3.47:1 on surfaceMuted), `fieldBorderOnNavy` white/50 (4.51:1 against the field fill), focused border `goldText` on light surfaces, `dangerOnNavy` for invalid fields on navy. Sign-in: only `INVALID_CREDENTIALS` (or a code-less 401) shows the generic "don't match" copy; any other code — e.g. 401 `USER_INACTIVE` "Portal access is disabled" after a correct password — shows the server's message (`src/auth/loginFailure.ts`, `test/loginFailure.test.ts`); change-password maps only `INVALID_CREDENTIALS` to "current password is incorrect". Re-run after the change: 45 axe scans, 0 serious/critical, 40 screenshots, 0 defects.

## Customers walked

| Customer | Phone | Why |
|---|---|---|
| Rajesh Kumar Sinha | 9876543210 | the ₹1 Cr worked example — Completed booking, 12 receipts, 10 demands, 24 ledger rows, 14/14 stages, closed ticket |
| Pooja Mishra | 9876543219 | Active booking A-803 (Standard CLP) with a co-applicant, parking B1-07, two shared documents |
| Sanjay Jha | 9876543220 | co-applicant on Pooja's booking — same screens through the co-applicant role, isolation probes |

Staff actions needed by the flows (reply, internal note, resolve) were made through the ERP API as `admin@sgb.in`.

## Per-page checks (every page, both widths)

On every page the script asserts: zero `console.error` / page errors, zero failed requests (HTTP ≥ 400 or network failure) other than the deliberate 4xx probes listed below, `document.documentElement.scrollWidth <= window.innerWidth` at 390 px, on phones the tab bar sits at the bottom of the viewport (`[role=tablist]` 776–844 of 844) and the scrolled content ends above it, and it records every visible interactive element shorter than 44 px. Screenshots are palette-compressed PNGs of the viewport, all ≤ 73 KB (`docs/qa/portal/<page>-<width>.png`).

| Page | 1440 | 390 | What was exercised |
|---|---|---|---|
| login | ✅ `login-1440.png` | ✅ `login-390.png` | hero + card layout; wrong password → "Sign-in failed" banner (deliberate 401); "Staff? Go to ERP" link; sign-in lands on home |
| home | ✅ `home-1440.png` | ✅ `home-390.png` | greeting, hero card (status + role chips, flat, "Floor 1 · 4BHK Villa"), progress ring 100 % + current stage, plan card, next-installment card (none for the completed booking; "Excavation ₹3,14,987.50 · Cash/Account" for A-803), Paid/Due/Advance 3×2 grid, notices strip (count or caught-up), quick actions, RM card; desktop: sidebar + no tab bar; phone: tab bar + no sidebar |
| home (co-applicant) | ✅ `home-coapplicant-1440.png` | ✅ (no shot, budget) | Sanjay sees A-803 with the "Co-applicant" chip and identical money/ring data |
| my flat | ✅ `flat-1440.png` | ✅ `flat-390.png` | rooms & sizes (table / card list), area statement, parking (B1-07 for A-803), price breakup + agreement value, revisions ("No changes since booking"), specifications; floor-plan placeholder (seed has no floor-plan image, see open items) |
| payments · receipts | ✅ `payments-receipts-1440.png`, `receipt-viewer-1440.png` | ✅ `payments-receipts-390.png` | 12 receipts incl. other charges; **View** opens the in-app viewer (iframe) and the signed link streams `200 application/pdf`; **Download** triggers a browser download (`receipt-SGB-2627-0011.pdf`) |
| payments · ledger | ✅ `payments-ledger-1440.png` | ✅ `payments-ledger-390.png` | summary card (cash/account paid, due, total due ₹0 settled); table on desktop, card rows with "Total due after this" on phones |
| payments · demands | ✅ `payments-demands-1440.png` | ✅ `payments-demands-390.png` | DM- rows with cash/account split, due-date copy, letter PDF streams 200 |
| payments · schedule | ✅ `payments-schedule-1440.png` | ✅ `payments-schedule-390.png` | "100 % paid · 10 of 10 installments settled", timeline rail, status chips |
| construction | ✅ `construction-1440.png` | ✅ `construction-390.png` | 14/14 stages timeline, 28 buyer-visible thumbnails (22 image requests, all 200 image/webp via signed links); 2-photo stages for A-803 (Tower A, 43 %) |
| construction photo viewer | ✅ `construction-lightbox-1440.png` | ✅ `construction-lightbox-390.png` | tap thumbnail → full-screen viewer "1 / 2", next photo, zoom in, Escape / close |
| documents | ✅ `documents-1440.png` | ✅ `documents-390.png` | statement + allotment letter (generated), shared docs (plan acceptance; "Allotment letter – A-803", "Agreement for sale – A-803"); shared doc opens via a signed link |
| requests list | ✅ `requests-1440.png` | ✅ `requests-390.png` | status filter segments, seeded closed ticket with its rating, "New" |
| raise request | ✅ `request-new-1440.png` | ✅ `request-new-390.png` | category sheet → default priority chip, subject/description, **photo attached through the file chooser (1/10)**, submit → `SR-2627/00xx` |
| request detail | ✅ `request-detail-1440.png` | ✅ `request-detail-390.png` | photo on the opening message (thumb + signed full-size `url`), reply with a second photo, attachment opens in the viewer, staff public reply visible, **internal staff note never rendered**, Resolved → "Reopen request" sheet → reopened, Resolved again → 4-star rating with comment → Closed with "Your rating" |
| notices | ✅ `notices-1440.png` | ✅ `notices-390.png` | company-wide + project notices with unread marker; detail renders the markdown body and "Published …" |
| notifications | ✅ `notifications-1440.png` | ✅ `notifications-390.png` | unread count incl. "Reply on your request SR-…", tap navigates to the right screen (notice detail), mark-all-read → "You're all caught up", API `unread-count` = `{count: 0}` |
| profile | ✅ `profile-1440.png` | ✅ `profile-390.png` | **PAN `XXXXX1234K`, Aadhaar `XXXX XXXX 0124` masked** (no unmasked PAN anywhere on the page), KYC chip, alternate-phone edit → "Profile updated" (audited as CUSTOMER) and reverted; co-applicants card (Pooja ↔ Sanjay, see fixes) ; RM card |
| change password | ✅ `password-1440.png` | ✅ (no shot) | weak password refused client-side; change to a fresh password → "Password updated", old password 401, new one 200; reusing `Welcome@123` → 422 `PASSWORD_POLICY` "not used in your last 5 passwords" surfaced in the form (deliberate 4xx) |
| devices & sessions | ✅ `sessions-1440.png` | ✅ (no shot) | current device chip, revoke one → "Signed out on that device", "Sign out all other devices" confirm → "Other devices signed out" |
| bank details | ✅ `bank-details-1440.png` | ✅ `bank-details-390.png` | account name/bank/number/IFSC, copy IFSC → "IFSC copied" (clipboard) |
| more hub | — (sidebar on desktop) | ✅ `more-390.png` | profile card, services, account, sign-out dialog |
| not-found | ✅ `not-found-1440.png` | ✅ (no shot) | unknown route → "+not-found" screen with "Go home" |

### Isolation (deliberate 4xx)
* Pooja opening Rajesh's request id (`/more/requests/<id>`) → API 404 → "Not found" screen, nothing of the other customer rendered.
* Sanjay with a **forged booking id** (Rajesh's booking injected into the `/portal/bookings` response by route interception + cleared cache): every `/portal/bookings/<foreign>/…` call answered **404**, home shows the "Not found" state, no money figures leaked.
* The API sweep (all Appendix C endpoints × 3 customers, validated against the `Portal*` Zod schemas) also confirmed: `home`/`statement.pdf` of another customer's booking → 404; signed file links are bound to the customer.

### Tap targets at 390 px (after fixes)
Since 2026-10-26 every `Button` size is ≥ 48 px, the tab bar items 60+ px, segments and rating stars 48 px, card/section actions 44 px pressables; the runner flags primary targets under 48 px. The 2026-10-25 state was: all primary actions ≥ 44 px: sign in / submit / send / save (46–54), payments segments (44), tab bar items (68), receipt/demand/document **View/Download** (46 on phones), bell (44), booking switcher chip (44), star rating (44), bank copy buttons (44), list rows (≥ 56). Remaining < 44 px elements, all secondary and all with hit-slop or a larger duplicate target: `Back`/header `sm` buttons (40 px box + 4–6 px hit-slop), lightbox icon buttons (40 + 6), card-header text links "Timeline / Schedule / Ledger" (18 px — the whole card is the tap target), "Show password" (16 px + 14 px hit-slop), "Go to ERP" (22 px + 12 px hit-slop), read-only rating stars in the list (14 px, not interactive), "Remove photo" badge (24 px). Text inputs measure 41 px for the `<input>` inside a 46 px field box.

## Verify stage 2026-10-26 (phase 5)

Lint refactors in the portal (skeleton/toast animated values held in state, Reanimated `get()`/`set()` in the zoomable image, the
`?tab=` deep link and the profile reset adjusted while rendering). Stack: API bundle on `:4710` (fresh demo seed in `kkt_h7`, Redis db 23),
`EXPO_PUBLIC_API_URL=http://localhost:4710 npx expo export --platform web` served by an SPA server on `:8710`, `OUT_DIR` outside the repo.
**Result: 0 defects, 46 axe scans with 0 violations, 40 screenshots.** Bells for demands, other-charge lines and payments now carry
their `booking_id`, so opening one switches to its booking.

## Defects found and fixed

| # | Where | Defect | Fix |
|---|---|---|---|
| 1 | `apps/portal/metro.config.js`, `src/api/files.ts → files.tsx` | **The web build bundled the native file module**: `files.web.tsx` never won against `files.ts` because Metro tries platform variants *per extension* (`files.web.ts → files.ts → files.web.tsx`). On web "View" opened a blank popup through `expo-web-browser` and "Download" went through `expo-file-system`; the in-app PDF viewer never existed in the bundle. | renamed the native module to `files.tsx` (same extension as its `.web.tsx` twin) and documented the rule in `metro.config.js` and the README. The viewer, "Open in new tab" and download now work (verified by the 200 PDF stream into the iframe). |
| 2 | `apps/api/src/modules/notifications/index.ts`, `packages/contracts` | `GET /portal/notifications/unread-count` returned `{unread}`; Appendix C and the portal client read `{count}` → the bell/tab badge showed nothing outside the home screen. | new `PortalNotificationCountResponseSchema` (`{count}`), route returns it; tests updated. |
| 3 | `apps/api/src/modules/auth/portal.ts` | `GET /portal/auth/sessions` returned `{items}`; Appendix C additions say bare array (client tolerated both). | bare array; `auth.test.ts` updated. |
| 4 | `apps/api/src/modules/portal/requests.ts`, `queries.ts`, contracts | **Photos attached when raising a request were invisible**: the client created the ticket (JSON) and then uploaded the files, which became ticket documents nobody could see (no message carried them). | `POST /portal/requests/:id/attachments` accepts a `message_id` text part naming one of the customer's own messages (the opening message from the create response); the file is appended to it. The client passes the opening message id and refetches the detail. Integration test added (own message ✔, staff message → 404, bad id → 400); Appendix C additions updated. |
| 5 | contracts `PortalRequestMessage.attachments`, `requests.ts`, `RequestDetailScreen` | The photo viewer for request attachments opened the ≈480 px **thumbnail** full-screen (the API only exposed `thumb_url`). | attachments now carry `url` (signed medium rendition, else original); the viewer uses it. |
| 6 | `apps/api/src/modules/portal/profile.ts` | Profile "Co-applicants" only read the customer-record co-applicants table, so Pooja saw "None added" although Sanjay is the co-applicant on BK-2627/0010 (and Sanjay saw nothing about Pooja). | profile co-applicants now also list the other applicants of the customer's bookings ("Co-applicant on BK-…" / "Primary applicant on BK-…", name + phone only). |
| 7 | `apps/portal/src/api/queries.ts` | After a reload the request detail showed the **stale cached status** (staff had resolved it) because a persisted entry younger than `staleTime` was never refetched; the bookings list likewise. | `refetchOnMount: "always"` (cached data renders instantly, refresh in the background per SPEC §16) and `staleTime: 0` for the bookings switcher list. |
| 8 | `ConstructionScreen`, `MyFlatScreen` | Photo thumbnails / floor plan used `accessibilityRole="imagebutton"`, which react-native-web does not map — no `role` at all for screen readers. | `accessibilityRole="button"` (label kept). |
| 9 | `HomeScreen` hero card | Seeded hero images carry large text; the 5 %→92 % gradient left the flat number and labels sitting on it. | firmer three-stop navy wash (45/78/97 %) so the white labels keep AA contrast on any photo. |
| 10 | `HomeScreen`, `MyFlatScreen`, `lib/format.ts` | Floor label rendered as a bare number ("Block P · 1 · 4BHK Villa"). | `formatFloor()` → "Floor 8", "Basement 1", named floors untouched. |
| 11 | `SegmentedControl`, `Button`, `shared.tsx` `PdfButtons`, `BellButton`, `BookingSwitcher`, `ListRow` `StarRating`, `BankDetailsScreen`, `Field`, `LoginScreen` | Phone tap targets below 44 px for primary actions (segments 32, View/Download 36, bell 40, booking chip 32, rating stars 30, copy buttons 36). | segments 44, `sm` buttons 40 + hit-slop, PDF buttons `md` (46) on phones, bell 44, chip 44, stars 44, copy buttons 44, more hit-slop on the password toggle and ERP link. |

Everything else checked (money figures of the worked example to the rupee, bucket grid, schedule progress, stage timeline, receipts/demand PDFs, documents, request thread rules, notices, notifications routing, profile masking, sessions, bank details, lockout/429 copy paths, not-found, sidebar/tab-bar shell, no overflow) worked as specified without changes.

## Still open

* **Seed:** no floor-plan image is attached to any flat/block/project (`documents` of type FLOOR_PLAN), so "My Flat" always shows the "Floor plan will appear here once shared" placeholder and the zoomable viewer could only be exercised on construction photos / request attachments. Seeded project hero images are text placeholders ("Shree Ganesh Heights · Bailey Road, Patna"), which still look busy behind the hero card at both widths — a cosmetic seed issue, not a code one.
* **Seed:** staff users have no phone, so the RM card shows e-mail only and the "Call"/"WhatsApp" buttons (which render when a phone exists) could not be exercised in the browser.
* `POST /portal/auth/change-password` answers `200 {ok:true}` while Appendix C says 204 — the client accepts both; left as is.
* Passwords: the change-password walk leaves the worked-example customer's password changed on the QA database; the script restores the seed hash afterwards (`Welcome@123` works again), but the password-history rows stay (append-only) — only on `kkt_qa_portal`.
* Native (iOS/Android) code paths — camera picker, share sheet, SecureStore, in-app browser — are outside this browser QA.

## Reproduce

```bash
su postgres -c "psql -c 'CREATE DATABASE kkt_qa_portal'"
cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/kkt_qa_portal REDIS_URL=redis://localhost:6379/15 API_PORT=4200 API_PUBLIC_URL=http://localhost:4200 \
  RUN_MIGRATIONS_ON_BOOT=true SEED_ON_BOOT=true PORTAL_ORIGIN=http://localhost:8081 npx tsx src/server.ts
cd apps/portal && EXPO_PUBLIC_API_URL=http://localhost:4200 npx expo export --platform web   # then serve dist/ with an SPA fallback on :8081
PORTAL_URL=http://localhost:8081 API_URL=http://localhost:4200 PORTAL_DB=kkt_qa_portal node docs/qa/portal/browser-qa.cjs   # Playwright walk + axe scans, rewrites docs/qa/portal/*.png and writes report.json to a temp dir
node docs/qa/contrast.mjs portal       # design-token contrast
```
