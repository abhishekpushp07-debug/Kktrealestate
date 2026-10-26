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
- List endpoints: query `page` (1-based), `page_size` (≤ 200, default 25), or `cursor`+`limit` (keyset by `(sort_field, id)`; timestamp sorts page on a microsecond-exact key; nullable sort fields page through their NULL block too — PostgreSQL order, NULLs last on ascending and first on descending sorts), `search`, `sort` (`field` or `-field`, allow-listed), typed filters, `format=csv`, `include_inactive`, `exact` (tables above 10 000 rows answer `total` with the planner's estimate unless `exact=true`; CSV exports are always exact).
  Envelope: `{ "items": [...], "total": n, "page": p, "page_size": s, "next_cursor": "..." | null }`. CSV responses stream `text/csv` with `Content-Disposition: attachment`.
- CSV size: `format=csv` answers at most 10 000 rows synchronously. Every CSV list carries `X-Export-Total` (rows matching the filters) and `X-Export-Rows` (rows in this file); when rows were cut it also carries `X-Export-Truncated: true` — the client then offers the asynchronous export below. (Routes that page through `lib/list.ts` `listPaging(q, req.query)` — pass the request's own query object as the second argument when `q` is a derived copy, or the headers and keyset export pages cannot find the request. The paginated reports — `/reports/cheques` and `/reports/activity` (audit rows, logins, failed logins) — do this through `reports/common.ts` `reportPaging`, so their CSV exports carry the same headers and can be exported asynchronously past the cap. The four `X-Export-*` headers and `Content-Disposition` are in CORS `exposedHeaders`.)
- Asynchronous exports (no row cap, worker job `EXPORT_CSV`): `POST /exports {path, query}` → `202` export row (`status` QUEUED → RUNNING → DONE | FAILED). `path` is any staff GET list route under `/api/v1` the caller holds the permission for (checked against the route registry, then a preflight request with the caller's own token validates `query` and project scope: a bad filter is the route's own 400, a foreign project its 404); `query` must not set `page`, `page_size`, `cursor`, `limit`, `format` or `exact`. The job runs the route in-process as the caller (internal 5-minute access token, aud `erp`) and keyset-pages it 5 000 rows at a time (`X-Export-Cursor` request header → `X-Export-Next-Cursor`), so the file holds ALL rows with the route's own CSV columns. `GET /exports` (mine, newest first, `status` filter), `GET /exports/:id`, `POST /exports/:id/link` → `{download_url, expires_at, file_name, row_count}` (signed, 15 min; 409 `EXPORT_NOT_READY` before DONE), `GET /exports/download/:token` streams it. The owner gets an `EXPORT_READY` bell; files are kept 7 days (job `EXPORT_CLEANUP`). Exports are private to the user who asked (others get 404). A user may have at most 3 exports QUEUED/RUNNING at once (a fourth is 429 RATE_LIMITED, `Retry-After: 60`). `path` is a literal path: dot segments (`.`/`..`) and `:param` syntax are 400. A route that cannot keyset-page its CSV (no `listPaging()`) and returns a full 10 000-row page fails the export (FAILED, "cannot page") rather than storing a silently truncated file.
- Single resources return the row with `version`. Mutations return the updated row.
- Errors: `{ "error": { "code": "UPPER_SNAKE", "message": "human text", "details": {...}, "request_id": "..." } }`.
  Every code the API raises is registered in `packages/contracts/src/errors.ts` (`ERROR_CODES` + `ERROR_STATUS`; `apps/api/test/unit/error-registry.test.ts` scans the API source and fails on an unregistered code or a status mismatch). On the wire `ApiErrorSchema` accepts any UPPER_SNAKE code, so a client never fails to parse an error from a newer server: it shows `message` and branches only on codes it knows (`isKnownErrorCode`). One spelling per meaning: `UNSUPPORTED_MEDIA_TYPE` (415) and `CASH_INSUFFICIENT` (409).
  Status map: 400 VALIDATION_ERROR / IDEMPOTENCY_KEY_REQUIRED / VERSION_REQUIRED; 401 UNAUTHENTICATED / TOKEN_EXPIRED / INVALID_AUDIENCE; 403 FORBIDDEN (permission); 404 NOT_FOUND (also for out-of-scope); 409 VERSION_CONFLICT (`details.current`, `details.changed_by`), FLAT_NOT_AVAILABLE, BUCKET_CAP_EXCEEDED, IN_USE (`details.usage_count`), SLOT_FULL, PLAN_STAGES_MISSING (`details.missing_stages`), UNDO_BLOCKED; 413 PAYLOAD_TOO_LARGE; 422 BUSINESS_RULE (`details.rule`); 423 LOCKED; 429 RATE_LIMITED (+ `Retry-After`).
  Database failures that are not bugs are retryable envelopes with `details.retryable: true` (`lib/errors.ts`): statement timeout (57014) and connection/pool trouble (class 08, 53300, 57P01–03, connect timeout, refused/reset sockets) → 503 SERVICE_UNAVAILABLE + `Retry-After: 5`; lock timeout (55P03) → 409 LOCK_TIMEOUT + `Retry-After: 1`; a serialization failure or deadlock (40001/40P01) that escaped `withTransactionRetry` → 409 CONFLICT_RETRY (`details.sqlstate`). Clients retry these after `Retry-After`; anything else unexpected stays 500 INTERNAL_ERROR without details.

## Headers

- `Idempotency-Key` accepted on every POST that creates; **required** on `POST /payments`. Same key + same body → identical stored response with `Idempotent-Replayed: true`; same key + different body → 422 IDEMPOTENCY_MISMATCH. Keys are scoped per subject (user/customer) or IP, kept 24 h. Payments additionally store the key on the `payments` row (unique per company): if the plugin's replay record was lost (crash or Redis/DB hiccup between COMMIT and storing the response), a retry with the same key still returns the original payment (same receipt, `201` + `Idempotent-Replayed: true`) and creates nothing; a different posting under that key is 422 IDEMPOTENCY_MISMATCH.
  Durability: the plugin claims the key in Postgres before the handler runs (`idempotency_keys` row with `status_code` NULL = IN_PROGRESS, insert … on conflict), so concurrent duplicates on ANY instance wait (up to 10 s, then 409 IDEMPOTENCY_IN_PROGRESS) and replay the winner's response — with or without Redis, which is only a cache. The 2xx response is stored in the same row; a non-2xx response releases the claim so the client may retry with the same key. A claim still IN_PROGRESS after 60 s is treated as abandoned (the instance died between COMMIT and storing): a retry with the same body takes it over and runs again, and resource-level uniqueness (e.g. the payments key above) returns the original resource instead of creating a duplicate. Expired keys are deleted hourly in batches of 5 000 (job IDEMPOTENCY_PURGE).
  One-time secrets are never stored: an idempotent route whose response can carry a one-time secret declares those top-level fields (`oneTimeSecrets` in `lib/routes.ts`; today `POST /users` → `temp_password`, `POST /site-visits` → `manage_url`, `POST /public/site-visits` → `manage_url`, `ics_url`, `POST /public/site-visits/:token/reschedule` → `manage_url`, `manage_token`, `ics_url`). The stored replay record (Postgres row and Redis copy) has those fields replaced by `"[redacted]"`, and a replay of the key answers **409 `IDEMPOTENT_SECRET_REPLAY`** (header `Idempotent-Replayed: true`) with `details: { original_status, redacted_fields, original }` — `original` is the first response with the secrets redacted (e.g. the created user's `id`), so the client can show the result and tell the user to issue a new secret (reset the password; for a visit, the confirmation without its manage link). A response that carried no secret (e.g. `POST /users` with an explicit `password`) replays normally. Routes that hand out portal passwords (`POST /customers/:id/portal[/enable|/reset-password]`, `POST /customers/portal/bulk-enable`) and `POST /users/:id/reset-password` are not idempotent at all, so an `Idempotency-Key` there stores nothing; a route-registry test fails when an idempotent route's response has a secret-looking field that is not declared.
- Versions (optimistic concurrency, audit F4):
  - **PATCH** routes of the staff API REQUIRE the version the client read: `version` in the body or `If-Match: "<n>"` (also `W/"<n>"`). Without either the request is **400 `VERSION_REQUIRED`** (the "428 Precondition Required" case, carried as 400 with `details.issues[0].path = "version"` so clients treat it like a validation error), checked after authentication/permission and before the handler, so no PATCH can fall back to last-writer-wins. Stale → 409 VERSION_CONFLICT (`details.current`, `details.changed_by`).
  - No staff PATCH is exempt (the last transitional exemptions, `PATCH /construction/photos/:photoId` and `PATCH /payment-plan-assignments/:id`, were removed once the ERP sent `If-Match` there; stage-photo rows always return `version`). Portal self-service `PATCH /portal/profile` honours If-Match but does not require it.
  - State-change **POST** actions (deactivate/restore, clear/bounce/reverse, confirm/cancel, …) keep accepting an optional `version`/If-Match (checked when present); the ERP always sends one.
- Responses always carry `X-Request-Id`; lists carry `ETag` and honour `If-None-Match` (304).

## Permissions

- Every staff route declares `config: { permission: "code" }` (or `"a|b"` when any of several permissions suffices, e.g. `PATCH /projects/:id/website` = `project.write|cms.write`); the registry test fails if any staff route has none. Portal routes declare `config: { audience: "portal" }`; public routes `config: { public: true }`.
- Project scope: queries use `scopeFilter(user)`; direct lookups use `ensureProjectAccess(user, projectId)` → 404.
- KYC reveal: `GET /customers/:id?reveal=true` requires `customer.kyc_view` and writes `customer.kyc_reveal` audit row.

## Transactions & locks

- One service function = one `db.transaction`. Hot rows use `SELECT … FOR UPDATE`; per-booking money operations take `pg_advisory_xact_lock(hashtext(booking_id))` so ledger `seq` and running balances are serialised.
- **Lock order for money** (deadlock-free by construction, `modules/money/common.ts`): payment row → flat row → block row → booking rows in ascending id → parking / charge / demand rows → document-number sequence rows **last** (booking, demand and receipt numbers are allocated only after every row lock is held). Money and construction units of work run through `moneyTransaction()` (= `withTransactionRetry` from `@kkt/db`), which re-runs the whole transaction on 40001 / 40P01, so a lost lock race is never a 500.
  Inventory follows the same order wherever flats and their block are both locked: booking creation, `POST /flats/:id/reserve|release`, the HOLD_EXPIRY job and the flat status change take flat → block; `POST /blocks/:id/bulk-status` and `/bulk-price` lock the selected flat rows (ascending id) **before** the block row and, like `PATCH /blocks/:id` and `/generate-flats` (block → flats regeneration), run in `withTransactionRetry`. Integrity repair locks the booking before it re-reads and voids demands (a demand paid after the report is skipped, never voided).
- Side effects (notifications, audit) are written inside the same transaction; emails/webhooks (none in scope) would be outboxed.

## Audit

`audit(tx, { actor, action: "entity.verb", entityType, entityId, before, after, ip, requestId })` for every create/update/deactivate/status change, including portal actions (`actorType: CUSTOMER`) and jobs (`SYSTEM`). Sensitive fields are stripped before storing.

## Numbering

`nextNumber(tx, companyId, scope, date)` → `PREFIX + FY + '/' + 4-digit seq` where FY is `2526` for Apr 2025–Mar 2026 (format configurable per scope: `{prefix}{fy}/{seq:4}` default; receipts default `SGB/2526/0001`).

## OpenAPI

Generated from Zod at `/api/v1/openapi.json`, UI at `/api/v1/docs`. Every route has `schema.response` for 200/201 so serialisation is compiled and documented.

## Appendix A — Auth endpoints (staff) and portal auth (fixed contract for all surfaces)

```
POST /api/v1/auth/login            {email, password}            → 200 {access_token, refresh_token, expires_in, user, must_change_password} | 200 {mfa_required: true, mfa_token}
POST /api/v1/auth/login/mfa        {mfa_token, code}            → same as login success
POST /api/v1/auth/refresh          {refresh_token}              → {access_token, refresh_token, expires_in}
POST /api/v1/auth/logout           {refresh_token?}             → 204 (revokes this session family)
GET  /api/v1/auth/me                                            → {user:{id,name,email,role:{id,name},permissions:[...],all_projects,project_ids,must_change_password,mfa_enabled}, company:{id,name,settings...}}
POST /api/v1/auth/change-password  {current_password, new_password}
GET  /api/v1/auth/sessions  · DELETE /api/v1/auth/sessions/:id · DELETE /api/v1/auth/sessions (all others)
POST /api/v1/auth/mfa/enroll → {secret, otpauth_url} · POST /api/v1/auth/mfa/verify {code} · POST /api/v1/auth/mfa/disable {code}
GET  /api/v1/auth/jwks                                          → {keys:[{kty:"OKP", crv:"Ed25519", x, kid, use:"sig", alg:"EdDSA"}]} (current key first, then JWT_PREVIOUS_SECRETS)
Portal mirrors this under /api/v1/portal/auth/* with {phone, password} and aud=portal.
```

Failed sign-ins: 401 INVALID_CREDENTIALS without `details` (identical for unknown identifiers); 423 LOCKED with `details.locked_until` once 5 failures came from the client's IP (or 20 across IPs locked the account). The `mfa_token` is only accepted from the client IP that passed the password step.
Access token lives in memory in the SPA; refresh token in localStorage (ERP/web) or SecureStore (portal). Clients refresh single-flight on 401 TOKEN_EXPIRED.

## Appendix B — Public (website) API surface (fixed; implemented by the `public` module, consumed by apps/web)

```
GET  /api/v1/public/site                      site settings allow-list: brand, contacts, offices, social, trust_stats, value_props, disclaimer, seo_defaults, analytics, site_live, coming_soon_message, portal_url, featured project cards, walkthrough_video_url, banners (active now), home_sections, testimonials, latest_posts
GET  /api/v1/public/projects?city=&status=&bhk=&q=   published project cards: {slug, name, city, status, type, starting_price_paise|null, hero_image_url, bhk_options[], possession_date, rera_number}
GET  /api/v1/public/projects/:slug            published detail: overview, highlights, key facts, approvals, amenities, configurations (flat types with rooms/areas/specs; price only if show_prices), availability grid (AVAILABLE|NOT_AVAILABLE per cell) if show_availability, construction progress (stages + website photos) if show_progress, videos, tours, map, landmarks, faqs, seo, brochure_available, visit_booking_enabled
GET  /api/v1/public/projects/:slug/visit-availability?from=&to=   [{date, slots:[{start,end,available}]}]
GET  /api/v1/public/posts?page= · GET /api/v1/public/posts/:slug · GET /api/v1/public/pages/:slug · GET /api/v1/public/gallery?project= · GET /api/v1/public/people
GET  /api/v1/public/media/:id[?variant=thumb|medium]   immutable image bytes
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

All public GETs: `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`; 404 for unpublished; never return ids of users/customers, costs, storage keys or Hold/Booked/Blocked distinctions.

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
GET  /api/v1/portal/bookings/:id/ledger   → PortalLedgerResponse
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
GET  /api/v1/portal/profile              → PortalProfileResponse           PATCH /api/v1/portal/profile (PortalProfileUpdate; audited as CUSTOMER)
```

Every `:id` is checked against the customer's bookings; anything else is 404. KYC values are masked. No internal ids of staff users or storage keys are returned.

Appendix C additions (required by apps/portal): `GET /api/v1/portal/requests/categories` → `[{id, name, default_priority}]`; `POST /api/v1/portal/requests` is JSON (`PortalRequestCreate`, `attachment_ids: []`) and photos are uploaded afterwards one per call to `POST /api/v1/portal/requests/:id/attachments` (multipart, field `file`, optional text field `message_id` = one of the customer's own messages on that request — the opening message from the create response — to append the file to it) which returns `PortalDocumentRow` with `document_id`; replies carry the returned ids in `attachment_ids`. Thread attachments carry `thumb_url` (≈480 px) and `url` (signed full-size link). `GET /portal/notifications/unread-count` → `{count}`. Notification rows carry `booking_id`: the booking itself for booking bells, the booking of the demand / other-charge line / payment for those bells (so the app switches the selected booking before opening `screen`), null for company-wide bells. `GET /portal/bookings` and `GET /portal/auth/sessions` return bare arrays. 423 LOCKED carries `details.locked_until`; 429 carries `Retry-After`.
