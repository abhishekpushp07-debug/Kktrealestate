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
See `.env.example` (every variable documented inline). Production refuses to start without `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `HASH_KEY`.

### Runtime / performance knobs (docs/PERFORMANCE.md)
| Variable | Default | Meaning |
|---|---|---|
| `API_WORKERS` | `1` | HTTP worker processes (`node:cluster`). `auto` = one per CPU. The primary runs migrations + seed once, then forks; the in-process job worker runs in worker 0 only. Set `auto` (or the container's CPU count) in production — a single Node process serves ~1.5k simple requests/s per core. |
| `DATABASE_POOL_MAX` | `20` | Postgres pool per worker process; keep `workers × pool` under Postgres/PgBouncer `max_connections`. |
| `DATABASE_PREPARE` | `true` | Named prepared statements for every query (postgres.js caches plans per connection). Set `false` behind PgBouncer < 1.21 in transaction mode. |
| `API_MAX_INFLIGHT` | `0` (off) | Requests in flight per worker before the excess is answered `503 SERVICE_UNAVAILABLE` + `Retry-After: 2`. Protects latency of admitted requests when thousands of connections arrive at once; `256` is a sane production value. |
| `PUBLIC_RATE_LIMIT_PER_MIN` / `WRITE_RATE_LIMIT_PER_MIN` | `300` / `120` | Per-IP public reads and per-user writes. Raise both when load testing from one machine (one generator looks like one user on one IP). |

The production API container should run `API_WORKERS=auto`; `docker compose` scaling (`--scale api=N`) multiplies this across containers.

## Backups
`POST /api/v1/admin/backup` (Super Admin) → signed download link to a zip (one JSON file per table + manifest). Restore with the included `restore.md` steps (psql `\copy`). Also schedule `pg_dump` at the infrastructure level.
