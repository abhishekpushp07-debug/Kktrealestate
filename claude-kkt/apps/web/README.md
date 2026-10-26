# @kkt/web — marketing website

Public website for KKT v2 (Next.js 15 App Router, React 19, Tailwind CSS v4). "Cinematic, editorial luxury": royal deep
navy `#0B1F3A`, gold `#C9A227`, ivory `#F8F6F1`; Cormorant Garamond (display) + Manrope (body) via `next/font/google`.

It is one of the three front doors described in `docs/ARCHITECTURE.md` and consumes **only** the public API surface in
`docs/API-CONVENTIONS.md` Appendix B (`/api/v1/public/*`). Spec: `docs/SPEC.md` §15 (website + CMS + brochure gate +
site-visit scheduler) and §18 scenarios 11, 12 and 14.

## Run

```bash
cp apps/web/.env.example apps/web/.env.local   # adjust URLs
pnpm --filter @kkt/web dev                      # http://localhost:3000
pnpm --filter @kkt/web typecheck
pnpm --filter @kkt/web build && pnpm --filter @kkt/web start
```

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Browser-facing API origin (form POSTs, availability, media URLs, image optimizer allow-list) |
| `API_INTERNAL_URL` | In-cluster API origin used by the Next.js server for data fetching (falls back to `NEXT_PUBLIC_API_URL`) |
| `NEXT_PUBLIC_PORTAL_URL` | "Customer Login" target (the CMS `portal_url` wins when set) |
| `NEXT_PUBLIC_ERP_URL` | "Staff login" link in the footer |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin: `metadataBase`, canonical URLs, sitemap |

The build never calls the API: every route is `dynamic = "force-dynamic"` (set once in `app/layout.tsx`), and server
fetches use `next: { revalidate: 60, tags }` so data is still cached for 60 s across requests. Network failures degrade to
empty states on list pages and to the error boundary on detail pages; a 404 from the API becomes `notFound()`.

### Visitor IP forwarding (per-visitor rate limits)

The API rate-limits public reads per client IP (`PUBLIC_RATE_LIMIT_PER_MIN`). Server-side renders call the API from the
web server, so without help every visitor would share the web server's bucket. `lib/api.ts` therefore sends the
incoming request's `x-forwarded-for` chain (or `x-real-ip`) on every **uncached** server fetch (project/post/page detail,
visit availability, the visit manage page). Cached list fetches (`revalidate: 60`) are shared by all visitors and go out
without it, so the Data Cache is not split per visitor. Only well-formed IPv4/IPv6 hops are forwarded (at most ten).

The API honours `X-Forwarded-For` only from peers listed in its `TRUST_PROXY` (default `loopback`; see
`docs/SECURITY.md`) and takes the right-most untrusted hop as the client. Deployment rules:

* Put the website behind the reverse proxy (Caddy), which sets `X-Forwarded-For` to the real client address.
* Add the **web server's address as the API sees it** to the API's `TRUST_PROXY`, e.g. `TRUST_PROXY=loopback,172.18.0.0/16`
  for the compose network (or the web container's fixed IP / service subnet). Do not use `TRUST_PROXY=true` on an API that is
  reachable directly from the internet.
* If the web server is not trusted, the API ignores the header and limits the web server as one client (the old behaviour).
* Never publish the web server's port directly while its address is in the API's `TRUST_PROXY`: Next.js only fills in
  `X-Forwarded-For` when the request has none (`x-forwarded-for ??= socket address`), so a visitor talking to Next.js
  directly could send any address and pick their own rate-limit bucket. Behind Caddy (which replaces a client-sent header
  with the real peer address) this cannot happen; `docker-compose.prod.yml` publishes only Caddy.

Verified by `docs/qa/web/browser-qa.cjs` (`ONLY=security`, `REDIS_DB=<api redis db>`): a render requested with
`x-forwarded-for: 203.0.113.x` creates the API rate-limit key for `203.0.113.x`.

### Security headers and Content-Security-Policy

`middleware.ts` sets a strict, per-request CSP built by `lib/csp.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'`
(Next.js stamps the nonce on its own scripts; no `unsafe-inline`, no `unsafe-eval` outside `next dev`),
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, images/media/fetches limited to
this origin and `NEXT_PUBLIC_API_URL` (plus YouTube poster thumbnails), and `frame-src https:` so the click-to-load
embeds (YouTube/Vimeo players, 360° tours, maps — any https URL the CMS holds) work once the visitor clicks; nothing
third-party loads before that and the iframe is sandboxed. `next.config.ts` adds `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, HSTS and `Cross-Origin-Opener-Policy`. Because the policy carries a nonce,
every page renders dynamically (they already did: `force-dynamic` in `app/layout.tsx`).

### Tests

`pnpm --filter @kkt/web test` (vitest, `test/`): CSP directives, visitor-IP forwarding (`x-forwarded-for` on uncached
fetches only, sanitised), and the form fields' `aria-invalid` / `aria-describedby` wiring. Browser behaviour, axe-core
scans and the security headers are checked by `docs/qa/web/browser-qa.cjs`. `next build` skips ESLint (`eslint.ignoreDuringBuilds`);
lint runs as its own step (`pnpm --filter @kkt/web lint`).

### Build-time vs runtime configuration

`NEXT_PUBLIC_*` values are inlined into client bundles **and** `images.remotePatterns` at build time, so pass them as
Docker **build args** (`apps/web/Dockerfile` declares them; add `build.args` for the `web` service in
`docker-compose.yml`). Server code reads env at runtime (`lib/env.ts`), so a differently configured container still
fetches from the right API; images whose origin is not in the build-time allow-list are rendered unoptimised rather than
failing (`components/ui/SmartImage.tsx`).

## Layout of the code

```
app/
  layout.tsx            html/fonts/metadata defaults, skip link, SiteConfigProvider, Organization + WebSite JSON-LD
  (site)/               every public page; gated by the CMS "site live" switch (lib/gate.tsx → coming-soon page)
    page.tsx            home · projects/ · projects/[slug] · about · gallery · blog · blog/[slug] · contact · visit/[token]
  (legal)/              privacy · disclaimer — always reachable, even when the site is not live
  not-found.tsx · sitemap.ts · robots.ts · icon.svg · globals.css (Tailwind v4 @theme tokens)
lib/
  api.ts        THE typed API module: server fetchers + browser client (ApiError envelope, 429/SLOT_FULL)
  csp.ts        Content-Security-Policy builder (used by middleware.ts with a per-request nonce)
  types.ts      Website aliases of the @kkt/contracts public schemas (+ list/error envelopes, filter bag)
  env.ts        runtime env access · format.ts  ₹ Indian grouping / short forms / IST dates
  markdown.tsx  safe Markdown → React renderer (no raw HTML) · seo.ts  metadata + JSON-LD builders
  media.ts      media URL resolution, YouTube/Vimeo embed parsing · gate.tsx  site-live gate · nav.ts
components/
  layout/   SiteNav (glass → solid navy on scroll), Footer, StickyMobileBar (+ bottom sheet), ComingSoon, PageHeader, SiteShell
  forms/    EnquiryForm, BrochureGate (+ BrochureButton), VisitBooking
  projects/ HeroGallery, Configurations, AvailabilityGrid, ProgressTimeline, Faqs, StickyEnquiryCard, ProjectCard, ProjectFilters
  home/     Hero (crossfade + Ken Burns), TrustStrip, ValueProps, Testimonials, EnquirySection
  ui/       Button, Section, SmartImage, Reveal, Carousel, Modal, Lightbox, ClickToLoadEmbed, Field, icons, hooks
  gallery/GalleryGrid · blog/PostCard · visit/ManageVisit · JsonLd · SiteConfigProvider
```

## Behaviour worth knowing

* **Forms** (`EnquiryForm`, `BrochureGate`, `VisitBooking`) validate client-side (10-digit Indian mobile, consent), send the
  hidden honeypot `website: ""`, an `Idempotency-Key`, and UTM parameters captured from the URL; they surface
  `{ error: { code, message } }` including `429 RATE_LIMITED` (with `Retry-After`) and `409 SLOT_FULL` (availability is
  refreshed and the slot cleared).
* **Brochure gate** remembers `visitor_token` (plus the visitor's own details) in `localStorage`; later downloads skip
  the form and navigate straight to the signed `download_url`. A rejected token clears the memory and shows the form.
* **Site visits**: 14-day date strip from the live availability endpoint (IST), slot chips with "N left", 1–6 visitors;
  success shows visit number, date/time, address, maps link, `.ics` download and the manage link. `/visit/[token]` shows
  the visit, offers the `.ics`, and cancels after an inline confirmation.
* **Availability grid** renders only `AVAILABLE | NOT_AVAILABLE` cells with a legend; prices render only when present.
* **Embeds** (video, 360° tour, map) are poster + button; the iframe is injected only on click.
* **Markdown** from the CMS is parsed into React elements — no `dangerouslySetInnerHTML` of user content. JSON-LD is the
  only inline script and is our own serialised JSON with `<` escaped (a data block: the CSP does not apply to it).
* **Coming soon**: when `site_live` is false every (site) page returns the coming-soon view (also from
  `generateMetadata`, so nothing leaks via title or RSC payload); `/privacy` and `/disclaimer` stay up; robots disallows
  everything and the sitemap lists only the legal pages.
* **SEO**: title template `%s · {brand}`, OpenGraph/Twitter, canonical per page, Organization/WebSite/RealEstateListing/
  Article/Breadcrumb/FAQ JSON-LD, sitemap and robots built from published content only.
* **Accessibility**: skip link, visible gold focus rings, 48 px tap targets (`tap`, `min-h-12`), focus-trapped dialogs
  and lightbox (Esc closes), native `<details>` FAQs, `prefers-reduced-motion` respected everywhere. Form controls inside
  a `Field` get `aria-invalid`, `aria-required` and `aria-describedby` (→ the `role="alert"` error, else the hint)
  automatically. Text tokens meet WCAG AA (`node docs/qa/contrast.mjs web`); every page is scanned with axe-core at 1440 and
  390 px by the browser QA. Pages with the sticky "On this page" bar raise `scroll-padding-top` so focused content is never
  hidden under it.
* **Detail fetches** are memoised per request with React `cache()`: `generateMetadata` and the page share one API call.
