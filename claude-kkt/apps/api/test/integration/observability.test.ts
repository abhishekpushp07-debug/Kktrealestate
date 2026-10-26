// Environment must be set before the app (and its config module) is imported.
process.env["METRICS_TOKEN"] = "metrics-token-integration-0123456789";
process.env["ERROR_WEBHOOK_URL"] = "http://127.0.0.1:4919/hook";
process.env["KKT_MODULES"] = "web";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../../src/lib/errors.js";
import { goneRoute, route } from "../../src/lib/routes.js";
import { resetLifecycle, startDraining } from "../../src/modules/system/lifecycle.js";
import { gracefulShutdown } from "../../src/modules/system/shutdown.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

const TOKEN = process.env["METRICS_TOKEN"]!;
let t: TestContext;
let hook: Server;
const posts: { kkt: Record<string, unknown>; text: string }[] = [];

beforeAll(async () => {
  hook = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      posts.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.end("ok");
    });
  });
  await new Promise<void>((r) => hook.listen(4919, "127.0.0.1", r));
  t = await buildTestApp({
    extraRoutes: (api) => {
      // stand-ins with the payment route's URL (the money module is not loaded in this file: KKT_MODULES=web)
      route(api, {
        method: "POST",
        url: "/payments",
        public: true,
        schema: {
          querystring: z.object({ replay: z.string().optional() }),
          response: { 201: z.object({ ok: z.boolean() }) },
        },
        handler: async (req, reply) => {
          if (req.query.replay) reply.header("Idempotent-Replayed", "true");
          return reply.code(201).send({ ok: true });
        },
      });
      route(api, {
        method: "GET",
        url: "/test/boom",
        public: true,
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => {
          throw new Error("insert failed: Key (phone)=(9876543210) already exists for ravi@example.com PAN ABCDE1234F");
        },
      });
      route(api, {
        method: "GET",
        url: "/test/busy",
        public: true,
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => {
          throw ApiError.unavailable("busy", 2);
        },
      });
      route(api, {
        method: "GET",
        url: "/test/old",
        public: true,
        deprecated: { sunset: "2027-06-30", since: "2026-11-01", replacement: "GET /api/v1/test/new" },
        schema: { response: { 200: z.object({ ok: z.boolean() }) }, summary: "Old thing" },
        handler: async () => ({ ok: true }),
      });
      route(api, {
        method: "GET",
        url: "/test/old-staff",
        permission: "admin.tools",
        deprecated: { sunset: "2027-06-30" },
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => ({ ok: true }),
      });
      goneRoute(api, {
        method: "GET",
        url: "/test/retired",
        sunset: "2026-01-31",
        replacement: "GET /api/v1/test/new",
      });
      route(api, {
        method: "GET",
        url: "/test/slow",
        public: true,
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => {
          await new Promise((r) => setTimeout(r, 600));
          return { ok: true };
        },
      });
    },
  });
});

afterAll(async () => {
  resetLifecycle();
  await t?.close().catch(() => undefined);
  await new Promise((r) => hook?.close(r));
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
}

describe("metrics endpoint (prom-client, METRICS_TOKEN or admin.tools)", () => {
  it("a scraper with the METRICS_TOKEN bearer reads metrics without a staff session, on both paths", async () => {
    await t.request("GET", "/api/v1/public/projects");
    for (const url of ["/api/v1/metrics", "/metrics"]) {
      const m = await t.request("GET", url, { headers: { authorization: `Bearer ${TOKEN}` } });
      expect(m.status).toBe(200);
      expect(String(m.headers["content-type"])).toContain("text/plain; version=0.0.4");
      expect(m.text).toContain('http_requests_total{route="/api/v1/public/projects",method="GET",status="200"}');
      expect(m.text).toContain("# TYPE http_request_duration_seconds histogram");
      expect(m.text).toContain("# TYPE nodejs_eventloop_lag_seconds gauge");
      expect(m.text).toContain("# TYPE payments_posted_total counter");
    }
  });

  it("a wrong token falls through to staff authentication (401); staff need admin.tools (403 otherwise)", async () => {
    const wrong = await t.request<ErrorBody>("GET", "/api/v1/metrics", {
      headers: { authorization: "Bearer metrics-token-integration-WRONG" },
    });
    expect(wrong.status).toBe(401);
    expect((await t.request("GET", "/api/v1/metrics")).status).toBe(401);
    const admin = await t.loginAs("admin");
    expect((await t.request("GET", "/api/v1/metrics", { token: admin.access_token })).status).toBe(200);
    const sales = await t.loginAs("sales");
    expect((await t.request<ErrorBody>("GET", "/api/v1/metrics", { token: sales.access_token })).body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("business counters: payments posted (replays excluded) and failed logins by audience", async () => {
    const scrape = async () =>
      (await t.request("GET", "/api/v1/metrics", { headers: { authorization: `Bearer ${TOKEN}` } })).text;
    const value = (text: string, series: string) =>
      Number(new RegExp(`^${series.replace(/[{}"=]/g, (c) => `\\${c}`)} (\\d+)`, "m").exec(text)?.[1] ?? 0);
    const before = await scrape();
    await t.request("POST", "/api/v1/payments", { body: {} });
    await t.request("POST", "/api/v1/payments", { body: {} });
    await t.request("POST", "/api/v1/payments?replay=1", { body: {} });
    await t.request("POST", "/api/v1/auth/login", { body: { email: "admin@sgb.in", password: "definitely-wrong-1" } });
    const after = await scrape();
    expect(value(after, "payments_posted_total") - value(before, "payments_posted_total")).toBe(2);
    expect(
      value(after, 'logins_failed_total{audience="erp"}') - value(before, 'logins_failed_total{audience="erp"}'),
    ).toBe(1);
  });
});

describe("error reporter (ERROR_WEBHOOK_URL)", () => {
  it("posts a 5xx with request id, route pattern and a sanitised message; never 4xx or 503; repeats are de-duplicated", async () => {
    posts.length = 0;
    const r = await t.request<ErrorBody>("GET", "/api/v1/test/boom?phone=9876543210");
    expect(r.status).toBe(500);
    await waitFor(() => posts.length >= 1);
    expect(posts).toHaveLength(1);
    const ev = posts[0]!.kkt;
    expect(ev).toMatchObject({
      kind: "http",
      id: r.body.error.request_id,
      where: "GET /api/v1/test/boom",
      status: 500,
      error_class: "Error",
    });
    const all = JSON.stringify(posts[0]);
    for (const leaked of ["9876543210", "ravi@example.com", "ABCDE1234F", "phone="]) expect(all).not.toContain(leaked);
    await t.request("GET", "/api/v1/test/boom");
    await t.request("GET", "/api/v1/test/busy");
    await t.request("GET", "/api/v1/nope");
    await t.request("POST", "/api/v1/auth/login", { body: { email: "x@y.in", password: "wrong-wrong-1" } });
    await new Promise((res) => setTimeout(res, 200));
    expect(posts).toHaveLength(1);
  });
});

describe("API versioning: deprecated and retired routes", () => {
  it("a deprecated route answers normally with Deprecation, Sunset and Link headers and is flagged in OpenAPI and the registry", async () => {
    const r = await t.request<{ ok: boolean }>("GET", "/api/v1/test/old");
    expect(r.status).toBe(200);
    expect(r.headers["deprecation"]).toBe(`@${Date.UTC(2026, 10, 1) / 1000}`);
    expect(r.headers["sunset"]).toBe("Wed, 30 Jun 2027 00:00:00 GMT");
    expect(String(r.headers["link"])).toContain('rel="successor-version"');
    const doc = await t.request<{ paths: Record<string, { get?: { deprecated?: boolean; description?: string } }> }>(
      "GET",
      "/api/v1/openapi.json",
    );
    expect(doc.body.paths["/api/v1/test/old"]?.get?.deprecated).toBe(true);
    expect(doc.body.paths["/api/v1/test/old"]?.get?.description).toContain("Sunset");
    expect(t.app.routeRegistry.find((e) => e.url === "/api/v1/test/old")?.sunset).toBe("2027-06-30");
  });

  it("a deprecated staff route announces the deprecation on every answer, also when authentication rejects the request", async () => {
    const anonymous = await t.request<ErrorBody>("GET", "/api/v1/test/old-staff");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["sunset"]).toBe("Wed, 30 Jun 2027 00:00:00 GMT");
    expect(anonymous.headers["deprecation"]).toBe(`@${(Date.UTC(2027, 5, 30) - 180 * 86_400_000) / 1000}`);
    const sales = await t.loginAs("sales");
    const forbidden = await t.request<ErrorBody>("GET", "/api/v1/test/old-staff", { token: sales.access_token });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers["sunset"]).toBe("Wed, 30 Jun 2027 00:00:00 GMT");
    const admin = await t.loginAs("admin");
    const ok = await t.request("GET", "/api/v1/test/old-staff", { token: admin.access_token });
    expect(ok.status).toBe(200);
    expect(ok.headers["sunset"]).toBe("Wed, 30 Jun 2027 00:00:00 GMT");
    // cross-origin browser clients may read them
    const cors = await t.request("GET", "/api/v1/test/old", {
      headers: { origin: process.env["ERP_ORIGIN"] ?? "http://localhost:5173" },
    });
    const exposed = String(cors.headers["access-control-expose-headers"] ?? "");
    for (const h of ["Deprecation", "Sunset", "Link", "X-Trace-Id"]) expect(exposed).toContain(h);
    // a non-deprecated route never carries the headers
    expect((await t.request("GET", "/api/v1/public/projects")).headers["sunset"]).toBeUndefined();
    // the OpenAPI operation carries the machine-readable sunset the compatibility gate uses for retirements
    const doc = await t.request<{ paths: Record<string, { get?: Record<string, unknown> }> }>(
      "GET",
      "/api/v1/openapi.json",
    );
    expect(doc.body.paths["/api/v1/test/old-staff"]?.get?.["x-sunset"]).toBe("2027-06-30");
  });

  it("a retired route answers 410 GONE with the replacement", async () => {
    const r = await t.request<ErrorBody>("GET", "/api/v1/test/retired");
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("GONE");
    expect(r.body.error.details).toMatchObject({ sunset: "2026-01-31", replacement: "GET /api/v1/test/new" });
    expect(r.headers["sunset"]).toBe("Sat, 31 Jan 2026 00:00:00 GMT");
  });
});

describe("security headers", () => {
  it("API responses deny everything in CSP and framing; the docs UI gets a policy for its own assets", async () => {
    const api = await t.request("GET", "/api/v1/public/projects");
    expect(api.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    expect(api.headers["x-content-type-options"]).toBe("nosniff");
    const err = await t.request("GET", "/api/v1/nope");
    expect(err.headers["content-security-policy"]).toContain("default-src 'none'");
    const docs = await t.request("GET", "/api/v1/docs/");
    expect(docs.status).toBe(200);
    const csp = String(docs.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("default-src 'none'");
  });
});

describe("lifecycle: readiness while draining and graceful shutdown", () => {
  it("/ready answers 503 once the process is draining", async () => {
    startDraining();
    try {
      const r = await t.request<ErrorBody>("GET", "/api/v1/ready");
      expect(r.status).toBe(503);
      expect(r.headers["retry-after"]).toBe("5");
      expect((await t.request("GET", "/api/v1/health")).status).toBe(200); // liveness is unaffected
    } finally {
      resetLifecycle();
    }
  });

  it("shutdown lets an in-flight request finish, refuses new connections, then closes the pools", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (t.app.server.address() as { port: number }).port;
    const inflight = fetch(`http://127.0.0.1:${port}/api/v1/test/slow`).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as unknown,
    }));
    await new Promise((r) => setTimeout(r, 100));
    const exits: number[] = [];
    const order: string[] = [];
    const done = gracefulShutdown(
      {
        app: t.app,
        jobs: {
          close: async () => {
            order.push("jobs");
          },
        },
        after: [
          () => {
            order.push("after");
          },
        ],
        log: { info: () => undefined, error: () => undefined },
        settings: { timeoutMs: 10_000, drainDelayMs: 0 },
        exit: (c) => {
          exits.push(c);
        },
        inflight: () => t.app.inflightRequests?.() ?? 0,
      },
      "SIGTERM",
    );
    await new Promise((r) => setTimeout(r, 50));
    const refused = await fetch(`http://127.0.0.1:${port}/api/v1/health`).then(
      () => "connected",
      () => "refused",
    );
    expect(refused).toBe("refused");
    expect(await inflight).toEqual({ status: 200, body: { ok: true } });
    await done;
    expect(exits).toEqual([0]);
    expect(order).toEqual(["jobs", "after"]);
    await expect(t.app.sql`select 1`).rejects.toThrow();
  });
});
