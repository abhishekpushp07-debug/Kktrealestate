// API_MAX_INFLIGHT must be in the environment before the app (and its config module) is imported.
process.env["API_MAX_INFLIGHT"] = "1";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let token: string;
beforeAll(async () => { t = await buildTestApp(); token = (await t.loginAs("admin")).access_token; });
afterAll(async () => { await t?.close(); });

describe("load shedding (API_MAX_INFLIGHT, ARCHITECTURE §6)", () => {
  it("answers the excess of concurrent requests with 503 + Retry-After while admitted requests complete, then recovers", async () => {
    const burst = await Promise.all(Array.from({ length: 12 }, () => t.request<ErrorBody>("GET", "/api/v1/projects?page_size=5", { token })));
    const statuses = burst.map((r) => r.status);
    expect(statuses).toContain(200);
    expect(statuses).toContain(503);
    const shed = burst.find((r) => r.status === 503)!;
    expect(shed.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(shed.headers["retry-after"]).toBe("2");
    expect(shed.headers["x-request-id"]).toBeTruthy();
    // the counter is released on response: a lone request is admitted again
    const after = await t.request("GET", "/api/v1/projects?page_size=5", { token });
    expect(after.status).toBe(200);
    expect(t.app.inflightRequests?.()).toBe(0);
  });

  it("never sheds health probes", async () => {
    const [, health] = await Promise.all([t.request("GET", "/api/v1/projects?page_size=5", { token }), t.request<{ status: string }>("GET", "/health")]);
    expect(health.status).toBe(200);
  });
});
