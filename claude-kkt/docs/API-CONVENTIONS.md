# KKT v2 — API conventions (every module follows these)

Base path `/api/v1`. Three surfaces on the same server:

| Prefix | Audience | Auth |
|---|---|---|
| `/api/v1/auth/*`, `/api/v1/<module>` | Staff ERP | Bearer access JWT with `aud: "erp"` |
| `/api/v1/portal/*` | Customers | Bearer access JWT with `aud: "portal"` |
| `/api/v1/public/*` | Website | none; read-only; rate-limited; cached 60 s |

## Request/response shapes
* JSON only. Money = integer **paise** (`amount_paise`). Percent = number with ≤ 2 decimals. Dates `YYYY-MM-DD`; timestamps RFC 3339 UTC.
* Every schema comes from `@kkt/contracts` (Zod). Unknown body/query keys → 400 `VALIDATION_ERROR`.
* List endpoints: query `page` (1-based), `page_size` (≤ 200, default 25), or `cursor`+`limit` (keyset by `(sort_field, id)`), `search`, `sort` (`field` or `-field`, allow-listed), typed filters, `format=csv`, `include_inactive`.
  Envelope: `{ "items": [...], "total": n, "page": p, "page_size": s, "next_cursor": "..." | null }`. CSV responses stream `text/csv` with `Content-Disposition: attachment`.
* Single resources return the row with `version`. Mutations return the updated row.
* Errors: `{ "error": { "code": "UPPER_SNAKE", "message": "human text", "details": {...}, "request_id": "..." } }`.
  Status map: 400 VALIDATION_ERROR / IDEMPOTENCY_KEY_REQUIRED; 401 UNAUTHENTICATED / TOKEN_EXPIRED / INVALID_AUDIENCE; 403 FORBIDDEN (permission); 404 NOT_FOUND (also for out-of-scope); 409 VERSION_CONFLICT (`details.current`, `details.changed_by`), FLAT_NOT_AVAILABLE, BUCKET_CAP_EXCEEDED, IN_USE (`details.usage_count`), SLOT_FULL, PLAN_STAGES_MISSING (`details.missing_stages`), UNDO_BLOCKED; 413 PAYLOAD_TOO_LARGE; 422 BUSINESS_RULE (`details.rule`); 423 LOCKED; 429 RATE_LIMITED (+ `Retry-After`).

## Headers
* `Idempotency-Key` accepted on every POST that creates; **required** on `POST /payments`. Same key + same body → identical stored response with `Idempotent-Replayed: true`; same key + different body → 422 IDEMPOTENCY_MISMATCH. Keys are scoped per subject (user/customer) or IP, kept 24 h.
* `If-Match: "<version>"` (or `version` in body) on PATCH/POST state changes; stale → 409 VERSION_CONFLICT.
* Responses always carry `X-Request-Id`; lists carry `ETag` and honour `If-None-Match` (304).

## Permissions
* Every staff route declares `config: { permission: "code" }`; the registry test fails if any staff route has none. Portal routes declare `config: { audience: "portal" }`; public routes `config: { public: true }`.
* Project scope: queries use `scopeFilter(user)`; direct lookups use `ensureProjectAccess(user, projectId)` → 404.
* KYC reveal: `GET /customers/:id?reveal=true` requires `customer.kyc_view` and writes `customer.kyc_reveal` audit row.

## Transactions & locks
* One service function = one `db.transaction`. Hot rows use `SELECT … FOR UPDATE`; per-booking money operations take `pg_advisory_xact_lock(hashtext(booking_id))` so ledger `seq` and running balances are serialised.
* Side effects (notifications, audit) are written inside the same transaction; emails/webhooks (none in scope) would be outboxed.

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
Portal mirrors this under /api/v1/portal/auth/* with {phone, password} and aud=portal.
```
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
GET  /api/v1/public/site-visits/:token        manage view · GET …/:token.ics · POST …/:token/cancel
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

Appendix C additions (required by apps/portal): `GET /api/v1/portal/requests/categories` → `[{id, name, default_priority}]`; `POST /api/v1/portal/requests` is JSON (`PortalRequestCreate`, `attachment_ids: []`) and photos are uploaded afterwards one per call to `POST /api/v1/portal/requests/:id/attachments` (multipart, field `file`) which returns `PortalDocumentRow` with `document_id`; replies carry the returned ids in `attachment_ids`. `GET /portal/bookings` and `GET /portal/auth/sessions` return bare arrays. 423 LOCKED carries `details.locked_until`; 429 carries `Retry-After`.
