/**
 * Adversarial review of the service module: numbering continuity, thread ordering, attachment ownership, closed-ticket conflicts,
 * inactive assignees, notice retraction on unpublish, SLA job idempotency under concurrency, kanban/list agreement, csv, versions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear, todayIST } from "@kkt/domain";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import { buildTestApp, type ErrorBody, type LoginResult, type TestContext } from "./helpers.js";

process.env["KKT_MODULES"] ??= "service";

type Message = { id: string; author_type: string; body: string; is_internal: boolean; created_at: string; attachments: { id: string }[] };
type Ticket = {
  id: string; version: number; ticket_number: string; status: string; priority: string; assignee_user_id: string | null; message_count: number; messages: Message[];
};
type Notice = { id: string; version: number; is_published: boolean; publish_at: string | null };
type List<T> = { items: T[]; total: number; next_cursor: string | null };
type Board = { columns: { status: string; count: number; tickets: Ticket[] }[] };

let t: TestContext;
let admin: LoginResult;
let sales: LoginResult;
let projectA: string;
let projectB: string;
let customerA: string;
let customerB: string;
let bookingA: string;
let bookingB: string;
let snagCat: string;
let docA: string; // CUSTOMER doc of customer A
let docB: string; // CUSTOMER doc of customer B
let docAKyc: string; // sensitive doc of customer A
let docBookingA: string; // BOOKING doc of booking A
const FY = financialYear(todayIST(), 4).label;
const ZERO = "00000000-0000-4000-8000-000000000000";

const svc = () => import("../../src/modules/service/index.js");

async function insertDoc(entityType: string, entityId: string, name: string, sensitive = false): Promise<string> {
  const [d] = await t.app.sql<{ id: string }[]>`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, uploaded_by, is_sensitive)
    values (${t.companyId}, ${entityType}::document_entity_type, ${entityId}, ${name}, 'image/jpeg', 100, ${`sha-${name}`}, ${`k/${name}`}, 'STAFF', ${admin.user.id}, ${sensitive}) returning id`;
  return d!.id;
}

async function createTicket(overrides: Record<string, unknown> = {}): Promise<Ticket> {
  const r = await t.request<Ticket>("POST", "/api/v1/service-requests", {
    token: admin.access_token,
    body: { customer_id: customerA, booking_id: bookingA, category_id: snagCat, subject: "Seepage in master bedroom wall", description: "Water marks appeared after the rains.", ...overrides },
  });
  if (r.status !== 201) throw new Error(`create → ${r.status} ${r.text}`);
  return r.body;
}

async function message(id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return t.request<Ticket>("POST", `/api/v1/service-requests/${id}/messages`, { token: admin.access_token, body, headers });
}

async function setStatus(id: string, version: number, status: string) {
  return t.request<Ticket>("POST", `/api/v1/service-requests/${id}/status`, { token: admin.access_token, body: { version, status } });
}

async function closeTicket(tk: Ticket): Promise<Ticket> {
  const a = await setStatus(tk.id, tk.version, "IN_PROGRESS");
  expect(a.status, a.text).toBe(200);
  const b = await setStatus(tk.id, a.body.version, "RESOLVED");
  expect(b.status, b.text).toBe(200);
  const c = await setStatus(tk.id, b.body.version, "CLOSED");
  expect(c.status, c.text).toBe(200);
  return c.body;
}

async function notifCount(recipientType: "STAFF" | "CUSTOMER", recipientId: string, type: string, entityId: string, opts: { withdrawn?: boolean } = {}): Promise<number> {
  const rows = opts.withdrawn === undefined
    ? await t.app.sql<{ n: number }[]>`select count(*)::int as n from notifications where recipient_type = ${recipientType} and recipient_id = ${recipientId} and type = ${type} and entity_id = ${entityId}`
    : await t.app.sql<{ n: number }[]>`select count(*)::int as n from notifications where recipient_type = ${recipientType} and recipient_id = ${recipientId} and type = ${type} and entity_id = ${entityId} and is_withdrawn = ${opts.withdrawn}`;
  return Number(rows[0]?.n ?? 0);
}

async function auditCount(action: string, entityId: string): Promise<number> {
  const rows = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs where action = ${action} and entity_id = ${entityId}`;
  return Number(rows[0]?.n ?? 0);
}

async function messageCount(ticketId: string): Promise<number> {
  const rows = await t.app.sql<{ n: number }[]>`select count(*)::int as n from service_request_messages where ticket_id = ${ticketId}`;
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = await t.loginAs("admin");
  sales = await t.loginAs("sales");
  projectA = await createProject(t, "Shree Ganesh Heights", "SGH");
  projectB = await createProject(t, "Ganesh Green Villas", "GGV");
  customerA = (await createPortalCustomer(t, { phone: "9876500001", name: "Rajesh Kumar Sinha" })).customerId;
  customerB = (await createPortalCustomer(t, { phone: "9876500002", name: "Pooja Mishra" })).customerId;
  bookingA = (await createActiveBooking(t, customerA, projectA)).bookingId;
  bookingB = (await createActiveBooking(t, customerB, projectB)).bookingId;
  const cat = await t.request<{ id: string }>("POST", "/api/v1/masters/service-categories", { token: admin.access_token, body: { name: "Defect/Snag", sort_order: 5, default_priority: "MEDIUM" } });
  expect(cat.status, cat.text).toBe(201);
  snagCat = cat.body.id;
  await t.app.sql`update companies set settings = settings || '{"sla_hours": {"LOW": 72, "MEDIUM": 48, "HIGH": 24, "URGENT": 2}}'::jsonb where id = ${t.companyId}`;
  docA = await insertDoc("CUSTOMER", customerA, "wall-a.jpg");
  docB = await insertDoc("CUSTOMER", customerB, "wall-b.jpg");
  docAKyc = await insertDoc("CUSTOMER", customerA, "aadhaar-a.jpg", true);
  docBookingA = await insertDoc("BOOKING", bookingA, "allotment-a.pdf");
});
afterAll(async () => { await t?.close(); });

describe("ticket numbering", () => {
  it("allocates contiguous SR-<fy>/NNNN numbers under concurrent creation and does not burn a number on a failed create", async () => {
    const created = await Promise.all([1, 2, 3, 4, 5].map((i) => createTicket({ subject: `Parallel ticket ${i}` })));
    const numbers = created.map((c) => c.ticket_number).sort();
    expect(new Set(numbers).size).toBe(5);
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `SR-${FY}/${String(n).padStart(4, "0")}`));
    const failed = await t.request<ErrorBody>("POST", "/api/v1/service-requests", { token: admin.access_token, body: { customer_id: customerA, booking_id: bookingA, category_id: snagCat, subject: "Will fail", description: "x", attachment_ids: [ZERO] } });
    expect(failed.status).toBe(400);
    const next = await createTicket({ subject: "After failure" });
    expect(next.ticket_number).toBe(`SR-${FY}/0006`);
  });
});

describe("thread ordering", () => {
  it("returns messages in the order they were written (opening message first, customer and staff interleaved)", async () => {
    const { addCustomerMessage } = await svc();
    const tk = await createTicket({ subject: "Ordering" });
    const bodies = ["first internal note", "first public reply", "second internal note"];
    for (const body of bodies) {
      const r = await message(tk.id, { body, is_internal: body.includes("internal") });
      expect(r.status, r.text).toBe(201);
    }
    await t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerA, "customer answer"));
    const r = await message(tk.id, { body: "final staff reply" });
    expect(r.status, r.text).toBe(201);
    const detail = await t.request<Ticket>("GET", `/api/v1/service-requests/${tk.id}`, { token: admin.access_token });
    expect(detail.body.messages.map((m) => m.body)).toEqual(["Water marks appeared after the rains.", ...bodies, "customer answer", "final staff reply"]);
    const times = detail.body.messages.map((m) => new Date(m.created_at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(detail.body.message_count).toBe(6);
  });
});

describe("attachment ownership", () => {
  it("rejects attachments that do not belong to the ticket, its customer or its booking, and sensitive (KYC) documents; nothing is written", async () => {
    const tk = await createTicket({ subject: "Attachments" });
    const other = await createTicket({ customer_id: customerB, booking_id: bookingB, subject: "Other customer" });
    const docTicket = await insertDoc("SERVICE_REQUEST", tk.id, "photo-on-ticket.jpg");
    const docOtherTicket = await insertDoc("SERVICE_REQUEST", other.id, "photo-on-other.jpg");
    const before = await messageCount(tk.id);
    for (const bad of [docB, docAKyc, docOtherTicket]) {
      const r = await message(tk.id, { body: "see attached", attachment_ids: [docA, bad] });
      expect(r.status, r.text).toBe(400);
      const err = r.body as unknown as ErrorBody;
      expect(err.error.code).toBe("VALIDATION_ERROR");
      expect(err.error.details?.["field"]).toBe("attachment_ids");
      expect(err.error.details?.["missing"]).toEqual([bad]);
    }
    expect(await messageCount(tk.id)).toBe(before);
    const ok = await message(tk.id, { body: "all mine", attachment_ids: [docA, docBookingA, docTicket] });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.messages.at(-1)!.attachments.map((a) => a.id)).toEqual([docA, docBookingA, docTicket]);
    // creation: the booking document and the customer document are fine, another customer's document is not
    const badCreate = await t.request<ErrorBody>("POST", "/api/v1/service-requests", { token: admin.access_token, body: { customer_id: customerA, booking_id: bookingA, category_id: snagCat, subject: "Foreign attachment", description: "x", attachment_ids: [docB] } });
    expect(badCreate.status).toBe(400);
    expect(badCreate.body.error.details?.["missing"]).toEqual([docB]);
    const kycCreate = await t.request<ErrorBody>("POST", "/api/v1/service-requests", { token: admin.access_token, body: { customer_id: customerA, booking_id: bookingA, category_id: snagCat, subject: "KYC attachment", description: "x", attachment_ids: [docAKyc] } });
    expect(kycCreate.status).toBe(400);
    const okCreate = await createTicket({ subject: "Own attachments", attachment_ids: [docA, docBookingA] });
    expect(okCreate.messages[0]!.attachments.map((a) => a.id)).toEqual([docA, docBookingA]);
  });

  it("applies the same rule to the customer (portal) path", async () => {
    const { addCustomerMessage, createTicketForCustomer } = await svc();
    const tk = await createTicket({ subject: "Customer attachments" });
    await expect(t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerA, "not mine", [docB]))).rejects.toMatchObject({ statusCode: 400 });
    await expect(t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerA, "kyc", [docAKyc]))).rejects.toMatchObject({ statusCode: 400 });
    const ok = await t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerA, "mine", [docA]));
    expect(ok.messages.at(-1)!.attachments[0]!.id).toBe(docA);
    await expect(t.app.db.transaction((tx) => createTicketForCustomer(tx, { customerId: customerB, bookingId: bookingB, categoryId: snagCat, subject: "Foreign doc", description: "x", attachmentIds: [docA] }))).rejects.toMatchObject({ statusCode: 400 });
    const created = await t.app.db.transaction((tx) => createTicketForCustomer(tx, { customerId: customerB, bookingId: bookingB, categoryId: snagCat, subject: "Own doc", description: "x", attachmentIds: [docB] }));
    expect(created.messages[0]!.attachments[0]!.id).toBe(docB);
  });
});

describe("closed tickets", () => {
  it("rejects customer and staff messages, edits and assignment on a CLOSED ticket with 409 TICKET_CLOSED", async () => {
    const { addCustomerMessage } = await svc();
    const closed = await closeTicket(await createTicket({ subject: "Closed" }));
    expect(closed.status).toBe("CLOSED");
    await expect(t.app.db.transaction((tx) => addCustomerMessage(tx, closed.id, customerA, "too late"))).rejects.toMatchObject({ statusCode: 409, code: "TICKET_CLOSED" });
    const staff = await message(closed.id, { body: "too late" });
    expect(staff.status).toBe(409);
    expect((staff.body as unknown as ErrorBody).error.code).toBe("TICKET_CLOSED");
    const patch = await t.request<ErrorBody>("PATCH", `/api/v1/service-requests/${closed.id}`, { token: admin.access_token, body: { version: closed.version, priority: "LOW" } });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe("TICKET_CLOSED");
    const assign = await t.request<ErrorBody>("POST", `/api/v1/service-requests/${closed.id}/assign`, { token: admin.access_token, body: { version: closed.version, assignee_user_id: sales.user.id } });
    expect(assign.status).toBe(409);
    expect(assign.body.error.code).toBe("TICKET_CLOSED");
    const reopen = await setStatus(closed.id, closed.version, "IN_PROGRESS");
    expect(reopen.status).toBe(422);
    expect(await messageCount(closed.id)).toBe(1);
    const after = await t.request<Ticket>("GET", `/api/v1/service-requests/${closed.id}`, { token: admin.access_token });
    expect(after.body.version).toBe(closed.version);
  });
});

describe("assignment", () => {
  it("rejects an inactive user as assignee (422 ASSIGNEE_INACTIVE) on assign and on create, without writing anything", async () => {
    const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", { token: admin.access_token });
    const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
    const created = await t.request<{ id: string }>("POST", "/api/v1/users", { token: admin.access_token, body: { name: "Former Staff", email: "former@sgb.in", password: "Former@12345", role_id: salesRole.id, all_projects: true, project_ids: [], must_change_password: false } });
    expect(created.status, created.text).toBe(201);
    const formerId = created.body.id;
    await t.app.sql`update users set is_active = false where id = ${formerId}`;
    const tk = await createTicket({ subject: "Inactive assignee" });
    const r = await t.request<ErrorBody>("POST", `/api/v1/service-requests/${tk.id}/assign`, { token: admin.access_token, body: { version: tk.version, assignee_user_id: formerId } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("BUSINESS_RULE");
    expect(r.body.error.details?.["rule"]).toBe("ASSIGNEE_INACTIVE");
    expect(await notifCount("STAFF", formerId, "TICKET_NEW", tk.id)).toBe(0);
    expect(await auditCount("service_request.assign", tk.id)).toBe(0);
    const detail = await t.request<Ticket>("GET", `/api/v1/service-requests/${tk.id}`, { token: admin.access_token });
    expect(detail.body.assignee_user_id).toBeNull();
    expect(detail.body.version).toBe(tk.version);
    const onCreate = await t.request<ErrorBody>("POST", "/api/v1/service-requests", { token: admin.access_token, body: { customer_id: customerA, category_id: snagCat, subject: "Inactive on create", description: "x", assignee_user_id: formerId } });
    expect(onCreate.status).toBe(422);
    expect(onCreate.body.error.details?.["rule"]).toBe("ASSIGNEE_INACTIVE");
    const ok = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/assign`, { token: admin.access_token, body: { version: tk.version, assignee_user_id: sales.user.id } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.assignee_user_id).toBe(sales.user.id);
  });

  it("a stale If-Match on a reply is a 409 VERSION_CONFLICT and writes nothing", async () => {
    const tk = await createTicket({ subject: "Stale reply" });
    const r = await message(tk.id, { body: "stale" }, { "if-match": `"${tk.version + 5}"` });
    expect(r.status).toBe(409);
    expect((r.body as unknown as ErrorBody).error.code).toBe("VERSION_CONFLICT");
    expect(await messageCount(tk.id)).toBe(1);
    expect(await notifCount("CUSTOMER", customerA, "TICKET_STAFF_REPLY", tk.id)).toBe(0);
    const ok = await message(tk.id, { body: "fresh" }, { "if-match": `"${tk.version}"` });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.version).toBe(tk.version + 1);
  });
});

describe("notice retraction", () => {
  it("unpublishing via PATCH withdraws bell notifications (unread deleted, read flagged) and republishing notifies again", async () => {
    const { noticesForCustomer } = await svc();
    const create = async (title: string) => {
      const r = await t.request<Notice>("POST", "/api/v1/notices", { token: admin.access_token, body: { project_id: projectA, title, body_md: "x", is_published: true } });
      expect(r.status, r.text).toBe(201);
      return r.body;
    };
    const readOne = await create("Read then unpublished");
    const unreadOne = await create("Unread then unpublished");
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", readOne.id)).toBe(1);
    expect(await notifCount("CUSTOMER", customerB, "NOTICE_PUBLISHED", readOne.id)).toBe(0);
    await t.app.sql`update notifications set is_read = true, read_at = now() where entity_id = ${readOne.id}`;
    const u1 = await t.request<Notice>("PATCH", `/api/v1/notices/${readOne.id}`, { token: admin.access_token, body: { version: readOne.version, is_published: false } });
    expect(u1.status, u1.text).toBe(200);
    expect(u1.body.is_published).toBe(false);
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", readOne.id, { withdrawn: true })).toBe(1);
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", readOne.id, { withdrawn: false })).toBe(0);
    const u2 = await t.request<Notice>("PATCH", `/api/v1/notices/${unreadOne.id}`, { token: admin.access_token, body: { version: unreadOne.version, is_published: false } });
    expect(u2.status, u2.text).toBe(200);
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", unreadOne.id)).toBe(0);
    const hidden = (await noticesForCustomer(t.app.db, customerA, { page_size: 100 })).items.map((n) => n.id);
    expect(hidden).not.toContain(readOne.id);
    expect(hidden).not.toContain(unreadOne.id);
    // republish: the withdrawn notification does not count as "already notified"
    const re = await t.request<Notice>("PATCH", `/api/v1/notices/${readOne.id}`, { token: admin.access_token, body: { version: u1.body.version, is_published: true } });
    expect(re.status, re.text).toBe(200);
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", readOne.id, { withdrawn: false })).toBe(1);
    const visible = await noticesForCustomer(t.app.db, customerA, { page_size: 100 });
    const row = visible.items.find((n) => n.id === readOne.id);
    expect(row).toBeDefined();
    expect(row!.is_read).toBe(false);
    expect(await auditCount("notice.update", readOne.id)).toBe(2);
    // a live notice never loses its publish_at (the customer list pages by it)
    const cleared = await t.request<Notice>("PATCH", `/api/v1/notices/${readOne.id}`, { token: admin.access_token, body: { version: re.body.version, publish_at: null } });
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body.is_published).toBe(true);
    expect(cleared.body.publish_at).not.toBeNull();
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", readOne.id, { withdrawn: false })).toBe(1); // no duplicate notification
  });
});

describe("SLA job", () => {
  it("two concurrent runs flag and notify each overdue ticket exactly once", async () => {
    const { slaBreachCheck } = await svc();
    const late = await createTicket({ subject: "Late", priority: "URGENT", assignee_user_id: sales.user.id });
    const late2 = await createTicket({ subject: "Late two", priority: "URGENT" });
    await t.app.sql`update service_requests set sla_due_at = now() - interval '1 hour' where id in (${late.id}, ${late2.id})`;
    const [a, b] = await Promise.all([slaBreachCheck(t.app.db), slaBreachCheck(t.app.db)]);
    expect(a.flagged + b.flagged).toBe(2);
    expect([...a.ticket_numbers, ...b.ticket_numbers].sort()).toEqual([late.ticket_number, late2.ticket_number].sort());
    expect(await notifCount("STAFF", sales.user.id, "TICKET_SLA_BREACH", late.id)).toBe(1);
    expect(await notifCount("STAFF", admin.user.id, "TICKET_SLA_BREACH", late.id)).toBe(1);
    expect(await notifCount("STAFF", admin.user.id, "TICKET_SLA_BREACH", late2.id)).toBe(1);
    expect(await auditCount("service_request.sla_breach", late.id)).toBe(1);
    expect(await auditCount("service_request.sla_breach", late2.id)).toBe(1);
    const third = await slaBreachCheck(t.app.db);
    expect(third.flagged).toBe(0);
    const csv = await t.request("GET", "/api/v1/service-requests/sla-breaches?format=csv", { token: admin.access_token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    const lines = csv.text.trim().split("\r\n");
    expect(lines[0]).toContain("ticket_number,status,priority");
    expect(lines.slice(1).length).toBeGreaterThanOrEqual(2);
    expect(csv.text).toContain(late.ticket_number);
    expect(csv.text).toContain(late2.ticket_number);
    expect(lines.slice(1).every((l) => l.includes(",true,") )).toBe(true); // is_sla_breached column
  });
});

describe("kanban", () => {
  it("column counts equal the list totals for the same filters", async () => {
    const statuses = ["NEW", "IN_PROGRESS", "AWAITING_CUSTOMER", "RESOLVED", "CLOSED"];
    for (const filter of ["", `assignee_user_id=${sales.user.id}`, `project_id=${projectB}`]) {
      const board = await t.request<Board>("GET", `/api/v1/service-requests/board?column_limit=2${filter ? `&${filter}` : ""}`, { token: admin.access_token });
      expect(board.status, board.text).toBe(200);
      expect(board.body.columns.map((c) => c.status)).toEqual(statuses);
      for (const col of board.body.columns) {
        const list = await t.request<List<Ticket>>("GET", `/api/v1/service-requests?status=${col.status}&page_size=1${filter ? `&${filter}` : ""}`, { token: admin.access_token });
        expect(list.status, list.text).toBe(200);
        expect(col.count, `${col.status} ${filter}`).toBe(list.body.total);
        expect(col.tickets.length).toBeLessThanOrEqual(Math.min(2, col.count));
        expect(col.tickets.every((x) => x.status === col.status)).toBe(true);
      }
    }
    const all = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?page_size=1", { token: admin.access_token });
    const board = await t.request<Board>("GET", "/api/v1/service-requests/board", { token: admin.access_token });
    expect(board.body.columns.reduce((n, c) => n + c.count, 0)).toBe(all.body.total);
  });
});
