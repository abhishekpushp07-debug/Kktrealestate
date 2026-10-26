# Deployment, observability and API versioning track report

All 7 deliverables are built and checked here: unit tests, integration and acceptance runs, real tool validation, and a browser check of the CSP. Two limits: no Docker daemon was available, so no image was built and no container was started; and the production compose stack, Caddy and PgBouncer never ran end to end.

Paths below are under `/home/user/Kktrealestate/claude-kkt`. Nothing is committed.

**Test results:**

- **API unit tests:** 86/86 pass (15 files), all in `apps/api/test/unit/`.
  - `storage-s3.test.ts` (8): S3 driver against a fake client, no network.
  - `metrics.test.ts` (4): rewritten for prom-client.
  - `observability.test.ts` (8): error-reporter sanitising and rate limit, Deprecation/Sunset headers, boot-config redaction, metrics listener and token.
  - `openapi-compat.test.ts` (12): each breaking-change rule, plus the generated document against the committed snapshot.
- **Integration** (database `kkt_h4`, Redis 19): 151/151 pass across 13 files.
  - New `observability.test.ts` (9) covers: metrics with the token or `admin.tools`, payment and failed-login counters, the 5xx webhook (sanitised, de-duplicated, 503 excluded), deprecated and gone routes, CSP on JSON and docs, `/ready` returning 503 while draining, and shutdown finishing an in-flight request before closing the pools.
  - New `db-roles.test.ts` (6) runs the real migrations as `kkt_owner` and then the API as `kkt_app`. As `kkt_app`, TRUNCATE, DDL, disabling triggers, `session_replication_role` and `SET ROLE` all fail with 42501, and the append-only triggers still hold.
  - The other 11 files (system, loadshed, conventions, rbac, security, auth, web, admin, idempotency, seed, money) pass unchanged.
- **Acceptance** (`kkt_h4_acc`): 55/55 pass.
- **Contracts tests:** 183/183 pass after adding `GONE`.
- **Typecheck:** contracts is clean. The API is clean in my files; the only errors are another track's work in progress, in `src/modules/admin/backup.ts` and `test/unit/jobs.test.ts`.
- **ESLint:** clean on every file I touched.
- **Not mine:** `documents.test.ts` currently has 5 failures, all `PATCH` requests now getting 400 `VERSION_REQUIRED` from the platform track's version policy.

**Validation of the infrastructure files:**

- **Compose:** `docker compose config` passes for both files and every profile.
- **Kubernetes:** `kustomize build` piped into `kubeconform -strict` reports 27/27 valid. My checker `infra/scripts/validate-k8s.mjs` also passes, and catches the errors I planted to test it.
- **Prometheus:** `promtool check rules` passes (21 rules), `promtool test rules` passes, and all 32 dashboard queries parse. `amtool check-config` passes.
- **Caddy:** `caddy validate` passes.
- **nginx:** `nginx -t` passes on the real ERP and portal configs.
- **Scripts and workflows:** shellcheck and actionlint are clean.
- The validators were downloaded into the scratchpad, and nginx was installed with apt only for this check.

**Live checks:**

- **Production bundle, 2 workers:**
  - Metrics on `METRICS_PORT` are aggregated across workers (`db_pool_max_connections 40`).
  - `/api/v1/metrics` works with the token; a wrong token gets 401.
  - SIGTERM drains and logs "shutdown complete".
- **Same bundle with only production dependencies:** started normally (no dev packages).
- **Tracing:** with a local OTLP receiver, spans arrived and the trace id showed up in the `X-Trace-Id` header, `error.trace_id` and the log lines.
- **CSP:** ERP and portal behind the real nginx configs, in Chromium, show zero violations. The only report is Zod's `new Function("")` probe, which Zod catches. Swagger UI renders all 475 operations with no violation.
- **Backups:** `backup.sh once` produced a dump, passed the restore drill and took a base backup.
- **Point-in-time recovery:** rehearsed on PG 16.15; recovery stopped exactly before the target transaction.
- **Roles:** `02-passwords.sh` works with a quoted password; when both are present, the secret file wins over the environment value.

## Changes

- **API code:**
  - S3 driver in `lib/storage.ts`: streaming uploads, presigned GET links, MinIO/R2 support, `S3_PREFIX`, and a `HeadBucket` check at boot.
  - prom-client metrics in `lib/metrics.ts`. This file was not on my ownership list; I took it because it is the subject of the task.
  - Route spans, `deprecated` and `goneRoute()` in `lib/routes.ts`.
  - `app.ts`: CSP, trace id in request logs, offline mode, `Connection: close` while draining.
  - `server.ts`: rewritten, including a new `migrate` command.
  - New `telemetry.ts` and new plugins `plugins/telemetry.ts` and `plugins/errorReporter.ts`; updated `plugins/loadShed.ts`.
  - `modules/system/`: `index.ts` updated; new `lifecycle.ts`, `shutdown.ts`, `bootConfig.ts`, `metricsServer.ts`, `openapi.ts`, `openapiDiff.ts` and `openapiCli.ts`.
- **Scripts and contracts:** `apps/api/package.json` scripts `start`, `build`, `migrate`, `openapi` and `openapi:check`; one appended error code `GONE` (410) in `packages/contracts/src/errors.ts`.
- **Snapshot:** `docs/openapi/v1.json` (371 paths, formatted with prettier).
- **Containers:** all four Dockerfiles, plus `apps/erp/nginx.conf`, `apps/portal/nginx.conf`, `docker-compose.yml`, the new `docker-compose.prod.yml` and a new `.dockerignore`.
- **Infra:**
  - `infra/postgres/init/01-roles.sql`, `02-passwords.sh`, `pg_hba.conf`, plus additions to `postgresql.conf`.
  - `infra/pgbouncer/pgbouncer.ini` and `infra/backup/backup.sh`.
  - Prometheus (config, alerts, alert tests, Alertmanager) and the Grafana dashboard with provisioning.
  - `infra/k8s/*` (13 files) and `infra/caddy/Caddyfile`.
  - `infra/scripts/gen-secrets.sh`, `validate-k8s.mjs`, `dashboard-rules.mjs`; `infra/secrets/.gitignore`.
- **CI:** `.github/workflows/ci.yml` and the new `nightly.yml`.
- **Docs:** `docs/DEPLOY.md` rewritten, keeping the foundation's environment tables. New `RESTORE.md`, `OBSERVABILITY.md`, `VERSIONING.md` and `CAPACITY.md`. `ARCHITECTURE.md` changed in §1, §2, §5 and §6. New `CHANGELOG.md`.

## Decisions

- **Demands counter:** `demands_raised_total` is read from `count(*)` of `demands`. Most demands are raised by the worker, which has no metrics port, and demands are never deleted, so this always grows (also across restarts) without double counting.
- **Business counters:** payments posted and failed logins are counted from route outcomes in my plugin, so no business module was edited.
- **Database and Redis gauges:** computed only by worker 0 (or the single process), from one snapshot taken at most every 10 s, using the `max` aggregator.
- **Database pool metrics:** postgres.js does not expose its pool, so "pool saturation" is measured from `pg_stat_activity` against `max_connections`.
- **Metrics token:** checked in my plugin before the auth plugin runs, so the route keeps `permission: admin.tools` and the route registry stays truthful.
- **PgBouncer:** version 1.24 with `max_prepared_statements`, so `DATABASE_PREPARE=true` keeps working. The safety timeouts are role defaults of `kkt_app`, because PgBouncer drops the startup parameters the API sends. The migrate job connects to Postgres directly.
- **Front-end images:** ERP and portal now run unprivileged nginx on port 8080. The portal and ERP API URL is same-origin under `/api`.
- **API docs CSP:** set by my own hook instead of helmet. Swagger-ui's built-in policy forced `upgrade-insecure-requests` and blocked its own inline styles.
- **Telemetry bundling:** `telemetry.ts` is built by a second tsup command in the `build` script, because `tsup.config.ts` is not mine.

## Not finished

- No image build or container run here. The CI `images` job builds all four images; the compose stack still needs a real `docker compose up` once a daemon is available.
- Website HTML is still not cacheable at a CDN; `docs/CAPACITY.md` lists this as the first thing that breaks at scale.
- No lag-aware fallback from read replicas to the primary.
- The worker container has no health endpoint; its Kubernetes liveness probe only checks that the process exists.

## For the other tracks and the integration stage

- **Platform track:**
  - In `jobs/index.ts`, after each run call `recordJobRun(name, "OK"|"FAILED", seconds)` from `lib/metrics.js`.
  - When a job fails for the last time, call `reportJobFailure(job, runId, err)` from `plugins/errorReporter.js`.
  - `worker.ts` should call `createStorage().check()` at startup and expose a heartbeat or health port.
  - Any job that creates partitions (runtime DDL) needs a `SECURITY DEFINER` function owned by `kkt_owner`, because `kkt_app` cannot run DDL.
  - Add `src/cli/restore.ts` as a tsup entry if the restore CLI should ship inside the image.
- **Integration stage:**
  - Regenerate the snapshot after all tracks merge: `pnpm --filter @kkt/api openapi`. The compatibility test will flag added routes only as additive.
  - `docs/SECURITY.md` "Transport & browser" still says "CSP for API docs only". It should say: API responses carry `default-src 'none'; frame-ancestors 'none'`, and the ERP and portal set their own CSP.
  - The verify stage owns the formatting of `docs/ARCHITECTURE.md`, which was already not prettier-clean before my changes.
- **Frontends:**
  - Optionally read `error.trace_id`, a new optional string in error bodies that appears only when tracing is on. `ApiErrorSchema` is not strict, so it is simply stripped until someone adds `trace_id: z.string().optional()`.
  - Optionally show a "please update" notice in the portal when a response carries a `Deprecation` header.
  - Call `z.config({ jitless: true })` at ERP and portal startup to stop the Zod CSP report.
  - Handle 410 `GONE`, which returns `details: { sunset, replacement }`.
- **New environment variables** (read in my code, not in `config.ts`): `SHUTDOWN_TIMEOUT_MS` (default 25000), `SHUTDOWN_DRAIN_DELAY_MS` (default 0), `S3_PREFIX`; `CSP_CONNECT_SRC` for the nginx images.
- **Left on the shared host:** the cluster-wide roles `kkt_owner` and `kkt_app` now exist (created by my test). I kept databases `kkt_h4`, `kkt_h4_acc` and dropped my scratch databases.
