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

### 14.1 Worked example — ₹1 Cr agreement, ₹60 L account + ₹40 L cash, 10 equal installments

| # | Installment (10 %) | Cumulative | Account demand | Cash demand | Total demand | Running due (if unpaid) |
|---|---|---|---|---|---|---|
| 1 | On booking | 10 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹10,00,000 |
| 2 | Foundation | 20 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹20,00,000 |
| 3 | Plinth | 30 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹30,00,000 |
| 4 | 1st slab | 40 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹40,00,000 |
| 5 | 3rd slab | 50 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹50,00,000 |
| 6 | Top slab | 60 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹60,00,000 |
| 7 | Brickwork | 70 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹70,00,000 |
| 8 | Plaster | 80 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹80,00,000 |
| 9 | Flooring | 90 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹90,00,000 |
| 10 | Possession | 100 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹1,00,00,000 |

With a 33.33 % / 33.33 % / 33.34 % plan the engine would demand ₹33,33,000 / ₹33,33,000 / ₹33,34,000 (cumulative rounding), never ₹33,33,333.33. If the buyer pays ₹15 L cash after installment 1, the ledger shows cash demanded ₹4 L, received ₹15 L, **advance ₹11 L**, and the next cash demands are satisfied from the advance automatically; the cash bucket caps at ₹40 L.

**Roznamcha** (`routers/roznamcha.py`): daily cash book — opening cash = previous closing; receipts (CASH mode, Cleared, by payment_date) in; cash deposits to bank and expenses out as **contra** entries; closing = opening + in − out; printable per day with denominations optional. **Recompute/reconcile** (`admin.reconcile_all`) rebuilds every ledger and flat/booking counters.

## 15. Documents & media (`routers/documents.py`, `services/thumbs.py`)

Documents: `{entity_type, entity_id, document_type_id, title, file_name, mime, size, storage_key, is_sensitive, shared_with_customer}`; upload validated by magic bytes; sensitive documents are never public (`SENSITIVE_DOCUMENT`); `shared_with_customer` exposes them in the portal through signed links. Images get `thumb` (480 px) and `medium` (1080 px) WebP variants, pre-generated at upload and at startup, served with immutable caching and strong ETags (`?size=thumb|medium`).

## 16. Service requests (`routers/support.py`)

Ticket `{ticket_number, booking_id, category, priority, status, sla_due_at, internal_notes[], attachments[], rating}`. SLA hours by priority; an hourly job flags breaches (`service.sla_breach` audit + RM notification). Internal notes are ERP-only; customer replies and attachments flow through the portal; resolution notifies the customer who can rate (1–5) or reopen within the window.

## 17. Notifications (`routers/notifications.py`, `services/portal_notify.py`)

| Event | ERP targets | Portal (customer) |
|---|---|---|
| booking.create | RM, Project Admin | "Booking confirmed" |
| demand.raised / overdue | RM | "Installment due", "Payment overdue" |
| payment.create / cleared / bounced | Accounts | "Receipt issued", "Cheque cleared/bounced" |
| stage.completed / undone | — | "Construction update" (withdrawn on undo) |
| lead.brochure, visit.booked/cancelled/nudge | Assignee + Sales | — |
| service.* | Assignee | "Ticket updated" |
| integrity.failed | Super Admin | — |

Retraction: when a demand is voided or a stage undone, unread notifications referencing it are deleted; read ones get `withdrawn=true` and a "(withdrawn)" suffix; the portal hides withdrawn items and excludes them from the unread count. A startup sweep normalises legacy types and removes orphans.

## 18. Reports & PDFs (`routers/reports.py`, `routers/pdfs.py`, `services/pdf.py`)

| Report | Inputs | Logic | Output |
|---|---|---|---|
| Collections | date range, project, mode | Σ Cleared payments by day/mode/bucket | table + CSV |
| Outstanding & Ageing | as-of date | open demand balances bucketed 0–30/31–60/61–90/90+ | table |
| Advances | project | received beyond demanded per bucket | table |
| Cheques | status | Pending/Bounced instruments with ages | table |
| Cancellations & Refunds | range | cancellation records, deductions, refunds | table |
| Inventory | project/block | unit counts by status/type, value | table |
| Activity | range | audit log aggregation by actor/action | table |
| Sales velocity, Demand vs collection, Customer statement, Tower progress, Upcoming dues forecast | various | aggregations over bookings/demands/payments/stages | table |

PDF templates (`BrandedDoc`): receipt (number, words, mode, bank, bucket), demand letter (installment, % and amounts, due date, bank details), allotment letter, customer statement (ledger table), report exports and brochures.

## 19. Website + CMS (`routers/cms.py`, `routers/public.py`, `/app/site`)

- **CMS entities**: site settings (brand, contacts, offices, trust stats, social, round-robin), hero banners, testimonials, blog posts, gallery, legal pages, per-project `website` sub-document (slug, publish flag, hero images, highlights, FAQs, show prices, brochure, visit settings).
- **Public API hygiene**: whitelisted serializers, ETag/304, `Cache-Control`, no internal ids beyond slugs, prices only when `show_prices`.
- **SEO**: `/sitemap.xml`, `/robots.txt`, per-page meta + Open Graph via react-helmet-async, JSON-LD (Organization, RealEstateListing, FAQPage).
- **Enquiry flow**: `POST /public/enquiries` — 5/min/IP, honeypot `website`, consent, UTM captured, lead created (Website) with round-robin assignment and RM notification.
- **Performance**: click-to-load facades for YouTube/Vimeo/Matterport/Maps, responsive WebP `srcset` with blur-up and hero preload, route-level code splitting with hover prefetch, font preconnect/`display=swap`, zero third-party JS before interaction.

### 19.1 Brochure lead gate (`routers/visits.py`)

```seq
Visitor -> Site : clicks "Download brochure" (card / hero / section)
Site -> Site : modal; remembered visitor (localStorage) skips the form
Site -> API : POST /public/brochure-requests {slug, name, phone, email?, consent, utm, honeypot}
API -> API : rate limit 5/min/IP; honeypot → 200 no-op; project must have brochure & gate enabled
API -> DB : find open lead (phone+project) else create lead source=Brochure (round-robin)
API -> DB : push activity brochure_downloaded; notify assignee
API -> Site : {reference, download_url = /api/public/brochure/<signed 15-min token>}
Site -> API : GET download_url (auto-start)
API -> DB : nonce seen? no → count once (brochure_download_count++, brochure_downloads row)
API -> Visitor : PDF, Content-Disposition: attachment
```

### 19.2 Site-visit scheduler

Per-project settings `website.site_visits {enabled, visit_days[0–6], start_time, end_time, slot_minutes 30|60, capacity_per_slot, min_lead_hours, max_days_ahead, blackout_dates[], site_office_address, maps_url, instructions}`.

```
availability(project, from, to):                       # IST; cached 60 s per project+range
  for d in from..to:
    if not enabled or d.weekday ∉ visit_days or d ∈ blackout or d > today + max_days_ahead: slots = []
    else slots = [start, start+slot … < end] where slot_start ≥ now_IST + min_lead_hours
    booked[d, slot] = count(site_visits where status ≠ Cancelled)
    emit {date d, slots with available = capacity − booked > 0}

book(body):                                           # 5/min/IP, honeypot, consent
  slot must be in availability (SLOT_UNAVAILABLE); count < capacity (SLOT_FULL)
  lead = upsert (phone+project) source=Site Visit
  insert visit SV-{FY}-{SEQ} status=Confirmed; recount → if > capacity: delete & 409 SLOT_FULL   # atomic check-then-verify
  lead New/Contacted → Site Visit Scheduled; activity site_visit_booked; notify assignee + Sales role
  return {visit_number, date, slot, address, ics_url (signed), manage_url (signed)}
```

ICS: `VCALENDAR` with `VTIMEZONE Asia/Kolkata`, `DTSTART;TZID=Asia/Kolkata`, `LOCATION`, `URL` (maps), 1-hour `VALARM`. **Cancel** (visitor via signed link or ERP with reason) → Cancelled, activity; if it was the lead's only upcoming visit and the lead is at Site Visit Scheduled, the lead reverts to its previous stage (`stage_reverted`). **Reschedule** re-checks capacity excluding itself, status `Rescheduled` (counts as confirmed). **Complete** → lead Site Visit Done; **No-show** → activity. ERP module: calendar (day/week, slot rows × projects, chips with RM), list with filters and CSV, dashboard "Today's site visits", nudge job.

## 20. Customer portal (Expo, `/app/mobile`)

Architecture: Expo Router app compiled for web, iOS and Android against `/api/portal/*` only; separate auth (`aud=portal`, own refresh family, forced password change); screens — login, home (bookings with next installment), booking detail (schedule, ledger, receipts PDF viewer, documents, construction progress with notes and visible photos, payment plan), payments, service requests (create, reply, attach, rate), notifications (unread badge, read-all, withdrawn hidden), profile. Offline: last responses cached; responsive shell adapts to tablet/web widths. Public contracts are additive only; `test_portal_leaks.py` guards the payloads.
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
