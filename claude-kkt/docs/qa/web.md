# Browser QA — apps/web (marketing website)

Date: 2026-10-25 · Chromium (Playwright, headless) · viewports **1440×900** and **390×844** (mobile emulation, touch) · production build (`next build` + `next start`).

Stack under test: API `apps/api` on `:4100` with the demo seed in its own database `kkt_qa_web` (Redis db 14, `API_PUBLIC_URL=http://localhost:4100`, `WEB_ORIGIN=http://localhost:3000`); website built with `NEXT_PUBLIC_API_URL=API_INTERNAL_URL=http://localhost:4100`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

Runner: [`docs/qa/web/browser-qa.cjs`](web/browser-qa.cjs) (`WEB_URL`, `API_URL`, `OUT_DIR`, `ONLY=static,enquiry,brochure,visit,toggles`), PNGs over 300 KB are palette-quantised by [`docs/qa/web/shrink.py`](web/shrink.py). On every page it asserts: zero console errors / page errors, zero failed or ≥ 400 requests (apart from the deliberate 404 / 429 tests), `scrollWidth <= innerWidth`, every visible link/button/field ≥ 44 px tall at 390 px (stretched-link cards count their whole card), and records the time to `networkidle` plus one viewport screenshot per page and width.

## Integration stage 2026-10-26 (phase 5 frontend wiring)

Stack: API on `:4600` (fresh demo seed in `kkt_h6`, Redis db 22), website `next build` + `next start` on `:3600` with `NEXT_PUBLIC_API_URL=API_INTERNAL_URL=http://localhost:4600`, `NEXT_PUBLIC_SITE_URL=http://localhost:3600`; runner `WEB_URL=http://localhost:3600 API_URL=http://localhost:4600 SITE_URL=http://localhost:3600 REDIS_DB=22 node docs/qa/web/browser-qa.cjs`.

**Result (full run): 42 page audits, 145/145 checks, 40 screenshots, 0 defects; axe 42 scans (19 at 1440 px, 23 at 390 px), 0 serious/critical** (6 colour-contrast nodes re-verified as axe stacking false positives, as before). A first full run right after the API had been reseeded under a running server failed 6 checks (progress photos, blog body, hero text, one slot capacity): Next.js was serving its disk fetch cache (`.next/cache/fetch-cache`) of the previous seed, and earlier visit runs had used up the slot's seats. After clearing that cache on a fresh seed the run is clean; nothing in the site changed for it.

New in the visit flow (`ONLY=visit`, 390 px): the manage page says until when its link works (`link_expires_at`); **Change date or time** opens a slot picker of the next 14 days (open slots only, the visit's own slot excluded) → `POST /api/v1/public/site-visits/:token/reschedule` → the page switches to the new link (`/visit/<manage_token>?moved=1`) and shows the confirmation; the previous link stops working (the API answers 404 for a rotated token); the new link shows the visit as Rescheduled and can still cancel. 410 `LINK_EXPIRED` while rescheduling or cancelling shows the expired message and "Book a new visit"; 409 `SLOT_FULL` / 422 `SLOT_INVALID` refresh the slots. Screenshots `visit-reschedule-390.png`, `visit-rescheduled-390.png`.

Fixed while wiring: the selected slot chip's "N left" caption (`text-navy-900/70` on gold, axe serious colour-contrast) now uses `text-navy-950`, in the new picker and in the booking form.

## Re-run 2026-10-26 (phase 5 frontend-quality track)

Stack: API on `:4500` (fresh demo seed in `kkt_h5`, Redis db 20, `TRUST_PROXY` default `loopback`), website `next build` + `next start` on `:3500` with `NEXT_PUBLIC_API_URL=API_INTERNAL_URL=http://localhost:4500`, `NEXT_PUBLIC_SITE_URL=http://localhost:3500`. Runner env: `WEB_URL`, `API_URL`, `SITE_URL`, `REDIS_DB`, `OUT_DIR`, `REPORT` (JSON report, default a temp file), `ONLY=static,enquiry,brochure,visit,security,toggles`, `AXE=0` to skip the scans. Primary targets are now checked at **48 px** (SPEC §15).

**Result: 40 page audits, 140/140 checks pass (52/52 flow checks in the full run, 88/88 page checks in the static re-run), 0 defects; axe-core: 40 scans (19 at 1440 px, 21 at 390 px) with 0 violations.** The first full run right after the database was recreated failed three home/projects/gallery page checks because the Next.js Data Cache still held the previous database's list responses (≤ 60 s); the static walk re-run after that window — 30 audits, 88/88 checks, 30 axe scans — is clean.

New checks in the runner:

| Check | Result |
|---|---|
| `security` flow: `Content-Security-Policy` on HTML responses is `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `frame-src https:`; every executable `<script>` (88 on the project page) carries the request nonce; the nonce changes per request; `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy present | pass |
| Click-to-load embed under the CSP: no iframe before the click, the player iframe after it, no CSP violation in the console | pass |
| Visitor IP forwarding: a render requested with `x-forwarded-for: 203.0.113.x` creates the API rate-limit key `rl:pub:all:203.0.113.x:…` (the API limits the visitor, not the web server) | pass |
| Enquiry form, empty submit: the name field is `aria-invalid="true"` and `aria-describedby` points at its `role="alert"` error | pass |
| Manage link after cancelling a visit: the API now answers 410 `LINK_EXPIRED` (security track); the page renders the branded "This visit link has expired" view instead of the error boundary | pass (`visit-link-expired-390`) |

### Accessibility (axe)

`docs/qa/axe.cjs` runs `@axe-core/playwright` (axe-core 4.14.0, WCAG 2.0/2.1/2.2 A + AA tags) once per page and width, with `prefers-reduced-motion: reduce` emulated during the scan (smooth scrolling and scroll-reveal fades otherwise make axe measure elements mid-scroll). Serious and critical violations are defects.

First scan of the unchanged site (30 scans): **22 pages with serious violations** — `label-content-name-mismatch` (gallery tiles named "Open …" while showing the caption; 72 nodes), `role-img-alt` (image placeholders `role="img"` without a name; 44), `color-contrast` (availability "not available" cells `ink-soft/70`; 27), `aria-prohibited-attr` (star ratings `aria-label` on a `<p>`; 24), `scrollable-region-focusable` (testimonial carousel; 4); the visit confirmation and manage pages also had invalid `<dl>` content (`definition-list`, `dlitem`). All fixed:

| Rule | Fix |
|---|---|
| label-content-name-mismatch | gallery tiles drop the `aria-label` when a caption is visible; an `sr-only` "Open image:" prefix keeps the action in the name |
| role-img-alt | `SmartImage` placeholders are `role="img"` only with alt text, else `aria-hidden` |
| color-contrast | availability cells `text-ink-soft` (5.3:1 on ivory-200 after the token change) |
| aria-prohibited-attr | star ratings are `role="img"` with the "N out of 5 stars" label |
| scrollable-region-focusable | the carousel track is focusable (`tabIndex=0`, gold focus ring) |
| definition-list / dlitem | visit confirmation + manage page: icons moved into the `<dt>`, the maps link into the `<dd>` |
| (focus not obscured) | pages with the sticky "On this page" bar use `scroll-padding-top: 8.5rem`, so scrolled-to / focused content is not hidden under it |

axe 4.14 reports a few `color-contrast` nodes in the visit section of the project page at 390 px with the page background (ivory) instead of the navy section behind the text; the runner re-checks such nodes against their nearest opaque ancestor and lists them as "re-verified false positives" (9 nodes, actual contrast ≥ 10:1) instead of defects.

### Contrast (design tokens)

`node docs/qa/contrast.mjs web` reads the `@theme` tokens from `app/globals.css` and checks every text/background pair the site uses: **39/39 pass** (table in `docs/qa/contrast-results.md`, enforced by `apps/web/test/contrast.test.ts`). Token changes: `ink-soft` #6e7b91 → #5b677a (3.96 → 5.30:1 on ivory-100), eyebrows and gold text from `gold-600` to `gold-700` #7f6318 (3.19 → 5.25:1), `success` #1f7a4d → #1d734a; the gold reference numbers on the enquiry / visit success cards use `gold-700` (light) or `gold-300` (dark). Review pass: the form fields (`components/ui/Field.tsx`) had a 1.36:1 border (navy-900/15), a 3.04:1 placeholder (ink-soft/70) and a 2.42:1 gold-500 focus border/ring with the outline removed — now navy-900/55 (3.79:1), ink-soft (5.59:1) and a gold-700 border + 2 px ring (5.68:1); the consent checkbox accent is gold-700; a control's own `aria-describedby` is merged with the field's error id instead of replacing it. Re-run after the change (`ONLY=static,enquiry,visit,security`): 36 audits, 117/117 checks, 36 axe scans with 0 serious/critical, visit submit 56 px (the check is now ≥ 48 px).

## Verify stage 2026-10-26 (phase 5)

The brochure gate now mounts per opening and the visit form derives its loading state from the request it answers (lint refactors).
Stack: API bundle on `:4710` (fresh demo seed in `kkt_h7`, Redis db 23), website `next build` + `next start` on `:3710`
(`NEXT_PUBLIC_API_URL=API_INTERNAL_URL=http://localhost:4710`); runner `ONLY=static,enquiry,brochure,visit,security`, `OUT_DIR` outside
the repo. **Result: 40 page audits, 128/128 checks, 0 defects, 40 axe scans with 0 serious/critical.** The previous manage link of a
rescheduled visit now answers **410** (the API keeps the hash of replaced tokens), and the page shows the expired-link view.

## Result (2026-10-25 run)

**39 page audits (39 screenshots, all ≤ 300 KB), 88/88 page checks and 42/42 flow checks pass** after the fixes below: zero console errors, zero failed requests, no horizontal overflow at 390 px and no interactive target under 44 px on any audited page. Earlier runs of the same script found the defects listed further down; the fixes were verified by re-running the full suite.

| Page | URL | 1440 settle | 390 settle | Console / failed requests | 390 overflow | 390 targets < 44 px | Screenshots |
|---|---|---|---|---|---|---|---|
| Home (hero slides, trust strip, featured projects, value props, walkthrough, testimonials, latest posts, enquiry) | `/` | 735 ms | 733 ms | 0 / 0 | none | none | `home-1440.png`, `home-390.png` |
| Home — mobile menu, sticky bar sheet | `/` | – | – | 0 / 0 | none | none | `home-menu-390.png`, `home-sheet-390.png` |
| Projects list | `/projects` | 593 ms | 581 ms | 0 / 0 | none | none | `projects-*.png` |
| Projects list, filtered (`status=READY&bhk=4` → only GGV) | `/projects?status=READY&bhk=4` | 581 ms | 560 ms | 0 / 0 | none | none | `projects-filtered-*.png` |
| Project detail SGH (prices, availability grid, progress photos, click-to-load video/tour/map, FAQs, brochure, visit) | `/projects/shree-ganesh-heights` | 748 ms | 693 ms | 0 / 0 | none | none | `project-sgh-*.png` |
| Project detail GGV (prices hidden → "Price on request", progress hidden, availability shown) | `/projects/ganesh-green-villas` | 646 ms | 620 ms | 0 / 0 | none | none | `project-ggv-*.png` |
| About (story, leadership, timeline) | `/about` | 583 ms | 579 ms | 0 / 0 | none | none | `about-*.png` |
| Gallery + lightbox (open, next, Escape closes) | `/gallery` | 614 ms | 580 ms | 0 / 0 | none | none | `gallery-*.png`, `gallery-lightbox-*.png` |
| Blog list (4 published, draft absent) | `/blog` | 641 ms | 586 ms | 0 / 0 | none | none | `blog-*.png` |
| Blog post | `/blog/vastu-tips-new-home` | 580 ms | 556 ms | 0 / 0 | none | none | `blog-post-*.png` |
| Contact (call-back form + site-visit booking) | `/contact` | 620 ms | 575 ms | 0 / 0 | none | none | `contact-*.png` |
| Privacy | `/privacy` | 589 ms | 573 ms | 0 / 0 | none | none | `privacy-*.png` |
| Disclaimer | `/disclaimer` | 579 ms | 558 ms | 0 / 0 | none | none | `disclaimer-*.png` |
| 404 — unknown project slug (HTTP 404 + branded page) | `/projects/no-such-project` | 614 ms | 600 ms | 0 / 0 (the 404 itself is the test) | none | none | `not-found-*.png` |
| 404 — draft post | `/blog/ggv-block-q-handover` | HTTP 404 | HTTP 404 | – | – | – | – |
| 404 — unpublished project (GGV unpublished via admin API, then restored) | `/projects/ganesh-green-villas` | HTTP 404 within 16ms | – | – | – | – | – |
| `sitemap.xml` | `/sitemap.xml` | published projects + posts + legal pages only; draft post and unpublished project absent; legal-only while `site_live=false` | | | | | |
| `robots.txt` | `/robots.txt` | `Allow: /`, `Disallow: /visit/`, sitemap link; `Disallow: /` while `site_live=false` | | | | | |
| Coming soon (`site_live=false` via `PATCH /cms/site`, restored afterwards) | `/`, `/projects/shree-ganesh-heights` | shown within 36 s (60 s cache) | shown | 0 / 0 | none | none | `coming-soon-*.png` |

Settle = `page.goto` → `networkidle` on a warm server (the spec asks for < 2 s). Every page settled well under 1 s on both viewports.

### Flows

| Flow | Checks | Result |
|---|---|---|
| Enquiry (contact page, 1440) | name + phone + consent → success card with reference number (`ENQ-…`); five submissions succeed, the **6th within a minute** shows the rate-limit message ("You have sent a few requests in quick succession… try again in about N seconds") — `enquiry-success-1440.png`, `enquiry-rate-limited-1440.png` | pass |
| Brochure gate (SGH, 1440) | "Download brochure" opens the modal; name/phone/consent → the PDF download starts (`shree-ganesh-heights-brochure.pdf`, `%PDF-` header) and the modal shows the ready state with a 15-minute link; `kkt:brochure-visitor` token stored; reload + click → **returning visitor skips the form** ("Welcome back, …") and the download starts again; forged link → 404 — `brochure-gate-1440.png`, `brochure-ready-1440.png` | pass |
| Site visit (SGH, 390 — "booking wizard completes on a phone") | date strip of 14 days (Sundays and blackout disabled), slot chips with **"N left"**, keyboard focus on the consent box scrolls it clear of the sticky bar, 56 px submit; success shows `SV-…`, date/time (IST), site office, **.ics** and **manage** links; the .ics has `VTIMEZONE Asia/Kolkata`, `DTSTART;TZID=Asia/Kolkata` = chosen slot, `TRIGGER:-PT1H`; public availability drops 3 → 2 for that slot — `visit-success-390.png` | pass |
| Manage page (390) | shows the visit as Confirmed with .ics + "Cancel this visit"; confirm → **Cancelled**, seat freed (availability back to 3), state persists on reload — `visit-manage-390.png`, `visit-cancelled-390.png` | pass |
| Admin toggles | unpublish GGV → detail 404, absent from list + sitemap; republish → back. `site_live=false` → coming-soon on every page (no nav/footer), robots `Disallow: /`, sitemap legal-only; restore → site back | pass |

## Defects found and fixed

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | **Brand logo blocked on every page** — `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` (console error + failed request). Helmet's default `Cross-Origin-Resource-Policy: same-origin` makes Chromium refuse `<img>` loads of `/public/media/:id` from the website origin (production: `www.` vs `erp.` host). The brochure PDF, the `.ics` and portal file streams have the same problem. | API | `apps/api/src/modules/web/shared.ts` `crossOriginFile()`; applied in `publicContent.ts` (`/public/media/:id`), `publicForms.ts` (`/public/brochure/:token`), `publicVisits.ts` (`.ics`) and `apps/api/src/modules/portal/index.ts` (`/portal/files/:token`). JSON routes keep the default + CORS allow-list. |
| 2 | **Unpublished project stayed live** — after `is_published=false` the API answers 404 but `/projects/<slug>` kept rendering (the list and sitemap updated in seconds). Next's Data Cache only stores 200s and keeps serving the last good entry when a revalidation returns anything else, so a 404 transition never reached the page until a restart. Violates SPEC §15 / scenario 11 ("unpublished projects … 404 everywhere"). | web | `apps/web/lib/api.ts`: detail fetches (project, post, page) are `no-store`; lists and site settings keep the 60 s cache. The API's own 60 s Redis cache makes the extra request cheap. Now 404 within ~50 ms. |
| 3 | **Phone navbar crowded** — "Call" and "Customer Login" were meant to be `hidden md:inline-flex`, but `buttonClasses()` already emits `inline-flex`, which wins over `hidden` in Tailwind's output order; both buttons rendered at 390 px and wrapped the brand name over three lines. | web | `apps/web/components/layout/SiteNav.tsx`: desktop actions in their own `hidden md:flex` wrapper, brand name truncates. |
| 4 | Link-variant `<Button>` (e.g. "About Shree Ganesh Heights" on the manage page) was 24 px tall on the phone (< 44 px target). | web | `apps/web/components/ui/Button.tsx`: link variant gets `min-h-11`. |
| 5 | Fields near the bottom of a phone screen scroll **under the sticky Call · WhatsApp · Enquire bar** when focused (keyboard users tabbing into the consent checkbox) and anchors land under the sticky navbar. | web | `apps/web/app/globals.css`: `scroll-padding-top: 5rem`, `scroll-padding-bottom: 5rem` below `md`. |
| 6 | GGV (prices hidden) never said **"Price on request"** (SEED.md / SPEC §15): sticky card said "On request", configurations and project cards showed nothing. | web | `StickyEnquiryCard.tsx`, `Configurations.tsx`, `ProjectCard.tsx` render "Price on request"; `₹` never appears on GGV. |
| 7 | Walkthrough poster requested `https://i.ytimg.com/vi/<id>/hqdefault.jpg` for the seed's placeholder video id (`sgb-walkthrough`) → 404 on the home page and SGH; a broken poster also showed a broken-image icon. | web | `apps/web/lib/media.ts`: a YouTube thumbnail is only requested for an 11-character id; `ClickToLoadEmbed.tsx` falls back to the branded poster `onError`. |
| 8 | **Types drift** — `apps/web/lib/types.ts` was a hand-written mirror of Appendix B that no longer matched the wire (e.g. offices had `city/hours/email` that the API never sends, `seo_defaults.keywords`, `approvals[].issued_on`, `availability.available_count`, nullable `published_at`, `page_size` 25 vs 12), and the components read the optional "apps/web alias" fields (`type`, `overview`, `videos`, `url`, `date/start/end`, `price_paise`, `floor_plan_image_url`, `cover_image_url`, `flat_type_code`, `status`…). | web + contracts | `types.ts` now re-exports the `@kkt/contracts` public types (`PublicSiteResponse`, `PublicProjectDetail`, `PublicVisitBookingResponse`…) and keeps only the list/error envelopes and the filter bag; every component reads the canonical fields (`project_type`, `description`, `video_urls`/`tour_urls`, `medium_url`, `visit_date`/`slot_start`/`slot_end`/`site_office_address`, `price_from_paise`, `floor_plan_url`, `cover_url`, `configuration`, `availability`, `floor_label`, `can_cancel`). Dead UI for fields that never existed (office city/hours, approval issue dates, SEO keywords) removed. In `packages/contracts/src/modules/public.ts`: `PublicConfiguration.code` is required (the API always sends it; the website keys tabs on it) and `PublicPage` / `PublicPostDetail` gained `updated_at` (emitted by `publicContent.ts`) so "Last updated" on legal pages and `dateModified` in Article JSON-LD are real instead of silently undefined. |

Verification: `pnpm --filter @kkt/contracts typecheck`, `--filter @kkt/api typecheck`, `--filter @kkt/web typecheck` and `--filter @kkt/web build` are green; `@kkt/contracts test` 182/182; API integration `web.test.ts`, `web-adversarial.test.ts`, `visits.test.ts`, `conventions.test.ts` 49/49 on a separate test database.

## Still open / notes

* **Seed placeholders, not website defects**: the brand logo is a tiny generated square; the walkthrough and project videos use placeholder YouTube ids (`sgb-walkthrough`, `sgh-walkthrough`) and the 360° tour / map embeds point at placeholder Matterport / Google Maps URLs, so clicking "Play video" / "Load map" in the demo loads an empty player. Real CMS values fix this with no code change.
* Phone numbers are rendered exactly as stored (`6122200000`); a display formatter (`+91 612 220 0000`) would read better in the navbar, footer and contact cards. Cosmetic, not changed.
* `next start` warns that the project uses `output: "standalone"`; in production run `node .next/standalone/server.js` (see `apps/web/Dockerfile`). Behaviour under test is identical.
* Site settings and lists are cached for 60 s in the Next.js Data Cache (plus 60 s in the API); `site_live` and publish/unpublish of *lists* therefore show within about a minute, while detail pages switch instantly. Next revalidates list entries stale-while-revalidate, so the **first** request after a toggle that lands more than 60 s later still gets the previous list once (the sitemap fetched while the site was off cached empty project/post lists, and the following `/projects` and `/blog` requests showed them once). Acceptable under "cached ~60 s"; a `revalidateTag` call from the CMS routes would make it instant. `generateMetadata` and the page body share one detail request per render since 2026-10-26 (React `cache()` in `lib/api.ts`).
* The enquiry rate-limit test leaves five `QA Visitor n` leads and the visit test one cancelled `SV-…` visit in `kkt_qa_web`; run `POST /api/v1/admin/reseed` or drop the database before reusing it.
* Not covered by this walk: the ERP side of site visits (reschedule / outcomes) and the honeypot drop (covered by the API integration suite). WCAG contrast is now measured (`docs/qa/contrast.mjs` + axe, see the 2026-10-26 re-run above).
