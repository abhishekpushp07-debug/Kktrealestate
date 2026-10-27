/**
 * Phase 7 domain track — public API (docs/hardening/phase7-domain.md, item 7):
 * - public GETs opt into contract C5 caching (catalog 60 s, CMS 300 s): Cache-Control public/s-maxage/stale-while-revalidate, strong
 *   ETag, 304 on If-None-Match, Vary x-kkt-company; authenticated requests stay no-store;
 * - GET /public/sitemap lists every published post (not 12), every published CMS page, the projects, and real lastmods (never "now");
 * - the visitor token is opaque (signed lead reference + expiry, no readable PII) and the server looks the visitor up;
 * - CMS writes call the website's on-demand revalidation route (WEB_REVALIDATE_URL / WEB_REVALIDATE_TOKEN), best-effort;
 * - the public site serves the company resolved by contract C4 (x-kkt-company slug, Host, the only company) — never the first created,
 *   and the API's public cache never mixes two companies.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PublicSitemapResponseSchema } from "@kkt/contracts";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

const REVALIDATE_TOKEN = "r".repeat(8) + "evalidate-secret-for-the-test-suite";
const hits: { headers: IncomingMessage["headers"]; body: string }[] = [];
let hook: Server;
let t: TestContext;
let admin: string;

beforeAll(async () => {
  hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      hits.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" }).end('{"revalidated":true}');
    });
  });
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
  process.env["WEB_REVALIDATE_URL"] = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/api/revalidate`;
  process.env["WEB_REVALIDATE_TOKEN"] = REVALIDATE_TOKEN;
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
}, 120_000);

afterAll(async () => {
  await t?.close();
  await new Promise<void>((r) => hook.close(() => r()));
});

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("contract C5 public caching", () => {
  it("catalog reads: public, s-maxage=60; ETag + 304; Vary names x-kkt-company", async () => {
    const r = await t.request("GET", "/api/v1/public/projects");
    expect(r.status, r.text).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
    expect(String(r.headers["vary"])).toMatch(/x-kkt-company/i);
    const etag = String(r.headers["etag"]);
    expect(etag).toMatch(/^"[^"]+"$/); // a strong tag (no W/)
    const again = await t.request("GET", "/api/v1/public/projects", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
  });

  it("CMS reads: s-maxage=300 (site, posts, people, sitemap, robots)", async () => {
    for (const url of [
      "/api/v1/public/site",
      "/api/v1/public/posts",
      "/api/v1/public/people",
      "/api/v1/public/sitemap",
    ]) {
      const r = await t.request("GET", url);
      expect(r.status, `${url} ${r.text}`).toBe(200);
      expect(r.headers["cache-control"], url).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    }
    const robots = await t.request("GET", "/api/v1/public/robots.txt");
    expect(robots.headers["cache-control"]).toBe("public, s-maxage=300, stale-while-revalidate=3600");
  });

  it("an authenticated request is never publicly cacheable; a 404 is no-store", async () => {
    const r = await t.request("GET", "/api/v1/public/projects", { token: admin });
    expect(r.headers["cache-control"]).toBe("no-store");
    const missing = await t.request("GET", "/api/v1/public/posts/no-such-post");
    expect(missing.status).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /public/sitemap", () => {
  it("lists every published post and CMS page with their own lastmod; static pages are never stamped 'now'", async () => {
    const base = Date.parse("2026-03-01T10:00:00Z");
    for (let i = 1; i <= 15; i++) {
      const at = new Date(base + i * 86_400_000).toISOString();
      await t.app.sql`
        insert into cms_posts (company_id, title, slug, body_md, status, published_at, updated_at)
        values (${t.companyId}, ${`Post ${i}`}, ${`post-${i}`}, 'Body', 'PUBLISHED', ${at}, ${at})`;
    }
    await t.app.sql`
      insert into cms_posts (company_id, title, slug, body_md, status) values (${t.companyId}, 'Draft', 'draft-post', 'x', 'DRAFT')`;
    await t.app.sql`
      insert into cms_pages (company_id, slug, title, body_md, is_published, updated_at)
      values (${t.companyId}, 'terms', 'Terms of use', 'Terms', true, '2026-02-01T00:00:00Z'),
             (${t.companyId}, 'hidden', 'Hidden', 'x', false, '2026-02-01T00:00:00Z')`;
    // the API's own Redis cache was filled by the C5 tests: bump it as a CMS write would
    const { bustPublicCache } = await import("../../src/modules/web/shared.js");
    await bustPublicCache(t.app, "sitemap-test");
    const r = await t.request("GET", "/api/v1/public/sitemap");
    expect(r.status, r.text).toBe(200);
    const { entries } = PublicSitemapResponseSchema.parse(r.body);
    const byPath = new Map(entries.map((e) => [e.path, e.updated_at]));
    for (let i = 1; i <= 15; i++)
      expect(byPath.get(`/blog/post-${i}`)).toBe(new Date(base + i * 86_400_000).toISOString());
    expect(byPath.has("/blog/draft-post")).toBe(false);
    expect(byPath.get("/terms")).toBe("2026-02-01T00:00:00.000Z");
    expect(byPath.has("/hidden")).toBe(false);
    // the blog index is as new as its newest post; nothing is stamped with the request time
    expect(byPath.get("/blog")).toBe(new Date(base + 15 * 86_400_000).toISOString());
    const now = Date.now();
    for (const e of entries) expect(now - Date.parse(e.updated_at), e.path).toBeGreaterThan(5_000);
    for (const p of ["/", "/projects", "/about", "/gallery", "/contact"]) expect(byPath.has(p), p).toBe(true);
    const xml = await t.request("GET", "/api/v1/public/sitemap.xml");
    expect(xml.text).toContain("/blog/post-1</loc>");
    expect(xml.text).toContain("/terms</loc><lastmod>2026-02-01</lastmod>");
  });
});

describe("opaque visitor token", () => {
  it("is a signed lead reference with no readable PII; the server resolves the visitor; tampering, expiry and other companies fail", async () => {
    const { signVisitorToken, parseVisitorToken, lookupVisitor } = await import("../../src/modules/web/publicForms.js");
    const [lead] = await t.app.sql<{ id: string }[]>`
      insert into leads (company_id, lead_number, full_name, phone, email, source)
      values (${t.companyId}, 'LD-P7-0001', 'Asha Verma', '9876512345', 'asha@example.com', 'BROCHURE') returning id`;
    const token = signVisitorToken(lead!.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const decoded = token
      .split(".")
      .map((part) => Buffer.from(part, "base64url").toString("latin1"))
      .join(" ");
    for (const pii of ["9876512345", "Asha", "asha@example.com"]) expect(decoded).not.toContain(pii);
    expect(parseVisitorToken(token)).toEqual({ leadId: lead!.id });
    expect(await lookupVisitor(t.app.db, t.companyId, token)).toEqual({
      phone: "9876512345",
      name: "Asha Verma",
      email: "asha@example.com",
    });
    const [kid, body, sig] = token.split(".") as [string, string, string];
    const flipped = `${kid}.${body.slice(0, -2)}${body.endsWith("A") ? "B" : "A"}${body.slice(-1)}.${sig}`;
    expect(parseVisitorToken(flipped)).toBeNull();
    expect(parseVisitorToken(signVisitorToken(lead!.id, Date.now() - 181 * 86_400_000))).toBeNull();
    expect(await lookupVisitor(t.app.db, "00000000-0000-4000-8000-000000000000", token)).toBeNull();
    // a token for a lead that does not exist (what honeypot replies carry) resolves to nobody
    expect(
      await lookupVisitor(t.app.db, t.companyId, signVisitorToken("6f1c2a7e-0000-4000-8000-000000000009")),
    ).toBeNull();
  });

  it("legacy readable tokens are still honoured until they expire (transition)", async () => {
    const { lookupVisitor } = await import("../../src/modules/web/publicForms.js");
    const { signPayload } = await import("../../src/lib/crypto.js");
    const legacy = signPayload({ v: 1, ph: "9876512399", nm: "Old Device", em: "" }, 3600);
    expect(await lookupVisitor(t.app.db, t.companyId, legacy)).toEqual({
      phone: "9876512399",
      name: "Old Device",
      email: null,
    });
  });
});

describe("on-demand website revalidation", () => {
  it("a CMS write POSTs {tags} with the shared secret to WEB_REVALIDATE_URL", async () => {
    hits.length = 0;
    const cur = await t.request<{ version: number }>("GET", "/api/v1/cms/site", { token: admin });
    expect(cur.status, cur.text).toBe(200);
    const res = await t.request("PATCH", "/api/v1/cms/site", {
      token: admin,
      body: { version: cur.body.version, contacts: { phone: "9876500000", email: "sales@sgb.example" } },
    });
    expect(res.status, res.text).toBe(200);
    await waitFor(() => hits.length > 0);
    expect(hits[0]!.headers["x-kkt-revalidate-token"]).toBe(REVALIDATE_TOKEN);
    expect(JSON.parse(hits[0]!.body)).toEqual({ tags: ["kkt-public"] });
  });

  it("a website that is down never fails the write", async () => {
    const { revalidateWebsite } = await import("../../src/modules/web/shared.js");
    const { config } = await import("../../src/config.js");
    const saved = config.WEB_REVALIDATE_URL;
    (config as { WEB_REVALIDATE_URL?: string }).WEB_REVALIDATE_URL = "http://127.0.0.1:9/api/revalidate";
    try {
      expect(await revalidateWebsite(t.app)).toBe(false);
    } finally {
      (config as { WEB_REVALIDATE_URL?: string }).WEB_REVALIDATE_URL = saved;
    }
  });
});

describe("tenant resolution of the public site (contract C4)", () => {
  it("x-kkt-company / Host choose the company; ambiguity is 400 COMPANY_REQUIRED; the cache never mixes companies", async () => {
    const { clearTenantCache } = await import("../../src/lib/tenant.js");
    const [first] = await t.app.sql<{ slug: string }[]>`select slug from companies where id = ${t.companyId}`;
    // a company created AFTER the first one, with its own host and site settings
    const [second] = await t.app.sql<{ id: string; slug: string }[]>`
      insert into companies (name, hosts) values ('Second Builders', array['www.second.example']) returning id, slug`;
    await t.app.sql`
      insert into site_settings (company_id, brand, contacts) values (${second!.id}, '{"name":"Second Builders"}', '{}')`;
    await t.app
      .sql`update site_settings set brand = jsonb_set(brand, '{name}', '"First Builders"') where company_id = ${t.companyId}`;
    const { bustPublicCache } = await import("../../src/modules/web/shared.js");
    await bustPublicCache(t.app, "tenant-test");
    clearTenantCache();
    type Site = { brand: { name: string } };
    try {
      const a = await t.request<Site>("GET", "/api/v1/public/site", { headers: { "x-kkt-company": first!.slug } });
      expect(a.status, a.text).toBe(200);
      expect(a.body.brand.name).toBe("First Builders");
      const b = await t.request<Site>("GET", "/api/v1/public/site", { headers: { "x-kkt-company": second!.slug } });
      expect(b.status, b.text).toBe(200);
      expect(b.body.brand.name).toBe("Second Builders"); // same URL, other company: never the cached first answer
      const byHost = await t.app.inject({
        method: "GET",
        url: "/api/v1/public/site",
        headers: { host: "www.second.example" },
      });
      expect(byHost.statusCode, byHost.body).toBe(200);
      expect((JSON.parse(byHost.body) as Site).brand.name).toBe("Second Builders");
      const none = await t.request<ErrorBody>("GET", "/api/v1/public/site");
      expect(none.status).toBe(400);
      expect(none.body.error.code).toBe("COMPANY_REQUIRED");
      const unknown = await t.request<ErrorBody>("GET", "/api/v1/public/projects", {
        headers: { "x-kkt-company": "no-such-builder" },
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.code).toBe("COMPANY_REQUIRED");
    } finally {
      await t.app.sql`delete from site_settings where company_id = ${second!.id}`;
      await t.app.sql`delete from companies where id = ${second!.id}`;
      clearTenantCache();
    }
  });
});
