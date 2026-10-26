# Changelog

All notable changes to KKT v2. The API follows docs/VERSIONING.md: additive within `/api/v1`, deprecations announced here with their
sunset date. Dates are IST.

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
