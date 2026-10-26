# KKT v2 — Architecture

> One backend, three front doors: **www.** (marketing website), **erp.** (staff), **my.** (customer portal: web + Android + iOS).
> Theme everywhere: royal deep navy `#0B1F3A` + gold `#C9A227` + ivory. Money is integer **paise** on every wire and in every table.

## 1. Stack (chosen, with reasons)

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| Language | **TypeScript 5.9 end-to-end**, Node 22 LTS | One type system shared by API, ERP, website and portal through `packages/contracts`; a schema change breaks the build in every surface instead of in production. Python/FastAPI (v1) forced hand-written clients and `dict` payloads. |
| API | **Fastify 5** + Zod type provider | Among the fastest Node HTTP frameworks (~2–3× Express, schema-compiled serialisation), first-class JSON-schema/OpenAPI, plugin encapsulation per module. Go would be faster per core but splits the type system from three TypeScript front ends. |
| Database | **PostgreSQL 16** via Drizzle ORM (SQL-first, no magic) | A two-bucket financial ledger needs real transactions, foreign keys, partial unique indexes (`(booking_id, installment_seq) WHERE status <> 'VOID'`), advisory locks and reporting SQL. MongoDB (v1) gave none of these on a standalone server and made every report an aggregation pipeline. |
| Cache / coordination | **Redis 7** | Rate limits, idempotency fast path, permission cache invalidation, public-API cache, token revocation lists, BullMQ job queues. In-process caches (v1) break the moment you run two instances. |
| Jobs | **BullMQ** workers (separate process) | Daily dues at 00:30 IST, nightly integrity, overdue notifications, thumbnail generation, visit-outcome nudges, PDF prewarm — durable, retried, observable, run once across N API instances. |
| ERP UI | **Vite + React 19 + Tailwind 4 + Radix** , TanStack Query/Table/Virtual, react-hook-form + Zod | Dense, data-first staff app; no SEO needed; smallest bundle and fastest HMR. |
| Website | **Next.js 15 (App Router, ISR 60 s)** | Server-rendered SEO (metadata, OpenGraph, JSON-LD, sitemap/robots), static CDN delivery, click-to-load embeds; settles < 2 s on 4G. |
| Portal | **Expo (expo-router) → web + iOS + Android** from one codebase | Native share sheet, camera, secure token storage; web build served at `my.`; sidebar on desktop widths, tab bar on phones. |
| PDFs | pdfkit in a **piscina worker-thread pool** | Branded A4 receipts, demand letters, allotment letters, statements, reports — no headless browser needed. Handlers record the layout (`BrandedPdf`) and the pool renders it off the event loop (streamed back for reports); DejaVu Sans is embedded so amounts print with ₹ and Indian grouping. |
| Media | sharp | 480 px / 1080 px variants at upload, immutable caching. |
| Auth | jose (JWT, EdDSA), argon2id, otplib TOTP | Separate token audiences `erp` and `portal`; rotating refresh-token families with reuse detection. |
| Infra | Docker Compose (single-VM quick start; production stack with PgBouncer, WAL archiving + nightly restore-tested backups, Prometheus/Grafana), Kubernetes manifests (`infra/k8s`), Caddy (3 domains), GitHub Actions CI + nightly load/browser runs, autocannon load tests | Reproducible from a laptop to a cloud VM or a cluster; no platform lock-in (docs/DEPLOY.md). |

## 2. Repository layout

```
claude-kkt/
  apps/
    api/        Fastify API + BullMQ workers (modules/, plugins/, jobs/, seed/, tests/)
    erp/        Staff application (Vite/React)
    web/        Marketing website (Next.js)
    portal/     Customer portal (Expo: web + iOS + Android)
  packages/
    domain/     PURE business logic, zero I/O, 100% unit-tested (money, dues, ledger, pricing, generation…)
    contracts/  Zod schemas, enums, permission codes, error codes — the single source of truth for every wire shape
    db/         Drizzle schema, SQL migrations, append-only triggers, migrate/reset scripts
  infra/        Caddyfile, Postgres tuning + roles, PgBouncer, backup script, Prometheus/Alertmanager/Grafana, Kubernetes manifests
  docs/         this file, DATA-MODEL.md, API-CONVENTIONS.md, SECURITY.md, PERFORMANCE.md, ACCEPTANCE.md
```

Dependency direction: `contracts` ← `domain` ← `db` ← `api` ← (`erp`, `web`, `portal` import only `contracts`). Nothing imports from an app.

## 3. Core design principles

1. **Everything is a selection.** Structure (room sizes, areas, flat types, stages, plans, charges, PLCs) lives once in master data. Blocks, flats and bookings are built by picking; the API rejects free-typed structure.
2. **Pure engines.** Every algorithm in the spec (flat generation, pricing, plan validation, auto-dues with telescoping rounding, two-bucket ledger, bucket cap, availability slots, FY numbering, Indian money words) lives in `packages/domain` as pure functions with exhaustive tests, and the API only orchestrates I/O around them. The ₹1 Cr worked example is a unit test *and* an acceptance test.
3. **Track the split, don't gate the order.** Cash and Account buckets each have agreed/raised/paid/due; dues rise with the plan, customers pay either bucket in any order; the only hard block is the bucket cap.
4. **Append, never rewrite money.** Payments, demands, ledger rows and receipts are never deleted — they are reversed/voided with a reason. Audit log is append-only at the database level (trigger raises on UPDATE/DELETE).
5. **Snapshots.** Flats snapshot rooms/areas/price from their flat type; bookings snapshot flat, rate and plan; towers snapshot their stage sequence. Master edits never silently change existing records. A tower's stage sequence may only change while it still fits every active plan assignment covering the tower **and** every ACTIVE booking's own plan snapshot (else 409 `PLAN_STAGES_MISSING` with `details.missing_stages` / `details.stranded_bookings`), so no installment is left that can never be raised.
6. **Two independent auth worlds.** Staff tokens carry `aud=erp`; customer tokens carry `aud=portal`; each surface has its own login, refresh family and session list. A staff token on a portal route is 401, never 403.
7. **Not-found, not forbidden, for scope.** Project-scoped users receive 404 for anything outside their projects so they cannot enumerate.
8. **Canonical forms on the wire.** Money = integer paise. Phone = 10-digit Indian canonical. PAN upper-case. Dates = ISO `YYYY-MM-DD` (business) or RFC 3339 UTC (events); IST only at the edges (slots, FY, daily jobs).
9. **Idempotent and concurrent by construction.** Every create accepts `Idempotency-Key`; payments require it. Every mutable row has `version`; PATCH requires `If-Match`. Hot spots use `SELECT … FOR UPDATE` / advisory locks and database uniqueness, not application checks alone.

## 4. Module map (apps/api/src/modules)

| Module | Owns | Key engines used |
|---|---|---|
| `auth` | staff login/refresh/MFA/sessions/password policy | — |
| `users`, `roles` | users, custom roles, project scopes | permissions registry |
| `masters` | 17 master kinds via one CRUD factory, usage checks, CSV import preview | canonical forms |
| `projects`, `blocks`, `flats`, `parking` | inventory, generation, grid, bulk ops | `flatGeneration`, `pricing` |
| `rateCards` | rate cards, PLC rules, apply/re-price | `pricing` |
| `customers` | customer 360, KYC encrypt/mask/reveal, co-applicants, portal access management, erasure | `kyc` |
| `leads` | pipeline, follow-ups, activities, round robin, dedupe, convert | — |
| `paymentPlans` | plan CRUD + validation, tower assignments, applicable plans + preview | `paymentPlan`, `dues.preview` |
| `construction` | tower stage status, jump-ahead, undo, photos | `dues` |
| `bookings` | wizard drafts, atomic create, revisions, cancel, complete, schedule | `ledger`, `dues` |
| `payments` | post/clear/bounce/reverse, receipts, cheques in hand, roznamcha, contra | `ledger.bucketCap` |
| `dues` | engine runner (on booking, on stage, daily, admin), integrity report + repair | `dues`, `integrity` |
| `documents` | uploads (signature-validated), variants, signed download links | — |
| `service` | tickets, threads (internal notes), SLA, reopen, rating | `sla` |
| `notifications` | staff & customer bells, retraction, sweep | — |
| `reports` | all reports with CSV/PDF, presets, dashboards per role, command-palette search | `money` |
| `pdf` | receipt, demand letter, allotment letter, statement, report PDFs | `money.words` |
| `cms` | site settings, banners, sections, testimonials, gallery, posts, pages, people, notices, FAQs, project website settings | — |
| `public` | read-only allow-listed website API (cached 60 s), enquiries, brochure gate, site-visit availability/booking/manage | `visits.availability`, `ics` |
| `visits` | ERP calendar/list, create/reschedule/cancel/complete/no-show, nudges | `visits.availability` |
| `portal` | customer auth + every customer-facing read/write, strict ownership | — |
| `admin` | backup export, reseed (guarded), recompute, erasure, integrity tools, job triggers | — |

Each module = `routes.ts` (Fastify plugin: schema + permission + handler), `service.ts` (transactions, calls domain), `queries.ts` (Drizzle). Cross-module calls go through services, never through another module's tables directly.

## 5. Security model (summary; details in SECURITY.md)

* Argon2id passwords; policy (min 10, mixed classes), history (last 5), forced change on first login; lockout 5 attempts / 15 min; login rate-limit per IP (Redis).
* Access JWT 15 min (EdDSA, `aud` ∈ {`erp`,`portal`}), refresh 7 days, rotated on every use; a reused refresh token revokes the whole family. Per-device session list with revoke; TOTP MFA (optional per user, enforceable for admin roles).
* Field encryption AES-256-GCM (PAN, Aadhaar, bank account) + HMAC-SHA256 keyed hash for duplicate checks; API returns masked values; `?reveal=true` needs `customer.kyc_view` and writes an audit row.
* Every endpoint declares a permission; the route registry test fails CI if any staff route lacks one. Project scope filters every query; outside scope → 404.
* Public API: allow-listed serializers (no ids of users/customers, no costs, no storage keys), `Cache-Control: public, max-age=60`, Redis cache, 300/min/IP reads, 5/min/IP forms with honeypot. Hold/Booked/Blocked collapse to "not available" (a HOLD whose `hold_until` has passed counts as available, as it does for the booking engine).
* Uploads: magic-byte validation, 15 MB, uuid keys, short-lived signed download links; KYC docs need `customer.kyc_view` and can't be shared with customers.
* Audit log: actor, time, action, entity, before/after, IP, request id; append-only trigger; portal actions logged with actor type `customer`.
* Helmet headers plus `Content-Security-Policy: default-src 'none'` on API responses (CSP + frame denial on the ERP/portal origins too), strict CORS per surface origin, no cookies (bearer tokens) so no CSRF surface, request body cap 2 MB, structured pino logs with request ids (and trace ids), `/health`, `/ready` (503 while draining), Prometheus metrics aggregated per container (`METRICS_PORT`, `METRICS_TOKEN`), OpenTelemetry tracing, a 5xx error webhook — docs/OBSERVABILITY.md.
* Least privilege in the database: migrations run as `kkt_owner`, the API and worker as `kkt_app` (DML only: no TRUNCATE/DDL, cannot disable triggers), so the append-only triggers hold against the application itself.

## 6. Performance and scale

Targets: 1,000 concurrent staff, list pages < 300 ms server time, ERP pages < 1.5 s, website < 2 s. Design for 5 lakh (500,000) concurrent *public/portal* users without redesign:

* **Stateless API** — nothing lives in process memory that matters; uploads go to S3-compatible object storage (`STORAGE_DRIVER=s3`); scale horizontally behind Caddy/Ingress/ALB (HPA in `infra/k8s`). Permission cache is Redis-backed with version bump invalidation. Replicas never migrate or seed: a one-shot migrate job does, before they start.
* **Hot paths are O(1) per request** — a payment appends one ledger row with running balances under a per-booking advisory lock (no full rebuild); booking summary columns are maintained transactionally and reconciled nightly. Booking detail returns pages, not 500 payments. `GET /bookings` sends compact rows by default (≈ 1 KB each: no snapshots, schedule or related lists — measured 24 KB for 25 rows vs 130 KB with full rows; `view=full` returns every field).
* **Right indexes for the query shapes** — every list endpoint's filter+sort combination has a matching compound index; keyset (cursor) pagination for large lists; `count` served from `pg_class` estimates when > 10k rows unless `exact=true`.
* **Caching tiers** — public API in Redis (60 s) and CDN (`s-maxage=60, stale-while-revalidate=300`); website pages via ISR; media immutable for a year; ERP uses ETag/If-None-Match on lists and 15 s stale-while-revalidate client cache.
* **Read/write split ready** — Drizzle client has `primary` and `replica` handles; reports and public reads use `replica` when `DATABASE_REPLICA_URL` is set.
* **Partitioning plan** — `audit_logs`, `ledger_entries`, `login_events`, `notifications` can be converted to monthly range partitions (UTC months on `created_at`, no row copy) by the opt-in scripts in `packages/db/partitions` (see its README; off by default, switch on at ~50 M rows); job PARTITION_MAINTENANCE keeps two months ahead when `PARTITIONING_ENABLED=true`.
* **Connection management** — pooled via PgBouncer (transaction mode, prepared statements kept with `max_prepared_statements`) in `docker-compose.prod.yml` and `infra/k8s`, per-connection statement/lock/idle-in-transaction timeouts (role defaults behind PgBouncer), Fastify under-pressure shedding (503 + `Retry-After`) instead of collapsing, plus a per-process in-flight cap (`API_MAX_INFLIGHT`, 256 in production) because an event-loop monitor cannot see requests queueing on the database pool. Sizing: docs/CAPACITY.md.
* **Per-request cost** — every query runs as a named prepared statement (the postgres.js driver would otherwise re-plan each one: a five-join list page spent 1.3 ms planning for 0.3 ms of execution); related data of a list page is fetched in one JSON-aggregating statement instead of one query per table; the API runs `API_WORKERS` processes per container (`node:cluster`), since Node serves ~1.5k simple authenticated requests/s per core.
* **Workers** separate from the API; heavy work (PDF, thumbnails, CSV > 10k rows, nightly integrity) never runs in a request. The worker process (`src/worker.ts`) builds the full app without listening, so every module's job handlers are registered; an unknown job name fails loudly. Every job gets 3 attempts with exponential backoff, each attempt is a `job_runs` row, and a final failure notifies the Super Admins (only the job's own company when its payload carries `company_id`, as exports and backups do) and `ERROR_WEBHOOK_URL`. At start the worker upserts the schedules and enqueues the boot jobs once per deploy (STARTUP_RECONCILIATION, NOTIFICATION_SWEEP, the dues catch-up when 00:30 IST was missed); the deploy lock is released again when enqueuing them fails, so the next start retries. "Run now" (`POST /admin/jobs/:name/run`) is deduplicated in Redis (BullMQ deduplication id `manual:<job>`): while a manual run is queued, running or waiting for a retry, further clicks are 409 JOB_ALREADY_RUNNING. Full CSV exports (`POST /exports`) and backups (`POST /admin/backup`) are jobs that stream into storage.
* Honest note: 5 lakh concurrent **staff** on one builder's ERP is not a real workload; 5 lakh concurrent **website/portal** readers is a CDN + Redis + read-replica problem, which this design solves. Load-test numbers for this build are in PERFORMANCE.md.

## 7. Phase plan → acceptance scenarios

| Phase | Deliverable | Proves scenarios |
|---|---|---|
| 0 | This plan, DATA-MODEL.md, API-CONVENTIONS.md | — |
| 1 | `contracts`, `domain` (all engines + unit tests incl. ₹1 Cr table), `db` (schema, migrations, triggers) | 4 (engine level), 7, 8 (engine level) |
| 2 | API core: auth (both audiences), RBAC + scope, audit, idempotency, versions, masters factory, users/roles | 1, 6 (idempotency), 10 (masking) |
| 3 | Inventory: projects, blocks, flat generation, grid, flats, parking, rate cards | 2 |
| 4 | Customers/KYC/portal access, leads | 10 |
| 5 | Payment plans, construction stages, bookings, payments, ledger, dues, integrity, receipts/letters/PDF, roznamcha | 3, 4, 5, 6, 7, 8, 9, 13 |
| 6 | Documents, service requests, notifications, reports, dashboards, search | 13 |
| 7 | CMS + public API, brochure gate, site visits | 11, 12 |
| 8 | Portal API + Expo app | 10, 14 |
| 9 | ERP app, website | 14 |
| 10 | Seed (zero integrity findings), acceptance suite, load test, docs | all |

Each phase ends with its tests green before the next starts.
