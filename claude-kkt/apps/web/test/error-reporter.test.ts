import { afterEach, describe, expect, it, vi } from "vitest";

import { buildReport, reportClientError, resetReporter, safePageUrl } from "@/lib/errorReporter";

describe("client error reports (contract C2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetReporter();
  });

  it("drops the query string and fragment and redacts the visit manage token from the URL", () => {
    expect(safePageUrl("https://www.example.com/projects/sgh?utm_source=x&phone=98#faq")).toBe(
      "https://www.example.com/projects/sgh",
    );
    expect(safePageUrl("https://www.example.com/visit/abcSECRETtoken123?moved=1")).toBe(
      "https://www.example.com/visit/[token]",
    );
    expect(safePageUrl("not a url")).toBeUndefined();
  });

  it("builds a bounded report: name + message, stack, release, user agent, digest in extra", () => {
    const err = Object.assign(new TypeError("x".repeat(5000)), { digest: "123" });
    const r = buildReport(err, {
      url: "https://w.example/a?b=1",
      release: "abc123",
      userAgent: "UA",
      extra: { kind: "t" },
    });
    expect(r.app).toBe("web");
    expect(r.message.length).toBe(2048);
    expect(r.message.startsWith("TypeError: x")).toBe(true);
    expect(r.url).toBe("https://w.example/a");
    expect(r.release).toBe("abc123");
    expect(r.extra).toEqual({ kind: "t", digest: "123" });
    expect(buildReport("plain string", {}).message).toBe("plain string");
    expect(buildReport({ weird: true }, {}).message).toBe('{"weird":true}');
  });

  it("posts once per distinct error, at most five per page, and never throws", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("window", { location: { href: "https://w.example/about?x=1" } });
    vi.stubGlobal("navigator", { userAgent: "UA" });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"accepted":true}', { status: 202 });
    });
    expect(await reportClientError("https://api.example.com/", new Error("boom"))).toBe(true);
    expect(await reportClientError("https://api.example.com/", new Error("boom"))).toBe(false); // duplicate
    expect(calls[0]!.url).toBe("https://api.example.com/api/v1/client-errors");
    expect(calls[0]!.init.keepalive).toBe(true);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      app: "web",
      message: "Error: boom",
      url: "https://w.example/about",
    });
    for (let i = 0; i < 10; i++) await reportClientError("https://api.example.com", new Error(`e${i}`));
    expect(calls.length).toBe(5);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    resetReporter();
    expect(await reportClientError("https://api.example.com", new Error("offline"))).toBe(false);
  });
});
