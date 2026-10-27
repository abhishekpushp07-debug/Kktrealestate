/**
 * Adversarial review of the web module: honeypot indistinguishability, media allow-list, site_live semantics, cache generation + key
 * hygiene, proxy-aware rate limits, brochure token binding, .ics folding/escaping for 30-minute slots, slug hygiene, scope.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDays, todayIST } from "@kkt/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PDF_BYTES,
  createWebProject,
  findKeys,
  pngBytes,
  publishWebProject,
  uploadDoc,
  type WebProject,
} from "./fixtures/web.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";

process.env["STORAGE_LOCAL_DIR"] = mkdtempSync(join(tmpdir(), "kkt-web-adv-test-"));

type Booking = {
  visit_number: string;
  project_name: string;
  slot_end: string;
  end: string;
  address: string | null;
  ics_url: string;
  manage_url: string;
};
type Brochure = { download_url: string; expires_at: string; visitor_token: string; file_name: string };

let t: TestContext;
let admin: string;
let marketing: string;
let projectsUser: string;
let wp: WebProject;
let hidden: WebProject;
let siteVersion: number;
let visitSettingsVersion: number;

const today = todayIST();
const D = (n: number) => addDays(today, n);
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};
const NUMBER_RE = (prefix: string) => new RegExp(`^${prefix}\\d{4}/\\d{4}$`);
const BROCHURE_TOKEN_RE = /^[A-Za-z0-9_-]{16}\.[0-9a-z]+\.[0-9a-f]{32}$/;
/** Opaque visitor token (phase 7): `<kid>.<lead reference + expiry>.<hmac>`. */
const SIGNED_PAYLOAD_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const VISIT_SETTINGS = {
  enabled: true,
  visit_days: [0, 1, 2, 3, 4, 5, 6],
  start_time: "10:00",
  end_time: "13:00",
  slot_minutes: 60,
  seats_per_slot: 2,
  min_lead_hours: 1,
  max_days_ahead: 14,
  blackout_dates: [D(5)],
  site_office_address: "Site office, Bailey Road, Patna",
  maps_link: "https://maps.google.com/?q=SGH",
  instructions: "Carry a photo ID.",
};

async function pub<T>(url: string, ip?: string) {
  return t.request<T>("GET", url, ip ? { ip } : {});
}
async function media(id: string, variant?: string) {
  return t.app.inject({
    method: "GET",
    url: `/api/v1/public/media/${id}${variant ? `?variant=${variant}` : ""}`,
    headers: { "x-forwarded-for": freshIp() },
  });
}
async function setSiteLive(live: boolean) {
  const r = await t.request<{ version: number }>("PATCH", "/api/v1/cms/site", {
    token: admin,
    body: { version: siteVersion, site_live: live, coming_soon_message: live ? null : "Launching soon" },
  });
  expect(r.status, r.text).toBe(200);
  siteVersion = r.body.version;
}
async function patchVisitSettings(settings: Record<string, unknown>) {
  const r = await t.request<{ version: number }>("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
    token: admin,
    body: { version: visitSettingsVersion, settings },
  });
  expect(r.status, r.text).toBe(200);
  visitSettingsVersion = r.body.version;
}
async function count(table: string, where: string, value: string): Promise<number> {
  const [r] = await t.app.sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table} where ${where} = $1`, [
    value,
  ]);
  return r!.n;
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  marketing = (await t.loginAs("marketing")).access_token;
  projectsUser = (await t.loginAs("projects")).access_token;
  wp = await createWebProject(t, admin, { name: "Shree Ganesh Heights", code: "SGH", suffix: "A1" });
  hidden = await createWebProject(t, admin, { name: "Hidden Villas", code: "HV", suffix: "A2" });
  await publishWebProject(t, admin, wp);
  siteVersion = (await t.request<{ version: number }>("GET", "/api/v1/cms/site", { token: admin })).body.version;
  visitSettingsVersion = (
    await t.request<{ version: number }>("GET", `/api/v1/projects/${wp.projectId}/visit-settings`, { token: admin })
  ).body.version;
  await patchVisitSettings(VISIT_SETTINGS);
});
afterAll(async () => {
  await t?.close();
});

describe("honeypot replies are indistinguishable from real ones", () => {
  it("enquiry: same status, keys and reference format (PREFIX-FY/0000); nothing written for the bot", async () => {
    const real = await t.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", {
      body: { name: "Real Person", phone: "9876611001", consent: true, website: "", project_slug: wp.slug },
    });
    const bot = await t.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", {
      body: {
        name: "Bot Person",
        phone: "9876611002",
        consent: true,
        website: "http://spam.example",
        project_slug: wp.slug,
      },
    });
    expect(real.status, real.text).toBe(200);
    expect(bot.status, bot.text).toBe(200);
    expect(real.body.reference_number).toMatch(NUMBER_RE("ENQ-"));
    expect(bot.body.reference_number).toMatch(NUMBER_RE("ENQ-"));
    expect(Object.keys(bot.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(bot.headers["cache-control"]).toBe(real.headers["cache-control"]);
    expect(await count("leads", "phone", "9876611002")).toBe(0);
    expect(await count("enquiries", "phone", "9876611002")).toBe(0);
    expect(await count("leads", "phone", "9876611001")).toBe(1);
    // the bot sees the same validation errors as a human
    expect(
      (
        await t.request("POST", "/api/v1/public/enquiries", {
          body: { name: "Bot", phone: "9876611003", consent: true, website: "x", project_slug: hidden.slug },
        })
      ).status,
    ).toBe(400);
  });

  it("brochure: same keys, same signed-token formats, real file name; the bot's link is a 404 exactly like an expired one; nothing written", async () => {
    const real = await t.request<Brochure>("POST", "/api/v1/public/brochure-requests", {
      body: { project_slug: wp.slug, name: "Real Person", phone: "9876611011", consent: true, website: "" },
    });
    const bot = await t.request<Brochure>("POST", "/api/v1/public/brochure-requests", {
      body: { project_slug: wp.slug, name: "Bot Person", phone: "9876611012", consent: true, website: "spam" },
    });
    expect(real.status, real.text).toBe(200);
    expect(bot.status, bot.text).toBe(200);
    expect(Object.keys(bot.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(real.body.download_url.split("/brochure/")[1]).toMatch(BROCHURE_TOKEN_RE);
    expect(bot.body.download_url.split("/brochure/")[1]).toMatch(BROCHURE_TOKEN_RE);
    expect(real.body.visitor_token).toMatch(SIGNED_PAYLOAD_RE);
    expect(bot.body.visitor_token).toMatch(SIGNED_PAYLOAD_RE);
    expect(bot.body.file_name).toBe(real.body.file_name);
    expect(Math.abs(new Date(bot.body.expires_at).getTime() - new Date(real.body.expires_at).getTime())).toBeLessThan(
      5000,
    );
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: pathOf(bot.body.download_url),
          headers: { "x-forwarded-for": freshIp() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: pathOf(real.body.download_url),
          headers: { "x-forwarded-for": freshIp() },
        })
      ).statusCode,
    ).toBe(200);
    expect(await count("leads", "phone", "9876611012")).toBe(0);
    const [rows] = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from brochure_downloads b join leads l on l.id = b.lead_id where l.phone = '9876611012'`;
    expect(rows!.n).toBe(0);
    // unknown project: 404 for human and bot alike
    expect(
      (
        await t.request("POST", "/api/v1/public/brochure-requests", {
          body: { project_slug: hidden.slug, name: "Bot", phone: "9876611013", consent: true, website: "spam" },
        })
      ).status,
    ).toBe(404);
  });

  it("site visit: same 201, keys, project name, real slot end and address; same 422 for an invalid slot; nothing written", async () => {
    const body = (phone: string, extra: Record<string, unknown>) => ({
      project_slug: wp.slug,
      date: D(3),
      start: "10:00",
      name: `Visitor ${phone.slice(-4)}`,
      phone,
      visitors: 2,
      consent: true,
      website: "",
      ...extra,
    });
    const real = await t.request<Booking>("POST", "/api/v1/public/site-visits", { body: body("9876611021", {}) });
    const bot = await t.request<Booking>("POST", "/api/v1/public/site-visits", {
      body: body("9876611022", { website: "bot" }),
    });
    expect(real.status, real.text).toBe(201);
    expect(bot.status, bot.text).toBe(201);
    expect(Object.keys(bot.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(bot.body.visit_number).toMatch(NUMBER_RE("SV-"));
    expect(real.body.visit_number).toMatch(NUMBER_RE("SV-"));
    expect(bot.body.project_name).toBe("Shree Ganesh Heights");
    expect(bot.body.slot_end).toBe("11:00");
    expect(bot.body.end).toBe("11:00");
    expect(bot.body.address).toBe(VISIT_SETTINGS.site_office_address);
    expect(bot.body.manage_url).toMatch(/^http:\/\/localhost:3000\/visit\/[A-Za-z0-9_-]+$/);
    expect(await count("site_visits", "phone", "9876611022")).toBe(0);
    expect(await count("leads", "phone", "9876611022")).toBe(0);
    const invalid = await t.request<ErrorBody>("POST", "/api/v1/public/site-visits", {
      body: body("9876611023", { website: "bot", date: D(5) }),
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details?.["rule"]).toBe("SLOT_INVALID");
    expect(
      (
        await t.request("POST", "/api/v1/public/site-visits", {
          body: body("9876611024", { website: "bot", project_slug: hidden.slug }),
        })
      ).status,
    ).toBe(404);
  });
});

describe("public media allow-list", () => {
  it("serves only images referenced by published content: hidden project heroes, internal stage photos and unreferenced project scans are 404 even by id", async () => {
    expect((await media(wp.heroDocId)).statusCode).toBe(200);
    expect((await media(wp.websitePhotoDocId, "thumb")).statusCode).toBe(200);
    expect((await media(wp.hiddenPhotoDocId)).statusCode).toBe(404); // show_on_website = false
    expect((await media(hidden.heroDocId)).statusCode).toBe(404); // unpublished project
    expect((await media(hidden.websitePhotoDocId)).statusCode).toBe(404); // flagged, but the project is unpublished
    const scan = await uploadDoc(
      t,
      admin,
      { entity_type: "PROJECT", entity_id: wp.projectId, title: "Land deed scan" },
      { name: "deed.png", data: await pngBytes(600, 400) },
    );
    expect((await media(scan)).statusCode).toBe(404); // a project image nobody published
    const plan = await uploadDoc(
      t,
      admin,
      { entity_type: "PROJECT", entity_id: wp.projectId, title: `Floor plan ${wp.flatTypeCode}` },
      { name: "plan.png", data: await pngBytes(600, 400) },
    );
    expect((await media(plan)).statusCode).toBe(200); // floor plans are part of the configurations payload
    const cms = await uploadDoc(
      t,
      marketing,
      { entity_type: "CMS", entity_id: t.companyId, title: "Lobby" },
      { name: "lobby.png", data: await pngBytes(600, 400) },
    );
    expect((await media(cms, "medium")).statusCode).toBe(200);
    // unpublishing flips the hero to 404 immediately (cache generation bumped)
    const cur = await t.request<{ version: number }>("GET", `/api/v1/projects/${wp.projectId}/website`, {
      token: admin,
    });
    const off = await t.request<{ version: number }>("POST", `/api/v1/projects/${wp.projectId}/website/publish`, {
      token: admin,
      body: { version: cur.body.version, is_published: false },
    });
    expect(off.status, off.text).toBe(200);
    expect((await media(wp.heroDocId)).statusCode).toBe(404);
    expect((await media(wp.websitePhotoDocId)).statusCode).toBe(404);
    const on = await t.request<{ version: number }>("POST", `/api/v1/projects/${wp.projectId}/website/publish`, {
      token: admin,
      body: { version: off.body.version, is_published: true },
    });
    expect(on.status, on.text).toBe(200);
    wp.websiteVersion = on.body.version;
    expect((await media(wp.heroDocId)).statusCode).toBe(200);
  });
});

describe("public media while renditions are pending (phase 7 integration)", () => {
  it("the original served as a stand-in for a thumb/medium is cached for a minute, never as immutable; real renditions stay immutable", async () => {
    const cms = await uploadDoc(
      t,
      marketing,
      { entity_type: "CMS", entity_id: t.companyId, title: "Pending renditions" },
      { name: "pending.png", data: await pngBytes(600, 400) },
    );
    const ready = await media(cms, "thumb");
    expect(ready.statusCode).toBe(200);
    expect(ready.headers["content-type"]).toBe("image/webp");
    expect(ready.headers["cache-control"]).toMatch(/immutable/);
    // as if the DOCUMENT_RENDITIONS job had not run yet: no rendition keys
    await t.app.sql`update documents set variants = variants - 'thumb_key' - 'medium_key' where id = ${cms}`;
    for (const variant of ["thumb", "medium"]) {
      const stand = await media(cms, variant);
      expect(stand.statusCode).toBe(200);
      expect(stand.headers["content-type"]).toBe("image/png"); // the original
      expect(stand.headers["cache-control"]).toBe("public, max-age=60");
    }
    const original = await media(cms);
    expect(original.headers["cache-control"]).toMatch(/immutable/);
  });
});

describe("site_live off", () => {
  it("hides projects, media, forms and the scheduler but keeps legal pages reachable", async () => {
    const page = await t.request("POST", "/api/v1/cms/pages", {
      token: marketing,
      body: { slug: "privacy", title: "Privacy policy", body_md: "We care.", is_published: true },
    });
    expect(page.status, page.text).toBe(201);
    await setSiteLive(false);
    expect((await pub<{ title: string }>("/api/v1/public/pages/privacy")).status).toBe(200);
    expect((await pub(`/api/v1/public/projects/${wp.slug}`)).status).toBe(404);
    expect((await pub(`/api/v1/public/projects/${wp.slug}/visit-availability`)).status).toBe(404);
    expect((await media(wp.heroDocId)).statusCode).toBe(404);
    expect(
      (
        await t.request("POST", "/api/v1/public/brochure-requests", {
          body: { project_slug: wp.slug, name: "X Y", phone: "9876611031", consent: true, website: "" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.request("POST", "/api/v1/public/site-visits", {
          body: {
            project_slug: wp.slug,
            date: D(3),
            start: "11:00",
            name: "X Y",
            phone: "9876611032",
            visitors: 1,
            consent: true,
            website: "",
          },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.request("POST", "/api/v1/public/enquiries", {
          body: { name: "X Y", phone: "9876611033", consent: true, website: "", project_slug: wp.slug },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.request("POST", "/api/v1/public/enquiries", {
          body: { name: "X Y", phone: "9876611034", consent: true, website: "" },
        })
      ).status,
    ).toBe(200); // coming-soon page still captures interest
    expect((await pub<{ entries: unknown[] }>("/api/v1/public/sitemap")).body.entries).toEqual([]);
    await setSiteLive(true);
    expect((await pub(`/api/v1/public/projects/${wp.slug}`)).status).toBe(200);
    expect((await media(wp.heroDocId)).statusCode).toBe(200);
  });
});

describe("public cache", () => {
  it("is invalidated through a generation key on every CMS write and ignores junk query strings when building keys", async () => {
    const site1 = await pub<{ disclaimer: string | null }>("/api/v1/public/site");
    expect(site1.status).toBe(200);
    const v1 = Number((await t.app.redis.get("pub:version")) ?? "0");
    const upd = await t.request<{ version: number }>("PATCH", "/api/v1/cms/site", {
      token: marketing,
      body: { version: siteVersion, disclaimer: `RERA disclaimer ${Date.now()}` },
    });
    expect(upd.status, upd.text).toBe(200);
    siteVersion = upd.body.version;
    const v2 = Number((await t.app.redis.get("pub:version")) ?? "0");
    expect(v2).toBeGreaterThan(v1);
    const site2 = await pub<{ disclaimer: string | null }>("/api/v1/public/site");
    expect(site2.body.disclaimer).toMatch(/^RERA disclaimer/);
    expect(site2.body.disclaimer).not.toBe(site1.body.disclaimer);
    const before = (await t.app.redis.keys("pub:*")).length;
    for (let i = 0; i < 25; i++) expect((await pub(`/api/v1/public/site?junk=${i}`)).status).toBe(200);
    const after = (await t.app.redis.keys("pub:*")).length;
    expect(after - before).toBeLessThanOrEqual(1);
    // validated queries still get distinct entries
    expect((await pub<unknown[]>("/api/v1/public/projects?bhk=3")).body).toHaveLength(1);
    expect((await pub<unknown[]>("/api/v1/public/projects?bhk=2")).body).toHaveLength(0);
    expect((await pub("/api/v1/public/projects?junk=1")).status).toBe(400);
  });
});

describe("rate limit keys on the proxy-aware client IP (TRUST_PROXY=loopback)", () => {
  it("6th form post from one client → 429; prepending a spoofed hop does not escape the limit; another client is unaffected", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push(
        (
          await t.request("POST", "/api/v1/public/enquiries", {
            ip: "203.0.113.9",
            body: { name: `Hop ${i}`, phone: `98766120${String(i).padStart(2, "0")}`, consent: true, website: "" },
          })
        ).status,
      );
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // The left-most X-Forwarded-For entry is attacker-controlled: the client is the right-most hop the trusted proxy appended.
    expect(
      (
        await t.request("POST", "/api/v1/public/enquiries", {
          ip: "198.51.100.77, 203.0.113.9",
          body: { name: "Spoof", phone: "9876612098", consent: true, website: "" },
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await t.request("POST", "/api/v1/public/enquiries", {
          ip: "203.0.113.10",
          body: { name: "Other", phone: "9876612099", consent: true, website: "" },
        })
      ).status,
    ).toBe(200);
  });
});

describe("brochure links", () => {
  it("are bound to one brochure_downloads row: each streams its own project's PDF, tampering any part → 404, counts land on the right project", async () => {
    const other = await createWebProject(t, admin, { name: "Riverside Residency", code: "RR", suffix: "A3" });
    const pdfB = Buffer.concat([PDF_BYTES, Buffer.from("% project B\n", "latin1")]);
    const brochureB = await uploadDoc(
      t,
      admin,
      { entity_type: "PROJECT", entity_id: other.projectId, title: "Brochure B" },
      { name: "brochure-RR.pdf", data: pdfB },
    );
    await publishWebProject(t, admin, other, { brochure_document_id: brochureB });
    const a = await t.request<Brochure>("POST", "/api/v1/public/brochure-requests", {
      body: { project_slug: wp.slug, name: "Link A", phone: "9876612101", consent: true, website: "" },
    });
    const b = await t.request<Brochure>("POST", "/api/v1/public/brochure-requests", {
      body: { project_slug: other.slug, name: "Link B", phone: "9876612102", consent: true, website: "" },
    });
    expect([a.status, b.status]).toEqual([200, 200]);
    const dlA = await t.app.inject({
      method: "GET",
      url: pathOf(a.body.download_url),
      headers: { "x-forwarded-for": freshIp() },
    });
    const dlB = await t.app.inject({
      method: "GET",
      url: pathOf(b.body.download_url),
      headers: { "x-forwarded-for": freshIp() },
    });
    expect(dlA.rawPayload.equals(PDF_BYTES)).toBe(true);
    expect(dlB.rawPayload.equals(pdfB)).toBe(true);
    expect(String(dlB.headers["content-disposition"])).toContain('filename="brochure-RR.pdf"');
    const [nonce, exp, sig] = a.body.download_url.split("/brochure/")[1]!.split(".") as [string, string, string];
    const [nonceB] = b.body.download_url.split("/brochure/")[1]!.split(".") as [string];
    for (const forged of [
      `${nonceB}.${exp}.${sig}`,
      `${nonce}.${(parseInt(exp, 36) + 600).toString(36)}.${sig}`,
      `${nonce}.${exp}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`,
    ]) {
      expect((await pub(`/api/v1/public/brochure/${forged}`)).status).toBe(404);
    }
    const statsA = await t.request<{ download_count: number }>(
      "GET",
      `/api/v1/projects/${wp.projectId}/brochure-stats`,
      { token: admin },
    );
    const statsB = await t.request<{ download_count: number }>(
      "GET",
      `/api/v1/projects/${other.projectId}/brochure-stats`,
      { token: admin },
    );
    expect(statsB.body.download_count).toBe(1);
    expect(statsA.body.download_count).toBeGreaterThanOrEqual(1);
    const audits = await t.app.sql<
      { action: string; actor_type: string }[]
    >`select action, actor_type from audit_logs where entity_type = 'brochure_download' and action = 'brochure_download.download'`;
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.every((x) => x.actor_type === "SYSTEM")).toBe(true);
  });
});

describe(".ics", () => {
  it("30-minute slots end 30 minutes later; commas/semicolons are escaped and long lines are folded at 75 octets", async () => {
    const longAddress =
      "Site Office, Plot 12; Bailey Road, Raja Bazar, Patna 800014 — ask for Mr. Sharma at the gate and carry a photo identity card";
    await patchVisitSettings({
      ...VISIT_SETTINGS,
      slot_minutes: 30,
      end_time: "12:00",
      site_office_address: longAddress,
      instructions: "Parking is available; please arrive 10 minutes early.",
    });
    const avail = await pub<{ date: string; slots: { start: string; end: string }[] }[]>(
      `/api/v1/public/projects/${wp.slug}/visit-availability?from=${D(4)}&to=${D(4)}`,
    );
    expect(avail.status, avail.text).toBe(200);
    expect(avail.body[0]!.slots.map((s) => `${s.start}-${s.end}`)).toEqual([
      "10:00-10:30",
      "10:30-11:00",
      "11:00-11:30",
      "11:30-12:00",
    ]);
    const r = await t.request<Booking>("POST", "/api/v1/public/site-visits", {
      body: {
        project_slug: wp.slug,
        date: D(4),
        start: "10:30",
        name: "Half Hour",
        phone: "9876612201",
        visitors: 1,
        consent: true,
        website: "",
      },
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body.slot_end).toBe("11:00");
    const ics = await t.app.inject({
      method: "GET",
      url: pathOf(r.body.ics_url),
      headers: { "x-forwarded-for": freshIp() },
    });
    expect(ics.statusCode).toBe(200);
    const text = ics.body;
    expect(text).toContain(`DTSTART;TZID=Asia/Kolkata:${D(4).replace(/-/g, "")}T103000`);
    expect(text).toContain(`DTEND;TZID=Asia/Kolkata:${D(4).replace(/-/g, "")}T110000`);
    expect(text).toContain("TRIGGER:-PT1H");
    const unfolded = text.replace(/\r\n[ \t]/g, "");
    expect(unfolded).toContain("LOCATION:Site Office\\, Plot 12\\; Bailey Road\\, Raja Bazar\\, Patna 800014");
    expect(unfolded).toContain("Parking is available\\; please arrive 10 minutes early.");
    for (const line of text.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    await patchVisitSettings(VISIT_SETTINGS);
  });

  it("a past visit cannot be cancelled from its manage link (422 VISIT_PAST) and shows can_cancel=false", async () => {
    const { sha256 } = await import("../../src/lib/crypto.js");
    const token = "past-visit-manage-token-000000000001";
    // a visit that ended recently: its link still works for 24 h after the slot (expiry set explicitly here)
    await t.app
      .sql`insert into site_visits (company_id, visit_number, project_id, visit_date, slot_start, slot_end, visitors, name, phone, status, source, manage_token_hash, manage_token_expires_at)
      values (${t.companyId}, 'SV-TEST/0777', ${wp.projectId}, ${D(-2)}, '10:00', '11:00', 1, 'Yesterday Visitor', '9876612301', 'CONFIRMED', 'WEBSITE', ${sha256(token)}, now() + interval '1 hour')`;
    const manage = await t.request<{ can_cancel: boolean; project_slug: string }>(
      "GET",
      `/api/v1/public/site-visits/${token}`,
    );
    expect(manage.status, manage.text).toBe(200);
    expect(manage.body.can_cancel).toBe(false);
    expect(manage.body.project_slug).toBe(wp.slug);
    const cancel = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${token}/cancel`, {
      body: { reason: "late", website: "" },
    });
    expect(cancel.status).toBe(422);
    expect(cancel.body.error.details?.["rule"]).toBe("VISIT_PAST");
    // once the 24 h grace has passed the link is dead
    await t.app
      .sql`update site_visits set manage_token_expires_at = now() - interval '1 minute' where visit_number = 'SV-TEST/0777'`;
    expect((await t.request<ErrorBody>("GET", `/api/v1/public/site-visits/${token}`)).body.error.code).toBe(
      "LINK_EXPIRED",
    );
  });
});

describe("slugs", () => {
  it("rejects CMS page slugs that shadow website routes, keeps the sitemap free of duplicate paths, and gives same-named projects distinct slugs", async () => {
    const bad = await t.request<ErrorBody>("POST", "/api/v1/cms/pages", {
      token: marketing,
      body: { slug: "projects", title: "Shadow", body_md: "x", is_published: true },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    const about = await t.request("POST", "/api/v1/cms/pages", {
      token: marketing,
      body: { slug: "about", title: "About us", body_md: "Story.", is_published: true },
    });
    expect(about.status, about.text).toBe(201);
    const sitemap = await pub<{ entries: { path: string }[] }>("/api/v1/public/sitemap");
    const paths = sitemap.body.entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p === "/about")).toHaveLength(1);
    const twin1 = await createWebProject(t, admin, { name: "Twin Towers", code: "TT1", suffix: "A4" });
    const twin2 = await createWebProject(t, admin, { name: "Twin Towers", code: "TT2", suffix: "A5" });
    const s1 = (
      await t.request<{ slug: string }>("GET", `/api/v1/projects/${twin1.projectId}/website`, { token: admin })
    ).body.slug;
    const s2 = (
      await t.request<{ slug: string }>("GET", `/api/v1/projects/${twin2.projectId}/website`, { token: admin })
    ).body.slug;
    expect(s1).toBe("twin-towers");
    expect(s2).toBe("twin-towers-tt2");
    const dup = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${twin2.projectId}/website`, {
      token: admin,
      body: { version: twin2.websiteVersion, slug: s1 },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
  });
});

describe("scope and leakage", () => {
  it("scoped users get 404 on brochure stats, visit settings and visit lists of other projects; public payloads never carry ids, costs or token hashes", async () => {
    expect(
      (await t.request("GET", `/api/v1/projects/${wp.projectId}/brochure-stats`, { token: projectsUser })).status,
    ).toBe(404);
    expect(
      (
        await t.request("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
          token: projectsUser,
          body: { version: visitSettingsVersion, settings: VISIT_SETTINGS },
        })
      ).status,
    ).toBe(404);
    expect(
      (await t.request("GET", `/api/v1/site-visits?project_id=${wp.projectId}`, { token: projectsUser })).status,
    ).toBe(404);
    expect(
      (
        await t.request("GET", `/api/v1/site-visits/availability?project_id=${wp.projectId}&from=${D(3)}&to=${D(3)}`, {
          token: projectsUser,
        })
      ).status,
    ).toBe(404);
    const bodies: unknown[] = [];
    for (const url of [
      "/api/v1/public/site",
      "/api/v1/public/projects",
      `/api/v1/public/projects/${wp.slug}`,
      `/api/v1/public/projects/${wp.slug}/visit-availability`,
      "/api/v1/public/posts",
      "/api/v1/public/gallery",
      "/api/v1/public/people",
      "/api/v1/public/pages/privacy",
      "/api/v1/public/sitemap",
    ]) {
      const r = await pub(url);
      expect(r.status, url).toBe(200);
      bodies.push(r.body);
    }
    for (const b of bodies) {
      expect(findKeys(b, (k) => (k.endsWith("_id") && k !== "ga_id") || k === "id" || k.endsWith("_ids"))).toEqual([]);
      expect(findKeys(b, (k) => /storage_key|cost|password|token|hash|assigned|customer|lead/i.test(k))).toEqual([]);
    }
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(/"(HOLD|BOOKED|BLOCKED|SOLD)"/);
    expect(text).not.toContain(t.companyId);
    expect(text).not.toContain(wp.projectId);
    expect(text).not.toContain(wp.hiddenPhotoDocId);
  });
});
