# Changelog

All notable changes to KKT v2. The API follows docs/VERSIONING.md: additive within `/api/v1`, deprecations announced here with their
sunset date. Dates are IST.

## [Unreleased] — phase 7 tracks, reviews and integration (v3 audit fixes)

Reports: docs/hardening/phase7-{money,security,platform,domain,frontend,ops}.md, their `phase7-review-*.md` and
docs/hardening/phase7-integrate.md (the 40-finding table).

### Breaking (deliberate, recorded per docs/VERSIONING.md "Deliberate breaks")

- **`refresh_token` is optional in `TokenPair`** (staff and portal login / refresh responses, contract C1): it is left out when the
  request asked for cookie mode (`X-KKT-Session: cookie`). Body-mode clients (native portal, API clients) still receive it.
- **`POST /customers/:id/erase` answers `AdminCustomerEraseResponse`** (it is now a deprecated alias of `POST /admin/customers/:id/erase`,
  sunset 2027-04-24) instead of the customer row.
- A refresh-token family has an absolute lifetime (`REFRESH_ABSOLUTE_TTL_DAYS`, 30): past it refresh answers 401 `SESSION_EXPIRED`.

### Added

- Cookie sessions (C1), tenant resolution on sign-in and on the public site (C4), public caching with ETag/304 (C5), client error
  reporting `POST /api/v1/client-errors` (C2), worker health on `:9465/health` (C8), key rings `JWT_SIGNING_KEYS` / `LINK_SIGNING_KEYS` /
  `HASH_KEYS` (C9).
- Ledger as a book of record (C7): `?epoch=`, `epoch`, `current_epoch`, the six `summary` totals, `epoch_totals`,
  `GET /bookings/:id/ledger/rebuilds`; ledger event `DEMAND_VOIDED`; 409 `BOOKING_CLOSED` on a stage undo that would rewrite a completed
  booking. The **portal ledger** now reads the current epoch only and carries the same `summary`.
- `GET /masters/{path}/import-template`, 422 `IMPORT_UNKNOWN_COLUMNS`, 409 `FLAT_HAS_BOOKING_HISTORY`, `flats_preserved`, SLA pause
  (`sla_paused_at`, `sla_paused_seconds`), `.ics` SEQUENCE / METHOD:CANCEL, `GET /public/sitemap`, opaque visitor tokens.
- List `meta {total_is_estimate, total_included}`, 400 `INVALID_CURSOR`, 409 `IDEMPOTENT_OUTCOME_UNKNOWN`, `DocumentRow.renditions`,
  `GET /admin/audit/verify`, jobs `AUDIT_SEAL`, `DOCUMENT_RENDITIONS`, `STORAGE_SWEEP`.
- `PortalProfileResponse.version` (ETag `"v<n>"`; send it back as If-Match).
- Integrity finding type `CHECK_FAILED` (a booking the engine cannot check is reported, the run goes on; counts gain `CHECK_FAILED`).
- An idempotent replay whose stored response was withdrawn by a DPDP erasure answers 410 `GONE` (`details.original_status`).

### Changed

- CORS grants credentials to the ERP / website / portal origins and allows `X-KKT-Session` and `X-KKT-Company`.
- Health probes are never rate-limited; the website server's own calls (internal token without a visitor IP) have their own budget
  `INTERNAL_RATE_LIMIT_PER_MIN` (6000/min per route group).
- Erasure also withdraws QUEUED / RUNNING exports (the job never publishes a withdrawn one) and waits for a rendition run on the
  customer's documents; the cancellations report reads the refund / deduction columns; admin recompute records the acting admin in
  `ledger_rebuilds`.
- LEDGER_REBUILD and REENCRYPT_FIELDS checkpoint per batch and resume; BACKUP_EXPORT stops on its signal (one snapshot, restarts).
- Swagger UI (`/api/v1/docs/json`) serves the same enriched document as `/api/v1/openapi.json`.

### Database

- Migration 0006 money guards (append-only ledger and rebuilds, frozen payment financial columns). Online file 0005 §7–8:
  `documents_storage_key_idx` + rendition-key indexes, and the SLA pause backfill for tickets already AWAITING_CUSTOMER.

### Configuration

- New: `REFRESH_ABSOLUTE_TTL_DAYS`, `READ_RATE_LIMIT_PER_MIN`, `EXPORT_RATE_LIMIT_PER_MIN`, `INTERNAL_RATE_LIMIT_PER_MIN`, the C9 rings
  (+ `_FILE`), `WORKER_HEALTH_PORT`, `WORKER_DRAIN_TIMEOUT_MS`, `WORKER_CRITICAL_CONCURRENCY`, `WORKER_HEAVY_CONCURRENCY`,
  `UV_THREADPOOL_SIZE`, `IMAGE_CONCURRENCY`, `IDEMPOTENCY_LEASE_SECONDS`, `CLIENT_ERROR_RATE_LIMIT_PER_MIN`,
  `HEALTH_WORKER_STALE_SECONDS`, `WEB_REVALIDATE_URL`, `WEB_REVALIDATE_TOKEN` (docs/DEPLOY.md).

## [Unreleased] — phase 7 foundation (v3 audit fixes)

Report: docs/hardening/phase7-foundation.md.

### Breaking (deliberate, recorded per docs/VERSIONING.md "Deliberate breaks")

- **Versions are required on every write of a versioned resource (contract C6).** Besides staff PATCH (already required), every
  state-change POST that used to fall back to last-writer-wins (deactivate/activate of masters, projects, blocks, customers, users and
  roles; site-visit cancel/complete/no-show/outcome; staff replies on service requests) and every DELETE of a versioned resource
  (booking drafts, plan assignments, co-applicants, CMS rows, stage photos, notices, report presets, documents) now answers
  **428 `VERSION_REQUIRED`** without `If-Match`, `version` or `expected_version`. The full route list is in the foundation report.
- `VERSION_REQUIRED` moved from **400 to 428** (Precondition Required); `details.issues[0].path` stays `"version"`.
- `page` of offset lists is capped at **1000** (400 VALIDATION_ERROR naming cursor mode beyond it).
- A PERCENT PLC value with more than 2 decimals, or a fractional FIXED / per-sq-ft / floor-rise value, is **400** at input (it used to
  be stored and then fail every price with 500).
- `BucketCapDetailsSchema` (contracts) now matches the wire: `{bucket: CASH|ACCOUNT, agreed_paise, paid_paise, amount_paise,
headroom_paise}` (the API never sent the old `received_paise` / `attempted_paise`).
- VALIDATION_ERROR details have one shape: `details.issues[{path, message, code}]`; the handler-raised `{field}` details are gone.

### Added

- `ETag: "v<version>"` on single versioned resources; `If-Match: "v<n>"` (and `W/"v<n>"`, legacy `"<n>"`) and body
  `expected_version` are accepted by every versioned write; `VERSION_CONFLICT` details carry `current_version`.
- Rows now carry `version`: demands, other-charge lines (`line_version` on `POST …/other-charges/:lineId/demand`), booking drafts,
  report presets. Ledger events `DEMAND_VOIDED`, `LEDGER_RESTATED` (used by the money track).
- Error codes `CONSTRAINT_VIOLATION` (422), `INVALID_AMOUNT` (422), `COMPANY_REQUIRED` (400); database CHECK / FK / NOT NULL /
  unique / class-22 errors map to 422 / 409 IN_USE / 409 DUPLICATE / 400 instead of 500; domain MoneyError → 422 INVALID_AMOUNT.
- `BUSINESS_RULES` / `RuleId` registry in `@kkt/contracts` (`details.rule` of 422 BUSINESS_RULE).
- Tenant resolution `apps/api/src/lib/tenant.ts` (contract C4): principal → `x-kkt-company` slug → Host in `companies.hosts` → the only
  company → 400 COMPANY_REQUIRED.

### Database (migration 0005, online)

- Migration runner: checksummed hand-written SQL (`drizzle.kkt_schema_files`) — unchanged trigger files no longer re-lock every table
  on every deploy; online files (`src/sql/online/*.sql`) run statement by statement outside a transaction with recovery of INVALID
  indexes; waiting replicas poll the migration lock. Rules for new migrations: docs/DATA-MODEL.md §J.
- 65 foreign-key indexes, trigram indexes on demand numbers / installment names / cheque numbers, all built CONCURRENTLY.
- `version` on demands, other-charge lines, rate-card rates and PLC rules, plan installments, enquiries, lead follow-ups (bumped by a
  trigger on every UPDATE).
- Ledger epochs (`bookings.ledger_epoch`, `ledger_entries.epoch`, UNIQUE (booking_id, epoch, seq)), `ledger_rebuilds`.
- `bookings.cancellation_refund_paise` / `cancellation_deduction_paise` (backfilled); `companies.slug` (backfilled, unique) and
  `companies.hosts`; `users.totp_last_step`; `refresh_tokens.family_started_at` (backfilled); `audit_seals` (append-only hash chain);
  `service_requests.sla_paused_at` / `sla_paused_seconds`; `site_visits.ics_sequence`; `idempotency_keys.committed_at` /
  `lease_expires_at`; `job_runs.heartbeat_at` / `checkpoint`; `storage_pending_objects`, `storage_deletions`.
- New companies default to `force_mfa_for_admins = true` (existing rows unchanged).
- The application role `kkt_app` loses UPDATE/DELETE/TRUNCATE on ledger_entries, audit_logs, audit_seals, ledger_rebuilds and
  DELETE/TRUNCATE on payments and demands. **Upgrade note:** run `infra/postgres/init/01-roles.sql` again (idempotent) or let the
  migration apply `0002_privileges.sql`.
- bigint values beyond ±(2^53 − 1) are refused with `BigIntPrecisionError` instead of being rounded silently.

## [Unreleased] — hardening round (phase 5)

The round closed the gaps of the v2 80-factor audit (docs/AUDIT-80-FACTORS-V2.md) in five tracks, each adversarially reviewed, then
an integration stage and a verify stage. Summary with links to every report: docs/hardening/STATUS-after-phase5.md.

### Highlights by track

- **Foundation:** production config validation (`_FILE` secrets, `TRUST_PROXY`, DB/Redis timeouts, key rings), migration lock and
  `withTransactionRetry`, CHECK constraints and partial unique indexes behind the duplicate checks, trigram and sort indexes, a tolerant
  error registry (migration 0002).
- **Security & privacy:** escalation guards on users/roles (`details.reason`), search gated per entity, CSV formula neutralising,
  proxy-aware client IP, IP-pair + account lockout counted in Postgres, production bootstrap without demo users, one erasure
  implementation, KYC maker-checker, key rotation for JWT and field encryption (`REENCRYPT_FIELDS`).
- **Money rules:** posting-order ledger, price-deviation guard (`list_price_paise`), flat reservation with `HOLD_EXPIRY`, handover
  completeness, reversal on COMPLETED bookings (`BOOKING_COMPLETED` / reopen), compact bookings list (`view=full` for every field),
  retrying money transactions, `LEDGER_REBUILD`.
- **Platform reliability:** standalone worker with real handlers, retries + failure alerts, schedules and once-per-deploy boot jobs,
  `NOTIFICATION_SWEEP`, durable Postgres-backed idempotency, staff PATCH version policy, async CSV exports, backup/restore CLI.
- **Deployment & observability:** see the sections below.
- **Frontend quality:** contrast fixes and axe in every QA runner, 48 px tap targets, IST everywhere in the ERP, PDFs with an embedded
  ₹ font rendered in a worker pool, website CSP with nonces.
- **Integration:** ERP/website/portal wired to every new capability (jobs, system health, backups, exports, KYC, price deviation,
  reservations, visit self-reschedule); cross-track fixes (first boot, one-time secrets never replayed, docs gating, trace ids in logs,
  job sweeps, Redis outage budget, snapshot-consistent integrity).

### Verify stage

- Code quality: the whole repository is Prettier-formatted (`pnpm format:check`; `docs/SPEC.md` and the workflow scripts are
  excluded) and ESLint-clean with zero warnings in every package (`--max-warnings 0`). `kkt/module-boundaries` is now an error: every
  cross-module import in `apps/api/src/modules` goes through the other module's `index.ts`. The React Compiler lint rules
  (`react-hooks` v7) pass without blanket disables: state resets moved from effects to render-time adjustment (`useOnChange` in the
  ERP), data loading tags results with the request they answer, `Date.now()` in render became a shared `useNow()` clock,
  `react-hook-form` `watch()` became `useWatch`, Reanimated shared values use `get()`/`set()`, and hydration guards use
  `useSyncExternalStore`. The remaining `eslint-disable` comments each give their reason.
- API: `PATCH /construction/photos/:photoId` and `PATCH /payment-plan-assignments/:id` lost their version-policy exemption (400
  `VERSION_REQUIRED` without `If-Match`/`body.version`); stage-photo rows always carry `version` (additive: `StagePhotoUpdate` accepts
  `version`). Manage links replaced by a reschedule answer 410 `LINK_EXPIRED` instead of 404 (migration 0004,
  `site_visits.superseded_token_hashes`). Portal bells for demands, other-charge lines and payments carry their `booking_id`.
- OpenAPI snapshot regenerated for the additive changes of the round (no breaking change).

### Deployment

- `docker-compose.prod.yml`: PgBouncer (transaction pooling, prepared statements kept with PgBouncer 1.24), one-shot `migrate` service
  as the schema owner before the API replicas start, API replicas with `API_WORKERS=auto` and no migrations/seeding, one worker,
  persistent `noeviction` Redis (+ optional security Redis), Postgres with WAL archiving, nightly `pg_dump` with an automatic restore
  drill and weekly base backups, Caddy, secrets as files, optional MinIO and a monitoring profile (Prometheus, Alertmanager, Grafana,
  exporters).
- `docker-compose.yml` (quick start) no longer races on first boot: a `migrate` service runs first; replicas never migrate or seed;
  Redis is persistent and `noeviction`; the API connects as `kkt_app`.
- Database roles `kkt_owner` (migrations) and `kkt_app` (DML only; cannot truncate, change the schema or disable triggers):
  `infra/postgres/init/`.
- Kubernetes manifests in `infra/k8s` (API Deployment/Service/HPA/PDB with readiness `/api/v1/ready` and liveness `/api/v1/health`,
  worker, migrate Job, PgBouncer, web, ERP, portal, Ingress, NetworkPolicy, kustomization).
- Images run as non-root with health checks, production dependencies only (API), tracing preloaded with `--import`; the ERP and
  portal images are unprivileged nginx on port 8080 with Content-Security-Policy, `X-Frame-Options: DENY` and related headers.
- docs/DEPLOY.md rewritten; new docs/RESTORE.md, docs/CAPACITY.md.

### API

- Object storage: `STORAGE_DRIVER=s3` works (AWS SDK v3: streaming multipart uploads, presigned GET links, MinIO/R2 via `S3_ENDPOINT`
  with path-style addressing, optional `S3_PREFIX`) and is checked at boot (`HeadBucket`).
- Metrics on prom-client: default Node metrics, `http_request_duration_seconds` by route/method/status, business counters
  (`payments_posted_total`, `demands_raised_total`, `logins_failed_total`), job/DB/Redis/integrity gauges; aggregated across
  `node:cluster` workers and served on `METRICS_PORT`; `GET /api/v1/metrics` accepts the `METRICS_TOKEN` bearer.
- OpenTelemetry tracing when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (HTTP, ioredis, one span per route); `trace_id` in logs, error
  bodies (`error.trace_id`, additive) and the `X-Trace-Id` header.
- 5xx error reporter to `ERROR_WEBHOOK_URL` (sanitised, rate-limited).
- Graceful shutdown drains in-flight requests (`SHUTDOWN_TIMEOUT_MS`, `SHUTDOWN_DRAIN_DELAY_MS`); `/api/v1/ready` answers 503 while
  draining; the effective configuration (no secrets) is logged at boot; `node dist/server.js migrate` runs the migrate job.
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; the API docs pages get their own policy.
- Versioning: `route()` supports `deprecated: { sunset }` (Deprecation/Sunset/Link headers, OpenAPI `deprecated`), `goneRoute()`
  answers 410 `GONE` (new error code); OpenAPI snapshot `docs/openapi/v1.json` with a breaking-change gate.

### Review fixes (deploy track)

- Kubernetes: `BOOTSTRAP_COMPANY_NAME` / `BOOTSTRAP_ADMIN_EMAIL` moved from the shared ConfigMap to the migrate Job (the API and worker
  refused to boot with an admin e-mail but no password); the error webhook is opt-in (the generated placeholder is not a URL);
  PgBouncer limits are per pod (2 × 70 server connections).
- Compose production: `BOOTSTRAP_ADMIN_EMAIL` is required at render time (the bootstrap password file is always mounted);
  `gen-secrets.sh` writes 0644 files in a 0700 directory so the non-root containers can read the bind-mounted secrets.
- API image builds from a clean checkout (`apps/api/assets` is created when git has no files in it).
- Caddy really blocks `/api/v1/metrics` at the edge (a `handle` block; the previous `respond` was shadowed by the `/api/*` proxy).
- Metrics: job series are labelled `job_name` (Prometheus owns `job`; the alert on stale daily jobs could never fire); database-wide
  gauges are de-duplicated across replicas (`max`) in the pool-saturation alert and the dashboard.
- Deprecation headers are also sent when authentication, rate limiting or load shedding rejects a deprecated operation; OpenAPI
  operations carry `x-sunset`; the compatibility gate accepts a removal only after the sunset and also flags response fields that stop
  being required, request values restricted to an enum and tightened request bounds.
- Error reporter redacts spaced/hyphenated phone and Aadhaar numbers, lower-case PAN and `Basic`/`Bearer` credentials.
- docs/RESTORE.md: the nightly-dump restore as `kkt_owner` skips the dump's extension entries (only a superuser may create
  `pg_stat_statements` or comment on an extension); rehearsed on PostgreSQL 16.

### CI

- Jobs: install (pnpm store cache), lint, format check, typecheck, unit tests of every package (ERP included), database tests, API
  integration (3 shards, Postgres 16 + Redis 7), acceptance, OpenAPI compatibility, builds with an API start smoke, infrastructure
  validation (compose, kubeconform + semantic checks, promtool rules and rule tests, Caddy, nginx, shellcheck), container images
  (pushed to GHCR from `main`). Nightly: load-test smoke and the browser QA runners.

## [2.0.0] — 2026-10-25

- First release of the v2 rebuild: one backend (Fastify + PostgreSQL + Redis + BullMQ), staff ERP, customer portal (web + native),
  marketing website; 14 acceptance scenarios.
