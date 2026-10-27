/**
 * Audit v3 H3 / H4: the unsaved-changes registry and the blocker's decision, chunk-load recovery (one guarded reload), client error
 * reporting (contract C2: body shape, dedupe, sampling, budget, privacy) and the React Query retry policy (Retry-After on 429/503,
 * never other 4xx).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClientError, parseErrorEnvelope } from "@/lib/api";
import { CHUNK_RELOAD_KEY, isChunkLoadError, reloadOnceForChunkError, type ReloadEnv } from "@/lib/chunkReload";
import {
  MAX_REPORTS,
  buildClientErrorReport,
  createReporter,
  errorSignature,
  isReportable,
  pagePath,
  type ReporterEnv,
} from "@/lib/errorReporting";
import { MAX_RETRY_AFTER_MS, queryRetryDelay, shouldRetryQuery } from "@/lib/queryRetry";
import {
  SAVE_GRACE_MS,
  hasUnsavedChanges,
  noteSaved,
  removeUnsavedSource,
  resetUnsavedRegistry,
  setUnsavedSource,
  shouldBlockNavigation,
  subscribeSaved,
  subscribeUnsaved,
} from "@/lib/unsaved";

describe("unsaved-changes registry and blocker decision", () => {
  beforeEach(() => resetUnsavedRegistry());
  afterEach(() => resetUnsavedRegistry());

  const settings = { pathname: "/admin/settings", search: "" };

  it("is dirty while any registered form is dirty, and notifies subscribers", () => {
    const seen: boolean[] = [];
    const off = subscribeUnsaved(() => seen.push(hasUnsavedChanges()));
    expect(hasUnsavedChanges()).toBe(false);
    setUnsavedSource("settings", true);
    setUnsavedSource("sheet", false);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsavedSource("settings", false);
    expect(hasUnsavedChanges()).toBe(false);
    setUnsavedSource("sheet", true);
    removeUnsavedSource("sheet");
    expect(hasUnsavedChanges()).toBe(false);
    off();
    expect(seen).toEqual([true, true, false, true, false]);
  });

  it("blocks leaving the page (path or query change) only while dirty", () => {
    expect(shouldBlockNavigation(settings, { pathname: "/", search: "" })).toBe(false);
    setUnsavedSource("settings", true);
    expect(shouldBlockNavigation(settings, { pathname: "/", search: "" })).toBe(true);
    expect(shouldBlockNavigation(settings, { pathname: "/admin/settings", search: "?tab=numbering" })).toBe(true);
    // same location (e.g. a hash change) never blocks
    expect(shouldBlockNavigation(settings, { pathname: "/admin/settings", search: "" })).toBe(false);
  });

  it("lets the navigation that follows a successful save through (grace window)", () => {
    setUnsavedSource("wizard", true);
    noteSaved(1_000);
    expect(shouldBlockNavigation(settings, { pathname: "/blocks/1", search: "" }, { now: 1_000 + 10 })).toBe(false);
    expect(
      shouldBlockNavigation(settings, { pathname: "/blocks/1", search: "" }, { now: 1_000 + SAVE_GRACE_MS + 1 }),
    ).toBe(true);
  });

  it("announces successful saves, so a drawer tracking 'any edit' becomes clean after its action was saved", () => {
    let saves = 0;
    const off = subscribeSaved(() => (saves += 1));
    noteSaved(5_000);
    noteSaved(6_000);
    off();
    noteSaved(7_000);
    expect(saves).toBe(2);
  });

  it("the sheet / dialog guard only counts while its content is open and resets on a save (regression: a closed sheet blocked navigation)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../components/ui/dirty-close.tsx"), "utf8");
    expect(src).toMatch(/const dirty = guard && open && \(dirtyProp \?\? edited\)/);
    expect(src).toMatch(/subscribeSaved\(\(\) => setEdited\(false\)\)/);
    expect(src).toMatch(/nativeEvent\.isTrusted === false/);
    expect(src).toMatch(/<OpenProbe/);
  });
});

describe("chunk-load recovery", () => {
  function env(storage: Map<string, string> | null, now = 1_000_000): ReloadEnv & { reloads: number } {
    const box = {
      reloads: 0,
      now: () => now,
      storage: storage
        ? { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) }
        : null,
      reload: () => {
        box.reloads += 1;
      },
    };
    return box;
  }

  it("recognises the browsers' failed dynamic-import errors", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/Reports-abc.js"))).toBe(
      true,
    );
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "Loading chunk 7 failed" })).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("reloads once, then shows the error instead of looping", () => {
    const store = new Map<string, string>();
    const first = env(store, 5_000_000);
    expect(reloadOnceForChunkError(first)).toBe(true);
    expect(first.reloads).toBe(1);
    expect(store.get(CHUNK_RELOAD_KEY)).toBe("5000000");
    const again = env(store, 5_000_000 + 10_000);
    expect(reloadOnceForChunkError(again)).toBe(false);
    expect(again.reloads).toBe(0);
    // a later deploy (outside the window) may reload again
    const later = env(store, 5_000_000 + 120_000);
    expect(reloadOnceForChunkError(later)).toBe(true);
  });

  it("never reloads without storage (the guard could not be kept)", () => {
    const box = env(null);
    expect(reloadOnceForChunkError(box)).toBe(false);
    expect(box.reloads).toBe(0);
  });
});

describe("client error reporting (contract C2)", () => {
  function reporterEnv(overrides: Partial<ReporterEnv> = {}) {
    const sent: Array<{ endpoint: string; body: unknown; token: string | null }> = [];
    const env: ReporterEnv = {
      url: "https://erp.example.in/bookings/123?search=Asha%20Rani#ledger",
      userAgent: "Mozilla/5.0 test",
      release: "abc123",
      sampleRate: 1,
      random: () => 0.5,
      send: (endpoint, body, token) => sent.push({ endpoint, body, token }),
      ...overrides,
    };
    return { env, sent };
  }

  it("builds the C2 body: app erp, message, stack, release, user agent, path without query or fragment", () => {
    const error = new TypeError("x is undefined");
    const body = buildClientErrorReport(
      error,
      { source: "boundary", componentStack: "\n at LedgerTab" },
      {
        url: "https://erp.example.in/bookings/123?search=Asha#x",
        userAgent: "UA",
        release: "r1",
      },
    );
    expect(body).toMatchObject({
      app: "erp",
      message: "TypeError: x is undefined",
      url: "https://erp.example.in/bookings/123",
      release: "r1",
      user_agent: "UA",
      extra: { source: "boundary", component_stack: "\n at LedgerTab" },
    });
    expect(body.stack).toContain("TypeError");
    expect(pagePath("not a url")).toBeUndefined();
    // limits of the contract
    const long = buildClientErrorReport(
      new Error("m".repeat(5000)),
      { source: "window" },
      {
        url: null,
        userAgent: null,
        release: "r",
      },
    );
    expect(long.message.length).toBeLessThanOrEqual(2048);
  });

  it("sends once per distinct error, honours sampling and the per-page budget", () => {
    const { env, sent } = reporterEnv();
    const reporter = createReporter(() => env);
    const boom = () => new Error("boom"); // same message, same throw site → same signature
    expect(reporter.report(boom(), { source: "window" })).toBe(true);
    expect(reporter.report(boom(), { source: "window" })).toBe(false); // deduped
    expect(sent).toHaveLength(1);
    expect(sent[0]?.endpoint).toBe("/api/v1/client-errors");
    for (let i = 0; i < MAX_REPORTS + 5; i += 1) reporter.report(new Error(`distinct ${i}`), { source: "window" });
    expect(sent).toHaveLength(MAX_REPORTS);

    const sampled = reporterEnv({ sampleRate: 0.25, random: () => 0.6 });
    const quiet = createReporter(() => sampled.env);
    expect(quiet.report(new Error("sampled out"), { source: "window" })).toBe(false);
    expect(sampled.sent).toHaveLength(0);
  });

  it("does not report expected API answers or aborted requests", () => {
    expect(isReportable(parseErrorEnvelope(422, { error: { code: "BUSINESS_RULE", message: "m" } }))).toBe(false);
    expect(isReportable(parseErrorEnvelope(409, { error: { code: "VERSION_CONFLICT", message: "m" } }))).toBe(false);
    expect(isReportable(new ApiClientError({ status: 0, code: "NETWORK_ERROR", message: "offline" }))).toBe(false);
    expect(isReportable(parseErrorEnvelope(500, { error: { code: "INTERNAL_ERROR", message: "m" } }))).toBe(true);
    expect(isReportable(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isReportable(new Error("ResizeObserver loop completed with undelivered notifications."))).toBe(false);
    expect(errorSignature(new Error("a"))).not.toBe(errorSignature(new Error("b")));
  });
});

describe("React Query retry policy", () => {
  const withRetryAfter = (status: number, seconds: number) =>
    parseErrorEnvelope(status, { error: { code: "X", message: "m" } }, new Headers({ "Retry-After": String(seconds) }));

  it("never retries a 4xx other than a throttled 429", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 428]) {
      expect(shouldRetryQuery(0, parseErrorEnvelope(status, { error: { code: "X", message: "m" } }))).toBe(false);
    }
    expect(shouldRetryQuery(0, parseErrorEnvelope(429, { error: { code: "RATE_LIMITED", message: "m" } }))).toBe(false);
  });

  it("waits for Retry-After on 429 / 503 (up to two attempts, at most 30 s)", () => {
    const shed = withRetryAfter(503, 3);
    expect(shouldRetryQuery(0, shed)).toBe(true);
    expect(shouldRetryQuery(1, shed)).toBe(true);
    expect(shouldRetryQuery(2, shed)).toBe(false);
    expect(queryRetryDelay(0, shed)).toBe(3000);
    expect(shouldRetryQuery(0, withRetryAfter(429, 5))).toBe(true);
    expect(queryRetryDelay(0, withRetryAfter(429, 5))).toBe(5000);
    // a long Retry-After is not waited for automatically
    expect(shouldRetryQuery(0, withRetryAfter(503, 120))).toBe(false);
    expect(queryRetryDelay(0, withRetryAfter(503, 0))).toBe(250);
    expect(MAX_RETRY_AFTER_MS).toBe(30_000);
  });

  it("retries other 5xx and network failures once with backoff", () => {
    const server = parseErrorEnvelope(500, { error: { code: "INTERNAL_ERROR", message: "m" } });
    expect(shouldRetryQuery(0, server)).toBe(true);
    expect(shouldRetryQuery(1, server)).toBe(false);
    expect(shouldRetryQuery(0, new ApiClientError({ status: 0, code: "NETWORK_ERROR", message: "x" }))).toBe(true);
    expect(queryRetryDelay(0, server)).toBe(1000);
    expect(queryRetryDelay(5, server)).toBe(8000);
  });
});

describe("module wiring", () => {
  it("reporting never throws even when the transport does", () => {
    const reporter = createReporter(() => ({
      url: null,
      userAgent: null,
      release: "r",
      sampleRate: 1,
      random: () => 0,
      send: () => {
        throw new Error("transport down");
      },
    }));
    expect(() => reporter.report(new Error("x"), { source: "window" })).not.toThrow();
  });

  it("retries are wired into the app's query client", async () => {
    const { queryClient } = await import("@/app");
    const defaults = queryClient.getDefaultOptions().queries;
    expect(defaults?.retry).toBe(shouldRetryQuery);
    expect(defaults?.retryDelay).toBe(queryRetryDelay);
  });
});
