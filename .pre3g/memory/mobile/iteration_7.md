
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
