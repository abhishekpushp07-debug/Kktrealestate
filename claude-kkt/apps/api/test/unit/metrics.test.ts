import { describe, expect, it } from "vitest";
import {
  demandsRaised,
  disableDependencyMetrics,
  enableDependencyMetrics,
  localMetrics,
  recordJobRun,
  recordRequest,
  registry,
  resetMetrics,
  trackInFlight,
  type DependencyProbes,
} from "../../src/lib/metrics.js";

describe("prometheus metrics (prom-client)", () => {
  it("counts requests by route/method/status and fills the latency histogram cumulatively", async () => {
    resetMetrics();
    recordRequest("/api/v1/auth/me", "GET", 200, 0.02);
    recordRequest("/api/v1/auth/me", "GET", 200, 0.2);
    recordRequest("/api/v1/auth/me", "GET", 401, 2);
    const text = await localMetrics();
    expect(text).toContain('http_requests_total{route="/api/v1/auth/me",method="GET",status="200"} 2');
    expect(text).toContain('http_requests_total{route="/api/v1/auth/me",method="GET",status="401"} 1');
    expect(text).toContain(
      'http_request_duration_seconds_bucket{le="0.025",route="/api/v1/auth/me",method="GET",status="200"} 1',
    );
    expect(text).toContain(
      'http_request_duration_seconds_bucket{le="0.3",route="/api/v1/auth/me",method="GET",status="200"} 2',
    );
    expect(text).toContain(
      'http_request_duration_seconds_bucket{le="+Inf",route="/api/v1/auth/me",method="GET",status="401"} 1',
    );
    expect(text).toContain('http_request_duration_seconds_count{route="/api/v1/auth/me",method="GET",status="200"} 2');
  });

  it("exports default Node metrics and the business/job series", async () => {
    resetMetrics();
    recordJobRun("DAILY_DUES", "FAILED", 1.5);
    const text = await localMetrics();
    for (const name of [
      "process_cpu_seconds_total",
      "nodejs_eventloop_lag_seconds",
      "nodejs_heap_size_used_bytes",
      "payments_posted_total",
      "logins_failed_total",
      "demands_raised_total",
      "db_pool_max_connections",
    ]) {
      expect(text, name).toContain(`# TYPE ${name}`);
    }
    expect(text).toContain('job_runs_total{job_name="DAILY_DUES",status="FAILED"} 1');
    expect(text).toContain('job_duration_seconds_bucket{le="5",job_name="DAILY_DUES"} 1');
  });

  it("dependency gauges come from one probe snapshot and demands_raised_total follows the database count monotonically", async () => {
    resetMetrics();
    let demands = 7;
    let queries = 0;
    const probes: DependencyProbes = {
      minIntervalSeconds: 0,
      query: async (text) => {
        queries += 1;
        if (text.includes("pg_stat_activity"))
          return [
            { state: "active", n: 3, max: 200 },
            { state: "idle", n: 9, max: 200 },
          ];
        if (text.includes("job_runs")) return [{ job_name: "DAILY_DUES", failures: 2, last_ok: 1_760_000_000 }];
        if (text.includes("integrity_runs")) return [{ findings: 4, last_run: 1_760_000_100 }];
        if (text.includes("from demands")) return [{ n: demands }];
        return [];
      },
      redis: {
        ping: async () => "PONG",
        pipeline: () => {
          const ops: number[] = [];
          return {
            llen: () => ops.push(1),
            zcard: () => ops.push(2),
            exec: async () => ops.map((_, i) => [null, i] as [null, number]),
          };
        },
      },
    };
    enableDependencyMetrics(probes);
    try {
      let text = await registry.metrics();
      expect(text).toContain("kkt_db_up 1");
      expect(text).toContain("kkt_redis_up 1");
      expect(text).toContain('kkt_db_connections{state="active"} 3');
      expect(text).toContain("kkt_db_max_connections 200");
      expect(text).toContain('kkt_job_failures_24h{job_name="DAILY_DUES"} 2');
      expect(text).toContain('kkt_job_last_success_timestamp_seconds{job_name="DAILY_DUES"} 1760000000');
      expect(text).toContain("kkt_integrity_findings 4");
      expect(text).toContain('kkt_jobs_queue_depth{queue="kkt-jobs",state="wait"} 0');
      expect(text).toContain('kkt_jobs_queue_depth{queue="kkt-jobs",state="failed"} 5');
      // the heavy queue (backups, exports, rebuilds, renditions) is reported next to the critical one
      expect(text).toContain('kkt_jobs_queue_depth{queue="kkt-jobs-heavy",state="wait"} 7');
      expect(text).toContain("demands_raised_total 7");
      expect(queries).toBeLessThanOrEqual(5); // one snapshot per scrape, shared by every gauge
      demands = 10;
      text = await registry.metrics();
      expect(text).toContain("demands_raised_total 10");
      expect((await demandsRaised.get()).values[0]?.value).toBe(10);
    } finally {
      disableDependencyMetrics();
    }
  });

  it("a failing database or Redis reports *_up 0 instead of failing the scrape", async () => {
    resetMetrics();
    enableDependencyMetrics({
      minIntervalSeconds: 0,
      query: async () => {
        throw new Error("connection refused");
      },
      redis: {
        ping: async () => {
          throw new Error("ECONNREFUSED");
        },
        pipeline: () => ({ llen: () => 0, zcard: () => 0, exec: async () => null }),
      },
    });
    try {
      const text = await registry.metrics();
      expect(text).toContain("kkt_db_up 0");
      expect(text).toContain("kkt_redis_up 0");
    } finally {
      disableDependencyMetrics();
    }
  });
});

describe("per-request metric bookkeeping (hot path)", () => {
  it("cached series keep counting after a registry reset, per route/method/status", async () => {
    resetMetrics();
    recordRequest("/api/v1/projects", "GET", 200, 0.01);
    resetMetrics();
    recordRequest("/api/v1/projects", "GET", 200, 0.01);
    recordRequest("/api/v1/projects", "GET", 200, 0.4);
    recordRequest("/api/v1/projects", "POST", 201, 0.01);
    const text = await localMetrics();
    expect(text).toContain('http_requests_total{route="/api/v1/projects",method="GET",status="200"} 2');
    expect(text).toContain('http_requests_total{route="/api/v1/projects",method="POST",status="201"} 1');
    expect(text).toContain(
      'http_request_duration_seconds_bucket{le="0.3",route="/api/v1/projects",method="GET",status="200"} 1',
    );
    expect(text).toContain('http_request_duration_seconds_count{route="/api/v1/projects",method="GET",status="200"} 2');
  });

  it("http_requests_in_flight is read at scrape time and released once per closed response", async () => {
    resetMetrics();
    const { EventEmitter } = await import("node:events");
    const inflight = async () => /http_requests_in_flight (\d+)/.exec(await localMetrics())?.[1];
    const base = Number(await inflight());
    const a = new EventEmitter();
    const b = new EventEmitter();
    trackInFlight(a);
    trackInFlight(b);
    expect(Number(await inflight())).toBe(base + 2);
    a.emit("close");
    a.emit("close"); // a second close never double-releases
    expect(Number(await inflight())).toBe(base + 1);
    b.emit("close");
    expect(Number(await inflight())).toBe(base);
  });
});
