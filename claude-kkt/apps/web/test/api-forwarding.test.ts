import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = new Map<string, string>();
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => incoming.get(k.toLowerCase()) ?? null }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const { getProject, findProject, getSiteSettings, sanitizeForwardedFor, visitorForwardHeaders } = await import("@/lib/api");

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  incoming.clear();
  process.env.API_INTERNAL_URL = "http://api.internal:4000";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = url.includes("/site") ? { company_name: "X" } : { slug: "sgh", name: "Shree Ganesh Heights" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const headerOf = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

describe("server fetches forward the visitor's address so per-IP limits apply per visitor", () => {
  it("uncached detail fetches carry the incoming x-forwarded-for chain", async () => {
    incoming.set("x-forwarded-for", "203.0.113.7, 10.0.0.2");
    await getProject("sgh");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://api.internal:4000/api/v1/public/projects/sgh");
    expect(headerOf(calls[0]!, "x-forwarded-for")).toBe("203.0.113.7, 10.0.0.2");
    expect(calls[0]!.init.cache).toBe("no-store");
  });

  it("falls back to x-real-ip; garbage is never forwarded", async () => {
    incoming.set("x-real-ip", "198.51.100.4");
    expect(await visitorForwardHeaders()).toEqual({ "x-forwarded-for": "198.51.100.4" });
    incoming.clear();
    incoming.set("x-forwarded-for", "evil\r\nx-admin: 1, <script>");
    expect(await visitorForwardHeaders()).toEqual({});
    expect(sanitizeForwardedFor("2001:db8::1, 203.0.113.9")).toBe("2001:db8::1, 203.0.113.9");
    expect(sanitizeForwardedFor("unknown")).toBeNull();
  });

  it("cached (shared) list fetches are sent without it so the Data Cache is not split per visitor", async () => {
    incoming.set("x-forwarded-for", "203.0.113.7");
    await getSiteSettings();
    expect(headerOf(calls[0]!, "x-forwarded-for")).toBeUndefined();
  });

  it("outside a request (build, sitemap) there is nothing to forward", async () => {
    expect(await findProject("sgh")).toMatchObject({ slug: "sgh" });
    expect(headerOf(calls[0]!, "x-forwarded-for")).toBeUndefined();
  });
});
