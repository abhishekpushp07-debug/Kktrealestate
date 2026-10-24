import { describe, expect, it } from "vitest";
import { recordRequest, renderPrometheus, resetMetrics } from "../../src/lib/metrics.js";

describe("prometheus rendering", () => {
  it("counts requests by route/status and fills histogram buckets cumulatively", () => {
    resetMetrics();
    recordRequest("/api/v1/auth/me", "GET", 200, 0.02);
    recordRequest("/api/v1/auth/me", "GET", 200, 0.2);
    recordRequest("/api/v1/auth/me", "GET", 401, 2);
    const text = renderPrometheus({ custom_gauge: 7 });
    expect(text).toContain('http_requests_total{route="/api/v1/auth/me",method="GET",status="200"} 2');
    expect(text).toContain('http_requests_total{route="/api/v1/auth/me",method="GET",status="401"} 1');
    expect(text).toContain('http_request_duration_seconds_bucket{route="/api/v1/auth/me",method="GET",le="0.05"} 1');
    expect(text).toContain('http_request_duration_seconds_bucket{route="/api/v1/auth/me",method="GET",le="0.3"} 2');
    expect(text).toContain('http_request_duration_seconds_bucket{route="/api/v1/auth/me",method="GET",le="3"} 3');
    expect(text).toContain('http_request_duration_seconds_bucket{route="/api/v1/auth/me",method="GET",le="+Inf"} 3');
    expect(text).toContain("http_request_duration_seconds_count{route=\"/api/v1/auth/me\",method=\"GET\"} 3");
    expect(text).toContain("custom_gauge 7");
  });
});
