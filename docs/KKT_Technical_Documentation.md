{{toc}}

# Part I — Product & Architecture

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
| ERP | React 18 (CRA), TanStack Query, shadcn/ui, Tailwind, Recharts, lucide | Design tokens (v2 Royal Black & Warm White): ink `#0A0C10`, warm `#FBF9F4`/`#F4F0E8`, gold `#C9A227`, Manrope + serif display — see §26 |
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

`frontend/scripts/dev.js` is both the dev proxy and the production preview server. Since Phase 12 the production artefact is a **single packaged build** (`yarn build` → `build/` with the marketing site at `/`, the ERP under `/erp/` and the Expo web portal under `/portal/`, plus an inline router-loader in the root `index.html`); `dev.js` serves that bundle 1:1 (hashed assets `Cache-Control: immutable`, root-index fallback for every non-`/api` path, Brotli/Gzip). The legacy three-host recipe (`www.`, `erp.`, `portal.`) remains supported — see §22 and §24.

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
# Part II — Data model

{{include:collections.md}}

### 4.1 Core entity relationships

```flow
Company -> Project (website, RERA, unit counts) -> Block / Tower (floor plan assignments, construction stages) -> Flat (type snapshot, price breakup, status) -> Booking (buckets, plan snapshot, other charges) -> Demand (per installment) -> Payment (receipt) -> Ledger row (running balance)
```

```flow
Lead (source, stage, activities) -> Site visit (slot, capacity) -> Customer (sealed KYC, portal account) -> Booking -> Service request / Documents / Photos / Notifications
```

Masters referenced by id and snapshotted into the dependent document at write time: flat types, floor-plan templates, PLC types, charge types, amenities, banks, document types, construction stage masters, payment plans. Snapshots (`flat_type_snapshot`, `payment_plan_snapshot`, `construction_stages` copied into the block) make history immutable even when a master changes later.

### 4.2 State machines

**Flat**

```state
Available -> Hold : sales places a hold (expires automatically after hold_hours)
Hold -> Available : hold released or expired
Available -> Booked : booking confirmed (atomic find_one_and_update on status ∈ {Available, Hold})
Hold -> Booked : same precondition
Booked -> Sold : handover recorded on the booking
Booked -> Available : booking cancelled (refund computed)
Available -> Blocked : admin blocks the unit (not sellable)
Blocked -> Available : unblock
```

**Booking**

```state
Draft -> Active : wizard confirm (flat lock + agreement + plan snapshot + catch-up demands)
Active -> Cancelled : cancellation with refund ≤ paid (REFUND_EXCEEDS_PAID)
Active -> Completed : handover; flat → Sold
```

**Demand**

```state
Open -> Partially paid : cleared payment allocated below total
Open -> Overdue : due_date < today and unpaid (hourly sweep)
Partially paid -> Paid : paid_paise ≥ total_demand_paise
Open -> Voided : stage undo / integrity repair (unpaid only)
```

**Payment**

```state
Pending -> Cleared : cheque/DD cleared (clearing endpoint); CASH/UPI/NEFT_RTGS/LOAN_DISBURSEMENT clear immediately
Pending -> Bounced : cheque returned; ledger unaffected
Cleared -> Reversed : reversal with reason; ledger row REVERSAL appended
```

**Lead**

```state
New -> Contacted : first follow-up logged
Contacted -> Site Visit Scheduled : visit booked (also New → Site Visit Scheduled)
Site Visit Scheduled -> Site Visit Done : visit marked Completed
Site Visit Scheduled -> previous stage : only upcoming visit cancelled (auto-revert)
Site Visit Done -> Negotiation : manual
Negotiation -> Converted : convert to customer (+ optional booking)
any -> Lost : with lost_reason
```

**Service request**

```state
Open -> In Progress : assigned / first internal note
In Progress -> Resolved : resolution posted (SLA stop)
Resolved -> Closed : customer rates or 7-day auto-close
Resolved -> Open : customer reopens within window (CANNOT_REOPEN after close)
```

**Site visit**

```state
Confirmed -> Rescheduled : ERP reschedule (capacity re-checked, counts as confirmed)
Confirmed -> Completed : outcome; lead → Site Visit Done
Confirmed -> No-show : outcome; activity logged
Confirmed -> Cancelled : visitor (signed link) or ERP with reason
Cancelled -> Confirmed : ERP re-confirm (capacity re-checked)
```

**Construction stage (per block)**

```state
Pending -> Completed : set current stage (jump-ahead completes all earlier stages with the same date)
Completed -> Pending : undo last completed stage — blocked if any demand it raised has a payment (UNDO_BLOCKED_BY_PAYMENTS)
```
# Part III — Modules

Each module section states its purpose, the ERP screens, inputs and validation, the algorithm (as pseudo-code), edge cases, permissions and the API surface (full list in Appendix A). File paths are given so engineers can verify every statement against the code.

## 5. Master data & selection-driven design

**Why.** Free-text is the root cause of inventory and finance errors (a "3BHK" here, "3 BHK" there). KKT models every repeated value as a master (`routers/master.py`, generic CRUD over `master_<kind>` collections: flat types, floor-plan templates, PLC types, charge types, amenities, banks, document types, specification items, room types, area types, teams, construction stage masters, milestone templates). Dependent documents reference the master by `id` **and snapshot the fields they need**, so edits never rewrite history.

| Rule | Behaviour |
|---|---|
| Duplicate names | `DUPLICATE_NAME` 409 on create/rename (case-insensitive); the ERP sheet warns inline before submit (`master-dupe-warning`) |
| Deactivate vs delete | Masters are never deleted; `is_active=false` hides them from pickers while existing references keep working |
| Rapid entry | "Save & add another" keeps the sheet open, resets the form and counts additions |
| Versioning | Every master carries `version`; stale PATCH → `VERSION_CONFLICT` |

**Floor Plan Templates** define the positions on a floor: `[{position, flat_type_id, facing, plc_type_ids[]}]`. A block assigns templates to **floor ranges** (`floor_plans: [{from_floor, to_floor, template_id}]`) and declares `skip_floors` (e.g. 13), `refuge_floors` (no units) and `podium_floors` (counted but unit-free). Numbering patterns are expressions on the block — `flat_number_pattern` e.g. `{floor}{position:02d}` → `1201`, `floor_label_pattern` e.g. `G`, `P1`, `{floor}`.

## 6. Flat generation algorithm (`services/flat_generation.py`)

```
generate_flats(block, floors=None, user):
  plan  = resolve_positions(block)              # floor → [positions] from floor ranges, minus skip/refuge/podium
  floors = requested floors ∩ plan.keys()       # None = all
  fts   = load_flat_types(all flat_type_ids in plan)   # fails INVALID_FLAT_TYPE if inactive/missing
  seq = 0
  for floor in sorted(plan):                    # seq is block-wide and deterministic → stable numbering
    for pos in sorted(plan[floor] by position):
      seq += 1
      if floor in floors: docs.append(build_flat(block, fts[pos.flat_type_id], floor, pos, seq, user))
  with unit_of_work():                          # insert_many ordered; on failure delete the inserted ids
    flats.insert_many(docs)
  refresh_counts(block, project)                # unit_counts by status for dashboards
```

`build_flat` snapshots the flat type (`flat_type_snapshot`: name, bhk, areas, base rate) and calls `compute_price` (§7). Guards: **regenerate** is refused while any flat in the block is `Hold/Booked/Sold` (`STATUS_LOCKED`); **append floors** generates only the new floors with the continuing sequence; **re-snapshot** (`resnapshot_flat`) refreshes a single Available flat from its current type.

## 7. Pricing engine

| Element | Where | Rule |
|---|---|---|
| Base rate | block `rate_per_sqft` else flat type `base_rate_per_sqft` | ₹/sq.ft on super built-up (`area_values.super_builtup_sqft`) |
| Lump-sum price | flat type `base_price` | overrides rate × area; breakup has one line |
| Floor rise | block `floor_rise_per_sqft` × (floor − `floor_start`) × SBU | added as a breakup line |
| PLC | `master_plc_types` with `calc_mode` ∈ {per_sqft, percent, fixed} | applied per flat from floor-plan positions (`plc_ids`) |
| Rate cards | `routers/rate_cards.py` | dated rate per project/block; **apply** rewrites price breakup of **Available** flats only, bulk, audited |

```
compute_price(ft, block, floor):
  if ft.base_price: return (None, base_price, [lump-sum line])
  rate = block.rate_per_sqft or ft.base_rate_per_sqft; sbu = ft.super_builtup_sqft
  if rate is None or sbu is None: return (rate, None, [])
  rise = block.floor_rise_per_sqft × max(0, floor − block.floor_start)
  breakup = [Base rate × sbu] + [Floor rise line if rise]
  return (rate + rise, Σ breakup, breakup)
```

Prices are stored in rupees on flats (display) and converted to integer paise the moment they enter an agreement (`services/money.to_paise`).

## 8. Projects, blocks, flats & inventory UI

- **Block wizard** (`pages/BlockWizard.jsx`): basics → floors (start, count, skip/refuge/podium) → floor-plan ranges → numbering → review (preview of generated numbers) → generate.
- **Inventory grid 2.0** (`pages/BlockDetail.jsx`): floor rows × positions, colour by status, legend, search, bulk actions (hold, block, price apply, type re-snapshot), cell drawer with price breakup and booking link; mobile card rows.
- **Parking** (`routers/parking.py`): slots per block (`covered/open/stilt`), allotment at booking (`PARKING_NOT_AVAILABLE` guard), release on cancel.
- **Specifications & approvals**: per project lists of specification items (master) and approvals (RERA, NOCs) with dates, surfaced on the website when published.
- **Tower status**: `construction_percent` derived from completed stages (§12).

## 9. Customers & KYC (`routers/customers.py`, `services/kyc.py`)

| Field | Validation | Storage |
|---|---|---|
| Phone | normalised to 10 digits starting 6–9 (`normalize_phone`) | plain; unique per company (dedupe key) |
| PAN | `[A-Z]{5}[0-9]{4}[A-Z]` | Fernet ciphertext + HMAC hash; masked output |
| Aadhaar | 12 digits + Verhoeff checksum (`verhoeff_valid`) | ciphertext + hash; masked `XXXX XXXX 1234` |
| Bank | IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`, account masked to last 4 | ciphertext |
| Co-applicants | same rules, `INVALID_CO_APPLICANT` | embedded |

Dedupe: on create, a match on phone **or** PAN hash returns 409 `DUPLICATE` with the existing customer id. **Portal provisioning**: `POST /customers/{id}/portal-access` creates the portal account with a temporary password (returned once), `must_change_password=true`; reset re-issues. **Customer 360** (`pages/CustomerDetail.jsx`) tabs: profile & KYC (reveal with permission), bookings, ledger, documents, tickets, notifications, audit.

## 10. Leads pipeline (`routers/leads.py`, `routers/visits.py`)

- **Sources**: Walk-in, Website, Referral, Broker, Campaign, Brochure, Site Visit. Website/Brochure/Site-Visit leads are created by public endpoints with IP, UTM and honeypot checks.
- **Stages**: New → Contacted → Site Visit Scheduled → Site Visit Done → Negotiation → Converted | Lost; every change appends `stage_history {status, at, by, note}`.
- **Round-robin assignment** (`visits._assignee`): active Sales users sorted by id; `counters{scope:"round_robin"}` increments atomically; `site_settings.round_robin_assignment=false` pins to the first rep.
- **Dedupe**: a public submission reuses the open lead (same phone + project, stage ∉ {Lost, Converted}) instead of creating a duplicate; the event becomes an **activity** instead.
- **Activities timeline** (`activities[]`): `brochure_downloaded`, `site_visit_booked`, `site_visit_rescheduled`, `site_visit_cancelled`, `site_visit_completed`, `site_visit_no_show`, `stage_reverted`; rendered newest-first in the lead drawer.
- **Follow-ups**: dated tasks with `next_follow_up_at`; dashboard "Follow-ups due" widget.
- **Conversion** (`POST /leads/{id}/convert`): creates/links a customer (dedupe by phone/PAN), sets `Converted`, `converted_customer_id`; `LEAD_CONVERTED` blocks further edits; `USE_CONVERT` blocks manual stage jumps to Converted.

## 11. Booking engine (`routers/bookings.py`, `pages/BookingWizard.jsx`)

**Wizard v2 steps**: 1 Project & block → 2 Unit (grid, only Available/Hold selectable) → 3 Agreement (value, ₹/% cash split, auto-balance, rounding to the rupee, Σ check) → 4 Customer (search or create inline) → 5 Payment plan (assigned plans for the tower, default pre-selected, schedule preview with catch-up badge) → 6 Other charges & parking → 7 Review & confirm. Drafts autosave to `bookings{status:"Draft"}` and resume; the unsaved-changes guard warns on navigation.

```
confirm_booking(draft, Idempotency-Key):
  flat = flats.find_one_and_update({id, status ∈ {Available, Hold}}, {$set: {status: Booked, booking_id}})   # atomic lock
  if not flat: 409 NOT_AVAILABLE
  with unit_of_work():                                            # rollback releases the flat
    booking = {buckets: cash_agreed_paise, account_agreed_paise (Σ = agreement_value), other_charges[], parking}
    booking.payment_plan_snapshot = deep copy of chosen plan (installments, triggers) + accepted_at/by
    booking.booking_number = generate_number("booking")           # BK-{FY}-{SEQ}
    insert booking; allot parking; raise_other_charges(trigger="ON_BOOKING")
    dues_engine.raise_due_installments(booking)                   # catch-up: every installment whose trigger already happened
  publish booking.create → audit, customer notification, RM notification
```

| Rule | Detail |
|---|---|
| Agreement split | cash + account = agreement value; either may be 0; both integers (paise) |
| Agreement revisions | allowed while Active; a revision stores `before/after` and is an `AGREEMENT_CHANGE` ledger event; a bucket cannot be revised **below what is already received** (`BELOW_PAID`) |
| Other charges | lines from charge-type master with GST %, trigger ON_BOOKING / ON_DEMAND / ON_POSSESSION; separate ledger |
| Cancellation | `refund ≤ paid` (`REFUND_EXCEEDS_PAID`); deduction recorded; flat → Available; parking released; demands voided |
| Handover | Active → Completed only when outstanding = 0 (`PENDING_PAYMENTS`); flat → Sold |

### 11.9 Edge cases — booking engine

| Situation | Behaviour | Where |
|---|---|---|
| Two users book the same flat simultaneously | `find_one_and_update({status:"Available"} → "Booked")` is the lock; the loser gets `409 FLAT_NOT_AVAILABLE`, nothing else is written | `routers/bookings.py create_booking` |
| Cash + Account ≠ agreement | `422 SPLIT_MISMATCH`; the wizard blocks Next until the slider/inputs balance | `BookingIn` validator, `BookingWizard.jsx sumOk` |
| Default split | tower `default_cash_percent` → project `default_cash_percent` → 0; percent mode pre-filled, slider re-balances both buckets | `BookingWizard.jsx defaultCashPct` |
| Plan assigned to the tower but customer wants another | wizard lists only plans assigned to the block; "Custom" requires `plan.override` permission | `/api/blocks/{id}/plans`, `PlanPicker` |
| Stage already reached at booking time (catch-up) | every installment whose trigger stage is ≤ current tower stage is demanded immediately with `posted_at = booking_date` | `services/dues.catch_up` |
| Booking on a Hold/Blocked flat | hold owner may convert within hold window; others 409; blocked flats never bookable | `flat.status` guard |
| Co-applicant is the same person as primary | `422 DUPLICATE_APPLICANT` | `BookingIn` validator |
| Parking slot already allotted | `409 PARKING_TAKEN`; slot allocation is part of the same transaction as the flat lock | `allocate_parking` |
| Revision lowers a bucket below what was received | `422 REVISION_BELOW_RECEIVED` — caps can be raised freely, lowered only to ≥ received | `revise_agreement` |
| Cancel with receipts | requires reason; refund/deduction recorded; demands voided; flat → Available; payments stay for audit; ledgers freeze with CANCELLATION event | `cancel_booking` |
| Cancel a Completed (handed-over) booking | `409 BOOKING_COMPLETED` | status guard |
| Optimistic concurrency | all mutations require `version`; stale → `409 VERSION_CONFLICT` with the current version in `details` | `StrictModel` + `utils.require_version` |
| Idempotent create | `Idempotency-Key` header replays the first response for 24 h | `infra.IdempotencyMiddleware` |

## 12. Construction stages & tower status (`routers/construction.py`)

- **Master sequence** (`construction_stages`): ordered stage names (Foundation … Possession) with `is_possession` flag; copied into each block as `block.construction_stages[{stage_id, seq, name, status, completed_on, completed_by, notes, visible_to_customers}]`.
- **Set current stage**: completes the chosen stage and every earlier Pending stage with the same date (jump-ahead is allowed and logged); `construction_percent = completed / total × 100` (rounded).
- **Photos**: per stage, object storage, `visible_to_customers` flag; thumb/medium variants; portal shows only visible photos of visible stages.
- **Undo rule (exact)**: only the **last completed** stage can be undone; the undo voids the unpaid demands that stage raised; if any such demand has a payment, undo is refused with 409 `UNDO_BLOCKED_BY_PAYMENTS`; `completed_at/by/on` are cleared; unread notifications about the stage/demands are deleted and read ones are marked `withdrawn`.
- **Notifications**: customers of Active bookings in the block get `stage.completed` (and `demand.raised` for the demands it triggered); RMs get the ERP equivalent.

## 13. Payment plans & the auto-dues engine (`routers/bookings.py` plans, `services/dues_engine.py`)

**Plan master**: `{name, installments: [{seq, name, percent, trigger_type, trigger_stage_id?, days_after_booking?, fixed_date?, due_days}]}`; validation requires Σ percent = 100 (±0.005), unique seq, stage triggers referencing active stage masters. **Trigger types**: `ON_BOOKING`, `ON_STAGE` (construction stage completed), `DAYS_AFTER_BOOKING`, `ON_DATE`, `ON_POSSESSION`. **Assignments**: plan ↔ project or tower with a default flag; assigning a stage-triggered plan to a tower that lacks those stages → 409 `PLAN_NOT_APPLICABLE`; a plan with active bookings is `PLAN_LOCKED` for installment edits.

```
raise_due_installments(booking, today):                       # idempotent; runs at booking, on stage completion, daily 00:30 IST
  if booking.status ≠ Active or no snapshot: return []
  existing = non-void demands of booking
  raised   = {installment_seq} ∪ absorbed seqs;  raised_names = {lower(installment_name)}
  cum      = Σ existing.percent  (or max cumulative_percent for legacy rows)
  for ins in snapshot.installments sorted by seq:
    if ins.seq ∈ raised or lower(ins.name) ∈ raised_names: continue       # belt and braces beyond the unique index
    td = trigger_date(ins, booking, block); if td is None or td > today: continue
    before = (pct_of(cash_agreed, cum), pct_of(account_agreed, cum))
    cum = round(cum + ins.percent, 2); if cum ≥ 99.995: cum = 100           # telescoping: last installment absorbs rounding
    new  = (pct_of(cash_agreed, cum), pct_of(account_agreed, cum))
    demand = {cash: new.c − before.c, account: new.a − before.a, total, demand_date: td, due_date: td + due_days, status: Open}
    try insert (unique partial index on (booking_id, installment_seq) where voided ≠ true) except duplicate: continue
    notify customer + RM
```

> Telescoping guarantees Σ demands = agreed amount to the paise: each demand is the difference between cumulative rounded amounts, so rounding never accumulates.

**Integrity report & repair** (`services/integrity.py`): for every Active booking compares snapshot, stages and demands. Finding kinds: `unsatisfied_trigger` (demand exists but its stage is not complete / date not reached), `missing_demand` (trigger satisfied, no demand), `duplicate_demand` (same seq twice), `unmapped_demand` (legacy demand without `installment_seq`), `summary` mismatch (Σ demands ≠ expected cumulative). `repair()` voids unearned **unpaid** demands (`void_reason`), raises missing eligible ones through the engine and skips anything with payments; the report is logged at startup and nightly and Super Admins are notified when `ok=false`.

### 13.7 Edge cases — plans & auto-dues

| Situation | Behaviour | Where |
|---|---|---|
| Percentages don't total 100 | `422 PLAN_PERCENT_SUM` on save; wizard shows live remainder | `PaymentPlanIn` validator |
| Telescoping rounding | demand(i) = round(agreement × cum%(i)) − Σ demand(1..i−1): the last installment absorbs every paise, so Σ demands == agreement exactly | `services/dues.amount_for` |
| Same stage marked twice (jump-ahead then undo) | demands are keyed `(booking_id, installment_seq)` — unique index; re-marking is a no-op, undo voids only the demands of the undone stage and retracts their notifications | `raise_for_stage`, `undo_stage` |
| Stage marked for tower with 0 active bookings | nothing raised; stage status still advances | `raise_for_stage` |
| Booking cancelled before stage reached | cancelled bookings are skipped (`status: Active`) | query filter |
| ON_DATE trigger in the past at plan acceptance | raised immediately (catch-up) with `due_date = trigger date` | `catch_up` |
| Daily job runs twice | idempotent — unique index + `demand_key`; second run reports `raised: 0` | `jobs.daily_dues` |
| Agreement revised after demands raised | existing demands are **not** rewritten; the next demands use the new agreement and the integrity report flags the delta until a re-rating is approved | `revise_agreement`, `integrity.report` |
| Grace days / overdue | `due_date = posted_at + grace_days` (settings `demand_due_days`); overdue = due_date < today and `due_paise > 0` | `services/dues` |
| Integrity repair | `POST /api/admin/integrity/repair` re-derives `summary`, re-numbers nothing, re-sends nothing; dry-run by default | `routers/admin.py` |

## 14. Payment ledger engine (`routers/payments.py`, `services/ledger.py`, `services/money.py`)

- **Money** is integer paise everywhere in storage and arithmetic; `present_money` adds rupee floats for display; `amount_in_words` renders Indian grouping ("Rupees Twelve Lakh Fifty Thousand Only").
- **Categories**: `Cash` bucket, `Account` bucket (cheque/NEFT/loan), `Other charges` (against a charge line). Modes: CASH, UPI, NEFT_RTGS, CHEQUE, DD, LOAN_DISBURSEMENT. `CLEAR_IMMEDIATELY = {CASH, UPI, NEFT_RTGS, LOAN_DISBURSEMENT}`; cheques/DDs start `Pending` and are cleared/bounced later.

> **Owner's principle — track, don't gate.** A buyer may pay before a demand is raised, pay more than the current demand, or pay only into one bucket. The ledger records every rupee against the bucket chosen and shows advances and running balances; the only hard stop is the **bucket cap** — a bucket cannot receive more than its agreed amount (`_check_cap` → 409 with the exact figures and the instruction to revise the agreement first).

```
post_payment(body, Idempotency-Key):
  booking must be Active (NOT_ACTIVE); amount > 0; category/mode valid; bank account valid for Account mode
  _check_cap(booking, payment)                       # bucket_paid(category) + amount ≤ agreed(category)
  status = Cleared if mode ∈ CLEAR_IMMEDIATELY else Pending
  receipt_number = generate_number("receipt", company, payment_date)     # {PREFIX}/{FY}/{SEQ}, FY = Apr–Mar
  with unit_of_work():
    insert payment; if Cleared: allocate to open demands of that bucket oldest-first (paid_paise, status) ; rebuild(booking)
  publish payment.create → audit; customer notification "Receipt R/2526/0042"; RM notification
clear_payment / bounce_payment: Pending → Cleared (allocate + rebuild) | Bounced (no ledger effect)
reverse_payment(reason): Cleared → Reversed; de-allocate; append REVERSAL event; rebuild
```

**Ledger table computation** (`ledger.rebuild`): collect events — DEMAND (posted_at), OTHER_CHARGE_DEMAND, PAYMENT/OTHER_CHARGE_PAYMENT (posted_at), REVERSAL, AGREEMENT_CHANGE, CANCELLATION — sort by (time, kind-order), then walk: track `pct` (cumulative demanded %), `cash_paid`, `account_paid`, agreed amounts as of each revision; per row emit `demanded`, `received`, `cash_balance`, `account_balance`, `advance` (received beyond demanded, per bucket) and `total_due`. Rows are persisted in `ledger_rows` and re-derived on every posting, so the statement is always reproducible.

### 14.1 Worked example — ₹1 Cr agreement, ₹60 L cash + ₹40 L account, Standard CLP (seeded `BK-2526-0001`)

Agreement ₹1,00,00,000 split **60 % Cash (₹60,00,000) / 40 % Account (₹40,00,000)**. Plan **Standard CLP**: installments 10 / 5 / 10 / 5 / 10 / 10 / 10 / 15 / 10 / 15 % → cumulative **10 / 15 / 25 / 30 / 40 / 50 / 60 / 75 / 85 / 100 %**. Every demand is split in the agreement ratio (60/40), so each bucket keeps its own due/advance.

| # | Installment | Cum. % | Cash demand (cum.) | Account demand (cum.) | Total demand |
|---|---|---|---|---|---|
| 1 | Booking (ON_BOOKING) | 10 % | ₹6,00,000 (₹6,00,000) | ₹4,00,000 (₹4,00,000) | ₹10,00,000 |
| 2 | Foundation | 15 % | ₹3,00,000 (₹9,00,000) | ₹2,00,000 (₹6,00,000) | ₹5,00,000 |
| 3 | Plinth | 25 % | ₹6,00,000 (₹15,00,000) | ₹4,00,000 (₹10,00,000) | ₹10,00,000 |
| 4 | 1st Slab | 30 % | ₹3,00,000 (₹18,00,000) | ₹2,00,000 (₹12,00,000) | ₹5,00,000 |
| 5 | 3rd Slab | 40 % | ₹6,00,000 (₹24,00,000) | ₹4,00,000 (₹16,00,000) | ₹10,00,000 |
| 6 | Top Slab | 50 % | ₹6,00,000 (₹30,00,000) | ₹4,00,000 (₹20,00,000) | ₹10,00,000 |
| 7 | Brickwork | 60 % | ₹6,00,000 (₹36,00,000) | ₹4,00,000 (₹24,00,000) | ₹10,00,000 |
| 8 | Plaster | 75 % | ₹9,00,000 (₹45,00,000) | ₹6,00,000 (₹30,00,000) | ₹15,00,000 |
| 9 | Finishing | 85 % | ₹6,00,000 (₹51,00,000) | ₹4,00,000 (₹34,00,000) | ₹10,00,000 |
| 10 | Possession (ON_POSSESSION) | 100 % | ₹9,00,000 (₹60,00,000) | ₹6,00,000 (₹40,00,000) | ₹15,00,000 |

The seeded receipts (all **Cleared**) and the running position of each bucket after every posting. "Demanded" is the cumulative demand raised in that bucket at the time; a negative due is shown as an **advance**:

| Row | Date | Receipt | Bucket · mode | Amount | Cash paid / demanded → due | Account paid / demanded → due |
|---|---|---|---|---|---|---|
| 1 | 03-Nov-2025 | SGB/2526/00001 | Account · NEFT | ₹4,00,000 | 0 / 6,00,000 → due ₹6,00,000 | 4,00,000 / 4,00,000 → ₹0 |
| 2 | 03-Dec-2025 | SGB/2526/00002 | Cash · CASH | ₹8,00,000 | 8,00,000 / 9,00,000 → due ₹1,00,000 | 4,00,000 / 6,00,000 → due ₹2,00,000 |
| 3 | 02-Jan-2026 | SGB/2526/00003 | Account · NEFT | ₹12,00,000 | 8,00,000 / 15,00,000 → due ₹7,00,000 | 16,00,000 / 10,00,000 → **advance ₹6,00,000** |
| 4 | 01-Feb-2026 | SGB/2526/00004 | Cash · CASH | ₹5,00,000 | 13,00,000 / 18,00,000 → due ₹5,00,000 | 16,00,000 / 12,00,000 → advance ₹4,00,000 |
| 5 | 03-Mar-2026 | SGB/2526/00005 | Cash · CASH | ₹10,00,000 | 23,00,000 / 24,00,000 → due ₹1,00,000 | 16,00,000 / 16,00,000 → ₹0 |
| 6 | 02-Apr-2026 | SGB/2627/00001 | Account · NEFT | ₹15,00,000 | 23,00,000 / 30,00,000 → due ₹7,00,000 | 31,00,000 / 20,00,000 → **advance ₹11,00,000** |
| 7 | 02-May-2026 | SGB/2627/00002 | Cash · CASH | ₹7,00,000 | 30,00,000 / 36,00,000 → due ₹6,00,000 | 31,00,000 / 24,00,000 → advance ₹7,00,000 |
| 8 | 01-Jun-2026 | SGB/2627/00003 | Cash · CASH | ₹20,00,000 | 50,00,000 / 45,00,000 → **advance ₹5,00,000** | 31,00,000 / 30,00,000 → advance ₹1,00,000 |
| 9 | 01-Jul-2026 | SGB/2627/00004 | Account · NEFT | ₹9,00,000 | 50,00,000 / 51,00,000 → due ₹1,00,000 | 40,00,000 / 34,00,000 → advance ₹6,00,000 |
| 10 | 31-Jul-2026 | SGB/2627/00005 | Cash · CASH | ₹10,00,000 | 60,00,000 / 60,00,000 → ₹0 | 40,00,000 / 40,00,000 → ₹0 |
| 11 | 01-Aug-2026 | SGB/2627/00006 | Other charges · UPI | ₹60,000 | Maintenance Deposit demanded ₹60,000 → paid in full (third ledger, outside the ₹1 Cr) | |

Resulting `summary`: `cash_paid_paise = 600000000`, `account_paid_paise = 400000000`, `due_paise = 0`, `other_charges_paid_paise = 6000000`, `last_payment_at = 2026-08-01` — exactly what `GET /api/bookings/{id}` returns for the seed.

**Advance behaviour (rows 3, 6, 8).** The ledger is a *flexible waterfall*: a payment is applied to its own bucket only, oldest open demand first, and whatever exceeds the demands raised so far is carried as an **advance** (`due_paise < 0` internally, shown as "Advance ₹X" and never netted against the other bucket). Row 3: ₹12 L account arrives when only ₹10 L account has been demanded (inst. 1–3) → ₹6 L advance; when inst. 4 (₹2 L) and inst. 5 (₹4 L) are raised they are consumed by the advance and the customer owes nothing on the account side until row 6. Row 6: ₹15 L account against ₹20 L demanded → ₹11 L advance, which absorbs inst. 7–9 (₹4 L + ₹6 L + ₹4 L = ₹14 L) leaving ₹3 L due that row 9 (₹9 L) clears with a ₹6 L advance absorbed by the final ₹6 L possession demand. Row 8: ₹20 L cash against ₹45 L demanded → ₹5 L advance absorbed by inst. 9 (₹6 L) leaving ₹1 L due; row 10 settles the last ₹10 L. The **bucket cap** (`cash_agreed_paise`) is never exceeded: a cash receipt that would push `cash_paid` above ₹60 L is rejected with `409 BUCKET_CAP` ("…already received ₹X; cannot accept ₹Y. Revise agreement first.") until an agreement revision raises the cap.

**Roznamcha** (`routers/roznamcha.py`): daily cash book — opening cash = previous closing; receipts (CASH mode, Cleared, by payment_date) in; cash deposits to bank and expenses out as **contra** entries; closing = opening + in − out; printable per day with denominations optional. **Recompute/reconcile** (`admin.reconcile_all`) rebuilds every ledger and flat/booking counters.

### 14.9 Edge cases — payment ledger

| Situation | Behaviour | Where |
|---|---|---|
| Amount in rupees with paise fraction | API accepts `amount` (₹) or `amount_paise`; stored and computed in **integer paise** only | `PaymentIn` |
| Payment exceeds bucket cap | `409 BUCKET_CAP` with the full sentence; UI pre-computes room and disables submit | `post_payment`, `PostPayment.jsx` |
| Payment with no demand raised yet | accepted up to the cap and shown as advance; consumed by future demands FIFO | `ledger.rebuild` |
| Cheque / DD | posted as **Pending**: counted in `pending_cheques_paise`, not in paid; `clear` allocates, `bounce` leaves no ledger effect and notifies | `clear_payment`, `bounce_payment` |
| Reverse a cleared receipt | `Cleared → Reversed` with reason; REVERSAL event re-opens the dues; receipt number is never reused; portal notification retracted | `reverse_payment` |
| Reverse twice / reverse a bounced cheque | `409 INVALID_TRANSITION` | state guard |
| Payment date in a different FY than today | receipt number uses the **payment_date** FY (`SGB/2526/…` vs `SGB/2627/…`), sequence per company+FY via atomic counter | `numbering.next_receipt` |
| Back-dated payment | allowed with `payment.backdate`; ledger re-sorted by (payment_date, posted_at); Roznamcha of that day changes and is flagged "amended" | `post_payment` |
| Other-charge payment larger than the charge | `409 CHARGE_CAP` — third ledger has its own caps per charge line | `post_payment(against=OTHER_CHARGE)` |
| Concurrent postings on one booking | posting runs in a unit of work with `version` check on the booking; the second poster retries once on `VERSION_CONFLICT` | `services/uow.post_payment` |
| Duplicate submit (double click / retry) | `idempotency_key` per client request → same receipt returned | `payments.idempotency_key` unique |
| Amount in words | Indian system (lakh/crore), paise suffix only when non-zero | `utils.amount_in_words` |
| Roznamcha opening balance | previous day's closing (computed, cached per day); contra entries (bank deposit, expense) reduce cash in hand | `routers/roznamcha.py` |

## 15. Documents & media (`routers/documents.py`, `services/thumbs.py`)

Documents: `{entity_type, entity_id, document_type_id, title, file_name, mime, size, storage_key, is_sensitive, shared_with_customer}`; upload validated by magic bytes; sensitive documents are never public (`SENSITIVE_DOCUMENT`); `shared_with_customer` exposes them in the portal through signed links. Images get `thumb` (480 px) and `medium` (1080 px) WebP variants, pre-generated at upload and at startup, served with immutable caching and strong ETags (`?size=thumb|medium`).

## 16. Service requests (`routers/support.py`)

Ticket `{ticket_number, booking_id, category, priority, status, sla_due_at, internal_notes[], attachments[], rating}`. SLA hours by priority; an hourly job flags breaches (`service.sla_breach` audit + RM notification). Internal notes are ERP-only; customer replies and attachments flow through the portal; resolution notifies the customer who can rate (1–5) or reopen within the window.

## 17. Notifications (`routers/notifications.py`, `services/portal_notify.py`, `events.py`)

### 17.1 Event catalogue

Every domain event is published on the in-process bus (`events.bus`) and mapped to zero or more notification templates. Targets are **staff** (ERP bell, `notifications` collection) and **customer** (portal inbox + push token when present).

| Event | Staff targets | Customer | Template key |
|---|---|---|---|
| `booking.created` | sales user, project RMs, Finance role | yes (welcome + schedule) | `booking_created` |
| `demand.raised` | Finance, RM | yes (amount, due date, pay-by) | `demand_raised` |
| `payment.posted` / `payment.cleared` | Finance, RM | yes (receipt PDF link) | `payment_received` |
| `payment.bounced` | Finance, RM, sales user | yes (action required) | `cheque_bounced` |
| `payment.reversed` | Finance | retracts `payment_received` | — |
| `stage.marked` | project team | all active bookings in the tower (photos count) | `stage_update` |
| `stage.undone` | project team | retracts `stage_update` + any `demand_raised` of voided demands | — |
| `lead.assigned` / `followup.due` | assignee | — | `lead_followup` |
| `visit.booked` / `visit.reminder` / `visit.cancelled` | assignee, front desk | yes (ICS link) | `visit_*` |
| `ticket.created` / `ticket.replied` / `ticket.resolved` | assignee / support | yes | `ticket_*` |
| `notice.published` | — | targeted by project/tower/booking status | `notice` |
| `document.shared` | — | yes | `document_shared` |

### 17.2 Targeting and delivery

```
notify(event):
  tpl = CATALOGUE[event.type]; if not tpl: return
  staff = resolve_staff(tpl.roles, event.project_id, event.actor)        # role ∩ project scope, minus actor
  customers = resolve_customers(event)                                    # booking → customer (+ co-applicants if flag)
  for u in staff:     upsert notifications {user_id, type, entity, title, body, read:false, dedupe_key}
  for c in customers: upsert portal_notifications {customer_id, …, retractable_key}
  push(c) if c.push_tokens and quiet_hours_ok(c.tz)
```

- **Dedupe**: `dedupe_key = f"{type}:{entity_id}:{day}"` — a stage re-marked the same day does not spam.
- **Quiet hours**: customer pushes are deferred to 08:00 local when raised 21:00–08:00 (`settings.notify_quiet_hours`).
- **Retraction**: events that undo state (`stage.undone`, `payment.reversed`, `demand.voided`, `visit.cancelled`) call `retract(retractable_key)` which marks the earlier customer notification `withdrawn: true` (hidden in the portal, kept for audit) and inserts a short correction when `tpl.correction` exists.
- **Sweeps** (`jobs.notification_sweeps`, daily): follow-up reminders due today, visit reminders (T-1 day, T-2 h), demands overdue by 7/15/30 days (one per threshold), unread staff notifications older than 90 days archived.

### 17.3 Edge cases

| Situation | Behaviour |
|---|---|
| Customer has no portal account | customer notification stored; delivered on first login (inbox) |
| Co-applicant only | receives `demand_raised`/`payment_received` only if `notify_co_applicants` setting is on |
| Event for a cancelled booking | skipped except `booking.cancelled` itself |
| Template disabled in Settings → Notifications | nothing stored; event still audited |
| Push token invalid | token removed after 3 consecutive provider errors |
| Bulk stage mark (100 bookings) | one notification per booking, batched insert (`insert_many`), pushes queued |

## 18. Reports & PDFs (`routers/reports.py`, `routers/pdfs.py`, `services/pdf.py`)

### 18.1 Report contract

Every report is `GET /api/reports/{key}` with `format=json|csv|pdf` and the same filter set; the response is `{columns:[{key,label,type}], rows:[], totals:{}, …extras}` so the v2 UI (grouped navigation, KPI tiles, chart, sticky totals) needs no per-report code except `kpis()`/`chart` mappers. Unknown query params → `422 UNKNOWN_PARAM` (`_strict_params`). PDFs share `BrandedDoc` (cover strip, running header, zebra tables, ₹ formatting, FY in footer).

| Key | Inputs | Aggregation (`db.*`) | Outputs / extras |
|---|---|---|---|
| `collections` | from/to, project, mode, category, status, group_by day/week/month | payments (Cleared unless status) grouped by period; sums per bucket; GST on other charges | rows per period; `by_mode[]`; totals |
| `outstanding` | project, group_by customer/block/project | demands − allocations per booking → grouped; ageing buckets 0–30/31–60/61–90/90+ by due_date | `ageing[]`, `top_overdue[]` |
| `advances` | project | bookings where paid > raised per bucket | advance per bucket |
| `demand-vs-collection` | project | per installment seq: demanded vs collected | rows by milestone |
| `upcoming-dues` | project | plan installments whose trigger stage is next 1–2 stages or ON_DATE within 60 days | forecast rows |
| `inventory` | project, group_by project/block/flat_type/floor | flats grouped by status; value of available (list price) and sold (agreement); monthly bookings velocity | `velocity[]` |
| `cheques` | project, status Pending/Bounced/Cleared | payments by instrument type | rows |
| `cancellations` | from/to, project | bookings status Cancelled with refund/deduction | rows |
| `sales-leads` | from/to | leads funnel by stage, avg first-response hours, follow-ups overdue, web enquiries per project | `funnel[]`, `enquiries_per_project[]` |
| `roznamcha-range` | from/to | daily cash book totals | rows per day |
| `bank-receipts` | from/to | payments grouped by bank account | rows |
| `activity` | from/to | audit log by user/action | rows |
| `service-sla` | from/to, project | tickets by category: open/resolved, SLA met % (`resolved_at ≤ sla_due_at`; open & past due = breached), avg resolution hours, avg rating | `status_counts[]` |
| `construction-progress` | project | per tower × stage: status, planned/completed dates, variance days, photo count, demands and ₹ raised | `towers[]` (completion %, current stage) |

```
report(key, filters):
  validate filters (strict) → build $match → aggregate → rows (paise ints) → totals
  format=csv  : header from columns, money as rupees with 2 dp, UTF-8 BOM
  format=pdf  : BrandedDoc(title, company, landscape if cols > 7) + zebra table + totals row
  presets     : POST/PATCH/DELETE /api/reports/presets {report_key, name, filters} per user
```

### 18.2 Document PDFs (`routers/pdfs.py`)

| PDF | Source | Notes |
|---|---|---|
| Receipt | payment + booking + company | amount in words, mode/instrument, FY number, QR to portal receipt, signed link for portal |
| Demand letter | demand + plan + booking | due date, bucket split, bank details for Account, pay-by instructions |
| Customer statement | ledger rebuild | three ledgers, running balance, advances, pending cheques; date range |
| Allotment letter / Agreement summary | booking | flat snapshot, PLC lines, parking |
| Inventory availability chart | flats by block/floor | colour legend (Available/Hold/Booked/Sold/Blocked), landscape |
| Roznamcha day sheet | roznamcha | opening, receipts by mode, contra, closing, signatures |
| Technical documentation | this document | `GET /api/admin/docs/technical.pdf` |

Edge cases: zero-amount rows omitted; long customer names wrapped not truncated; Unicode ₹ rendered with the embedded font; PDFs are generated on demand and cached by `(entity_id, version)` for 10 minutes; portal access uses **signed links** (`/api/public/files/{token}`, 15 min, bound to customer).

## 19. Website + CMS (`routers/cms.py`, `routers/public.py`, `/app/site`, `pages/cms/*`)

### 19.1 Pages and toggles

| Public page | Data | CMS toggle (`site_settings` / project `website`) |
|---|---|---|
| Home | banners, featured projects, notices, testimonials | `show_home_notices`, `featured_project_ids` |
| Projects list / detail | published projects with cover, amenities, flat types, availability summary, construction gallery, brochure | `is_published`, `website.show_availability`, `website.show_progress`, `website.show_pricing` |
| Enquiry | form → lead | `enquiry_enabled`, `enquiry_sources` |
| Brochure | gated download → lead | `website.brochure_gate_enabled` |
| Site visit | availability + booking → visit | `website.site_visits.enabled`, slots, blackout dates |
| Notices | published notices by audience `public` | `notice.is_public` |
| Legal / contact | settings | — |

### 19.2 Public API hygiene

All public routes live under `/api/public/*`, are unauthenticated, read-only except the three write endpoints (enquiry, brochure, visit booking), and are **allow-listed field by field** (`public.serialize_project` etc.) — `tests/test_portal_leaks.py` asserts no field outside the allow-list (no costs, no customer data, no internal ids beyond `id`/`code`). Responses carry `Cache-Control: public, max-age=300` + `ETag`; write endpoints are rate-limited per IP (`infra.RateLimit`, 10/min) and require a honeypot field to be empty. SEO: server-rendered `<title>/<meta>` per project (`seo_title`, `seo_description`, `og_image`), `sitemap.xml` and `robots.txt` generated from published projects, canonical URLs, JSON-LD `RealEstateListing`.

### 19.3 Enquiry flow

```
POST /api/public/enquiry {name, phone, email?, project_id?, message, source="Website", utm?}
  validate phone (10 digits, Indian) ; honeypot empty ; rate limit ok
  dedupe: lead with same phone in last 30 days → append note + bump follow-up (no new lead)
  else create lead {status:"New", source_id: lead_source[WEBSITE], project_id, assigned_to: round_robin(project sales users)}
  notify assignee (lead.assigned) ; return {ok, reference}
```

### 19.4 Brochure lead gate

```
POST /api/public/projects/{id}/brochure {name, phone, email?, consent}
  if not website.brochure_gate_enabled → 302 to brochure URL (ungated)
  create/merge lead (as enquiry, source BROCHURE) ; increment website.brochure_download_count
  issue signed URL (15 min) for the brochure file ; return {url}
ERP: Leads → Brochure downloads tab lists {lead, project, at}; conversion rate = downloads with later visit/booking
```

### 19.5 Site-visit availability, booking, ICS, cancel

```
availability(project, date):
  cfg = project.website.site_visits ∪ settings.visit_settings  # slot_minutes, day_start, day_end, max_per_slot, blackout_dates, weekdays
  if date in blackout or weekday not allowed → []
  slots = [day_start + k*slot_minutes ...] ; booked = count visits (Scheduled) per slot
  return [{start, end, available: max_per_slot - booked}] filtering past slots (IST)
book(project, slot, lead/customer details):
  recheck availability inside find_one_and_update on a per-slot counter doc (atomic) → 409 SLOT_FULL
  create/merge lead ; create visit {status:"Scheduled", assignee: round_robin}
  email/portal: ICS (VEVENT with UID=visit.id, DTSTART/DTEND in Asia/Kolkata, LOCATION=project address, URL=cancel link signed 48 h)
cancel(token): visit → Cancelled ; slot counter −1 ; notifications retracted ; lead note appended
reschedule = cancel + book (same lead)
```

| Edge case | Behaviour |
|---|---|
| Slot exactly at day_end | excluded (end must be ≤ day_end) |
| Two bookings race for the last seat | atomic counter → second gets `409 SLOT_FULL` |
| Same phone books twice the same day | merged into one visit, slot kept |
| Visit in the past when cancelled | `409 VISIT_PAST` |
| Project unpublished after booking | visit stays; public availability returns `[]` |
| ICS opened on iOS/Android/Outlook | UID stable; METHOD:REQUEST; cancel sends METHOD:CANCEL with same UID |

## 20. Customer portal (Expo, `/app/mobile`)

### 20.1 Architecture

Expo Router (file-based routes under `app/`), TypeScript, React Query for data, `expo-secure-store` for tokens, compiled for **web** (exported under `/portal` and shipped inside the single-domain package, §24), iOS and Android. API client `src/api/client.ts` resolves the backend to the current origin on web (Expo preview host → `EXPO_PUBLIC_BACKEND_URL`) and talks **only** to `/api/portal/*`.

### 20.2 Auth isolation

```
POST /api/portal/auth/login {phone, password} → access (aud="portal", 15 min) + refresh (family per device)
  first login → must_change_password → forced change screen
  lockout after 5 failures (15 min) ; OTP-less by design (seeded demo passwords)
every /api/portal/* route: require_portal() → customer_id from token ; staff tokens (aud="erp") are rejected (401 WRONG_AUDIENCE) and vice-versa
data scope: customer_id ∈ {primary, co-applicant} for every query ; tests/test_portal_leaks.py proves no cross-customer or staff-field leakage
```

### 20.3 Screens

| Route | Content | API |
|---|---|---|
| `/login`, `/change-password` | phone + password, forced change | `portal/auth/*` |
| `/` Home | bookings cards (unit, next installment, due/advance pill), notices, quick actions | `portal/me`, `portal/bookings` |
| `/bookings/[id]` | schedule (plan with status per installment), three-ledger statement, receipts list → **PDF viewer** (in-app on native, new tab on web, signed link), documents shared with customer, construction progress with photos, parking | `portal/bookings/{id}`, `portal/receipts/{id}/pdf`, `portal/documents` |
| `/payments` | all receipts, filters by FY | `portal/payments` |
| `/service` · `/service/[id]` · `/service/new` | tickets, thread with attachments, rating on close | `portal/service-requests` |
| `/notices`, `/notifications` | targeted notices, inbox with withdrawn items hidden | `portal/notices`, `portal/notifications` |
| `/profile` | contact details, KYC status (masked), consent toggles, password | `portal/me` |

### 20.4 Offline cache, notifications, responsive shell

- **Offline**: React Query persisted to AsyncStorage (web: localStorage) with `maxAge` 24 h; last-known bookings, schedule and receipts render offline with an "offline — showing cached data" banner; mutations (new ticket, reply) are queued and replayed when back online.
- **Push**: Expo push tokens registered after login (`POST /api/portal/push-token`), removed on logout; web uses the in-app inbox only.
- **Responsive shell**: tab bar on phones, left rail ≥ 900 px on web/tablet; large-type and RTL-safe layouts; all amounts via the shared `inr()` formatter (lakh/crore).
- **PDF viewer**: native → `expo-file-system` download + `expo-sharing`/in-app viewer; web → signed URL opened in a new tab (15 min validity, bound to the customer).

| Edge case | Behaviour |
|---|---|
| Token expired while offline | cached screens still render; first online call refreshes; refresh family revoked → login |
| Customer with two bookings in different projects | home groups by project; notices targeted per project |
| Co-applicant logs in | sees the shared booking read-only; cannot raise tickets on the primary's behalf unless `co_applicant_can_raise` |
| Receipt reversed after being viewed | receipt card shows "Reversed" badge; PDF link disabled; notification retracted |
| Portal disabled for a customer (`portal_access: false`) | login 403 `PORTAL_DISABLED`; existing tokens revoked |

# Part IV — Quality, operations, roadmap

## 21. Testing & verification

{{include:tests.md}}

### 21.2 Independent audits & before/after metrics

| Area | Before | After | Evidence |
|---|---|---|---|
| Marketing `/` time to network-idle (1440) | 5.8 s | 1.4 s | `/app/memory/qa/audit.md` Phase 8B |
| Marketing console warnings | 4 (`No available adapters`) | 0 | same |
| `/contact` requests | 36 (Maps tiles) | 12 | same |
| ERP wizard step 1 click → visible | ~2.6 s | 224 ms | Phase 8B polish |
| `/erp/login` initial JS | main + 155 KB shell chunk | main only | route split |
| Construction thumbnail | 296 KB JPEG | 36 KB WebP | `?size=thumb` |
| Site bundle (gzip) | — | 141 KB main + 2–11 KB route chunks | build log |
| Backend suite | — | 200+ tests across 13 files; login rate limit means suites are run per file | §21.1 |

Load-test guidance: public endpoints are cacheable (ETag/60 s TTL) and survive 200 rps on a single worker in the preview; `/api/payments` is write-bound by Mongo round-trips (~60 ms p95 per posting). Recommendation for production: 2–4 Uvicorn workers (`WEB_CONCURRENCY`), Mongo replica set (enables true transactions), Redis for rate limits/idempotency when running more than one node.

## 22. Operations

| Topic | Procedure |
|---|---|
| Seed / reseed | Deterministic demo data is seeded when collections are empty (phase markers in `settings`). `POST /api/admin/reseed {"confirm":"RESEED"}` (Super Admin) wipes business collections, keeps users/roles/company, reseeds all phases and re-runs migrations; integrity is logged on the next startup. |
| Migrations | `migrate_phase7.py` maps legacy milestone demands to payment-plan installments (`installment_seq`, `trigger_stage_id`, type) by name; idempotent; `integrity.backfill_demand_installments` fills gaps at startup. |
| Integrity tooling | `GET /api/admin/integrity` (report), `POST /api/admin/integrity/repair` (void unearned unpaid, raise missing); nightly log. |
| Backup / restore | `GET /api/admin/export` (JSON of all collections) + object-storage bucket snapshot; restore with `mongorestore`/import script then `POST /api/admin/reconcile` to rebuild ledgers and counters. |
| Three domains | `www.` → site build; `erp.` → ERP build (`PUBLIC_URL=/` or `/erp`); `portal.` → Expo web export; one API behind `/api` on each host or a dedicated `api.` host (set `CORS_ORIGINS`, `REACT_APP_BACKEND_URL`, `EXPO_PUBLIC_API_URL`). |
| Monitoring | `/api/health` (version, db ping), `/api/ready` (readiness), `/api/metrics` (request counts, p50/p95 per route, errors), structured JSON logs with `request_id`. |
| Scaling | Stateless API; sticky sessions not required; move rate-limit/idempotency to Redis for multi-node; Mongo indexes listed in §4. |

### 22.1 Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | backend | database (never defaulted) |
| `JWT_SECRET`, `ACCESS_TOKEN_MINUTES` (15), `REFRESH_TOKEN_DAYS` (7) | backend | tokens |
| `FIELD_ENCRYPTION_KEY` | backend | Fernet key for PAN/Aadhaar/bank |
| `CORS_ORIGINS` | backend | comma-separated allow-list |
| `PORTAL_URL` | backend/frontend | legacy `/portal` redirect target (three-host recipe) |
| `PORTAL_PUBLIC_URL` | backend | overrides `portal_url`; blank → same-origin `<origin>/portal` (single-domain package, §24) |
| `CORS_ORIGINS` | backend | comma-separated allowed origins for production |
| `OBJECT_STORAGE_*` | backend | object storage credentials |
| `WEB_CONCURRENCY` | backend | Uvicorn workers |
| `REACT_APP_BACKEND_URL` | frontend, site | API base |
| `PREVIEW_MODE` (`production`/`dev`) | frontend | serve builds vs dev servers |
| `EXPO_PUBLIC_API_URL` | mobile | API base for the portal |

## 23. Known limitations & roadmap

- Reminders are in-app only — WhatsApp/SMS reminders for dues and site visits are the next integration (Twilio/WhatsApp Business).
- No interest/penalty computation on overdue demands (policy-driven; to be added as a configurable rule with its own ledger line).
- Single company per deployment; multi-tenant mode would add `company_id` scoping on auth and indexes (data model already carries `company_id`).
- Lead scoring and visit feedback (warmth score from brochure/visit/reply signals).
- Accounting exports (Tally/GST returns), e-sign for agreements, payment gateway for online collection.
- Rate limiting is per IP; corporate NATs may need per-user keys.

{{include:../part5.md}}

# Appendices

{{include:api_map.md}}

{{include:errors.md}}

## C. Settings keys

| Key | Collection | Meaning |
|---|---|---|
| `roles_version` | settings | bumps on role edits; invalidates permission caches |
| `seed_done`, `seed_phase2_done` … `seed_phase9_done` | settings | seed guards |
| `round_robin_assignment` | site_settings | lead assignment mode |
| `demand_due_days` | companies | default days from demand to due date (15) |
| `receipt_prefix`, `*_number_format` | companies | numbering patterns (`BK-{FY}-{SEQ}`, `{PREFIX}/{FY}/{SEQ}`, `CUST-…`, `DM-…`, `LD-…`, `SV-…`) |
| `website.site_visits.*`, `website.brochure_gate_enabled` | projects | per-project site behaviour |

{{include:enums.md}}

## E. Seeded demo data & credentials

| Item | Value |
|---|---|
| Company | Shree Ganesh Builders, Patna (FY Apr–Mar) |
| Projects | Shree Ganesh Heights (SGH: Towers A 45 %, B 18 %, C 0 %), Ganesh Green Villas (GGV: Villa Blocks P 100 %, V 67 %) |
| ERP users | `admin@kkt.in` (Super Admin), `projectadmin@kkt.in`, `sales@kkt.in`, `accounts@kkt.in`, `marketing@kkt.in`, `engineer@kkt.in`, `employee@kkt.in` — password `Kkt@12345` |
| Portal | 12 customers with portal accounts (see `/app/memory/test_credentials.md`) |
| Bookings | `BK-2526-0001` … `0008` with full ledgers; Tower B bookings carry stage-linked demands |
| Site visits | `SV-2627-0001` … `0010` (6 upcoming, 4 past) |
| Brochures | generated PDFs for both projects; gate enabled |

## F. Glossary

| Term | Meaning |
|---|---|
| CLP | Construction-linked plan — installments fall due as construction stages complete |
| PLC | Preferential location charge — premium for floor, facing, corner, view |
| RERA | Real Estate (Regulation and Development) Act registration; number shown on every project |
| Super built-up area | Carpet + walls + proportionate common areas; the area pricing is quoted on |
| Carpet area | Usable floor area within walls (RERA definition) |
| Roznamcha | Daily cash book — opening, receipts, payments, closing cash |
| Demand (letter) | Formal request for an installment with due date and bank details |
| Agreement value / buckets | Total consideration split into Account (banked) and Cash buckets per the agreement |
| Allotment letter | Document confirming the unit allotted to the buyer |
| Possession | Handover stage; final installment trigger |
| Refuge floor | Fire-safety floor without saleable units |
| Podium | Parking/amenity levels below the first residential floor |
| FY | Indian financial year (April–March), used in numbering `2526` = 2025–26 |
| Idempotency-Key | Client-supplied header making money/inventory POSTs safe to retry |
