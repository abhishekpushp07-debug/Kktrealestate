import cluster from "node:cluster";
import { randomUUID } from "node:crypto";
import client from "prom-client";

/**
 * Prometheus metrics (prom-client). Every API process keeps its own registry; under node:cluster the primary aggregates all workers with
 * AggregatorRegistry and serves the result on METRICS_PORT (modules/system/metricsServer.ts), and `/api/v1/metrics` on any worker asks
 * the primary for the same aggregated text over IPC. Dependency/business gauges that come from the database or Redis (job failures,
 * integrity findings, pool usage, queue depth) are collected by ONE process only (worker 0, or the single process) so aggregation never
 * double counts them; they use the `max` aggregator for safety.
 *
 * Docs: docs/OBSERVABILITY.md (metric catalogue, alerts, dashboards).
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 20 });

/** Latency buckets (seconds): fine below the 300 ms list target, coarse above. */
export const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10] as const;

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration by route pattern, method and status.",
  labelNames: ["route", "method", "status"] as const,
  buckets: [...HTTP_BUCKETS],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests by route pattern, method and status.",
  labelNames: ["route", "method", "status"] as const,
  registers: [registry],
});

export const httpRequestsInFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "HTTP requests currently being processed (sum over processes).",
  registers: [registry],
});

/** Business counters (docs/OBSERVABILITY.md). */
export const paymentsPosted = new client.Counter({
  name: "payments_posted_total",
  help: "Payments posted (POST /payments answered 201, idempotent replays excluded).",
  registers: [registry],
});

export const loginsFailed = new client.Counter({
  name: "logins_failed_total",
  help: "Failed logins (wrong credentials or locked) by audience.",
  labelNames: ["audience"] as const,
  registers: [registry],
});

/**
 * Demands raised. Most demands are raised by the worker process (daily dues, stage completion runs inside HTTP requests), so the value
 * is read from the database (`count(*) from demands`, which only ever grows: demands are voided, never deleted) by the dependency
 * collector; it is therefore monotonic across restarts and never double counted.
 */
let demandsSeen = 0;
export const demandsRaised = new client.Counter({
  name: "demands_raised_total",
  help: "Demands ever raised (rows in demands; voided demands included).",
  aggregator: "max",
  registers: [registry],
  async collect() {
    const p = current();
    if (!p) return;
    const n = (await p).demands;
    if (n === null) return;
    // (never call this.get() here: get() runs collect())
    if (n > demandsSeen) { this.inc(n - demandsSeen); demandsSeen = n; }
  },
});

/** Job metrics hook: in-process runners call recordJobRun() (jobs/index.ts); the DB-derived gauges below cover the worker container. */
export const jobRunsTotal = new client.Counter({
  name: "job_runs_total",
  help: "Job runs finished in this process by job and status.",
  // `job_name`, never `job`: Prometheus owns the `job` target label and would rename a scraped `job` label to `exported_job`
  labelNames: ["job_name", "status"] as const,
  registers: [registry],
});

export const jobDuration = new client.Histogram({
  name: "job_duration_seconds",
  help: "Job run duration in this process.",
  labelNames: ["job_name"] as const,
  buckets: [0.1, 0.5, 1, 5, 15, 60, 300, 900, 3600],
  registers: [registry],
});

/** Records one finished job run (hook for the job runner). */
export function recordJobRun(job: string, status: "OK" | "FAILED", seconds: number): void {
  jobRunsTotal.inc({ job_name: job, status });
  jobDuration.observe({ job_name: job }, seconds);
}

/** Configured DB pool size of this process (summed over processes: compare with kkt_db_max_connections). */
export const dbPoolMax = new client.Gauge({
  name: "db_pool_max_connections",
  help: "Configured Postgres pool size (primary + replica) of this process.",
  registers: [registry],
});

/** Records one finished HTTP request. `route` is the route pattern (never the raw URL), so cardinality stays bounded. */
export function recordRequest(route: string, method: string, status: number, seconds: number): void {
  const labels = { route, method, status: String(status) };
  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe(labels, seconds);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dependency collectors (one process only)

/** What the dependency collector needs: a postgres.js-style tagged template and an ioredis-style client. */
export interface DependencyProbes {
  query: (text: string) => Promise<Record<string, unknown>[]>;
  redis: { ping(): Promise<string>; pipeline(): { llen(k: string): unknown; zcard(k: string): unknown; exec(): Promise<[Error | null, unknown][] | null> } };
  /** BullMQ queue name (default kkt-jobs) and key prefix (default bull). */
  queueName?: string;
  queuePrefix?: string;
  /** Minimum seconds between two refreshes (default 10). */
  minIntervalSeconds?: number;
}

const LIST_STATES = ["wait", "active", "paused"] as const;
const ZSET_STATES = ["delayed", "prioritized", "failed", "waiting-children"] as const;

interface DependencySnapshot {
  dbUp: number;
  redisUp: number;
  connections: Record<string, number>;
  maxConnections: number | null;
  jobFailures24h: Record<string, number>;
  jobLastSuccess: Record<string, number>;
  integrityFindings: number | null;
  integrityLastRun: number | null;
  demands: number | null;
  queue: Record<string, number>;
}

let probes: DependencyProbes | null = null;
let snapshot: { at: number; value: Promise<DependencySnapshot>; pending: boolean } | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("probe timeout")), ms); })]);
  } finally {
    if (t) clearTimeout(t);
  }
}

async function takeSnapshot(p: DependencyProbes): Promise<DependencySnapshot> {
  const s: DependencySnapshot = { dbUp: 0, redisUp: 0, connections: {}, maxConnections: null, jobFailures24h: {}, jobLastSuccess: {}, integrityFindings: null, integrityLastRun: null, demands: null, queue: {} };
  const db = async () => {
    const [conn, jobs, integ, demands] = await Promise.all([
      p.query("select coalesce(state, 'unknown') as state, count(*)::int as n, current_setting('max_connections')::int as max from pg_stat_activity where datname = current_database() and backend_type = 'client backend' group by 1"),
      p.query("select job_name, count(*) filter (where status = 'FAILED' and started_at > now() - interval '24 hours')::int as failures, extract(epoch from max(finished_at) filter (where status = 'OK'))::float8 as last_ok from job_runs group by job_name"),
      p.query("select coalesce(sum(jsonb_array_length(findings)), 0)::int as findings, extract(epoch from max(ran_at))::float8 as last_run from (select distinct on (company_id) findings, ran_at from integrity_runs order by company_id, ran_at desc) t"),
      p.query("select count(*)::bigint as n from demands"),
    ]);
    s.dbUp = 1;
    for (const r of conn) { s.connections[String(r["state"])] = Number(r["n"]); s.maxConnections = Number(r["max"]); }
    if (s.maxConnections === null) s.maxConnections = Number((await p.query("select current_setting('max_connections')::int as max"))[0]?.["max"] ?? 0);
    for (const r of jobs) {
      s.jobFailures24h[String(r["job_name"])] = Number(r["failures"]);
      if (r["last_ok"] !== null && r["last_ok"] !== undefined) s.jobLastSuccess[String(r["job_name"])] = Number(r["last_ok"]);
    }
    s.integrityFindings = Number(integ[0]?.["findings"] ?? 0);
    s.integrityLastRun = integ[0]?.["last_run"] === null || integ[0]?.["last_run"] === undefined ? null : Number(integ[0]["last_run"]);
    s.demands = Number(demands[0]?.["n"] ?? 0);
  };
  const redis = async () => {
    await p.redis.ping();
    s.redisUp = 1;
    const prefix = `${p.queuePrefix ?? "bull"}:${p.queueName ?? "kkt-jobs"}`;
    const pipe = p.redis.pipeline();
    for (const st of LIST_STATES) pipe.llen(`${prefix}:${st}`);
    for (const st of ZSET_STATES) pipe.zcard(`${prefix}:${st}`);
    const res = (await pipe.exec()) ?? [];
    [...LIST_STATES, ...ZSET_STATES].forEach((st, i) => { const r = res[i]; if (r && !r[0]) s.queue[st] = Number(r[1] ?? 0); });
  };
  await Promise.all([withTimeout(db(), 3000).catch(() => undefined), withTimeout(redis(), 2000).catch(() => undefined)]);
  return s;
}

function current(): Promise<DependencySnapshot> | null {
  if (!probes) return null;
  const now = Date.now();
  const min = (probes.minIntervalSeconds ?? 10) * 1000;
  // one snapshot serves every gauge of a scrape (they collect concurrently) and any scrape within minIntervalSeconds
  if (!snapshot || (!snapshot.pending && now - snapshot.at >= min)) {
    const entry: { at: number; value: Promise<DependencySnapshot>; pending: boolean } = { at: now, value: Promise.resolve(null as unknown as DependencySnapshot), pending: true };
    entry.value = takeSnapshot(probes).finally(() => { entry.pending = false; entry.at = Date.now(); });
    snapshot = entry;
  }
  return snapshot.value;
}

function depGauge(name: string, help: string, labelNames: string[], fill: (g: client.Gauge<string>, s: DependencySnapshot) => void): client.Gauge<string> {
  return new client.Gauge({
    name, help, labelNames, aggregator: "max", registers: [registry],
    async collect() {
      const p = current();
      if (!p) return;
      this.reset();
      fill(this, await p);
    },
  });
}

depGauge("kkt_db_up", "1 when the metrics process can query Postgres.", [], (g, s) => g.set(s.dbUp));
depGauge("kkt_redis_up", "1 when the metrics process can PING Redis.", [], (g, s) => g.set(s.redisUp));
depGauge("kkt_db_connections", "Client connections to this database by state (pg_stat_activity; all API/worker pools, or PgBouncer server connections).", ["state"], (g, s) => {
  for (const [state, n] of Object.entries(s.connections)) g.set({ state }, n);
});
depGauge("kkt_db_max_connections", "Postgres max_connections.", [], (g, s) => { if (s.maxConnections !== null) g.set(s.maxConnections); });
depGauge("kkt_job_failures_24h", "FAILED job_runs in the last 24 h by job.", ["job_name"], (g, s) => {
  for (const [job, n] of Object.entries(s.jobFailures24h)) g.set({ job_name: job }, n);
});
depGauge("kkt_job_last_success_timestamp_seconds", "Unix time of the last OK run by job.", ["job_name"], (g, s) => {
  for (const [job, t] of Object.entries(s.jobLastSuccess)) g.set({ job_name: job }, t);
});
depGauge("kkt_integrity_findings", "Findings of the latest integrity run, summed over companies.", [], (g, s) => { if (s.integrityFindings !== null) g.set(s.integrityFindings); });
depGauge("kkt_integrity_last_run_timestamp_seconds", "Unix time of the latest integrity run.", [], (g, s) => { if (s.integrityLastRun !== null) g.set(s.integrityLastRun); });
depGauge("kkt_jobs_queue_depth", "BullMQ jobs by state.", ["state"], (g, s) => {
  for (const [state, n] of Object.entries(s.queue)) g.set({ state }, n);
});

/** Turns the dependency collector on in this process (call in exactly one process per host: worker 0 or the single process). */
export function enableDependencyMetrics(p: DependencyProbes): void {
  probes = p;
  snapshot = null;
}

/** Turns the dependency collector off (shutdown/tests). */
export function disableDependencyMetrics(): void {
  probes = null;
  snapshot = null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rendering and cluster aggregation

const REQ = "kkt:metrics:request";
const RES = "kkt:metrics:response";

/** Text exposition of this process's registry. */
export async function localMetrics(): Promise<string> {
  return registry.metrics();
}

/** Content type of the exposition format. */
export const METRICS_CONTENT_TYPE = registry.contentType;

let workerSetupDone = false;

/** In a cluster worker: lets the primary's AggregatorRegistry collect this registry (call once per worker). */
export function setupWorkerAggregation(): void {
  if (workerSetupDone || !cluster.isWorker) return;
  workerSetupDone = true;
  client.AggregatorRegistry.setRegistries([registry]);
  // Constructing an AggregatorRegistry installs prom-client's worker-side IPC listener.
  new client.AggregatorRegistry();
}

/**
 * Metrics for a scrape: in a cluster worker, the cluster-wide aggregate fetched from the primary over IPC (falls back to this process's
 * own metrics when the primary does not answer in time); otherwise this process's registry.
 */
export async function scrapeMetrics(timeoutMs = 6000): Promise<string> {
  if (!cluster.isWorker || typeof process.send !== "function") return localMetrics();
  const id = randomUUID();
  return new Promise<string>((resolve) => {
    const onMessage = (msg: unknown) => {
      const m = msg as { type?: string; id?: string; body?: string; error?: string };
      if (m?.type !== RES || m.id !== id) return;
      cleanup();
      if (typeof m.body === "string") resolve(m.body);
      else void localMetrics().then((t) => resolve(`# cluster aggregation failed (${m.error ?? "unknown"}); this worker only\n${t}`));
    };
    const timer = setTimeout(() => { cleanup(); void localMetrics().then((t) => resolve(`# cluster aggregation timed out; this worker only\n${t}`)); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); process.off("message", onMessage); };
    process.on("message", onMessage);
    process.send!({ type: REQ, id });
  });
}

/** In the cluster primary: aggregates every worker and answers workers' IPC scrape requests. Returns the aggregator. */
export function setupPrimaryAggregation(): { aggregator: client.AggregatorRegistry<client.PrometheusContentType>; clusterMetrics: () => Promise<string> } {
  const aggregator = new client.AggregatorRegistry<client.PrometheusContentType>();
  const clusterMetrics = () => aggregator.clusterMetrics();
  cluster.on("message", (worker, msg: unknown) => {
    const m = msg as { type?: string; id?: string };
    if (m?.type !== REQ || typeof m.id !== "string") return;
    clusterMetrics()
      .then((body) => { if (worker.isConnected()) worker.send({ type: RES, id: m.id, body }); })
      .catch((err: unknown) => { if (worker.isConnected()) worker.send({ type: RES, id: m.id, error: (err as Error).message }); });
  });
  return { aggregator, clusterMetrics };
}

/** Clears every value (tests). */
export function resetMetrics(): void {
  registry.resetMetrics();
  snapshot = null;
  demandsSeen = 0;
}
