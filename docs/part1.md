# Part I — Product & Architecture

{{toc}}

## 1. Executive summary

KKT is a single-backend real-estate operating system for Indian developers. One FastAPI service (`/app/backend`) powers three front doors: the **ERP** (`/app/frontend`, React, served under `/erp`), the public **marketing website** (`/app/site`, React, served at `/`) and the **customer portal** (`/app/mobile`, Expo — web, iOS and Android). Everything a developer does between launching a tower and handing over keys is modelled: master data, floor-plan driven inventory generation, pricing, CRM, construction-linked payment plans with automatic demands, an integer-paise payment ledger with receipts and Roznamcha, documents and photos, service requests, notifications, reports, a content-managed website with lead capture (enquiries, brochure lead gate, site-visit scheduler) and a customer portal that mirrors the ledger.

> Design principles — **selection, not typing** (every repeated value is a master); **track, don't gate** (the ledger never refuses a legitimate rupee, it reports it); **one truth** (demands, payments and the ledger are derived, idempotent and re-buildable); **auditability** (every write publishes an event that lands in an immutable audit log); **additive public contracts** (portal and site APIs only grow).

### 1.1 The three surfaces on one backend

| Surface | Path / host | Audience | Auth |
|---|---|---|---|
| ERP | `/erp` on the main domain (`frontend/scripts/dev.js` serves the production build) | Owners, project admins, sales, accounts, marketing, site engineers | JWT `aud=erp`, 15-min access + rotating refresh, optional TOTP MFA |
| Marketing site | `/` on the main domain (same Node server, separate React build) | Prospective buyers | Public; rate-limited, honeypot-protected forms |
| Customer portal | Expo app; `/portal` redirects to the configured Expo host | Home buyers | JWT `aud=portal`, isolated token family, forced first-login password change |

### 1.2 Personas & roles

| Persona | System role | What they do |
|---|---|---|
| Owner / MD | Super Admin | Everything; sees integrity reports, audit log, documentation, reseed |
| Project head | Project Admin | Structure, inventory, pricing, bookings, construction, leads & visits for assigned projects |
| Sales executive | Sales | Leads, site visits, bookings, customers for assigned projects |
| Accounts | Accounts | Payments, receipts, reversals, Roznamcha, finance reports (all projects) |
| Marketing | Marketing | CMS, blog, gallery, enquiries, lead read, visits read |
| Site engineer | Site Engineer | Construction stages, photos (customer-hidden photos allowed) |
| Employee | Employee | Read-only dashboards and lists; no finance access |
| Buyer | (portal customer) | Bookings, schedule, ledger, receipts, documents, construction photos, tickets, notifications |

The full permission registry and the role × permission matrix are generated from `permissions.py` in §3.4–3.5.

## 2. System architecture

### 2.1 Stack

| Layer | Technology | Notes |
|---|---|---|
| API | FastAPI 0.11x, Python 3.11, Motor (async MongoDB), Pydantic v2 `StrictModel` (`extra="forbid"`) | Supervisor-managed on `0.0.0.0:8001`; every route under `/api` |
| Database | MongoDB (standalone in preview; replica set recommended) | `MONGO_URL`, `DB_NAME` from env only; UUID string `id`, `_id` never leaves the API |
| ERP | React 18 (CRA), TanStack Query, shadcn/ui, Tailwind, Recharts, lucide | Design tokens: navy `#0B1F3A`, gold `#C9A227`, ivory `#F7F5EF`, Manrope |
| Site | React 18 (CRA), Tailwind, framer-motion, react-helmet-async, `fetch` client | Cormorant + Manrope, route-level code splitting |
| Portal | Expo (React Native + web) | Separate repo folder `/app/mobile`; consumes `/api/portal/*` only |
| Files | Emergent object storage via `storage.py` (`put_object/get_object`) | Thumbnails via Pillow (WebP) |
| PDFs | reportlab (`services/pdf.py`) | Receipts, demand letters, allotment letters, statements, brochures, this document |

### 2.2 Folder structure

```
/app/backend
  server.py            app factory, middleware chain, lifespan (indexes, migrations, seeds, loops)
  deps.py              JWT, auth dependencies, require(perm), project scoping, rate limiter
  permissions.py       PERMISSION_GROUPS, SYSTEM_ROLES
  utils.py             ApiError, StrictModel, base_doc, paginate, ListParams, audit, csv
  uow.py               unit_of_work(): Mongo transactions when available, compensation otherwise
  events.py            in-process event bus → audit subscriber, roles_version bump
  infra.py             ObservabilityMiddleware (request-id, timing, security headers, metrics), IdempotencyMiddleware
  crypto.py            Fernet field encryption, masking
  storage.py           object storage adapter
  routers/             auth users roles projects blocks flats rate_cards parking customers leads bookings
                       payments roznamcha milestones construction documents support notifications reports
                       pdfs dashboard dashboard_widgets search settings imports audit admin cms public portal visits
  services/            flat_generation pricing(kyc,money,numbering) ledger dues_engine integrity thumbs pdf
                       portal_notify counters ttlcache filesig
  migrate_phase7.py    legacy milestones → payment-plan installments (idempotent)
  seed*.py             deterministic demo data (guarded by settings markers)
  tests/               pytest suites (hit the preview URL)
/app/frontend          ERP (src/pages, src/components/common, src/hooks, scripts/dev.js = prod server)
/app/site              marketing site (src/pages, SiteShell.jsx, LeadGate.jsx, VisitBooking.jsx)
/app/mobile            Expo customer portal (untouched by ERP builds)
/app/docs              this documentation (markdown + generated appendices + PDF)
```

### 2.3 Request lifecycle & middleware chain

```flow
Ingress (/api → :8001) -> CORS (allow-list from CORS_ORIGINS) -> GZip ≥1 KB -> IdempotencyMiddleware (POST + Idempotency-Key) -> ObservabilityMiddleware (request-id, timing, security headers, metrics) -> Router → Depends(require(perm)) -> Pydantic StrictModel validation -> Optimistic version check (409 VERSION_CONFLICT) -> unit_of_work() -> Event bus publish -> Audit subscriber + notifications -> JSON response {…} / {detail, code, request_id}
```

1. **Request id & timing** — `X-Request-Id` is generated (or echoed), the duration is logged as structured JSON and aggregated into `/api/metrics` (`infra.metrics_snapshot`).
2. **Security headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS when behind TLS.
3. **Rate limiting** — `deps.enforce_rate_limit(key, limit, window)` is a Mongo-backed sliding window (`rate_limits` collection) keyed by IP/route: login 10/min, enquiries 5/min, brochure requests 5/min, site visits 5/min, portal login 10/min. Returns 429 `RATE_LIMITED` with `retry_after`.
4. **Authentication** — `Depends(current_user)` decodes the JWT (`aud` must be `erp`; portal tokens carry `aud=portal` and are rejected by ERP routes), loads the user (without secrets) and verifies `is_active`, forced password change and MFA status.
5. **Permission** — `require("perm.key")` checks the role's permission list (cached per process; invalidated by `roles_version` bumps published on role edits) and attaches `project_scope_filter(user)` for list endpoints.
6. **Version check** — writable documents carry `version`; PATCH bodies send the version they saw; a mismatch is a 409 `VERSION_CONFLICT` (`guarded_update`).
7. **Idempotency** — POSTs that create money or inventory require `Idempotency-Key` (`IDEMPOTENCY_KEY_REQUIRED`); the middleware stores the first response per key for 24 h and replays it.
8. **Unit of work** — `uow.unit_of_work()` opens a Mongo transaction when the server supports it (`detect_transaction_support()`); otherwise it records compensation callbacks (`on_rollback`) so multi-document writes roll back on failure.
9. **Event bus → audit** — `events.bus.publish("entity.action", payload)`; `audit_subscriber` writes the immutable `audit_logs` row (actor, entity, before/after diff, ip, request id); other subscribers fan out notifications.

### 2.4 Host-aware mounting & the three-deployment recipe

`frontend/scripts/dev.js` is both the dev proxy and the production server. With `PREVIEW_MODE=production` it builds `/app/frontend` (ERP, `homepage=/erp`) and `/app/site` (root) and serves them from one Node process on port 3000: hashed assets `Cache-Control: immutable`, `index.html` `no-cache`, Brotli/Gzip, SPA fallbacks for `/erp/*` and `/*`, `/portal` → `PORTAL_URL`. Production deployments split this into three hosts (`www.`, `erp.`, `portal.`) while the API stays single — see §22.

### 2.5 Caching layers

| Layer | Mechanism | Invalidation |
|---|---|---|
| Permissions | per-process dict keyed by role id + `roles_version` | role edit publishes `roles_version` bump |
| Public API | `ETag` + `If-None-Match` → 304, `Cache-Control: public, max-age` on `/api/public/*`; `ttlcache` 60 s for availability | writes call `ttlcache.invalidate(prefix)` |
| Media | thumb/medium WebP variants pre-generated; `Cache-Control: public, max-age=31536000, immutable`, strong ETag | storage keys are content-addressed per upload |
| ERP data | TanStack Query `staleTime` 15 s, `useList` reload after mutations, unread-count polling 30 s | mutation hooks |
| Static assets | hashed filenames, immutable | new build hash |

### 2.6 Background jobs & startup sequence

| Job | Schedule | Code |
|---|---|---|
| Daily dues | 00:30 IST (and once at startup) | `server._dues_loop` → `dues_engine.raise_due_installments` per Active booking |
| Overdue sweep | hourly | `_overdue_loop` marks demands `Overdue`, notifies customer + RM once |
| Integrity check | startup + nightly | `services.integrity.integrity_report` → log + Super Admin notification when `ok=False` |
| Notification sweep | startup | `portal_notify.sweep()` normalises legacy types, deletes orphaned/voided references |
| Media prewarm | startup (background) | `thumbs.prewarm_variants` generates missing thumb/medium variants |
| Site-visit nudge | every 6 h | `visits.nudge_loop` — past Confirmed/Rescheduled visits → "Mark outcome" to RM |

Startup (`server.lifespan`): create indexes (unique `(booking_id, installment_seq)` partial on `voided≠true`, TTL on `brochure_tokens`, text/compound list indexes) → sync system roles (`roles_version`) → migrations (`migrate_phase7`) → backfills (`integrity.backfill_demand_installments`) → seed-if-empty (phases 1–9, each guarded by a `settings` marker) → integrity report log → start loops.

## 3. Security & privacy

### 3.1 Authentication

| Control | Implementation (`routers/auth.py`, `deps.py`) |
|---|---|
| Password hashing | bcrypt via passlib; policy ≥ 8 chars with letter + digit; history of last 5 (`PASSWORD_HISTORY`) |
| Access token | HS256 JWT, `aud` ∈ {`erp`, `portal`}, `exp` = 15 min (`ACCESS_TOKEN_MINUTES`) |
| Refresh token | opaque, hashed at rest in `refresh_tokens` with a `family` id; 7 days (`REFRESH_TOKEN_DAYS`); each use rotates; reuse of a consumed token revokes the whole family (`REFRESH_TOKEN_REUSED`) |
| Lockout | 5 failed attempts → 15-min lock (`LOCKED`); counters on the user document |
| Rate limit | 10 logins / 60 s / IP (Mongo sliding window) |
| MFA | TOTP (pyotp) enrol → verify → login returns `mfa_required` + short-lived `mfa_token` (aud `erp`) → `/auth/mfa/login`; disable requires password + code |
| Sessions | `/auth/sessions` lists refresh families with device/IP; revoke one or all |
| Portal | separate login, `aud=portal`, customer `must_change_password` on first login, strict serializers (`routers/portal.py`) |

### 3.2 Authorisation & scoping

Permissions are flat strings grouped for the UI (§3.4). `require(perm)` returns the user; list endpoints merge `project_scope_filter(user)` — `{}` for all-project roles, `{"project_id": {"$in": user.project_ids}}` otherwise. Super Admin bypasses with `permissions="*"`. Dangerous settings (`settings.manage`, `audit.view`, reseed, integrity repair, documentation) are Super Admin only.

### 3.3 Data protection

- **Field encryption** — PAN, Aadhaar and bank account numbers are stored as Fernet ciphertext (`crypto.encrypt_field`, key `FIELD_ENCRYPTION_KEY`) plus an HMAC-SHA256 `*_hash` (`kyc.secure_hash`) for dedupe/equality search; API responses return masked values (`XXXXX1234F`, `XXXX XXXX 1234`) unless the caller holds `customer.kyc_view` and asks `?reveal=true`, which is audited (`customer.kyc_reveal`).
- **Validation** — PAN regex, Aadhaar Verhoeff checksum (`kyc.verhoeff_valid`), IFSC format, Indian mobile normalisation.
- **Uploads** — `services/filesig.py` checks magic bytes against the declared MIME (PDF/JPEG/PNG/WebP), size limits, sensitive flag; files live in object storage, never in Mongo.
- **Signed links** — brochure downloads (15 min), site-visit manage/ICS links, portal document links: HMAC-signed payload (`visits.sign/unsign`), expiry → 410 `LINK_EXPIRED`, tamper → 404.
- **Public allow-list** — `/api/public/*` serializers whitelist fields (`has_brochure`, prices only when `show_prices`); `tests/test_portal_leaks.py` asserts portal payloads never contain internal ids, costs or secrets.
- **Audit log** — append-only `audit_logs` `{id, at, actor_id, actor_name, action, entity_type, entity_id, before, after, ip, request_id, company_id}`; no update/delete endpoints exist.
- **Erasure & export** — `POST /api/customers/{id}/erase` (blocked while an Active/Completed booking exists → 409 `ACTIVE_BOOKING`) anonymises PII and keeps financial rows; `/api/admin/export` streams a JSON backup.
- **OWASP outcome** — injection (typed queries, no string concatenation), broken auth (above), sensitive data (encryption + masking), XXE n/a, access control (`require` + scoping + tests), misconfiguration (headers, CORS allow-list), XSS (React escaping; CMS HTML sanitised), insecure deserialisation (Pydantic strict), logging (request ids, audit), SSRF (no outbound fetch of user URLs).
- **Known limitations** — single-tenant per deployment; rate limits are per-process-safe but per-IP (behind a shared NAT several users share a bucket); no WebAuthn; refresh tokens are not bound to device fingerprints.

{{include:permissions.md}}
