/**
 * Phase 7 domain track — service SLA (docs/hardening/phase7-domain.md, item 5), with a faked clock:
 * - the SLA clock pauses while a ticket is AWAITING_CUSTOMER (sla_paused_at); on resume the pause is added to sla_due_at and
 *   sla_paused_seconds, so a ticket waiting on the customer is never flagged, and is flagged once the shifted deadline passes;
 * - reopening resets sla_due_at from the reopen time and clears sla_breached_at, so the breach job alerts again;
 * - a priority change moves the deadline by the difference in SLA hours (pauses and the reopen base are kept).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import { buildTestApp, type TestContext } from "./helpers.js";

process.env["KKT_MODULES"] ??= "service";

type Ticket = {
  id: string;
  version: number;
  status: string;
  sla_due_at: string | null;
  sla_breached_at: string | null;
  is_sla_breached: boolean;
  sla_paused_at?: string | null;
  sla_paused_seconds?: number;
};

const MIN = 60_000;
const HOUR = 60 * MIN;

let t: TestContext;
let customerId: string;
let bookingId: string;
let categoryId: string;
let t0: number;

const svc = () => import("../../src/modules/service/index.js");
const jobs = () => import("../../src/modules/service/jobs.js");

/** Moves the faked clock (Date only: timers, sockets and the database stay real) and signs in again at that time. */
async function at(offsetMs: number): Promise<string> {
  vi.setSystemTime(new Date(t0 + offsetMs));
  return (await t.loginAs("admin")).access_token;
}

async function get(token: string, id: string): Promise<Ticket> {
  const r = await t.request<Ticket>("GET", `/api/v1/service-requests/${id}`, { token });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function setStatus(token: string, id: string, status: string): Promise<Ticket> {
  const cur = await get(token, id);
  const r = await t.request<Ticket>("POST", `/api/v1/service-requests/${id}/status`, {
    token,
    body: { version: cur.version, status },
  });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function breachCheck(offsetMs: number): Promise<string[]> {
  const { slaBreachCheck } = await jobs();
  return (await slaBreachCheck(t.app.db, new Date(t0 + offsetMs))).ticket_numbers;
}

async function breachNotifications(ticketId: string): Promise<number> {
  const [r] = await t.app.sql<{ n: number }[]>`
    select count(*)::int as n from notifications where type = 'TICKET_SLA_BREACH' and entity_id = ${ticketId}`;
  return r!.n;
}

async function newTicket(token: string, subject: string): Promise<Ticket & { ticket_number: string }> {
  const r = await t.request<Ticket & { ticket_number: string }>("POST", "/api/v1/service-requests", {
    token,
    body: {
      customer_id: customerId,
      booking_id: bookingId,
      category_id: categoryId,
      subject,
      description: `${subject}: reported by the buyer`,
      priority: "URGENT",
    },
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

beforeAll(async () => {
  t = await buildTestApp();
  const admin = (await t.loginAs("admin")).access_token;
  const project = await createProject(t, "Shree Ganesh Heights", "SGH");
  customerId = (await createPortalCustomer(t, { phone: "9876500011" })).customerId;
  bookingId = (await createActiveBooking(t, customerId, project)).bookingId;
  const cat = await t.request<{ id: string }>("POST", "/api/v1/masters/service-categories", {
    token: admin,
    body: { name: "Defect/Snag", sort_order: 1 },
  });
  categoryId = cat.body.id;
  await t.app
    .sql`update companies set settings = settings || '{"sla_hours": {"LOW": 72, "MEDIUM": 48, "HIGH": 24, "URGENT": 2}}'::jsonb where id = ${t.companyId}`;
  // whole seconds, so the expected deadlines below are exact
  t0 = Math.floor(Date.now() / 1000) * 1000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(t0));
}, 120_000);

afterEach(() => {
  vi.setSystemTime(new Date(t0));
});

afterAll(async () => {
  vi.useRealTimers();
  await t?.close();
});

describe("SLA clock pauses while AWAITING_CUSTOMER", () => {
  it("is never breached while paused; the deadline shifts by the pause on resume; flagged once the shifted deadline passes", async () => {
    let token = await at(0);
    const tk = await newTicket(token, "Seepage in the kitchen");
    expect(new Date(tk.sla_due_at!).getTime()).toBe(t0 + 2 * HOUR);
    token = await at(10 * MIN);
    await setStatus(token, tk.id, "IN_PROGRESS");
    token = await at(30 * MIN);
    const awaiting = await setStatus(token, tk.id, "AWAITING_CUSTOMER");
    expect(new Date(awaiting.sla_paused_at!).getTime()).toBe(t0 + 30 * MIN);
    expect(awaiting.sla_due_at).toBe(tk.sla_due_at); // unchanged while paused

    // 5 h later: the original deadline (2 h) has long passed, but the clock is paused
    token = await at(5 * HOUR);
    const paused = await get(token, tk.id);
    expect(paused.is_sla_breached).toBe(false);
    expect(await breachCheck(5 * HOUR)).not.toContain(tk.ticket_number);
    const list = await t.request<{ items: { id: string }[] }>("GET", "/api/v1/service-requests?sla_breached=true", {
      token,
    });
    expect(list.body.items.map((i) => i.id)).not.toContain(tk.id);

    // the customer replies → IN_PROGRESS: 4.5 h of pause are added to the deadline
    const { addCustomerMessage } = await svc();
    await t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerId, "Photos attached, please check."));
    const resumed = await get(token, tk.id);
    expect(resumed.status).toBe("IN_PROGRESS");
    expect(resumed.sla_paused_at).toBeNull();
    expect(resumed.sla_paused_seconds).toBe(4.5 * 3600);
    expect(new Date(resumed.sla_due_at!).getTime()).toBe(t0 + 6.5 * HOUR);
    expect(resumed.is_sla_breached).toBe(false);

    expect(await breachCheck(6 * HOUR)).not.toContain(tk.ticket_number);
    expect(await breachCheck(7 * HOUR)).toEqual([tk.ticket_number]);
    expect(await breachNotifications(tk.id)).toBeGreaterThanOrEqual(1);
  });

  it("a second pause adds up; a staff move out of AWAITING_CUSTOMER resumes the clock too", async () => {
    let token = await at(0);
    const tk = await newTicket(token, "Door alignment");
    await setStatus(token, tk.id, "IN_PROGRESS");
    token = await at(1 * HOUR);
    await setStatus(token, tk.id, "AWAITING_CUSTOMER");
    token = await at(2 * HOUR);
    await setStatus(token, tk.id, "IN_PROGRESS"); // 1 h paused
    token = await at(150 * MIN);
    await setStatus(token, tk.id, "AWAITING_CUSTOMER");
    token = await at(4 * HOUR);
    const done = await setStatus(token, tk.id, "IN_PROGRESS"); // 1.5 h paused
    expect(done.sla_paused_seconds).toBe(2.5 * 3600);
    expect(new Date(done.sla_due_at!).getTime()).toBe(t0 + 4.5 * HOUR);
  });
});

describe("reopen starts a fresh SLA window and re-arms the breach alert", () => {
  it("resets sla_due_at from the reopen time, clears sla_breached_at, and the job alerts again", async () => {
    let token = await at(0);
    const tk = await newTicket(token, "Leaking tap");
    await setStatus(token, tk.id, "IN_PROGRESS");
    expect(await breachCheck(3 * HOUR)).toEqual([tk.ticket_number]);
    const firstAlerts = await breachNotifications(tk.id);
    expect(firstAlerts).toBeGreaterThanOrEqual(1);
    token = await at(4 * HOUR);
    const resolved = await setStatus(token, tk.id, "RESOLVED");
    expect(resolved.sla_breached_at).not.toBeNull();

    token = await at(5 * HOUR);
    const { reopenByCustomer } = await svc();
    await t.app.db.transaction((tx) => reopenByCustomer(tx, tk.id, customerId, "Still leaking"));
    const reopened = await get(token, tk.id);
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.sla_breached_at).toBeNull();
    expect(reopened.is_sla_breached).toBe(false);
    expect(new Date(reopened.sla_due_at!).getTime()).toBe(t0 + 7 * HOUR); // reopen time + 2 h (URGENT)
    expect(reopened.sla_paused_seconds).toBe(0);

    expect(await breachCheck(6 * HOUR)).not.toContain(tk.ticket_number);
    expect(await breachCheck(8 * HOUR)).toEqual([tk.ticket_number]);
    expect(await breachNotifications(tk.id)).toBe(2 * firstAlerts);
  });

  it("a staff reopen (RESOLVED → IN_PROGRESS) resets the window as well", async () => {
    let token = await at(0);
    const tk = await newTicket(token, "Cracked tile");
    await setStatus(token, tk.id, "IN_PROGRESS");
    await setStatus(token, tk.id, "RESOLVED");
    token = await at(30 * HOUR);
    const reopened = await setStatus(token, tk.id, "IN_PROGRESS");
    expect(new Date(reopened.sla_due_at!).getTime()).toBe(t0 + 32 * HOUR);
    expect(reopened.is_sla_breached).toBe(false);
  });
});

describe("priority change", () => {
  it("moves the deadline by the difference in SLA hours, keeping pauses", async () => {
    let token = await at(0);
    const tk = await newTicket(token, "Paint peeling");
    await setStatus(token, tk.id, "IN_PROGRESS");
    token = await at(30 * MIN);
    await setStatus(token, tk.id, "AWAITING_CUSTOMER");
    token = await at(90 * MIN);
    const resumed = await setStatus(token, tk.id, "IN_PROGRESS"); // +1 h
    expect(new Date(resumed.sla_due_at!).getTime()).toBe(t0 + 3 * HOUR);
    const patched = await t.request<Ticket>("PATCH", `/api/v1/service-requests/${tk.id}`, {
      token,
      body: { version: resumed.version, priority: "HIGH" },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(new Date(patched.body.sla_due_at!).getTime()).toBe(t0 + 25 * HOUR); // 24 h + the 1 h pause
  });
});

describe("pure slaPatch", () => {
  it("pauses on entry, resumes with the elapsed seconds, resets on reopen", async () => {
    const { slaPatch } = await import("../../src/modules/service/ticketService.js");
    const now = new Date("2026-10-01T10:00:00Z");
    const due = new Date("2026-10-01T12:00:00Z");
    const base = { resolvedAt: null, priority: "URGENT" as const, slaDueAt: due, slaPausedSeconds: 60 };
    expect(slaPatch({ ...base, status: "IN_PROGRESS", slaPausedAt: null }, "AWAITING_CUSTOMER", now)).toEqual({
      slaPausedAt: now,
    });
    const resumedAt = new Date("2026-10-01T11:30:00Z");
    expect(slaPatch({ ...base, status: "AWAITING_CUSTOMER", slaPausedAt: now }, "IN_PROGRESS", resumedAt)).toEqual({
      slaDueAt: new Date("2026-10-01T13:30:00Z"),
      slaPausedSeconds: 60 + 5400,
      slaPausedAt: null,
    });
    expect(
      slaPatch({ ...base, status: "RESOLVED", slaPausedAt: null }, "IN_PROGRESS", now, {
        LOW: 72,
        MEDIUM: 48,
        HIGH: 24,
        URGENT: 4,
      }),
    ).toEqual({
      slaDueAt: new Date("2026-10-01T14:00:00Z"),
      slaBreachedAt: null,
      slaPausedAt: null,
      slaPausedSeconds: 0,
    });
    expect(slaPatch({ ...base, status: "IN_PROGRESS", slaPausedAt: null }, "RESOLVED", now)).toEqual({});
  });
});
