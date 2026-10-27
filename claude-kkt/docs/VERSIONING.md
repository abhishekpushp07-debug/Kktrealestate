# KKT v2 — API versioning and compatibility

The API serves three kinds of clients that do not update together: the staff ERP and the website (deployed with the API), and the
customer portal — whose iOS/Android builds stay on phones for months after a release. This policy keeps every client that worked
yesterday working today.

## The rules

1. **One major version per path.** Everything lives under `/api/v1`. A breaking change is either avoided, or shipped as a new
   operation (`/api/v1/...` with a new name), or — for a redesign of a whole surface — under `/api/v2` running side by side with v1.
2. **Within v1, changes are additive only.**
   - Allowed: new paths and operations; new **optional** request fields and query parameters; new response fields; new enum values in
     requests; new error codes (clients must show the server's `message` for codes they do not know — the contracts' `ApiErrorSchema`
     accepts any UPPER_SNAKE code); new enum values in responses (clients must treat unknown values as "other").
   - Breaking (never within v1 without the deprecation process): removing or renaming a path, operation, response field or enum value;
     changing a field's type or meaning; a response field that stops being always present (required → optional); making a request
     field or parameter required (or adding a required one); removing a request field (request schemas are strict, so old clients
     still sending it would get 400); restricting a free request value to an enum; tightening a request bound (`maxLength`, `maximum`,
     `maxItems` lowered or added; `minLength`, `minimum`, `minItems` raised or added); removing a success status.
3. **Deprecate, then retire.** A replaced operation is marked `deprecated` in its `route()` definition for at least **180 days**
   (`DEPRECATION_WINDOW_DAYS`); the portal's minimum supported app version must have moved past it before removal. After the sunset date
   it is replaced by `goneRoute()` for at least one more release, then deleted.
4. **The OpenAPI document is the contract.** `docs/openapi/v1.json` is generated from the code and committed. CI fails on any breaking
   difference and on an outdated snapshot.

## Mechanics

### Generating and checking the document

```bash
pnpm --filter @kkt/api openapi          # regenerate docs/openapi/v1.json (refuses to write a breaking change unless --force)
pnpm --filter @kkt/api openapi:check    # print the diff, exit 1 on breaking changes (CI job "openapi")
```

Both run without Postgres or Redis (`buildApp({ offline: true })`). The unit test `apps/api/test/unit/openapi-compat.test.ts` runs the
same comparison (and tests each rule on synthetic documents), printing BREAKING / Additive / Notices sections, e.g.

```
BREAKING (1):
  - GET /api/v1/bookings: response 200 property "items[].amount_paise" removed
Additive (1):
  - GET /api/v1/bookings: response 200 property "items[].flat_label" added
```

The checker (`apps/api/src/modules/system/openapiDiff.ts`) resolves `$ref`s, walks request bodies, parameters and every 2xx response
(nested objects, arrays, `anyOf`/`oneOf`/`allOf`) and reports a removed subtree once at its top.

### Deprecating an operation

```ts
route(app, {
  method: "GET", url: "/bookings/:id/schedule", permission: "booking.read",
  deprecated: { sunset: "2027-06-30", replacement: "GET /api/v1/bookings/:id?include=schedule" },
  schema: { … },
  handler: …,
});
```

Every response then carries

```
Deprecation: @1798761600                     (RFC 9745: when it was deprecated — `since`, default sunset − 180 days = 2027-01-01)
Sunset: Wed, 30 Jun 2027 00:00:00 GMT        (RFC 8594)
Link: </api/v1/docs>; rel="deprecation"; type="text/html", </api/v1/bookings/:id?include=schedule>; rel="successor-version"
```

the OpenAPI operation is `deprecated: true` with the sunset in its description, and `GET /api/v1/system/routes` lists the `sunset`.
Clients should react to the header: the ERP and website ship with the API, so they simply stop calling the operation; the portal app
should show a non-blocking "please update" notice when a response it relies on carries `Deprecation` (not wired yet — integration item).

### Retiring it

```ts
goneRoute(app, {
  method: "GET",
  url: "/bookings/:id/schedule",
  sunset: "2027-06-30",
  replacement: "GET /api/v1/bookings/:id?include=schedule",
});
```

answers `410 GONE` with `details: { sunset, replacement }` and the same `Sunset`/`Link` headers.

The retired operation disappears from the OpenAPI document. The compatibility gate accepts that only because the snapshot recorded it
as `deprecated: true` with an `x-sunset` date (written by `route()` for every deprecated operation) that has passed: it is reported
under "Notices" as `retired (deprecated, sunset …)`. Removing a deprecated operation before its sunset, or one that was never
deprecated, stays BREAKING. Regenerate the snapshot in the release that retires it.

The deprecation headers are added in a route-level `onSend` hook, so they are present on every answer of the operation — including
a 401/403 from authentication, a 429 from rate limiting or a 503 from load shedding — and never on other routes.

### When /api/v2 is justified

Only for a redesign that cannot be expressed additively (e.g. a different money model). v2 is mounted next to v1
(`app.register(…, { prefix: "/api/v2" })`), shares the services and the database, gets its own `docs/openapi/v2.json` snapshot and
compatibility test, and v1 follows rule 3 as a whole surface.

## Deliberate breaks

A break of rule 2 is shipped only when keeping the old behaviour is itself the defect, and then it is recorded in `CHANGELOG.md` under
"Breaking", the snapshot is regenerated with `--force` in the same change, and the clients that ship with the API (ERP, website) are
updated in the same release; the portal is checked against it.

- **Phase 7 (contract C6):** versions became mandatory on every versioned write (state-change POSTs and DELETEs answered
  last-writer-wins without one), and VERSION_REQUIRED moved from 400 to 428. Also tightened in the same release: `page` ≤ 1000 on
  offset lists, PLC value precision, the corrected `BucketCapDetailsSchema`, and one `details.issues` shape for VALIDATION_ERROR. The
  portal app is unaffected (portal routes do not require versions; `PATCH /portal/profile` still accepts a missing If-Match).
- **Phase 7 (contract C1, security track):** `TokenPair.refresh_token` became optional (left out in cookie mode), and the deprecated
  alias `POST /customers/:id/erase` answers the canonical `AdminCustomerEraseResponse`. The ERP and the portal web build use cookie
  mode; the native portal keeps body mode and still receives the token. Snapshot regenerated with `--force` by the platform track;
  the integration stage's own changes (portal ledger `summary`, profile `version`, `CHECK_FAILED`) are additive.

## Database changes follow the same rule

Migrations are additive within a release (new tables/columns/indexes; columns become NOT NULL only after a backfill release), so the
previous API version keeps working while it drains during a rolling deploy (docs/DEPLOY.md). Destructive steps (dropping a column)
ship one release after the code stopped using it.

## Release notes

`CHANGELOG.md` records every release: added/changed/deprecated/removed operations (the "Additive" and "Notices" sections of the
OpenAPI diff are the starting point), migrations, configuration changes and upgrade steps.
