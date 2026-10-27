# KKT v2 — Capacity model

How many API replicas, how big a database and how much Redis a deployment needs, derived from the measurements in docs/PERFORMANCE.md.
Every number is labelled **measured** (from a load-test run in this repository) or **estimate** (an assumption you must confirm with
`pnpm loadtest` on your own hardware before buying it). Where the honest answer is "not measured", it says so.

## 1. What one core does (measured)

All measurements: production bundle, `API_WORKERS=auto` (4 workers) on a **shared 4-vCPU box** that also ran Postgres, Redis and the
load generator, seed data (130 flats, 10 bookings), 200 connections, zero think time (docs/PERFORMANCE.md "Run … API_WORKERS=auto").
Dividing by 4 understates a dedicated core (a quarter of the box went to Postgres/Redis/autocannon), so these are floors.

| Request type                                           | Box throughput                    | Per core (floor) | CPU per request (≈)                                                                   |
| ------------------------------------------------------ | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `GET /auth/me` (JWT verify + one Redis MGET)           | 5,319 rps                         | ~1,330 rps       | 0.75 ms                                                                               |
| Cached public read `GET /public/projects` (Redis 60 s) | 21,585 rps                        | ~5,400 rps       | 0.2 ms                                                                                |
| Dashboard (Redis 15 s per role/user/scope)             | 9,212 rps                         | ~2,300 rps       | 0.4 ms                                                                                |
| Search (one UNION statement)                           | 6,212 rps                         | ~1,550 rps       | 0.65 ms                                                                               |
| List pages: projects / customers / grid / flats        | 2,703 / 2,574 / 1,917 / 1,449 rps | 360–680 rps      | 1.5–2.8 ms                                                                            |
| Booking detail / ledger page                           | 1,919 / 1,830 rps                 | ~470 rps         | 2.1 ms                                                                                |
| Bookings list, 25 full rows (65 KB)                    | 657 rps                           | ~165 rps         | 6 ms (now compact rows by default: not re-measured)                                   |
| `POST /payments` on **one** booking                    | 100–130 /s                        | —                | serialised by the per-booking lock (8–10 ms each); different bookings run in parallel |

A single Node process tops out near ~1.5k simple authenticated requests/s (profiling: 0.7 ms CPU each), which is why every container
runs `API_WORKERS=auto`. Database execution times of the hot queries are 0.1–0.3 ms; at seed sizes the database is never the
bottleneck — at lakh-row tables it can be (see §6).

**Planning figure used below (estimate):** a mixed staff workload costs **~2 ms of API CPU per request** (a page = 3–6 calls, mostly
lists/details, some cached), i.e. ~500 requests/s per dedicated core; a portal workload (own bookings/payments/documents, replica
reads) ~1.5 ms; cacheable public reads that reach the API ~0.2 ms.

## 2. 1,000 concurrent staff (the SPEC target)

- **Load (estimate):** an active staff user loads a screen every 15–30 s; a screen is 3–6 API calls → one request every 4–6 s per
  user. 1,000 users → **170–250 rps** sustained; plan for **500 rps** peaks (month-end collections, morning stand-ups).
- **API:** 500 rps × 2 ms = 1 core busy. **2 replicas × 2 vCPU** (`API_WORKERS=auto` → 2 workers each) gives 4 cores: one replica can
  fail or redeploy and the other still runs at ~25 % CPU. The measured box already served 1,000 _zero-think-time_ connections at 1.5–8k
  rps per endpoint, an order of magnitude above this load.
- **Database (primary):** 4 vCPU / 16 GB, `shared_buffers` 4 GB, SSD. Pools: 2 replicas × 2 workers × `DATABASE_POOL_MAX` 10 = 40
  client connections + 2 job workers × `DATABASE_POOL_MAX` (20 by default in Compose production, 10 from the Kubernetes ConfigMap)
  → PgBouncer → ≤ 60 server connections (well under `max_connections` 200).
- **Redis:** ~2–3 commands per request (auth MGET, rate limit) → < 1,500 ops/s; 1 GB `noeviction` is generous.
- **Worker:** 2 containers × 2 vCPU (phase 7: two replicas for availability, not throughput — BullMQ runs each job once, schedules are
  de-duplicated; per worker `WORKER_CRITICAL_CONCURRENCY` 2 + `WORKER_HEAVY_CONCURRENCY` 1); nightly dues/integrity over thousands of
  bookings take seconds to minutes. `UV_THREADPOOL_SIZE=16` in every API/worker container (argon2, sharp, zlib share the libuv pool).
- **Latency target** (< 300 ms list pages): met at 200 hammering connections on the shared box for every list except the old full-row
  bookings page; with dedicated API cores and the database on its own machine the queueing that dominates p95 shrinks further.

## 3. 5 lakh (500,000) concurrent public and portal users

This is a read problem. Staff traffic stays as in §2; what grows is the website and the portal.

### 3a. Website visitors — the CDN does the work

- **Load (estimate):** 500,000 concurrent visitors reading a page every ~30 s → **~16,700 page views/s**, each needing HTML, ~2 API
  calls during server rendering, CSS/JS and 5–20 images.
- **What is already cacheable:** public API responses carry `Cache-Control: public, max-age=60, s-maxage=60,
stale-while-revalidate=300` and are cached in Redis for 60 s; media and build assets are immutable for a year.
- **CDN offload math:** a CDN (CloudFront, Cloudflare, Fastly) in front of `www.` with HTML cached for 60 s means each distinct URL is
  fetched from the origin at most once per minute per edge location (stale-while-revalidate hides the refresh). With ~500 distinct
  public URLs (projects, project sub-pages, blog, legal pages) and ~20 Indian edge locations, the origin sees at most
  500 × 20 / 60 ≈ **170 HTML requests/s** — whether there are 5,000 or 5,00,000 visitors (hit ratio ≈ 99 %). Images: after warm-up
  essentially **100 %** from the edge (immutable). Public API calls from browsers (availability, forms): the cacheable ones follow the
  same arithmetic; form posts (enquiries, brochure, site visits) are rate-limited per IP and are a few per second even at peak.
- **Origin sizing with the CDN:** 170 SSR renders/s plus ~340 API calls/s (most answered from Redis at ~0.2 ms) → 2–3 website
  containers (Next.js SSR throughput was **not measured** here: assume 50–100 renders/s per core and verify) and no additional API
  replicas.
- **Prerequisite — honest gap:** at the time of writing the website's root layout is rendered dynamically per request and detail
  fetches are `no-store` (audit finding, frontend track), so HTML is **not** CDN-cacheable yet. Without HTML caching, 16,700 renders/s
  would need on the order of 170–330 cores of Next.js plus the matching API calls — not a sensible deployment. Make public pages
  cacheable (ISR / `s-maxage` with CMS-triggered revalidation) before planning for this tier. The per-IP public rate limit must also
  exempt (or receive the visitor IP from) the website's server-side calls (`INTERNAL_API_TOKEN`, security/web tracks).

### 3b. Portal users — authenticated reads, not cacheable at the edge

- **Load (estimate):** one builder has thousands, not lakhs, of buyers; the 5-lakh figure is a stress target. A portal user opening the
  app makes ~6 calls (me, bookings, payments, documents, notifications, construction), then idles; averaged, **one request per 30 s**
  per active user → 500,000 / 30 ≈ **16,700 rps**.
- **API:** 16,700 rps × 1.5 ms ≈ **25 cores**. With 30 % headroom and N+1: **16–18 replicas × 2 vCPU** (the HPA in `infra/k8s/api.yaml`
  scales 3 → 20 on CPU at 65 %).
- **Database:** ~2 queries per portal request → ~33,000 indexed point/range queries/s. The portal and public modules read through
  `app.dbReplica`, so these go to **read replicas**: plan **3 replicas × 8 vCPU / 32 GB** (estimate: 10–20k simple indexed queries/s
  per replica; measure with `pg_stat_statements` during a load test) behind a reader endpoint or a PgBouncer of their own; the primary
  keeps writes and staff reads.
- **Connections:** 18 replicas × 2 workers × 10 = 360 client connections to the primary pool + up to 18 × 2 × 5 to the replica pool;
  PgBouncer (`max_client_conn` 2,000–4,000) keeps the server side bounded (Compose: one PgBouncer, `default_pool_size` 60 /
  `max_db_connections` 150; Kubernetes: 2 PgBouncer pods × 30 / 70, the limits are per pod). Without PgBouncer this tier
  is impossible (360 connections × ~10 MB backend memory each).
- **Redis:** ~3 commands per request (auth state, revocation marker, rate limit) → ~50,000 ops/s. One Redis 7 instance handles ~100k
  simple ops/s per core-bound thread (estimate), so a single primary works with ~50 % headroom; move security state to its own
  instance (`REDIS_SECURITY_URL`) and use a managed Redis with a replica for failover.
- **Bandwidth:** ~3 KB compressed per portal response → ~50 MB/s (~400 Mbit/s) of API egress, plus documents/PDFs (served by
  presigned S3 URLs where possible, so they do not pass through the API).

### 3c. Totals for the 5-lakh tier (estimate, to be validated)

| Component            | Size                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| API                  | 18–20 replicas × 2 vCPU / 2 GB (HPA max 20)                                                |
| Website              | 3 containers × 1 vCPU behind a CDN with HTML caching                                       |
| PostgreSQL           | primary 8 vCPU / 32 GB + 3 read replicas 8 vCPU / 32 GB, PgBouncer 2 × 1 vCPU per endpoint |
| Redis                | managed, 2 GB, primary + replica; separate small security Redis                            |
| Object storage + CDN | S3 + CloudFront/Cloudflare for media and static assets                                     |
| Worker               | 2 × 2 vCPU (unchanged; the second replica is for availability)                             |

## 4. Read-replica routing plan

1. **What reads where (already in code):** `app.dbReplica` (≈ 200 call sites: portal, public website API, reports, booking/flat
   lists) uses `DATABASE_REPLICA_URL` when set, otherwise the primary. Writes, transactions and the reads inside them always use
   `app.db` (primary).
2. **Endpoint:** point `DATABASE_REPLICA_URL` at a reader endpoint (RDS/Aurora reader, Cloud SQL replica IP, or a PgBouncer whose
   `[databases]` entry lists the replicas). The replica pool is half the primary pool per worker.
3. **Replication lag:** asynchronous replicas are typically < 1 s behind. A buyer who pays at the counter and opens the portal a
   second later may briefly not see the receipt; staff screens read their own writes from the primary inside the request. Alert on
   replica lag > 5 s (postgres-exporter `pg_replication_lag`); a lag-aware fallback to the primary is **not implemented** (follow-up).
4. **Failure:** if the replica is unreachable, the replica pool errors and those routes return 503 — point `DATABASE_REPLICA_URL`
   back at the primary (or rely on the managed reader endpoint's failover) and restart the API.

## 5. Pool and connection arithmetic

`client connections = API replicas × workers per replica × DATABASE_POOL_MAX (+ replica pools) + worker replicas (2) × worker pool + migrate (2)`.
Without PgBouncer this must stay under Postgres `max_connections` (200 in `infra/postgres/postgresql.conf`) minus admin/backup headroom:
the quick start (`docker-compose.yml`, no PgBouncer) therefore gives each of its two job workers a pool of 8
(`WORKER_DATABASE_POOL_MAX`), so 2 API replicas × 8 cores × 10 + 2 × 8 = 176 stays under it (checked by
`apps/api/test/unit/deploy-config.test.ts`); on a host with more cores set `API_WORKERS` or `DATABASE_POOL_MAX` lower.
With PgBouncer it must stay under `max_client_conn`, and `default_pool_size` × databases ≤ `max_db_connections` (150 in Compose).
PgBouncer's limits apply per PgBouncer process: with N PgBouncer replicas the server side is N × `max_db_connections`, which must stay
under Postgres `max_connections` minus headroom (Kubernetes ships 2 × 70 = 140). The
`KktDbPoolSaturation` alert fires at 80 % of `max_connections`; Grafana shows configured API pools next to actual connections.

## 6. What breaks first (in order) and the guard rails

1. **Website HTML without CDN caching** (§3a) — the first and largest wall; fix before scaling anything else.
2. **Database connections** without PgBouncer as replicas × workers grow — PgBouncer ships in `docker-compose.prod.yml` and `infra/k8s`.
3. **List queries at lakh-row tables** — the trigram and sort indexes from the foundation migration cover search and default sorts,
   but the latency at production sizes has **not been measured**; run the load test against a synthetic large dataset before go-live.
4. **Redis memory** with `noeviction` — writes fail when full; `KktRedisMemoryHigh` warns at 85 %.
5. **CPU-heavy work in requests** (PDF/image rendering, synchronous CSV) — shows as event-loop lag (`KktEventLoopLagHigh`); the worker
   pool and async exports from the other tracks move it out of the request path.
   Load shedding (`API_MAX_INFLIGHT=256` in production) answers the excess with 503 + `Retry-After` instead of letting latency collapse.

## 7. How to validate

`BASE=https://erp.<staging> CONNECTIONS=… pnpm loadtest` against a staging stack sized as above, with the database on its own machine,
a production-sized synthetic dataset and the API, database and generator on separate hosts; watch the Grafana dashboard
(`KKT API`) for p95 per route, event-loop lag, connections vs max and Redis memory while ramping. The nightly CI job is a regression
gate, not a capacity test: 50 read / 10 write connections on a GitHub runner, on the scale seed when `pnpm --filter @kkt/api seed:scale`
exists (else the demo seed), failing when a route's p95 exceeds its limit in `scripts/ci/load-thresholds.json` (lists 300 ms, cached
public reads 100 ms, payments 800 ms) or more than 1% of its requests fail.
