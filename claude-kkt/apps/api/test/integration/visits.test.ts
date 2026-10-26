import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDays, todayIST } from "@kkt/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortalCustomer } from "./fixtures.js";
import { createWebProject, publishWebProject, type WebProject } from "./fixtures/web.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";

process.env["STORAGE_LOCAL_DIR"] = mkdtempSync(join(tmpdir(), "kkt-visits-test-"));

type Day = { date: string; slots: { start: string; end: string; available: number }[] };
type Booking = {
  visit_number: string;
  date: string;
  start: string;
  end: string;
  address: string | null;
  maps_link: string | null;
  instructions: string | null;
  ics_url: string;
  manage_url: string;
  project_name: string;
  visit_date: string;
  slot_start: string;
  slot_end: string;
};
type Manage = {
  visit_number: string;
  status: string;
  date: string;
  start: string;
  end: string;
  can_cancel: boolean;
  project_slug: string;
  address: string | null;
  ics_url: string;
};
type VisitRow = {
  id: string;
  visit_number: string;
  status: string;
  source: string;
  version: number;
  lead_id: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  rescheduled_from: { visit_date: string; slot_start: string } | null;
  is_moved?: boolean;
  is_past: boolean;
  visit_date: string;
  slot_start: string;
  slot_end: string;
  notes: string | null;
  visitors: number;
};
type Settings = { project_id: string; settings: Record<string, unknown>; version: number };

let t: TestContext;
let admin: string;
let sales: string;
let employee: string;
let projectsUser: string;
let wp: WebProject;
let settingsVersion: number;
let salesUserId: string;

const today = todayIST();
const D = (n: number) => addDays(today, n);
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

async function availability(from = D(0), to = D(20)): Promise<Day[]> {
  const r = await t.request<Day[]>(
    "GET",
    `/api/v1/public/projects/${wp.slug}/visit-availability?from=${from}&to=${to}`,
  );
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function book(phone: string, date: string, start: string, extra: Record<string, unknown> = {}, ip?: string) {
  return t.request<Booking & ErrorBody>("POST", "/api/v1/public/site-visits", {
    ...(ip ? { ip } : {}),
    body: {
      project_slug: wp.slug,
      date,
      start,
      name: `Visitor ${phone.slice(-4)}`,
      phone,
      email: `v${phone.slice(-4)}@example.com`,
      visitors: 2,
      message: "Weekend visit",
      consent: true,
      website: "",
      ...extra,
    },
  });
}

async function leadOf(phone: string) {
  const [l] = await t.app.sql<
    { id: string; stage: string; previous_stage: string | null; source: string; assigned_user_id: string | null }[]
  >`select id, stage, previous_stage, source, assigned_user_id from leads where phone = ${phone}`;
  return l!;
}

async function patchSettings(settings: Record<string, unknown>) {
  const r = await t.request<Settings>("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
    token: admin,
    body: { version: settingsVersion, settings },
  });
  expect(r.status, r.text).toBe(200);
  settingsVersion = r.body.version;
  return r.body;
}

const BASE_SETTINGS = {
  enabled: true,
  visit_days: [0, 1, 2, 3, 4, 5, 6],
  start_time: "10:00",
  end_time: "13:00",
  slot_minutes: 60,
  seats_per_slot: 2,
  min_lead_hours: 48,
  max_days_ahead: 14,
  blackout_dates: [D(5)],
  site_office_address: "Site office, Bailey Road, Patna",
  maps_link: "https://maps.google.com/?q=SGH",
  instructions: "Carry a photo ID.",
};

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  const s = await t.loginAs("sales");
  sales = s.access_token;
  salesUserId = s.user.id;
  employee = (await t.loginAs("employee")).access_token;
  projectsUser = (await t.loginAs("projects")).access_token;
  wp = await createWebProject(t, admin, { name: "Shree Ganesh Heights", code: "SGH", suffix: "V1" });
  await publishWebProject(t, admin, wp);
  const cur = await t.request<Settings>("GET", `/api/v1/projects/${wp.projectId}/visit-settings`, { token: admin });
  if (cur.status !== 200) throw new Error(cur.text);
  settingsVersion = cur.body.version;
});
afterAll(async () => {
  await t?.close();
});

describe("visit settings and availability", () => {
  it("settings default to disabled; the public detail flips visit_booking_enabled; validation and versions apply", async () => {
    const before = await t.request<{ visit_booking_enabled: boolean }>("GET", `/api/v1/public/projects/${wp.slug}`);
    expect(before.body.visit_booking_enabled).toBe(false);
    expect(await availability()).toEqual([]);
    const bad = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
      token: admin,
      body: { version: settingsVersion, settings: { ...BASE_SETTINGS, end_time: "09:00" } },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await t.request("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
          token: sales,
          body: { version: settingsVersion, settings: BASE_SETTINGS },
        })
      ).status,
    ).toBe(403);
    expect(
      (await t.request("GET", `/api/v1/projects/${wp.projectId}/visit-settings`, { token: projectsUser })).status,
    ).toBe(404);
    const row = await patchSettings(BASE_SETTINGS);
    expect(row.settings["seats_per_slot"]).toBe(2);
    expect(row.settings["start_time"]).toBe("10:00");
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
      token: admin,
      body: { version: 1, settings: BASE_SETTINGS },
    });
    expect(stale.status).toBe(409);
    const after = await t.request<{ visit_booking_enabled: boolean }>("GET", `/api/v1/public/projects/${wp.slug}`);
    expect(after.body.visit_booking_enabled).toBe(true);
  });

  it("hides slots before now + min lead hours, blackout dates, days beyond max_days_ahead; shows 3 slots × 2 seats otherwise", async () => {
    const days = await availability();
    const dates = days.map((d) => d.date);
    expect(dates).not.toContain(D(0));
    expect(dates).not.toContain(D(1)); // 48 h lead time: tomorrow 10:00 IST is always less than 48 h away
    expect(dates).toContain(D(3));
    expect(dates).not.toContain(D(5)); // blackout
    expect(dates).toContain(D(14));
    expect(dates).not.toContain(D(15)); // beyond max_days_ahead
    const d3 = days.find((d) => d.date === D(3))!;
    expect(d3.slots).toEqual([
      { start: "10:00", end: "11:00", available: 2 },
      { start: "11:00", end: "12:00", available: 2 },
      { start: "12:00", end: "13:00", available: 2 },
    ]);
    expect(await availability(D(20), D(25))).toEqual([]);
    const r = await t.request("GET", `/api/v1/public/projects/${wp.slug}/visit-availability`);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    expect((await t.request("GET", `/api/v1/public/projects/nope-${Date.now()}/visit-availability`)).status).toBe(404);
    await patchSettings({ ...BASE_SETTINGS, min_lead_hours: 1 });
  });
});

describe("public booking", () => {
  it("books CONFIRMED visits with a lead (source SITE_VISIT, stage SITE_VISIT_SCHEDULED), the last seat then one more → 409 SLOT_FULL", async () => {
    const r1 = await book("9876600001", D(3), "10:00");
    expect(r1.status, r1.text).toBe(201);
    expect(r1.body.visit_number).toMatch(/^SV-/);
    expect(r1.body.date).toBe(D(3));
    expect(r1.body.start).toBe("10:00");
    expect(r1.body.end).toBe("11:00");
    expect(r1.body.visit_date).toBe(D(3));
    expect(r1.body.address).toBe("Site office, Bailey Road, Patna");
    expect(r1.body.maps_link).toBe("https://maps.google.com/?q=SGH");
    expect(r1.body.instructions).toBe("Carry a photo ID.");
    expect(r1.body.ics_url).toMatch(/^http:\/\/localhost:4000\/api\/v1\/public\/site-visits\/[A-Za-z0-9_-]+\.ics$/);
    expect(r1.body.manage_url).toMatch(/^http:\/\/localhost:3000\/visit\/[A-Za-z0-9_-]+$/);
    expect(r1.headers["cache-control"]).toBe("no-store");
    const lead = await leadOf("9876600001");
    expect(lead.source).toBe("SITE_VISIT");
    expect(lead.stage).toBe("SITE_VISIT_SCHEDULED");
    expect(lead.previous_stage).toBe("NEW");
    expect(lead.assigned_user_id).toBe(salesUserId); // round robin over Sales users
    const [visit] = await t.app.sql<
      {
        status: string;
        source: string;
        assignee_user_id: string;
        lead_id: string;
        manage_token_hash: string | null;
        visitors: number;
      }[]
    >`select status, source, assignee_user_id, lead_id, manage_token_hash, visitors from site_visits where visit_number = ${r1.body.visit_number}`;
    expect(visit!.status).toBe("CONFIRMED");
    expect(visit!.source).toBe("WEBSITE");
    expect(visit!.assignee_user_id).toBe(salesUserId);
    expect(visit!.lead_id).toBe(lead.id);
    expect(visit!.manage_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(visit!.visitors).toBe(2);
    const acts = await t.app.sql<{ type: string }[]>`select type from lead_activities where lead_id = ${lead.id}`;
    expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(["CREATED", "VISIT_BOOKED", "STAGE_CHANGED"]));
    const notes = await t.app.sql<
      { type: string; recipient_id: string }[]
    >`select type, recipient_id from notifications where entity_type = 'site_visit' and type = 'VISIT_BOOKED'`;
    expect(notes.some((n) => n.recipient_id === salesUserId)).toBe(true);
    // second seat
    const r2 = await book("9876600002", D(3), "10:00");
    expect(r2.status, r2.text).toBe(201);
    // slot is now full and hidden
    const d3 = (await availability()).find((d) => d.date === D(3))!;
    expect(d3.slots.map((s) => s.start)).toEqual(["11:00", "12:00"]);
    const full = await book("9876600003", D(3), "10:00");
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("SLOT_FULL");
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = '9876600003'`)[0]!.n,
    ).toBe(0);
    // invalid slots: blackout, not a slot start, too far ahead, past
    expect((await book("9876600004", D(5), "10:00")).body.error.details?.["rule"]).toBe("SLOT_INVALID");
    expect((await book("9876600004", D(3), "10:30")).status).toBe(422);
    expect((await book("9876600004", D(20), "10:00")).status).toBe(422);
    expect((await book("9876600004", D(-1), "10:00")).status).toBe(422);
    expect((await book("9876600004", D(3), "11:00", { project_slug: `nope-${Date.now()}` })).status).toBe(404);
    expect((await book("9876600004", D(3), "11:00", { phone: "123" })).status).toBe(400);
  });

  it("two concurrent bookings for the last seat → exactly one 201 and one 409 SLOT_FULL", async () => {
    const first = await book("9876600011", D(4), "11:00");
    expect(first.status, first.text).toBe(201);
    const [a, b] = await Promise.all([book("9876600012", D(4), "11:00"), book("9876600013", D(4), "11:00")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe("SLOT_FULL");
    const [row] = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from site_visits where project_id = ${wp.projectId} and visit_date = ${D(4)} and slot_start = '11:00' and status <> 'CANCELLED'`;
    expect(row!.n).toBe(2);
  });

  it("honeypot → 200 and nothing created; replays with Idempotency-Key", async () => {
    const bot = await book("9876600021", D(6), "10:00", { website: "bot" });
    expect(bot.status).toBe(201); // identical status and shape to a real booking
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from site_visits where phone = '9876600021'`)[0]!.n,
    ).toBe(0);
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = '9876600021'`)[0]!.n,
    ).toBe(0);
    const ip = freshIp();
    const key = `visit-${Date.now()}`;
    const r1 = await t.request<Booking>("POST", "/api/v1/public/site-visits", {
      ip,
      headers: { "idempotency-key": key },
      body: {
        project_slug: wp.slug,
        visit_date: D(6),
        slot_start: "12:00",
        name: "Idem Visitor",
        phone: "9876600022",
        visitors: 1,
        consent: true,
        website: "",
      },
    });
    expect(r1.status, r1.text).toBe(201);
    const r2 = await t.request<Booking>("POST", "/api/v1/public/site-visits", {
      ip,
      headers: { "idempotency-key": key },
      body: {
        project_slug: wp.slug,
        visit_date: D(6),
        slot_start: "12:00",
        name: "Idem Visitor",
        phone: "9876600022",
        visitors: 1,
        consent: true,
        website: "",
      },
    });
    // the manage link is a one-time bearer secret: never stored by the idempotency store, so the replay is 409 with the redacted original
    expect(r2.status, r2.text).toBe(409);
    expect(r2.headers["idempotent-replayed"]).toBe("true");
    const replay = r2.body as unknown as ErrorBody;
    expect(replay.error.code).toBe("IDEMPOTENT_SECRET_REPLAY");
    expect(replay.error.details).toMatchObject({
      redacted_fields: ["manage_url", "ics_url"],
      original: { visit_number: r1.body.visit_number, manage_url: "[redacted]", ics_url: "[redacted]" },
    });
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from site_visits where phone = '9876600022'`)[0]!.n,
    ).toBe(1);
  });

  it(".ics is in Asia/Kolkata with the IST start time and a 1-hour alarm; manage view works; forged token → 404", async () => {
    const r = await book("9876600031", D(7), "12:00");
    expect(r.status, r.text).toBe(201);
    const ics = await t.app.inject({
      method: "GET",
      url: pathOf(r.body.ics_url),
      headers: { "x-forwarded-for": freshIp() },
    });
    expect(ics.statusCode).toBe(200);
    expect(String(ics.headers["content-type"])).toContain("text/calendar");
    expect(ics.body).toContain("BEGIN:VCALENDAR");
    expect(ics.body).toContain("TZID:Asia/Kolkata");
    expect(ics.body).toContain(`DTSTART;TZID=Asia/Kolkata:${D(7).replace(/-/g, "")}T120000`);
    expect(ics.body).toContain(`DTEND;TZID=Asia/Kolkata:${D(7).replace(/-/g, "")}T130000`);
    expect(ics.body).toContain("BEGIN:VALARM");
    expect(ics.body).toContain("TRIGGER:-PT1H");
    expect(ics.body).toContain(r.body.visit_number);
    const token = r.body.manage_url.split("/visit/")[1]!;
    const manage = await t.request<Manage>("GET", `/api/v1/public/site-visits/${token}`);
    expect(manage.status, manage.text).toBe(200);
    expect(manage.body.visit_number).toBe(r.body.visit_number);
    expect(manage.body.status).toBe("CONFIRMED");
    expect(manage.body.can_cancel).toBe(true);
    expect(manage.body.date).toBe(D(7));
    expect(manage.body.start).toBe("12:00");
    expect(manage.body.project_slug).toBe(wp.slug);
    expect(manage.headers["cache-control"]).toBe("no-store");
    expect((await t.request("GET", `/api/v1/public/site-visits/${token.slice(0, -2)}xx`)).status).toBe(404);
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: `/api/v1/public/site-visits/${token.slice(0, -2)}xx.ics`,
          headers: { "x-forwarded-for": freshIp() },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("cancel from the manage link frees the seat, logs VISIT_CANCELLED and reverts the lead to its previous stage only when no other visit is upcoming", async () => {
    // lead 9876600001 has exactly one upcoming visit (D3 10:00)
    const [v1] = await t.app.sql<
      { manage_token_hash: string; id: string }[]
    >`select id, manage_token_hash from site_visits where phone = '9876600001'`;
    // we do not know the raw token for v1 (hash only) → book a fresh pair of visits for a lead with two upcoming visits, and a single one
    const single = await book("9876600041", D(8), "10:00");
    const twoA = await book("9876600042", D(8), "11:00");
    const twoB = await book("9876600042", D(9), "11:00");
    expect([single.status, twoA.status, twoB.status]).toEqual([201, 201, 201]);
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from leads where phone = '9876600042'`)[0]!.n,
    ).toBe(1);
    void v1;
    const beforeSlots = (await availability()).find((d) => d.date === D(8))!.slots.find((s) => s.start === "10:00")!;
    expect(beforeSlots.available).toBe(1);
    const token = single.body.manage_url.split("/visit/")[1]!;
    const cancel = await t.request<Manage>("POST", `/api/v1/public/site-visits/${token}/cancel`, {
      body: { reason: "Change of plans", website: "" },
    });
    expect(cancel.status, cancel.text).toBe(200);
    expect(cancel.body.status).toBe("CANCELLED");
    expect(cancel.body.can_cancel).toBe(false);
    const afterSlot = (await availability()).find((d) => d.date === D(8))!.slots.find((s) => s.start === "10:00")!;
    expect(afterSlot.available).toBe(2);
    const lead = await leadOf("9876600041");
    expect(lead.stage).toBe("NEW");
    expect(lead.previous_stage).toBe("SITE_VISIT_SCHEDULED");
    const acts = await t.app.sql<
      { type: string; payload: { reverted?: boolean } }[]
    >`select type, payload from lead_activities where lead_id = ${lead.id} order by at`;
    expect(acts.map((a) => a.type)).toContain("VISIT_CANCELLED");
    expect(acts.filter((a) => a.type === "STAGE_CHANGED")).toHaveLength(2);
    const [row] = await t.app.sql<
      { status: string; cancel_reason: string }[]
    >`select status, cancel_reason from site_visits where visit_number = ${single.body.visit_number}`;
    expect(row!.status).toBe("CANCELLED");
    expect(row!.cancel_reason).toBe("Change of plans");
    // the link died with the visit: cancelling again, the manage view and the .ics answer 410 LINK_EXPIRED
    const again = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${token}/cancel`, { body: {} });
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe("LINK_EXPIRED");
    expect((await t.request("GET", `/api/v1/public/site-visits/${token}`)).status).toBe(410);
    expect((await t.request("GET", `/api/v1/public/site-visits/${token}.ics`)).status).toBe(410);
    // the lead with two upcoming visits keeps SITE_VISIT_SCHEDULED after one cancellation
    const tokenA = twoA.body.manage_url.split("/visit/")[1]!;
    expect(
      (await t.request<Manage>("POST", `/api/v1/public/site-visits/${tokenA}/cancel`, { body: {} })).body.status,
    ).toBe("CANCELLED");
    expect((await leadOf("9876600042")).stage).toBe("SITE_VISIT_SCHEDULED");
    // the booked notification was withdrawn/deleted for the cancelled visit
    const [vis] = await t.app.sql<
      { id: string }[]
    >`select id from site_visits where visit_number = ${single.body.visit_number}`;
    expect(
      (
        await t.app.sql<
          { n: number }[]
        >`select count(*)::int as n from notifications where entity_id = ${vis!.id} and is_withdrawn = false`
      )[0]!.n,
    ).toBe(0);
  });
});

describe("ERP site visits", () => {
  let leadId: string;
  let erpVisit: VisitRow;

  it("lists with filters + CSV, shows the calendar and today, enforces permissions and scope", async () => {
    const list = await t.request<{ items: VisitRow[]; total: number }>(
      "GET",
      `/api/v1/site-visits?project_id=${wp.projectId}&status=CONFIRMED&page_size=100`,
      { token: sales },
    );
    expect(list.status, list.text).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(4);
    expect(list.body.items.every((v) => v.status === "CONFIRMED")).toBe(true);
    const range = await t.request<{ items: VisitRow[] }>("GET", `/api/v1/site-visits?from=${D(3)}&to=${D(3)}`, {
      token: sales,
    });
    expect(range.body.items.every((v) => v.visit_date === D(3))).toBe(true);
    expect(range.body.items.length).toBe(2);
    const csv = await t.request("GET", `/api/v1/site-visits?format=csv`, { token: sales });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toContain("visit_number");
    const cal = await t.request<{
      days: {
        date: string;
        is_blackout: boolean;
        is_visit_day: boolean;
        slots: { start: string; booked: number; available: number; seats: number; visits: VisitRow[] }[];
      }[];
    }>("GET", `/api/v1/site-visits/calendar?project_id=${wp.projectId}&from=${D(3)}&to=${D(5)}`, { token: sales });
    expect(cal.status, cal.text).toBe(200);
    expect(cal.body.days).toHaveLength(3);
    const d3 = cal.body.days[0]!;
    expect(d3.date).toBe(D(3));
    expect(d3.slots.map((s) => s.start)).toEqual(["10:00", "11:00", "12:00"]);
    expect(d3.slots[0]).toMatchObject({ booked: 2, available: 0, seats: 2 });
    expect(d3.slots[0]!.visits).toHaveLength(2);
    expect(cal.body.days[2]!.is_blackout).toBe(true);
    const todayRes = await t.request<{ date: string; items: VisitRow[]; counts: { total: number } }>(
      "GET",
      "/api/v1/site-visits/today",
      { token: sales },
    );
    expect(todayRes.status, todayRes.text).toBe(200);
    expect(todayRes.body.date).toBe(today);
    expect((await t.request("GET", "/api/v1/site-visits", { token: employee })).status).toBe(403);
    const scoped = await t.request<{ items: VisitRow[] }>("GET", "/api/v1/site-visits?page_size=100", {
      token: projectsUser,
    });
    expect(scoped.status).toBe(200);
    expect(scoped.body.items).toEqual([]);
    expect(
      (await t.request("GET", `/api/v1/site-visits/${list.body.items[0]!.id}`, { token: projectsUser })).status,
    ).toBe(404);
    expect(
      (
        await t.request("GET", `/api/v1/site-visits/calendar?project_id=${wp.projectId}&from=${D(3)}&to=${D(5)}`, {
          token: projectsUser,
        })
      ).status,
    ).toBe(404);
  });

  it("creates a visit for a lead (capacity-checked, lead → SITE_VISIT_SCHEDULED) and the picker hides full slots", async () => {
    const [l] = await t.app.sql<
      { id: string }[]
    >`insert into leads (company_id, lead_number, full_name, phone, source, stage, assigned_user_id) values (${t.companyId}, 'LD-TEST/0001', 'Walk-in Lead', '9876600101', 'WALK_IN', 'CONTACTED', ${salesUserId}) returning id`;
    leadId = l!.id;
    const full = await t.request<ErrorBody>("POST", "/api/v1/site-visits", {
      token: sales,
      body: {
        project_id: wp.projectId,
        lead_id: leadId,
        visit_date: D(3),
        slot_start: "10:00",
        name: "Walk-in Lead",
        phone: "9876600101",
        visitors: 1,
      },
    });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("SLOT_FULL");
    const picker = await t.request<{ days: Day[] }>(
      "GET",
      `/api/v1/site-visits/availability?project_id=${wp.projectId}&from=${D(3)}&to=${D(3)}`,
      { token: sales },
    );
    expect(picker.status, picker.text).toBe(200);
    expect(picker.body.days[0]!.slots.map((s) => s.start)).toEqual(["11:00", "12:00"]);
    const r = await t.request<VisitRow>("POST", "/api/v1/site-visits", {
      token: sales,
      body: {
        project_id: wp.projectId,
        lead_id: leadId,
        visit_date: D(6),
        slot_start: "11:00",
        name: "Walk-in Lead",
        phone: "9876600101",
        visitors: 1,
        notes: "Prefers morning",
      },
    });
    expect(r.status, r.text).toBe(201);
    erpVisit = r.body;
    expect(erpVisit.status).toBe("CONFIRMED");
    expect(erpVisit.source).toBe("ERP");
    expect(erpVisit.lead_id).toBe(leadId);
    expect(erpVisit.assignee_user_id).toBe(salesUserId);
    expect(erpVisit.assignee_name).toBe("Ankit Verma");
    expect(erpVisit.is_moved).toBe(false);
    const lead = await leadOf("9876600101");
    expect(lead.stage).toBe("SITE_VISIT_SCHEDULED");
    expect(lead.previous_stage).toBe("CONTACTED");
    expect(
      (
        await t.request("POST", "/api/v1/site-visits", {
          token: sales,
          body: {
            project_id: wp.projectId,
            visit_date: D(6),
            slot_start: "11:00",
            name: "Nobody",
            phone: "9876600102",
          },
        })
      ).status,
    ).toBe(400); // lead or customer required
    expect(
      (
        await t.request("POST", "/api/v1/site-visits", {
          token: projectsUser,
          body: {
            project_id: wp.projectId,
            lead_id: leadId,
            visit_date: D(6),
            slot_start: "11:00",
            name: "X",
            phone: "9876600103",
          },
        })
      ).status,
    ).toBe(404);
  });

  it("reschedule respects capacity (409 when the target is full), marks RESCHEDULED + moved; notes/assignee PATCH bumps the version", async () => {
    const toFull = await t.request<ErrorBody>("POST", `/api/v1/site-visits/${erpVisit.id}/reschedule`, {
      token: sales,
      body: { version: erpVisit.version, visit_date: D(4), slot_start: "11:00" },
    });
    expect(toFull.status).toBe(409);
    expect(toFull.body.error.code).toBe("SLOT_FULL");
    const moved = await t.request<VisitRow>("POST", `/api/v1/site-visits/${erpVisit.id}/reschedule`, {
      token: sales,
      body: { version: erpVisit.version, visit_date: D(6), slot_start: "10:00" },
    });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.status).toBe("RESCHEDULED");
    expect(moved.body.rescheduled_from).toEqual({ visit_date: D(6), slot_start: "11:00" });
    expect(moved.body.is_moved).toBe(true);
    expect(moved.body.slot_start).toBe("10:00");
    expect(moved.body.version).toBe(erpVisit.version + 1);
    const stale = await t.request<ErrorBody>("POST", `/api/v1/site-visits/${erpVisit.id}/reschedule`, {
      token: sales,
      body: { version: erpVisit.version, visit_date: D(6), slot_start: "12:00" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const cal = await t.request<{ days: { slots: { start: string; visits: VisitRow[] }[] }[] }>(
      "GET",
      `/api/v1/site-visits/calendar?project_id=${wp.projectId}&from=${D(6)}&to=${D(6)}`,
      { token: sales },
    );
    const slot = cal.body.days[0]!.slots.find((s) => s.start === "10:00")!;
    expect(slot.visits.some((v) => v.id === erpVisit.id && v.is_moved)).toBe(true);
    const acts = await t.app.sql<{ type: string }[]>`select type from lead_activities where lead_id = ${leadId}`;
    expect(acts.map((a) => a.type)).toContain("VISIT_RESCHEDULED");
    const patched = await t.request<VisitRow>("PATCH", `/api/v1/site-visits/${erpVisit.id}`, {
      token: sales,
      body: { notes: "Bring floor plans", visitors: 3 },
      headers: { "if-match": `"${moved.body.version}"` },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.notes).toBe("Bring floor plans");
    expect(patched.body.visitors).toBe(3);
    expect(patched.body.version).toBe(moved.body.version + 1);
    erpVisit = patched.body;
  });

  it("complete → COMPLETED and lead SITE_VISIT_DONE; outcome cannot be marked twice; no-show and cancel with reason", async () => {
    const done = await t.request<VisitRow>("POST", `/api/v1/site-visits/${erpVisit.id}/complete`, {
      token: sales,
      body: { version: erpVisit.version, notes: "Liked A-201" },
    });
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    expect((await leadOf("9876600101")).stage).toBe("SITE_VISIT_DONE");
    const again = await t.request<ErrorBody>("POST", `/api/v1/site-visits/${erpVisit.id}/no-show`, {
      token: sales,
      body: {},
    });
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("OUTCOME_MARKED");
    const acts = await t.app.sql<{ type: string }[]>`select type from lead_activities where lead_id = ${leadId}`;
    expect(acts.map((a) => a.type)).toContain("VISIT_COMPLETED");
    // customer visit → no-show
    const customer = await createPortalCustomer(t, { phone: "9876600201", name: "Sunita Devi" });
    const cv = await t.request<VisitRow>("POST", "/api/v1/site-visits", {
      token: sales,
      body: {
        project_id: wp.projectId,
        customer_id: customer.customerId,
        visit_date: D(9),
        slot_start: "12:00",
        name: "Sunita Devi",
        phone: "9876600201",
        visitors: 2,
      },
    });
    expect(cv.status, cv.text).toBe(201);
    expect(cv.body.lead_id).toBeNull();
    const ns = await t.request<VisitRow>("POST", `/api/v1/site-visits/${cv.body.id}/no-show`, {
      token: sales,
      body: { version: cv.body.version },
    });
    expect(ns.status, ns.text).toBe(200);
    expect(ns.body.status).toBe("NO_SHOW");
    // cancel with reason via the ERP
    const other = await t.request<VisitRow>("POST", "/api/v1/site-visits", {
      token: admin,
      body: {
        project_id: wp.projectId,
        lead_id: leadId,
        visit_date: D(10),
        slot_start: "10:00",
        name: "Walk-in Lead",
        phone: "9876600101",
        visitors: 1,
      },
    });
    expect(other.status, other.text).toBe(201);
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/site-visits/${other.body.id}/cancel`, {
          token: sales,
          body: { version: other.body.version },
        })
      ).status,
    ).toBe(400); // reason required
    const cancelled = await t.request<VisitRow>("POST", `/api/v1/site-visits/${other.body.id}/cancel`, {
      token: sales,
      body: { version: other.body.version, reason: "Client travelling" },
    });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    const audits = await t.app.sql<
      { action: string }[]
    >`select action from audit_logs where entity_type = 'site_visit' and entity_id = ${other.body.id} order by created_at`;
    expect(audits.map((a) => a.action)).toEqual(["site_visit.create", "site_visit.cancel"]);
  });

  it("daily nudge notifies the assignee about past visits without an outcome (once per day) and needs_outcome lists them", async () => {
    const [stale] = await t.app.sql<
      { id: string }[]
    >`insert into site_visits (company_id, visit_number, project_id, lead_id, visit_date, slot_start, slot_end, visitors, name, phone, status, assignee_user_id, source)
      values (${t.companyId}, 'SV-TEST/0099', ${wp.projectId}, ${leadId}, ${D(-1)}, '10:00', '11:00', 1, 'Yesterday Visitor', '9876600301', 'CONFIRMED', ${salesUserId}, 'ERP') returning id`;
    const { nudgeVisitOutcomes } = await import("../../src/modules/web/visitService.js");
    const first = await nudgeVisitOutcomes(t.app.db);
    expect(first.nudged).toBeGreaterThanOrEqual(1);
    const notes = await t.app.sql<
      { recipient_id: string; title: string }[]
    >`select recipient_id, title from notifications where type = 'VISIT_OUTCOME_NUDGE' and entity_id = ${stale!.id}`;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.recipient_id).toBe(salesUserId);
    expect(notes[0]!.title).toContain("Mark outcome");
    const second = await nudgeVisitOutcomes(t.app.db);
    expect(second.nudged).toBe(0);
    const list = await t.request<{ items: VisitRow[] }>("GET", "/api/v1/site-visits?needs_outcome=true", {
      token: sales,
    });
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((v) => v.id)).toContain(stale!.id);
    expect(list.body.items.every((v) => v.is_past)).toBe(true);
    const { registeredJobs } = await import("../../src/jobs/index.js");
    expect(registeredJobs()).toContain("VISIT_OUTCOME_NUDGE");
  });
});

describe("manage links: expiry, rotation and visitor self-reschedule", () => {
  type Rescheduled = Manage & {
    manage_url: string;
    manage_token: string;
    link_expires_at: string;
    can_reschedule: boolean;
    slot_start: string;
    visit_date: string;
  };
  const tokenOf = (url: string) => url.split("/visit/")[1]!;

  it("a booked link expires at the visit's end + 24 h (IST)", async () => {
    const r = await book("9876600501", D(11), "10:00");
    expect(r.status, r.text).toBe(201);
    const [row] = await t.app.sql<
      { expires: string }[]
    >`select manage_token_expires_at::text as expires from site_visits where visit_number = ${r.body.visit_number}`;
    // slot 10:00–11:00 IST on D(11) ends at 05:30 UTC; + 24 h
    const end = new Date(`${D(11)}T11:00:00+05:30`).getTime() + 24 * 3_600_000;
    expect(new Date(row!.expires).getTime()).toBe(end);
    const manage = await t.request<Manage & { link_expires_at: string; can_reschedule: boolean }>(
      "GET",
      `/api/v1/public/site-visits/${tokenOf(r.body.manage_url)}`,
    );
    expect(manage.status).toBe(200);
    expect(new Date(manage.body.link_expires_at).getTime()).toBe(end);
    expect(manage.body.can_reschedule).toBe(true);
  });

  it("the visitor reschedules from the link: capacity-checked, new link + .ics returned, the old link stops working", async () => {
    const r = await book("9876600502", D(11), "11:00");
    expect(r.status, r.text).toBe(201);
    const oldToken = tokenOf(r.body.manage_url);
    // fill D(12) 10:00 so it is full (2 seats)
    expect((await book("9876600503", D(12), "10:00")).status).toBe(201);
    expect((await book("9876600504", D(12), "10:00")).status).toBe(201);
    const full = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${oldToken}/reschedule`, {
      body: { date: D(12), start: "10:00", website: "" },
    });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("SLOT_FULL");
    const invalid = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${oldToken}/reschedule`, {
      body: { date: D(5), start: "10:00" },
    }); // blackout
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details?.["rule"]).toBe("SLOT_INVALID");
    const moved = await t.request<Rescheduled>("POST", `/api/v1/public/site-visits/${oldToken}/reschedule`, {
      body: { date: D(12), start: "11:00", website: "" },
    });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.status).toBe("RESCHEDULED");
    expect(moved.body.visit_date).toBe(D(12));
    expect(moved.body.slot_start).toBe("11:00");
    expect(moved.body.manage_token).not.toBe(oldToken);
    expect(moved.body.manage_url).toContain(`/visit/${moved.body.manage_token}`);
    expect(moved.body.ics_url).toContain(moved.body.manage_token);
    expect(new Date(moved.body.link_expires_at).getTime()).toBe(
      new Date(`${D(12)}T12:00:00+05:30`).getTime() + 24 * 3_600_000,
    );
    // the old link is dead (410 LINK_EXPIRED: it existed, a reschedule replaced it); the new one works and serves the moved .ics
    const old = await t.request<ErrorBody>("GET", `/api/v1/public/site-visits/${oldToken}`);
    expect(old.status).toBe(410);
    expect(old.body.error.code).toBe("LINK_EXPIRED");
    expect((await t.request("GET", `/api/v1/public/site-visits/${oldToken}.ics`)).status).toBe(410);
    const oldCancel = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${oldToken}/cancel`, { body: {} });
    expect(oldCancel.status).toBe(410);
    const oldMove = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${oldToken}/reschedule`, {
      body: { date: D(12), start: "10:00", website: "" },
    });
    expect(oldMove.status).toBe(410);
    // only hashes are kept, never the token itself
    const [kept] = await t.app.sql<{ hashes: string[] }[]>`
      select superseded_token_hashes as hashes from site_visits where visit_number = ${r.body.visit_number}`;
    expect(kept!.hashes).toHaveLength(1);
    expect(kept!.hashes[0]).not.toContain(oldToken);
    const fresh = await t.request<Manage>("GET", `/api/v1/public/site-visits/${moved.body.manage_token}`);
    expect(fresh.status).toBe(200);
    const ics = await t.request("GET", `/api/v1/public/site-visits/${moved.body.manage_token}.ics`);
    expect(ics.status).toBe(200);
    expect(ics.text).toContain(`DTSTART;TZID=Asia/Kolkata:${D(12).replace(/-/g, "")}T110000`);
    // seats moved with it, and the audit names the rotation
    const days = await availability(D(11), D(12));
    expect(days.find((d) => d.date === D(12))!.slots.find((s) => s.start === "11:00")!.available).toBe(1);
    const [audit] = await t.app.sql<
      { after: { manage_link_rotated: boolean } }[]
    >`select after from audit_logs where action = 'site_visit.reschedule' order by created_at desc limit 1`;
    expect(audit!.after.manage_link_rotated).toBe(true);
  });

  it("honeypot: a filled website field gets a believable answer and changes nothing", async () => {
    const r = await book("9876600505", D(13), "10:00");
    const token = tokenOf(r.body.manage_url);
    const bot = await t.request<Rescheduled>("POST", `/api/v1/public/site-visits/${token}/reschedule`, {
      body: { date: D(13), start: "12:00", website: "http://spam.example" },
    });
    expect(bot.status).toBe(200);
    expect(bot.body.manage_token).not.toBe(token);
    const [row] = await t.app.sql<
      { slot_start: string; status: string }[]
    >`select slot_start::text, status from site_visits where visit_number = ${r.body.visit_number}`;
    expect(row).toEqual({ slot_start: "10:00:00", status: "CONFIRMED" });
    expect((await t.request("GET", `/api/v1/public/site-visits/${token}`)).status).toBe(200); // the real link still works
    expect((await t.request("GET", `/api/v1/public/site-visits/${bot.body.manage_token}`)).status).toBe(404); // the fake one never did
  });

  it("an ERP reschedule also rotates the link and hands the new one to staff once", async () => {
    const r = await book("9876600506", D(13), "11:00");
    const token = tokenOf(r.body.manage_url);
    const [v] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from site_visits where visit_number = ${r.body.visit_number}`;
    const moved = await t.request<VisitRow & { manage_url: string | null }>(
      "POST",
      `/api/v1/site-visits/${v!.id}/reschedule`,
      { token: sales, body: { version: v!.version, visit_date: D(13), slot_start: "12:00" } },
    );
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.manage_url).toMatch(/\/visit\//);
    expect((await t.request("GET", `/api/v1/public/site-visits/${token}`)).status).toBe(410); // replaced, not unknown
    expect((await t.request("GET", `/api/v1/public/site-visits/${tokenOf(moved.body.manage_url!)}`)).status).toBe(200);
    // a plain read never re-exposes it
    expect(
      (await t.request<{ manage_url: string | null }>("GET", `/api/v1/site-visits/${v!.id}`, { token: sales })).body
        .manage_url ?? null,
    ).toBeNull();
  });

  it("a cancelled visit's link expires immediately and cannot be rescheduled", async () => {
    const r = await book("9876600507", D(13), "10:00");
    const token = tokenOf(r.body.manage_url);
    expect((await t.request("POST", `/api/v1/public/site-visits/${token}/cancel`, { body: {} })).status).toBe(200);
    const res = await t.request<ErrorBody>("POST", `/api/v1/public/site-visits/${token}/reschedule`, {
      body: { date: D(13), start: "12:00" },
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("LINK_EXPIRED");
  });
});
