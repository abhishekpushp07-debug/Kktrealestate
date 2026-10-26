import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe("system", () => {
  it("health reports dependency pings and version", async () => {
    const r = await t.request<{
      status: string;
      checks: Record<string, boolean>;
      db_ping_ms: number;
      version: string;
      uptime_seconds: number;
    }>("GET", "/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.checks).toEqual({ database: true, redis: true, storage: true });
    expect(r.body.db_ping_ms).toBeGreaterThanOrEqual(0);
    expect(r.headers["x-request-id"]).toBeTruthy();
  });

  it("ready answers 200 when dependencies are up", async () => {
    const r = await t.request<{ ready: boolean }>("GET", "/ready");
    expect(r.status).toBe(200);
    expect(r.body.ready).toBe(true);
  });

  it("openapi document lists every registered route and docs are public", async () => {
    const r = await t.request<{ openapi: string; paths: Record<string, Record<string, unknown>> }>(
      "GET",
      "/api/v1/openapi.json",
    );
    expect(r.status).toBe(200);
    expect(r.body.openapi).toMatch(/^3\./);
    const paths = r.body.paths;
    const missing: string[] = [];
    for (const entry of t.app.routeRegistry) {
      if (entry.url === "/api/v1/openapi.json" || entry.url.startsWith("/api/v1/docs")) continue;
      const oas = entry.url.replace(/:([A-Za-z_]+)/g, "{$1}");
      const methods = paths[oas];
      if (!methods || !methods[entry.method.toLowerCase()]) missing.push(`${entry.method} ${entry.url}`);
    }
    expect(missing).toEqual([]);
    const docs = await t.request("GET", "/api/v1/docs/");
    expect([200, 302]).toContain(docs.status);
  });

  it("metrics are Prometheus text for admin.tools and 403 otherwise", async () => {
    const admin = await t.loginAs("admin");
    await t.request("GET", "/api/v1/auth/me", { token: admin.access_token });
    const m = await t.request("GET", "/metrics", { token: admin.access_token });
    expect(m.status).toBe(200);
    expect(String(m.headers["content-type"])).toContain("text/plain");
    expect(m.text).toContain('http_requests_total{route="/api/v1/auth/me",method="GET",status="200"}');
    expect(m.text).toContain("http_request_duration_seconds_bucket");
    expect(m.text).toMatch(/le="0\.05"/);
    const sales = await t.loginAs("sales");
    const denied = await t.request<{ error: { code: string } }>("GET", "/metrics", { token: sales.access_token });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("unknown routes get the error envelope and no auth is demanded", async () => {
    const r = await t.request<{ error: { code: string; request_id: string } }>("GET", "/api/v1/nope");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect(r.body.error.request_id).toBeTruthy();
  });

  it("route registry endpoint needs admin.tools", async () => {
    const admin = await t.loginAs("admin");
    const r = await t.request<{ items: { method: string; url: string; permission: string | null }[] }>(
      "GET",
      "/api/v1/system/routes",
      { token: admin.access_token },
    );
    expect(r.status).toBe(200);
    expect(
      r.body.items.some(
        (i) => i.url === "/api/v1/masters/room-types" && i.method === "POST" && i.permission === "master.write",
      ),
    ).toBe(true);
  });
});
