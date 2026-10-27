// Audit v3 H4 in the portal: root ErrorBoundary + client error reports (contract C2), React Query retries that honour Retry-After.
import fs from "node:fs";
import path from "node:path";
import { ClientErrorReportSchema } from "@kkt/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import { MAX_RETRY_AFTER_MS, queryRetryDelay, shouldRetryQuery } from "@/api/retry";
import {
  buildClientErrorReport,
  createReporter,
  installGlobalErrorReporting,
  MAX_REPORTS,
  pagePath,
  sampleRateOf,
  type ReporterEnv,
} from "@/lib/errorReporting";

const api = (status: number, retryAfterSeconds?: number) =>
  new ApiError({ status, code: status === 429 ? "RATE_LIMITED" : "X", message: "m", retryAfterSeconds });

describe("retry policy", () => {
  it("never retries a 4xx other than a throttled 429", () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422]) expect(shouldRetryQuery(0, api(status))).toBe(false);
    expect(shouldRetryQuery(0, api(429))).toBe(false); // no Retry-After: do not hammer
  });
  it("waits for Retry-After on 429 / 503, at most twice and only for short waits", () => {
    expect(shouldRetryQuery(0, api(429, 3))).toBe(true);
    expect(queryRetryDelay(0, api(429, 3))).toBe(3000);
    expect(shouldRetryQuery(2, api(503, 3))).toBe(false);
    expect(shouldRetryQuery(0, api(503, 120))).toBe(false);
    expect(queryRetryDelay(0, api(503, 0))).toBe(250);
    expect(queryRetryDelay(0, api(503, 31))).toBe(MAX_RETRY_AFTER_MS);
    expect(shouldRetryQuery(0, api(503))).toBe(true);
    expect(shouldRetryQuery(1, api(503))).toBe(false);
  });
  it("retries 5xx and network failures twice with backoff", () => {
    expect(shouldRetryQuery(0, api(500))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError({ status: 0, code: "NETWORK", message: "x" }))).toBe(true);
    expect(shouldRetryQuery(2, api(500))).toBe(false);
    expect(queryRetryDelay(1, api(500))).toBe(2000);
  });
  it("is the query client's policy", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/api/queries.ts"), "utf8");
    expect(src).toMatch(/retry: shouldRetryQuery/);
    expect(src).toMatch(/retryDelay: queryRetryDelay/);
  });
});

function env(sent: unknown[], over: Partial<ReporterEnv> = {}): () => ReporterEnv {
  return () => ({
    endpoint: "https://my.example.in/api/v1/client-errors",
    url: "https://my.example.in/payments?booking=b1#x",
    userAgent: "UA",
    release: "abc123",
    platform: "web",
    sampleRate: 1,
    random: () => 0.5,
    token: () => "tok",
    send: (endpoint, body, token) => sent.push({ endpoint, body, token }),
    ...over,
  });
}

describe("client error reports (contract C2)", () => {
  it("builds a valid C2 body for app portal, without the query string", () => {
    const body = buildClientErrorReport(
      new TypeError("x is undefined"),
      { source: "boundary", componentStack: "\n  at Home" },
      { url: "https://my.example.in/payments?phone=98765#f", userAgent: "UA", release: "r1", platform: "web" },
    );
    expect(ClientErrorReportSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      app: "portal",
      message: "TypeError: x is undefined",
      url: "https://my.example.in/payments",
    });
    expect(body.extra).toMatchObject({ source: "boundary", platform: "web", component_stack: "\n  at Home" });
    expect(pagePath("not a url")).toBeUndefined();
  });

  it("dedupes, samples, caps and attaches the token; expected API answers are not reported", () => {
    const sent: unknown[] = [];
    const r = createReporter(env(sent));
    const boom = () => new Error("boom"); // the same error from the same place → the same signature
    expect(r.report(boom(), { source: "window" })).toBe(true);
    expect(r.report(boom(), { source: "window" })).toBe(false);
    expect(r.report(api(404), { source: "boundary" })).toBe(false);
    expect(r.report(new ApiError({ status: 0, code: "NETWORK", message: "offline" }), { source: "x" })).toBe(false);
    expect(r.report(api(500), { source: "boundary" })).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ token: "tok", endpoint: "https://my.example.in/api/v1/client-errors" });
    for (let i = 0; i < 20; i += 1) r.report(new Error(`e${i}`), { source: "window" });
    expect(sent).toHaveLength(MAX_REPORTS);

    const sampled: unknown[] = [];
    const s = createReporter(env(sampled, { sampleRate: 0.1, random: () => 0.5 }));
    expect(s.report(new Error("rare"), { source: "window" })).toBe(false);
    expect(sampleRateOf("0.25")).toBe(0.25);
    expect(sampleRateOf("7")).toBe(1);
    expect(sampleRateOf("nope")).toBe(1);
  });

  it("never throws, even when the transport does", () => {
    const r = createReporter(
      env([], {
        send: () => {
          throw new Error("offline");
        },
      }),
    );
    expect(r.report(new Error("x"), { source: "window" })).toBe(false);
  });

  it("listens for window errors and unhandled rejections", () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const target = {
      addEventListener: (type: string, h: (e: unknown) => void) => handlers.set(type, h),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Window;
    const got: string[] = [];
    const off = installGlobalErrorReporting(target, (_e, ctx) => {
      got.push(ctx.source);
      return true;
    });
    handlers.get("error")?.({ error: new Error("a") });
    handlers.get("unhandledrejection")?.({ reason: new Error("b") });
    off();
    expect(got).toEqual(["window", "unhandledrejection"]);
    expect(handlers.size).toBe(0);
  });

  it("the root layout wraps the app in the ErrorBoundary and installs web reporting", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../src/app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/<ErrorBoundary>/);
    expect(layout).toMatch(/installWebErrorReporting\(\)/);
    const boundary = fs.readFileSync(path.resolve(__dirname, "../src/ui/ErrorBoundary.tsx"), "utf8");
    expect(boundary).toMatch(/componentDidCatch[\s\S]*reportClientError\(error, \{ source: "boundary"/);
    expect(boundary).toMatch(/Try again/);
    // "Try again" drops cached data (a malformed answer would crash the remounted screen again)
    expect(boundary).toMatch(/queryClient\.resetQueries\(\)/);
  });
});
