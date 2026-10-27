import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear, todayIST } from "@kkt/domain";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import {
  CREDS,
  buildTestApp,
  ifMatch,
  versionOf,
  type ErrorBody,
  type LoginResult,
  type TestContext,
} from "./helpers.js";

process.env["KKT_MODULES"] ??= "service";

type Ticket = {
  id: string;
  version: number;
  ticket_number: string;
  status: string;
  priority: string;
  category_id: string;
  category_name: string;
  subject: string;
  description: string;
  customer_id: string;
  booking_id: string | null;
  project_name: string | null;
  flat_number: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  sla_due_at: string | null;
  sla_breached_at: string | null;
  is_sla_breached: boolean;
  resolved_at: string | null;
  closed_at: string | null;
  reopened_count: number;
  rating: number | null;
  rating_comment: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  messages: {
    id: string;
    author_type: string;
    author_name: string;
    body: string;
    is_internal: boolean;
    attachments: { id: string; file_name: string; mime: string; thumb_url: string | null }[];
  }[];
};
type Notice = {
  id: string;
  version: number;
  title: string;
  project_id: string | null;
  project_name: string | null;
  publish_at: string | null;
  expires_at: string | null;
  is_published: boolean;
  created_by_name: string | null;
};
type List<T> = { items: T[]; total: number; page: number; page_size: number; next_cursor: string | null };

let t: TestContext;
let admin: LoginResult;
let accounts: LoginResult;
let sales: LoginResult;
let employee: LoginResult;
let marketing: LoginResult;
let scoped: LoginResult;
let scopedMarketing: LoginResult;
let projectA: string;
let projectB: string;
let customerA: string;
let customerB: string;
let customerC: string;
let bookingA: string;
let bookingB: string;
let paymentCat: string;
let snagCat: string;
let inactiveCat: string;
let docId: string;
const FY = financialYear(todayIST(), 4).label;
const HOUR = 3_600_000;

const svc = () => import("../../src/modules/service/index.js");

async function post<T>(token: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await t.request<T>("POST", url, { token, body, headers });
  if (r.status !== 201) throw new Error(`POST ${url} → ${r.status} ${r.text}`);
  return r.body;
}

async function createTicket(overrides: Record<string, unknown> = {}, token = admin.access_token): Promise<Ticket> {
  return post<Ticket>(token, "/api/v1/service-requests", {
    customer_id: customerA,
    booking_id: bookingA,
    category_id: snagCat,
    subject: "Seepage in master bedroom wall",
    description: "Water marks appeared after the rains.",
    ...overrides,
  });
}

async function notifCount(
  recipientType: "STAFF" | "CUSTOMER",
  recipientId: string,
  type: string,
  entityId?: string,
): Promise<number> {
  const rows = entityId
    ? await t.app.sql<
        { n: number }[]
      >`select count(*)::int as n from notifications where recipient_type = ${recipientType} and recipient_id = ${recipientId} and type = ${type} and entity_id = ${entityId}`
    : await t.app.sql<
        { n: number }[]
      >`select count(*)::int as n from notifications where recipient_type = ${recipientType} and recipient_id = ${recipientId} and type = ${type}`;
  return Number(rows[0]?.n ?? 0);
}

async function auditCount(action: string, entityId?: string): Promise<number> {
  const rows = entityId
    ? await t.app.sql<
        { n: number }[]
      >`select count(*)::int as n from audit_logs where action = ${action} and entity_id = ${entityId}`
    : await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs where action = ${action}`;
  return Number(rows[0]?.n ?? 0);
}

async function setStatus(id: string, version: number, status: string, note?: string, token = admin.access_token) {
  return t.request<Ticket>("POST", `/api/v1/service-requests/${id}/status`, {
    token,
    body: { version, status, ...(note ? { note } : {}) },
  });
}

/** Walks a NEW ticket to RESOLVED through the staff status endpoint. */
async function resolve(id: string, version: number): Promise<Ticket> {
  const inProgress = await setStatus(id, version, "IN_PROGRESS");
  expect(inProgress.status, inProgress.text).toBe(200);
  const resolved = await setStatus(id, inProgress.body.version, "RESOLVED");
  expect(resolved.status, resolved.text).toBe(200);
  return resolved.body;
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = await t.loginAs("admin");
  accounts = await t.loginAs("accounts");
  sales = await t.loginAs("sales");
  employee = await t.loginAs("employee");
  marketing = await t.loginAs("marketing");
  projectA = await createProject(t, "Shree Ganesh Heights", "SGH");
  projectB = await createProject(t, "Ganesh Green Villas", "GGV");
  const a = await createPortalCustomer(t, { phone: "9876500001", name: "Rajesh Kumar Sinha" });
  const b = await createPortalCustomer(t, { phone: "9876500002", name: "Pooja Mishra" });
  const c = await createPortalCustomer(t, { phone: "9876500003", name: "Lead Only" });
  customerA = a.customerId;
  customerB = b.customerId;
  customerC = c.customerId;
  bookingA = (await createActiveBooking(t, customerA, projectA)).bookingId;
  bookingB = (await createActiveBooking(t, customerB, projectB)).bookingId;
  paymentCat = (
    await post<{ id: string }>(admin.access_token, "/api/v1/masters/service-categories", {
      name: "Payment query",
      sort_order: 1,
      default_priority: "HIGH",
    })
  ).id;
  snagCat = (
    await post<{ id: string }>(admin.access_token, "/api/v1/masters/service-categories", {
      name: "Defect/Snag",
      sort_order: 5,
      default_priority: "MEDIUM",
    })
  ).id;
  inactiveCat = (
    await post<{ id: string }>(admin.access_token, "/api/v1/masters/service-categories", {
      name: "Legacy",
      sort_order: 9,
    })
  ).id;
  await t.app.sql`update service_categories set is_active = false where id = ${inactiveCat}`;
  // SLA hours per priority come from company settings: URGENT shortened to 2 h for the breach tests.
  await t.app
    .sql`update companies set settings = settings || '{"sla_hours": {"LOW": 72, "MEDIUM": 48, "HIGH": 24, "URGENT": 2}}'::jsonb where id = ${t.companyId}`;
  const [doc] = await t.app.sql<
    { id: string }[]
  >`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, uploaded_by)
    values (${t.companyId}, 'CUSTOMER', ${customerA}, 'wall.jpg', 'image/jpeg', 1234, 'abc', 'k/wall.jpg', 'CUSTOMER', ${customerA}) returning id`; // the buyer's own photo: usable by staff and buyer alike
  docId = doc!.id;
  // Project Admin scoped to project A only.
  const [pm] = await t.app.sql<
    { id: string; version: number }[]
  >`select id, version from users where email = ${CREDS.projects.email}`;
  const scopeRes = await t.request("PUT", `/api/v1/users/${pm!.id}/scope`, {
    token: admin.access_token,
    body: { version: pm!.version, all_projects: false, project_ids: [projectA] },
  });
  expect(scopeRes.status, scopeRes.text).toBe(200);
  scoped = await t.loginAs("projects");
  // Marketing user (cms.read/write) scoped to project A only, for notice scope checks.
  const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", {
    token: admin.access_token,
  });
  const marketingRole = roles.body.items.find((r) => r.name === "Marketing")!;
  const created = await t.request("POST", "/api/v1/users", {
    token: admin.access_token,
    body: {
      name: "Scoped Marketing",
      email: "mkt.sgh@sgb.in",
      password: "Marketing@12345",
      role_id: marketingRole.id,
      all_projects: false,
      project_ids: [projectA],
      must_change_password: false,
    },
  });
  expect(created.status, created.text).toBe(201);
  scopedMarketing = await t.login("mkt.sgh@sgb.in", "Marketing@12345");
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
// Creation, numbering, SLA, notifications
// ---------------------------------------------------------------------------

describe("ticket creation", () => {
  it("numbers the ticket SR-<fy>/0001, defaults priority from the category, computes sla_due_at from settings and notifies Super Admin + Accounts for a payment category", async () => {
    const adminBefore = await notifCount("STAFF", admin.user.id, "TICKET_NEW");
    const r = await t.request<Ticket>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      headers: { "idempotency-key": "svc-create-1" },
      body: {
        customer_id: customerA,
        booking_id: bookingA,
        category_id: paymentCat,
        subject: "Receipt not received for cheque",
        description: "Paid on 3 Oct, no receipt yet.",
        attachment_ids: [docId],
      },
    });
    expect(r.status, r.text).toBe(201);
    const tk = r.body;
    expect(tk.ticket_number).toBe(`SR-${FY}/0001`);
    expect(tk.status).toBe("NEW");
    expect(tk.priority).toBe("HIGH");
    expect(tk.category_name).toBe("Payment query");
    expect(tk.project_name).toBe("Shree Ganesh Heights");
    expect(tk.flat_number).toMatch(/-101$/);
    expect(tk.version).toBe(1);
    expect(tk.is_sla_breached).toBe(false);
    expect(new Date(tk.sla_due_at!).getTime() - new Date(tk.created_at).getTime()).toBe(24 * HOUR);
    expect(tk.message_count).toBe(1);
    expect(tk.messages).toHaveLength(1);
    expect(tk.messages[0]!.author_type).toBe("STAFF");
    expect(tk.messages[0]!.attachments.map((a) => a.id)).toEqual([docId]);
    expect(tk.messages[0]!.attachments[0]!.file_name).toBe("wall.jpg");
    expect(await notifCount("STAFF", admin.user.id, "TICKET_NEW", tk.id)).toBe(1);
    expect(await notifCount("STAFF", accounts.user.id, "TICKET_NEW", tk.id)).toBe(1);
    expect(await notifCount("STAFF", sales.user.id, "TICKET_NEW", tk.id)).toBe(0);
    expect(await auditCount("service_request.create", tk.id)).toBe(1);
    // idempotent replay
    const again = await t.request<Ticket>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      headers: { "idempotency-key": "svc-create-1" },
      body: {
        customer_id: customerA,
        booking_id: bookingA,
        category_id: paymentCat,
        subject: "Receipt not received for cheque",
        description: "Paid on 3 Oct, no receipt yet.",
        attachment_ids: [docId],
      },
    });
    expect(again.status).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.id).toBe(tk.id);
    expect(await notifCount("STAFF", admin.user.id, "TICKET_NEW")).toBe(adminBefore + 1);
  });

  it("uses an explicit priority for the SLA (URGENT = 2 h from settings) and notifies only the assignee when one is given", async () => {
    const adminBefore = await notifCount("STAFF", admin.user.id, "TICKET_NEW");
    const tk = await createTicket({ priority: "URGENT", assignee_user_id: sales.user.id, subject: "Lift not working" });
    expect(tk.priority).toBe("URGENT");
    expect(tk.ticket_number).toBe(`SR-${FY}/0002`);
    expect(new Date(tk.sla_due_at!).getTime() - new Date(tk.created_at).getTime()).toBe(2 * HOUR);
    expect(tk.assignee_user_id).toBe(sales.user.id);
    expect(tk.assignee_name).toBe("Ankit Verma");
    expect(await notifCount("STAFF", sales.user.id, "TICKET_NEW", tk.id)).toBe(1);
    expect(await notifCount("STAFF", admin.user.id, "TICKET_NEW")).toBe(adminBefore);
  });

  it("validates customer/booking ownership, category state, assignee and attachments", async () => {
    const wrongBooking = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      body: {
        customer_id: customerA,
        booking_id: bookingB,
        category_id: snagCat,
        subject: "Wrong booking",
        description: "x",
      },
    });
    expect(wrongBooking.status).toBe(400);
    expect((wrongBooking.body.error.details?.["issues"] as { path: string }[] | undefined)?.[0]?.path).toBe(
      "booking_id",
    );
    const inactive = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      body: { customer_id: customerA, category_id: inactiveCat, subject: "Old category", description: "x" },
    });
    expect(inactive.status).toBe(422);
    expect(inactive.body.error.details?.["rule"]).toBe("CATEGORY_INACTIVE");
    const badCat = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      body: {
        customer_id: customerA,
        category_id: "00000000-0000-4000-8000-000000000000",
        subject: "No category",
        description: "x",
      },
    });
    expect(badCat.status).toBe(400);
    const badAssignee = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      body: {
        customer_id: customerA,
        category_id: snagCat,
        subject: "No assignee",
        description: "x",
        assignee_user_id: "00000000-0000-4000-8000-000000000000",
      },
    });
    expect(badAssignee.status).toBe(400);
    const badDoc = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      body: {
        customer_id: customerA,
        category_id: snagCat,
        subject: "No attachment",
        description: "x",
        attachment_ids: ["00000000-0000-4000-8000-000000000000"],
      },
    });
    expect(badDoc.status).toBe(400);
    expect((badDoc.body.error.details?.["issues"] as { path: string }[] | undefined)?.[0]?.path).toBe("attachment_ids");
    const unknownKey = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: admin.access_token,
      body: { customer_id: customerA, category_id: snagCat, subject: "Extra", description: "x", foo: 1 },
    });
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("the portal path creates a ticket for the customer (404 for a booking that is not theirs) and notifies Super Admin", async () => {
    const { createTicketForCustomer } = await svc();
    const detail = await t.app.db.transaction((tx) =>
      createTicketForCustomer(tx, {
        customerId: customerB,
        bookingId: bookingB,
        categoryId: snagCat,
        subject: "Balcony door jammed",
        description: "Cannot open since Monday.",
      }),
    );
    expect(detail.status).toBe("NEW");
    expect(detail.ticket_number).toBe(`SR-${FY}/0003`);
    expect(detail.can_reopen).toBe(false);
    expect(detail.can_rate).toBe(false);
    expect((detail as Record<string, unknown>)["assignee_user_id"]).toBeUndefined();
    expect(detail.messages[0]!.author_type).toBe("CUSTOMER");
    expect(await notifCount("STAFF", admin.user.id, "TICKET_NEW", detail.id)).toBe(1);
    await expect(
      t.app.db.transaction((tx) =>
        createTicketForCustomer(tx, {
          customerId: customerB,
          bookingId: bookingA,
          categoryId: snagCat,
          subject: "Not my booking",
          description: "x",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Permissions and scope
// ---------------------------------------------------------------------------

describe("permissions and scope", () => {
  it("enforces service.read / service.write / service.assign", async () => {
    expect((await t.request("GET", "/api/v1/service-requests", { token: employee.access_token })).status).toBe(403);
    expect((await t.request("GET", "/api/v1/service-requests", { token: accounts.access_token })).status).toBe(200);
    const write = await t.request<ErrorBody>("POST", "/api/v1/service-requests", {
      token: accounts.access_token,
      body: { customer_id: customerA, category_id: snagCat, subject: "Nope", description: "x" },
    });
    expect(write.status).toBe(403);
    expect(write.body.error.details?.["permission"]).toBe("service.write");
    const tk = await createTicket({ subject: "Assign perms" });
    const assign = await t.request<ErrorBody>("POST", `/api/v1/service-requests/${tk.id}/assign`, {
      token: sales.access_token,
      body: { version: tk.version, assignee_user_id: sales.user.id },
    });
    expect(assign.status).toBe(403);
    expect(assign.body.error.details?.["permission"]).toBe("service.assign");
    expect((await t.request("GET", "/api/v1/service-requests", { token: null })).status).toBe(401);
  });

  it("scopes tickets by the booking's project: 404 outside scope, lists hide them, project filter probes are 404", async () => {
    const inA = await createTicket({ subject: "Scoped A" });
    const inB = await createTicket({ customer_id: customerB, booking_id: bookingB, subject: "Scoped B" });
    const noBooking = await createTicket({ booking_id: null, subject: "Scoped none" });
    expect((await t.request("GET", `/api/v1/service-requests/${inA.id}`, { token: scoped.access_token })).status).toBe(
      200,
    );
    expect(
      (await t.request("GET", `/api/v1/service-requests/${noBooking.id}`, { token: scoped.access_token })).status,
    ).toBe(200);
    const foreign = await t.request<ErrorBody>("GET", `/api/v1/service-requests/${inB.id}`, {
      token: scoped.access_token,
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");
    const list = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?page_size=200", {
      token: scoped.access_token,
    });
    expect(list.status).toBe(200);
    const ids = list.body.items.map((i) => i.id);
    expect(ids).toContain(inA.id);
    expect(ids).toContain(noBooking.id);
    expect(ids).not.toContain(inB.id);
    expect(
      (await t.request("GET", `/api/v1/service-requests?project_id=${projectB}`, { token: scoped.access_token }))
        .status,
    ).toBe(404);
    expect(
      (await t.request("GET", `/api/v1/service-requests?project_id=${projectA}`, { token: scoped.access_token }))
        .status,
    ).toBe(200);
    const board = await t.request<{ columns: { status: string; count: number; tickets: Ticket[] }[] }>(
      "GET",
      "/api/v1/service-requests/board",
      { token: scoped.access_token },
    );
    expect(board.status).toBe(200);
    expect(board.body.columns.flatMap((c) => c.tickets.map((x) => x.id))).not.toContain(inB.id);
    const breaches = await t.request<List<Ticket>>("GET", "/api/v1/service-requests/sla-breaches", {
      token: scoped.access_token,
    });
    expect(breaches.status).toBe(200);
    expect(breaches.body.items.map((i) => i.id)).not.toContain(inB.id);
  });
});

// ---------------------------------------------------------------------------
// Editing, assignment, versions
// ---------------------------------------------------------------------------

describe("patch and assign", () => {
  it("PATCH recomputes sla_due_at when priority changes, honours If-Match and rejects stale versions", async () => {
    const tk = await createTicket({ subject: "Patch me" });
    expect(tk.priority).toBe("MEDIUM");
    const patched = await t.request<Ticket>("PATCH", `/api/v1/service-requests/${tk.id}`, {
      token: admin.access_token,
      body: { version: tk.version, priority: "HIGH", subject: "Patched subject" },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.priority).toBe("HIGH");
    expect(patched.body.subject).toBe("Patched subject");
    expect(patched.body.version).toBe(2);
    expect(new Date(patched.body.sla_due_at!).getTime() - new Date(tk.created_at).getTime()).toBe(24 * HOUR);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/service-requests/${tk.id}`, {
      token: admin.access_token,
      body: { version: 1, priority: "LOW" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(2);
    expect(stale.body.error.details?.["changed_by"]).toBe("Suresh Agarwal");
    const viaHeader = await t.request<Ticket>("PATCH", `/api/v1/service-requests/${tk.id}`, {
      token: admin.access_token,
      headers: { "if-match": '"2"' },
      body: { category_id: paymentCat },
    });
    expect(viaHeader.status, viaHeader.text).toBe(200);
    expect(viaHeader.body.category_name).toBe("Payment query");
    expect(viaHeader.body.version).toBe(3);
    const noVersion = await t.request<ErrorBody>("PATCH", `/api/v1/service-requests/${tk.id}`, {
      token: admin.access_token,
      body: { priority: "LOW" },
    });
    expect(noVersion.status).toBe(428);
    expect(await auditCount("service_request.update", tk.id)).toBe(2);
  });

  it("assign notifies the assignee, validates the user and audits", async () => {
    const tk = await createTicket({ subject: "Assign me" });
    const r = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/assign`, {
      token: admin.access_token,
      body: { version: tk.version, assignee_user_id: sales.user.id },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.assignee_user_id).toBe(sales.user.id);
    expect(r.body.assignee_name).toBe("Ankit Verma");
    expect(await notifCount("STAFF", sales.user.id, "TICKET_NEW", tk.id)).toBe(1);
    // re-assigning the same person does not notify again; unassign works
    const same = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/assign`, {
      token: admin.access_token,
      body: { version: r.body.version, assignee_user_id: sales.user.id },
    });
    expect(same.status).toBe(200);
    expect(await notifCount("STAFF", sales.user.id, "TICKET_NEW", tk.id)).toBe(1);
    const none = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/assign`, {
      token: admin.access_token,
      body: { version: same.body.version, assignee_user_id: null },
    });
    expect(none.status).toBe(200);
    expect(none.body.assignee_user_id).toBeNull();
    const bad = await t.request<ErrorBody>("POST", `/api/v1/service-requests/${tk.id}/assign`, {
      token: admin.access_token,
      body: { version: none.body.version, assignee_user_id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(bad.status).toBe(400);
    expect(await auditCount("service_request.assign", tk.id)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Thread: internal notes, replies, customer replies
// ---------------------------------------------------------------------------

describe("messages", () => {
  it("internal notes stay invisible to the customer; public replies notify the customer and move NEW → IN_PROGRESS", async () => {
    const { ticketForCustomer, listTicketsForCustomer } = await svc();
    const tk = await createTicket({ subject: "Thread" });
    const note = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "Customer is a VIP, handle gently", is_internal: true },
    });
    expect(note.status, note.text).toBe(201);
    expect(note.body.status).toBe("NEW");
    expect(note.body.messages).toHaveLength(2);
    expect(note.body.messages[1]!.is_internal).toBe(true);
    expect(await notifCount("CUSTOMER", customerA, "TICKET_STAFF_REPLY", tk.id)).toBe(0);
    const reply = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "We have scheduled a site inspection.", attachment_ids: [docId] },
    });
    expect(reply.status, reply.text).toBe(201);
    expect(reply.body.status).toBe("IN_PROGRESS");
    expect(reply.body.message_count).toBe(3);
    expect(reply.body.last_message_at).not.toBeNull();
    expect(reply.body.messages[2]!.attachments[0]!.id).toBe(docId);
    expect(await notifCount("CUSTOMER", customerA, "TICKET_STAFF_REPLY", tk.id)).toBe(1);
    // staff detail shows the internal note, the customer view never does
    const staffView = await t.request<Ticket>("GET", `/api/v1/service-requests/${tk.id}`, {
      token: accounts.access_token,
    });
    expect(staffView.status).toBe(200);
    expect(staffView.body.messages.some((m) => m.is_internal)).toBe(true);
    const customerView = await ticketForCustomer(t.app.db, tk.id, customerA);
    expect(customerView.messages).toHaveLength(2);
    expect(customerView.messages.some((m) => m.is_internal)).toBe(false);
    expect(customerView.messages.some((m) => m.body.includes("VIP"))).toBe(false);
    expect(customerView.message_count).toBe(2);
    expect(JSON.stringify(customerView)).not.toContain("VIP");
    await expect(ticketForCustomer(t.app.db, tk.id, customerB)).rejects.toMatchObject({ statusCode: 404 });
    const mine = await listTicketsForCustomer(t.app.db, customerA, { booking_id: bookingA });
    expect(mine.items.map((i) => i.id)).toContain(tk.id);
    expect(mine.items.every((i) => i.customer_id === customerA)).toBe(true);
    const theirs = await listTicketsForCustomer(t.app.db, customerB);
    expect(theirs.items.map((i) => i.id)).not.toContain(tk.id);
    expect(await auditCount("service_request.message", tk.id)).toBe(2);
  });

  it("an explicit status on a reply is applied when valid (AWAITING_CUSTOMER) and 422 when not", async () => {
    const tk = await createTicket({ subject: "Need info" });
    const askFromNew = await t.request<ErrorBody>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "Please share a photo of the leak.", status: "AWAITING_CUSTOMER" },
    });
    expect(askFromNew.status).toBe(422); // NEW → AWAITING_CUSTOMER is not a valid transition
    expect(askFromNew.body.error.details?.["rule"]).toBe("INVALID_STATUS_TRANSITION");
    expect(
      (await t.request<Ticket>("GET", `/api/v1/service-requests/${tk.id}`, { token: admin.access_token })).body
        .messages,
    ).toHaveLength(1); // nothing written
    const started = await setStatus(tk.id, tk.version, "IN_PROGRESS");
    expect(started.status).toBe(200);
    const ask = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "Please share a photo of the leak.", status: "AWAITING_CUSTOMER" },
    });
    expect(ask.status, ask.text).toBe(201);
    expect(ask.body.status).toBe("AWAITING_CUSTOMER");
    expect(await notifCount("CUSTOMER", customerA, "TICKET_STAFF_REPLY", tk.id)).toBe(1);
    const internalKeeps = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "Chasing the site engineer", is_internal: true },
    });
    expect(internalKeeps.body.status).toBe("AWAITING_CUSTOMER"); // internal notes never move the status
  });
});

describe("customer replies and status machine", () => {
  it("customer reply flips AWAITING_CUSTOMER → IN_PROGRESS and notifies the assignee; other customers get 404; closed tickets 409 TICKET_CLOSED", async () => {
    const { addCustomerMessage } = await svc();
    const tk = await createTicket({ subject: "Awaiting", assignee_user_id: sales.user.id });
    const inProgress = await setStatus(tk.id, tk.version, "IN_PROGRESS");
    expect(inProgress.status).toBe(200);
    const awaiting = await t.request<Ticket>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "Which floor is affected?", status: "AWAITING_CUSTOMER" },
    });
    expect(awaiting.status, awaiting.text).toBe(201);
    expect(awaiting.body.status).toBe("AWAITING_CUSTOMER");
    await expect(
      t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerB, "not mine")),
    ).rejects.toMatchObject({ statusCode: 404 });
    const replied = await t.app.db.transaction((tx) =>
      addCustomerMessage(tx, tk.id, customerA, "Fourth floor, near the lift.", [docId]),
    );
    expect(replied.status).toBe("IN_PROGRESS");
    expect(replied.messages.at(-1)!.author_type).toBe("CUSTOMER");
    expect(replied.messages.at(-1)!.author_name).toBe("Rajesh Kumar Sinha");
    expect(replied.messages.at(-1)!.attachments[0]!.id).toBe(docId);
    expect(await notifCount("STAFF", sales.user.id, "TICKET_CUSTOMER_REPLY", tk.id)).toBe(1);
    const resolved = await setStatus(tk.id, replied.version, "RESOLVED");
    expect(resolved.status, resolved.text).toBe(200);
    const closed = await setStatus(tk.id, resolved.body.version, "CLOSED");
    expect(closed.status).toBe(200);
    await expect(
      t.app.db.transaction((tx) => addCustomerMessage(tx, tk.id, customerA, "too late")),
    ).rejects.toMatchObject({ statusCode: 409, code: "TICKET_CLOSED" });
    const staffLate = await t.request<ErrorBody>("POST", `/api/v1/service-requests/${tk.id}/messages`, {
      token: admin.access_token,
      headers: ifMatch(await versionOf(t, `/api/v1/service-requests/${tk.id}`, admin.access_token)),
      body: { body: "too late" },
    });
    expect(staffLate.status).toBe(409);
    expect(staffLate.body.error.code).toBe("TICKET_CLOSED");
  });

  it("valid transitions stamp resolved_at / closed_at; invalid ones are 422 INVALID_STATUS_TRANSITION", async () => {
    const tk = await createTicket({ subject: "Machine" });
    const skip = await setStatus(tk.id, tk.version, "CLOSED");
    expect(skip.status).toBe(422);
    expect((skip.body as unknown as ErrorBody).error.details?.["rule"]).toBe("INVALID_STATUS_TRANSITION");
    const awaitFromNew = await setStatus(tk.id, tk.version, "AWAITING_CUSTOMER");
    expect(awaitFromNew.status).toBe(422);
    const same = await setStatus(tk.id, tk.version, "NEW");
    expect(same.status).toBe(422);
    const inProgress = await setStatus(tk.id, tk.version, "IN_PROGRESS");
    expect(inProgress.status).toBe(200);
    expect(inProgress.body.resolved_at).toBeNull();
    const stale = await setStatus(tk.id, tk.version, "RESOLVED");
    expect(stale.status).toBe(409);
    expect((stale.body as unknown as ErrorBody).error.code).toBe("VERSION_CONFLICT");
    const resolved = await setStatus(tk.id, inProgress.body.version, "RESOLVED", "Fixed the seepage; please verify.");
    expect(resolved.status, resolved.text).toBe(200);
    expect(resolved.body.resolved_at).not.toBeNull();
    expect(resolved.body.closed_at).toBeNull();
    expect(resolved.body.messages.at(-1)!.body).toBe("Fixed the seepage; please verify.");
    expect(await notifCount("CUSTOMER", customerA, "TICKET_STAFF_REPLY", tk.id)).toBe(1);
    const closed = await setStatus(tk.id, resolved.body.version, "CLOSED");
    expect(closed.status).toBe(200);
    expect(closed.body.closed_at).not.toBeNull();
    const reopenClosed = await setStatus(tk.id, closed.body.version, "IN_PROGRESS");
    expect(reopenClosed.status).toBe(422);
    expect(await auditCount("service_request.status", tk.id)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Reopen window and rating
// ---------------------------------------------------------------------------

describe("reopen and rating", () => {
  it("customer may reopen within 7 days of RESOLVED (reopened_count + 1, staff notified); after 7 days or when not resolved → 409 REOPEN_WINDOW_CLOSED", async () => {
    const { reopenByCustomer, ticketForCustomer } = await svc();
    const tk = await createTicket({ subject: "Reopen", assignee_user_id: sales.user.id });
    await expect(t.app.db.transaction((tx) => reopenByCustomer(tx, tk.id, customerA))).rejects.toMatchObject({
      statusCode: 409,
      code: "REOPEN_WINDOW_CLOSED",
    });
    const resolved = await resolve(tk.id, tk.version);
    expect((await ticketForCustomer(t.app.db, tk.id, customerA)).can_reopen).toBe(true);
    await expect(
      t.app.db.transaction((tx) => reopenByCustomer(tx, tk.id, customerB, "not mine")),
    ).rejects.toMatchObject({ statusCode: 404 });
    const reopened = await t.app.db.transaction((tx) =>
      reopenByCustomer(tx, tk.id, customerA, "Seepage is back after two days"),
    );
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.reopened_count).toBe(1);
    expect(reopened.resolved_at).toBeNull();
    expect(reopened.can_reopen).toBe(false);
    expect(reopened.messages.at(-1)!.body).toContain("Seepage is back");
    expect(reopened.version).toBe(resolved.version + 1);
    expect(await notifCount("STAFF", sales.user.id, "TICKET_CUSTOMER_REPLY", tk.id)).toBe(1);
    expect(await auditCount("service_request.reopen", tk.id)).toBe(1);
    // resolve again, then backdate resolved_at beyond the window
    const again = await setStatus(tk.id, reopened.version, "RESOLVED");
    expect(again.status, again.text).toBe(200);
    await t.app.sql`update service_requests set resolved_at = now() - interval '8 days' where id = ${tk.id}`;
    expect((await ticketForCustomer(t.app.db, tk.id, customerA)).can_reopen).toBe(false);
    await expect(t.app.db.transaction((tx) => reopenByCustomer(tx, tk.id, customerA))).rejects.toMatchObject({
      statusCode: 409,
      code: "REOPEN_WINDOW_CLOSED",
    });
    await t.app.sql`update service_requests set resolved_at = now() - interval '6 days' where id = ${tk.id}`;
    const second = await t.app.db.transaction((tx) => reopenByCustomer(tx, tk.id, customerA));
    expect(second.reopened_count).toBe(2);
  });

  it("rating is 1–5, only on RESOLVED/CLOSED, once; rating a RESOLVED ticket closes it", async () => {
    const { rateByCustomer, ticketForCustomer } = await svc();
    const tk = await createTicket({ subject: "Rate" });
    await expect(t.app.db.transaction((tx) => rateByCustomer(tx, tk.id, customerA, 5))).rejects.toMatchObject({
      statusCode: 422,
    });
    await resolve(tk.id, tk.version);
    expect((await ticketForCustomer(t.app.db, tk.id, customerA)).can_rate).toBe(true);
    await expect(t.app.db.transaction((tx) => rateByCustomer(tx, tk.id, customerA, 6))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(t.app.db.transaction((tx) => rateByCustomer(tx, tk.id, customerB, 4))).rejects.toMatchObject({
      statusCode: 404,
    });
    const rated = await t.app.db.transaction((tx) => rateByCustomer(tx, tk.id, customerA, 4, "Quick fix, thanks"));
    expect(rated.rating).toBe(4);
    expect(rated.rating_comment).toBe("Quick fix, thanks");
    expect(rated.status).toBe("CLOSED");
    expect(rated.closed_at).not.toBeNull();
    expect(rated.can_rate).toBe(false);
    await expect(t.app.db.transaction((tx) => rateByCustomer(tx, tk.id, customerA, 2))).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_RATED",
    });
    const staffView = await t.request<Ticket>("GET", `/api/v1/service-requests/${tk.id}`, {
      token: admin.access_token,
    });
    expect(staffView.body.rating).toBe(4);
    expect(await auditCount("service_request.rate", tk.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SLA breach job and lists
// ---------------------------------------------------------------------------

describe("SLA breach job", () => {
  it("flags open tickets past sla_due_at once, notifies assignee + Super Admin once, and lists them under /sla-breaches", async () => {
    const { slaBreachCheck } = await svc();
    const late = await createTicket({ subject: "Late ticket", priority: "URGENT", assignee_user_id: sales.user.id });
    const resolvedLate = await createTicket({ subject: "Resolved late", priority: "URGENT" });
    await resolve(resolvedLate.id, resolvedLate.version);
    await t.app
      .sql`update service_requests set sla_due_at = now() - interval '1 hour' where id in (${late.id}, ${resolvedLate.id})`;
    const before = await t.request<Ticket>("GET", `/api/v1/service-requests/${late.id}`, { token: admin.access_token });
    expect(before.body.is_sla_breached).toBe(true); // overdue right now, even before the job flags it
    expect(before.body.sla_breached_at).toBeNull();
    const run = await slaBreachCheck(t.app.db);
    expect(run.flagged).toBe(1);
    expect(run.ticket_numbers).toEqual([late.ticket_number]);
    const after = await t.request<Ticket>("GET", `/api/v1/service-requests/${late.id}`, { token: admin.access_token });
    expect(after.body.sla_breached_at).not.toBeNull();
    expect(after.body.version).toBe(late.version + 1);
    expect(await notifCount("STAFF", sales.user.id, "TICKET_SLA_BREACH", late.id)).toBe(1);
    expect(await notifCount("STAFF", admin.user.id, "TICKET_SLA_BREACH", late.id)).toBe(1);
    expect(await notifCount("STAFF", admin.user.id, "TICKET_SLA_BREACH", resolvedLate.id)).toBe(0);
    const rerun = await slaBreachCheck(t.app.db);
    expect(rerun.flagged).toBe(0);
    expect(await notifCount("STAFF", sales.user.id, "TICKET_SLA_BREACH", late.id)).toBe(1);
    expect(await auditCount("service_request.sla_breach", late.id)).toBe(1);
    const breaches = await t.request<List<Ticket>>("GET", "/api/v1/service-requests/sla-breaches", {
      token: admin.access_token,
    });
    expect(breaches.status).toBe(200);
    expect(breaches.body.items.map((i) => i.id)).toContain(late.id);
    expect(breaches.body.items.map((i) => i.id)).not.toContain(resolvedLate.id);
    const filtered = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?sla_breached=true", {
      token: admin.access_token,
    });
    expect(filtered.body.items.map((i) => i.id)).toContain(late.id);
    const notBreached = await t.request<List<Ticket>>(
      "GET",
      "/api/v1/service-requests?sla_breached=false&page_size=200",
      { token: admin.access_token },
    );
    expect(notBreached.body.items.map((i) => i.id)).not.toContain(late.id);
  });
});

describe("lists and board", () => {
  it("filters, searches, sorts, pages by cursor, exports csv and builds the kanban", async () => {
    const tk = await createTicket({ subject: "Listing zebra" });
    const byStatus = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?status=NEW&page_size=200", {
      token: admin.access_token,
    });
    expect(byStatus.status, byStatus.text).toBe(200);
    expect(byStatus.body.items.every((i) => i.status === "NEW")).toBe(true);
    expect(byStatus.body.items.map((i) => i.id)).toContain(tk.id);
    const byCustomer = await t.request<List<Ticket>>("GET", `/api/v1/service-requests?customer_id=${customerB}`, {
      token: admin.access_token,
    });
    expect(byCustomer.body.items.every((i) => i.customer_id === customerB)).toBe(true);
    expect(byCustomer.body.total).toBeGreaterThan(0);
    const byProject = await t.request<List<Ticket>>("GET", `/api/v1/service-requests?project_id=${projectB}`, {
      token: admin.access_token,
    });
    expect(byProject.body.items.every((i) => i.project_name === "Ganesh Green Villas")).toBe(true);
    const unassigned = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?unassigned=true&page_size=200", {
      token: admin.access_token,
    });
    expect(unassigned.body.items.every((i) => i.assignee_user_id === null)).toBe(true);
    const search = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?search=zebra", {
      token: admin.access_token,
    });
    expect(search.body.total).toBe(1);
    expect(search.body.items[0]!.id).toBe(tk.id);
    const byNumber = await t.request<List<Ticket>>(
      "GET",
      `/api/v1/service-requests?search=${encodeURIComponent(tk.ticket_number)}`,
      { token: admin.access_token },
    );
    expect(byNumber.body.items[0]!.id).toBe(tk.id);
    const sorted = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?sort=priority&page_size=200", {
      token: admin.access_token,
    });
    expect(sorted.status).toBe(200);
    expect((await t.request("GET", "/api/v1/service-requests?sort=nope", { token: admin.access_token })).status).toBe(
      400,
    );
    const page1 = await t.request<List<Ticket>>("GET", "/api/v1/service-requests?limit=2", {
      token: admin.access_token,
    });
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.next_cursor).not.toBeNull();
    const page2 = await t.request<List<Ticket>>(
      "GET",
      `/api/v1/service-requests?limit=2&cursor=${encodeURIComponent(page1.body.next_cursor!)}`,
      { token: admin.access_token },
    );
    expect(page2.status).toBe(200);
    expect(page2.body.items.map((i) => i.id)).not.toContain(page1.body.items[0]!.id);
    const csv = await t.request("GET", "/api/v1/service-requests?format=csv", { token: admin.access_token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toContain("ticket_number,status,priority");
    expect(csv.text).toContain(tk.ticket_number);
    const board = await t.request<{ columns: { status: string; count: number; tickets: Ticket[] }[] }>(
      "GET",
      "/api/v1/service-requests/board?column_limit=1",
      { token: admin.access_token },
    );
    expect(board.status, board.text).toBe(200);
    expect(board.body.columns.map((c) => c.status)).toEqual([
      "NEW",
      "IN_PROGRESS",
      "AWAITING_CUSTOMER",
      "RESOLVED",
      "CLOSED",
    ]);
    const newCol = board.body.columns[0]!;
    expect(newCol.count).toBe(byStatus.body.total);
    expect(newCol.tickets).toHaveLength(1);
    expect(newCol.tickets[0]!.id).toBe(tk.id); // newest first
    const closedCol = board.body.columns[4]!;
    expect(closedCol.count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

describe("notices", () => {
  it("requires cms.write to create; publishing notifies customers with ACTIVE/COMPLETED bookings in the project (or all) exactly once", async () => {
    const { noticesForCustomer } = await svc();
    expect(
      (
        await t.request("POST", "/api/v1/notices", {
          token: employee.access_token,
          body: { title: "Nope", body_md: "x" },
        })
      ).status,
    ).toBe(403);
    expect((await t.request("GET", "/api/v1/notices", { token: employee.access_token })).status).toBe(403);
    const all = await post<Notice>(
      marketing.access_token,
      "/api/v1/notices",
      { title: "Diwali holiday schedule", body_md: "Office closed 31 Oct – 2 Nov.", is_published: true },
      { "idempotency-key": "notice-1" },
    );
    expect(all.project_id).toBeNull();
    expect(all.is_published).toBe(true);
    expect(all.publish_at).not.toBeNull();
    expect(all.created_by_name).toBe("Nisha Singh");
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", all.id)).toBe(1);
    expect(await notifCount("CUSTOMER", customerB, "NOTICE_PUBLISHED", all.id)).toBe(1);
    expect(await notifCount("CUSTOMER", customerC, "NOTICE_PUBLISHED", all.id)).toBe(0);
    const sgh = await post<Notice>(admin.access_token, "/api/v1/notices", {
      project_id: projectA,
      title: "Tower A 4th slab casting on 2 Nov",
      body_md: "Site access restricted.",
      is_published: true,
    });
    expect(sgh.project_name).toBe("Shree Ganesh Heights");
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", sgh.id)).toBe(1);
    expect(await notifCount("CUSTOMER", customerB, "NOTICE_PUBLISHED", sgh.id)).toBe(0);
    expect(await auditCount("notice.create", sgh.id)).toBe(1);
    const forA = await noticesForCustomer(t.app.db, customerA);
    expect(forA.items.map((n) => n.id)).toEqual(expect.arrayContaining([all.id, sgh.id]));
    expect(forA.items.find((n) => n.id === sgh.id)!.project_name).toBe("Shree Ganesh Heights");
    expect(forA.items.every((n) => n.is_read === false)).toBe(true);
    const forB = await noticesForCustomer(t.app.db, customerB);
    expect(forB.items.map((n) => n.id)).toContain(all.id);
    expect(forB.items.map((n) => n.id)).not.toContain(sgh.id);
    const forC = await noticesForCustomer(t.app.db, customerC);
    expect(forC.items.map((n) => n.id)).toEqual([all.id]);
    await t.app
      .sql`update notifications set is_read = true, read_at = now() where recipient_type = 'CUSTOMER' and recipient_id = ${customerA} and entity_id = ${all.id}`;
    const readState = await noticesForCustomer(t.app.db, customerA);
    expect(readState.items.find((n) => n.id === all.id)!.is_read).toBe(true);
    expect(readState.items.find((n) => n.id === sgh.id)!.is_read).toBe(false);
    const foreign = await t.request<ErrorBody>("POST", "/api/v1/notices", {
      token: admin.access_token,
      body: { project_id: "00000000-0000-4000-8000-000000000000", title: "Ghost project", body_md: "x" },
    });
    expect(foreign.status).toBe(400);
    const badWindow = await t.request<ErrorBody>("POST", "/api/v1/notices", {
      token: admin.access_token,
      body: {
        title: "Bad window",
        body_md: "x",
        publish_at: "2030-01-02T00:00:00Z",
        expires_at: "2030-01-01T00:00:00Z",
      },
    });
    expect(badWindow.status).toBe(400);
  });

  it("drafts, future publish_at and expired notices are hidden; the hourly sweep delivers a notice whose publish_at has arrived", async () => {
    const { noticesForCustomer, slaBreachCheck } = await svc();
    const draft = await post<Notice>(admin.access_token, "/api/v1/notices", {
      title: "Draft notice",
      body_md: "x",
      is_published: false,
    });
    const future = await post<Notice>(admin.access_token, "/api/v1/notices", {
      title: "Future notice",
      body_md: "x",
      is_published: true,
      publish_at: "2099-01-01T00:00:00Z",
    });
    const expired = await post<Notice>(admin.access_token, "/api/v1/notices", {
      title: "Expired notice",
      body_md: "x",
      is_published: true,
      publish_at: "2020-01-01T00:00:00Z",
      expires_at: "2020-02-01T00:00:00Z",
    });
    expect(draft.publish_at).toBeNull();
    for (const n of [draft, future, expired])
      expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", n.id)).toBe(0);
    const visible = (await noticesForCustomer(t.app.db, customerA, { page_size: 100 })).items.map((n) => n.id);
    expect(visible).not.toContain(draft.id);
    expect(visible).not.toContain(future.id);
    expect(visible).not.toContain(expired.id);
    // time passes: the future notice is due now
    await t.app.sql`update notices set publish_at = now() - interval '1 minute' where id = ${future.id}`;
    const run = await slaBreachCheck(t.app.db);
    expect(run.notices_notified).toBe(1);
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", future.id)).toBe(1);
    expect(await notifCount("CUSTOMER", customerB, "NOTICE_PUBLISHED", future.id)).toBe(1);
    expect((await slaBreachCheck(t.app.db)).notices_notified).toBe(0);
    expect((await noticesForCustomer(t.app.db, customerA, { page_size: 100 })).items.map((n) => n.id)).toContain(
      future.id,
    );
    // publishing a draft via PATCH notifies once; a later edit does not notify again
    const published = await t.request<Notice>("PATCH", `/api/v1/notices/${draft.id}`, {
      token: admin.access_token,
      body: { version: draft.version, is_published: true },
    });
    expect(published.status, published.text).toBe(200);
    expect(published.body.is_published).toBe(true);
    expect(published.body.publish_at).not.toBeNull();
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", draft.id)).toBe(1);
    const edited = await t.request<Notice>("PATCH", `/api/v1/notices/${draft.id}`, {
      token: admin.access_token,
      headers: { "if-match": `"${published.body.version}"` },
      body: { title: "Draft notice (edited)" },
    });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.title).toBe("Draft notice (edited)");
    expect(await notifCount("CUSTOMER", customerA, "NOTICE_PUBLISHED", draft.id)).toBe(1);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/notices/${draft.id}`, {
      token: admin.access_token,
      body: { version: draft.version, title: "stale" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(await auditCount("notice.update", draft.id)).toBe(2);
  });

  it("DELETE soft-deletes (is_published=false), retracts bell notifications and hides the notice; staff list filters and csv work", async () => {
    const { noticesForCustomer } = await svc();
    const n = await post<Notice>(admin.access_token, "/api/v1/notices", {
      project_id: projectB,
      title: "Villa water supply maintenance",
      body_md: "Sunday 6–9 am.",
      is_published: true,
    });
    expect(await notifCount("CUSTOMER", customerB, "NOTICE_PUBLISHED", n.id)).toBe(1);
    expect((await t.request("DELETE", `/api/v1/notices/${n.id}`, { token: employee.access_token })).status).toBe(403);
    const del = await t.request<Notice>("DELETE", `/api/v1/notices/${n.id}`, {
      token: admin.access_token,
      headers: { "if-match": `"v${n.version}"` },
    });
    expect(del.status, del.text).toBe(200);
    expect(del.body.is_published).toBe(false);
    expect(del.body.version).toBe(n.version + 1);
    expect(await notifCount("CUSTOMER", customerB, "NOTICE_PUBLISHED", n.id)).toBe(0); // unread → deleted (retraction rule)
    expect((await noticesForCustomer(t.app.db, customerB)).items.map((x) => x.id)).not.toContain(n.id);
    expect(await auditCount("notice.delete", n.id)).toBe(1);
    const list = await t.request<List<Notice>>("GET", "/api/v1/notices?is_published=false", {
      token: marketing.access_token,
    });
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((x) => x.id)).toContain(n.id);
    expect(list.body.items.every((x) => !x.is_published)).toBe(true);
    const byProject = await t.request<List<Notice>>("GET", `/api/v1/notices?project_id=${projectA}`, {
      token: admin.access_token,
    });
    expect(byProject.body.items.every((x) => x.project_id === projectA)).toBe(true);
    expect(byProject.body.total).toBeGreaterThan(0);
    const search = await t.request<List<Notice>>("GET", "/api/v1/notices?search=Diwali", { token: admin.access_token });
    expect(search.body.total).toBe(1);
    const one = await t.request<Notice>("GET", `/api/v1/notices/${n.id}`, { token: admin.access_token });
    expect(one.status).toBe(200);
    expect(one.body.title).toBe("Villa water supply maintenance");
    // scoped staff: project B notice is 404, company-wide and project A notices are listed, creating for project B is 404
    expect((await t.request("GET", `/api/v1/notices/${n.id}`, { token: scopedMarketing.access_token })).status).toBe(
      404,
    );
    expect(
      (await t.request("GET", `/api/v1/notices?project_id=${projectB}`, { token: scopedMarketing.access_token }))
        .status,
    ).toBe(404);
    expect(
      (
        await t.request("POST", "/api/v1/notices", {
          token: scopedMarketing.access_token,
          body: { project_id: projectB, title: "Foreign project", body_md: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.request("PATCH", `/api/v1/notices/${n.id}`, {
          token: scopedMarketing.access_token,
          body: { version: del.body.version, title: "Foreign" },
        })
      ).status,
    ).toBe(404);
    const scopedList = await t.request<List<Notice>>("GET", "/api/v1/notices?page_size=100", {
      token: scopedMarketing.access_token,
    });
    expect(scopedList.status).toBe(200);
    expect(scopedList.body.items.some((x) => x.project_id === null)).toBe(true);
    expect(scopedList.body.items.some((x) => x.project_id === projectB)).toBe(false);
    const csv = await t.request("GET", "/api/v1/notices?format=csv", { token: admin.access_token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text).toContain("Diwali holiday schedule");
  });
});
