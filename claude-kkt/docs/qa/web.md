# Browser QA — apps/web (marketing website)

Date: 2026-10-25 · Chromium (Playwright, headless) · viewports **1440×900** and **390×844** (mobile emulation, touch) · production build (`next build` + `next start`).

Stack under test: API `apps/api` on `:4100` with the demo seed in its own database `kkt_qa_web` (Redis db 14, `API_PUBLIC_URL=http://localhost:4100`, `WEB_ORIGIN=http://localhost:3000`); website built with `NEXT_PUBLIC_API_URL=API_INTERNAL_URL=http://localhost:4100`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

Runner: [`docs/qa/web/browser-qa.cjs`](web/browser-qa.cjs) (`WEB_URL`, `API_URL`, `OUT_DIR`, `ONLY=static,enquiry,brochure,visit,toggles`), PNGs over 300 KB are palette-quantised by [`docs/qa/web/shrink.py`](web/shrink.py). On every page it asserts: zero console errors / page errors, zero failed or ≥ 400 requests (apart from the deliberate 404 / 429 tests), `scrollWidth <= innerWidth`, every visible link/button/field ≥ 44 px tall at 390 px (stretched-link cards count their whole card), and records the time to `networkidle` plus one viewport screenshot per page and width.

## Result

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
* Site settings and lists are cached for 60 s in the Next.js Data Cache (plus 60 s in the API); `site_live` and publish/unpublish of *lists* therefore show within about a minute, while detail pages switch instantly. Next revalidates list entries stale-while-revalidate, so the **first** request after a toggle that lands more than 60 s later still gets the previous list once (the sitemap fetched while the site was off cached empty project/post lists, and the following `/projects` and `/blog` requests showed them once). Acceptable under "cached ~60 s"; a `revalidateTag` call from the CMS routes would make it instant. `generateMetadata` and the page body each call the (uncached) detail endpoint, i.e. two small requests per project/post/page render; acceptable, but a per-request memo (`React.cache`) would halve it.
* The enquiry rate-limit test leaves five `QA Visitor n` leads and the visit test one cancelled `SV-…` visit in `kkt_qa_web`; run `POST /api/v1/admin/reseed` or drop the database before reusing it.
* Not covered by this walk: the ERP side of site visits (reschedule / outcomes), honeypot drop (covered by the API integration suite), and WCAG contrast measurement (visual check only; the navy/gold/ivory tokens were not changed).
