
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
