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
