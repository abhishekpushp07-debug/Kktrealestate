import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dayOfWeek, istDateTimeMs } from "@kkt/domain";
import {
  BOOT_TIMEOUT,
  bootAcceptance,
  pathOf,
  projectByCode,
  type ErrorBody,
  type Harness,
  type List,
} from "./harness.js";

/**
 * SPEC §18 scenario 12 (L253): "Brochure gate: download starts only after valid details; same phone → no duplicate lead; forged link →
 * rejected. Site visits: availability hides past/blackout/full slots; last seat then one more → SLOT_FULL; .ics correct in IST; cancel frees
 * the seat and reverts the lead stage; ERP reschedule respects capacity; Completed → lead 'Site Visit Done'."
 * SPEC L221 BROCHURE LEAD GATE, L222–L225 SITE VISIT SCHEDULER. SGH (SEED.md): Mon–Sat 10:00–17:00, 60-min slots, 3 seats, 12 h lead, 30 days ahead.
 */

const SGH = "shree-ganesh-heights";
const SEATS = 3;

type Day = { date: string; slots: { start: string; end: string; available: number }[] };
type VisitBooking = {
  visit_number: string;
  date: string;
  start: string;
  end: string;
  address: string | null;
  ics_url: string;
  manage_url: string;
};
type Manage = { visit_number: string; status: string; can_cancel: boolean };
type VisitRow = {
  id: string;
  visit_number: string;
  status: string;
  version: number;
  visit_date: string;
  slot_start: string;
  lead_id: string | null;
  rescheduled_from: { visit_date: string; slot_start: string } | null;
};
type Lead = { id: string; stage: string; source: string; phone: string };

let h: Harness;
let admin: string;
let sales: string;
let sghId: string;

async function availability(from = h.today, to = addDays(h.today, 35)): Promise<Day[]> {
  const r = await h.request<Day[] & ErrorBody>(
    "GET",
    `/api/v1/public/projects/${SGH}/visit-availability?from=${from}&to=${to}`,
  );
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function book(phone: string, date: string, start: string, extra: Record<string, unknown> = {}) {
  return h.request<VisitBooking & ErrorBody>("POST", "/api/v1/public/site-visits", {
    body: {
      project_slug: SGH,
      date,
      start,
      name: `Visitor ${phone.slice(-4)}`,
      phone,
      email: `v${phone.slice(-4)}@example.com`,
      visitors: 1,
      consent: true,
      website: "",
      ...extra,
    },
  });
}

async function leadOf(phone: string): Promise<Lead> {
  const r = await h.request<List<Lead>>("GET", `/api/v1/leads?search=${phone}&page_size=10`, { token: sales });
  expect(r.status, r.text).toBe(200);
  const lead = r.body.items.find((l) => l.phone === phone);
  if (!lead) throw new Error(`lead ${phone} not found`);
  return lead;
}

async function erpVisit(visitNumber: string, date: string): Promise<VisitRow> {
  const r = await h.request<List<VisitRow>>(
    "GET",
    `/api/v1/site-visits?project_id=${sghId}&from=${date}&to=${date}&page_size=100`,
    { token: sales },
  );
  expect(r.status, r.text).toBe(200);
  const v = r.body.items.find((x) => x.visit_number === visitNumber);
  if (!v) throw new Error(`visit ${visitNumber} not in the ERP list`);
  return v;
}

/** Slot key → available seats. */
function slotMap(days: Day[]): Map<string, number> {
  return new Map(days.flatMap((d) => d.slots.map((s) => [`${d.date} ${s.start}`, s.available] as [string, number])));
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  sghId = (await projectByCode(h, admin, "SGH")).id;
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 12 — brochure lead gate", () => {
  const phone = "9898120001";
  let downloadUrl: string;

  it("the download starts only after valid details; the link streams the PDF as an attachment and counts once", async () => {
    // SPEC L221: modal (name, phone, optional email, consent) — missing details or consent never yield a link
    expect(
      (await h.request("POST", "/api/v1/public/brochure-requests", { body: { project_slug: SGH, website: "" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await h.request("POST", "/api/v1/public/brochure-requests", {
          body: { project_slug: SGH, name: "No Consent", phone, website: "" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request("POST", "/api/v1/public/brochure-requests", {
          body: { project_slug: SGH, name: "Bad Phone", phone: "12345", consent: true, website: "" },
        })
      ).status,
    ).toBe(400);
    const stats0 = await h.request<{ download_count: number; requests_count: number }>(
      "GET",
      `/api/v1/projects/${sghId}/brochure-stats`,
      { token: sales },
    );
    expect(stats0.status, stats0.text).toBe(200);
    const r = await h.request<
      { download_url: string; expires_at: string; visitor_token: string; file_name: string } & ErrorBody
    >("POST", "/api/v1/public/brochure-requests", {
      body: {
        project_slug: SGH,
        name: "Priya Acceptance",
        phone,
        email: "priya.acceptance@example.com",
        consent: true,
        website: "",
      },
    });
    expect(r.status, r.text).toBe(200);
    // SPEC L221: "return a SIGNED, short-lived (15 min) download link"
    expect(r.body.download_url).toContain("/api/v1/public/brochure/");
    const ttl = new Date(r.body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(13 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + 2000);
    downloadUrl = r.body.download_url;
    // SPEC L221: "create or reuse lead (source Brochure)"
    const lead = await leadOf(phone);
    expect(lead.source).toBe("BROCHURE");
    // the link "streams the PDF as an attachment and increments the project's download counter once per link"
    const dl = await h.request("GET", pathOf(downloadUrl));
    expect(dl.status, dl.text).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment; filename="/);
    expect(dl.raw.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const dl2 = await h.request("GET", pathOf(downloadUrl));
    expect(dl2.status).toBe(200);
    const stats1 = await h.request<{ download_count: number; requests_count: number }>(
      "GET",
      `/api/v1/projects/${sghId}/brochure-stats`,
      { token: sales },
    );
    expect(stats1.body.download_count).toBe(stats0.body.download_count + 1); // counted once although fetched twice
    expect(stats1.body.requests_count).toBe(stats0.body.requests_count + 1);
  });

  it("the same phone on the same project reuses the lead (an activity, never a duplicate)", async () => {
    const before = await leadOf(phone);
    const r = await h.request<{ download_url: string }>("POST", "/api/v1/public/brochure-requests", {
      body: { project_slug: SGH, name: "Priya Acceptance", phone: `+91 ${phone}`, consent: true, website: "" },
    });
    expect(r.status).toBe(200);
    // SPEC L221: "same phone + project = activity on the existing lead, never a duplicate"
    const list = await h.request<List<Lead>>("GET", `/api/v1/leads?search=${phone}&page_size=10`, { token: sales });
    expect(list.body.items.filter((l) => l.phone === phone)).toHaveLength(1);
    expect(list.body.items[0]?.id).toBe(before.id);
    const detail = await h.request<{ activities: { type: string }[] }>("GET", `/api/v1/leads/${before.id}`, {
      token: sales,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.activities.filter((a) => a.type === "BROCHURE_DOWNLOADED").length).toBeGreaterThanOrEqual(2);
  });

  it("forged, tampered and unknown links are rejected (404)", async () => {
    const path = pathOf(downloadUrl);
    // SPEC L221: "forged/expired links rejected"
    const tampered = path.slice(0, -2) + (path.endsWith("AA") ? "BB" : "AA");
    expect((await h.request("GET", tampered)).status).toBe(404);
    expect((await h.request("GET", "/api/v1/public/brochure/not-a-real-token-at-all")).status).toBe(404);
    expect((await h.request("GET", `${path}x`)).status).toBe(404);
    expect((await h.request("GET", path)).status).toBe(200); // the genuine link still works
  });
});

describe("scenario 12 — site-visit scheduler", () => {
  const v = { p1: "9898120101", p2: "9898120102", p3: "9898120103", p4: "9898120104", p5: "9898120105" };
  let day: Day;
  let slot: { start: string; end: string };
  let first: VisitBooking;
  let second: VisitBooking;
  let fifth: VisitBooking;
  let otherSlot: string;

  it("availability hides past slots, Sundays, blackout dates, days beyond 30 and full slots; the rest show the free seats", async () => {
    const days = await availability(addDays(h.today, -7));
    expect(days.length).toBeGreaterThan(10);
    const minStartMs = Date.now() + 12 * 3_600_000 - 5 * 60_000; // min_lead_hours 12 (SEED.md), small tolerance for the request itself
    for (const d of days) {
      // SPEC L223: skip dates before today / beyond max days ahead, non-visit days, blackouts
      expect(d.date >= h.today, d.date).toBe(true);
      expect(d.date <= addDays(h.today, 30), d.date).toBe(true);
      expect(dayOfWeek(d.date), d.date).not.toBe(0); // Sunday is not a visit day for SGH
      expect(d.slots.length).toBeGreaterThan(0);
      for (const s of d.slots) {
        // SPEC L223: "drop slots starting before now + min lead hours (IST)"; "return only slots with available > 0"
        expect(istDateTimeMs(d.date, s.start), `${d.date} ${s.start}`).toBeGreaterThanOrEqual(minStartMs);
        expect(s.available).toBeGreaterThan(0);
        expect(s.available).toBeLessThanOrEqual(SEATS);
        expect(s.start >= "10:00" && s.end <= "17:00").toBe(true); // SEED.md hours
      }
    }
    expect((await availability(addDays(h.today, 31), addDays(h.today, 45))).length).toBe(0);
    // a blackout date disappears (SPEC L222 blackout dates; L223 "skip if … blackout")
    const settings = await h.request<{
      version: number;
      settings: Record<string, unknown> & { blackout_dates: string[] };
    }>("GET", `/api/v1/projects/${sghId}/visit-settings`, { token: admin });
    expect(settings.status, settings.text).toBe(200);
    const target = days.find((d) => d.date >= addDays(h.today, 2))!;
    const blacked = await h.request<{ version: number }>("PATCH", `/api/v1/projects/${sghId}/visit-settings`, {
      token: admin,
      body: {
        version: settings.body.version,
        settings: {
          ...settings.body.settings,
          blackout_dates: [...settings.body.settings.blackout_dates, target.date],
        },
      },
    });
    expect(blacked.status, blacked.text).toBe(200);
    expect((await availability()).map((d) => d.date)).not.toContain(target.date);
    const restored = await h.request<{ version: number }>("PATCH", `/api/v1/projects/${sghId}/visit-settings`, {
      token: admin,
      body: { version: blacked.body.version, settings: settings.body.settings },
    });
    expect(restored.status, restored.text).toBe(200);
    expect((await availability()).map((d) => d.date)).toContain(target.date);
    // cached public GET (SPEC L223 "Cache ~60 s"; contract C5: shared caches only, s-maxage)
    expect(
      (await h.request("GET", `/api/v1/public/projects/${SGH}/visit-availability?from=${h.today}&to=${h.today}`))
        .headers["cache-control"],
    ).toContain("s-maxage=60");
  });

  it("the last seat is booked, one more is 409 SLOT_FULL; the .ics is in Asia/Kolkata with a 1-hour reminder; the lead moves to Site Visit Scheduled", async () => {
    const days = await availability();
    // a slot nobody has touched yet (3 free seats) at least 3 days out, so lead-time never interferes
    day = days.find((d) => d.date >= addDays(h.today, 3) && d.slots.some((s) => s.available === SEATS))!;
    slot = day.slots.find((s) => s.available === SEATS)!;
    otherSlot =
      day.slots.find((s) => s.available === SEATS && s.start !== slot.start)?.start ??
      days.find((d) => d.date > day.date && d.slots.some((s) => s.available === SEATS))!.slots[0]!.start;
    const r1 = await book(v.p1, day.date, slot.start);
    expect(r1.status, r1.text).toBe(201);
    first = r1.body;
    // SPEC L224: visit number SV-, status Confirmed, assignee = lead's RM, address + .ics + signed manage link returned
    expect(first.visit_number).toMatch(/^SV-/);
    expect(first).toMatchObject({ date: day.date, start: slot.start, end: slot.end });
    expect(first.address).toContain("Bailey Road");
    expect(first.manage_url).toMatch(/\/visit\/[A-Za-z0-9_-]+$/);
    const lead = await leadOf(v.p1);
    expect(lead.source).toBe("SITE_VISIT");
    expect(lead.stage).toBe("SITE_VISIT_SCHEDULED"); // SPEC L224 "lead stage → Site Visit Scheduled"
    const r2 = await book(v.p2, day.date, slot.start);
    expect(r2.status, r2.text).toBe(201);
    second = r2.body;
    expect(slotMap(await availability()).get(`${day.date} ${slot.start}`)).toBe(1); // "N left"
    const r3 = await book(v.p3, day.date, slot.start); // the last seat
    expect(r3.status, r3.text).toBe(201);
    // SPEC L223: full slots are not returned
    expect(slotMap(await availability()).has(`${day.date} ${slot.start}`)).toBe(false);
    const full = await book(v.p4, day.date, slot.start);
    // SPEC L224: "Server re-checks capacity atomically … reject with SLOT_FULL if exceeded"
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("SLOT_FULL");
    expect(
      (await h.request<List<Lead>>("GET", `/api/v1/leads?search=${v.p4}`, { token: sales })).body.items,
    ).toHaveLength(0); // nothing created for the rejected booking
    // SPEC L224: "an iCalendar (.ics) file in Asia/Kolkata with a 1-hour reminder"
    const ics = await h.request("GET", pathOf(first.ics_url));
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toContain("text/calendar");
    expect(ics.text).toContain("BEGIN:VCALENDAR");
    expect(ics.text).toContain("TZID:Asia/Kolkata");
    expect(ics.text).toContain(
      `DTSTART;TZID=Asia/Kolkata:${day.date.replace(/-/g, "")}T${slot.start.replace(":", "")}00`,
    );
    expect(ics.text).toContain(`DTEND;TZID=Asia/Kolkata:${day.date.replace(/-/g, "")}T${slot.end.replace(":", "")}00`);
    expect(ics.text).toContain("BEGIN:VALARM");
    expect(ics.text).toContain("TRIGGER:-PT1H");
    expect(ics.text).toContain(first.visit_number);
    const manage = await h.request<Manage>("GET", `/api/v1/public/site-visits/${first.manage_url.split("/visit/")[1]}`);
    expect(manage.status).toBe(200);
    expect(manage.body).toMatchObject({ visit_number: first.visit_number, status: "CONFIRMED", can_cancel: true });
  });

  it("cancelling from the manage link frees the seat and reverts the lead to its previous stage", async () => {
    const token = first.manage_url.split("/visit/")[1]!;
    const cancel = await h.request<Manage & ErrorBody>("POST", `/api/v1/public/site-visits/${token}/cancel`, {
      body: { reason: "Change of plans", website: "" },
    });
    expect(cancel.status, cancel.text).toBe(200);
    // SPEC L224: "visit Cancelled, seat freed, and if it was the lead's only upcoming visit the lead's stage reverts to its previous stage"
    expect(cancel.body.status).toBe("CANCELLED");
    expect(cancel.body.can_cancel).toBe(false);
    expect(slotMap(await availability()).get(`${day.date} ${slot.start}`)).toBe(1);
    expect((await leadOf(v.p1)).stage).toBe("NEW");
    const detail = await h.request<{ activities: { type: string }[] }>(
      "GET",
      `/api/v1/leads/${(await leadOf(v.p1)).id}`,
      { token: sales },
    );
    expect(detail.body.activities.map((a) => a.type)).toContain("VISIT_CANCELLED");
    // the freed seat can be taken again (then the slot is full once more)
    const r4 = await book(v.p4, day.date, slot.start);
    expect(r4.status, r4.text).toBe(201);
    expect(slotMap(await availability()).has(`${day.date} ${slot.start}`)).toBe(false);
    expect((await h.request("GET", `/api/v1/public/site-visits/${token.slice(0, -2)}zz`)).status).toBe(404); // forged manage token
  });

  it("an ERP reschedule into a full slot is 409 SLOT_FULL; into a free slot it is RESCHEDULED with the original kept", async () => {
    const r5 = await book(
      v.p5,
      day.date === addDays(h.today, 3) && otherSlot !== slot.start ? day.date : day.date,
      otherSlot,
    );
    if (r5.status !== 201) {
      // otherSlot lives on a later day
      const later = (await availability()).find(
        (d) => d.date > day.date && d.slots.some((s) => s.available === SEATS),
      )!;
      const alt = await book(v.p5, later.date, later.slots[0]!.start);
      expect(alt.status, alt.text).toBe(201);
      fifth = alt.body;
    } else fifth = r5.body;
    const row = await erpVisit(fifth.visit_number, fifth.date);
    const toFull = await h.request<ErrorBody>("POST", `/api/v1/site-visits/${row.id}/reschedule`, {
      token: sales,
      body: { version: row.version, visit_date: day.date, slot_start: slot.start },
    });
    // SPEC L225: "reschedule (capacity-checked, full slots hidden)"
    expect(toFull.status).toBe(409);
    expect(toFull.body.error.code).toBe("SLOT_FULL");
    const free = (await availability())
      .flatMap((d) => d.slots.map((s) => ({ date: d.date, start: s.start, available: s.available })))
      .find((s) => s.available === SEATS && !(s.date === fifth.date && s.start === fifth.start))!;
    const moved = await h.request<VisitRow & ErrorBody>("POST", `/api/v1/site-visits/${row.id}/reschedule`, {
      token: sales,
      body: { version: row.version, visit_date: free.date, slot_start: free.start },
    });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.status).toBe("RESCHEDULED");
    expect(moved.body.rescheduled_from).toEqual({ visit_date: fifth.date, slot_start: fifth.start });
    expect(moved.body).toMatchObject({ visit_date: free.date, slot_start: free.start });
    expect(slotMap(await availability()).get(`${free.date} ${free.start}`)).toBe(SEATS - 1);
    // the ERP picker hides the full slot as well (SPEC L225)
    const picker = await h.request<{ days: Day[] }>(
      "GET",
      `/api/v1/site-visits/availability?project_id=${sghId}&from=${day.date}&to=${day.date}`,
      { token: sales },
    );
    expect(picker.status, picker.text).toBe(200);
    expect(picker.body.days.flatMap((d) => d.slots.map((s) => s.start))).not.toContain(slot.start);
  });

  it("marking a visit Completed moves its lead to Site Visit Done; an outcome cannot be marked twice", async () => {
    const row = await erpVisit(second.visit_number, day.date);
    expect(row.status).toBe("CONFIRMED");
    const done = await h.request<VisitRow & ErrorBody>("POST", `/api/v1/site-visits/${row.id}/complete`, {
      token: sales,
      body: { version: row.version, notes: "Liked the 3 BHK on the 12th floor" },
    });
    expect(done.status, done.text).toBe(200);
    // SPEC L225: "mark Completed (lead → Site Visit Done)"
    expect(done.body.status).toBe("COMPLETED");
    expect((await leadOf(v.p2)).stage).toBe("SITE_VISIT_DONE");
    const detail = await h.request<{ activities: { type: string }[] }>(
      "GET",
      `/api/v1/leads/${(await leadOf(v.p2)).id}`,
      { token: sales },
    );
    expect(detail.body.activities.map((a) => a.type)).toContain("VISIT_COMPLETED");
    const again = await h.request<ErrorBody>("POST", `/api/v1/site-visits/${row.id}/no-show`, {
      token: sales,
      body: { version: done.body.version },
    });
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("OUTCOME_MARKED");
  });
});
