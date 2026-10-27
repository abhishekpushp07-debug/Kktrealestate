# Phase 7 — domain & website track

Scope: items 1–8 of the domain & website task (v3 audit, docs/AUDIT-80-FACTORS-V3.md, findings [B] tenant, [C] website caching, [D] visitor
token, [E] rate-card apply / regenerate / PLC precision, [G] master import, service SLA, sitemap/.ics, [H] website error reporting) and the
website side of contracts C2, C3, C4, C5. Everything is in the working tree; nothing is committed. Databases: `kkt_p7_d` / Redis 10
(integration + browser QA), `kkt_p7_d_acc` / Redis 11 (acceptance and API unit).

## Changes (file list)

**apps/api — owned**

- `src/modules/inventory/service.ts` — `repriceFlats` locks the AVAILABLE flats it may re-price (`SELECT … FOR UPDATE`, id order) before
  reading statuses; `applyPriceUpdates(tx, updates, rateCardId, statuses = ["AVAILABLE"])` re-checks the status in the UPDATE and returns
  the ids it wrote; `translateDomainError(err, {rateCardId})` maps `MoneyError` → 422 `INVALID_AMOUNT` (`details.rate_card_id`,
  `issues[0].path = "plc_rules"`); `priceWith` passes the card.
- `src/modules/inventory/blocks.ts` — `flatsWithBookingHistory`, `regenerateInto` (regenerate route and structural PATCH): flats with booking
  history kept in place or 409 `FLAT_HAS_BOOKING_HISTORY`; bulk price edit passes its status allow-list to `applyPriceUpdates`.
- `src/modules/masters/importer.ts` — header check (`checkImportHeader`, `suggestColumn`), partial UPDATE schema (`partialImportSchema`,
  defaults stripped), CREATE/UPDATE decided by the key before validation, re-validated at commit, `ignored_columns`.
- `src/modules/masters/templates.ts` (new) — `GET /masters/{path}/import-template` (×16), `describeColumn`, `exampleRow`, `importTemplate`.
- `src/modules/masters/factory.ts` — `withoutDefaults` for PATCH bodies (payment-plan PATCH reset `grace_days` to 0); `masters/index.ts`
  registers the template routes.
- `src/modules/service/ticketService.ts` — `slaPatch` / `statusPatch(current, to, now, slaHours?)` (pause, resume, reopen),
  `reopenSlaHours`, priority change shifts the deadline by the hour difference, `slaBreachedCondition` skips paused tickets, rows expose
  `sla_paused_at` / `sla_paused_seconds` (stripped from customer rows). `service/jobs.ts` — breach job skips paused tickets and re-checks
  the deadline in its UPDATE; audit row carries the real `sla_due_at`.
- `src/modules/web/shared.ts` — `publicCompany(app, req)` (contract C4, replaces `publicCompanyId` = "first company created"),
  `publicCached(app, req, reply, (companyId) => …)` keys the Redis copy by company, `CATALOG_CACHE_POLICY` / `CMS_CACHE_POLICY` /
  `AVAILABILITY_CACHE_POLICY` (contract C5), `revalidateWebsite` (best-effort, coalesced 250 ms) called by `bustPublicCache()` without a path
  prefix (CMS and project-website writes).
- `src/modules/web/publicContent.ts` — every public GET with a `cachePolicy` and the resolved company; `sitemapEntries` rewritten (all
  posts, all CMS pages, real lastmod per page, never "now"); project cards carry `updated_at`.
- `src/modules/web/publicForms.ts` — opaque visitor token (`signVisitorToken(leadId)`, `parseVisitorToken`, `lookupVisitor`; legacy
  readable tokens still honoured until expiry); brochure signatures checked with `keyedHashMatches` (every HASH_KEYS key — security
  track "Needs 4"); tenant via `publicCompany`.
- `src/modules/web/publicVisits.ts` — tenant via `publicCompany`, availability `cachePolicy`, `visitIcsByToken` (a cancelled visit's link
  keeps serving METHOD:CANCEL until the original expiry), ORGANIZER from site settings.
- `src/modules/web/visitService.ts` — `visitIcs(v, project, settings, token, {now, organizer})` (REQUEST/CANCEL, SEQUENCE, DTSTAMP = now,
  ATTENDEE), `visitOrganizer`, `ics_sequence + 1` on reschedule and cancel. `web/index.ts` — exports.
- `src/config.ts` (one targeted edit) — `WEB_REVALIDATE_URL`, `WEB_REVALIDATE_TOKEN` (≥ 32).

**packages**

- `contracts/src/errors.ts` (targeted edits) — `FLAT_HAS_BOOKING_HISTORY` (409), `IMPORT_UNKNOWN_COLUMNS` (422).
- `contracts/src/modules/blocks.ts` — `FlatHistoryRefSchema`, `FlatHasBookingHistoryDetailsSchema`, `BlockGenerateFlatsResponse.flats_preserved?`.
- `contracts/src/modules/masters.ts` — `MasterCsvImportResponse.ignored_columns?`, `ImportUnknownColumnsDetailsSchema`,
  `ImportColumnTypeSchema`, `ImportTemplateColumnSchema`, `MasterImportTemplateSchema`, `MasterImportTemplateQuerySchema`.
- `contracts/src/modules/service.ts` — `ServiceRequestRow.sla_paused_at?`, `sla_paused_seconds?` (omitted from `CustomerTicketRow`).
- `contracts/src/modules/public.ts` — `PublicProjectCard.updated_at?`, sitemap doc.
- `domain/src/visits.ts` — `VisitICSInput.sequence / method / organizer / attendee`, `icsForVisit` (METHOD:REQUEST|CANCEL, SEQUENCE,
  DTSTAMP default = now, STATUS:CANCELLED without VALARM, quoted CN). `domain/test/visits.test.ts` — 5 new tests.

**apps/web — owned** (all but `lib/format.ts`)

- `app/layout.tsx` — `force-dynamic` removed (ISR; `revalidate = 300`), mounts `ErrorReporter`.
- Pages: `revalidate` 60 (home, project detail, contact, `/projects`) / 300 (about, gallery, blog, blog post, privacy, disclaimer);
  `generateStaticParams() → []` on `/projects/[slug]`, `/blog/[slug]`; new `app/(legal)/[slug]/page.tsx` (every other published CMS page —
  the sitemap lists them at `/<slug>`, they used to 404); `visit/[token]` is `force-dynamic`.
- `app/sitemap.ts` (from `GET /public/sitemap`, real lastmod), `app/robots.ts` (`revalidate = 300`), `app/global-error.tsx` (new),
  `app/api/revalidate/route.ts` (new, on-demand ISR).
- `lib/api.ts` — ISR reads through `unstable_cache` (tag `kkt-public`, 404 cached, 5xx/network never cached, retried once with a 10 s
  lifetime), no more `revalidate: 0` detail fetches; C3 headers (`x-kkt-internal-token` on every server call, `x-kkt-client-ip` + sanitised
  XFF on per-visitor calls), C4 (`x-kkt-company` from `KKT_COMPANY_SLUG`, part of the cache key; browser client `publicClient(apiUrl,
companySlug)`), `getSitemap`, `isBuildPhase`, `getPage` → null during a build without API.
- `lib/env.ts` — `internalApiToken`, `companySlug`, `revalidateToken`, `releaseId`; `SiteConfig.companySlug`, `release`.
- `lib/csp.ts`, `middleware.ts` — two script policies (nonce for per-request pages; `'self'` + hash placeholder for ISR pages), `usesNonce`.
- `csp-hook.cjs` (new) — fills the hash placeholder per HTML response (see Decisions). `next.config.ts` `compress: false`;
  `package.json` `start` loads the hook; `Dockerfile` copies it and `CMD ["node", "--require", "./apps/web/csp-hook.cjs", "apps/web/server.js"]`.
- `lib/errorReporter.ts`, `components/ErrorReporter.tsx` (new), `components/layout/ErrorView.tsx` (reports) — contract C2.
- `components/forms/BrochureGate.tsx` — stores only the opaque token (older entries rewritten without name/phone/e-mail), token-only repeat
  request; `EnquiryForm`, `VisitBooking`, `ManageVisit`, `RescheduleVisit` — company slug; `LegalPageView` — build placeholder;
  `lib/types.ts` — `BrochureRepeatRequest`, `SitemapEntry`.
- Tests: `test/api-forwarding.test.ts` (rewritten), `test/csp.test.ts`, new `test/csp-hook.test.ts`, `test/error-reporter.test.ts`,
  `test/revalidate-route.test.ts`.

**Tests (API)** — new `test/integration/inventory-phase7.test.ts`, `masters-phase7.test.ts`, `service-phase7.test.ts`, `web-phase7.test.ts`;
updated `visits.test.ts` (.ics revision assertions, CANCEL file after cancel, C5 header), `web.test.ts` (C5 header, opaque token),
`web-adversarial.test.ts` (token shape), `foundation.test.ts` (regenerate after a cancelled booking now keeps the flat in place: 200,
`flats_preserved: 1`, instead of 409 IN_USE), `acceptance/12-brochure-site-visits.test.ts` (`s-maxage=60`).

**Docs** — `API-CONVENTIONS.md` (error map: FLAT_HAS_BOOKING_HISTORY, INVALID_AMOUNT from pricing, IMPORT_UNKNOWN_COLUMNS; Appendix B:
`/public/sitemap`, C5 policies, tenant, visitor token, .ics), `ARCHITECTURE.md` (ISR, caching tiers, hashed CSP), `DATA-MODEL.md` (SLA
semantics, ics_sequence, flat history invariant), `SECURITY.md` (website CSP, public API), `DEPLOY.md` (web start with the hook, web env,
`WEB_REVALIDATE_*`), `qa/web.md` (phase 7 run), `qa/web/browser-qa.cjs` (security flow for both CSP policies, ISR, C2 report, sitemap vs
API, per-visitor IP forwarding), `apps/web/README.md`.

## Item by item

1. **Rate-card apply vs bookings.** `repriceFlats` first locks the project's (or block's) AVAILABLE flats `FOR UPDATE` in id order (the
   order bulk edit / bulk status use; a booking locks one flat then the block, apply never takes the block, so no cycle), then reads them —
   READ COMMITTED re-reads after a lock wait, so a flat a booking took meanwhile is seen BOOKED and skipped. The UPDATE also carries
   `status in (…)` and returns what it wrote; `repriced` / `skipped_not_available` count the real outcome. Tests: a raw transaction locks
   a flat and takes it off AVAILABLE while apply waits on the lock (asserted via `pg_stat_activity`) → that flat keeps its price, every
   other AVAILABLE flat of the project is re-priced; `applyPriceUpdates` refuses a BOOKED flat; three real `POST /bookings` ‖
   `POST /rate-cards/:id/apply` races → the booked flat's price always equals the booking's `list_price_paise`.
2. **Booking history.** Before deleting, the block's flats referenced by any booking are listed; when the new layout has a flat with the
   same number on the same floor and position, that flat is regenerated **in place** (same id, re-snapshotted type/areas/price, audit
   `flat.regenerate_in_place`), every other flat is replaced as before; otherwise the whole change is 409 `FLAT_HAS_BOOKING_HISTORY`
   `details.flats[] = {id, flat_number, floor, position, bookings}` and nothing changes. Tests: regenerate keeps the history flat's id
   (`flats_preserved: 1`), a code change (renumbering) and a `floor_start` change that drops floor 1 are 409 with the flat listed, adding a
   floor works and keeps the id.
3. **PERCENT PLC with 3+ decimals.** `translateDomainError` maps `MoneyError` to 422 `INVALID_AMOUNT` naming the rate card. End-to-end
   with a bad row written straight into `rate_card_plc_rules`: POST and GET preview, activation with apply (rolls back, card stays
   Draft), apply (dry-run and real), flat generation, and the active-card preview are all 422, never 500.
4. **Master CSV import.** Header check first: a column that is neither a create-schema field nor one of the kind's export-only columns
   (`id`, `version`, `is_active`, looked-up names — accepted and listed in `ignored_columns`) is 422 `IMPORT_UNKNOWN_COLUMNS` with the
   expected names, the required ones and a suggestion (`default_amount` → `default_amount_paise`). An existing key → UPDATE validated by a
   default-free partial schema: only the CSV's non-empty cells are written. New key → CREATE with the create schema (defaults apply).
   Templates: `GET /masters/{path}/import-template` → header (create-schema fields in order), column types/required/enum values/key,
   an example row valid for the caller's company (room/area/flat-type/spec-category ids from its active masters; `notes` say what to create
   first otherwise), the RFC 4180 `csv`; `?format=csv` downloads it. Also fixed: master PATCH bodies no longer re-apply Zod defaults
   (payment-plan PATCH reset `grace_days` to 0). Tests: charge types re-imported with `code,name` keep amount/GST/demand_at/taxable,
   an empty cell keeps the value; flat types keep `spec_item_ids`; unknown columns; export columns ignored; every one of the 16 templates
   imports (CREATE then UPDATE) with no errors; CSV download; missing reference noted; plan PATCH keeps `grace_days`.
5. **Service SLA.** Entering AWAITING_CUSTOMER sets `sla_paused_at`; leaving it (customer reply or staff) adds the pause to `sla_due_at` and
   `sla_paused_seconds`; while paused the ticket is never breached (row flag, list filter, breach job). A reopen (customer or staff
   RESOLVED → IN_PROGRESS) sets `sla_due_at = reopen + priority hours`, clears `sla_breached_at` and the pause fields, so the job alerts
   again. A priority change moves the deadline by the difference in hours. Tests with a faked clock (`vi.useFakeTimers({toFake:["Date"]})`):
   5 h past the original deadline while paused → not breached; resume adds 4.5 h; flagged only after the shifted deadline; two pauses add
   up; reopen resets and re-alerts (notifications doubled); staff reopen; priority shift keeps the pause; pure `slaPatch` cases.
6. **.ics.** Stable `UID:<visit id>@kkt`, `SEQUENCE = ics_sequence` (+1 on every reschedule and the cancellation), `DTSTAMP` = generation
   time, `METHOD:REQUEST` for create/update, `METHOD:CANCEL` + `STATUS:CANCELLED` (no reminder, no visitor details) for a cancelled visit,
   ORGANIZER (brand + contact e-mail when configured), ATTENDEE (visitor e-mail when given). The cancelled visit's link keeps serving the
   CANCEL file until its original expiry so a calendar can drop the event (the manage view stays 410). Unit tests in packages/domain;
   integration: SEQUENCE 0/REQUEST/UID/DTSTAMP≈now on booking, SEQUENCE 1 after a visitor reschedule (same UID), CANCEL + SEQUENCE 1 after
   a cancel.
7. **Public API.** Tenant: every public route resolves the company with `lib/tenant.ts` (slug header, Host, the only company; 400
   `COMPANY_REQUIRED` otherwise) and the API's Redis copy is keyed by company. C5: catalog 60 s, availability 60/30, CMS 300 s with
   stale-while-revalidate, strong ETag and 304 (platform hook). Sitemap: `GET /public/sitemap` lists static pages, projects, **all**
   published posts and CMS pages with real lastmod. Visitor token: opaque signed lead reference. Tests (web-phase7): C5 headers + 304 +
   `Vary`, authenticated/404 no-store, 15 posts + a CMS page with exact lastmods and no "now", opaque token (no PII in any decoded part,
   tamper, expiry, other company, unknown lead), legacy token transition, revalidation POST with the secret, website down never fails a
   write, two companies (slug header, Host, ambiguity, unknown slug, no cache bleed between companies).
8. **apps/web.** ISR as listed; on-demand revalidation route; C3/C4 headers; sitemap from the API; `global-error.tsx` + reporter;
   CSP kept strict (see Decisions); brochure gate keeps no PII on the device. Web unit tests 36/36; browser QA against a production build
   **152/152 checks, 0 defects, axe 0 serious/critical** (docs/qa/web.md).

## Decisions

- **Booking-history flats are kept in place, not refused outright.** The task asks for 409 when a change would delete them and that
  changes not deleting them still work; a structural regeneration replaces every flat, so the only way a change can "not delete" a flat is
  to keep it. Matching is strict (same number, floor and position), the kept flat is AVAILABLE (the existing guard) and its id, booking
  references and history survive; anything else is the 409.
- **Strict CSP with ISR via SHA-256 hashes (`csp-hook.cjs`).** ISR HTML is shared, so it cannot carry a per-request nonce, and Next 15
  inlines each page's RSC payload as inline scripts; SRI covers external chunks only. Weakening `script-src` with `'unsafe-inline'` was not
  acceptable. The hook (loaded with `node --require`) wraps Next's request listener, buffers only HTML responses whose CSP carries the
  `'kkt-inline-hashes'` placeholder, and replaces it with the hashes of the inline scripts actually sent (74 on a project page, ≈ 4 KB of
  header). It fails closed (placeholder reaches the browser → inline scripts blocked), drops the policy on 304s (found in QA: a 304's
  headers replace the cached ones), and leaves nonce policies and non-HTML responses alone. Requires `compress: false` (Caddy compresses).
  Pages rendered per request keep the nonce policy.
- **`/projects` and `/blog` render per request** (they read `?city=…` / `?page=` so filters and pagination work without JavaScript); their
  API data still comes from the 60/300 s cache. Every other page is ISR and CDN-cacheable.
- **`unstable_cache` instead of fetch's Data Cache** for server reads: the fetch cache keeps serving the last 200 when a revalidation
  answers 404 (why details were `revalidate: 0`); `unstable_cache` stores the 404 like any answer, so unpublished content disappears. A
  5xx / network failure is thrown inside the cache scope (never stored) and retried once with `revalidate: 10`, which also lowers the
  page's own revalidation — `next build` needs no API and its fallback pages regenerate 10 s after the first request.
- **Availability `s-maxage=60`** (SPEC "cached ~60 s") with a short 30 s stale window; the booking re-checks capacity atomically anyway.
- **Revalidation is coalesced** (250 ms) and fire-and-forget; only CMS and project-website writes trigger it (`bustPublicCache()` without a
  path), not visit bookings.
- **Visitor token** = `signLinkBody("kkt-visitor-v2", version + lead id + exp)`: no PII, ring-rotatable; the lead id is an internal
  reference but not personal data and is MAC-protected. Every reply re-issues a fresh token. Legacy readable tokens are honoured until
  they expire (≤ 180 days) and replaced on first use.
- **Import UPDATE rows: empty cell = unchanged** (a CSV cannot clear a nullable field; use the form). Export-only columns are accepted so a
  list CSV can be edited and re-imported for updates.
- **SLA for tickets already AWAITING_CUSTOMER at deploy**: no `sla_paused_at`, so their clock keeps running until their next status change
  (no backfill — see Needs).
- **C3 for cached renders**: ISR regenerations have no visitor; they send the internal token without `x-kkt-client-ip`, so they count against
  the web server's IP — a handful of calls a minute.

## Tests and results

| Suite                                                                                                                                                                                                                                          | Database / Redis       | Result                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| API typecheck (`tsc --noEmit`), ESLint `--max-warnings 0` and Prettier on every file I touched                                                                                                                                                 | —                      | green                                                                                                                        |
| packages/contracts typecheck + tests                                                                                                                                                                                                           | —                      | 203/203                                                                                                                      |
| packages/domain typecheck + tests                                                                                                                                                                                                              | —                      | 139/139 (5 new .ics tests)                                                                                                   |
| apps/web typecheck, lint, Prettier, tests                                                                                                                                                                                                      | —                      | green, 36/36 (new: csp-hook 6, error-reporter 3, revalidate-route 3; api-forwarding rewritten 9; csp +2)                     |
| apps/erp typecheck                                                                                                                                                                                                                             | —                      | green                                                                                                                        |
| apps/portal typecheck                                                                                                                                                                                                                          | —                      | red at `src/api/client.ts:89-91` — pre-existing (security track C1, its "Needs 9"), not touched                              |
| API unit (full)                                                                                                                                                                                                                                | kkt_p7_d_acc, Redis 11 | 161/164 — the 3 failures are `deploy-config.test.ts` (compose/k8s lack the C9 rings), pre-existing, security track "Needs 5" |
| Owned integration files (inventory, inventory-adversarial, inventory-phase7, masters, masters-phase7, service, service-adversarial, service-phase7, web, web-adversarial, web-phase7, visits, foundation, portal, security, seed, cross-track) | kkt_p7_d, Redis 10     | **282/282 in 17 files**                                                                                                      |
| Full integration suite                                                                                                                                                                                                                         | kkt_p7_d, Redis 10     | **745/745 in 58 files**                                                                                                      |
| Acceptance                                                                                                                                                                                                                                     | kkt_p7_d_acc, Redis 11 | **55/55 in 13 files**                                                                                                        |
| Website browser QA (production build + `csp-hook`, API with demo seed)                                                                                                                                                                         | kkt_p7_d, Redis 10     | **152/152 checks, 42 page audits, 0 defects; axe 42 scans, 0 serious/critical**                                              |

## Needs from other tracks

1. **Deploy (`.github/workflows/nightly.yml:116`)** — start the website with `pnpm --filter @kkt/web start` (or
   `NODE_OPTIONS=--require=./csp-hook.cjs npx next start …`), never a bare `next start`: without the hook ISR pages block their inline
   scripts. Compose/k8s use the image CMD (already updated). Add `INTERNAL_API_TOKEN`, `WEB_REVALIDATE_TOKEN` (and `KKT_COMPANY_SLUG` for
   multi-company installs) to the web service, and `WEB_REVALIDATE_URL=http://web:3000/api/revalidate` + `WEB_REVALIDATE_TOKEN` to the API
   (compose, prod compose, k8s, `.env.example`, `gen-secrets.sh`). Caddy must keep compressing the website (Next's `compress` is off).
2. **Platform (`apps/api/src/app.ts` CORS)** — `allowedHeaders` += `x-kkt-company` (the website's browser calls send it when
   `KKT_COMPANY_SLUG` is set; security track asked for it too). Optional: add `WEB_REVALIDATE_TOKEN` to `SECRET_FILE_VARS` and the
   production placeholder checks in `config.ts`.
3. **Security (`plugins/auth.ts`)** — optional: a request with a valid internal token but no `x-kkt-client-ip` (ISR regenerations) could
   skip the public per-IP budget instead of counting against the web server.
4. **Foundation / db** — `packages/db/src/schema/service.ts:39` comment should read "paused time of the current SLA window, already added
   to sla_due_at on resume". Optional data migration: `UPDATE service_requests SET sla_paused_at = updated_at WHERE status =
'AWAITING_CUSTOMER' AND sla_paused_at IS NULL` so tickets waiting at deploy time pause too.
5. **Frontend (ERP)** — build the master import templates from `GET /masters/{path}/import-template` (drop the hand-kept column lists in
   `features/masters/masterConfig.ts`); show `IMPORT_UNKNOWN_COLUMNS` details (unknown → suggestion, expected list) and `ignored_columns`;
   handle 409 `FLAT_HAS_BOOKING_HISTORY` on block PATCH / regenerate (list `details.flats`); show `flats_preserved` after a regenerate;
   show a "paused" SLA badge from `sla_paused_at`; 422 `INVALID_AMOUNT` from rate-card actions names `details.rate_card_id`.
6. **OpenAPI** — regenerate at integration: new `GET /masters/{path}/import-template` ×16; additive fields `flats_preserved`,
   `ignored_columns`, `sla_paused_at`, `sla_paused_seconds`, `PublicProjectCard.updated_at`; new error codes; public GET Cache-Control
   changes (C5).

## Contract shapes for other tracks / frontends

- `GET /api/v1/masters/{path}/import-template[?format=csv]` (permission `master.read`) → `MasterImportTemplate {kind, path, key_field,
columns: [{name, required, type: string|number|boolean|enum|list|json, values?, key}], header: string[], example: {col: cell text},
csv: string, notes: string[]}`; `?format=csv` → `text/csv` attachment `<path>-import-template.csv`. Lists are `|`-separated, arrays of
  objects JSON in one cell.
- `POST /masters/import` → as before plus `ignored_columns?: string[]`; UPDATE rows' `data` holds only the CSV's columns. 422
  `IMPORT_UNKNOWN_COLUMNS` `details = {kind, unknown_columns, suggestions: {unknown: expected}, expected_columns, required_columns}`.
- 409 `FLAT_HAS_BOOKING_HISTORY` `details = {flats: [{id, flat_number, floor, position, bookings}]}`;
  `BlockGenerateFlatsResponse.flats_preserved?: int`.
- 422 `INVALID_AMOUNT` from pricing: `details = {issues: [{path: "plc_rules", message, code: "money"}], rate_card_id}`.
- `ServiceRequestRow.sla_paused_at: string|null`, `sla_paused_seconds: int` (staff only).
- `GET /api/v1/public/sitemap` → `{entries: [{path, updated_at, priority}]}`; `PublicProjectCard.updated_at`.
- Visitor token: opaque string `<kid>.<body>.<sig>` (≤ 200 chars); clients store it as is; a token-only request
  `{project_slug, visitor_token, website: ""}` re-issues a link.
- Website: `POST /api/revalidate` with `x-kkt-revalidate-token`, body `{tags?: string[], paths?: string[]}` → `{revalidated: true, tags,
paths, now}`; 401 bad token, 404 when off. Env: `INTERNAL_API_TOKEN`, `KKT_COMPANY_SLUG`, `WEB_REVALIDATE_TOKEN`, `GIT_SHA`.
- API env: `WEB_REVALIDATE_URL`, `WEB_REVALIDATE_TOKEN`.

## Not done / notes

- Tickets AWAITING_CUSTOMER at deploy time do not pause until their next status change (backfill offered in Needs 4).
- `docs/qa/web/brochure.pdf` is rewritten by the QA runner's brochure flow (the file it downloads); its content is the seeded brochure.
- The website's CSP header on ISR pages grows with the number of inline scripts (≈ 4 KB on the largest page); fine for Caddy/CDNs (8–16
  KB header limits) but worth watching if pages grow much larger.
