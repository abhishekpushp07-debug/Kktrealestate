import { describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { deprecationHeaders } from "../../src/lib/routes.js";
import { effectiveConfig, redactUrl } from "../../src/modules/system/bootConfig.js";
import { startMetricsServer } from "../../src/modules/system/metricsServer.js";
import { ErrorReporter, sanitizeMessage } from "../../src/plugins/errorReporter.js";
import { isMetricsToken } from "../../src/plugins/telemetry.js";

describe("error reporter", () => {
  it("sanitises personal data, credentials and identifiers out of messages", () => {
    const raw = 'duplicate key value violates unique constraint "customers_company_phone_live_uq" Key (company_id, phone)=(5f0c, 9876543210) ravi.kumar@example.com PAN ABCDE1234F aadhaar 1234 5678 9012 +91 98765 43210 token=abc.def eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ postgres://kkt_app:s3cret@db:5432/kkt id 3f2b8c1e-0c4a-4b7e-9a51-2a4f0e8b9c7d';
    const s = sanitizeMessage(raw, 1000);
    for (const leaked of ["9876543210", "ravi.kumar@example.com", "ABCDE1234F", "1234 5678 9012", "s3cret", "eyJhbGci", "abc.def", "3f2b8c1e-0c4a"]) expect(s).not.toContain(leaked);
    expect(s).toContain("customers_company_phone_live_uq");
    expect(s).toContain("<pan>");
    expect(s).toContain("<email>");
    expect(sanitizeMessage("x".repeat(400)).length).toBe(300);
  });

  it("redacts the way Indian personal data is actually written (spaced/hyphenated numbers, lower-case PAN, auth schemes)", () => {
    const cases: [string, string][] = [
      ["phone 98765 43210 failed", "phone <phone> failed"],
      ["call 98765-43210 now", "call <phone> now"],
      ["mobile +91 98765 43210", "mobile <phone>"],
      ["mobile 09876543210", "mobile <phone>"],
      ["aadhaar 1234-5678-9012", "aadhaar <aadhaar>"],
      ["pan abcde1234f rejected", "pan <pan> rejected"],
      ["Authorization: Basic dXNlcjpwYXNz", "<secret>"],
      ["Bearer abc.def.ghi", "<secret>"],
      ["cookie=sessionid123", "<secret>"],
      ["api-key=zzz", "<secret>"],
    ];
    for (const [raw, expected] of cases) expect(sanitizeMessage(raw), raw).toBe(expected);
    // ordinary diagnostics survive
    expect(sanitizeMessage("connection timeout after 5000ms")).toBe("connection timeout after 5000ms");
    expect(sanitizeMessage('relation "demands" does not exist')).toBe('relation "demands" does not exist');
    expect(sanitizeMessage("pincode 560001 invalid")).toBe("pincode 560001 invalid");
  });

  it("posts a Slack-compatible message, de-duplicates repeats and rate-limits per minute", async () => {
    let now = 1_000_000;
    const posted: { url: string; body: { text: string; kkt: Record<string, unknown> } }[] = [];
    const reporter = new ErrorReporter({
      url: "https://hooks.example/abc",
      perMinute: 2,
      dedupeSeconds: 60,
      now: () => now,
      version: "2.0.0",
      fetchImpl: (async (url: string, init: { body: string }) => { posted.push({ url, body: JSON.parse(init.body) }); return new Response("ok"); }) as unknown as typeof fetch,
    });
    const ev = (where: string) => ({ kind: "http" as const, id: "req-1", where, status: 500, errorClass: "TypeError", message: "boom" });
    expect(reporter.report(ev("GET /api/v1/a"))).toBe(true);
    expect(reporter.report(ev("GET /api/v1/a"))).toBe(false); // duplicate inside the window
    expect(reporter.report(ev("GET /api/v1/b"))).toBe(true);
    expect(reporter.report(ev("GET /api/v1/c"))).toBe(false); // bucket empty (2/min)
    await Promise.all(reporter.pending);
    expect(posted).toHaveLength(2);
    expect(posted[0]!.body.text).toContain("500 GET /api/v1/a — TypeError: boom (id req-1)");
    expect(posted[0]!.body.kkt).toMatchObject({ kind: "http", id: "req-1", where: "GET /api/v1/a", status: 500, error_class: "TypeError", version: "2.0.0" });
    now += 61_000; // window passed, bucket refilled
    expect(reporter.report(ev("GET /api/v1/a"))).toBe(true);
    await Promise.all(reporter.pending);
    expect(posted[2]!.body.kkt).toMatchObject({ suppressed_repeats: 1, dropped_by_rate_limit: 1 });
    expect(posted[2]!.body.text).toContain("1 similar suppressed");
  });

  it("never throws when the webhook is down", async () => {
    const reporter = new ErrorReporter({ url: "https://hooks.example/x", fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
    expect(reporter.report({ kind: "job", id: "run-1", where: "DAILY_DUES", errorClass: "Error", message: "x" })).toBe(true);
    await expect(Promise.all(reporter.pending)).resolves.toBeDefined();
  });
});

describe("deprecation headers (RFC 9745 / RFC 8594)", () => {
  it("emits Deprecation @epoch, Sunset HTTP-date and Link relations", () => {
    const h = deprecationHeaders({ sunset: "2027-06-30", since: "2026-11-01", replacement: "GET /api/v1/bookings?view=compact" });
    expect(h["Deprecation"]).toBe(`@${Date.UTC(2026, 10, 1) / 1000}`);
    expect(h["Sunset"]).toBe("Wed, 30 Jun 2027 00:00:00 GMT");
    expect(h["Link"]).toBe('</api/v1/docs>; rel="deprecation"; type="text/html", </api/v1/bookings?view=compact>; rel="successor-version"');
  });

  it("defaults `since` to the 180-day window and rejects bad dates", () => {
    expect(deprecationHeaders({ sunset: "2027-06-30" })["Deprecation"]).toBe(`@${(Date.UTC(2027, 5, 30) - 180 * 86_400_000) / 1000}`);
    expect(() => deprecationHeaders({ sunset: "someday" })).toThrow(/invalid date/);
    expect(() => deprecationHeaders({ sunset: "2027-01-01", since: "2027-02-01" })).toThrow(/after/);
  });
});

describe("boot configuration log", () => {
  it("never contains a secret and strips credentials from URLs", () => {
    const c = { ...config, DATABASE_URL: "postgres://kkt_app:pa55word@pgbouncer:6432/kkt?sslmode=require", REDIS_URL: "redis://:redispass@redis:6379/0", METRICS_TOKEN: "metrics-secret-0123456789", ERROR_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/XXXX" };
    const text = JSON.stringify(effectiveConfig(c, { role: "single", workers: 1 }));
    for (const secret of ["pa55word", "redispass", "metrics-secret", "XXXX", config.JWT_SECRET, config.HASH_KEY, config.FIELD_ENCRYPTION_KEY]) expect(text).not.toContain(secret);
    expect(text).toContain('"database":"postgres://pgbouncer:6432/kkt"');
    expect(text).toContain('"metrics_token":"set"');
    expect(redactUrl("not a url")).toBe("<invalid>");
  });
});

describe("metrics listener (METRICS_PORT)", () => {
  it("serves the rendered text, requires the bearer when a token is set, 404s other paths", async () => {
    const log = { info: () => undefined, warn: () => undefined };
    const server = await startMetricsServer({ port: 0, host: "127.0.0.1", render: async () => "up 1\n", contentType: "text/plain; version=0.0.4", token: "metrics-token-0123456789", log });
    expect(server).not.toBeNull();
    const port = (server!.address() as { port: number }).port;
    try {
      const base = `http://127.0.0.1:${port}`;
      expect((await fetch(`${base}/metrics`)).status).toBe(401);
      const ok = await fetch(`${base}/metrics`, { headers: { authorization: "Bearer metrics-token-0123456789" } });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("up 1\n");
      expect((await fetch(`${base}/other`, { headers: { authorization: "Bearer metrics-token-0123456789" } })).status).toBe(404);
      // a taken port is logged, not fatal
      const warned: unknown[] = [];
      const second = await startMetricsServer({ port, host: "127.0.0.1", render: async () => "", contentType: "text/plain", log: { info: () => undefined, warn: (o) => warned.push(o) } });
      expect(second).toBeNull();
      expect(warned).toHaveLength(1);
    } finally {
      await new Promise((r) => server!.close(r));
    }
  });

  it("compares the token in constant time and only for the Bearer scheme", () => {
    expect(isMetricsToken("Bearer abcdefghijklmnop", "abcdefghijklmnop")).toBe(true);
    expect(isMetricsToken("bearer abcdefghijklmnop", "abcdefghijklmnop")).toBe(true);
    expect(isMetricsToken("Basic abcdefghijklmnop", "abcdefghijklmnop")).toBe(false);
    expect(isMetricsToken("Bearer abcdefghijklmnoq", "abcdefghijklmnop")).toBe(false);
    expect(isMetricsToken("Bearer abcdefghijklmnop", undefined)).toBe(false);
    expect(isMetricsToken(undefined, "abcdefghijklmnop")).toBe(false);
  });
});
