import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => incoming.get(k.toLowerCase()) ?? null }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

/** A minimal unstable_cache: keyed by key parts + args, records the options each entry was stored with; throws are not stored. */
const store = new Map<string, unknown>();
const cacheCalls: { keyParts: string[]; revalidate: number; tags: string[] }[] = [];
vi.mock("next/cache", () => ({
  unstable_cache:
    <A extends unknown[], R>(
      fn: (...a: A) => Promise<R>,
      keyParts: string[],
      opts: { revalidate: number; tags: string[] },
    ) =>
    async (...args: A): Promise<R> => {
      cacheCalls.push({ keyParts, revalidate: opts.revalidate, tags: opts.tags });
      const key = JSON.stringify([keyParts, args]);
      if (store.has(key)) return store.get(key) as R;
      const value = await fn(...args);
      store.set(key, value);
      return value;
    },
}));

const api = await import("@/lib/api");
const { getProject, getPost, getVisit, getSiteSettings, listProjects, sanitizeForwardedFor, visitorForwardHeaders } =
  api;

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let respond: (url: string) => Response;
/** GET /public/sitemap (kept apart from `calls`); null = the API answers 404 there, so lib/api.ts cannot gate detail slugs. */
let sitemap: { path: string; updated_at: string; priority: number }[] | null = null;
let sitemapCalls = 0;
/** unstable_cache calls other than the sitemap's (which detail reads consult first). */
const dataCacheCalls = () => cacheCalls.filter((c) => !c.tags.includes("sitemap"));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  cacheCalls.length = 0;
  store.clear();
  incoming.clear();
  sitemap = null;
  sitemapCalls = 0;
  process.env.API_INTERNAL_URL = "http://api.internal:4000";
  delete process.env.INTERNAL_API_TOKEN;
  delete process.env.KKT_COMPANY_SLUG;
  respond = (url) =>
    url.includes("/site") ? json({ company_name: "X" }) : json({ slug: "sgh", name: "Shree Ganesh Heights" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/public/sitemap")) {
      sitemapCalls += 1;
      return sitemap ? json({ entries: sitemap }) : json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    }
    calls.push({ url, init });
    return respond(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const headerOf = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

describe("ISR reads (lib/api.ts)", () => {
  it("detail and list reads are cached under the kkt-public tag (catalog 60 s, CMS 300 s), never per visitor", async () => {
    incoming.set("x-forwarded-for", "203.0.113.7");
    await getProject("sgh");
    await getProject("sgh");
    expect(calls).toHaveLength(1); // the second read is a cache hit
    expect(calls[0]!.url).toBe("http://api.internal:4000/api/v1/public/projects/sgh");
    expect(calls[0]!.init.cache).toBe("no-store"); // the cache is ours (unstable_cache), not fetch's
    expect(headerOf(calls[0]!, "x-forwarded-for")).toBeUndefined();
    expect(headerOf(calls[0]!, "x-kkt-client-ip")).toBeUndefined();
    expect(dataCacheCalls()[0]).toMatchObject({ revalidate: 60, tags: ["kkt-public", "projects", "project:sgh"] });
    await getSiteSettings();
    expect(cacheCalls.at(-1)).toMatchObject({ revalidate: 300, tags: ["kkt-public", "site"] });
    await listProjects();
    expect(cacheCalls.at(-1)).toMatchObject({ revalidate: 60 });
  });

  it("a 404 is cached like any answer (an unpublished post disappears instead of the last good copy living on)", async () => {
    respond = () => json({ error: { code: "NOT_FOUND", message: "Post not found" } }, 404);
    await expect(getPost("gone")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(getPost("gone")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(calls).toHaveLength(1);
  });

  it("a 5xx is never cached and is retried once with a 10 s lifetime (shortens the page's revalidation too)", async () => {
    let n = 0;
    respond = () =>
      ++n === 1 ? json({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500) : json({ slug: "sgh" });
    expect(await getProject("sgh")).toMatchObject({ slug: "sgh" });
    expect(calls).toHaveLength(2);
    expect(dataCacheCalls().map((c) => c.revalidate)).toEqual([60, 10]);
    expect(dataCacheCalls()[1]!.keyParts).toContain("retry");
  });

  it("a network failure degrades lists to empty and details to the error boundary", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await listProjects()).toEqual([]);
    await expect(getProject("sgh")).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("detail slugs are checked against the cached sitemap (no API call, no cache entry for a made-up slug)", () => {
  const entry = (path: string) => ({ path, updated_at: "2026-10-01T00:00:00.000Z", priority: 0.5 });

  it("an unknown project / post slug is a 404 without a detail fetch or a Data Cache entry", async () => {
    sitemap = [entry("/"), entry("/projects/sgh"), entry("/blog/hello"), entry("/terms")];
    for (let i = 0; i < 5; i++) {
      await expect(getProject(`made-up-${i}`)).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(getPost(`made-up-${i}`)).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(calls).toHaveLength(0);
    expect(dataCacheCalls()).toHaveLength(0);
    expect(sitemapCalls).toBe(1); // the sitemap itself is one cached read
    expect(await api.isKnownPath("/terms")).toBe(true);
    expect(await api.isKnownPath("/made-up")).toBe(false);
  });

  it("a listed slug is fetched as before", async () => {
    sitemap = [entry("/projects/sgh")];
    expect(await getProject("sgh")).toMatchObject({ slug: "sgh" });
    expect(calls.map((c) => c.url)).toEqual(["http://api.internal:4000/api/v1/public/projects/sgh"]);
  });

  it("without a sitemap (API down / older API) every slug is asked for directly", async () => {
    sitemap = null;
    expect(await api.isKnownPath("/projects/anything")).toBe(true);
    expect(await getProject("sgh")).toMatchObject({ slug: "sgh" });
    expect(calls).toHaveLength(1);
  });
});

describe("contracts C3 / C4 headers on server-side calls", () => {
  it("every server call carries x-kkt-internal-token and x-kkt-company when configured", async () => {
    process.env.INTERNAL_API_TOKEN = "t".repeat(40);
    process.env.KKT_COMPANY_SLUG = "shree-ganesh-builders";
    await getSiteSettings();
    expect(headerOf(calls[0]!, "x-kkt-internal-token")).toBe("t".repeat(40));
    expect(headerOf(calls[0]!, "x-kkt-company")).toBe("shree-ganesh-builders");
    // the company is part of the cache key: two builders never share an entry
    expect(cacheCalls[0]!.keyParts).toContain("shree-ganesh-builders");
  });

  it("an invalid KKT_COMPANY_SLUG is ignored, never sent", async () => {
    process.env.KKT_COMPANY_SLUG = "Not A Slug!";
    await getSiteSettings();
    expect(headerOf(calls[0]!, "x-kkt-company")).toBeUndefined();
  });

  it("per-visitor (uncached) calls forward the visitor: x-kkt-client-ip = right-most hop, plus the sanitised chain", async () => {
    process.env.INTERNAL_API_TOKEN = "t".repeat(40);
    incoming.set("x-forwarded-for", "198.51.100.1, 203.0.113.7");
    respond = () => json({ visit_number: "SV-1" });
    await getVisit("tok-abc");
    expect(calls[0]!.url).toBe("http://api.internal:4000/api/v1/public/site-visits/tok-abc");
    expect(calls[0]!.init.cache).toBe("no-store");
    expect(headerOf(calls[0]!, "x-kkt-client-ip")).toBe("203.0.113.7");
    expect(headerOf(calls[0]!, "x-forwarded-for")).toBe("198.51.100.1, 203.0.113.7");
    expect(headerOf(calls[0]!, "x-kkt-internal-token")).toBe("t".repeat(40));
    expect(cacheCalls).toHaveLength(0);
  });

  it("falls back to x-real-ip; garbage is never forwarded; nothing outside a request", async () => {
    incoming.set("x-real-ip", "198.51.100.4");
    expect(await visitorForwardHeaders()).toEqual({
      "x-forwarded-for": "198.51.100.4",
      "x-kkt-client-ip": "198.51.100.4",
    });
    incoming.clear();
    incoming.set("x-forwarded-for", "evil\r\nx-admin: 1, <script>");
    expect(await visitorForwardHeaders()).toEqual({});
    expect(sanitizeForwardedFor("2001:db8::1, 203.0.113.9")).toBe("2001:db8::1, 203.0.113.9");
    expect(sanitizeForwardedFor("unknown")).toBeNull();
    incoming.clear();
    expect(await visitorForwardHeaders()).toEqual({});
  });
});

describe("browser client (contract C4)", () => {
  it("sends x-kkt-company only when a slug is configured", async () => {
    vi.stubGlobal("window", {});
    try {
      respond = () => json([]);
      await api
        .publicClient("https://api.example.com", "shree-ganesh-builders")
        .getVisitAvailability("sgh", "2026-11-01", "2026-11-02");
      expect(headerOf(calls[0]!, "x-kkt-company")).toBe("shree-ganesh-builders");
      await api.publicClient("https://api.example.com").getVisitAvailability("sgh", "2026-11-01", "2026-11-02");
      expect(headerOf(calls[1]!, "x-kkt-company")).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
