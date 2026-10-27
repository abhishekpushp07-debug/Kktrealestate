import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOOT_TIMEOUT,
  bootAcceptance,
  findKeys,
  freshIp,
  key,
  projectByCode,
  type ErrorBody,
  type Harness,
  type List,
} from "./harness.js";

/**
 * SPEC §18 scenario 11 (L252): "Website: unpublished project 404s everywhere; toggling 'show prices' off removes prices from API and page;
 * enquiry creates a lead and shows in the inbox; 6th enquiry per minute → rate-limited; honeypot → dropped."
 * SPEC L218 publication, L220 enquiry flow, L42 public rate limits + honeypot. (The rendered page is covered by the browser QA stage; the
 * page renders exactly what these public endpoints return.)
 */

const SGH = "shree-ganesh-heights";
const GGV = "ganesh-green-villas";
const PRICE_KEY = /price|cost|rate_|_rate/i;

type Website = { version: number; is_published: boolean; show_prices: boolean; slug: string };
type Card = { slug: string; starting_price_paise: number | null };
type Detail = Card & {
  show_prices: boolean;
  configurations: { price_paise?: number | null; price_from_paise?: number | null }[];
  availability: { blocks: { floors: { cells: { price_paise: number | null }[] }[] }[] } | null;
};

let h: Harness;
let admin: string;
let sales: string;
let marketing: string;
let sghId: string;
let ggvId: string;

async function website(projectId: string): Promise<Website> {
  const r = await h.request<Website>("GET", `/api/v1/projects/${projectId}/website`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function patchWebsite(projectId: string, patch: Record<string, unknown>): Promise<Website> {
  const cur = await website(projectId);
  const r = await h.request<Website & ErrorBody>("PATCH", `/api/v1/projects/${projectId}/website`, {
    token: admin,
    body: { version: cur.version, ...patch },
  });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function pub<T>(url: string, ip?: string) {
  return h.request<T & ErrorBody>("GET", url, ip ? { ip } : {});
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  marketing = (await h.loginAs("marketing")).access_token;
  sghId = (await projectByCode(h, admin, "SGH")).id;
  ggvId = (await projectByCode(h, admin, "GGV")).id;
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 11 — unpublished projects are invisible everywhere", () => {
  it("unpublishing GGV removes it from the list, the sitemap, the gallery, the scheduler, the brochure gate and the enquiry form; republishing restores it", async () => {
    expect((await pub<Card[]>("/api/v1/public/projects")).body.map((c) => c.slug).sort()).toEqual([GGV, SGH]); // SEED.md: both published
    const off = await patchWebsite(ggvId, { is_published: false });
    expect(off.is_published).toBe(false);
    // SPEC L218: "Unpublished projects are invisible everywhere (pages 404, absent from lists and sitemap)"
    expect((await pub<Card[]>("/api/v1/public/projects")).body.map((c) => c.slug)).toEqual([SGH]);
    const detail = await pub(`/api/v1/public/projects/${GGV}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("NOT_FOUND");
    const sitemap = await pub("/api/v1/public/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain(`/projects/${SGH}`);
    expect(sitemap.text).not.toContain(`/projects/${GGV}`);
    expect((await pub(`/api/v1/public/gallery?project=${GGV}`)).status).toBe(404);
    expect(
      (await pub<{ projects: { slug: string }[] }>("/api/v1/public/gallery")).body.projects.map((p) => p.slug),
    ).not.toContain(GGV);
    expect((await pub(`/api/v1/public/projects/${GGV}/visit-availability?from=${h.today}&to=${h.today}`)).status).toBe(
      404,
    );
    expect(
      (
        await h.request("POST", "/api/v1/public/brochure-requests", {
          body: { project_slug: GGV, name: "Nobody Here", phone: "9898110001", consent: true, website: "" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request("POST", "/api/v1/public/site-visits", {
          body: {
            project_slug: GGV,
            date: h.today,
            start: "10:00",
            name: "Nobody Here",
            phone: "9898110001",
            visitors: 1,
            consent: true,
            website: "",
          },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request("POST", "/api/v1/public/enquiries", {
          body: { name: "Nobody Here", phone: "9898110001", project_slug: GGV, consent: true, website: "" },
        })
      ).status,
    ).toBe(400);
    const site = await pub<{ featured_projects: { slug: string }[] }>("/api/v1/public/site");
    expect(site.body.featured_projects.map((p) => p.slug)).not.toContain(GGV);
    // staff still see it in the ERP (SPEC L218 is a website rule, not a data rule)
    expect((await h.request("GET", `/api/v1/projects/${ggvId}`, { token: admin })).status).toBe(200);
    const on = await patchWebsite(ggvId, { is_published: true });
    expect(on.is_published).toBe(true);
    expect((await pub<Card[]>("/api/v1/public/projects")).body.map((c) => c.slug).sort()).toEqual([GGV, SGH]);
    expect((await pub(`/api/v1/public/projects/${GGV}`)).status).toBe(200);
    expect((await pub("/api/v1/public/sitemap.xml")).text).toContain(`/projects/${GGV}`);
  });
});

describe("scenario 11 — show prices", () => {
  it("toggling show_prices off removes every price field from the card and the detail; on brings them back", async () => {
    const before = await pub<Detail>(`/api/v1/public/projects/${SGH}`);
    expect(before.body.show_prices).toBe(true); // SEED.md: SGH prices shown
    expect(before.body.starting_price_paise).toBeGreaterThan(0);
    expect(before.body.configurations.some((c) => (c.price_paise ?? c.price_from_paise ?? 0) > 0)).toBe(true);
    await patchWebsite(sghId, { show_prices: false });
    // SPEC L252: "toggling 'show prices' off removes prices from API"; SPEC L217 "prices only if enabled"
    const card = (await pub<Card[]>("/api/v1/public/projects")).body.find((c) => c.slug === SGH)!;
    expect(card.starting_price_paise).toBeNull();
    const d = await pub<Detail>(`/api/v1/public/projects/${SGH}`);
    expect(d.status).toBe(200);
    expect(d.body.show_prices).toBe(false);
    expect(d.body.starting_price_paise).toBeNull();
    const priceKeys = findKeys(d.body, (k, v) => PRICE_KEY.test(k) && v !== null && typeof v !== "boolean");
    expect(priceKeys.filter((k) => !k.endsWith("show_prices"))).toEqual([]);
    expect(d.body.availability).not.toBeNull(); // availability stays (only prices are hidden)
    expect(
      d.body.availability!.blocks.flatMap((b) => b.floors.flatMap((f) => f.cells)).every((c) => c.price_paise === null),
    ).toBe(true);
    const site = await pub<{ featured_projects: Card[] }>("/api/v1/public/site");
    expect(site.body.featured_projects.find((p) => p.slug === SGH)?.starting_price_paise ?? null).toBeNull();
    await patchWebsite(sghId, { show_prices: true });
    const back = await pub<Detail>(`/api/v1/public/projects/${SGH}`);
    expect(back.body.show_prices).toBe(true);
    expect(back.body.starting_price_paise).toBe(before.body.starting_price_paise);
    expect((await pub<Card[]>("/api/v1/public/projects")).body.find((c) => c.slug === SGH)!.starting_price_paise).toBe(
      before.body.starting_price_paise,
    );
  });
});

describe("scenario 11 — enquiries", () => {
  const phone = "9898110011";

  it("an enquiry creates a WEBSITE lead with the UTM, shows in the enquiries inbox (unread) and rings the staff bell; the same phone + project adds an activity, never a duplicate lead", async () => {
    const unreadBefore = (
      await h.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales })
    ).body.unread;
    const body = {
      name: "Rahul Acceptance",
      phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
      email: "rahul.acceptance@example.com",
      project_slug: SGH,
      flat_type_code: "3BHK-A",
      message: "Interested in a 3 BHK on a high floor",
      consent: true,
      website: "",
      utm: { source: "google", campaign: "acceptance" },
    };
    const r = await h.request<{ reference_number: string } & ErrorBody>("POST", "/api/v1/public/enquiries", {
      body,
      headers: { "idempotency-key": key("enq") },
    });
    expect(r.status, r.text).toBe(200);
    // SPEC L220: "success with reference number"
    expect(r.body.reference_number).toMatch(/^ENQ-/);
    expect(r.headers["cache-control"]).toBe("no-store");
    // SPEC L220: "→ lead with source Website (dedupe rule), UTM captured"; SPEC L98 phone normalised to 10 digits
    const leads = await h.request<
      List<{
        id: string;
        source: string;
        stage: string;
        phone: string;
        project_id: string | null;
        utm: Record<string, string> | null;
        is_read?: boolean;
      }>
    >("GET", `/api/v1/leads?search=${phone}&page_size=10`, { token: sales });
    expect(leads.status, leads.text).toBe(200);
    expect(leads.body.items).toHaveLength(1);
    expect(leads.body.items[0]).toMatchObject({ source: "WEBSITE", stage: "NEW", phone, project_id: sghId });
    expect(leads.body.items[0]?.utm).toMatchObject({ source: "google", campaign: "acceptance" });
    // SPEC L219 / L252: it "shows in the inbox" with the unread badge (Marketing holds the enquiries inbox)
    const inbox = await h.request<
      List<{ reference_number: string; is_read: boolean; lead_id: string | null; phone: string }>
    >("GET", "/api/v1/enquiries?page_size=50", { token: marketing });
    expect(inbox.status, inbox.text).toBe(200);
    const row = inbox.body.items.find((e) => e.reference_number === r.body.reference_number)!;
    expect(row).toBeDefined();
    expect(row.is_read).toBe(false);
    expect(row.lead_id).toBe(leads.body.items[0]!.id);
    const unreadCount = await h.request<Record<string, number>>("GET", "/api/v1/enquiries/unread-count", {
      token: marketing,
    });
    expect(unreadCount.status).toBe(200);
    expect(Math.max(...Object.values(unreadCount.body).map(Number))).toBeGreaterThanOrEqual(1);
    // SPEC L203 staff bell: "new website enquiry"
    const unreadAfter = (
      await h.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales })
    ).body.unread;
    expect(unreadAfter).toBeGreaterThan(unreadBefore);
    const bell = await h.request<List<{ type: string }>>(
      "GET",
      "/api/v1/notifications?type=ENQUIRY_NEW&unread_only=true&page_size=50",
      { token: sales },
    );
    expect(bell.body.items.length).toBeGreaterThanOrEqual(1);
    // SPEC L107 dedupe: same phone within the same project → activity on the existing lead, no duplicate
    const second = await h.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", {
      body: { ...body, message: "Calling back?" },
    });
    expect(second.status).toBe(200);
    expect(second.body.reference_number).not.toBe(r.body.reference_number);
    const again = await h.request<List<{ id: string }>>("GET", `/api/v1/leads?search=${phone}&page_size=10`, {
      token: sales,
    });
    expect(again.body.items).toHaveLength(1);
    const detail = await h.request<{ activities?: { type: string }[]; activity?: { type: string }[] }>(
      "GET",
      `/api/v1/leads/${leads.body.items[0]!.id}`,
      { token: sales },
    );
    expect(detail.status).toBe(200);
    const acts = (detail.body.activities ?? detail.body.activity ?? []).filter((a) => a.type === "ENQUIRY");
    expect(acts.length).toBeGreaterThanOrEqual(2);
    expect(
      (await h.request<List<unknown>>("GET", "/api/v1/enquiries?page_size=200", { token: marketing })).body.items
        .length,
    ).toBeGreaterThanOrEqual(2);
    // validation (SPEC L220: 10-digit phone, consent)
    expect((await h.request("POST", "/api/v1/public/enquiries", { body: { ...body, phone: "12345" } })).status).toBe(
      400,
    );
    expect((await h.request("POST", "/api/v1/public/enquiries", { body: { ...body, consent: false } })).status).toBe(
      400,
    );
  });

  it("the 6th enquiry within a minute from one IP is 429 RATE_LIMITED with Retry-After; other IPs are unaffected", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    let last: { status: number; headers: Record<string, string>; body: ErrorBody } | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await h.request<ErrorBody>("POST", "/api/v1/public/enquiries", {
        ip,
        body: { name: `Visitor ${i}`, phone: `98981102${String(i).padStart(2, "0")}`, consent: true, website: "" },
      });
      statuses.push(r.status);
      last = r;
    }
    // SPEC L42 / L220: forms rate-limited 5/min/IP
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe("RATE_LIMITED");
    expect(Number(last!.headers["retry-after"])).toBeGreaterThan(0);
    expect(
      (
        await h.request("POST", "/api/v1/public/enquiries", {
          body: { name: "Other Visitor", phone: "9898110299", consent: true, website: "" },
        })
      ).status,
    ).toBe(200);
    // the rejected 6th enquiry created nothing
    expect(
      (await h.request<List<unknown>>("GET", "/api/v1/leads?search=9898110205", { token: sales })).body.items,
    ).toHaveLength(0);
  });

  it("a filled honeypot is silently dropped: a real-looking 200 and no lead, enquiry or notification", async () => {
    const unreadBefore = (
      await h.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales })
    ).body.unread;
    const r = await h.request<{ reference_number: string }>("POST", "/api/v1/public/enquiries", {
      body: {
        name: "Bot Botson",
        phone: "9898110333",
        project_slug: SGH,
        consent: true,
        website: "http://spam.example",
      },
    });
    // SPEC L220: "honeypot (silently dropped)" — the bot cannot tell: same status and reference shape
    expect(r.status).toBe(200);
    expect(r.body.reference_number).toMatch(/^ENQ-/);
    expect(
      (await h.request<List<unknown>>("GET", "/api/v1/leads?search=9898110333", { token: sales })).body.items,
    ).toHaveLength(0);
    const inbox = await h.request<List<{ phone: string }>>("GET", "/api/v1/enquiries?page_size=200", {
      token: marketing,
    });
    expect(inbox.body.items.some((e) => e.phone === "9898110333")).toBe(false);
    expect(
      (await h.request<{ unread: number }>("GET", "/api/v1/notifications/unread-count", { token: sales })).body.unread,
    ).toBe(unreadBefore);
  });
});
