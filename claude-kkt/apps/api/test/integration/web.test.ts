import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDF_BYTES, createWebProject, findKeys, pngBytes, publishWebProject, uploadDoc, uploadMultipart, type WebProject } from "./fixtures/web.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";

process.env["STORAGE_LOCAL_DIR"] = mkdtempSync(join(tmpdir(), "kkt-web-test-"));

type Card = { slug: string; name: string; starting_price_paise: number | null; hero_image_url: string | null; bhk_options: number[]; type: string; is_featured: boolean };
type Detail = Card & {
  show_prices: boolean; configurations: { code?: string; price_paise?: number | null; price_from_paise: number | null; rooms: unknown[]; specifications: unknown[] }[];
  availability: { blocks: { name: string; floors: { label?: string; floor_label: string; cells: { flat_number: string; availability: string; status?: string; price_paise: number | null }[] }[]; available_count: number; total_count: number }[] } | null;
  construction: { percent: number; current_stage: string | null; stages: { name: string; status: string; photos: { url?: string; medium_url: string }[] }[] } | null;
  construction_progress: { blocks: { name: string; stages: { name: string; photos: unknown[] }[] }[] } | null;
  hero_images: { url: string }[]; overview: string; key_facts: { total_units: number | null; address: { city: string | null } }; brochure_available: boolean; visit_booking_enabled: boolean; seo: { title: string | null; og_image_url: string | null }; videos: string[]; faqs: { q: string }[];
};
type Site = { brand: { name: string }; site_live: boolean; coming_soon_message: string | null; featured_projects: Card[]; banners: { title: string; image_url: string }[]; testimonials: unknown[]; latest_posts: { slug: string }[]; home_sections: { key: string }[] };

let t: TestContext;
let admin: string;
let marketing: string;
let sales: string;
let projectsUser: string;
let wp: WebProject;
let hidden: WebProject;

const PRICE_KEY = /price|cost|rate_|_rate/i;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  marketing = (await t.loginAs("marketing")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  projectsUser = (await t.loginAs("projects")).access_token;
  wp = await createWebProject(t, admin, { name: "Shree Ganesh Heights", code: "SGH", suffix: "W1" });
  hidden = await createWebProject(t, admin, { name: "Hidden Villas", code: "HV", suffix: "W2" });
});
afterAll(async () => { await t?.close(); });

async function pub<T>(url: string, ip?: string) {
  return t.request<T>("GET", url, ip ? { ip } : {});
}

describe("CMS site settings", () => {
  it("GET creates the singleton from the company; PATCH needs a version, mirrors round robin to company settings and is audited", async () => {
    const first = await t.request<{ brand: { name: string }; version: number; round_robin_enabled: boolean; site_live: boolean }>("GET", "/api/v1/cms/site", { token: marketing });
    expect(first.status, first.text).toBe(200);
    expect(first.body.brand.name).toBe("Shree Ganesh Builders");
    expect(first.body.version).toBe(1);
    expect(first.body.round_robin_enabled).toBe(true);
    expect(first.body.site_live).toBe(true);
    const noVersion = await t.request<ErrorBody>("PATCH", "/api/v1/cms/site", { token: marketing, body: { disclaimer: "x" } });
    expect(noVersion.status).toBe(400);
    const stale = await t.request<ErrorBody>("PATCH", "/api/v1/cms/site", { token: marketing, body: { version: 9, disclaimer: "x" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const upd = await t.request<{ version: number; round_robin_enabled: boolean; trust_stats: { label: string }[]; contacts: { whatsapp: string | null } }>("PATCH", "/api/v1/cms/site", {
      token: marketing,
      body: { version: 1, round_robin_enabled: false, trust_stats: [{ label: "Years", value: "12" }], contacts: { phone: "6122200000", whatsapp: "9876500000", email: "info@sgb.in" }, portal_url: "https://my.sgb.in" },
    });
    expect(upd.status, upd.text).toBe(200);
    expect(upd.body.version).toBe(2);
    expect(upd.body.round_robin_enabled).toBe(false);
    expect(upd.body.trust_stats).toEqual([{ label: "Years", value: "12" }]);
    const [c] = await t.app.sql<{ settings: { round_robin_enabled: boolean } }[]>`select settings from companies where id = ${t.companyId}`;
    expect(c!.settings.round_robin_enabled).toBe(false);
    const audits = await t.app.sql<{ action: string }[]>`select action from audit_logs where entity_type = 'site_settings'`;
    expect(audits.map((a) => a.action)).toContain("site_settings.update");
    // Sales has no cms.write; Employee has no cms.read
    expect((await t.request("PATCH", "/api/v1/cms/site", { token: sales, body: { version: 2 } })).status).toBe(403);
    const back = await t.request("PATCH", "/api/v1/cms/site", { token: marketing, body: { round_robin_enabled: true }, headers: { "if-match": '"2"' } });
    expect(back.status, back.text).toBe(200);
  });
});

describe("CMS content", () => {
  let bannerDoc: string;
  it("uploads media into the CMS library and rejects a non-image banner document", async () => {
    const png = await pngBytes(1600, 900);
    const up = await uploadMultipart(t, marketing, "/api/v1/cms/media", { title: "Hero banner" }, { name: "banner.png", data: png });
    expect(up.status, up.text).toBe(201);
    bannerDoc = up.body.document.id;
    const pdf = await uploadMultipart(t, marketing, "/api/v1/cms/media", {}, { name: "leaflet.pdf", data: PDF_BYTES });
    expect(pdf.status).toBe(201);
    const bad = await t.request<ErrorBody>("POST", "/api/v1/cms/banners", { token: marketing, body: { title: "Bad", document_id: pdf.body.document.id } });
    expect(bad.status).toBe(400);
    const list = await t.request<{ items: { id: string }[]; total: number }>("GET", "/api/v1/cms/media", { token: marketing });
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect((await uploadMultipart(t, sales, "/api/v1/cms/media", {}, { name: "x.png", data: png })).status).toBe(403);
  });

  it("banners: idempotent create, version-checked update, delete, audit", async () => {
    const key = `banner-${Date.now()}`;
    const body = { title: "Diwali offer", subtitle: "Book now", document_id: bannerDoc, sort_order: 1, cta_label: "Enquire", cta_url: "/contact" };
    const r1 = await t.request<{ id: string; version: number; image_url: string }>("POST", "/api/v1/cms/banners", { token: marketing, body, headers: { "idempotency-key": key } });
    expect(r1.status, r1.text).toBe(201);
    expect(r1.body.image_url).toContain("/api/v1/public/media/");
    const r2 = await t.request<{ id: string }>("POST", "/api/v1/cms/banners", { token: marketing, body, headers: { "idempotency-key": key } });
    expect(r2.status).toBe(201);
    expect(r2.headers["idempotent-replayed"]).toBe("true");
    expect(r2.body.id).toBe(r1.body.id);
    const upd = await t.request<{ version: number; title: string }>("PATCH", `/api/v1/cms/banners/${r1.body.id}`, { token: marketing, body: { version: 1, title: "Diwali Dhamaka" } });
    expect(upd.status, upd.text).toBe(200);
    expect(upd.body.version).toBe(2);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/cms/banners/${r1.body.id}`, { token: marketing, body: { version: 1, title: "x" } });
    expect(stale.status).toBe(409);
    const list = await t.request<{ items: { id: string }[] }>("GET", "/api/v1/cms/banners?page_size=50", { token: admin });
    expect(list.body.items.map((b) => b.id)).toContain(r1.body.id);
    const csv = await t.request("GET", "/api/v1/cms/banners?format=csv", { token: admin });
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    const site = await pub<Site>("/api/v1/public/site");
    expect(site.status, site.text).toBe(200);
    expect(site.body.banners.map((b) => b.title)).toContain("Diwali Dhamaka");
    const del = await t.request("DELETE", `/api/v1/cms/banners/${r1.body.id}`, { token: marketing });
    expect(del.status).toBe(204);
    expect((await t.request("GET", `/api/v1/cms/banners/${r1.body.id}`, { token: admin })).status).toBe(404);
    const audits = await t.app.sql<{ action: string }[]>`select action from audit_logs where entity_type = 'cms_banner' and entity_id = ${r1.body.id} order by created_at`;
    expect(audits.map((a) => a.action)).toEqual(["cms_banner.create", "cms_banner.update", "cms_banner.delete"]);
  });

  it("posts: slug unique, DRAFT invisible publicly, PUBLISHED gets published_at and appears in /public/posts and the sitemap", async () => {
    const draft = await t.request<{ id: string; status: string; published_at: string | null; version: number }>("POST", "/api/v1/cms/posts", { token: marketing, body: { title: "Why Patna", slug: "why-patna", body_md: "# Hello\n\nPatna is growing.", tags: ["city"] } });
    expect(draft.status, draft.text).toBe(201);
    expect(draft.body.status).toBe("DRAFT");
    expect(draft.body.published_at).toBeNull();
    const dup = await t.request<ErrorBody>("POST", "/api/v1/cms/posts", { token: marketing, body: { title: "Dup", slug: "why-patna", body_md: "x" } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    expect((await pub("/api/v1/public/posts/why-patna")).status).toBe(404);
    const published = await t.request<{ published_at: string | null; author_name: string | null }>("PATCH", `/api/v1/cms/posts/${draft.body.id}`, { token: marketing, body: { version: 1, status: "PUBLISHED" } });
    expect(published.status, published.text).toBe(200);
    expect(published.body.published_at).not.toBeNull();
    expect(published.body.author_name).toBe("Nisha Singh");
    const list = await pub<{ items: { slug: string; reading_minutes: number | null }[]; total: number }>("/api/v1/public/posts");
    expect(list.status).toBe(200);
    expect(list.body.items.map((p) => p.slug)).toContain("why-patna");
    const one = await pub<{ body_md: string; seo: { title: string | null } }>("/api/v1/public/posts/why-patna");
    expect(one.status).toBe(200);
    expect(one.body.body_md).toContain("Patna is growing");
    expect(one.body.seo.title).toBe("Why Patna");
    const page = await t.request<{ id: string }>("POST", "/api/v1/cms/pages", { token: marketing, body: { slug: "privacy", title: "Privacy policy", body_md: "We care.", is_published: true } });
    expect(page.status, page.text).toBe(201);
    expect((await pub<{ title: string }>("/api/v1/public/pages/privacy")).body.title).toBe("Privacy policy");
    const person = await t.request("POST", "/api/v1/cms/people", { token: marketing, body: { name: "Suresh Agarwal", title: "Managing Director", is_published: true } });
    expect(person.status).toBe(201);
    const people = await pub<{ name: string }[]>("/api/v1/public/people");
    expect(people.body.map((p) => p.name)).toContain("Suresh Agarwal");
    const section = await t.request("POST", "/api/v1/cms/home-sections", { token: marketing, body: { key: "value_props", title: "Why us", body: { items: ["Trust"] } } });
    expect(section.status).toBe(201);
    expect((await t.request<ErrorBody>("POST", "/api/v1/cms/home-sections", { token: marketing, body: { key: "value_props" } })).status).toBe(409);
    const sitemap = await pub("/api/v1/public/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain("/blog/why-patna");
    expect(sitemap.text).toContain("/privacy");
  });
});

describe("project website settings", () => {
  it("defaults to unpublished with a slug from the name; publishing without hero/description/location → 422 PUBLISH_REQUIREMENTS", async () => {
    const bare = await createWebProject(t, admin, { name: "Empty Plot", code: "EP", suffix: "W3", description: null, address: false });
    const cur = await t.request<{ slug: string; is_published: boolean; can_publish: boolean; publish_blockers: string[]; version: number }>("GET", `/api/v1/projects/${bare.projectId}/website`, { token: admin });
    expect(cur.status, cur.text).toBe(200);
    expect(cur.body.slug).toBe("empty-plot");
    expect(cur.body.is_published).toBe(false);
    expect(cur.body.can_publish).toBe(false);
    expect(cur.body.publish_blockers).toEqual(expect.arrayContaining(["hero_image", "description"]));
    const r = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${bare.projectId}/website`, { token: admin, body: { version: cur.body.version, is_published: true } });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.code).toBe("PUBLISH_REQUIREMENTS");
    expect(r.body.error.details?.["missing"]).toEqual(expect.arrayContaining(["hero_image", "description"]));
    // still missing description even with a hero
    const r2 = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${bare.projectId}/website`, { token: admin, body: { version: cur.body.version, is_published: true, hero_document_ids: [bare.heroDocId] } });
    expect(r2.status).toBe(422);
    expect(r2.body.error.details?.["missing"]).toEqual(["description", "location"]);
    expect((await pub(`/api/v1/public/projects/empty-plot`)).status).toBe(404);
  });

  it("publishes with hero + description + address; slug is globally unique; scoped user cannot see other projects' settings", async () => {
    const before = await pub<Card[]>("/api/v1/public/projects");
    expect(before.body.map((c) => c.slug)).not.toContain(wp.slug);
    expect((await pub(`/api/v1/public/projects/${wp.slug}`)).status).toBe(404);
    expect((await pub("/api/v1/public/sitemap.xml")).text).not.toContain(`/projects/${wp.slug}`);
    const published = await publishWebProject(t, admin, wp);
    expect(published.version).toBeGreaterThan(1);
    const row = await t.request<{ is_published: boolean; published_at: string | null; hero_urls: string[]; brochure_file_name: string | null; brochure_download_count: number; brochure_downloads_30d: unknown[] }>("GET", `/api/v1/projects/${wp.projectId}/website`, { token: marketing });
    expect(row.body.is_published).toBe(true);
    expect(row.body.published_at).not.toBeNull();
    expect(row.body.hero_urls).toHaveLength(1);
    expect(row.body.brochure_file_name).toBe("brochure-SGH.pdf");
    expect(row.body.brochure_downloads_30d).toHaveLength(30);
    const dup = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${hidden.projectId}/website`, { token: admin, body: { version: hidden.websiteVersion, slug: wp.slug } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    // Project Admin (scoped, no projects) → 404; Sales (no project.write/cms.write) → 403 on PATCH but can read
    expect((await t.request("GET", `/api/v1/projects/${wp.projectId}/website`, { token: projectsUser })).status).toBe(404);
    expect((await t.request("PATCH", `/api/v1/projects/${wp.projectId}/website`, { token: sales, body: { version: 1, highlights: ["x"] } })).status).toBe(403);
    expect((await t.request("GET", `/api/v1/projects/${wp.projectId}/website`, { token: sales })).status).toBe(200);
    const after = await pub<Card[]>("/api/v1/public/projects");
    expect(after.body.map((c) => c.slug)).toContain(wp.slug);
    expect(after.body.map((c) => c.slug)).not.toContain(hidden.slug);
    expect((await pub("/api/v1/public/sitemap.xml")).text).toContain(`/projects/${wp.slug}`);
    expect((await pub("/api/v1/public/sitemap.xml")).text).not.toContain(`/projects/${hidden.slug}`);
    expect((await pub(`/api/v1/public/projects/${hidden.slug}`)).status).toBe(404);
  });
});

describe("public project detail", () => {
  it("serves the allow-listed detail with cache headers, grid, configurations, progress and aliases for apps/web", async () => {
    const r = await pub<Detail>(`/api/v1/public/projects/${wp.slug}`);
    expect(r.status, r.text).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    expect(r.headers["etag"]).toBeTruthy();
    const d = r.body;
    expect(d.name).toBe("Shree Ganesh Heights");
    expect(d.type).toBe("RESIDENTIAL");
    expect(d.show_prices).toBe(true);
    expect(d.starting_price_paise).toBe(4_800_000_00);
    expect(d.hero_image_url).toContain("/api/v1/public/media/");
    expect(d.hero_images[0]!.url).toContain("/api/v1/public/media/");
    expect(d.bhk_options).toEqual([3]);
    expect(d.overview).toContain("Bailey Road");
    expect(d.key_facts.total_units).toBe(6);
    expect(d.key_facts.address.city).toBe("Patna");
    expect(d.brochure_available).toBe(true);
    expect(d.visit_booking_enabled).toBe(false);
    expect(d.videos).toEqual(["https://www.youtube.com/watch?v=abc"]);
    expect(d.faqs[0]!.q).toContain("RERA");
    expect(d.seo.title).toBe("Shree Ganesh Heights");
    expect(d.seo.og_image_url).toContain("/api/v1/public/media/");
    // configurations from master data
    expect(d.configurations).toHaveLength(1);
    expect(d.configurations[0]!.code).toBe(wp.flatTypeCode);
    expect(d.configurations[0]!.price_paise).toBe(4_800_000_00);
    expect(d.configurations[0]!.rooms.length).toBeGreaterThan(0);
    // availability grid: only AVAILABLE | NOT_AVAILABLE
    const block = d.availability!.blocks[0]!;
    expect(block.name).toBe("Tower A");
    expect(block.available_count).toBe(2);
    expect(block.total_count).toBe(6);
    const cells = Object.fromEntries(block.floors.flatMap((f) => f.cells).map((c) => [c.flat_number, c]));
    expect(cells["A-101"]!.availability).toBe("AVAILABLE");
    expect(cells["A-101"]!.status).toBe("AVAILABLE");
    expect(cells["A-102"]!.availability).toBe("NOT_AVAILABLE"); // HOLD
    expect(cells["A-103"]!.availability).toBe("NOT_AVAILABLE"); // BOOKED
    expect(cells["A-202"]!.availability).toBe("NOT_AVAILABLE"); // SOLD
    expect(cells["A-203"]!.availability).toBe("NOT_AVAILABLE"); // BLOCKED
    expect(new Set(Object.values(cells).map((c) => c.availability))).toEqual(new Set(["AVAILABLE", "NOT_AVAILABLE"]));
    expect(cells["A-101"]!.price_paise).toBe(5_000_000_00);
    expect(cells["A-102"]!.price_paise).toBeNull();
    expect(block.floors[0]!.label).toBe("2");
    // construction progress: only website-flagged photos
    expect(d.construction!.percent).toBe(45.5);
    expect(d.construction!.current_stage).toBe("Foundation");
    const excavation = d.construction_progress!.blocks[0]!.stages.find((s) => s.name === "Excavation")!;
    expect(excavation.photos).toHaveLength(1);
    expect(JSON.stringify(d)).not.toContain(wp.hiddenPhotoDocId);
    expect(JSON.stringify(d)).toContain(wp.websitePhotoDocId);
    // second read is served from cache with the same body
    const again = await pub<Detail>(`/api/v1/public/projects/${wp.slug}`);
    expect(again.body).toEqual(d);
    const notModified = await t.request("GET", `/api/v1/public/projects/${wp.slug}`, { headers: { "if-none-match": String(r.headers["etag"]) } });
    expect(notModified.status).toBe(304);
  });

  it("show_prices off removes every price field from the card and the detail; show_progress / show_availability off hide those sections", async () => {
    await publishWebProject(t, admin, wp, { show_prices: false });
    const list = await pub<Card[]>("/api/v1/public/projects");
    const card = list.body.find((c) => c.slug === wp.slug)!;
    expect(card.starting_price_paise).toBeNull();
    const d = (await pub<Detail>(`/api/v1/public/projects/${wp.slug}`)).body;
    expect(d.show_prices).toBe(false);
    expect(d.starting_price_paise).toBeNull();
    const priceKeys = findKeys(d, (k, v) => PRICE_KEY.test(k) && v !== null && typeof v !== "boolean");
    expect(priceKeys.filter((k) => !k.endsWith("show_prices"))).toEqual([]);
    expect(d.availability).not.toBeNull();
    expect(d.availability!.blocks[0]!.floors.flatMap((f) => f.cells).every((c) => c.price_paise === null)).toBe(true);
    await publishWebProject(t, admin, wp, { show_prices: true, show_progress: false, show_availability: false });
    const d2 = (await pub<Detail>(`/api/v1/public/projects/${wp.slug}`)).body;
    expect(d2.construction).toBeNull();
    expect(d2.construction_progress).toBeNull();
    expect(d2.availability).toBeNull();
    expect(d2.configurations[0]!.price_paise).toBe(4_800_000_00);
    expect(JSON.stringify(d2)).not.toContain(wp.websitePhotoDocId);
    await publishWebProject(t, admin, wp, { show_progress: true, show_availability: true });
    // the override wins over the cheapest flat
    await publishWebProject(t, admin, wp, { starting_price_override_paise: 4_500_000_00 });
    expect((await pub<Detail>(`/api/v1/public/projects/${wp.slug}`)).body.starting_price_paise).toBe(4_500_000_00);
    await publishWebProject(t, admin, wp, { starting_price_override_paise: null });
  });

  it("public payloads carry no *_id keys (except codes), no storage keys, no costs and no HOLD/BOOKED/BLOCKED words", async () => {
    const bodies: unknown[] = [];
    for (const url of ["/api/v1/public/site", "/api/v1/public/projects", `/api/v1/public/projects/${wp.slug}`, "/api/v1/public/posts", "/api/v1/public/gallery", "/api/v1/public/people", "/api/v1/public/sitemap"]) {
      const r = await pub(url);
      expect(r.status, url).toBe(200);
      bodies.push(r.body);
    }
    for (const b of bodies) {
      expect(findKeys(b, (k) => (k.endsWith("_id") && k !== "ga_id") || k === "id")).toEqual([]);
      expect(findKeys(b, (k) => /storage_key|cost|password|token_hash|assigned|customer/i.test(k))).toEqual([]);
    }
    const text = JSON.stringify(bodies[2]);
    expect(text).not.toMatch(/"(HOLD|BOOKED|BLOCKED|SOLD)"/);
    expect(text).not.toContain(t.companyId);
  });

  it("serves public media immutably (images only, variants) and 404s PDFs and unknown ids", async () => {
    const img = await t.app.inject({ method: "GET", url: `/api/v1/public/media/${wp.heroDocId}?variant=thumb`, headers: { "x-forwarded-for": freshIp() } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const orig = await t.app.inject({ method: "GET", url: `/api/v1/public/media/${wp.heroDocId}`, headers: { "x-forwarded-for": freshIp() } });
    expect(orig.statusCode).toBe(200);
    expect(orig.headers["content-type"]).toBe("image/png");
    expect((await pub(`/api/v1/public/media/${wp.brochureDocId}`)).status).toBe(404);
    expect((await pub(`/api/v1/public/media/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await pub(`/api/v1/public/media/${wp.heroDocId}?variant=huge`)).status).toBe(400);
  });

  it("site_live off → coming-soon payload, empty lists, 404 details and a Disallow-all robots.txt", async () => {
    const cur = await t.request<{ version: number }>("GET", "/api/v1/cms/site", { token: admin });
    const off = await t.request("PATCH", "/api/v1/cms/site", { token: admin, body: { version: cur.body.version, site_live: false, coming_soon_message: "Launching soon" } });
    expect(off.status, off.text).toBe(200);
    const site = await pub<Site>("/api/v1/public/site");
    expect(site.status).toBe(200);
    expect(site.body.site_live).toBe(false);
    expect(site.body.coming_soon_message).toBe("Launching soon");
    expect(site.body.featured_projects).toEqual([]);
    expect(site.body.banners).toEqual([]);
    expect(site.body.latest_posts).toEqual([]);
    expect((await pub<Card[]>("/api/v1/public/projects")).body).toEqual([]);
    expect((await pub(`/api/v1/public/projects/${wp.slug}`)).status).toBe(404);
    const robots = await pub("/api/v1/public/robots.txt");
    expect(robots.text).toContain("Disallow: /");
    expect(robots.text).not.toContain("Allow: /");
    expect((await pub("/api/v1/public/sitemap.xml")).text).not.toContain("<loc>");
    const on = await t.request("PATCH", "/api/v1/cms/site", { token: admin, body: { version: cur.body.version + 1, site_live: true } });
    expect(on.status).toBe(200);
    const live = await pub<Site>("/api/v1/public/site");
    expect(live.body.site_live).toBe(true);
    expect(live.body.featured_projects.map((c) => c.slug)).toContain(wp.slug);
    expect((await pub("/api/v1/public/robots.txt")).text).toContain("Allow: /");
  });
});

describe("enquiries", () => {
  it("creates a lead (source WEBSITE) + enquiries row + staff notifications; dedupes by phone + project; replays with Idempotency-Key", async () => {
    const unreadBefore = (await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales })).body.unread;
    const body = { name: "Rahul Verma", phone: "+91 98765 11111", email: "rahul@example.com", project_slug: wp.slug, flat_type_code: wp.flatTypeCode, message: "Interested in 3 BHK", consent: true, website: "", utm: { source: "google", campaign: "diwali" } };
    const key = `enq-${Date.now()}`;
    const ip = freshIp();
    const r = await t.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", { ip, body, headers: { "idempotency-key": key } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.reference_number).toMatch(/^ENQ-/);
    expect(r.headers["cache-control"]).toBe("no-store");
    const leadsRows = await t.app.sql<{ id: string; source: string; stage: string; project_id: string; utm: unknown; is_read: boolean }[]>`select id, source, stage, project_id, utm, is_read from leads where phone = '9876511111'`;
    expect(leadsRows).toHaveLength(1);
    expect(leadsRows[0]!.source).toBe("WEBSITE");
    expect(leadsRows[0]!.stage).toBe("NEW");
    expect(leadsRows[0]!.project_id).toBe(wp.projectId);
    expect(leadsRows[0]!.is_read).toBe(false);
    const enq = await t.app.sql<{ reference_number: string; lead_id: string; is_read: boolean }[]>`select reference_number, lead_id, is_read from enquiries where phone = '9876511111'`;
    expect(enq).toHaveLength(1);
    expect(enq[0]!.reference_number).toBe(r.body.reference_number);
    expect(enq[0]!.lead_id).toBe(leadsRows[0]!.id);
    const unreadAfter = (await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales })).body.unread;
    expect(unreadAfter).toBeGreaterThan(unreadBefore);
    const adminUnread = (await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: admin })).body.unread;
    expect(adminUnread).toBeGreaterThan(0);
    // replay
    const again = await t.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", { ip, body, headers: { "idempotency-key": key } });
    expect(again.status).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.reference_number).toBe(r.body.reference_number);
    // same phone + project → activity on the existing lead, no duplicate lead
    const second = await t.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", { body: { ...body, message: "Calling back?" } });
    expect(second.status).toBe(200);
    expect(second.body.reference_number).not.toBe(r.body.reference_number);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = '9876511111'`)[0]!.n).toBe(1);
    const acts = await t.app.sql<{ type: string }[]>`select type from lead_activities where lead_id = ${leadsRows[0]!.id} order by at`;
    expect(acts.filter((a) => a.type === "ENQUIRY")).toHaveLength(2);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from enquiries where phone = '9876511111'`)[0]!.n).toBe(2);
    // validation: bad phone, missing consent, unknown project
    expect((await t.request<ErrorBody>("POST", "/api/v1/public/enquiries", { body: { ...body, phone: "12345" } })).status).toBe(400);
    expect((await t.request<ErrorBody>("POST", "/api/v1/public/enquiries", { body: { ...body, consent: false } })).status).toBe(400);
    expect((await t.request<ErrorBody>("POST", "/api/v1/public/enquiries", { body: { ...body, project_slug: hidden.slug } })).status).toBe(400);
  });

  it("honeypot → 200 with a fake reference and nothing created", async () => {
    const r = await t.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", { body: { name: "Bot Botson", phone: "9876522222", consent: true, website: "http://spam.example" } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.reference_number).toMatch(/^ENQ-\d{4}\/\d{4}$/); // same format as a real reference: the bot cannot tell it was dropped
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = '9876522222'`)[0]!.n).toBe(0);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from enquiries where phone = '9876522222'`)[0]!.n).toBe(0);
  });

  it("6th enquiry within a minute from one IP → 429 RATE_LIMITED with Retry-After", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    let last: { status: number; headers: Record<string, string | string[] | undefined>; body: ErrorBody } | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/public/enquiries", { ip, body: { name: `Visitor ${i}`, phone: `98765330${String(i).padStart(2, "0")}`, consent: true, website: "" } });
      statuses.push(r.status);
      last = r;
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe("RATE_LIMITED");
    expect(Number(last!.headers["retry-after"])).toBeGreaterThan(0);
    // another IP is unaffected
    expect((await t.request("POST", "/api/v1/public/enquiries", { body: { name: "Other", phone: "9876533099", consent: true, website: "" } })).status).toBe(200);
  });
});

describe("brochure lead gate", () => {
  let downloadUrl: string;
  let visitorToken: string;
  const phone = "9876544444";
  const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };

  it("first request creates a BROCHURE lead; the same phone + project reuses it with an activity; the link streams the PDF and counts once", async () => {
    const r = await t.request<{ download_url: string; expires_at: string; visitor_token: string; file_name: string }>("POST", "/api/v1/public/brochure-requests", { body: { project_slug: wp.slug, name: "Priya Verma", phone, email: "priya@example.com", consent: true, website: "" } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.download_url).toContain("/api/v1/public/brochure/");
    expect(r.body.file_name).toBe("brochure-SGH.pdf");
    expect(new Date(r.body.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    expect(new Date(r.body.expires_at).getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    downloadUrl = r.body.download_url;
    visitorToken = r.body.visitor_token;
    const leadRows = await t.app.sql<{ id: string; source: string }[]>`select id, source from leads where phone = ${phone}`;
    expect(leadRows).toHaveLength(1);
    expect(leadRows[0]!.source).toBe("BROCHURE");
    const second = await t.request<{ download_url: string }>("POST", "/api/v1/public/brochure-requests", { body: { project_slug: wp.slug, name: "Priya Verma", phone: "+919876544444", consent: true, website: "" } });
    expect(second.status).toBe(200);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = ${phone}`)[0]!.n).toBe(1);
    const acts = await t.app.sql<{ type: string }[]>`select type from lead_activities where lead_id = ${leadRows[0]!.id} and type = 'BROCHURE_DOWNLOADED'`;
    expect(acts).toHaveLength(2);
    const sales2 = await t.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales });
    expect(sales2.body.unread).toBeGreaterThan(0);

    const dl = await t.app.inject({ method: "GET", url: pathOf(downloadUrl), headers: { "x-forwarded-for": freshIp() } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(String(dl.headers["content-disposition"])).toMatch(/^attachment; filename="brochure-SGH.pdf"/);
    expect(dl.rawPayload.equals(PDF_BYTES)).toBe(true);
    const stats1 = await t.request<{ download_count: number; requests_count: number; downloads_30d: number; sparkline: { count: number }[] }>("GET", `/api/v1/projects/${wp.projectId}/brochure-stats`, { token: sales });
    expect(stats1.status, stats1.text).toBe(200);
    expect(stats1.body.download_count).toBe(1);
    expect(stats1.body.requests_count).toBe(2);
    expect(stats1.body.downloads_30d).toBe(1);
    expect(stats1.body.sparkline).toHaveLength(30);
    expect(stats1.body.sparkline[29]!.count).toBe(1);
    // same link again still streams but the counter stays at 1
    const dl2 = await t.app.inject({ method: "GET", url: pathOf(downloadUrl), headers: { "x-forwarded-for": freshIp() } });
    expect(dl2.statusCode).toBe(200);
    const stats2 = await t.request<{ download_count: number }>("GET", `/api/v1/projects/${wp.projectId}/brochure-stats`, { token: admin });
    expect(stats2.body.download_count).toBe(1);
    const row = await t.request<{ brochure_download_count: number }>("GET", `/api/v1/projects/${wp.projectId}/website`, { token: admin });
    expect(row.body.brochure_download_count).toBe(1);
  });

  it("forged, expired and tampered links are 404", async () => {
    const forged = downloadUrl.slice(0, -2) + (downloadUrl.endsWith("AA") ? "BB" : "AA");
    expect((await t.app.inject({ method: "GET", url: pathOf(forged), headers: { "x-forwarded-for": freshIp() } })).statusCode).toBe(404);
    expect((await pub("/api/v1/public/brochure/not-a-real-token-at-all")).status).toBe(404);
    const { signBrochureToken } = await import("../../src/modules/web/publicForms.js");
    const expired = signBrochureToken(-1).token;
    expect((await pub(`/api/v1/public/brochure/${expired}`)).status).toBe(404);
    const unknownRow = signBrochureToken(60).token; // validly signed but never issued → no row → 404
    expect((await pub(`/api/v1/public/brochure/${unknownRow}`)).status).toBe(404);
    // a stored link whose row expired (clock moved on) is rejected as well
    const { sha256 } = await import("../../src/lib/crypto.js");
    await t.app.sql`update brochure_downloads set expires_at = now() - interval '1 minute' where token_hash = ${sha256(downloadUrl.split("/brochure/")[1]!)}`;
    expect((await t.app.inject({ method: "GET", url: pathOf(downloadUrl), headers: { "x-forwarded-for": freshIp() } })).statusCode).toBe(404);
  });

  it("a returning visitor_token skips the details but still logs the activity; project without a brochure → 404; honeypot → fake link", async () => {
    const r = await t.request<{ download_url: string; visitor_token: string }>("POST", "/api/v1/public/brochure-requests", { body: { project_slug: wp.slug, visitor_token: visitorToken, website: "" } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.visitor_token).toBe(visitorToken);
    const [lead] = await t.app.sql<{ id: string }[]>`select id from leads where phone = ${phone}`;
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from lead_activities where lead_id = ${lead!.id} and type = 'BROCHURE_DOWNLOADED'`)[0]!.n).toBe(3);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = ${phone}`)[0]!.n).toBe(1);
    const dl = await t.app.inject({ method: "GET", url: pathOf(r.body.download_url), headers: { "x-forwarded-for": freshIp() } });
    expect(dl.statusCode).toBe(200);
    // garbage visitor token without details → 400; details missing consent → 400
    expect((await t.request<ErrorBody>("POST", "/api/v1/public/brochure-requests", { body: { project_slug: wp.slug, visitor_token: "x".repeat(40), website: "" } })).status).toBe(400);
    expect((await t.request<ErrorBody>("POST", "/api/v1/public/brochure-requests", { body: { project_slug: wp.slug, name: "No Consent", phone: "9876555555", website: "" } })).status).toBe(400);
    // unpublished project → 404; published project without brochure → 404
    expect((await t.request("POST", "/api/v1/public/brochure-requests", { body: { project_slug: hidden.slug, name: "X Y", phone: "9876555556", consent: true, website: "" } })).status).toBe(404);
    const noBrochure = await createWebProject(t, admin, { name: "No Brochure Towers", code: "NBT", suffix: "W4" });
    await publishWebProject(t, admin, noBrochure, { brochure_document_id: null });
    expect((await pub<Detail>(`/api/v1/public/projects/${noBrochure.slug}`)).body.brochure_available).toBe(false);
    expect((await t.request("POST", "/api/v1/public/brochure-requests", { body: { project_slug: noBrochure.slug, name: "X Y", phone: "9876555557", consent: true, website: "" } })).status).toBe(404);
    const bot = await t.request<{ download_url: string }>("POST", "/api/v1/public/brochure-requests", { body: { project_slug: wp.slug, name: "Bot", phone: "9876555558", consent: true, website: "spam" } });
    expect(bot.status).toBe(200);
    expect((await t.app.inject({ method: "GET", url: pathOf(bot.body.download_url), headers: { "x-forwarded-for": freshIp() } })).statusCode).toBe(404);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = '9876555558'`)[0]!.n).toBe(0);
  });
});

describe("gallery and testimonials respect publication", () => {
  it("gallery items of unpublished projects are hidden; testimonials show up on /public/site", async () => {
    const png = await pngBytes(800, 600);
    const g1 = await uploadDoc(t, marketing, { entity_type: "CMS", entity_id: t.companyId, title: "Lobby" }, { name: "lobby.png", data: png });
    const g2 = await uploadDoc(t, marketing, { entity_type: "CMS", entity_id: t.companyId, title: "Hidden lobby" }, { name: "hidden.png", data: png });
    expect((await t.request("POST", "/api/v1/cms/gallery", { token: marketing, body: { project_id: wp.projectId, document_id: g1, caption: "Grand lobby", category: "Interiors" } })).status).toBe(201);
    expect((await t.request("POST", "/api/v1/cms/gallery", { token: marketing, body: { project_id: hidden.projectId, document_id: g2, caption: "Secret" } })).status).toBe(201);
    const gallery = await pub<{ items: { caption: string | null; project_slug: string | null; url?: string }[]; projects: { slug: string }[] }>("/api/v1/public/gallery");
    expect(gallery.status).toBe(200);
    expect(gallery.body.items.map((i) => i.caption)).toContain("Grand lobby");
    expect(gallery.body.items.map((i) => i.caption)).not.toContain("Secret");
    expect(gallery.body.projects.map((p) => p.slug)).toEqual([wp.slug]);
    expect(gallery.body.items[0]!.url).toContain("/api/v1/public/media/");
    const forProject = await pub<{ items: unknown[] }>(`/api/v1/public/gallery?project=${wp.slug}`);
    expect(forProject.body.items).toHaveLength(1);
    expect((await pub(`/api/v1/public/gallery?project=${hidden.slug}`)).status).toBe(404);
    const tm = await t.request("POST", "/api/v1/cms/testimonials", { token: marketing, body: { name: "Rajesh Kumar Sinha", project_id: wp.projectId, quote: "A wonderful home-buying experience with SGB.", rating: 5, is_published: true } });
    expect(tm.status, tm.text).toBe(201);
    const site = await pub<Site>("/api/v1/public/site");
    expect(site.body.testimonials).toHaveLength(1);
    expect(site.body.home_sections.map((s) => s.key)).toContain("value_props");
    expect(site.body.latest_posts.map((p) => p.slug)).toContain("why-patna");
  });
});
