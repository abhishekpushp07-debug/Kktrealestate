# Phase 7 — adversarial review of the domain & website track

Scope: docs/hardening/phase7-domain.md and the v3 audit findings it was assigned: rate-card apply vs bookings, regeneration with booking
history, 3-decimal PERCENT PLC, master CSV import, service SLA, sitemap and .ics, public-site tenancy, website caching (C5) and ISR,
visitor token, website error reporting (C2), the website side of C3/C4. I read the changed code in `git diff 34c075e` and tried to break
each item with concurrent transactions, odd input and a production build of the website. Databases: `kkt_p7_rdomain` / Redis 22
(integration), `kkt_p7_rdomain_acc` / Redis 23 (API unit, acceptance, website QA API).

## Verdict per assigned finding

| Finding                                                            | Verdict                                           | Notes                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [E] rate-card apply re-prices a just-booked flat                   | **Fixed.** Residual deadlock found and fixed (D1) | Apply locks AVAILABLE flats in id order and the UPDATE re-checks the status. The test that races a real booking against apply passes. Activation with apply still deadlocked against a booking (D1).                                                                                 |
| [E] regenerate / structural edit with booking history → 500        | **Fixed**                                         | Only `bookings.flat_id` references `flats`, so no other foreign key can still 500. In-place matching is strict (number, floor and position); otherwise the API answers 409. The block lock comes before the flats, and the race with a booking is retried by `withTransactionRetry`. |
| [B]/[E] PERCENT PLC with 3+ decimals → 500                         | **Fixed**, mapping narrowed (D3)                  | The contract refuses a third decimal. All pricing goes through `priceWith`, so every path maps `MoneyError` to 422. A non-percent money failure was wrongly blamed on `plc_rules`.                                                                                                   |
| [G] master CSV import corrupts records                             | **Fixed**, crash found and fixed (D2)             | UPDATE rows use a partial schema with no defaults. Plan sums and the flat-type rate-vs-price rule are still enforced in `prepare`. Headers named like `Object.prototype` members caused a 500.                                                                                       |
| [G] SLA not paused / reopen never re-alerts                        | **Fixed**                                         | Pause, resume, reopen and a priority shift are all correct. No other code path reads `sla_due_at`. Tickets that were already AWAITING_CUSTOMER at deploy time still need a backfill (see open items).                                                                                |
| [G] sitemap (12 posts, no CMS pages, lastmod=now) and .ics updates | **Fixed**, .ics hardened (D4)                     | The sitemap lists all posts and pages with real lastmod. The .ics has a stable UID, SEQUENCE, DTSTAMP and METHOD:REQUEST/CANCEL, and a cancelled visit still serves its CANCEL file.                                                                                                 |
| [B] public site serves the first-created company                   | **Fixed**                                         | `publicCompany` uses `resolveCompanyId`, and the Redis cache is keyed per company.                                                                                                                                                                                                   |
| [C] website not CDN-cacheable (force-dynamic, revalidate 0)        | **Fixed**, two defects found and fixed (D5, D6)   | ISR and `unstable_cache` with on-demand revalidation work. The hash-based CSP trusted any inline script in the body (D5). Made-up slugs filled the never-evicted Data Cache and spent the web server's API rate budget (D6).                                                         |
| [D] visitor token holds readable PII                               | **Fixed**                                         | The token is opaque and signed with the link ring. It is bound to the company through the lead lookup. Erased leads resolve to nobody. The device stores only the token.                                                                                                             |
| [H] website failures invisible (no global-error, no RUM)           | **Fixed**                                         | `global-error.tsx` and `ErrorReporter` send C2 reports. Query strings and the visit token are stripped from the URL.                                                                                                                                                                 |

## Defects found and fixed

**D1. Rate-card activation (and parking, block creation, project PATCH) deadlocked against a concurrent booking. Each time one side got a 409 CONFLICT_RETRY.**

- The activation locked the project row `FOR UPDATE` and then the AVAILABLE flats. A booking locks its flat, then the block and parking rows. It then INSERTs into `bookings`, whose `project_id` foreign key takes `FOR KEY SHARE` on the project row, and `FOR UPDATE` blocks that.
- Result: the booking waited for the project and the activation waited for the flat, and Postgres aborted one of them with 40P01.
- The same cycle existed for `loadProject(…, true)`, which parking bulk-status, parking create, block create and project PATCH/deactivate use. A booking holds the parking slot that the parking operation then wants.
- `FOR UPDATE` on a parent row also blocked every child INSERT of the project (payments, demands, leads, enquiries) for the whole transaction.
- Fix: these locks are now `FOR NO KEY UPDATE` (`inventory/service.ts loadProject`, `inventory/rateCards.ts` activate). That still conflicts with every other explicit lock on the row, so activations stay serialised, but it no longer blocks a foreign-key `KEY SHARE`.
- Tests (`test/integration/domain-review-phase7.test.ts`), each verified to fail before the fix:
  - an activation with apply that waits on a flat held by a booking-shaped transaction now answers 200 and does not re-price that flat;
  - parking bulk-status against a transaction holding a slot answers 200;
  - two concurrent activations still leave exactly one ACTIVE card.
- Documented in API-CONVENTIONS ("Parent rows are locked FOR NO KEY UPDATE").

**D2. Master CSV import answered 500 for a header named `constructor`, `toString`, `hasOwnProperty`…, and silently accepted `__proto__`.**

- Both `checkImportHeader` and `csvRecordToInput` tested header names against the Zod shape, which is a plain object, using `in` or plain indexing. That also matches inherited keys.
- `shape["constructor"]` is `Object`, and coercing a cell against it threw a TypeError, which surfaced as a 500.
- Fix: both functions now use `Object.hasOwn`, so all these names are 422 `IMPORT_UNKNOWN_COLUMNS`.
- Tests: integration (4 headers) and unit (`test/unit/domain-review-phase7.test.ts`).

**D3. `translateDomainError` blamed `plc_rules` for any `MoneyError`.**

- A price beyond the safe range on a rate-card action produced "Correct the PLC rule value" with `issues[0].path = "plc_rules"`.
- Fix: only a percent failure (`Percent …`) points at `plc_rules` and gives the PLC hint. Other money failures still answer 422 INVALID_AMOUNT and name the rate card, but with `path: ""`.
- Unit tests cover the percent case, the overflow case and the case with no rate card. The existing e2e 3-decimal tests are unchanged and pass.

**D4. .ics `ORGANIZER` / `ATTENDEE` wrote the e-mail into `mailto:` unchecked.**

- A stored value containing CR/LF (legacy data or a future write path) would start new iCalendar properties.
- Fix: `icsForVisit` writes the line only for a plain address (one `@`, no whitespace, control characters, quotes or delimiters) and leaves it out otherwise.
- Test in `packages/domain/test/visits.test.ts`.

**D5. The ISR CSP hook vouched for any inline script in the response.**

- `csp-hook.cjs` hashed every executable inline `<script>` of the HTML it sent. A script injected into the markup by a rendering bug or a sanitiser bypass got its own hash, and the browser ran it. That is `'unsafe-inline'` for server-side injection, the case the CSP exists for. The docs claimed "an injected inline script has no hash".
- Fix: the hook hashes only scripts that are exactly Next's RSC payload. That means a sequence of these, where every argument must parse as JSON:
  - `self.__next_f=self.__next_f||[]`
  - `(self.__next_f=self.__next_f||[]).push(<JSON array>)`
  - `self.__next_f.push(<JSON array>)`
- The JSON boundary is found with a linear scan. Anything else is left without a hash, so the browser blocks it, and it is logged once (`[csp-hook] inline script is not a Next.js payload`).
- Unit tests (`apps/web/test/csp-hook.test.ts`) cover:
  - allowed shapes: init only, init followed by push, pushes with `;)]` inside strings, multi-line;
  - refused shapes: `alert`, push followed by `;alert`, push followed by `,alert`, a non-JSON argument, an object argument, the `||[].constructor…` trick, a trailing comment, an empty script;
  - an injected `<script>` in the HTML gets no hash.
- Production build: every inline script Next emitted was recognised. Browser QA passes 152/152 with no CSP violation and no hook warning.
- Docs updated: SECURITY, ARCHITECTURE, apps/web/README.

**D6. Made-up detail slugs grew the website's Data Cache without bound and spent the web server's shared API rate budget.**

- `/projects/[slug]`, `/blog/[slug]` and `/[slug]` (CMS pages) fetch through `unstable_cache` and cache 404s on purpose. Each distinct random slug therefore wrote a file to `.next/cache/fetch-cache`, which is never evicted. I measured 31 new files for 31 `/projects/<random>` requests.
- Each of those requests was also an API call. ISR reads carry the internal token but no visitor IP, so they all counted against the web server's per-IP "catalog" budget. A flood of random URLs could therefore push real page regenerations into 429.
- Fix: `lib/api.ts isKnownPath` checks the slug against the cached sitemap (`GET /public/sitemap`). The sitemap lists every published project, post and CMS page and is purged with everything else on each CMS or project-website write.
  - An unlisted slug is a 404 with no API call and no cache entry.
  - When there is no sitemap (API down, or a build without the API), the detail is fetched directly, as before.
  - `(legal)/[slug]` applies the same gate in `generateMetadata` and in the page.
- Measured after the fix: 93 made-up-slug requests added 0 cache files, and real pages still return 200.
- Unit tests in `apps/web/test/api-forwarding.test.ts`: unknown slugs cause no fetch and no cache entry, listed slugs are fetched, and without a sitemap the detail is fetched directly. Existing assertions were adjusted to leave out the sitemap read.

## Checked and found sound (no change)

- **Apply re-pricing.** Under READ COMMITTED, `FOR UPDATE … WHERE status = 'AVAILABLE'` re-evaluates the status after a lock wait. A flat that leaves HOLD between the lock and the read is still guarded by the UPDATE's own status predicate, which re-checks it under the row lock. Dry runs take no locks.
- **Regenerate in place.** The in-place UPDATE keeps `notes` and `booking_id`; the latter is null after cancellation. A history flat whose match moved is a 409, never a silent delete. Blocks are deactivated, never deleted, so no cascade can reach `bookings`.
- **Import.** Payment-plan installment sums are validated in `prepare` (`validatePlan`) for UPDATE rows too. Flat types check rate vs lump sum on the merged row. A row that changes between CREATE and UPDATE after the preview is re-validated at commit. `withoutDefaults` drops no refinement: the payment-plan update body was already a plain `strictObject`.
- **SLA.** Every status path (staff change, staff message with status, customer reply, customer reopen, rating close) goes through `statusPatch`. The breach job's UPDATE re-checks both the pause and the deadline.
- **Public tenancy and caching.** Responses carry Vary and ETag, and authenticated or 404 responses are no-store (tests in web-phase7). The visitor token for a lead of another company resolves to nobody. Revalidation is coalesced, fire-and-forget, and runs after commit.
- **Revalidate route.** It compares the secret in constant time and returns 404 when the secret is not set. Tags and paths are restricted by regex.
- **Error reporter.** It strips the query and the fragment, redacts the `/visit/<token>` path, sends at most 5 reports per page load and sends no credentials.

## Tests and results

| Suite                                                                                      | Database / Redis        | Result                                                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| New: `apps/api/test/integration/domain-review-phase7.test.ts`                              | kkt_p7_rdomain / 22     | 7/7; the 2 lock tests and 4 header tests fail without the fixes                                                    |
| New: `apps/api/test/unit/domain-review-phase7.test.ts`                                     | kkt_p7_rdomain_acc / 23 | 4/4                                                                                                                |
| API typecheck, ESLint `--max-warnings 0`, Prettier (touched files)                         | —                       | green                                                                                                              |
| `pnpm -r typecheck` (all 7 packages)                                                       | —                       | green                                                                                                              |
| API unit (full)                                                                            | kkt_p7_rdomain_acc / 23 | **180/180 in 29 files**                                                                                            |
| API integration (full)                                                                     | kkt_p7_rdomain / 22     | **787/787 in 64 files**                                                                                            |
| Acceptance                                                                                 | kkt_p7_rdomain_acc / 23 | **55/55 in 13 files**                                                                                              |
| packages/domain                                                                            | —                       | 140/140 (1 new .ics test)                                                                                          |
| packages/contracts                                                                         | —                       | 244/244                                                                                                            |
| apps/web typecheck, lint, tests                                                            | —                       | green, **40/40** (csp-hook +1 test with 12 cases, api-forwarding +3)                                               |
| Website production build + browser QA (`docs/qa/web/browser-qa.cjs`, web :3740, API :4740) | kkt_p7_rdomain_acc / 23 | **42 page audits, 152/152 checks, 0 defects; axe 42 scans, 0 serious/critical**; no CSP violation, no hook warning |

The QA run rewrote `docs/qa/web/brochure.pdf`: the runner's brochure flow saves the downloaded seeded brochure there. Its content is the
same brochure.

## Changes (file list)

- `apps/api/src/modules/inventory/service.ts` — `loadProject` uses FOR NO KEY UPDATE; `translateDomainError` gives the PLC hint and `plc_rules` path only for percent failures.
- `apps/api/src/modules/inventory/rateCards.ts` — the activation's project lock is FOR NO KEY UPDATE.
- `apps/api/src/modules/masters/importer.ts` — own-key header and shape checks (`Object.hasOwn`).
- `packages/domain/src/visits.ts` — `isIcsEmail` guards ORGANIZER / ATTENDEE.
- `apps/web/csp-hook.cjs` — `isFrameworkScript`, `jsonArrayEnd`; only RSC payload scripts are hashed; warning for any other inline script.
- `apps/web/lib/api.ts` — `isKnownPath` (sitemap gate); `projectDetail` and `postDetail` are gated.
- `apps/web/app/(legal)/[slug]/page.tsx` — the same gate in metadata and page.
- Tests:
  - `apps/api/test/integration/domain-review-phase7.test.ts` (new)
  - `apps/api/test/unit/domain-review-phase7.test.ts` (new)
  - `packages/domain/test/visits.test.ts`
  - `apps/web/test/csp-hook.test.ts`
  - `apps/web/test/api-forwarding.test.ts`
- Docs:
  - `docs/API-CONVENTIONS.md` (parent-row lock strength)
  - `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `apps/web/README.md` (hash allow-list, sitemap gate)
  - `docs/qa/web.md` (this run)
  - this report

## Decisions

- **FOR NO KEY UPDATE rather than reordering locks.** Bookings take the flat first by design (the atomic flat lock in SPEC §12). Making the activation lock flats before the project would not help parking or block creation, and the other writers would have to change too. Weakening the parent lock to the strength Postgres itself uses for non-key UPDATEs removes the whole class of cycle and keeps every serialisation guarantee.
- **The CSP hook allow-lists the RSC payload shape instead of hashing everything.** The point of a hash policy is that the server vouches only for code it means to run. Next 15.5 static and ISR pages emit only `self.__next_f` payload scripts (checked on every prerendered page and in the full QA run). If a future Next adds another inline bootstrap, it will be blocked, fail closed, and the hook logs it, which is the safe failure.
- **The sitemap gate falls back to a direct fetch** when the sitemap cannot be read, so an API outage never turns real pages into 404s. A scheduled post becomes reachable within the sitemap's 300 s window; this lag already existed, because a detail 404 was cached for 300 s before.

## Not fixed / open (cross-track or data)

1. **ISR regenerations still count against the web server's IP in the API's public "catalog" budget.** They carry the internal token but no `x-kkt-client-ip`. D6 removes the amplification from made-up URLs. A busy site with many projects and posts could still approach the budget at the 60/300 s revalidation rate. Security / platform track: requests with a valid internal token and no `x-kkt-client-ip` should get a separate, larger budget (`pub:internal:*`) or be exempt (also the domain track's "Needs 3").
2. **Tickets already AWAITING_CUSTOMER at deploy time** do not pause until their next status change. This is the data backfill the domain track offered (db/foundation): `UPDATE service_requests SET sla_paused_at = updated_at WHERE status = 'AWAITING_CUSTOMER' AND sla_paused_at IS NULL`.
3. **On-demand revalidation targets one website.** `WEB_REVALIDATE_URL` is a single URL, so a multi-company install with one website per company only revalidates that one. The others refresh on their 60/300 s ISR timers. Ops / platform: allow a per-company URL (for example in `companies.settings`) if multi-website installs are planned.
4. **Seed-time noise.** With `WEB_REVALIDATE_URL` set and the website down, a seed logs one warn line (with stack) every 250 ms. This is harmless and limited by the coalescing, but platform could log the first failure per minute only.

## Contract shapes for other tracks / frontends

No wire contract changed. Behaviour changes:

- Rate-card activation, parking operations, block creation and project PATCH no longer fail with 409 `CONFLICT_RETRY` (40P01) when a booking runs at the same time.
- `POST /masters/import` answers 422 `IMPORT_UNKNOWN_COLUMNS` (details as before) for headers such as `constructor` or `__proto__`.
- 422 `INVALID_AMOUNT` from rate-card actions has `issues[0].path = "plc_rules"` only for percent failures (`details.rate_card_id` as before).
- Website: inline scripts other than Next's RSC payload are blocked on ISR pages, and made-up detail slugs are 404 without an API call.
