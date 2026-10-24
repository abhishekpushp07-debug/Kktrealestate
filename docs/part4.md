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
| `PORTAL_URL` | backend/frontend | `/portal` redirect target, site "Customer login" |
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
