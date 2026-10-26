# KKT v2 — Observability

Logs, metrics, traces, error reports and alerts: what each one carries, where it goes and what to do when an alert fires.

## Signals at a glance

| Signal          | Source                                                                                                                                                                                                    | Where it goes                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Structured logs | pino JSON on stdout (`apps/api/src/lib/logger.ts`), secrets redacted; every request line has `reqId`; with tracing on EVERY line (request, module, job loggers) has `trace_id` + `span_id` (logger mixin) | Docker json-file (rotated 5 × 20 MB) / your log shipper            |
| Request id      | `X-Request-Id` (honours a sane inbound id), echoed in every response and error body (`error.request_id`) and in audit rows                                                                                | client ↔ logs ↔ audit                                              |
| Metrics         | prom-client registry per process, aggregated per container                                                                                                                                                | `GET /metrics` on `METRICS_PORT` (internal), `GET /api/v1/metrics` |
| Traces          | OpenTelemetry (`apps/api/src/telemetry.ts`, loaded with `node --import`) when `OTEL_EXPORTER_OTLP_ENDPOINT` is set                                                                                        | any OTLP/HTTP collector (Tempo, Jaeger, Honeycomb, Grafana Cloud…) |
| Error reports   | `plugins/errorReporter.ts`: every 5xx except 503                                                                                                                                                          | `ERROR_WEBHOOK_URL` (Slack-compatible JSON)                        |
| Health          | `GET /api/v1/health` (liveness: process up; DB/Redis ping times), `GET /api/v1/ready` (503 when Postgres or Redis is down or the process is draining)                                                     | load balancers, Kubernetes probes, Caddy                           |
| Job history     | `job_runs` table (every run with status RUNNING → OK / FAILED, or ABANDONED via `JOB_RUN_SWEEP`; result, error)                                                                                           | ERP → Admin → Jobs; metrics below                                  |
| Alerts          | `infra/prometheus/alerts.yml`                                                                                                                                                                             | Alertmanager → the same webhook                                    |
| Dashboard       | `infra/grafana/kkt-api.json` (uid `kkt-api`)                                                                                                                                                              | Grafana (provisioned in `--profile monitoring`)                    |

## Metrics

### Endpoints and aggregation

- Every API process keeps its own prom-client registry. Under `node:cluster` (`API_WORKERS` > 1) the **primary** aggregates all
  workers with prom-client's `AggregatorRegistry` (counters and histograms summed; gauges with their declared aggregator) and serves
  the result on **`METRICS_PORT`** (default 9464, `GET /metrics`). A single process serves the same port itself. Bind it to the
  private network only; with `METRICS_TOKEN` set the listener also requires `Authorization: Bearer <token>`.
- **`GET /api/v1/metrics`** (and `/metrics` on the API port) returns the same cluster-wide aggregate (the worker asks its primary
  over IPC; if the primary does not answer within 6 s the worker's own metrics are returned with a comment line saying so). Access:
  `Authorization: Bearer <METRICS_TOKEN>` (checked in constant time before staff authentication runs) **or** a staff token with
  `admin.tools`. Caddy does not serve it at the edge.
- Prometheus scrapes one target per API container (Compose: DNS service discovery of `api`; Kubernetes: the `metrics` port of the pods,
  annotated `prometheus.io/scrape`), so `sum()` over the job gives the whole system — except the database/Redis-derived `kkt_*` gauges
  and `demands_raised_total`: every replica reports the same system-wide value, so aggregate them with `max` (e.g.
  `sum(max by (state) (kkt_db_connections))`), never `sum`.
- Job metrics are labelled `job_name`, not `job`: Prometheus owns the `job` target label (`kkt-api`) and would rename a scraped `job`
  label to `exported_job`, silently breaking every query on it.

### Catalogue

| Metric                                                               | Type               | Labels                                             | Meaning                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `http_request_duration_seconds`                                      | histogram          | `route`, `method`, `status`                        | Latency per route pattern (never the raw URL). Buckets 5 ms … 10 s, with 200/300/500 ms around the list-page target.                                                                                         |
| `http_requests_total`                                                | counter            | `route`, `method`, `status`                        | Requests.                                                                                                                                                                                                    |
| `http_requests_in_flight`                                            | gauge (sum)        | —                                                  | Requests being processed.                                                                                                                                                                                    |
| `http_requests_shed_total`                                           | counter            | `reason` (`inflight`, `event_loop`)                | Requests answered 503 by load shedding (`plugins/loadShed.ts`): the in-flight cap (`API_MAX_INFLIGHT`) was reached, or event-loop pressure lowered it. They are also in `http_requests_total{status="503"}`. |
| `api_event_loop_pressure`                                            | gauge (sum)        | —                                                  | Processes currently in event-loop pressure mode (mean event-loop delay of the last 500 ms window over `API_SHED_EVENT_LOOP_DELAY_MS`, until it falls under half of it).                                      |
| `payments_posted_total`                                              | counter            | —                                                  | `POST /api/v1/payments` answered 201 (idempotent replays excluded).                                                                                                                                          |
| `logins_failed_total`                                                | counter            | `audience` (`erp`, `portal`)                       | Staff/portal logins answered 401 or 423.                                                                                                                                                                     |
| `demands_raised_total`                                               | counter            | —                                                  | Demands ever raised (rows in `demands`, voided included; demands are never deleted, so the value only grows — also across restarts — and includes demands raised by the worker).                             |
| `job_runs_total`, `job_duration_seconds`                             | counter, histogram | `job_name`, `status`                               | Job runs finished **in this process**: `jobs/index.ts` `runJob` records every attempt's outcome (`OK` or `FAILED`) and duration.                                                                             |
| `db_pool_max_connections`                                            | gauge (sum)        | —                                                  | Configured pool size of the process (primary + replica pools) — summed: the connections the API could open.                                                                                                  |
| `kkt_db_up`, `kkt_redis_up`                                          | gauge              | —                                                  | The metrics process can query Postgres / PING Redis.                                                                                                                                                         |
| `kkt_db_connections`                                                 | gauge              | `state`                                            | Client connections to the database by state (`pg_stat_activity`; behind PgBouncer: its server connections).                                                                                                  |
| `kkt_db_max_connections`                                             | gauge              | —                                                  | Postgres `max_connections`.                                                                                                                                                                                  |
| `kkt_job_failures_24h`                                               | gauge              | `job_name`                                         | FAILED and ABANDONED rows in `job_runs` in the last 24 h (covers the worker container, which has no HTTP port).                                                                                              |
| `kkt_job_last_success_timestamp_seconds`                             | gauge              | `job_name`                                         | Last OK run per job.                                                                                                                                                                                         |
| `kkt_jobs_queue_depth`                                               | gauge              | `state` (`wait`, `active`, `delayed`, `failed`, …) | BullMQ queue `kkt-jobs`.                                                                                                                                                                                     |
| `kkt_integrity_findings`, `kkt_integrity_last_run_timestamp_seconds` | gauge              | —                                                  | Findings of the latest integrity run (summed over companies) and its time.                                                                                                                                   |
| `kkt_backup_*`                                                       | gauge              | —                                                  | From `/backups/status.prom` via node-exporter's textfile collector (docs/RESTORE.md).                                                                                                                        |
| `process_*`, `nodejs_*`                                              | various            | —                                                  | prom-client default metrics: CPU, RSS, heap, GC, handles, event-loop lag (p50/p90/p99).                                                                                                                      |

The `kkt_*` dependency gauges and `demands_raised_total` are computed by exactly one process per container (worker 0 or the single
process) from one snapshot (four small queries + one Redis pipeline, at most every 10 s, 3 s timeout), so a scrape never multiplies
database load by the number of workers. A failing database or Redis reports `0` for `*_up` instead of failing the scrape.

### Hooks for other code

- `recordJobRun(job, "OK" | "FAILED", seconds)` — called by `runJob` (jobs/index.ts) for every attempt.
- Abandoned runs: a `job_runs` row still RUNNING after twice its job's time budget (`JOB_TIMEOUT_MS` in jobs/index.ts: 5 min for HOLD_EXPIRY, 1 h for the dues/integrity/reconciliation jobs, 2 h for backups, re-encryption and LEDGER_REBUILD, 30 min otherwise) means its worker died mid-run; `JOB_RUN_SWEEP` (every 15 minutes) marks it ABANDONED with an explanatory error. ABANDONED counts as a failure in `GET /admin/jobs` and `kkt_job_failures_24h`. A run that does finish later still records its real outcome.
- `reportJobFailure(job, runId, error)` (`plugins/errorReporter.ts`) — posts a sanitised failed-job message to the webhook.
- `paymentsPosted`, `loginsFailed`, `demandsRaised` are exported counters; the first two are incremented from route outcomes in
  `plugins/telemetry.ts`, so business code does not need to touch them.

## Tracing (OpenTelemetry)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `http://otel-collector:4318`) on the API and the worker; the image already starts Node with
`--import ./dist/telemetry.js`. Without the variable the preload does nothing and the request path has no tracing code at all.

- Spans: one server span per HTTP request (named `METHOD /route/:pattern`, attribute `http.route`; health/ready/metrics are not
  traced; query strings are never exported), one child span per route handler (`handler METHOD /route`, attributes `kkt.route`,
  `kkt.permission`, `kkt.audience`, `kkt.error_code` on failure), every Redis command (ioredis) and outbound HTTP call.
- Correlation: `trace_id` and `span_id` of the active span on every log line — request logs and module-level loggers (jobs, services) alike, through the pino `mixin` in `lib/logger.ts` — plus the `X-Trace-Id` response header and `error.trace_id` in error bodies.
- Standard variables apply: `OTEL_SERVICE_NAME` (default `kkt-api`; the worker uses `kkt-worker`), `OTEL_EXPORTER_OTLP_HEADERS`
  (vendor API keys), `OTEL_TRACES_SAMPLER=parentbased_traceidratio` + `OTEL_TRACES_SAMPLER_ARG=0.1` for 10 % sampling in production,
  `OTEL_RESOURCE_ATTRIBUTES`. Spans are flushed on graceful shutdown.
- Verified end to end against a local OTLP/HTTP receiver: request, handler and Redis spans arrive with the attributes above, and the trace id appears in the response header, the error body and the request log lines.

## Error reporter

With `ERROR_WEBHOOK_URL` set, every response with status ≥ 500 except 503 (load shedding and not-ready are covered by alerts) is
posted as `{ text, kkt: { service, version, host, kind, id, where, status, error_class, message, trace_id, suppressed_repeats,
dropped_by_rate_limit, at } }`:

- `id` = request id, `where` = `METHOD /route/pattern` (never the URL or query), `error_class` = constructor name (plus the error code).
- `message` is sanitised: e-mails, phone numbers, PAN, Aadhaar, long numbers, UUIDs, JWTs, `token=`/`password=` values, credentials in
  URLs and Postgres `Key (…)=(…)` values are replaced; at most 300 characters. No body, header, user or customer data is ever sent.
- At most 10 messages per minute per process (token bucket); a repeat of the same route + error class within 60 s is suppressed and
  counted in the next message. Posting is fire-and-forget with a 3 s timeout; a dead webhook never affects requests.

## Alerts (`infra/prometheus/alerts.yml`)

Rules are checked (`promtool check rules`) and unit-tested (`promtool test rules infra/prometheus/alerts.test.yml`) in CI.

| Alert                                          | Fires when                                                  | First steps                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| KktApiDown (critical)                          | a replica's metrics scrape fails for 2 min                  | `docker compose ps api` / `kubectl get pods`; replica logs                                          |
| KktApi5xxRateHigh / Critical                   | 5xx (excl. 503) > 1 % for 5 min / > 5 % for 2 min           | webhook messages → request ids → logs/traces; check KktDbDown/KktRedisDown; roll back a bad release |
| KktApiShedding                                 | 503 > 5 % for 10 min                                        | add replicas/CPU (docs/CAPACITY.md); look for a slow query holding the pool                         |
| KktApiLatencyP95High                           | a route's p95 > 300 ms for 10 min (routes with > 0.2 req/s) | the route's traces; `pg_stat_statements`                                                            |
| KktEventLoopLagHigh                            | event-loop p99 > 500 ms for 5 min                           | CPU-heavy work in requests (PDF, images, CSV) or CPU starvation                                     |
| KktLoginFailuresSpike                          | > 30 failed logins/min per audience for 10 min              | credential stuffing: lockouts apply; review login events by IP                                      |
| KktJobFailed                                   | any FAILED job run in 24 h                                  | ERP → Admin → Jobs; fix and re-run                                                                  |
| KktDailyJobStale (critical)                    | DAILY_DUES or NIGHTLY_INTEGRITY not OK for 26 h             | is the worker running? `docker compose logs worker`                                                 |
| KktJobQueueBacklog                             | > 100 jobs waiting for 15 min                               | worker down or stuck job                                                                            |
| KktIntegrityFindings (critical)                | latest integrity run has findings                           | ERP → Admin → Integrity; repairs are audited, money is never auto-corrected                         |
| KktIntegrityReportStale                        | no integrity run for 26 h                                   | see KktDailyJobStale                                                                                |
| KktBackupStale (critical)                      | no successful dump + restore drill for 26 h                 | `docker compose logs backup`; WAL archive keeps PITR possible meanwhile                             |
| KktDbDown (critical) / KktRedisDown (critical) | dependency unreachable for 1 min                            | containers/managed service status; Redis data is on the AOF volume                                  |
| KktDbPoolSaturation                            | connections > 80 % of `max_connections` for 5 min           | pool math in docs/CAPACITY.md; PgBouncer                                                            |
| KktDbActiveConnectionsHigh                     | > 50 % of `max_connections` executing for 5 min             | slow query / lock wait: `pg_stat_activity`                                                          |
| KktRedisMemoryHigh                             | Redis > 85 % of `maxmemory` for 10 min                      | `noeviction` means writes fail at 100 %: raise `REDIS_MAXMEMORY`                                    |
| KktDiskSpaceLow / Critical / WillFillIn24h     | < 15 % / < 5 % free, or linear fill within 24 h             | backup retention, Docker logs/images                                                                |

Alertmanager (`infra/prometheus/alertmanager.yml`) groups by alert and route, repeats critical alerts hourly and inhibits API latency
and 5xx alerts while the API itself is down.

## Dashboard

`infra/grafana/kkt-api.json` (provisioned into the "KKT" folder): service health (rps, 5xx ratio, p95, replicas, Postgres/Redis up),
requests by status, p95 by route (top 10), busiest routes, 5xx by route, in-flight requests, event-loop lag, heap/RSS, Postgres
connections vs `max_connections` and configured pools, Redis memory, integrity findings, failed jobs, queue depth, hours since the last
daily dues / integrity run / backup, payments posted and demands raised per hour, failed logins per minute, disk and CPU of the host.
Every query is syntax-checked in CI (`infra/scripts/dashboard-rules.mjs` + `promtool`).
