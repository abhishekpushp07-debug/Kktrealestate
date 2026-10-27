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

| Variable                          | Purpose                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`             | Browser-facing API origin (form POSTs, availability, media URLs, image optimizer allow-list)                         |
| `API_INTERNAL_URL`                | In-cluster API origin used by the Next.js server for data fetching (falls back to `NEXT_PUBLIC_API_URL`)             |
| `NEXT_PUBLIC_PORTAL_URL`          | "Customer Login" target (the CMS `portal_url` wins when set)                                                         |
| `NEXT_PUBLIC_ERP_URL`             | "Staff login" link in the footer                                                                                     |
| `NEXT_PUBLIC_SITE_URL`            | Canonical origin: `metadataBase`, canonical URLs, sitemap                                                            |
| `INTERNAL_API_TOKEN`              | The API's `INTERNAL_API_TOKEN` (contract C3): server calls send it so the API limits per visitor                     |
| `KKT_COMPANY_SLUG`                | The builder this site serves on a multi-company API (contract C4, sent as `x-kkt-company`); unset = the only company |
| `WEB_REVALIDATE_TOKEN`            | Secret of `POST /api/revalidate` (the API's `WEB_REVALIDATE_TOKEN`); unset = the route answers 404                   |
| `GIT_SHA` / `NEXT_PUBLIC_RELEASE` | Release reported with front-end errors (contract C2)                                                                 |

### Rendering and caching (ISR)

Pages are statically rendered and regenerated in the background (ISR): catalog pages (home, project detail, contact) every 60 s,
CMS pages (about, gallery, blog posts, legal and other CMS pages, sitemap, robots) every 300 s — and all of them at once when the
API calls `POST /api/revalidate` after a CMS or project-website write (API env `WEB_REVALIDATE_URL` + `WEB_REVALIDATE_TOKEN`; the
route purges the `kkt-public` Data Cache tag and re-renders the site on its next request). Detail routes (`/projects/[slug]`,
`/blog/[slug]`, `/[slug]` CMS pages) are not prerendered at build (`generateStaticParams` returns `[]`): each is rendered on its first
request, then cached. `/projects` (filters) and `/blog` (`?page`) read the URL query and `/visit/[token]` is per visitor: they render
per request on top of the same cached data. Every server read goes through `lib/api.ts` → `unstable_cache` (tag `kkt-public`): a 404 is
cached like any answer (an unpublished project or post disappears instead of the last good copy being served), a 5xx / network failure
is never cached and is retried once with a 10 s lifetime, which also shortens the page's own revalidation — so `next build` needs no
API (pages rendered without one regenerate 10 s after the first request) and a brief outage never sticks.

### Content-Security-Policy and `csp-hook.cjs`

ISR HTML is built once and served to everybody (and by a CDN), so it cannot carry a per-request nonce, and Next.js inlines each page's
RSC payload as inline scripts. Instead of `'unsafe-inline'`, `middleware.ts` gives ISR pages `script-src 'self' 'kkt-inline-hashes'` and
**`csp-hook.cjs`** (loaded with `node --require` before Next creates its server: `pnpm start`, the Docker `CMD`) replaces the placeholder
with the SHA-256 of every inline script of the HTML actually sent. A 304 drops the policy so the browser keeps the one it stored with the 200. Pages rendered per request keep the per-request nonce policy (`'nonce-…' 'strict-dynamic'`). `compress: false` in `next.config.ts`
(the hook must see the plain body; Caddy compresses). **Always start the production server with the hook** — without it the placeholder
reaches the browser, which then blocks every inline script (fail closed: the page does not hydrate). `next dev` uses the nonce policy
everywhere and needs no hook.

### Error reporting (contract C2)

`components/ErrorReporter.tsx` (uncaught errors, unhandled rejections), the segment error boundaries (`ErrorView`) and `app/global-error.tsx`
(root layout failures) post `{app: "web", message, stack, url, release, user_agent, extra}` to `POST /api/v1/client-errors` (keepalive,
silent, at most five per page load, duplicates dropped). The URL loses its query string and fragment and `/visit/<token>` becomes
`/visit/[token]`; no form contents are ever sent.

### Visitor IP forwarding (per-visitor rate limits, contract C3)

The API rate-limits public reads per client IP and route group. Every server-side call sends `x-kkt-internal-token`
(`INTERNAL_API_TOKEN`); per-visitor (uncached) calls — the visit manage page — also send `x-kkt-client-ip` (the right-most hop of the
incoming `x-forwarded-for`, or `x-real-ip`) and the sanitised `x-forwarded-for` chain. With a valid token the API limits the forwarded
visitor address; cached (ISR) renders run without a visitor and count against the web server, which is a handful of calls per minute.
Only well-formed IPv4/IPv6 hops are forwarded (at most ten).

The API honours `X-Forwarded-For` only from peers listed in its `TRUST_PROXY` (default `loopback`; see
`docs/SECURITY.md`) and takes the right-most untrusted hop as the client. Deployment rules:

- Put the website behind the reverse proxy (Caddy), which sets `X-Forwarded-For` to the real client address.
- Add the **web server's address as the API sees it** to the API's `TRUST_PROXY`, e.g. `TRUST_PROXY=loopback,172.18.0.0/16`
  for the compose network (or the web container's fixed IP / service subnet). Do not use `TRUST_PROXY=true` on an API that is
  reachable directly from the internet.
- If the web server is not trusted, the API ignores the header and limits the web server as one client (the old behaviour).
- Never publish the web server's port directly while its address is in the API's `TRUST_PROXY`: Next.js only fills in
  `X-Forwarded-For` when the request has none (`x-forwarded-for ??= socket address`), so a visitor talking to Next.js
  directly could send any address and pick their own rate-limit bucket. Behind Caddy (which replaces a client-sent header
  with the real peer address) this cannot happen; `docker-compose.prod.yml` publishes only Caddy.

Verified by `docs/qa/web/browser-qa.cjs` (`ONLY=security`, `REDIS_DB=<api redis db>`): a render requested with
`x-forwarded-for: 203.0.113.x` creates the API rate-limit key for `203.0.113.x`.

### Security headers and Content-Security-Policy

`middleware.ts` sets the CSP built by `lib/csp.ts` (see "Content-Security-Policy and `csp-hook.cjs`" above for the two script policies):
no `unsafe-inline`, no `unsafe-eval` outside `next dev`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, images/media/fetches limited to this origin and `NEXT_PUBLIC_API_URL` (plus YouTube poster thumbnails), and
`frame-src https:` so the click-to-load embeds (YouTube/Vimeo players, 360° tours, maps — any https URL the CMS holds) work once the
visitor clicks; nothing third-party loads before that and the iframe is sandboxed. `next.config.ts` adds `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS and `Cross-Origin-Opener-Policy`.

### Tests

`pnpm --filter @kkt/web test` (vitest, `test/`): both CSP policies and which routes get which, `csp-hook.cjs` on a real HTTP server
(streamed and `writeHead` HTML, 304, non-HTML and nonce responses), ISR reads (cache tags and lifetimes, 404 cached, 5xx retried with
10 s, network failures), the C3/C4 headers, the on-demand revalidation route (token, tags), the error reporter (URL redaction, caps),
and the form fields' `aria-invalid` / `aria-describedby` wiring. Browser behaviour, the hashed CSP on real pages, axe-core scans and the
security headers are checked by `docs/qa/web/browser-qa.cjs` against a production build started with `pnpm start` (the hook loaded).
`next build` skips ESLint (`eslint.ignoreDuringBuilds`); lint runs as its own step (`pnpm --filter @kkt/web lint`).

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

- **Forms** (`EnquiryForm`, `BrochureGate`, `VisitBooking`) validate client-side (10-digit Indian mobile, consent), send the
  hidden honeypot `website: ""`, an `Idempotency-Key`, and UTM parameters captured from the URL; they surface
  `{ error: { code, message } }` including `429 RATE_LIMITED` (with `Retry-After`) and `409 SLOT_FULL` (availability is
  refreshed and the slot cleared).
- **Brochure gate** remembers only the opaque `visitor_token` (a signed lead reference, no personal data; entries of older releases that
  also held name/phone/e-mail are rewritten without them) in `localStorage`; later downloads skip
  the form and navigate straight to the signed `download_url`. A rejected token clears the memory and shows the form.
- **Site visits**: 14-day date strip from the live availability endpoint (IST), slot chips with "N left", 1–6 visitors;
  success shows visit number, date/time, address, maps link, `.ics` download and the manage link. `/visit/[token]` shows
  the visit, offers the `.ics`, and cancels after an inline confirmation.
- **Availability grid** renders only `AVAILABLE | NOT_AVAILABLE` cells with a legend; prices render only when present.
- **Embeds** (video, 360° tour, map) are poster + button; the iframe is injected only on click.
- **Markdown** from the CMS is parsed into React elements — no `dangerouslySetInnerHTML` of user content. JSON-LD is the
  only inline script and is our own serialised JSON with `<` escaped (a data block: the CSP does not apply to it).
- **Coming soon**: when `site_live` is false every (site) page returns the coming-soon view (also from
  `generateMetadata`, so nothing leaks via title or RSC payload); `/privacy` and `/disclaimer` stay up; robots disallows
  everything and the sitemap lists only the legal pages.
- **SEO**: title template `%s · {brand}`, OpenGraph/Twitter, canonical per page, Organization/WebSite/RealEstateListing/
  Article/Breadcrumb/FAQ JSON-LD, sitemap and robots built from published content only.
- **Accessibility**: skip link, visible gold focus rings, 48 px tap targets (`tap`, `min-h-12`), focus-trapped dialogs
  and lightbox (Esc closes), native `<details>` FAQs, `prefers-reduced-motion` respected everywhere. Form controls inside
  a `Field` get `aria-invalid`, `aria-required` and `aria-describedby` (→ the `role="alert"` error, else the hint)
  automatically. Text tokens meet WCAG AA (`node docs/qa/contrast.mjs web`); every page is scanned with axe-core at 1440 and
  390 px by the browser QA. Pages with the sticky "On this page" bar raise `scroll-padding-top` so focused content is never
  hidden under it.
- **Detail fetches** are memoised per request with React `cache()`: `generateMetadata` and the page share one API call.
