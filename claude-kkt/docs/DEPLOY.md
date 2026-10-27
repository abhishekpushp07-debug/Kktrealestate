# KKT v2 — Running and deploying

Three ways to run KKT, from a laptop to a cluster. All three use the same images and the same rules: the API never migrates or seeds
in its HTTP replicas in production, the database is changed only by a one-shot **migrate** step running as the schema owner, and the
API/worker connect as an application role that cannot change the schema or bypass the append-only triggers.

|            | Quick start (`docker-compose.yml`)          | Production Compose (`docker-compose.prod.yml`)                         | Kubernetes (`infra/k8s`)                           |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| Hosts      | one VM                                      | one or a few VMs                                                       | a cluster                                          |
| Postgres   | container, `kkt_owner`/`kkt_app` roles      | container + PgBouncer, WAL archiving, nightly dumps with restore drill | managed (RDS/Cloud SQL) + PgBouncer Deployment     |
| Secrets    | environment variables                       | files (`infra/secrets`, `*_FILE`)                                      | Secret mounted as files (`*_FILE`)                 |
| Files      | local volume (S3 optional)                  | S3-compatible (AWS S3, R2, MinIO)                                      | S3-compatible                                      |
| Monitoring | `METRICS_PORT` + `METRICS_TOKEN` (internal) | Prometheus, Alertmanager, Grafana, exporters (`--profile monitoring`)  | your Prometheus (pod annotations / ServiceMonitor) |

## Local development (one command per surface)

```bash
pnpm install                       # Node 22, pnpm 10
cp .env.example .env               # dev defaults work out of the box
pnpm db:migrate                    # creates every table, index, trigger
pnpm api                           # http://localhost:4000  (seeds Shree Ganesh Builders demo on first boot: SEED_ON_BOOT=true)
pnpm erp                           # http://localhost:5173  staff ERP      (admin@sgb.in / Admin@12345 — see docs/SEED.md)
pnpm web                           # http://localhost:3000  marketing site
pnpm portal                        # http://localhost:8081  customer portal (web); `pnpm --filter @kkt/portal ios|android` for native
```

Requires PostgreSQL 16 and Redis 7 locally (or `docker compose up postgres redis`).

## Tests

```bash
pnpm lint                          # ESLint, zero errors and zero warnings (--max-warnings 0), incl. kkt/module-boundaries
pnpm format:check                  # Prettier (docs/SPEC.md and generated files are excluded by .prettierignore)
pnpm typecheck                     # tsc in all 7 packages
pnpm test                          # unit tests in every package (API unit tests include the OpenAPI compatibility gate)
pnpm --filter @kkt/db test         # schema invariants against kkt_test
pnpm --filter @kkt/api test:integration
pnpm test:acceptance               # the 14 acceptance scenarios
pnpm --filter @kkt/api openapi:check   # breaking-change check against docs/openapi/v1.json (docs/VERSIONING.md)
pnpm loadtest                      # autocannon profile, writes docs/PERFORMANCE.md tables
```

CI (`.github/workflows/ci.yml`) runs all of these plus lint, format, builds, an API start smoke and the infrastructure checks below;
`.github/workflows/nightly.yml` runs the load-test smoke and the three browser QA runners.

## Entry points of the API image

| Command                                                            | Role                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node --import ./dist/telemetry.js dist/server.js` (default `CMD`) | HTTP API. With `API_WORKERS` > 1 (`auto` = one per CPU) a `node:cluster` primary validates storage, serves the aggregated metrics on `METRICS_PORT` and supervises the workers (crash-looping workers back off to one restart per 30 s).                                                                                                                                                                                                         |
| `node dist/server.js migrate`                                      | One-shot migrate job: migrations (advisory-locked), then the first boot (see "First boot" below: a database with no company is bootstrapped from `BOOTSTRAP_*` whatever `SEED_ON_BOOT` says; the demo dataset only with `SEED_ON_BOOT=true` and `SEED_DEMO=true`); exits 0, or 1 when the first boot is refused. Connect it to Postgres **directly** as the owner role, never through PgBouncer (the migration lock is a session advisory lock). |
| `node --import ./dist/telemetry.js dist/worker.js`                 | BullMQ job worker (daily dues, integrity, notifications, exports, backups). Run exactly one.                                                                                                                                                                                                                                                                                                                                                     |

At boot every process logs `kkt api <role> starting` with its effective configuration (ports, workers, flags, database/Redis host
without credentials, storage driver/bucket, observability switches; secrets only as `set`/`unset`). With `STORAGE_DRIVER=s3` the boot
fails fast when the bucket is not reachable (`HeadBucket`), with the reason (missing bucket, access denied, wrong region).

**Graceful shutdown.** On SIGTERM a process marks itself draining (`/api/v1/ready` → 503), waits `SHUTDOWN_DRAIN_DELAY_MS`, stops the
in-process job worker, stops accepting connections, lets in-flight requests finish (keep-alive sockets are closed as they go idle,
late requests get `Connection: close`), then closes the Postgres pools and Redis, flushes traces and exits 0 — or exits 1 when
`SHUTDOWN_TIMEOUT_MS` passes. The cluster primary forwards the signal and waits for its workers.

## First boot

Every process that prepares the database — the migrate job (`node dist/server.js migrate`), the `node:cluster` primary and the
single-process API — runs the same first-boot step (`apps/api/src/seed/firstBoot.ts`) after migrating:

1. **Database without a company → bootstrap, always.** Independent of `SEED_ON_BOOT`. In production this creates the company named by
   `BOOTSTRAP_COMPANY_NAME`, the six system roles and ONE Super Admin from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`, who must
   change the password at first sign-in. If any of the three is missing, or the password fails the policy (≥ 12 characters with an
   upper-case letter, a lower-case letter and a digit), the process **refuses to start** (exit 1, log line "Refusing to start on a fresh
   production database: …", nothing written). An advisory lock makes concurrent boots create exactly one company.
2. **Database with a company → nothing to bootstrap.** Later boots and every replica need no `BOOTSTRAP_*` (the values are ignored once a
   company exists). With `SEED_ON_BOOT=true` the bootstrap still runs, idempotently, and re-syncs the system roles' permission bundles.
3. **Demo dataset only with `SEED_ON_BOOT=true` AND `SEED_DEMO=true`.** Only then does a boot create Shree Ganesh Builders (demo logins
   with published passwords, projects, customers, bookings, ledgers; docs/SEED.md). `SEED_DEMO=true` alone never adds demo logins or
   data. Outside production the bootstrap itself uses the demo company and logins (development convenience).

The procedure for a new installation:

```bash
# 1. secrets + first-boot settings (Compose prod: gen-secrets.sh writes infra/secrets/bootstrap_admin_password)
export BOOTSTRAP_COMPANY_NAME="My Builders Pvt Ltd" BOOTSTRAP_ADMIN_EMAIL=owner@example.in BOOTSTRAP_ADMIN_PASSWORD='First-Login-2026x'
# 2. migrate job: migrations + bootstrap (exit 0); a refused first boot exits 1 with the reason in the log
node dist/server.js migrate
# 3. start the API replicas and the worker (no BOOTSTRAP_* needed from now on)
# 4. sign in as BOOTSTRAP_ADMIN_EMAIL, change the password, then create the staff logins (ERP → Admin → Users)
```

If an API replica starts before the migrate job has bootstrapped the database, it refuses to start the same way (no company and no
`BOOTSTRAP_*`) and the orchestrator restarts it until the migrate job is done.

**After upgrading an installation that already holds bookings**, run the admin job `LEDGER_REBUILD` once (ERP → Admin → Jobs → Run, or
`POST /api/v1/admin/jobs/LEDGER_REBUILD/run` with `{"data": {"dry_run": true}}` first to preview). It rewrites, in batches, every
booking ledger whose stored rows are not in the canonical posting order (ledgers rebuilt by older versions in business-date order) and
lists the bookings whose row order changed in the run's result (`GET /api/v1/admin/jobs/runs/:id`); each rewrite is audited
(`booking.ledger_rebuilt`). Afterwards the integrity report (`GET /api/v1/dues/integrity`) shows no `SUMMARY_MISMATCH` for them. Running
it again is a no-op. A freshly seeded demo database already ends with this step.

## Quick start: one VM (`docker-compose.yml`)

```bash
export DOMAIN=kkt.in JWT_SECRET=$(openssl rand -hex 48) FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32) HASH_KEY=$(openssl rand -hex 32) \
       POSTGRES_PASSWORD=$(openssl rand -hex 24) KKT_OWNER_DB_PASSWORD=$(openssl rand -hex 24) KKT_APP_DB_PASSWORD=$(openssl rand -hex 24) \
       BOOTSTRAP_COMPANY_NAME="My Builders" BOOTSTRAP_ADMIN_EMAIL=owner@example.in BOOTSTRAP_ADMIN_PASSWORD='First-Login-2026x'
docker compose up -d --build       # add SEED_DEMO=true to load the Shree Ganesh demo dataset instead of an empty company
```

Boot order: `postgres` (first start runs `infra/postgres/init/*`: roles `kkt_owner`/`kkt_app`, passwords) → `migrate` (as `kkt_owner`;
exits) → two `api` replicas and the `worker` (as `kkt_app`). Replicas never migrate or seed (`RUN_MIGRATIONS_ON_BOOT=false`,
`SEED_ON_BOOT=false`; they only check that a company exists, see "First boot"), so the first-boot race of earlier versions is gone. Redis is persistent (AOF) and `noeviction`. Caddy terminates
TLS for `www.`, `erp.` and `my.` and load-balances `/api/*` over every API replica. Keep these secrets somewhere safe: losing
`FIELD_ENCRYPTION_KEY` or `HASH_KEY` loses the encrypted KYC fields. Passwords must be URL-safe (hex) because they go into connection
strings. Uploaded files live on the `storage` volume — fine for one VM; use S3 (`STORAGE_DRIVER=s3`, `S3_*`) to survive host loss.

## Production with Docker Compose (`docker-compose.prod.yml`)

```bash
sh infra/scripts/gen-secrets.sh            # infra/secrets/* (git-ignored; directory 0700, files 0644 so non-root containers can read the
                                           # bind-mounted files); prints the first Super Admin password
cat > .env <<EOF                           # no secrets in .env
DOMAIN=kkt.in
S3_BUCKET=kkt-documents
S3_REGION=ap-south-1
BOOTSTRAP_COMPANY_NAME=My Builders Pvt Ltd
BOOTSTRAP_ADMIN_EMAIL=owner@example.in
EOF
docker compose -f docker-compose.prod.yml --profile monitoring up -d --build
```

Keep `BOOTSTRAP_ADMIN_EMAIL` in `.env` after the first boot: the migrate service always mounts the bootstrap password file, and the
configuration refuses a bootstrap password without its e-mail, so Compose stops with "set BOOTSTRAP_ADMIN_EMAIL" instead of letting a
later upgrade's migrate run fail. Once a company exists the values are ignored.

What runs:

- **postgres** (16, tuned `infra/postgres/postgresql.conf`, SCRAM-only `pg_hba.conf`) with `archive_mode=on`: every WAL segment is
  copied to the `backups` volume within 5 minutes (`archive_timeout=300`). Not published on any port.
- **pgbouncer** (1.24, transaction pooling, `infra/pgbouncer/pgbouncer.ini`): the API and the worker connect here as `kkt_app`
  (`infra/secrets/database_url`). `max_prepared_statements` keeps the API's named prepared statements (`DATABASE_PREPARE=true`)
  working; with a PgBouncer older than 1.21 set `DATABASE_PREPARE=false`. PgBouncer ignores the per-connection timeouts the API sends
  as startup parameters, so they are role defaults of `kkt_app` instead (`statement_timeout` 15 s, `lock_timeout` 5 s,
  `idle_in_transaction_session_timeout` 30 s). Clients wait at most 10 s for a server connection (`query_wait_timeout`).
- **migrate** (one-shot, as `kkt_owner`, directly to Postgres) → **api** (`API_REPLICAS`, default 2; `API_WORKERS=auto` per container
  bounded by `API_CPUS`; `DATABASE_POOL_MAX=10` per worker; `API_MAX_INFLIGHT=256`; 6 s drain delay) and one **worker**.
- **redis** (password, AOF `everysec`, `noeviction`, `REDIS_MAXMEMORY` default 1 GB); `--profile security-redis` adds a dedicated
  instance for revocation markers, locks and rate limits (set `KKT_REDIS_SECURITY_URL_FILE=/run/secrets/redis_security_url`).
- **Object storage**: `STORAGE_DRIVER=s3` by default. AWS S3 / R2: `S3_BUCKET`, `S3_REGION`, and either an instance role or static keys
  (put them in `infra/secrets/s3_access_key` / `s3_secret_key` and set `KKT_S3_ACCESS_KEY_FILE=/run/secrets/s3_access_key`,
  `KKT_S3_SECRET_KEY_FILE=/run/secrets/s3_secret_key`). Self-hosted: `--profile minio` with `S3_ENDPOINT=http://minio:9000`
  (path-style addressing is used whenever `S3_ENDPOINT` is set). Enable bucket versioning and default encryption on the bucket.
- **backup**: nightly `pg_dump` + automatic restore drill into a scratch database, weekly physical base backup, retention and WAL
  cleanup, status file for alerting (docs/RESTORE.md).
- **caddy**: TLS, HTTP/3, security headers, `/api/*` to every API replica (re-resolved every 5 s; draining or failing replicas are
  skipped and the request retried on another for up to 5 s); `/api/v1/metrics` is not served at the edge.
- `--profile monitoring`: Prometheus (`infra/prometheus`, scrapes every API container's `METRICS_PORT` with the metrics token),
  Alertmanager (to the same Slack-compatible webhook as the error reporter), Grafana on `127.0.0.1:3001` (dashboard `KKT API`,
  admin password in `infra/secrets/grafana_admin_password`), postgres/redis/node exporters (disk alerts, backup age via the
  textfile collector). Docs: docs/OBSERVABILITY.md.

**Upgrades.** `docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d`: the migrate service
runs first; API replicas are replaced after it succeeds. Migrations are additive within a release (docs/VERSIONING.md), so old replicas
keep working against the new schema while they drain. **Rollback**: redeploy the previous image tag (`KKT_API_IMAGE`); a migration is
never rolled back automatically — restore (docs/RESTORE.md) if a release damaged data. The hardening round's migrations are all
additive: 0002 (constraints, indexes, backfills), 0003 (enum value `ABANDONED`) and 0004 (`site_visits.superseded_token_hashes`, a
column with a constant default — metadata-only on PostgreSQL 16 — plus a GIN index built on the small `site_visits` table).

## Kubernetes (`infra/k8s`)

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl -n kkt create secret generic kkt-secrets --from-file=infra/secrets/   # edit database_url/owner_url/redis_url for the cluster first
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f infra/postgres/init/01-roles.sql        # once, against the managed Postgres; then set passwords
cd infra/k8s && kustomize edit set image kkt-api=ghcr.io/acme/kkt-api:2.1.0 kkt-web=… kkt-erp=… kkt-portal=…
kubectl apply -k infra/k8s
```

- **api** Deployment (3 → 20 replicas by CPU via the HPA, `maxUnavailable: 0` rollouts, PodDisruptionBudget `maxUnavailable: 1`,
  spread over zones and nodes): readiness `/api/v1/ready` (fails while draining or when Postgres/Redis are unreachable), liveness
  `/api/v1/health`, startup probe; `API_WORKERS` is set from the container's CPU limit; non-root, read-only root filesystem, all
  capabilities dropped; `preStop` sleeps 8 s so endpoints are removed before the server stops accepting connections.
- **migrate** Job (Argo CD PreSync hook, or `kubectl apply -f migrate-job.yaml && kubectl wait --for=condition=complete job/migrate`
  before updating the Deployments; the first-boot `BOOTSTRAP_COMPANY_NAME` / `BOOTSTRAP_ADMIN_EMAIL` are set in `migrate-job.yaml`,
  never in the shared ConfigMap — the API and worker would refuse an admin e-mail without its password), **worker** Deployment (1 replica, `Recreate`), **pgbouncer** Deployment (2 replicas) in front of
  the managed Postgres (`postgres` ExternalName Service), **web** (HPA), **erp** and **portal** (static nginx) Deployments.
- **Ingress** for the three hosts (ingress-nginx + cert-manager; `/api` → api on every host; retries on 502/503).
- **NetworkPolicy**: deny all ingress by default; the ingress controller reaches the front ends and the API; only `web` calls the API
  in-cluster; only the API/worker/migrate reach PgBouncer; Prometheus in `monitoring` reaches only the metrics port; the front ends
  have no egress except DNS (and the API for `web`).
- **Error webhook** (5xx and failed jobs): put the real URL into the Secret's `error_webhook_url` key, then uncomment
  `ERROR_WEBHOOK_URL_FILE` in `api.yaml` and `worker.yaml`. It is off by default because `gen-secrets.sh` writes the placeholder
  `unused` there, which is not a URL and would stop the pods at boot.
- Validate locally: `kustomize build infra/k8s | kubeconform -strict -summary` and `node infra/scripts/validate-k8s.mjs` (selectors,
  ports, probes, secret keys, security contexts, resources — both run in CI).

## Database roles

`infra/postgres/init/01-roles.sql` (idempotent; the Compose stacks run it on the first Postgres start) creates:

- **`kkt_owner`** — owns the database, the `public` schema and every object the migrations create. Only the migrate job uses it.
- **`kkt_app`** — `CONNECT`, `USAGE` on the schema and `SELECT/INSERT/UPDATE/DELETE` on tables (plus sequences/functions), via
  default privileges for everything the owner creates later. No `TRUNCATE`, no DDL (no `CREATE` on the schema, not an owner), cannot
  `ALTER TABLE … DISABLE TRIGGER` or `SET session_replication_role`, so the append-only triggers on `audit_logs`, `payments` and
  `demands` hold against the application itself. It has `pg_read_all_stats` (connection states for `/metrics`) and the safety timeouts
  as role defaults. Since migration 0005 it also has **no UPDATE/DELETE/TRUNCATE on `ledger_entries`, `audit_logs`, `audit_seals`,
  `ledger_rebuilds`** and **no DELETE/TRUNCATE on `payments`, `demands`** (`packages/db/src/sql/0002_privileges.sql`, applied by every
  migration that changes the schema when `kkt_app` exists, and by `01-roles.sql`). Reseed (never in production) truncates as the
  owner. `apps/api/test/integration/db-roles.test.ts` proves all of this against the real migrations.

`infra/postgres/init/02-passwords.sh` sets both passwords from the secret files (production) or `KKT_OWNER_DB_PASSWORD` /
`KKT_APP_DB_PASSWORD` (quick start); re-run it to rotate. Jobs that would need DDL at runtime (e.g. creating next month's partitions)
must use a `SECURITY DEFINER` function owned by `kkt_owner` with `EXECUTE` granted to `kkt_app`.

## Security headers and CSP

| Surface                   | Where                             | Policy                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERP (`erp.`)              | `apps/erp/nginx.conf`             | `default-src 'self'`; scripts only from the origin (no inline, no eval); styles self + inline + Google Fonts; images self/data/blob/https; `connect-src ${CSP_CONNECT_SRC}` (default `'self'`: the API is same-origin under `/api`); `frame-ancestors 'none'`, `object-src 'none'`; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP same-origin. |
| Portal (`my.`)            | `apps/portal/nginx.conf`          | Same, plus the SHA-256 of Expo Router's one inline hydration script (`globalThis.__EXPO_ROUTER_HYDRATE__=true;`); camera allowed for the origin. Recompute the hash if an Expo upgrade changes that script (the portal then shows a CSP error in the console).                                                                                                                          |
| API JSON/files            | `apps/api/src/app.ts`             | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` on every response, plus helmet's headers.                                                                                                                                                                                                                                                             |
| API docs (`/api/v1/docs`) | `apps/api/src/app.ts`             | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://validator.swagger.io; frame-ancestors 'none'`.                                                                                                                                                                                                                                   |
| Every host                | `infra/caddy/Caddyfile` / Ingress | HSTS (2 years, preload), `nosniff`; fills `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and a minimal CSP only where the upstream set none (the website's own headers come from `apps/web/next.config.ts`).                                                                                                                                                                |

Verified in a browser (Chromium via Playwright) behind the real nginx configs: login, dashboard, bookings, customers and inventory in
the ERP and login, home, payments and construction in the portal raise no CSP violation; the only report is Zod's `new Function("")`
capability probe, which Zod catches (it falls back to its interpreter) — add `z.config({ jitless: true })` at app start to silence it.
The Swagger UI renders all operations with no violation.

**Website (`www.`, `apps/web`)**: the CSP comes from the app itself (`middleware.ts`, `lib/csp.ts`). Its ISR pages carry a hash-based
policy that `apps/web/csp-hook.cjs` fills in per response, so the production server **must** start with the hook: the image's `CMD` is
`node --require ./apps/web/csp-hook.cjs apps/web/server.js`, and outside Docker use `pnpm --filter @kkt/web start` (never a bare
`next start` / `node server.js`: the placeholder would reach browsers and block every inline script). Next's own gzip is off
(`compress: false`); Caddy compresses. The website's environment: `INTERNAL_API_TOKEN` (= the API's, contract C3), `KKT_COMPANY_SLUG`
(multi-company APIs, contract C4), `WEB_REVALIDATE_TOKEN` (= the API's, see below) and `GIT_SHA` (release in error reports); see
apps/web/README.md.

## Environment variables

See `.env.example` (every variable documented inline). Configuration is validated once at boot (`apps/api/src/config.ts`); an invalid or
missing value stops the process with every problem listed. Empty values count as unset.

**Production (`NODE_ENV=production`) refuses to start without** `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `HASH_KEY`, `DATABASE_URL` and
`REDIS_URL` (there are no localhost fallbacks in production), and with `STORAGE_DRIVER=s3` also `S3_BUCKET` + `S3_REGION`.

**Secrets from files.** Each of `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEYS`, `HASH_KEY`, `DATABASE_URL`,
`DATABASE_REPLICA_URL`, `REDIS_URL`, `REDIS_SECURITY_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `METRICS_TOKEN`, `BOOTSTRAP_ADMIN_PASSWORD`
and `ERROR_WEBHOOK_URL` may instead be given as `<NAME>_FILE=/run/secrets/<file>` (Docker/Kubernetes secrets). The file's surrounding
whitespace is trimmed; setting both `<NAME>` and `<NAME>_FILE` is an error, as is an empty or unreadable file.

### Defaults that differ in production

| Variable                                           | Default outside production                                                     | Default in production | Meaning                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEED_ON_BOOT`                                     | `true`                                                                         | `false`               | Re-run the (idempotent) bootstrap at every boot and, with `SEED_DEMO`, create the demo dataset. A database without a company is bootstrapped regardless (see "First boot").                                                                                   |
| `DOCS_PUBLIC`                                      | `true`                                                                         | `false`               | Serve `GET /api/v1/openapi.json` and Swagger UI (`/api/v1/docs`) to anyone. When `false` they need a staff bearer token holding `admin.tools` (anonymous 401, other staff 403); the browser UI then needs `DOCS_PUBLIC=true` (it cannot send a bearer token). |
| `SEED_DEMO`                                        | `true`                                                                         | `false`               | The demo dataset (Shree Ganesh Builders, demo staff and customers) is created at boot — only together with `SEED_ON_BOOT=true`.                                                                                                                               |
| `RUN_JOBS_IN_API`                                  | `true`                                                                         | `false`               | Run BullMQ jobs inside the API; in production the `worker` service/Deployment (`node dist/worker.js`) runs them.                                                                                                                                              |
| `API_WORKERS`                                      | `1`                                                                            | `auto`                | HTTP worker processes (see below).                                                                                                                                                                                                                            |
| `DATABASE_URL` / `REDIS_URL`                       | `postgres://postgres:postgres@localhost:5432/kkt` / `redis://localhost:6379/0` | required              | Primary database / Redis.                                                                                                                                                                                                                                     |
| `JWT_SECRET` / `FIELD_ENCRYPTION_KEY` / `HASH_KEY` | insecure dev values                                                            | required              | Signing, field-encryption and keyed-hash secrets.                                                                                                                                                                                                             |

### First boot, network and storage

| Variable                                             | Default    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOOTSTRAP_COMPANY_NAME`                             | —          | Company created on the first production boot (instead of the demo company).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | —          | The one Super Admin created on the first production boot. Must be set together; password ≥ 12 characters with an upper-case letter, a lower-case letter and a digit (the first boot refuses a weaker one).                                                                                                                                                                                                                                                                                                                              |
| `TRUST_PROXY`                                        | `loopback` | Which peers may set `X-Forwarded-For` (Fastify `trustProxy`, so `req.ip` is the proxy-aware client IP used by rate limits, lockouts and audit rows). `false`, `true` (trust every hop — only behind a proxy that overwrites the header), or a comma list of `loopback`, `linklocal`, `uniquelocal`, IPs and CIDRs (`10.0.0.0/8`). The client is the right-most untrusted hop, so a caller cannot choose its own IP. An unknown entry is a boot error. Behind a load balancer on a private network use e.g. `uniquelocal` or its subnet. |
| `STORAGE_DRIVER`                                     | `local`    | `local` or `s3`. `s3` requires `S3_BUCKET` and `S3_REGION`; `S3_ACCESS_KEY`/`S3_SECRET_KEY` are optional (unset = IAM role / default AWS chain) but must be set together. `S3_ENDPOINT` for S3-compatible stores.                                                                                                                                                                                                                                                                                                                       |
| `INTERNAL_API_TOKEN`                                 | —          | Shared secret (≥ 32 chars) for internal callers such as the website's SSR; off when unset.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**On-demand website revalidation** (phase 7): `WEB_REVALIDATE_URL` (the website's `https://www.<domain>/api/revalidate`) and
`WEB_REVALIDATE_TOKEN` (≥ 32 chars, the same value as the website's `WEB_REVALIDATE_TOKEN`): after every CMS or project-website write the
API POSTs `{tags: ["kkt-public"]}` with `x-kkt-revalidate-token`, best-effort (3 s timeout, calls within 250 ms coalesced, a failure is
logged at warn and the pages refresh on their 60–300 s ISR schedule). Off unless both are set.

### Database and Redis safety limits

| Variable                   | Default                       | Meaning                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_STATEMENT_TIMEOUT_MS`  | `15000`                       | `statement_timeout` on every pooled connection (0 = none). Migrations run without it.                                                                                                                                                                                                                                     |
| `DB_LOCK_TIMEOUT_MS`       | `5000`                        | `lock_timeout` on every pooled connection (0 = none).                                                                                                                                                                                                                                                                     |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000`                       | `idle_in_transaction_session_timeout` (0 = none): a transaction abandoned by a crashed request releases its locks.                                                                                                                                                                                                        |
| `DB_CONNECT_TIMEOUT_S`     | `10`                          | TCP connect timeout for Postgres.                                                                                                                                                                                                                                                                                         |
| `DATABASE_REPLICA_URL`     | —                             | Read replica for reports and public reads.                                                                                                                                                                                                                                                                                |
| `REDIS_COMMAND_TIMEOUT_MS` | `2000`                        | Upper bound of one command on the API's Redis clients (ioredis `commandTimeout`, 100–60000). Reads with a database fallback (caches, session state, idempotency fast path, rate limits) skip a disconnected Redis at once and give a slow one at most 150–250 ms, so a Redis outage costs requests no noticeable latency. |
| `REDIS_SECURITY_URL`       | — (falls back to `REDIS_URL`) | Separate Redis configured `maxmemory-policy noeviction` for token revocation markers, locks and rate limits, so cache eviction can never drop them.                                                                                                                                                                       |

Migrations take the session-level advisory lock `hashtext('kkt:migrate')`, so several replicas booting at once apply them one after
the other (the later ones find nothing to do); waiting replicas poll `pg_try_advisory_lock` rather than block inside a statement, so
they never hold a snapshot an online `CREATE INDEX CONCURRENTLY` would wait for. Hand-written SQL files are re-applied only when their
sha256 changes (or a new drizzle migration was applied), online files (`packages/db/src/sql/online`) run statement by statement outside
a transaction; set `KKT_MIGRATE_REAPPLY_SQL=true` on the migrate job to force every file once (e.g. after restoring a schema by hand).
Rules for writing migrations: docs/DATA-MODEL.md §J. An online index build waits for transactions older than itself: deploy the
migrate job when no long report or backup transaction is running, or expect it to wait for them.

### Key rotation

| Variable                | Default | Meaning                                                                                                                                                                                                            |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FIELD_ENCRYPTION_KEYS` | —       | Optional key ring `kid:base64key,kid:base64key`; the first entry encrypts new values. `FIELD_ENCRYPTION_KEY` is always key id `k1` and stays readable; key ids are 1–32 of `A-Za-z0-9_-`, secrets ≥ 32 characters. |
| `JWT_PREVIOUS_SECRETS`  | —       | Comma list of previous JWT secrets accepted for verification only (each ≥ 32 characters), for a rotation window.                                                                                                   |

### Observability

| Variable                      | Default   | Meaning                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `METRICS_TOKEN`               | —         | Bearer token (≥ 16 chars) for scraping `GET /api/v1/metrics` without a staff session, and required on the `METRICS_PORT` listener when set.                                                                                                                                                                               |
| `METRICS_PORT`                | `9464`    | Internal listener (`GET /metrics`) served by the process that owns the port: the `node:cluster` primary (aggregate of every worker) or the single process. Never publish it.                                                                                                                                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —         | OTLP/HTTP collector URL; tracing is off when unset.                                                                                                                                                                                                                                                                       |
| `OTEL_SERVICE_NAME`           | `kkt-api` | Service name on traces.                                                                                                                                                                                                                                                                                                   |
| `ERROR_WEBHOOK_URL`           | —         | Slack-compatible webhook: every 5xx (except 503) with request id, route, error class and a sanitised message, rate-limited (10/min/process) and de-duplicated; failed jobs when the job runner calls `reportJobFailure`. Off when unset.                                                                                  |
| `SHUTDOWN_TIMEOUT_MS`         | `25000`   | Hard deadline of a graceful shutdown (drain in-flight requests, close pools) before the process exits 1. Keep below the orchestrator's grace period (Compose `stop_grace_period` 40 s, Kubernetes `terminationGracePeriodSeconds` 45 s).                                                                                  |
| `SHUTDOWN_DRAIN_DELAY_MS`     | `0`       | After SIGTERM, `/api/v1/ready` answers 503 for this long before the server stops accepting connections, so a polling load balancer moves traffic away first (Compose prod: 6000; Kubernetes uses the `preStop` sleep instead).                                                                                            |
| `DEPLOY_ID` / `GIT_SHA`       | —         | Identity of the rollout. The worker enqueues the boot jobs (startup reconciliation, dues catch-up, notification sweep) once per `APP_VERSION` + `DEPLOY_ID` (else `GIT_SHA`, else the worker process's start time — so without either they run at every worker start; set `DEPLOY_ID` from the pipeline). Logged at boot. |
| `S3_PREFIX`                   | —         | Optional key prefix inside the bucket (e.g. `kkt/prod`), so several environments can share one bucket.                                                                                                                                                                                                                    |

### Runtime / performance knobs (docs/PERFORMANCE.md)

| Variable                                                 | Default                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_WORKERS`                                            | `1` (`auto` in production)     | HTTP worker processes (`node:cluster`). `auto` = one per CPU. The primary runs migrations + seed once, then forks; the in-process job worker runs in worker 0 only. Set `auto` (or the container's CPU count) in production — a single Node process serves ~1.5k simple requests/s per core.                                                                                                                                                                                                                                                                                                                                                      |
| `DATABASE_POOL_MAX`                                      | `20`                           | Postgres pool per worker process; keep `workers × pool` under Postgres/PgBouncer `max_connections`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_PREPARE`                                       | `true`                         | Named prepared statements for every query (postgres.js caches plans per connection). Set `false` behind PgBouncer < 1.21 in transaction mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `API_MAX_INFLIGHT`                                       | `0` (off); `256` in production | Requests in flight per worker before the excess is answered `503 SERVICE_UNAVAILABLE` + `Retry-After: 2`, written straight to the socket (≈ 0.1 ms of CPU per shed request). Protects the latency of admitted requests when thousands of connections arrive at once; the in-flight count is released when the response closes, so shedding stops the moment load drops. `/health`, `/ready` and `/metrics` (with and without `/api/v1`) are never shed. Counted in `http_requests_shed_total{reason="inflight"}`.                                                                                                                                 |
| `API_SHED_EVENT_LOOP_DELAY_MS`                           | `500`                          | Event-loop pressure: the mean event-loop delay is sampled per 500 ms window; above this value the process lowers its in-flight cap to a quarter (of 256 when `API_MAX_INFLIGHT` is off; never below 8) and restores it once a window is under half the value (hysteresis). It only lowers the cap, so a process never refuses everything and a quiet window ends it (no latch). `0` = off. Counted in `http_requests_shed_total{reason="event_loop"}`, state in `api_event_loop_pressure`. Replaces `@fastify/under-pressure`, whose cumulative utilisation threshold latched into 503-for-everything (docs/PERFORMANCE.md, "Reliability fixes"). |
| `PUBLIC_RATE_LIMIT_PER_MIN` / `WRITE_RATE_LIMIT_PER_MIN` | `300` / `120`                  | Per-IP public reads and per-user writes. Raise both when load testing from one machine (one generator looks like one user on one IP).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The production API image defaults to `API_WORKERS=auto`. `auto` counts the CPUs Node can use (`os.availableParallelism()`); give the container a CPU limit (Compose `deploy.resources.limits.cpus`, Kubernetes sets `API_WORKERS` from `limits.cpu`), otherwise a container on a 32-core host forks 32 workers × `DATABASE_POOL_MAX` connections. `--scale api=N` / the HPA multiplies this across containers; PgBouncer keeps the server side bounded.

## Backups and restore

See docs/RESTORE.md: the Compose production stack archives WAL continuously and takes nightly logical dumps (each one restored into a
scratch database as a drill) and weekly base backups; managed Postgres on Kubernetes uses the provider's automated backups + PITR. The
application-level export (`POST /api/v1/admin/backup`, Super Admin) and its restore CLI cover moving a company between installations.
The CLI ships in the API image: `node dist/cli/restore.js --file <backup.zip> --database-url <empty database> --confirm` (from a
checkout: `pnpm --filter @kkt/api restore -- …`). It needs the API's environment (secrets) because it runs the integrity report.
