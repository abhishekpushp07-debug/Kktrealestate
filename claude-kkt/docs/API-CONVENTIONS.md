# KKT v2 — API conventions (every module follows these)

Base path `/api/v1`. Three surfaces on the same server:

| Prefix                               | Audience  | Auth                                       |
| ------------------------------------ | --------- | ------------------------------------------ |
| `/api/v1/auth/*`, `/api/v1/<module>` | Staff ERP | Bearer access JWT with `aud: "erp"`        |
| `/api/v1/portal/*`                   | Customers | Bearer access JWT with `aud: "portal"`     |
| `/api/v1/public/*`                   | Website   | none; read-only; rate-limited; cached 60 s |

## Request/response shapes

- JSON only. Money = integer **paise** (`amount_paise`). Percent = number with ≤ 2 decimals. Dates `YYYY-MM-DD`; timestamps RFC 3339 UTC.
- Every schema comes from `@kkt/contracts` (Zod). Unknown body/query keys → 400 `VALIDATION_ERROR`.
- List endpoints: query `page` (1-based, ≤ 1000 — deeper offsets are 400 VALIDATION_ERROR naming cursor mode), `page_size` (≤ 200, default 25), or `cursor`+`limit` (keyset by `(sort_field, id)`; timestamp sorts page on a microsecond-exact key; nullable sort fields page through their NULL block too — PostgreSQL order, NULLs last on ascending and first on descending sorts), `search`, `sort` (`field` or `-field`, allow-listed), typed filters, `format=csv`, `include_inactive`, `exact` (tables above 10 000 rows answer `total` with the planner's estimate unless `exact=true`; CSV exports are always exact), `include_total` (keyset mode only, below).
  Envelope: `{ "items": [...], "total": n, "page": p, "page_size": s, "next_cursor": "..." | null, "meta": { "total_is_estimate": bool, "total_included": bool } }` (`meta`, contracts `ListMetaSchema`, is set by every list that pages through `lib/list.ts`; read a missing `meta` as an exact total). CSV responses stream `text/csv` with `Content-Disposition: attachment`.
  - **Totals.** Offset pages always count: exactly (`count(*)`) up to 10 000 table rows or with `exact=true`, otherwise the planner's estimate of the filtered query — then `meta.total_is_estimate = true`; show it as "about n". **Keyset pages (`cursor`/`limit`) run no `count(*)` and no `EXPLAIN`** unless `include_total=true` (or `exact=true`): `total` is then the number of rows in this page and `meta.total_included = false`; page on with `next_cursor` (null at the end). A keyset CSV page (the export job) never counts and omits `X-Export-Total`.
  - **Cursors** are opaque: `base64url(JSON [sortValue, id, sort])`. A cursor is bound to the sort it was issued for and is checked against the sort column's type before any query runs: a malformed, tampered or foreign-sort cursor — including values Postgres would refuse: impossible calendar dates or clock times, integers outside the column's range, enum values the column does not have, NUL characters — is **400 `INVALID_CURSOR`** (`details.issues[0].path = "cursor"`, code `invalid_cursor`) — start again without a cursor. (Before phase 7 a bad value could reach Postgres as a cast error.)
  - `page` above 1000 is 400 VALIDATION_ERROR whose message (and `details.issues[0].message`) tells the client to use cursor mode (`cursor` + `limit`, `next_cursor`).
- CSV size: `format=csv` answers at most 10 000 rows synchronously. Every CSV list carries `X-Export-Total` (rows matching the filters) and `X-Export-Rows` (rows in this file); when rows were cut it also carries `X-Export-Truncated: true` — the client then offers the asynchronous export below. (Routes that page through `lib/list.ts` `listPaging(q, req.query)` — pass the request's own query object as the second argument when `q` is a derived copy, or the headers and keyset export pages cannot find the request. The paginated reports — `/reports/cheques` and `/reports/activity` (audit rows, logins, failed logins) — do this through `reports/common.ts` `reportPaging`, so their CSV exports carry the same headers and can be exported asynchronously past the cap. The four `X-Export-*` headers and `Content-Disposition` are in CORS `exposedHeaders`.)
- Asynchronous exports (no row cap, worker job `EXPORT_CSV`): `POST /exports {path, query}` → `202` export row (`status` QUEUED → RUNNING → DONE | FAILED). `path` is any staff GET list route under `/api/v1` the caller holds the permission for (checked against the route registry, then a preflight request with the caller's own token validates `query` and project scope: a bad filter is the route's own 400, a foreign project its 404); `query` must not set `page`, `page_size`, `cursor`, `limit`, `format` or `exact`. The job runs the route in-process as the caller (internal 5-minute access token, aud `erp`) and keyset-pages it 5 000 rows at a time (`X-Export-Cursor` request header → `X-Export-Next-Cursor`; the header is honoured only for the job's in-process calls — a network request carrying it is an ordinary capped CSV export, audited and export-budgeted), so the file holds ALL rows with the route's own CSV columns. `GET /exports` (mine, newest first, `status` filter), `GET /exports/:id`, `POST /exports/:id/link` → `{download_url, expires_at, file_name, row_count}` (signed, 15 min; 409 `EXPORT_NOT_READY` before DONE), `GET /exports/download/:token` streams it. The owner gets an `EXPORT_READY` bell; files are kept 7 days (job `EXPORT_CLEANUP`). A DPDP erasure withdraws every list export made before it (FAILED with the reason), QUEUED and RUNNING ones included: the job never publishes a withdrawn export (its file is queued in `storage_deletions`). Exports are private to the user who asked (others get 404). A user may have at most 3 exports QUEUED/RUNNING at once (a fourth is 429 RATE_LIMITED, `Retry-After: 60`). `path` is a literal path: dot segments (`.`/`..`) and `:param` syntax are 400. A route that cannot keyset-page its CSV (no `listPaging()`) and returns a full 10 000-row page fails the export (FAILED, "cannot page") rather than storing a silently truncated file.
- Single resources return the row with `version`. Mutations return the updated row.
- Errors: `{ "error": { "code": "UPPER_SNAKE", "message": "human text", "details": {...}, "request_id": "..." } }`.
  Every code the API raises is registered in `packages/contracts/src/errors.ts` (`ERROR_CODES` + `ERROR_STATUS`; `apps/api/test/unit/error-registry.test.ts` scans the API source and fails on an unregistered code or a status mismatch). On the wire `ApiErrorSchema` accepts any UPPER_SNAKE code, so a client never fails to parse an error from a newer server: it shows `message` and branches only on codes it knows (`isKnownErrorCode`). One spelling per meaning: `UNSUPPORTED_MEDIA_TYPE` (415) and `CASH_INSUFFICIENT` (409).
  Status map: 400 VALIDATION_ERROR / IDEMPOTENCY_KEY_REQUIRED / COMPANY_REQUIRED; 401 UNAUTHENTICATED / TOKEN_EXPIRED / INVALID_AUDIENCE; 403 FORBIDDEN (permission); 404 NOT_FOUND (also for out-of-scope); 409 VERSION_CONFLICT (`details.current_version` = `details.current`, `details.changed_by`), FLAT_NOT_AVAILABLE, BUCKET_CAP_EXCEEDED (`details` = `BucketCapDetailsSchema`: `bucket`, `agreed_paise`, `paid_paise`, `amount_paise`, `headroom_paise`), IN_USE (`details.usage_count`; from a database foreign key also `constraint`, `referenced_by`), DUPLICATE (`details.constraint`), SLOT_FULL, PLAN_STAGES_MISSING (`details.missing_stages`), UNDO_BLOCKED, FLAT_HAS_BOOKING_HISTORY (regenerate / structural block edit that would delete flats a booking — even a cancelled one — references; `details.flats[] = {id, flat_number, floor, position, bookings}`, `FlatHasBookingHistoryDetailsSchema`); 413 PAYLOAD_TOO_LARGE; 422 BUSINESS_RULE (`details.rule`), CONSTRAINT_VIOLATION (`ConstraintViolationDetailsSchema`: `kind` check | foreign_key | not_null, `constraint`, `table`), INVALID_AMOUNT (a domain money error, `details.issues`; from pricing also `details.rate_card_id` with `issues[0].path = "plc_rules"` — e.g. a stored PERCENT PLC with 3+ decimals), IMPORT_UNKNOWN_COLUMNS (master CSV header names unknown/misnamed columns: `details.unknown_columns`, `suggestions`, `expected_columns`, `required_columns`, `ImportUnknownColumnsDetailsSchema`); 423 LOCKED; 428 VERSION_REQUIRED; 429 RATE_LIMITED (+ `Retry-After`).
  **One validation shape.** Every 400 VALIDATION_ERROR — schema failures, handler checks (`ApiError.invalid(field, message, code?)`), class-22 database data exceptions (`code: "sqlstate_22P02"` …, plus `details.sqlstate`) — carries `details.issues: [{path, message, code}]` (`path` is the dotted field path, "" when it is not one field); the old `{field}` details are gone (`apps/api/test/unit/error-registry.test.ts` fails on one).
  **Business rules are registered.** `details.rule` of a 422 BUSINESS_RULE is one of `BUSINESS_RULES` (`@kkt/contracts` rules.ts, type `RuleId`); `ApiError.rule()` only accepts a registered id and the registry test scans the source as well. Clients branch on known ids and show the message for others.
  Database failures that are not bugs are retryable envelopes with `details.retryable: true` (`lib/errors.ts`): statement timeout (57014) and connection/pool trouble (class 08, 53300, 57P01–03, connect timeout, refused/reset sockets) → 503 SERVICE_UNAVAILABLE + `Retry-After: 5`; lock timeout (55P03) → 409 LOCK_TIMEOUT + `Retry-After: 1`; a serialization failure or deadlock (40001/40P01) that escaped `withTransactionRetry` → 409 CONFLICT_RETRY (`details.sqlstate`). Clients retry these after `Retry-After`; anything else unexpected stays 500 INTERNAL_ERROR without details.

## Headers

- `Idempotency-Key` accepted on every POST that creates; **required** on `POST /payments`. Same key + same body → identical stored response with `Idempotent-Replayed: true`; same key + different body → 422 IDEMPOTENCY_MISMATCH. Keys are scoped per subject (user/customer) or IP, kept 24 h. Payments additionally store the key on the `payments` row (unique per company): if the plugin's replay record was lost (crash or Redis/DB hiccup between COMMIT and storing the response), a retry with the same key still returns the original payment (same receipt, `201` + `Idempotent-Replayed: true`) and creates nothing; a different posting under that key is 422 IDEMPOTENCY_MISMATCH.
  Durability: the plugin claims the key in Postgres before the handler runs (`idempotency_keys` row with `status_code` NULL = IN_PROGRESS, insert … on conflict), so concurrent duplicates on ANY instance wait (up to 10 s, then 409 IDEMPOTENCY_IN_PROGRESS) and replay the winner's response — with or without Redis, which is only a cache. Expired keys are deleted hourly in batches of 5 000 (job IDEMPOTENCY_PURGE).
  **A committed write is never executed twice** (phase 7, `plugins/idempotency.ts`):
  - _Commit marker._ While a request holds a claim, every transaction its handler opens through `app.db.transaction` (directly, `withTransactionRetry` or `moneyTransaction`) sets the claim's `committed_at` as its last statement — the request's AsyncLocalStorage store (`plugins/requestContext.ts`) tells the transaction which claim is running, so the mark commits or rolls back together with the handler's own writes. A write statement outside any transaction (autocommit) flags the claim in memory and sets `committed_at` in the database as well (so a retry after the instance died never takes the claim over and writes again). A `READ ONLY` transaction is never marked (it cannot write). Bookkeeping writes that are undone when the request fails — the `storage_pending_objects` record of an upload — run under `withoutCommitTracking` and never pin the key: a failed upload can be retried with the same Idempotency-Key.
  - _Error after commit._ A 2xx response is stored as before. A non-2xx response releases the claim **only when nothing committed** (the DELETE itself checks `committed_at IS NULL`). After a commit a 4xx is stored and replayed like a success; a 5xx (e.g. a response-serialisation failure after COMMIT, or a crash in a post-commit side effect) is stored as "outcome unknown": a retry with the same key answers **409 `IDEMPOTENT_OUTCOME_UNKNOWN`** with `details {original_status, original_request_id, path, retry_with_new_key: false, action: "LOOKUP_RESOURCE"}` — look the resource up (list/GET), do not retry with a new key. A stored success is always replayed.
  - _Lease instead of a fixed takeover._ A claim carries `lease_expires_at` (IDEMPOTENCY_LEASE_SECONDS, default 30 s) that a heartbeat renews every third of the lease while the request runs, so a slow request is never taken over. A claim whose lease lapsed (its instance died) is taken over by a retry with the same body **only if it never committed**; a committed claim without a stored response answers 409 `IDEMPOTENT_OUTCOME_UNKNOWN`. (Rows written before leases existed keep the old 60 s age rule.)
    One-time secrets are never stored: an idempotent route whose response can carry a one-time secret declares those top-level fields (`oneTimeSecrets` in `lib/routes.ts`; today `POST /users` → `temp_password`, `POST /site-visits` → `manage_url`, `POST /public/site-visits` → `manage_url`, `ics_url`, `POST /public/site-visits/:token/reschedule` → `manage_url`, `manage_token`, `ics_url`). The stored replay record (Postgres row and Redis copy) has those fields replaced by `"[redacted]"`, and a replay of the key answers **409 `IDEMPOTENT_SECRET_REPLAY`** (header `Idempotent-Replayed: true`) with `details: { original_status, redacted_fields, original }` — `original` is the first response with the secrets redacted (e.g. the created user's `id`), so the client can show the result and tell the user to issue a new secret (reset the password; for a visit, the confirmation without its manage link). A response that carried no secret (e.g. `POST /users` with an explicit `password`) replays normally. Routes that hand out portal passwords (`POST /customers/:id/portal[/enable|/reset-password]`, `POST /customers/portal/bulk-enable`) and `POST /users/:id/reset-password` are not idempotent at all, so an `Idempotency-Key` there stores nothing; a route-registry test fails when an idempotent route's response has a secret-looking field that is not declared.
- Versions (optimistic concurrency, audit F4, contract C6):
  - Versioned resources return a numeric `version`. A response whose JSON body has a top-level numeric `version` (single-resource GETs,
    creates, updates, state changes) carries the strong **`ETag: "v<version>"`** (`apps/api/src/plugins/etag.ts`); clients send it back as
    **`If-Match: "v<version>"`** on their next write. Also accepted: `W/"v<n>"`, the legacy `"<n>"` / `W/"<n>"` / bare `<n>`, `version` in
    the body, or **`expected_version`** in the body (lifted out of the body before validation, so every write accepts it).
  - Every staff **PATCH**, every **DELETE of a versioned resource** and every **state-change POST** (deactivate/restore, enable/disable,
    cancel/complete/no-show/outcome, clear/bounce/reverse, status/assign/messages on tickets, …) REQUIRES the version the client read.
    Without one the answer is **428 `VERSION_REQUIRED`** (`details.issues[0].path = "version"`); PATCH and DELETE are checked after
    authentication/permission and before the handler, POST actions in the handler. Stale → **409 `VERSION_CONFLICT`**
    (`details.current_version`, `details.current`, `details.changed_by`, `details.changed_at`). `If-Match: *` or a body-hash tag is not a
    version (428). The full list of routes is in docs/hardening/phase7-foundation.md.
  - Exempt: the session routes (`DELETE /auth/sessions[/:id]`, `DELETE /portal/auth/sessions[/:id]`; a session has no version) and portal
    self-service `PATCH /portal/profile` (honours If-Match but does not require it, for app builds that predate it).
  - Child rows versioned by migration 0005 (demands, other-charge lines …) bump their version on every change, engine updates included;
    `POST /bookings/:id/other-charges/:lineId/demand` checks the line's version when `line_version` is sent (the booking's `version` stays
    required).
- Responses always carry `X-Request-Id`. A version-tagged response never answers 304 (the tag promises the stored record, not every
  derived field of the body). Lists and other bodies carry a body-hash `ETag` and honour `If-None-Match` (304) on GET/HEAD only; a write always
  returns its body.
- Caching (contract C5, `plugins/requestContext.ts`): every response is `Cache-Control: no-store` unless its route opts in with
  `route({ cachePolicy: { public: true, sMaxAge, staleWhileRevalidate } })` (Fastify route config `cachePolicy`). An anonymous 200 of
  such a route carries `Cache-Control: public, s-maxage=<sMaxAge>, stale-while-revalidate=<staleWhileRevalidate>`, `Vary: x-kkt-company`,
  a strong ETag over the body (sha256, base64url) and answers a matching `If-None-Match` (lists, `*` and `W/` forms honoured) with 304
  and an empty body. A request with credentials (bearer token, an authenticated principal or a `kkt_*` session cookie) is always
  `no-store`, also on a cache-policy route, and an authenticated response never keeps a `public` Cache-Control a handler set.
- CORS (contract C1/C4): only the configured ERP, website and portal origins (`ERP_ORIGIN`, `WEB_ORIGIN`, `PORTAL_ORIGIN`, never `*`)
  get CORS grants, **with credentials** (the `kkt_rt` / `kkt_prt` cookies); allowed request headers: `Authorization`, `Content-Type`,
  `Idempotency-Key`, `If-Match`, `If-None-Match`, `X-Request-Id`, `X-KKT-Session`, `X-KKT-Company`.
- Idempotent responses and DPDP erasure: an erasure withdraws every stored idempotent response that names the erased customer (the key
  stays claimed, the body is replaced by `{__kkt_erased: true, original_status}`, the Redis copy is deleted); a retry with that key answers
  **410 `GONE`** with `details.original_status` — never the erased data and never a second execution.
- Tenant (contract C4, `apps/api/src/lib/tenant.ts` `resolveCompanyId`): the authenticated principal's company; else header
  `x-kkt-company: <company slug>` (a slug that names no company is 400 COMPANY_REQUIRED, never a fallback); else the request Host matched
  against `companies.hosts`; else the only company when exactly one exists; otherwise 400 `COMPANY_REQUIRED`. Answers (misses included)
  are cached per process for 30 s in a cache bounded to 1,000 entries (oldest evicted), since slugs and hosts arrive from
  unauthenticated headers.

## Permissions

- Every staff route declares `config: { permission: "code" }` (or `"a|b"` when any of several permissions suffices, e.g. `PATCH /projects/:id/website` = `project.write|cms.write`); the registry test fails if any staff route has none. Portal routes declare `config: { audience: "portal" }`; public routes `config: { public: true }`.
- Project scope: queries use `scopeFilter(user)`; direct lookups use `ensureProjectAccess(user, projectId)` → 404.
- KYC reveal: `GET /customers/:id?reveal=true` requires `customer.kyc_view` and writes `customer.kyc_reveal` audit row.

## Transactions & locks

- One service function = one `db.transaction`. Hot rows use `SELECT … FOR UPDATE`; per-booking money operations take `pg_advisory_xact_lock(hashtext(booking_id))` so ledger `seq` and running balances are serialised.
- **Lock order for money** (deadlock-free by construction, `modules/money/common.ts`): payment row → flat row → block row → booking rows in ascending id → parking / charge / demand rows → document-number sequence rows **last** (booking, demand and receipt numbers are allocated only after every row lock is held). Money and construction units of work run through `moneyTransaction()` (= `withTransactionRetry` from `@kkt/db`), which re-runs the whole transaction on 40001 / 40P01, so a lost lock race is never a 500.
- **Parent rows are locked FOR NO KEY UPDATE, never FOR UPDATE** when a unit of work only needs to serialise writers of that row (project rows: rate-card activation, parking, block creation, project PATCH — `inventory/service.ts loadProject`, `rateCards.ts` activate). Every child INSERT (bookings, payments, demands, leads, parking slots… of the project) takes FOR KEY SHARE on the parent through its foreign key; FOR UPDATE would block it and, against a booking that already holds its flat / parking rows, deadlock (40P01). FOR NO KEY UPDATE still conflicts with every other explicit lock on the row.
  Inventory follows the same order wherever flats and their block are both locked: booking creation, `POST /flats/:id/reserve|release`, the HOLD_EXPIRY job and the flat status change take flat → block; `POST /blocks/:id/bulk-status` and `/bulk-price` lock the selected flat rows (ascending id) **before** the block row and, like `PATCH /blocks/:id` and `/generate-flats` (block → flats regeneration), run in `withTransactionRetry`. Integrity repair locks the booking before it re-reads and voids demands (a demand paid after the report is skipped, never voided).
- Side effects (notifications, audit) are written inside the same transaction; emails/webhooks (none in scope) would be outboxed.

## Audit

`audit(tx, { actor, action: "entity.verb", entityType, entityId, before, after, ip, requestId })` for every create/update/deactivate/status change, including portal actions (`actorType: CUSTOMER`) and jobs (`SYSTEM`). Sensitive fields are stripped before storing.

## Numbering

`nextNumber(tx, companyId, scope, date)` → `PREFIX + FY + '/' + 4-digit seq` where FY is `2526` for Apr 2025–Mar 2026 (format configurable per scope: `{prefix}{fy}/{seq:4}` default; receipts default `SGB/2526/0001`).

## OpenAPI

Generated from Zod at `/api/v1/openapi.json`, UI at `/api/v1/docs`. Every route has `schema.response` for 200/201 so serialisation is compiled and documented.
The committed snapshot `docs/openapi/v1.json` (and `/api/v1/openapi.json`) is enriched by `modules/system/openapiEnrich.ts`:

- **operationId** on every operation: `schema.operationId` when a route sets one, else derived from method + path —
  `GET /api/v1/bookings/{id}/ledger` → `getBookingsByIdLedger`, `POST /api/v1/payments/{id}/clear` → `postPaymentsByIdClear`; routes
  outside `/api/v1` get `Root` (`GET /health` → `getRootHealth`). Unique (a test enforces it); renaming a path renames its operationId.
- **Components:** `ApiError` (the error envelope), `ValidationIssue`, `ListMeta`, `Version`, `MoneyPaise` / `SignedMoneyPaise` /
  `PositiveMoneyPaise` (every `*_paise` property with exactly that range references them); parameters `IdempotencyKey`,
  `IdempotencyKeyRequired`, `IfMatch`, `IfNoneMatch`; headers `ETag`, `RetryAfter`, `IdempotentReplayed`; one response per error status.
- **Error responses** on every operation, each referencing `ApiError`: 400 (input), 401 (non-public), 403 (staff permission), 404 (path
  parameters), 409 + 422 (writes), 413 + 415 (multipart uploads, client errors), 428 (writes that require a version), 429 + 503 (all but
  the probes), 500 (all); 304 on GETs. 412 is not used by this API (stale versions are 409 VERSION_CONFLICT, contract C6).
- **Headers:** `Idempotency-Key` on idempotent POSTs (required on `POST /payments`), `If-Match` on versioned writes, `If-None-Match` on
  GETs; `ETag` documented on 2xx bodies with a `version`, `Idempotent-Replayed` on idempotent POSTs.
- **Media types:** PDFs (`application/pdf`, binary), signed files and public media (`image/*`, `application/pdf`), backups
  (`application/zip`), export downloads and every list's `format=csv` / `export=CSV` alternate (`text/csv`), sitemap
  (`application/xml`), robots / metrics (`text/plain`), visit invitations (`text/calendar`).

`pnpm --filter @kkt/api openapi:check` (CI) compares the generated document with the snapshot: operationIds, components, error responses,
response headers and non-JSON media types are documentation and never breaking; `Idempotency-Key` / `If-Match` / `If-None-Match`
appearing on an operation are notices (the API enforced them before the document showed them). Regenerate with
`pnpm --filter @kkt/api openapi` (`--force` only for an approved break, recorded in docs/VERSIONING.md).

## Uploads and renditions

Every upload (`POST /documents`, `POST /cms/media`, `POST /portal/requests/:id/attachments`) runs `documents/service.ts uploadDocument`:
validation and image dimensions (header only) → the storage key recorded in `storage_pending_objects` (autocommit) → the original
written to storage → ONE short transaction (the route's checks, the `documents` row, the pending record cleared, audit) → after COMMIT
the `DOCUMENT_RENDITIONS` job is enqueued (heavy queue). No image processing and no storage I/O happen inside a database transaction,
and the request never waits for renditions. A document row carries `renditions`: `PENDING` (images, until the job ran), `READY`,
`FAILED` (undecodable image; the original stays served) or `NONE` (PDFs). Until renditions exist `thumb_url` / `medium_url` point at the
ORIGINAL (a different URL, so no cache keeps the original under a rendition's address), `POST /documents/:id/link?variant=thumb` links
the original, and a stream asked for a missing rendition serves the original with `Cache-Control: private, no-cache`. `has_variants`
turns true when the renditions exist. Failures after the storage write leave nothing behind: the request removes the object at once, and
`STORAGE_SWEEP` (every 10 minutes) removes any object whose row never committed after an hour and retries queued deletions
(`storage_deletions`) with exponential backoff (1 min · 2^attempts, capped at a day; never dropped). Keys written by retryable work are
never reused, so a deletion queued for one attempt's orphan can never remove a later attempt's object: rendition keys carry a nonce per
run (`<stem>_thumb_<nonce>.webp`, recorded only if the row has no renditions yet) and EXPORT_CSV part keys a nonce per build (kept in
the checkpoint). A running export refreshes its parts' pending records at every page, so a long or resumed build is never swept.

## Health and client errors

Probes (`/health`, `/health/live`, `/health/ready`, `/ready`, with or without `/api/v1`) are public and **never rate-limited** (nor shed):
a probe answered 429 would take a healthy instance out of rotation.

- `GET /health/live` (also `/api/v1/health/live`): liveness — 200 `{status: "ok", uptime_seconds}`, no dependency touched. Use it for
  Kubernetes/Compose liveness probes.
- `GET /health/ready` (also `/api/v1/health/ready`, and the older `/ready`, `/api/v1/ready`): readiness — 200 `{ready: true}` when
  Postgres and Redis answer and the process is not draining; 503 SERVICE_UNAVAILABLE (+ `Retry-After`) otherwise.
- `GET /health` (also `/api/v1/health`): the full report (contracts `SystemHealthResponseSchema`): `status` `ok` | `degraded` | `down`,
  `checks {database, redis, storage, worker, migrations}`, `db_ping_ms`, `redis_ping_ms` and `details` (latency and error per check;
  storage = a real put + head of `health/<host>-<pid>.txt`, cached 15 s; worker = age of the job worker's Redis heartbeat, stale after
  HEALTH_WORKER_STALE_SECONDS (90); migrations = drizzle migrations applied vs shipped). **503 `down`** when the database, Redis or
  storage fails; **200 `degraded`** when only the worker heartbeat is stale or missing; 200 `ok` otherwise. Nothing is hardcoded.
- `POST /api/v1/client-errors` (contract C2): front-end error reports, no authentication (a bearer token attributes the report);
  body `{app: "erp" | "portal" | "web", message (≤ 2 KB), stack? (≤ 8 KB), url?, release?, user_agent?, extra? (object)}` (strict),
  16 KB body limit (413), per-IP limit CLIENT_ERROR_RATE_LIMIT_PER_MIN (30/min, 429); answers **202 `{accepted: true}`**. The report is
  logged at `warn` ("client error reported", the URL without query string and fragment) and counted in `kkt_client_errors_total{app}`;
  nothing is stored.

## Appendix A — Auth endpoints (staff) and portal auth (fixed contract for all surfaces)

```
POST /api/v1/auth/login            {email, password, company?}  → 200 {access_token, refresh_token?, expires_in, user, must_change_password} | 200 {mfa_required: true, mfa_token}
POST /api/v1/auth/login/mfa        {mfa_token, code}            → same as login success
POST /api/v1/auth/refresh          {refresh_token?}             → {access_token, refresh_token?, expires_in}  (401 SESSION_EXPIRED past the absolute lifetime)
POST /api/v1/auth/logout           {all_devices?}               → 204 (revokes this session family; clears the cookie with X-KKT-Session: cookie)
GET  /api/v1/auth/me                                            → {user:{id,name,email,role:{id,name},permissions:[...],all_projects,project_ids,must_change_password,mfa_enabled}, company:{id,name,settings...}}
POST /api/v1/auth/change-password  {current_password, new_password}
GET  /api/v1/auth/sessions  · DELETE /api/v1/auth/sessions/:id · DELETE /api/v1/auth/sessions (all others)
POST /api/v1/auth/mfa/enroll → {secret, otpauth_url} · POST /api/v1/auth/mfa/verify {code} · POST /api/v1/auth/mfa/disable {code}
GET  /api/v1/auth/jwks                                          → {keys:[{kty:"OKP", crv:"Ed25519", x, kid, use:"sig", alg:"EdDSA"}]} (every JWT_SIGNING_KEYS key, current first)
Portal mirrors this under /api/v1/portal/auth/* with {phone, password, company?} and aud=portal.
```

Session transport (contract C1): send `X-KKT-Session: cookie` on login, refresh and logout from a browser — the refresh token is then set
as the HttpOnly, SameSite=Strict cookie `kkt_rt` (Path=/api/v1/auth) or `kkt_prt` (Path=/api/v1/portal/auth) and is absent from the JSON;
refresh sends no body (or `{}`), with the same header and `credentials: "include"`. A cookie without the header → 403 FORBIDDEN
`details.reason = SESSION_HEADER_REQUIRED`. Body mode (`refresh_token` in the body and the response) stays for native apps and API clients.
Every refresh-token family ends `REFRESH_ABSOLUTE_TTL_DAYS` (30) after sign-in → 401 `SESSION_EXPIRED` (sign in again).
Company (contract C4): `company` (slug) in the login body, or header `x-kkt-company`, names the tenant; without either the Host or the
single company decides; an e-mail/phone present in several companies without a company → 400 `COMPANY_REQUIRED`.

Failed sign-ins: 401 INVALID_CREDENTIALS without `details` (identical for unknown identifiers); 423 LOCKED with `details.locked_until` once 5 failures came from the client's IP (or 20 across IPs locked the account). The `mfa_token` is only accepted from the client IP that passed the password step.
Access token lives in memory in the SPA; the refresh token lives in the HttpOnly cookie (ERP and portal web, cookie mode) or SecureStore (native portal, body mode) — never in localStorage. Clients refresh single-flight on 401 TOKEN_EXPIRED.

## Appendix B — Public (website) API surface (fixed; implemented by the `public` module, consumed by apps/web)

```
GET  /api/v1/public/site                      site settings allow-list: brand, contacts, offices, social, trust_stats, value_props, disclaimer, seo_defaults, analytics, site_live, coming_soon_message, portal_url, featured project cards, walkthrough_video_url, banners (active now), home_sections, testimonials, latest_posts
GET  /api/v1/public/projects?city=&status=&bhk=&q=   published project cards: {slug, name, city, status, type, starting_price_paise|null, hero_image_url, bhk_options[], possession_date, rera_number}
GET  /api/v1/public/projects/:slug            published detail: overview, highlights, key facts, approvals, amenities, configurations (flat types with rooms/areas/specs; price only if show_prices), availability grid (AVAILABLE|NOT_AVAILABLE per cell) if show_availability, construction progress (stages + website photos) if show_progress, videos, tours, map, landmarks, faqs, seo, brochure_available, visit_booking_enabled
GET  /api/v1/public/projects/:slug/visit-availability?from=&to=   [{date, slots:[{start,end,available}]}]
GET  /api/v1/public/posts?page= · GET /api/v1/public/posts/:slug · GET /api/v1/public/pages/:slug · GET /api/v1/public/gallery?project= · GET /api/v1/public/people
GET  /api/v1/public/media/:id[?variant=thumb|medium]   immutable image bytes
GET  /api/v1/public/sitemap                   {entries:[{path, updated_at, priority}]}: every public URL — static pages, published projects, ALL published posts, every published CMS page at /<slug> — with updated_at = the newest change of what the page shows (never "now"); [] while the site is not live
GET  /api/v1/public/sitemap.xml · GET /api/v1/public/robots.txt
POST /api/v1/public/enquiries                 {name, phone, email?, project_slug?, flat_type_code?, message?, consent:true, website:"" (honeypot), utm?} → {reference_number}
POST /api/v1/public/brochure-requests         {project_slug, name, phone, email?, consent, website:"", visitor_token?} → {download_url, expires_at, visitor_token}
GET  /api/v1/public/brochure/:token           streams PDF attachment (15-min signed; counted once)
POST /api/v1/public/site-visits               {project_slug, date, start, name, phone, email?, visitors, message?, consent, website:""} → {visit_number, date, start, end, address, maps_link, instructions, ics_url, manage_url}
GET  /api/v1/public/site-visits/:token        manage view (+ can_reschedule, link_expires_at) · GET …/:token.ics · POST …/:token/cancel (the link expires)
POST /api/v1/public/site-visits/:token/reschedule {date, start, website:""} → manage view + {manage_url, manage_token} (NEW link; the old one stops working; 409 SLOT_FULL, 422 SLOT_INVALID)
     manage links expire at visit end + 24 h (IST), at cancellation, and on every reschedule: expired, cancelled or replaced by a
     reschedule (the visit keeps the SHA-256 of its last 20 replaced tokens) → 410 LINK_EXPIRED; a token that never existed → 404
```

Public GETs opt into contract C5 caching (`cachePolicy`, see "Headers"): catalog reads (`/projects`, `/projects/:slug`) `public, s-maxage=60, stale-while-revalidate=300`; visit availability `s-maxage=60, stale-while-revalidate=30`; CMS reads (`/site`, `/posts`, `/posts/:slug`, `/pages/:slug`, `/gallery`, `/people`, `/sitemap`, `sitemap.xml`, `robots.txt`) `s-maxage=300, stale-while-revalidate=3600`; plus a strong body ETag (304 on If-None-Match) and `Vary: x-kkt-company`. The API's Redis copy (60 s) is keyed by company and dropped on every CMS / website-settings / visit write, which also calls the website's on-demand revalidation (`WEB_REVALIDATE_URL` + `x-kkt-revalidate-token: WEB_REVALIDATE_TOKEN`, body `{tags:["kkt-public"]}`, best-effort, coalesced per 250 ms). 404 for unpublished; never return ids of users/customers, costs, storage keys or Hold/Booked/Blocked distinctions. Project cards carry `updated_at` (lastmod).

**Tenant** (contract C4): every public route serves the company `lib/tenant.ts` resolves — `x-kkt-company: <slug>` (the website sends `KKT_COMPANY_SLUG`), else the request Host in `companies.hosts`, else the only company; several companies and nothing naming one → 400 COMPANY_REQUIRED (never "the first company created").

**Visitor token** (brochure gate): opaque — `<kid>.<body>.<hmac>` where body = version + lead id + expiry (180 days), MAC'd with the link-signing ring (`LINK_SIGNING_KEYS`, label `kkt-visitor-v2`); no name, phone or e-mail inside. The server looks the visitor up from the lead (same company); every reply carries a fresh token; honeypot replies carry a token of the same shape that resolves to nobody. Pre-phase-7 readable tokens are still honoured until they expire. Brochure link signatures are checked against every `HASH_KEYS` key.

**.ics** (`GET …/:token.ics`): `METHOD:REQUEST` (a cancelled visit: `METHOD:CANCEL` + `STATUS:CANCELLED`, no reminder, no visitor details), stable `UID:<visit id>@kkt`, `SEQUENCE` = `site_visits.ics_sequence` (incremented by every reschedule and the cancellation), `DTSTAMP` = generation time, `ORGANIZER` = site brand + contact e-mail when configured, `ATTENDEE` = the visitor's e-mail when given. A cancelled visit's link keeps serving the CANCEL file until the original link expiry (slot end + 24 h); a link replaced by a reschedule stays 410.

## Appendix C — Portal API surface (fixed; `aud: portal`; implemented by the `portal` module, consumed by apps/portal). Response schemas are the `Portal*` schemas in `@kkt/contracts` (modules/portal.ts).

```
POST /api/v1/portal/auth/login            PortalLogin → PortalLoginResponse (TokenPair + user)          public, 10/min/IP
POST /api/v1/portal/auth/refresh          PortalRefresh → TokenPair
POST /api/v1/portal/auth/logout           {refresh_token?, all_devices?} → 204
GET  /api/v1/portal/auth/me               → PortalUser
POST /api/v1/portal/auth/change-password  PortalChangePassword → 204 (clears must_change_password)
GET  /api/v1/portal/auth/sessions · DELETE /api/v1/portal/auth/sessions/:id · DELETE /api/v1/portal/auth/sessions
GET  /api/v1/portal/bookings              → PortalBookingSwitcherItem[] (bookings where the customer is primary or co-applicant)
GET  /api/v1/portal/bookings/:id/home     → PortalHomeResponse
GET  /api/v1/portal/bookings/:id/flat     → PortalMyFlatResponse
GET  /api/v1/portal/bookings/:id/ledger   → PortalLedgerResponse (current epoch only; `summary` = the C7 totals — show dues from it)
GET  /api/v1/portal/bookings/:id/receipts → PortalReceiptListResponse      GET …/receipts/:paymentId/pdf → PortalPdfLinkResponse (signed 15-min URL) ; GET /api/v1/portal/files/:token streams the PDF/image
GET  /api/v1/portal/bookings/:id/demands  → PortalDemandListResponse       GET …/demands/:demandId/pdf → PortalPdfLinkResponse
GET  /api/v1/portal/bookings/:id/schedule → PortalScheduleResponse
GET  /api/v1/portal/bookings/:id/statement.pdf → PortalPdfLinkResponse     GET …/allotment-letter.pdf → PortalPdfLinkResponse
GET  /api/v1/portal/bookings/:id/construction → PortalConstructionTimelineResponse (own tower only; photos visible_to_buyers only)
GET  /api/v1/portal/bookings/:id/documents → PortalDocumentListResponse    GET …/documents/:docId/download → PortalPdfLinkResponse
GET  /api/v1/portal/bookings/:id/bank-details → PortalBankDetails (Account bucket transfers)
GET  /api/v1/portal/requests?status=     → PortalRequestListResponse       POST /api/v1/portal/requests (PortalRequestCreate, multipart attachments optional) → PortalRequestDetailResponse
GET  /api/v1/portal/requests/:id         → PortalRequestDetailResponse (internal staff notes never included)
POST /api/v1/portal/requests/:id/messages (PortalRequestMessageCreate) · POST …/reopen (PortalRequestReopen, within 7 days of RESOLVED) · POST …/rate (PortalRequestRate)
POST /api/v1/portal/requests/:id/attachments (multipart) → PortalDocumentRow
GET  /api/v1/portal/notices              → PortalNoticeListResponse (company-wide + the projects of the customer's bookings)
GET  /api/v1/portal/notifications        → PortalNotificationListResponse  GET …/unread-count → {count}  POST …/mark-read (PortalMarkRead)
GET  /api/v1/portal/profile              → PortalProfileResponse (+ `version`, ETag "v<n>")   PATCH /api/v1/portal/profile (PortalProfileUpdate; If-Match "v<n>" optional; audited as CUSTOMER)
```

Every `:id` is checked against the customer's bookings; anything else is 404. KYC values are masked. No internal ids of staff users or storage keys are returned.

Appendix C additions (required by apps/portal): `GET /api/v1/portal/requests/categories` → `[{id, name, default_priority}]`; `POST /api/v1/portal/requests` is JSON (`PortalRequestCreate`, `attachment_ids: []`) and photos are uploaded afterwards one per call to `POST /api/v1/portal/requests/:id/attachments` (multipart, field `file`, optional text field `message_id` = one of the customer's own messages on that request — the opening message from the create response — to append the file to it) which returns `PortalDocumentRow` with `document_id`; replies carry the returned ids in `attachment_ids`. Thread attachments carry `thumb_url` (≈480 px) and `url` (signed full-size link). `GET /portal/notifications/unread-count` → `{count}`. Notification rows carry `booking_id`: the booking itself for booking bells, the booking of the demand / other-charge line / payment for those bells (so the app switches the selected booking before opening `screen`), null for company-wide bells. `GET /portal/bookings` and `GET /portal/auth/sessions` return bare arrays. 423 LOCKED carries `details.locked_until`; 429 carries `Retry-After`.
