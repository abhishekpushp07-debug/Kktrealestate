// API_MAX_INFLIGHT / API_SHED_EVENT_LOOP_DELAY_MS must be in the environment before the app (and its config module) is imported.
process.env["API_MAX_INFLIGHT"] = "1";
process.env["API_SHED_EVENT_LOOP_DELAY_MS"] = "100";
import type { AddressInfo } from "node:net";
import autocannon from "autocannon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let token: string;
beforeAll(async () => {
  t = await buildTestApp({
    extraRoutes: (api) => {
      // blocks the event loop synchronously for `ms` (an in-request CPU hog), to drive the event-loop pressure detector
      api.get<{ Querystring: { ms?: string } }>("/test/block", { config: { public: true } }, async (req) => {
        const until = performance.now() + Number(req.query.ms ?? 0);
        while (performance.now() < until) {
          // busy wait
        }
        return { ok: true };
      });
    },
  });
  token = (await t.loginAs("admin")).access_token;
});
afterAll(async () => {
  await t?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `check` every 20 ms until it is true; returns the time it took (ms), or throws after `ms`. */
async function waitFor(check: () => boolean, ms: number, what: string): Promise<number> {
  const t0 = performance.now();
  while (!check()) {
    if (performance.now() - t0 > ms) throw new Error(`${what} not reached within ${ms} ms`);
    await sleep(20);
  }
  return performance.now() - t0;
}

describe("load shedding (API_MAX_INFLIGHT, ARCHITECTURE §6)", () => {
  it("answers the excess of concurrent requests with 503 + Retry-After while admitted requests complete, then recovers", async () => {
    const burst = await Promise.all(
      Array.from({ length: 12 }, () => t.request<ErrorBody>("GET", "/api/v1/projects?page_size=5", { token })),
    );
    const statuses = burst.map((r) => r.status);
    expect(statuses).toContain(200);
    expect(statuses).toContain(503);
    const shed = burst.find((r) => r.status === 503)!;
    expect(shed.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(shed.body.error.request_id).toBe(shed.headers["x-request-id"]);
    expect(shed.headers["retry-after"]).toBe("2");
    expect(shed.headers["x-request-id"]).toBeTruthy();
    expect(shed.headers["content-type"]).toContain("application/json");
    // the counter is released on response: a lone request is admitted again
    const after = await t.request("GET", "/api/v1/projects?page_size=5", { token });
    expect(after.status).toBe(200);
    expect(t.app.inflightRequests?.()).toBe(0);
    expect(t.app.loadShedState?.().shed.inflight).toBeGreaterThan(0);
  });

  it("never sheds health probes", async () => {
    const [, health] = await Promise.all([
      t.request("GET", "/api/v1/projects?page_size=5", { token }),
      t.request<{ status: string }>("GET", "/health"),
    ]);
    expect(health.status).toBe(200);
  });

  it("counts shed requests in http_requests_total{status=503} and http_requests_shed_total", async () => {
    await Promise.all(Array.from({ length: 8 }, () => t.request("GET", "/api/v1/projects?page_size=5", { token })));
    const text = (await t.request("GET", "/api/v1/metrics", { token })).text;
    expect(text).toMatch(/http_requests_total\{route="\/api\/v1\/projects",method="GET",status="503"\} [1-9]/);
    expect(text).toMatch(/http_requests_shed_total\{reason="inflight"\} [1-9]/);
  });

  it("sustained saturation over real HTTP: probes stay 200 throughout, and the server admits requests again as soon as the load stops", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    const headers = { authorization: `Bearer ${token}` };
    const probes: number[] = [];
    let loading = true;
    const probing = (async () => {
      while (loading) {
        for (const path of ["/api/v1/health", "/api/v1/ready", "/metrics"]) {
          const r = await fetch(base + path, {
            headers: path === "/metrics" ? headers : {},
            signal: AbortSignal.timeout(5000),
          });
          await r.arrayBuffer();
          probes.push(r.status);
        }
        await sleep(100);
      }
    })();
    const result = await autocannon({ url: `${base}/api/v1/auth/me`, connections: 100, duration: 4, headers });
    loading = false;
    await probing;
    // the load was mostly shed (cap 1), the shed answers were 503s, and nothing hung
    expect(result.non2xx).toBeGreaterThan(result.requests.total / 2);
    expect(result.timeouts).toBe(0);
    expect(result.errors).toBe(0);
    expect(probes.length).toBeGreaterThan(5);
    expect(probes.every((s) => s === 200)).toBe(true);
    // recovery: no latch, the very next requests are admitted
    const recovered = await waitFor(() => t.app.inflightRequests?.() === 0, 2000, "in-flight back to 0");
    expect(recovered).toBeLessThan(2000);
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`${base}/api/v1/auth/me`, { headers });
      await r.arrayBuffer();
      expect(r.status).toBe(200);
    }
  });
});

describe("event-loop pressure (API_SHED_EVENT_LOOP_DELAY_MS, hysteresis)", () => {
  it("sustained event-loop lag turns pressure on; probes and a lone request are still served; pressure ends by itself", async () => {
    const before = t.app.loadShedState!();
    expect(before.pressure).toBe(false);
    // sustained lag (the overload case): back-to-back 300 ms stalls, so every 500 ms window's mean delay is far over the 100 ms threshold
    for (let i = 0; i < 5; i += 1) expect((await t.request("GET", "/api/v1/test/block?ms=300")).status).toBe(200);
    const state = t.app.loadShedState!();
    expect(state.pressureEpisodes).toBeGreaterThan(before.pressureEpisodes);
    if (state.pressure) {
      expect(state.eventLoopDelayMs).toBeGreaterThan(100);
      expect(state.cap).toBe(1); // a quarter of the cap, but never above it (and never 0: work always continues)
      // bounded: under pressure the probes are never shed and a lone request is admitted
      expect((await t.request("GET", "/api/v1/ready")).status).toBe(200);
      expect((await t.request("GET", "/api/v1/projects?page_size=5", { token })).status).toBe(200);
    }
    // self-recovering: the next quiet window (mean delay under 50 ms) ends it
    const took = await waitFor(() => t.app.loadShedState?.().pressure === false, 2000, "pressure off");
    expect(took).toBeLessThan(2000);
    expect(t.app.loadShedState?.().cap).toBe(1);
    expect((await t.request("GET", "/api/v1/projects?page_size=5", { token })).status).toBe(200);
  });

  it("a single short stall is averaged out: no pressure", async () => {
    const before = t.app.loadShedState!().pressureEpisodes;
    await sleep(600); // start from a fresh window
    expect((await t.request("GET", "/api/v1/test/block?ms=30")).status).toBe(200);
    await sleep(1100);
    expect(t.app.loadShedState!().pressureEpisodes).toBe(before);
  });
});
