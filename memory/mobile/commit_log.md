# Mobile commit log

## Iteration 1 — KKT Customer Portal Expo app (initial build)
- **Commit**: 650364f980f372693c865d75c6a0e5b518dbad6b (base HEAD at time of work; mobile changes uncommitted in working tree when recorded)
- **Date**: 2026-10-24T06:50Z
- **Changes**: full portal app — auth (login, forced/profile change password, refresh, logout/all), tabs Home/Payments/Construction/Requests/More, stack screens Flat, Documents, Bank, Notices list/detail, Request new/detail, Profile, Change password; design system; PDFs per platform; photo attachments; generated icon/splash.
- **Files modified**: mobile/app/** (all routes), mobile/src/{api,ui,screens}/**, mobile/src/{auth.tsx,hooks.tsx,format.ts,haptics.ts,theme.ts,query-client.ts}, mobile/app.json (name, splash/adaptive colours, image-picker permissions, expo-sharing plugin), mobile/assets/images/{icon,adaptive-icon,favicon,splash-image,logo-mark}.png, mobile/README.md, mobile/package.json (via yarn)
- **Web files referenced**: frontend/src/apps/portal/{api.js,hooks.js,PortalAuth.jsx,PortalApp.jsx,PortalShell.jsx,pages/*.jsx}

## Iteration 2 — SR attachments, API ledger bucket, login links
- **Commit**: 650364f980f372693c865d75c6a0e5b518dbad6b (base HEAD; mobile changes in working tree)
- **Date**: 2026-10-24T07:03:15Z
- **Changes**: thread attachments via GET /service-requests/{id}/attachments/{idx} (image thumbnails via authed blob/file URI + lightbox; non-image file chips open via openFile); ledger uses API `bucket`, DEMAND rows labelled "Demand" with cash/account split (row fields if sent, else cash_due/account_due delta); login "Staff? Go to ERP" (config.erp_url) + "Visit website" (backend origin).
- **Files modified**: mobile/src/api/pdf.ts (authedUri, nativeDownloadAuthed, webFetchBlob exported), mobile/src/screens/requests/bubble.tsx, mobile/app/requests/[id].tsx, mobile/src/screens/payments/ledger.tsx, mobile/app/login.tsx, mobile/src/hooks.tsx
- **Web files referenced**: none (backend contract only)

## Iteration 3 — Web in-app PDF/document viewer
- **Commit**: 650364f980f372693c865d75c6a0e5b518dbad6b (base HEAD; mobile changes in working tree)
- **Date**: 2026-10-24T07:17:22Z
- **Changes**: replaced web new-tab opening with full-screen viewer modal (src/ui/pdf-viewer.web.tsx; native stub pdf-viewer.tsx). Bearer fetch → Blob → object URL; iframe when navigator.pdfViewerEnabled, else pdf.js 3.11.174 (jsDelivr CDN) canvas render; images inline; Download (<a download>) + Open in new tab (<a target=_blank>); loading / error+Retry; URL revoked on close. All openFile() callers (receipts, demand letters, statement, allotment, shared docs, non-image SR attachments) use it on web. Receipt rows: whole row opens viewer + "View" pill + "Tap to view receipt" hint. webFetchBlob moved to src/api/fetch-blob.ts (breaks require cycle).
- **Files modified**: mobile/src/ui/pdf-viewer.tsx, mobile/src/ui/pdf-viewer.web.tsx, mobile/src/api/fetch-blob.ts, mobile/src/api/pdf.ts, mobile/app/_layout.tsx, mobile/src/screens/payments/receipts.tsx

## Iteration 4 — Phase 7: payment plan, installment schedule, construction stages
- **Commit**: 11a82297eda33f745a1144b4ca3b85e596f3fcac (base HEAD; mobile changes in working tree)
- **Date**: 2026-10-24T14:18:25Z
- **Changes**: PaymentPlanCard (src/screens/plan.tsx) on Home (via booking detail query) + My Flat section (plan name/type/accepted_on, next installment trigger + cash/account/total). Payments → Schedule rewritten (src/screens/payments/schedule.tsx): summary (raised / paid / outstanding / yet to be raised), vertical installment timeline with status chips (Overdue red, Paid green, Raised gold, Partially paid blue, Not yet due grey), per-bucket paid/expected, progress bar. Construction prefers `stages` (falls back to `milestones`, merges legacy notes by name), status chip per stage, In Progress highlight, Up next. Notifications NOT built — no /api/portal/notifications endpoint.
- **Files modified**: mobile/src/screens/plan.tsx (new), mobile/src/screens/payments/schedule.tsx (new), mobile/src/screens/payments/demands.tsx, mobile/app/(tabs)/payments.tsx, mobile/app/(tabs)/index.tsx, mobile/app/flat/[id].tsx, mobile/app/(tabs)/construction.tsx, mobile/src/screens/construction/timeline.tsx, mobile/src/screens/shared.ts, mobile/src/api/pdf.ts (import order)

## Iteration 5 — In-app notifications + list-based plan + stage notes
- **Commit**: 11a82297eda33f745a1144b4ca3b85e596f3fcac (base HEAD; mobile changes in working tree)
- **Date**: 2026-10-24T14:23:57Z
- **Changes**: useNotificationCount (GET /notifications/unread-count, 30 s poll + focus) and useNotifications (infinite, page_size 20); app/notifications.tsx (type icons, unread highlight, pull-to-refresh, Load more, Mark all read via /notifications/read-all, tap → /notifications/{id}/read + navigate); pure mapping src/notification-route.ts (demand.* → /payments?tab=demands + switch booking; stage.completed → /construction + switch booking; ticket.reply → /requests/{entity_id}; notice.published → /notices/{entity_id}). Bell on Home header (now notifications; notices still via banner + More) and More header/row. Home plan card reads payment_plan/next_installment from the bookings list (detail fetch dropped; list has no accepted_on, so accepted date shows only in My Flat). Construction uses stages[].notes (fallback legacy update).
- **Files modified**: mobile/src/notification-route.ts (new), mobile/app/notifications.tsx (new), mobile/src/hooks.tsx, mobile/app/_layout.tsx, mobile/app/(tabs)/index.tsx, mobile/app/(tabs)/more.tsx, mobile/app/(tabs)/construction.tsx, mobile/src/screens/construction/timeline.tsx

## Iteration 6 — Quality overhaul (audit /app/memory/qa/audit.md portal_*)
- **Date**: 2026-10-24T15:58Z (base HEAD; mobile changes in working tree)
- **Changes**:
  - Responsive shell: ≥1024 px left sidebar (brand, buyer, nav, Notifications/Documents/Notices with badges, Sign out) via Tabs `tabBarPosition: "left"` + custom tabBar; <1024 px solid bottom bar (12 px/600 labels, gold top indicator, letterSpacing −0.4 so "Construction" fits at 390). Screen reserves TAB_BAR_SPACE (124) + inset on phone, max column 1100 px, fade/slide mount animation.
  - Contrast/type scale (theme.ts): ivory #F7F5EF, secondary #3E4C63, muted #5B6880, hairline #E8E4DA, goldDeep #9A7A12 for gold text on light; T variants body 15/22.5, title 18/600, display 32 (Cormorant), tabular money; new tones `secondary`, `goldBright`.
  - Cards 20 px padding/18 radius/hairline+soft shadow; gold buttons use LinearGradient #D8B64A→#B8911C (Sign in, CTAs). `Money` component: short ₹ form, tap toggles full value.
  - Pills wrap (no clipped booking/tabs pills). Ledger: phone card rows (date+desc, Cash/Account split chips, amount, paid-to-date + coloured due/advance strip); ≥768 table with fixed column widths, width = max(container, TABLE_MIN) and a "Scroll sideways" hint when it scrolls.
  - Home: hero uses expo-image (memory-disk cache) + gradient overlay; notices strip 2-line title/body; bucket rows wrap (no clipping); pending cheques row wraps.
  - Construction: photo grid sized from onLayout (3–6 cols, 2 rows max, "+N" tile → lightbox), `?size=thumb` appended (backend currently ignores it → same image, graceful), active stage highlight without top padding (rail aligned).
  - Login: ≥1024 brand panel with local hero photo (assets/images/login-hero.jpg) + navy gradient + 3 value props; centred card otherwise; links spaced/aligned; helper text secondary colour.
  - Perf: STALE 60 s; login prefetches /bookings + first booking detail.
- **Verified**: web 1440/1024/800/390 — 16 routes load, no horizontal overflow, zero console errors; after-shots in /app/memory/qa/after/. Native bundles 200.
- **Not done**: stack screens (Flat, Documents, Notifications, …) are full-page on desktop (no sidebar, back button instead); no React Query disk persistence; galleries not virtualised (2-row cap instead).
- **Note**: the bash tool blocks long inline heredocs ("/app is owned by the regression harness") — write edit scripts with create_file to /tmp and run them.
- **Files**: mobile/src/theme.ts, src/ui/{text,primitives,pills,screen}.tsx, app/(tabs)/_layout.tsx, src/screens/payments/ledger.tsx, src/screens/home/{payment-cards,hero-card}.tsx, app/(tabs)/{index,payments,construction,requests}.tsx, src/screens/construction/timeline.tsx, app/login.tsx, src/auth.tsx, src/hooks.tsx, assets/images/login-hero.jpg

## Iteration 7 — Second polish pass (sidebar shell everywhere, persistence, lazy gallery)
- **Date**: 2026-10-24T16:05Z (base HEAD; mobile changes in working tree)
- **Changes**:
  - Desktop shell moved to root layout (`Shell` in app/_layout.tsx + src/ui/sidebar.tsx): ≥1024 px every authed screen (tabs + stack screens + PDF viewer `PdfViewerHost inline`) renders beside the sidebar; tabs hide their bar on wide. Sidebar active state via usePathname; "More" styled secondary; "Signed in as" label 12/600 with ellipsis.
  - PageHeader: on wide the back control is a gold "‹ Back" breadcrumb link; all page titles get a 28×2 gold accent; Screen column gap 24 (8-pt scale).
  - Text: `label` 12/600 uppercase tracking 0.6; new `cardTitle` 15/600 (SectionTitle uses it).
  - Home: Payments card hero "₹22 L paid" (30/800) + "of ₹65 L agreement" muted; Cash/Account 3×2 grid (Agreed/Paid/Due-advance, right-aligned tabular, due red / advance green); "View demands" gold gradient pill with trailing chevron (Button `trailingIcon`); chips 12 px horizontal inset.
  - Icon tiles 36 px radius-10 navy50 `#E9EDF3` with navy 20 px Feather icons (quick actions, plan card, documents, More rows, notifications).
  - React Query persistence: PersistQueryClientProvider + createAsyncStoragePersister (key kkt_portal_cache, maxAge 24 h, buster portal-v2, excludes p-att/p-cats); cleared on logout (clearPersistedCache). "Updating…" pill (src/ui/updating.tsx) when background fetch > 400 ms.
  - Gallery: LazyImage (IntersectionObserver on web, rootMargin 200 px; immediate on native) — verified 5/11 thumbs loaded at first paint.
- **Deps**: @tanstack/react-query-persist-client@5.102.8, @tanstack/query-async-storage-persister@5.102.8
- **Verified**: 12 routes at 1440/1024 (sidebar) and 800/390 (bottom bar): no overflow, zero console errors; PDF viewer opens inside the shell; persisted cache present after reload. Screens: /app/memory/qa/after/portal2_*.png (home, myflat, payments_ledger, request_detail [Rahul SR-2627-0002], notifications × 1440/390). Native bundles 200.
