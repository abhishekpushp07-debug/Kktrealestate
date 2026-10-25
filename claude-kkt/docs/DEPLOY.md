# KKT v2 — Running and deploying

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
pnpm test                          # unit tests in every package
pnpm --filter @kkt/db test         # schema invariants against kkt_test
pnpm --filter @kkt/api test:integration
pnpm test:acceptance               # the 14 acceptance scenarios against a running API with seed data
pnpm loadtest                      # autocannon profile, writes docs/PERFORMANCE.md tables
```

## Production (single VM, Docker Compose)
```bash
export DOMAIN=kkt.in JWT_SECRET=$(openssl rand -base64 48) FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32) HASH_KEY=$(openssl rand -base64 32) POSTGRES_PASSWORD=$(openssl rand -base64 24)
docker compose up -d --build
```
Caddy terminates TLS for `www.kkt.in`, `erp.kkt.in`, `my.kkt.in` and proxies `/api/*` on every host to the API replicas. Migrations run on API boot (`RUN_MIGRATIONS_ON_BOOT=true`), seed only when the database is empty.

## Production (cloud, horizontally scaled)
* API + worker containers behind a load balancer (ALB/NGINX); N replicas; PgBouncer (transaction mode) in front of PostgreSQL; `DATABASE_REPLICA_URL` for read replicas.
* Redis (managed, with persistence) for rate limits, caches, idempotency fast path and BullMQ.
* Object storage: set `STORAGE_DRIVER=s3` with bucket/credentials (adapter interface in `apps/api/src/lib/storage.ts`); media served through the API with immutable caching or directly from a CDN.
* Website: `apps/web` on any Node host or Vercel-style platform; ISR 60 s; CDN in front.
* ERP and portal web builds are static (`apps/erp/dist`, `apps/portal/dist`) — host on a CDN/object storage with SPA fallback; set `VITE_API_URL` / `EXPO_PUBLIC_API_URL` at build time.
* Native portal apps: `cd apps/portal && eas build --platform all` (EAS config in app.json).

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
| Variable | Default outside production | Default in production | Meaning |
|---|---|---|---|
| `SEED_ON_BOOT` | `true` | `false` | Run the first-boot seed (bootstrap company + Super Admin; the demo dataset too when `SEED_DEMO`). |
| `SEED_DEMO` | `true` | `false` | The demo dataset (Shree Ganesh Builders, demo staff and customers) may be created. |
| `RUN_JOBS_IN_API` | `true` | `false` | Run BullMQ jobs inside the API; in production run `pnpm --filter @kkt/api worker` as its own process. |
| `API_WORKERS` | `1` | `auto` | HTTP worker processes (see below). |
| `DATABASE_URL` / `REDIS_URL` | `postgres://postgres:postgres@localhost:5432/kkt` / `redis://localhost:6379/0` | required | Primary database / Redis. |
| `JWT_SECRET` / `FIELD_ENCRYPTION_KEY` / `HASH_KEY` | insecure dev values | required | Signing, field-encryption and keyed-hash secrets. |

### First boot, network and storage
| Variable | Default | Meaning |
|---|---|---|
| `BOOTSTRAP_COMPANY_NAME` | — | Company created on the first production boot (instead of the demo company). |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | — | The one Super Admin created on the first production boot. Must be set together; password ≥ 12 characters. |
| `TRUST_PROXY` | `loopback` | Which peers may set `X-Forwarded-For` (Fastify `trustProxy`, so `req.ip` is the proxy-aware client IP used by rate limits, lockouts and audit rows). `false`, `true` (trust every hop — only behind a proxy that overwrites the header), or a comma list of `loopback`, `linklocal`, `uniquelocal`, IPs and CIDRs (`10.0.0.0/8`). The client is the right-most untrusted hop, so a caller cannot choose its own IP. An unknown entry is a boot error. Behind a load balancer on a private network use e.g. `uniquelocal` or its subnet. |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. `s3` requires `S3_BUCKET` and `S3_REGION`; `S3_ACCESS_KEY`/`S3_SECRET_KEY` are optional (unset = IAM role / default AWS chain) but must be set together. `S3_ENDPOINT` for S3-compatible stores. |
| `INTERNAL_API_TOKEN` | — | Shared secret (≥ 32 chars) for internal callers such as the website's SSR; off when unset. |

### Database and Redis safety limits
| Variable | Default | Meaning |
|---|---|---|
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | `statement_timeout` on every pooled connection (0 = none). Migrations run without it. |
| `DB_LOCK_TIMEOUT_MS` | `5000` | `lock_timeout` on every pooled connection (0 = none). |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | `idle_in_transaction_session_timeout` (0 = none): a transaction abandoned by a crashed request releases its locks. |
| `DB_CONNECT_TIMEOUT_S` | `10` | TCP connect timeout for Postgres. |
| `DATABASE_REPLICA_URL` | — | Read replica for reports and public reads. |
| `REDIS_SECURITY_URL` | — (falls back to `REDIS_URL`) | Separate Redis configured `maxmemory-policy noeviction` for token revocation markers, locks and rate limits, so cache eviction can never drop them. |

Migrations take the session-level advisory lock `pg_advisory_lock(hashtext('kkt:migrate'))`, so several replicas booting at once
apply them one after the other (the later ones find nothing to do).

### Key rotation
| Variable | Default | Meaning |
|---|---|---|
| `FIELD_ENCRYPTION_KEYS` | — | Optional key ring `kid:base64key,kid:base64key`; the first entry encrypts new values. `FIELD_ENCRYPTION_KEY` is always key id `k1` and stays readable; key ids are 1–32 of `A-Za-z0-9_-`, secrets ≥ 32 characters. |
| `JWT_PREVIOUS_SECRETS` | — | Comma list of previous JWT secrets accepted for verification only (each ≥ 32 characters), for a rotation window. |

### Observability
| Variable | Default | Meaning |
|---|---|---|
| `METRICS_TOKEN` | — | Bearer token (≥ 16 chars) for scraping `/metrics` without a staff session. |
| `METRICS_PORT` | `9464` | Port of the cluster-wide metrics listener. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP collector URL; tracing is off when unset. |
| `OTEL_SERVICE_NAME` | `kkt-api` | Service name on traces. |
| `ERROR_WEBHOOK_URL` | — | Slack-compatible webhook for unhandled errors and failed jobs; off when unset. |

### Runtime / performance knobs (docs/PERFORMANCE.md)
| Variable | Default | Meaning |
|---|---|---|
| `API_WORKERS` | `1` (`auto` in production) | HTTP worker processes (`node:cluster`). `auto` = one per CPU. The primary runs migrations + seed once, then forks; the in-process job worker runs in worker 0 only. Set `auto` (or the container's CPU count) in production — a single Node process serves ~1.5k simple requests/s per core. |
| `DATABASE_POOL_MAX` | `20` | Postgres pool per worker process; keep `workers × pool` under Postgres/PgBouncer `max_connections`. |
| `DATABASE_PREPARE` | `true` | Named prepared statements for every query (postgres.js caches plans per connection). Set `false` behind PgBouncer < 1.21 in transaction mode. |
| `API_MAX_INFLIGHT` | `0` (off) | Requests in flight per worker before the excess is answered `503 SERVICE_UNAVAILABLE` + `Retry-After: 2`. Protects latency of admitted requests when thousands of connections arrive at once; `256` is a sane production value. |
| `PUBLIC_RATE_LIMIT_PER_MIN` / `WRITE_RATE_LIMIT_PER_MIN` | `300` / `120` | Per-IP public reads and per-user writes. Raise both when load testing from one machine (one generator looks like one user on one IP). |

The production API container should run `API_WORKERS=auto`; `docker compose` scaling (`--scale api=N`) multiplies this across containers.

## Backups
`POST /api/v1/admin/backup` (Super Admin) → signed download link to a zip (one JSON file per table + manifest). Restore with the included `restore.md` steps (psql `\copy`). Also schedule `pg_dump` at the infrastructure level.
