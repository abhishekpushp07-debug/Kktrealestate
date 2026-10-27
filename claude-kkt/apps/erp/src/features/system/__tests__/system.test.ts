import { describe, expect, it } from "vitest";
import { exportErrorMessage, exportMode } from "@/components/ui/export-control";
import { parseErrorEnvelope } from "@/lib/api";
import { exportSourceLabel, hasActive } from "../api";
import { histogramQuantile, parsePrometheus, summariseMetrics } from "../metrics";

const SAMPLE = `# HELP http_requests_total HTTP requests
# TYPE http_requests_total counter
http_requests_total{route="/api/v1/bookings",method="GET",status="200"} 90
http_requests_total{route="/api/v1/payments",method="POST",status="500"} 2
http_requests_total{route="/api/v1/auth/login",method="POST",status="503"} 1
http_requests_in_flight 3
http_request_duration_seconds_bucket{route="/a",le="0.05"} 50
http_request_duration_seconds_bucket{route="/a",le="0.1"} 90
http_request_duration_seconds_bucket{route="/a",le="0.5"} 100
http_request_duration_seconds_bucket{route="/a",le="+Inf"} 100
payments_posted_total 7
logins_failed_total{audience="erp"} 4
logins_failed_total{audience="portal"} 1
demands_raised_total 58
kkt_db_up 1
kkt_redis_up 0
kkt_db_connections{state="active"} 4
kkt_db_connections{state="idle"} 6
kkt_db_max_connections 100
kkt_integrity_findings 0
kkt_job_failures_24h{job="DAILY_DUES"} 2
kkt_jobs_queue_depth{state="waiting"} 1
kkt_jobs_queue_depth{state="active"} 2
nodejs_eventloop_lag_p99_seconds 0.0214
process_resident_memory_bytes 462221312
weird line without value
`;

describe("Prometheus summary (System health page)", () => {
  it("parses samples with labels and skips comments / junk", () => {
    const samples = parsePrometheus(SAMPLE);
    expect(
      samples.find((sample) => sample.name === "kkt_db_connections" && sample.labels.state === "idle")?.value,
    ).toBe(6);
    expect(samples.some((sample) => sample.name === "weird")).toBe(false);
  });

  it("interpolates a histogram quantile from cumulative buckets", () => {
    const samples = parsePrometheus(SAMPLE);
    // 95th of 100 observations falls in the 0.1–0.5 bucket (90 → 100): 0.1 + 0.4 × 5/10
    expect(histogramQuantile(samples, "http_request_duration_seconds", 0.95)).toBeCloseTo(0.3, 5);
    expect(histogramQuantile(samples, "missing_metric", 0.95)).toBeNull();
  });

  it("summarises the numbers the page shows", () => {
    const summary = summariseMetrics(SAMPLE);
    expect(summary).toMatchObject({
      requests_total: 93,
      requests_5xx: 3,
      requests_in_flight: 3,
      request_p95_ms: 300,
      payments_posted: 7,
      logins_failed: 5,
      demands_raised: 58,
      db_up: true,
      redis_up: false,
      db_connections: 10,
      db_max_connections: 100,
      integrity_findings: 0,
      job_failures_24h: 2,
      queue_depth: { waiting: 1, active: 2 },
      event_loop_lag_p99_ms: 21.4,
      resident_memory_bytes: 462221312,
    });
    expect(summariseMetrics("").requests_total).toBeNull();
  });
});

describe("jobs / backups / exports helpers", () => {
  it("polls while anything is queued or running", () => {
    expect(hasActive([{ status: "DONE" }, { status: "QUEUED" }])).toBe(true);
    expect(hasActive([{ status: "OK" }, { status: "FAILED" }])).toBe(false);
    expect(hasActive(undefined)).toBe(false);
  });

  it("labels an export by its list path", () => {
    expect(exportSourceLabel("/api/v1/customers")).toBe("Customers");
    expect(exportSourceLabel("/api/v1/reports/login-events")).toBe("Reports › login events");
  });

  it("switches the toolbar to the background export above 10,000 rows", () => {
    expect(exportMode(10_000)).toBe("sync");
    expect(exportMode(10_001)).toBe("async");
    expect(exportMode(undefined)).toBe("sync");
  });

  it("explains the 3-running-exports limit (429)", () => {
    expect(
      exportErrorMessage(
        parseErrorEnvelope(429, {
          error: { code: "RATE_LIMITED", message: "m", details: { retry_after: 60, limit: 3 } },
        }),
      ),
    ).toMatch(/already have 3 exports running/);
    expect(
      exportErrorMessage(
        parseErrorEnvelope(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "bad",
            details: { issues: [{ path: "path", message: "Not a list route" }] },
          },
        }),
      ),
    ).toBe("path: Not a list route");
  });
});
