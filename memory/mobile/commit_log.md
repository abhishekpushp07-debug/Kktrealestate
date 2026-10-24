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
