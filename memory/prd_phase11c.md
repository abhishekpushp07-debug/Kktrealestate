# KKT ERP v2 — Phase 11C: Design refinement + Customers · Bookings · Payments v2

Status: implemented & tested (iteration_13.json + manual re-verification of the two reported bugs, 2026-10-24).
Screenshots: `/app/memory/qa/v2b/*-1440.jpg`, `*-390.jpg`.

## Part 1 — Kit refinement (global, `components/v2/index.jsx`, `index.css`)
- `Num`/`Money`: ₹ rendered as a Manrope prefix (`.rs`) inside serif numerals — no more glyph fallback.
- `IconTile` 36px / radius 10 / warm-100 / lucide 20px stroke 1.75; `gold` tile for primary only; tones brick/amber/sage.
- `StatTile`: label 13/600 ink → value 32px serif → helper 12 muted; no sparkline unless data > 0.
- Cards: 1px warm-200 border + spec shadow; hover lift on interactive cards.
- `EntityCard`: 16:9 cover or `Monogram` gradient with serif initials, meta row + status pill, segmented availability bar + legend, Collected/Outstanding serif, 44px ring labelled "Construction".
- Buttons: primary ink / secondary warm-100 / ghost text / gold hero CTA; 40px, radius 10.
- Pills: single `StatusPill` map extended (customer lifecycle, KYC, demands, payments, service, visits).
- `SegmentBar`: legend with amounts + counts; zero → "No overdue dues" with sage check (`ageing_counts` added to `/api/dashboard/home`).
- Home: generic banner removed; slim gold-hairline `notice` only when follow-ups/overdue exist. Hero badges `pill-hero`; Outstanding ₹0 sage; hint 13px warm-200.
- Top bar: 40px warm-100 search pill with ⌘K chip; bell badge pill; breadcrumb 13px.

## Part 2 — Customers · Bookings · Payments v2
- **Customers list** `pages/v2/Customers.jsx`: serif title + count, filter pills (lifecycle, KYC, has-overdue) + Selects (segment, RM, city — server-side filters added to `GET /api/customers`), Cards|Table toggle, IntersectionObserver infinite scroll. Cards: deterministic avatar, click-to-call, lifecycle/KYC/segment pills, RM chip, bookings/agreement/due (list now returns `bookings_count`, `agreement_paise`), engagement ring, last contacted.
- **Add/Edit Customer** `pages/v2/CustomerForm.jsx` (`/customers/new`, `/customers/:id/edit`): two-column FormSections (Identity, Contact w/ live phone dedupe card, Address state→city→locality, Profile, Preferences, Co-applicants, Nominee, KYC with PAN regex + Aadhaar Verhoeff). Saves base record then `PATCH /customers/{id}/profile` (with version) → Customer 360.
- **Customer 360** `pages/v2/Customer360.jsx`: light hero (avatar, pills, contact row, engagement, quick actions Log/Booking/Post payment/Statement/Edit/Erase PII), 4 stats; LEFT: booking cards (plan, progress, 3 dues, next installment), `ThreeLedgers` (Cash·Account·Other charges·Combined, per-booking selector, summary tiles, rows), unified timeline grouped by day with type filter; RIGHT: profile, communication log + `CommSheet`, KYC & documents (audited reveal, status), co-applicants/nominee, portal access, lead history. Tabs on mobile.
- **Bookings** `pages/v2/Bookings.jsx` cards + filters; **Booking detail** restyled (light hero, serif stats, v2 tabs incl. new **Ledgers** tab using `ThreeLedgers`, PostPayment sheet); **Booking wizard** restyled (vertical `Stepper` with descriptions, warm cards, v2 Selects, plan cards, warm `UnitGrid`, summary rail serif).
- **Payments** `pages/v2/Payments.jsx`: tiles (MTD, cheques in hand, bounced, overdue), tabs Receipts / Cheques / Demands (new `GET /api/payments/demands`) / Roznamcha (embedded), receipt rows with clear/bounce/reverse `ReasonSheet`; **PostPayment** sheet (`components/v2/PostPayment.jsx`): searchable booking picker → compact card with 3 dues → Against → Category with due hints → Mode → company bank → instrument bank/number/date → amount with serif preview + inline cap validation → date → received by → Post (Idempotency-Key) → success panel (receipt no., print, post another).
- `GET /api/customers/rm-options` (id, name, role_name). `GET /api/customers/{code}` and `/api/bookings/{number}` resolve codes → deep links work.

## Verification
- Backend: 61 passed (phase_11a + phase_11c + index audit + startup migrations).
- Frontend: testing agent iteration_13 — all flows pass after fixes (profile PATCH version; PostPayment picker wrapped in a `<label>` swallowed the click → replaced with div). 0 console errors; no overflow at 390 on all listed screens; production build served.

## Self-scores (target ≥ 8)
Home 8 · Projects 8.5 · Project overview 8.5 · Customers list 8.5 · Add customer 8 · Customer 360 8.5 · Bookings 8 · Booking detail 8 · Booking wizard 8 · Payments 8 · Post payment 8.5 · Roznamcha 7 (legacy page embedded, only tiles/typography inherit) · Catalogues 8.

## Known gaps / next
- Roznamcha body still uses legacy components (embedded in the new Payments tab).
- Leads & Visits, Service, Reports, Website, Masters still legacy inside the new shell.
- Customer list "city" filter relies on `city_id` from the profile; legacy customers without `city_id` won't match the City filter.
