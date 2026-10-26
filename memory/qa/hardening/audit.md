# KKT — Phase B hardening audit (25 Oct 2026)

Scope: existing backend, database, APIs and canonical forms. No new features. Regression anchor BK-2526-0001: **22 ledger rows, total due ₹0** (asserted in `tests/test_hardening.py::test_regression_anchor_bk_2526_0001`).

## B1 Inventory

| Item | Count | Source |
|---|---|---|
| API routes (`/api/openapi.json`) | **399** (GET 193 · POST 156 · PATCH 40 · DELETE 9 · PUT 1) | OpenAPI walk |
| Write routes (POST/PATCH/PUT) | 197 | OpenAPI walk |
| Public routes (`/api/public/*`) | 24 · Portal routes 38 | OpenAPI walk |
| Mongo collections referenced in code | 70 | static scan of `db.<coll>.<op>(` |
| Query shapes under explain() audit | 41 (`tests/test_index_audit.py`) | explain plans |
| ERP forms audited | 12 (`forms_fields.md`) | static scan of JSX |

Collections + primary query shapes: see `indexes.json` (every index incl. unique/partial/TTL per collection) and `tests/test_index_audit.py` (query shapes). Permission map per route: `backend/security/permission_matrix.json` (405 method+path entries, derived from the dependency graph and asserted at runtime).

## B2 API contract & safety — before / after

| Check | Before | After |
|---|---|---|
| Error envelope | `{detail, code, request_id}` only; 405/404-unknown-route from Starlette bypassed handler (`{"detail":"Method Not Allowed"}`) | Every error (ApiError, HTTPException, Starlette 404/405, 422 validation, 413, 504 timeout, 500) carries `error:{code,message,details,request_id}` **and** keeps the legacy top-level `detail/code` so existing clients/tests keep working. `errMsg/errCode/errFields` in `lib/api.js` read the envelope. |
| Fuzz every write route | not tested | `tests/test_fuzz_walker.py`: 197 write routes × 4 hostile payloads (empty, non-JSON, negative/huge/10k-char/unknown fields/path-traversal ids, wrong types) → **0 × 5xx** |
| Permission matrix | implicit | `tests/test_permission_matrix.py`: every non-public route has a guard (3 intentional exceptions whitelisted: MFA step, `/portal/config`, 15-min signed backup link); anonymous and portal tokens rejected on all 300+ ERP routes; Sales/Accounts/Employee get 403 on every GET whose permission they lack. 7/7 pass. |
| Response models / leak scan | portal scan only | `test_public_api_leak_scan` extends forbidden-key scan to `/api/public/site`, `/api/public/projects`, `/api/portal/config`. **Not done:** converting all core routes to explicit Pydantic `response_model`s (see "Not done"). |
| Lists | cursor mode + `id` tiebreaker, `page_size ≤ 200`, `limit ≤ 100`, sort whitelist, ETag middleware already present | unchanged (verified) |
| Idempotency | middleware + 24 h TTL present; payments checked **after** body validation → 422 masked the missing key | `require_idempotency_key` dependency → **428 IDEMPOTENCY_KEY_REQUIRED** before validation; replay test proves same id + `Idempotent-Replayed` + single row |
| Public rate limits | Mongo sliding window on enquiry/brochure/visits/portal login | + `/api/public/verify` 30/min per IP. Limits: public reads 300/min/IP, enquiry/brochure/visit writes 10/min/IP, logins 10/60 s per IP+identity, verify 30/min. |
| Body size / timeout / headers / gzip | 2 MB body limit, nosniff, X-Frame-Options DENY, HSTS, Referrer-Policy, Permissions-Policy, gzip ≥1 KB | + `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on API responses, + request timeout middleware (`REQUEST_TIMEOUT_S`, default 60 s → 504 envelope) |
| Structured access log | JSON log with request_id/user/path/ms, slow threshold 300 ms | slow threshold set to **500 ms** as specified |

## B3 Database canonical truth — before / after

| Check | Before | After |
|---|---|---|
| JSON-schema validators | none | `services/validators.py`: `$jsonSchema` (validationLevel **moderate**) on projects, blocks, flats, customers, bookings, payments, demands, ledger_entries, catalogue_items, users, audit_logs — required fields, integer-paise money, status enums. Applied via `collMod`/`create_collection` from the background startup task (lease-guarded, 0.01 s). Proven by `test_mongo_validators_reject_bad_docs` (float paise, bad enum → error 121). |
| Business-key unique indexes | booking_number, receipt_number, flat (block+number), catalogue (type+code), user email | + **demand_number** unique, + customers **(company_id, phone) unique partial `is_active:true`** |
| TTL indexes | idempotency_keys, rate_limits, cache, backups, brochure_tokens | + refresh_tokens & portal_refresh_tokens via new Date field `expires_dt` (ISO `expires_at` kept for app logic; pre-existing rows without `expires_dt` are not auto-expired) |
| explain() audit | 41 shapes | 41 shapes, **0 COLLSCAN** |
| Integrity checker | demand/installment/summary checks | + referential (orphan block/flat/booking→flat/customer, payment/demand→booking), flat status ↔ live booking, double-booked flat, per-booking **bucket caps**, summary paid vs cleared payments, last ledger due vs summary, counters vs max numbers. `/api/admin/integrity-report` → **ok:true, 0 findings** on seed data; nightly job reuses it. |
| Write concern | default | `db` handle uses `w=majority, j=true` (env `MONGO_WRITE_MAJORITY=1`), `retryWrites=True` already; pool 5–50; serverSelection 5 s; reads primary, derived read models on `db_ro` (secondaryPreferred) |
| Money float scan | — | 0 doubles in money fields across bookings/payments/demands/ledger/flats; validators now reject them |
| Soft-delete filter | `is_active`/`deleted_at` applied per router | **Not centralised** into a repository helper (see "Not done"); validators + partial unique index reduce risk |

## B4 Canonical forms — field audit (static)

See `forms_fields.md`. Current share of selection/derived fields: Customer 53 %, Booking wizard 44 %, Payment 45 %, Project setup 34 %, Block/flat 33 %, Service 67 %, Users 33 %. Dependent chains already enforced: project→tower→flat (Available only), state→city→locality, payment mode→instrument fields, tower→plans. **Not done in this phase:** converting remaining free-text finite-domain fields to catalogue selects and a single shared `CatalogueSelect` primitive (the brief's ≥90 % target). This is multi-day UI work and would change forms users rely on — flagged for confirmation.

## B5 Test harness

- `tests/conftest.py`: one admin login per session (`session_token`) → no more 10/60 s rate-limit flakes for new tests; old tests still log in individually (migration to the fixture is incremental).
- New: `test_fuzz_walker.py` (2), `test_permission_matrix.py` (7), `test_hardening.py` (8: idempotency replay, 428, 409, validators, anchor, integrity, public leak scan, 405 envelope).
- Full-suite result (after reseed, fuzz walker run separately): **292 passed / 20 failed, 0 rate-limit (429) failures** (down from 29 × 429 before the shared login cache). All 20 remaining failures are pre-existing data/shape drift in older test files (CMS seed counts, weekend visit-slot rules, Tower-B 18 % fixture, reports count 11 vs 14, documents/portal list shapes, MFA/refresh flows that mutate shared users) — none touch the hardened paths, and the 5 regressions the hardening itself surfaced (validator enums `Voided`/`Allotted`, rupee-float `flats.price`, 400→428) were fixed in this phase.

## B4 follow-up run (same day)
- Testing agent iteration 18: full ERP happy path PASS (customer with derived pincode → wizard with derived agreement/−discount → payment → receipt print), screenshots in `forms/`.
- Full suite after reseed (fuzz run separately, 2/2): **300 passed / 13 failed / 3 errors of 316**. Remaining failures are all harness/data interplay, not product regressions: (a) per-IP login limit 10/60 s still trips in modules exempted from the token cache (MFA/refresh/session-revocation tests need real logins) — 7 of the failures; (b) weekend-dependent visit-slot rules and unseeded brochure in `test_phase_9`; (c) `test_phase_2` milestone complete+undo leaves Tower-B stage counts drifted for `test_phase_7` when both run in the same session; (d) `test_phase_5` portal/documents list-shape assertions written against an older response shape. One cleanup incident during this phase (QA customer deleted while a QA booking referenced it) was caught by the new integrity checker and repaired; the session cleanup now only removes customers with zero bookings.

- **B4 canonical forms conversion** (≥90 % selection fields, single `CatalogueSelect`, field-level 422 mapping on every form, 409 dialog everywhere): audited only (`forms_fields.md`); the UI rewrite would change forms users rely on → needs your go-ahead.
- **Pydantic response models on every core route**: not done; leak-scan tests cover public/portal surfaces instead.
- **Soft-delete repository helper**: filters remain per-router (audited, no gaps found in masters/catalogues).
- **`flats.price` is a rupee float** (legacy list price, not a ledger amount). Validator currently allows it; converting to paise touches flat generation, rate cards and the booking wizard — flagged, not changed.
- Old test files still log in individually; the session cache in `conftest.py` makes them share tokens transparently, but modules that exercise MFA/refresh/session revocation are exempted and still need ~6 real logins (10/60 s per IP).


## Phase B — completion run (2026-10-26)
- Price: `flats.price` removed everywhere (seed, generation, rate cards, bulk-price, PATCH, imports, validators); only `price_paise` int stored. Snapshot proof `price_snapshot_before.json` (V1, V4, P2, A-102, A-103, B-701): paise == round(rupee breakup × 100) for all six; public `starting_price` still rupees.
- Response models: 9 core entities × (list, detail) via `models_out.py` + `response_model_exclude_unset=True`. Denied at the edge: password_hash, mfa_secret, mfa_backup_codes, refresh_tokens, *_enc, otp/token hashes.
- 422 mapping: `FieldError` under amount (payment), payment_plan_id (wizard), plus customer/project/block/lead/catalogue forms. Screenshots 05/06 in `forms/`.
- Harness fixes: bypass header limited to login/write/public(300) buckets; brochure seeded; Tower-C milestones; Active-booking pick; availability wait loop.

### Final proof (2026-10-26)
- Full backend suite after reseed, twice back-to-back (xdist -n 2, local backend): **run 1 = 344 passed / 0 failed (1m45) · run 2 = 344 passed / 0 failed (2m59)** — `full_suite_run1.log`, `full_suite_run2.log`.
- Harness isolation: suite targets the local backend (preview edge NATs egress IPs per connection and serves Cloudflare challenge 429s under load; `KKT_TEST_EXTERNAL=1` restores the public URL); one shared keep-alive pool for every requests/httpx call (pod has ~1k ephemeral ports); per-IP public guards (brochure/enquiry/visit 5/60 s) are *not* bypassed — tests wait for a fresh window instead; login/write/public guards bypass only with the process-env token (absent from `.env`).
- Root causes fixed in product/seed code (not just tests): `admin/reseed` never re-ran the Phase-9 visit/brochure seed (flag kept) → fixed + brochure/price backfill run on reseed; `seed_phase5` allotment-document call used a stale signature → shared docs now seeded; seeds wrote rupee `price` → paise.
- Anchor after reseed: BK-2526-0001 = 22 ledger rows, due ₹0. Integrity 0 findings. Index audit + price truth: 44 passed, 0 COLLSCAN. Clean-room no-.env `CI=true yarn build` exit 0. Preview `/`, `/erp/login`, `/portal/`, `/api/health` → 200; local health 2 ms; worker RSS 25 MB.
