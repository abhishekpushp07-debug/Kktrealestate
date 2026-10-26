import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear, todayIST } from "@kkt/domain";
import { createProject } from "./fixtures.js";
import { createActiveBooking, invalidAadhaar, validAadhaar } from "./fixtures/crm.js";
import { buildTestApp, type ErrorBody, type LoginResult, type TestContext } from "./helpers.js";

process.env["KKT_MODULES"] ??= "crm";

let t: TestContext;
let admin: LoginResult;
let salesA: LoginResult;
let salesB: LoginResult;
let scoped: LoginResult;
let projectA: string;
let projectB: string;
const FY = financialYear(todayIST(), 4).label;

type Lead = {
  id: string;
  version: number;
  lead_number: string;
  stage: string;
  previous_stage: string | null;
  assigned_user_id: string | null;
  lost_reason: string | null;
  customer_id: string | null;
  is_read: boolean;
  phone: string;
  project_id: string | null;
};
type Customer = Record<string, unknown> & {
  id: string;
  version: number;
  customer_code: string;
  phone: string;
  pan_masked: string | null;
  aadhaar_masked: string | null;
  bank_account_masked: string | null;
  kyc_status: string;
  is_active: boolean;
  co_applicants: unknown[];
  portal_enabled: boolean;
};
type PortalCard = {
  customer_id: string;
  is_enabled: boolean;
  must_change_password: boolean;
  temp_password: string | null;
  login_url: string | null;
  active_sessions: number;
  last_login_at: string | null;
};

const PAN = "ABCDE1234F";
const AADHAAR = validAadhaar("23456789012");

function customerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: "Rajesh Kumar Sinha",
    phone: "+91 98765 00001",
    email: "rajesh@example.com",
    gender: "MALE",
    address_current: { line1: "12 Boring Road", city: "Patna", state: "Bihar", pincode: "800001" },
    pan: PAN,
    aadhaar: AADHAAR,
    bank: {
      bank_name: "HDFC Bank",
      ifsc: "hdfc0000123",
      holder_name: "Rajesh Kumar Sinha",
      account_number: "50100123456789",
    },
    nominee: { name: "Sunita Sinha", relation: "Wife" },
    tags: ["vip"],
    ...overrides,
  };
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = await t.loginAs("admin");
  salesA = await t.loginAs("sales");
  scoped = await t.loginAs("projects");
  projectA = await createProject(t, "Shree Ganesh Heights", "SGH");
  projectB = await createProject(t, "Ganesh Green Villas", "GGV");
  // second active Sales user for the round robin
  const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", {
    token: admin.access_token,
  });
  const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
  const created = await t.request<{ id: string }>("POST", "/api/v1/users", {
    token: admin.access_token,
    body: {
      name: "Bela Sales",
      email: "sales2@sgb.in",
      password: "Sales2@12345",
      role_id: salesRole.id,
      all_projects: true,
      project_ids: [],
      must_change_password: false,
    },
  });
  expect(created.status, created.text).toBe(201);
  salesB = await t.login("sales2@sgb.in", "Sales2@12345");
});
afterAll(async () => {
  await t?.close();
});

async function countRows(table: string, where = "true"): Promise<number> {
  const rows = await t.app.sql.unsafe<{ n: string }[]>(`select count(*)::int as n from ${table} where ${where}`);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
const leadIds: string[] = [];

describe("leads: pipeline, round robin, follow-ups, board, convert", () => {
  it("creates leads with LD- numbers and rotates assignment A, B, A over the two active Sales users", async () => {
    const assigned: (string | null)[] = [];
    for (const [i, phone] of ["9811100001", "9811100002", "9811100003"].entries()) {
      const r = await t.request<Lead>("POST", "/api/v1/leads", {
        token: admin.access_token,
        body: {
          full_name: `Lead ${i + 1}`,
          phone,
          source: "WALK_IN",
          project_id: projectA,
          consent: true,
          utm: { source: "google", medium: null },
        },
        headers: { "idempotency-key": `lead-${i}` },
      });
      expect(r.status, r.text).toBe(201);
      expect(r.body.lead_number).toBe(`LD-${FY}/${String(i + 1).padStart(4, "0")}`);
      expect(r.body.stage).toBe("NEW");
      expect(r.body.version).toBe(1);
      leadIds.push(r.body.id);
      assigned.push(r.body.assigned_user_id);
    }
    expect(assigned).toEqual([salesA.user.id, salesB.user.id, salesA.user.id]);
    // explicit assignee wins over the rotation
    const manual = await t.request<Lead>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: { full_name: "Lead 4", phone: "9811100004", source: "REFERRAL", assigned_user_id: salesB.user.id },
    });
    expect(manual.status, manual.text).toBe(201);
    expect(manual.body.assigned_user_id).toBe(salesB.user.id);
    leadIds.push(manual.body.id);
    // idempotent replay returns the stored response and creates nothing
    const replay = await t.request<Lead>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: {
        full_name: "Lead 1",
        phone: "9811100001",
        source: "WALK_IN",
        project_id: projectA,
        consent: true,
        utm: { source: "google", medium: null },
      },
      headers: { "idempotency-key": "lead-0" },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.id).toBe(leadIds[0]);
    expect(await countRows("leads")).toBe(4);
  });

  it("moves along the pipeline; LOST needs a reason (422); CONVERTED only via /convert; history + activities recorded", async () => {
    const id = leadIds[1]!;
    const contacted = await t.request<Lead>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 1, stage: "CONTACTED" },
    });
    expect(contacted.status, contacted.text).toBe(200);
    expect(contacted.body.stage).toBe("CONTACTED");
    expect(contacted.body.previous_stage).toBe("NEW");
    expect(contacted.body.version).toBe(2);
    const stale = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 1, stage: "NEGOTIATION" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const noReason = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 2, stage: "LOST" },
    });
    expect(noReason.status, noReason.text).toBe(422);
    expect(noReason.body.error.code).toBe("BUSINESS_RULE");
    expect(noReason.body.error.details?.["rule"]).toBe("LOST_REASON_REQUIRED");
    const viaConvertOnly = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 2, stage: "CONVERTED" },
    });
    expect(viaConvertOnly.status).toBe(422);
    expect(viaConvertOnly.body.error.details?.["rule"]).toBe("USE_CONVERT");
    const lost = await t.request<Lead>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 2, stage: "LOST", reason: "Budget mismatch" },
    });
    expect(lost.status, lost.text).toBe(200);
    expect(lost.body.stage).toBe("LOST");
    expect(lost.body.lost_reason).toBe("Budget mismatch");
    const detail = await t.request<
      Lead & {
        stage_history: { from_stage: string | null; to_stage: string; reason: string | null }[];
        activities: { type: string }[];
        follow_ups: unknown[];
      }
    >("GET", `/api/v1/leads/${id}`, { token: salesA.access_token });
    expect(detail.status).toBe(200);
    expect(detail.body.stage_history.map((h) => h.to_stage)).toEqual(["LOST", "CONTACTED", "NEW"]);
    expect(detail.body.stage_history[0]!.reason).toBe("Budget mismatch");
    expect(detail.body.activities.map((a) => a.type)).toContain("STAGE_CHANGED");
    expect(detail.body.activities.map((a) => a.type)).toContain("CREATED");
    expect(detail.body.activities.map((a) => a.type)).toContain("ASSIGNED");
    const closed = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 3, stage: "NEGOTIATION" },
    });
    expect(closed.status).toBe(422);
    expect(closed.body.error.details?.["rule"]).toBe("LEAD_CLOSED");
    // service: revertLeadStage goes back to previous_stage; LOST leads are left alone
    const { revertLeadStage, setLeadStage } = await import("../../src/modules/crm/index.js");
    const l0 = leadIds[0]!;
    await t.app.db.transaction(async (tx) => {
      const [row] = await t.app.sql<{ id: string }[]>`select id from leads where id = ${l0}`;
      expect(row).toBeTruthy();
      const lead = (
        await tx
          .select()
          .from((await import("@kkt/db")).leads)
          .where((await import("drizzle-orm")).eq((await import("@kkt/db")).leads.id, l0))
      )[0]!;
      await setLeadStage(tx, lead, "SITE_VISIT_SCHEDULED", { reason: "visit booked" });
      const reverted = await revertLeadStage(tx, l0, "visit cancelled");
      expect(reverted?.stage).toBe("NEW");
      expect(reverted?.previousStage).toBe("SITE_VISIT_SCHEDULED");
      expect(await revertLeadStage(tx, id, "noop on lost")).toMatchObject({ stage: "LOST" });
    });
  });

  it("createOrTouchLead dedupes on phone + project (open lead) by appending an activity; closed or other-project leads get a new lead", async () => {
    const { createOrTouchLead, findOpenLeadByPhone } = await import("../../src/modules/crm/index.js");
    const before = await countRows("leads");
    const touched = await t.app.db.transaction((tx) =>
      createOrTouchLead(tx, {
        companyId: t.companyId,
        phone: "+91 9811100001",
        name: "Lead One Again",
        projectId: projectA,
        source: "WEBSITE",
        message: "Call me",
        utm: { source: "fb" },
        activityType: "ENQUIRY",
        redis: t.app.redis,
      }),
    );
    expect(touched.created).toBe(false);
    expect(touched.lead.id).toBe(leadIds[0]);
    expect(touched.lead.isRead).toBe(false);
    expect(await countRows("leads")).toBe(before);
    expect(await countRows("lead_activities", `lead_id = '${leadIds[0]}' and type = 'ENQUIRY'`)).toBe(1);
    const other = await t.app.db.transaction((tx) =>
      createOrTouchLead(tx, {
        companyId: t.companyId,
        phone: "9811100001",
        name: "Lead One",
        projectId: projectB,
        source: "BROCHURE",
        activityType: "BROCHURE_DOWNLOADED",
        redis: t.app.redis,
      }),
    );
    expect(other.created).toBe(true);
    expect(other.lead.id).not.toBe(leadIds[0]);
    expect(other.lead.source).toBe("BROCHURE");
    expect(await countRows("leads")).toBe(before + 1);
    // the LOST lead (9811100002) is not "open": a new enquiry creates a fresh lead
    expect(await t.app.db.transaction((tx) => findOpenLeadByPhone(tx, t.companyId, "9811100002", projectA))).toBeNull();
    const fresh = await t.app.db.transaction((tx) =>
      createOrTouchLead(tx, {
        companyId: t.companyId,
        phone: "9811100002",
        name: "Lead Two",
        projectId: projectA,
        source: "WEBSITE",
        activityType: "ENQUIRY",
        redis: t.app.redis,
      }),
    );
    expect(fresh.created).toBe(true);
    expect(
      await t.app.db.transaction((tx) => findOpenLeadByPhone(tx, t.companyId, "98111 00001", projectA)),
    ).toMatchObject({ id: leadIds[0] });
    const bad = await t.app.db
      .transaction((tx) =>
        createOrTouchLead(tx, {
          companyId: t.companyId,
          phone: "12345",
          name: "x",
          source: "WEBSITE",
          activityType: "ENQUIRY",
        }),
      )
      .catch((e: unknown) => e);
    expect((bad as { statusCode: number }).statusCode).toBe(400);
  });

  it("follow-ups: records a note, schedules next_at and shows up in my due list; board groups by stage with counts", async () => {
    const id = leadIds[2]!; // assigned to Sales A
    const now = new Date().toISOString();
    const f = await t.request<{ id: string; lead_id: string; next_at: string | null; by_user_name: string }>(
      "POST",
      `/api/v1/leads/${id}/follow-ups`,
      { token: salesA.access_token, body: { note: "Called, wants a site visit", next_at: now } },
    );
    expect(f.status, f.text).toBe(201);
    expect(f.body.by_user_name).toBe("Ankit Verma");
    const mine = await t.request<{ items: Lead[]; total: number; overdue: number; date: string }>(
      "GET",
      "/api/v1/leads/follow-ups/due",
      { token: salesA.access_token },
    );
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.items.map((l) => l.id)).toContain(id);
    expect(mine.body.date).toBe(todayIST());
    const notMine = await t.request<{ items: Lead[] }>("GET", "/api/v1/leads/follow-ups/due", {
      token: salesB.access_token,
    });
    expect(notMine.body.items.map((l) => l.id)).not.toContain(id);
    const all = await t.request<{ items: Lead[] }>("GET", "/api/v1/leads/follow-ups/due?all=true", {
      token: admin.access_token,
    });
    expect(all.body.items.map((l) => l.id)).toContain(id);
    const listDue = await t.request<{ items: Lead[] }>("GET", "/api/v1/leads?follow_up_due=true", {
      token: admin.access_token,
    });
    expect(listDue.body.items.map((l) => l.id)).toContain(id);
    const board = await t.request<{ columns: { stage: string; count: number; leads: Lead[] }[] }>(
      "GET",
      "/api/v1/leads/board",
      { token: admin.access_token },
    );
    expect(board.status, board.text).toBe(200);
    expect(board.body.columns.map((c) => c.stage)).toEqual([
      "NEW",
      "CONTACTED",
      "SITE_VISIT_SCHEDULED",
      "SITE_VISIT_DONE",
      "NEGOTIATION",
      "CONVERTED",
      "LOST",
    ]);
    const total = await countRows("leads");
    expect(board.body.columns.reduce((s, c) => s + c.count, 0)).toBe(total);
    expect(board.body.columns.find((c) => c.stage === "LOST")!.leads.map((l) => l.id)).toContain(leadIds[1]);
    expect(board.body.columns.every((c) => c.leads.length === c.count)).toBe(true);
    const list = await t.request<{ items: Lead[]; total: number }>(
      "GET",
      `/api/v1/leads?stage=LOST&search=${encodeURIComponent("Lead 2")}`,
      { token: admin.access_token },
    );
    expect(list.body.total).toBe(1);
    const csv = await t.request("GET", "/api/v1/leads?format=csv", { token: admin.access_token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
  });

  it("assigns, updates (version) and converts a lead into a new customer numbered CUST-<fy>/0001", async () => {
    const id = leadIds[3]!;
    const assign = await t.request<Lead>("POST", `/api/v1/leads/${id}/assign`, {
      token: admin.access_token,
      body: { version: 1, assigned_user_id: salesA.user.id },
    });
    expect(assign.status, assign.text).toBe(200);
    expect(assign.body.assigned_user_id).toBe(salesA.user.id);
    const patched = await t.request<Lead>("PATCH", `/api/v1/leads/${id}`, {
      token: salesA.access_token,
      body: { budget_min_paise: 500000000, budget_max_paise: 700000000 },
      headers: { "if-match": '"2"' },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.version).toBe(3);
    const badBudget = await t.request<ErrorBody>("PATCH", `/api/v1/leads/${id}`, {
      token: salesA.access_token,
      body: { version: 3, budget_min_paise: 900000000 },
    });
    expect(badBudget.status).toBe(400);
    const convert = await t.request<{
      lead: Lead;
      customer_id: string;
      customer_code: string;
      booking_draft_id: string | null;
    }>("POST", `/api/v1/leads/${id}/convert`, {
      token: salesA.access_token,
      body: {
        version: 3,
        customer: { full_name: "Kavita Roy", phone: "9811100004", email: "kavita@example.com", pan: "KAVIT1234R" },
      },
    });
    expect(convert.status, convert.text).toBe(200);
    expect(convert.body.customer_code).toBe(`CUST-${FY}/0001`);
    expect(convert.body.lead.stage).toBe("CONVERTED");
    expect(convert.body.lead.customer_id).toBe(convert.body.customer_id);
    const customer = await t.request<Customer & { relationship_manager_id: string | null; source: string }>(
      "GET",
      `/api/v1/customers/${convert.body.customer_id}`,
      { token: salesA.access_token },
    );
    expect(customer.status).toBe(200);
    expect(customer.body.pan_masked).toBe("XXXXX1234R");
    expect(customer.body.relationship_manager_id).toBe(salesA.user.id);
    expect(customer.body.source).toBe("REFERRAL");
    // converting twice is idempotent for the same customer; any other target is a closed-lead violation
    const again = await t.request<{ customer_id: string; lead: Lead }>("POST", `/api/v1/leads/${id}/convert`, {
      token: salesA.access_token,
      body: { version: 4, customer_id: convert.body.customer_id },
    });
    expect(again.status, again.text).toBe(200);
    expect(again.body.customer_id).toBe(convert.body.customer_id);
    expect(again.body.lead.stage).toBe("CONVERTED");
    const other = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/convert`, {
      token: salesA.access_token,
      body: { version: 4, customer: { full_name: "Other", phone: "9811109999" } },
    });
    expect(other.status).toBe(422);
    expect(other.body.error.details?.["rule"]).toBe("LEAD_CLOSED");
    // converting another lead by linking the existing customer
    const l2 = await t.request<Lead>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: { full_name: "Kavita Roy", phone: "9811100004", source: "WALK_IN", project_id: projectB },
    });
    const linked = await t.request<{ customer_id: string }>("POST", `/api/v1/leads/${l2.body.id}/convert`, {
      token: salesA.access_token,
      body: { version: 1, customer_id: convert.body.customer_id },
    });
    expect(linked.status, linked.text).toBe(200);
    expect(linked.body.customer_id).toBe(convert.body.customer_id);
    const linkedCustomer = await t.request<{ customer_id: string | null }>(
      "GET",
      `/api/v1/leads/${l2.body.id}/customer`,
      { token: salesA.access_token },
    );
    expect(linkedCustomer.body.customer_id).toBe(convert.body.customer_id);
  });
});

// ---------------------------------------------------------------------------
// Enquiries inbox
// ---------------------------------------------------------------------------
describe("enquiries inbox", () => {
  it("createEnquiry creates the lead (dedupe applies), inserts the inbox row with an ENQ reference and notifies; list/unread/read work", async () => {
    const { createEnquiry } = await import("../../src/modules/crm/index.js");
    const leadsBefore = await countRows("leads");
    const first = await t.app.db.transaction((tx) =>
      createEnquiry(tx, {
        companyId: t.companyId,
        name: "Web Visitor",
        phone: "9822200001",
        email: "web@example.com",
        projectId: projectA,
        message: "Interested in 3BHK",
        sourcePage: "/projects/shree-ganesh-heights",
        utm: { source: "google", campaign: "diwali", medium: null },
        ip: "10.0.0.1",
        redis: t.app.redis,
      }),
    );
    expect(first.created).toBe(true);
    expect(first.enquiry.referenceNumber).toMatch(new RegExp(`^ENQ-${FY}/\\d{4}$`));
    expect(first.lead.source).toBe("WEBSITE");
    expect(first.lead.utm).toEqual({ source: "google", campaign: "diwali" });
    const second = await t.app.db.transaction((tx) =>
      createEnquiry(tx, {
        companyId: t.companyId,
        name: "Web Visitor",
        phone: "9822200001",
        projectId: projectA,
        message: "Again",
        redis: t.app.redis,
      }),
    );
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(await countRows("leads")).toBe(leadsBefore + 1);
    expect(await countRows("enquiries")).toBe(2);
    expect(await countRows("notifications", "type = 'ENQUIRY_NEW'")).toBeGreaterThan(0);
    const marketing = await t.loginAs("marketing");
    const list = await t.request<{
      items: {
        id: string;
        lead_number: string | null;
        project_name: string | null;
        reference_number: string;
        is_read: boolean;
        utm: Record<string, string> | null;
      }[];
      total: number;
    }>("GET", "/api/v1/enquiries", { token: marketing.access_token });
    expect(list.status, list.text).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items[0]!.lead_number).toBe(first.lead.leadNumber);
    expect(list.body.items[0]!.project_name).toBe("Shree Ganesh Heights");
    expect(list.body.items.every((i) => !i.is_read)).toBe(true);
    const unread = await t.request<{ unread: number }>("GET", "/api/v1/enquiries/unread-count", {
      token: marketing.access_token,
    });
    expect(unread.body.unread).toBe(2);
    const read = await t.request<{ is_read: boolean }>("POST", `/api/v1/enquiries/${first.enquiry.id}/read`, {
      token: marketing.access_token,
      body: {},
    });
    expect(read.status, read.text).toBe(200);
    expect(read.body.is_read).toBe(true);
    expect(
      (await t.request<{ unread: number }>("GET", "/api/v1/enquiries/unread-count", { token: marketing.access_token }))
        .body.unread,
    ).toBe(1);
    const bulk = await t.request<{ updated: number }>("POST", "/api/v1/enquiries/mark-read", {
      token: marketing.access_token,
      body: { ids: [first.enquiry.id, second.enquiry.id] },
    });
    expect(bulk.body.updated).toBe(1);
    const filtered = await t.request<{ total: number }>(
      "GET",
      `/api/v1/enquiries?is_read=false&project_id=${projectA}`,
      { token: admin.access_token },
    );
    expect(filtered.body.total).toBe(0);
    const one = await t.request<{ reference_number: string }>("GET", `/api/v1/enquiries/${second.enquiry.id}`, {
      token: admin.access_token,
    });
    expect(one.body.reference_number).toBe(second.enquiry.referenceNumber);
    // Accounts has no lead.read
    const accounts = await t.loginAs("accounts");
    expect((await t.request("GET", "/api/v1/enquiries", { token: accounts.access_token })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Customers & KYC
// ---------------------------------------------------------------------------
let customerId = "";

describe("customers: KYC encryption, masking, audited reveal, duplicates, versions", () => {
  it("creates a customer: canonical phone, PAN upper-cased, encrypted at rest, masked in responses", async () => {
    const r = await t.request<
      Customer & {
        bank: { bank_account_masked: string; ifsc: string } | null;
        tags: string[];
        nominee: { name: string } | null;
        address_permanent: unknown;
        same_as_current: boolean;
      }
    >("POST", "/api/v1/customers", { token: salesA.access_token, body: customerBody({ pan: "abcde1234f" }) });
    expect(r.status, r.text).toBe(201);
    customerId = r.body.id;
    expect(r.body.customer_code).toBe(`CUST-${FY}/0002`);
    expect(r.body.phone).toBe("9876500001");
    expect(r.body.pan_masked).toBe("XXXXX1234F");
    expect(r.body.aadhaar_masked).toBe(`XXXX XXXX ${AADHAAR.slice(-4)}`);
    expect(r.body.bank_account_masked).toBe("XXXXXXXXXX6789");
    expect(r.body.bank?.bank_account_masked).toBe("XXXXXXXXXX6789");
    expect(r.body.bank?.ifsc).toBe("HDFC0000123");
    expect(r.body.kyc_status).toBe("PENDING");
    expect(r.body.version).toBe(1);
    expect(r.body.tags).toEqual(["vip"]);
    expect(r.body.same_as_current).toBe(true);
    expect(r.body.address_permanent).toEqual(customerBody()["address_current"]);
    expect(r.body).not.toHaveProperty("pan");
    expect(r.body).not.toHaveProperty("aadhaar");
    expect(JSON.stringify(r.body)).not.toContain(PAN);
    expect(JSON.stringify(r.body)).not.toContain(AADHAAR);
    // encrypted at rest: ciphertext, keyed hash and last-4 only
    const [row] = await t.app.sql<
      {
        pan_enc: string;
        pan_hash: string;
        pan_last4: string;
        aadhaar_enc: string;
        aadhaar_hash: string;
        bank: { account_enc: string; account_last4: string };
      }[]
    >`select pan_enc, pan_hash, pan_last4, aadhaar_enc, aadhaar_hash, bank from customers where id = ${customerId}`;
    expect(row!.pan_enc).not.toBe(PAN);
    expect(row!.pan_enc.startsWith("k1.")).toBe(true);
    expect(row!.pan_enc).not.toContain(PAN);
    expect(row!.pan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.pan_last4).toBe("234F");
    expect(row!.aadhaar_enc).not.toContain(AADHAAR);
    expect(row!.aadhaar_enc.startsWith("k1.")).toBe(true);
    expect(row!.aadhaar_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.bank.account_enc).not.toContain("50100123456789");
    expect(row!.bank.account_last4).toBe("6789");
    const text = JSON.stringify(row);
    expect(text).not.toContain(PAN);
    expect(text).not.toContain(AADHAAR);
    // audit row never carries the ciphertext or plain values
    const audits = await t.app.sql<
      { after: Record<string, unknown> }[]
    >`select after from audit_logs where action = 'customer.create' and entity_id = ${customerId}`;
    expect(audits).toHaveLength(1);
    const auditText = JSON.stringify(audits[0]!.after);
    expect(auditText).not.toContain(PAN);
    expect(auditText).not.toContain("k1.");
    expect(audits[0]!.after["pan_masked"]).toBe("XXXXX1234F");
  });

  it("GET returns masked values; ?reveal=true needs customer.kyc_view, returns real values and writes a customer.kyc_reveal audit row; Sales gets 403", async () => {
    const masked = await t.request<Customer>("GET", `/api/v1/customers/${customerId}`, { token: admin.access_token });
    expect(masked.status).toBe(200);
    expect(masked.body.pan_masked).toBe("XXXXX1234F");
    expect(masked.body).not.toHaveProperty("pan");
    const revealed = await t.request<
      Customer & {
        pan: string;
        aadhaar: string;
        bank_account_number: string;
        revealed_at: string;
        co_applicants_revealed: unknown[];
      }
    >("GET", `/api/v1/customers/${customerId}?reveal=true`, { token: admin.access_token });
    expect(revealed.status, revealed.text).toBe(200);
    expect(revealed.body.pan).toBe(PAN);
    expect(revealed.body.aadhaar).toBe(AADHAAR);
    expect(revealed.body.bank_account_number).toBe("50100123456789");
    expect(revealed.body.pan_masked).toBe("XXXXX1234F");
    expect(revealed.body.revealed_at).toBeTruthy();
    const audits = await t.app.sql<
      { actor_name: string; after: Record<string, unknown> }[]
    >`select actor_name, after from audit_logs where action = 'customer.kyc_reveal' and entity_id = ${customerId}`;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_name).toBe("Suresh Agarwal");
    expect(audits[0]!.after["fields"]).toContain("pan");
    // Sales: masked view ok, reveal forbidden (and not audited as a reveal)
    const salesMasked = await t.request<Customer>("GET", `/api/v1/customers/${customerId}`, {
      token: salesA.access_token,
    });
    expect(salesMasked.status).toBe(200);
    expect(salesMasked.body.pan_masked).toBe("XXXXX1234F");
    expect(JSON.stringify(salesMasked.body)).not.toContain(PAN);
    const salesReveal = await t.request<ErrorBody>("GET", `/api/v1/customers/${customerId}?reveal=true`, {
      token: salesA.access_token,
    });
    expect(salesReveal.status).toBe(403);
    expect(salesReveal.body.error.code).toBe("FORBIDDEN");
    expect(salesReveal.body.error.details?.["permission"]).toBe("customer.kyc_view");
    expect(await countRows("audit_logs", `action = 'customer.kyc_reveal' and entity_id = '${customerId}'`)).toBe(1);
    // the list never carries unmasked values either
    const list = await t.request<{ items: Customer[]; total: number }>("GET", "/api/v1/customers?search=9876500001", {
      token: salesA.access_token,
    });
    expect(list.body.total).toBe(1);
    expect(JSON.stringify(list.body)).not.toContain(PAN);
    expect(list.body.items[0]!.pan_masked).toBe("XXXXX1234F");
  });

  it("rejects duplicates by phone and by PAN hash with 409 DUPLICATE_CUSTOMER and details.existing", async () => {
    const samePhone = await t.request<ErrorBody>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ full_name: "Someone Else", phone: "09876500001", pan: null, aadhaar: null, bank: null }),
    });
    expect(samePhone.status, samePhone.text).toBe(409);
    expect(samePhone.body.error.code).toBe("DUPLICATE_CUSTOMER");
    expect(samePhone.body.error.details?.["existing"]).toMatchObject({
      id: customerId,
      customer_code: `CUST-${FY}/0002`,
      matched_on: "PHONE",
    });
    const samePan = await t.request<ErrorBody>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({
        full_name: "Someone Else",
        phone: "9876500099",
        pan: " abcde1234f ",
        aadhaar: null,
        bank: null,
      }),
    });
    expect(samePan.status, samePan.text).toBe(409);
    expect(samePan.body.error.code).toBe("DUPLICATE_CUSTOMER");
    expect(samePan.body.error.details?.["existing"]).toMatchObject({ id: customerId, matched_on: "PAN" });
    const check = await t.request<{ matches: { customer_id: string; matched_on: string }[] }>(
      "POST",
      "/api/v1/customers/duplicate-check",
      { token: salesA.access_token, body: { pan: PAN } },
    );
    expect(check.body.matches).toEqual([
      {
        customer_id: customerId,
        customer_code: `CUST-${FY}/0002`,
        full_name: "Rajesh Kumar Sinha",
        phone: "9876500001",
        matched_on: "PAN",
      },
    ]);
    expect(await countRows("customers")).toBe(2);
  });

  it("rejects an Aadhaar that fails the Verhoeff checksum (400 VALIDATION_ERROR), a bad PAN and a bad phone", async () => {
    const bad = await t.request<ErrorBody>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ phone: "9876500002", pan: null, bank: null, aadhaar: invalidAadhaar() }),
    });
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(bad.body.error.details?.["issues"])).toContain("aadhaar");
    const badPan = await t.request<ErrorBody>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ phone: "9876500002", pan: "ABC1234", aadhaar: null, bank: null }),
    });
    expect(badPan.status).toBe(400);
    const badPhone = await t.request<ErrorBody>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ phone: "12345", pan: null, aadhaar: null, bank: null }),
    });
    expect(badPhone.status).toBe(400);
    const badIfsc = await t.request<ErrorBody>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({
        phone: "9876500002",
        pan: null,
        aadhaar: null,
        bank: { bank_name: "X", ifsc: "HDFC1234567", holder_name: "Y", account_number: "123456789" },
      }),
    });
    expect(badIfsc.status).toBe(400);
    expect(await countRows("customers")).toBe(2);
  });

  it("PATCH honours version/If-Match, re-encrypts changed identifiers; KYC status records the verifier", async () => {
    const patched = await t.request<Customer & { occupation: string | null }>(
      "PATCH",
      `/api/v1/customers/${customerId}`,
      { token: salesA.access_token, body: { version: 1, occupation: "Doctor", aadhaar: validAadhaar("34567890123") } },
    );
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.version).toBe(2);
    expect(patched.body.occupation).toBe("Doctor");
    expect(patched.body.aadhaar_masked).toBe(`XXXX XXXX ${validAadhaar("34567890123").slice(-4)}`);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/customers/${customerId}`, {
      token: salesA.access_token,
      body: { version: 1, occupation: "Engineer" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(2);
    expect(stale.body.error.details?.["changed_by"]).toBe("Ankit Verma");
    const noVersion = await t.request<ErrorBody>("PATCH", `/api/v1/customers/${customerId}`, {
      token: salesA.access_token,
      body: { occupation: "Engineer" },
    });
    expect(noVersion.status).toBe(400);
    const viaHeader = await t.request<Customer>("PATCH", `/api/v1/customers/${customerId}`, {
      token: salesA.access_token,
      body: { notes: "Prefers evening calls" },
      headers: { "if-match": '"2"' },
    });
    expect(viaHeader.status, viaHeader.text).toBe(200);
    expect(viaHeader.body.version).toBe(3);
    const rejectedNoRemarks = await t.request<ErrorBody>("POST", `/api/v1/customers/${customerId}/kyc`, {
      token: admin.access_token,
      body: { version: 3, kyc_status: "REJECTED" },
    });
    expect(rejectedNoRemarks.status).toBe(400);
    // SUBMITTED needs PAN + Aadhaar (present) and a KYC document on file
    const incomplete = await t.request<ErrorBody>("POST", `/api/v1/customers/${customerId}/kyc`, {
      token: salesA.access_token,
      body: { version: 3, kyc_status: "SUBMITTED" },
    });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe("KYC_INCOMPLETE");
    expect(incomplete.body.error.details?.["missing"]).toEqual(["kyc_document"]);
    await t.app
      .sql`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, uploaded_by, is_sensitive)
      values (${t.companyId}, 'CUSTOMER', ${customerId}, 'pan.jpg', 'image/jpeg', 100, 'sha-kyc', 'k/pan.jpg', 'STAFF', ${salesA.user.id}, true)`;
    const submitted = await t.request<Customer & { kyc_verified_by: string | null; kyc_submitted_by: string | null }>(
      "POST",
      `/api/v1/customers/${customerId}/kyc`,
      { token: salesA.access_token, body: { version: 3, kyc_status: "SUBMITTED" } },
    );
    expect(submitted.status, submitted.text).toBe(200);
    expect(submitted.body.kyc_status).toBe("SUBMITTED");
    expect(submitted.body.kyc_submitted_by).toBe(salesA.user.id);
    expect(submitted.body.kyc_verified_by).toBeNull();
    const verified = await t.request<
      Customer & { kyc_verified_by: string | null; kyc_verified_by_name: string | null; kyc_verified_at: string | null }
    >("POST", `/api/v1/customers/${customerId}/kyc`, {
      token: admin.access_token,
      body: { version: 4, kyc_status: "VERIFIED", kyc_remarks: "Documents checked" },
    });
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body.kyc_status).toBe("VERIFIED");
    expect(verified.body.kyc_verified_by).toBe(admin.user.id);
    expect(verified.body.kyc_verified_by_name).toBe("Suresh Agarwal");
    expect(verified.body.kyc_verified_at).toBeTruthy();
    expect(verified.body.version).toBe(5);
    const byStatus = await t.request<{ items: Customer[]; total: number }>(
      "GET",
      "/api/v1/customers?kyc_status=VERIFIED",
      { token: admin.access_token },
    );
    expect(byStatus.body.items.map((c) => c.id)).toEqual([customerId]);
    const byRm = await t.request<{ total: number }>(
      "GET",
      `/api/v1/customers?relationship_manager_id=${salesA.user.id}&tag=vip`,
      { token: admin.access_token },
    );
    expect(byRm.body.total).toBe(0);
    const byTag = await t.request<{ total: number }>("GET", "/api/v1/customers?tag=vip", { token: admin.access_token });
    expect(byTag.body.total).toBe(1);
    const csv = await t.request("GET", "/api/v1/customers?format=csv", { token: admin.access_token });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("pan_masked");
    expect(csv.text).not.toContain(PAN);
  });

  it("co-applicants CRUD under /customers/:id/co-applicants with encrypted PAN/Aadhaar", async () => {
    const add = await t.request<{
      id: string;
      pan_masked: string | null;
      aadhaar_masked: string | null;
      relation: string;
      sort_order: number;
    }>("POST", `/api/v1/customers/${customerId}/co-applicants`, {
      token: salesA.access_token,
      body: {
        full_name: "Sunita Sinha",
        relation: "Wife",
        phone: "98765 00050",
        pan: "sunit5678a",
        aadhaar: validAadhaar("45678901234"),
      },
    });
    expect(add.status, add.text).toBe(201);
    expect(add.body.pan_masked).toBe("XXXXX5678A");
    expect(add.body.aadhaar_masked).toBe(`XXXX XXXX ${validAadhaar("45678901234").slice(-4)}`);
    expect(add.body.sort_order).toBe(0);
    const [row] = await t.app.sql<
      { pan_enc: string; phone: string }[]
    >`select pan_enc, phone from co_applicants where id = ${add.body.id}`;
    expect(row!.pan_enc.startsWith("k1.")).toBe(true);
    expect(row!.pan_enc).not.toContain("SUNIT5678A");
    expect(row!.phone).toBe("9876500050");
    const badCa = await t.request<ErrorBody>("POST", `/api/v1/customers/${customerId}/co-applicants`, {
      token: salesA.access_token,
      body: { full_name: "Bad", relation: "Son", aadhaar: invalidAadhaar("45678901234") },
    });
    expect(badCa.status).toBe(400);
    const list = await t.request<{ items: { id: string }[] }>("GET", `/api/v1/customers/${customerId}/co-applicants`, {
      token: salesA.access_token,
    });
    expect(list.body.items.map((i) => i.id)).toEqual([add.body.id]);
    const customer = await t.request<Customer>("GET", `/api/v1/customers/${customerId}`, {
      token: salesA.access_token,
    });
    expect(customer.body.co_applicants).toHaveLength(1);
    const revealed = await t.request<{ co_applicants_revealed: { pan: string | null }[] }>(
      "GET",
      `/api/v1/customers/${customerId}?reveal=true`,
      { token: admin.access_token },
    );
    expect(revealed.body.co_applicants_revealed[0]!.pan).toBe("SUNIT5678A");
    // version is required (body or If-Match); a stale one is a 409 VERSION_CONFLICT
    const noVersion = await t.request<ErrorBody>(
      "PATCH",
      `/api/v1/customers/${customerId}/co-applicants/${add.body.id}`,
      { token: salesA.access_token, body: { relation: "Spouse" } },
    );
    expect(noVersion.status).toBe(400);
    const upd = await t.request<{ relation: string; version: number }>(
      "PATCH",
      `/api/v1/customers/${customerId}/co-applicants/${add.body.id}`,
      { token: salesA.access_token, body: { relation: "Spouse", version: 1 } },
    );
    expect(upd.status, upd.text).toBe(200);
    expect(upd.body.relation).toBe("Spouse");
    expect(upd.body.version).toBe(2);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/customers/${customerId}/co-applicants/${add.body.id}`, {
      token: salesA.access_token,
      body: { relation: "Sister" },
      headers: { "if-match": '"1"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const viaHeader = await t.request<{ relation: string; version: number }>(
      "PATCH",
      `/api/v1/customers/${customerId}/co-applicants/${add.body.id}`,
      { token: salesA.access_token, body: { relation: "Wife" }, headers: { "if-match": '"2"' } },
    );
    expect(viaHeader.status, viaHeader.text).toBe(200);
    expect(viaHeader.body.version).toBe(3);
    const del = await t.request("DELETE", `/api/v1/customers/${customerId}/co-applicants/${add.body.id}`, {
      token: salesA.access_token,
    });
    expect(del.status).toBe(204);
    expect(
      (
        await t.request<{ items: unknown[] }>("GET", `/api/v1/customers/${customerId}/co-applicants`, {
          token: salesA.access_token,
        })
      ).body.items,
    ).toEqual([]);
    expect(
      (
        await t.request("DELETE", `/api/v1/customers/${customerId}/co-applicants/${add.body.id}`, {
          token: salesA.access_token,
        })
      ).status,
    ).toBe(404);
    expect(await countRows("audit_logs", `action like 'customer.co_applicant_%' and entity_id = '${customerId}'`)).toBe(
      4,
    ); // add, update ×2, remove
  });
});

// ---------------------------------------------------------------------------
// Portal access, bulk enable, deactivate, 360
// ---------------------------------------------------------------------------
describe("portal access card, bulk enable, deactivate, 360", () => {
  let c2 = "";
  let c3 = "";

  it("enable returns a temporary password exactly once with must_change_password; reset/revoke/disable; Sales lacks the permission", async () => {
    const denied = await t.request<ErrorBody>("POST", `/api/v1/customers/${customerId}/portal/enable`, {
      token: salesA.access_token,
      body: {},
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details?.["permission"]).toBe("customer.portal_manage");
    const enabled = await t.request<PortalCard>("POST", `/api/v1/customers/${customerId}/portal/enable`, {
      token: admin.access_token,
      body: {},
    });
    expect(enabled.status, enabled.text).toBe(200);
    expect(enabled.body.is_enabled).toBe(true);
    expect(enabled.body.must_change_password).toBe(true);
    expect(enabled.body.temp_password).toMatch(/^.{12}$/);
    expect(enabled.body.login_url).toMatch(/^https?:\/\//);
    const temp = enabled.body.temp_password!;
    const card = await t.request<PortalCard>("GET", `/api/v1/customers/${customerId}/portal`, {
      token: salesA.access_token,
    });
    expect(card.status).toBe(200);
    expect(card.body.temp_password).toBeNull(); // shown once only
    expect(card.body.is_enabled).toBe(true);
    expect(card.body.last_login_at).toBeNull();
    const [pu] = await t.app.sql<
      { must_change_password: boolean; password_hash: string }[]
    >`select must_change_password, password_hash from portal_users where customer_id = ${customerId}`;
    expect(pu!.must_change_password).toBe(true);
    expect(pu!.password_hash).not.toContain(temp);
    // the temporary password really logs the customer in (forced change flagged)
    const login = await t.request<{ access_token: string; user: { must_change_password: boolean } }>(
      "POST",
      "/api/v1/portal/auth/login",
      { body: { phone: "9876500001", password: temp } },
    );
    expect(login.status, login.text).toBe(200);
    expect(login.body.user.must_change_password).toBe(true);
    const afterLogin = await t.request<PortalCard>("GET", `/api/v1/customers/${customerId}/portal`, {
      token: admin.access_token,
    });
    expect(afterLogin.body.last_login_at).toBeTruthy();
    expect(afterLogin.body.active_sessions).toBe(1);
    const again = await t.request<ErrorBody>("POST", `/api/v1/customers/${customerId}/portal/enable`, {
      token: admin.access_token,
      body: {},
    });
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("PORTAL_ALREADY_ENABLED");
    const customerView = await t.request<Customer>("GET", `/api/v1/customers/${customerId}`, {
      token: admin.access_token,
    });
    expect(customerView.body.portal_enabled).toBe(true);
    // reset: new temp password once, old one dead, sessions revoked
    const reset = await t.request<PortalCard>("POST", `/api/v1/customers/${customerId}/portal/reset-password`, {
      token: admin.access_token,
      body: {},
    });
    expect(reset.status, reset.text).toBe(200);
    expect(reset.body.temp_password).toMatch(/^.{12}$/);
    expect(reset.body.temp_password).not.toBe(temp);
    expect(reset.body.active_sessions).toBe(0);
    expect(
      (await t.request("POST", "/api/v1/portal/auth/login", { body: { phone: "9876500001", password: temp } })).status,
    ).toBe(401);
    const login2 = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9876500001", password: reset.body.temp_password! },
    });
    expect(login2.status, login2.text).toBe(200);
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: login2.body.access_token })).status).toBe(200);
    const revoked = await t.request<PortalCard>("POST", `/api/v1/customers/${customerId}/portal/revoke-sessions`, {
      token: admin.access_token,
      body: {},
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.active_sessions).toBe(0);
    expect(
      (await t.request<ErrorBody>("GET", "/api/v1/portal/auth/me", { token: login2.body.access_token })).status,
    ).toBe(401);
    const disabled = await t.request<PortalCard>("POST", `/api/v1/customers/${customerId}/portal/disable`, {
      token: admin.access_token,
      body: {},
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.is_enabled).toBe(false);
    expect(
      (
        await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
          body: { phone: "9876500001", password: reset.body.temp_password! },
        })
      ).status,
    ).toBe(401);
    const resetDisabled = await t.request<ErrorBody>("POST", `/api/v1/customers/${customerId}/portal/reset-password`, {
      token: admin.access_token,
      body: {},
    });
    expect(resetDisabled.status).toBe(422);
    // generic action endpoint re-enables
    const reenabled = await t.request<PortalCard>("POST", `/api/v1/customers/${customerId}/portal`, {
      token: admin.access_token,
      body: { action: "ENABLE" },
    });
    expect(reenabled.status, reenabled.text).toBe(200);
    expect(reenabled.body.is_enabled).toBe(true);
    expect(reenabled.body.temp_password).toMatch(/^.{12}$/);
    const actions = await t.app.sql<
      { action: string }[]
    >`select action from audit_logs where entity_id = ${customerId} and action like 'customer.portal_%' order by created_at`;
    expect(actions.map((a) => a.action)).toEqual([
      "customer.portal_enable",
      "customer.portal_reset_password",
      "customer.portal_revoke_sessions",
      "customer.portal_disable",
      "customer.portal_reenable",
    ]);
  });

  it("bulk-enable covers every customer with an ACTIVE booking lacking portal access, counts only, no passwords", async () => {
    const r2 = await t.request<Customer>("POST", "/api/v1/customers", {
      token: admin.access_token,
      body: customerBody({
        full_name: "Priya Verma",
        phone: "9876500011",
        pan: null,
        aadhaar: null,
        bank: null,
        tags: [],
      }),
    });
    const r3 = await t.request<Customer>("POST", "/api/v1/customers", {
      token: admin.access_token,
      body: customerBody({
        full_name: "Amit Kumar",
        phone: "9876500012",
        pan: null,
        aadhaar: null,
        bank: null,
        tags: [],
      }),
    });
    const r4 = await t.request<Customer>("POST", "/api/v1/customers", {
      token: admin.access_token,
      body: customerBody({
        full_name: "No Booking",
        phone: "9876500013",
        pan: null,
        aadhaar: null,
        bank: null,
        tags: [],
      }),
    });
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(201);
    expect(r4.status).toBe(201);
    c2 = r2.body.id;
    c3 = r3.body.id;
    await createActiveBooking(t, c2, projectA);
    await createActiveBooking(t, c3, projectB, { coApplicantId: r4.body.id });
    const pre = await t.request<PortalCard>("POST", `/api/v1/customers/${c3}/portal/enable`, {
      token: admin.access_token,
      body: {},
    });
    expect(pre.status).toBe(200);
    const dry = await t.request<{ dry_run: boolean; enabled: number; already_enabled: number; credentials: unknown[] }>(
      "POST",
      "/api/v1/customers/portal/bulk-enable",
      { token: admin.access_token, body: { dry_run: true } },
    );
    expect(dry.status, dry.text).toBe(200);
    expect(dry.body).toEqual({ dry_run: true, enabled: 2, already_enabled: 1, credentials: [] }); // c2 (primary) + co-applicant r4; c3 already on
    const run = await t.request<{
      dry_run: boolean;
      enabled: number;
      already_enabled: number;
      credentials: { customer_id: string; temp_password: string }[];
    }>("POST", "/api/v1/customers/portal/bulk-enable", { token: admin.access_token, body: {} });
    expect(run.status, run.text).toBe(200);
    expect(run.body).toMatchObject({ dry_run: false, enabled: 2, already_enabled: 1 });
    // the temporary passwords are shown exactly once, here, and never reach the audit log
    expect(run.body.credentials.map((c) => c.customer_id).sort()).toEqual([c2, r4.body.id].sort());
    expect(run.body.credentials.every((c) => /^.{12}$/.test(c.temp_password))).toBe(true);
    const bulkAudit = await t.app.sql<
      { after: Record<string, unknown> }[]
    >`select after from audit_logs where action = 'customer.portal_bulk_enable'`;
    expect(bulkAudit).toHaveLength(1);
    for (const c of run.body.credentials) expect(JSON.stringify(bulkAudit[0]!.after)).not.toContain(c.temp_password);
    const card = await t.request<PortalCard>("GET", `/api/v1/customers/${c2}/portal`, { token: admin.access_token });
    expect(card.body.is_enabled).toBe(true);
    expect(card.body.must_change_password).toBe(true);
    expect(card.body.temp_password).toBeNull();
    const second = await t.request<{ enabled: number; already_enabled: number }>(
      "POST",
      "/api/v1/customers/portal/bulk-enable",
      { token: admin.access_token, body: {} },
    );
    expect(second.body).toMatchObject({ enabled: 0, already_enabled: 3 });
    const byProject = await t.request<{ enabled: number; already_enabled: number }>(
      "POST",
      "/api/v1/customers/portal/bulk-enable",
      { token: admin.access_token, body: { project_id: projectA, dry_run: true } },
    );
    expect(byProject.body).toMatchObject({ enabled: 0, already_enabled: 1 });
    const withBooking = await t.request<{ items: Customer[] }>("GET", `/api/v1/customers?project_id=${projectA}`, {
      token: admin.access_token,
    });
    expect(withBooking.body.items.map((c) => c.id)).toEqual([c2]);
    const active = await t.request<{ total: number }>("GET", "/api/v1/customers?has_active_booking=true", {
      token: admin.access_token,
    });
    expect(active.body.total).toBe(3);
  });

  it("deactivating a customer is refused while an ACTIVE booking exists (409 IN_USE) and allowed otherwise", async () => {
    const inUse = await t.request<ErrorBody>("POST", `/api/v1/customers/${c2}/deactivate`, {
      token: admin.access_token,
      body: {},
    });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe("IN_USE");
    expect(inUse.body.error.details?.["usage_count"]).toBe(1);
    const free = await t.request<Customer>("GET", `/api/v1/customers/${customerId}`, { token: admin.access_token });
    const deact = await t.request<{ is_active: boolean; version: number }>(
      "POST",
      `/api/v1/customers/${customerId}/deactivate`,
      { token: admin.access_token, body: { version: free.body.version } },
    );
    expect(deact.status, deact.text).toBe(200);
    expect(deact.body.is_active).toBe(false);
    // deactivation kills the portal session families
    expect(
      (
        await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
          body: { phone: "9876500001", password: "whatever" },
        })
      ).status,
    ).toBe(401);
    const hidden = await t.request<{ items: Customer[] }>("GET", "/api/v1/customers?page_size=100", {
      token: admin.access_token,
    });
    expect(hidden.body.items.map((c) => c.id)).not.toContain(customerId);
    const shown = await t.request<{ items: Customer[] }>(
      "GET",
      "/api/v1/customers?include_inactive=true&page_size=100",
      { token: admin.access_token },
    );
    expect(shown.body.items.map((c) => c.id)).toContain(customerId);
    const restored = await t.request<{ is_active: boolean }>("POST", `/api/v1/customers/${customerId}/activate`, {
      token: admin.access_token,
      body: {},
    });
    expect(restored.body.is_active).toBe(true);
  });

  it("GET /customers/:id/360 returns the profile (masked) plus bookings, payments, documents, leads, tickets and the portal card", async () => {
    const r = await t.request<
      Record<string, unknown> & {
        customer: Customer;
        bookings: {
          booking_id: string;
          role: string;
          project_name: string;
          status: string;
          agreement_value_paise: number;
          total_paid_paise: number;
          total_due_paise: number;
        }[];
        portal: PortalCard | null;
        leads: unknown[];
        payments_recent: unknown[];
        documents: unknown[];
        tickets: unknown[];
      }
    >("GET", `/api/v1/customers/${c2}/360`, { token: salesA.access_token });
    expect(r.status, r.text).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual([
      "bookings",
      "customer",
      "documents",
      "documents_count",
      "leads",
      "leads_count",
      "payments_count",
      "payments_recent",
      "portal",
      "tickets",
      "tickets_open",
    ]);
    expect(r.body.customer.id).toBe(c2);
    expect(r.body.customer).not.toHaveProperty("pan");
    expect(r.body.bookings).toHaveLength(1);
    expect(r.body.bookings[0]).toMatchObject({
      role: "PRIMARY",
      project_name: "Shree Ganesh Heights",
      status: "ACTIVE",
      agreement_value_paise: 650000000,
      total_paid_paise: 0,
      total_due_paise: 0,
    });
    expect(r.body.payments_recent).toEqual([]);
    expect(r.body.documents).toEqual([]);
    expect(r.body.tickets).toEqual([]);
    expect(r.body.leads).toEqual([]);
    expect(r.body.portal?.is_enabled).toBe(true);
    expect(r.body.portal?.temp_password).toBeNull();
    // the converted lead shows in the 360 of its customer; co-applicant role on the other booking
    const kavita = await t.request<{ items: Customer[] }>("GET", "/api/v1/customers?search=Kavita", {
      token: admin.access_token,
    });
    const k360 = await t.request<{
      leads: { lead_number: string; stage: string }[];
      leads_count: number;
      portal: PortalCard | null;
    }>("GET", `/api/v1/customers/${kavita.body.items[0]!.id}/360`, { token: admin.access_token });
    expect(k360.body.leads_count).toBe(2);
    expect(k360.body.leads.every((l) => l.stage === "CONVERTED")).toBe(true);
    expect(k360.body.portal).toBeNull();
    const coApp = await t.request<{ items: Customer[] }>("GET", "/api/v1/customers?search=9876500013", {
      token: admin.access_token,
    });
    const co360 = await t.request<{ bookings: { role: string }[] }>(
      "GET",
      `/api/v1/customers/${coApp.body.items[0]!.id}/360`,
      { token: admin.access_token },
    );
    expect(co360.body.bookings.map((b) => b.role)).toEqual(["CO_APPLICANT"]);
    expect(
      (
        await t.request("GET", "/api/v1/customers/00000000-0000-4000-8000-000000000000/360", {
          token: admin.access_token,
        })
      ).status,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
describe("scope", () => {
  it("customers and leads are company-scoped, but project_id filters and references respect the caller's project scope (404, never 403)", async () => {
    const leadsAll = await t.request<{ total: number }>("GET", "/api/v1/leads", { token: scoped.access_token });
    expect(leadsAll.status).toBe(200);
    expect(leadsAll.body.total).toBeGreaterThan(0);
    const customersAll = await t.request<{ total: number }>("GET", "/api/v1/customers", { token: scoped.access_token });
    expect(customersAll.status).toBe(200);
    expect(customersAll.body.total).toBeGreaterThan(0);
    for (const url of [
      `/api/v1/leads?project_id=${projectA}`,
      `/api/v1/customers?project_id=${projectA}`,
      `/api/v1/leads/board?project_id=${projectA}`,
      `/api/v1/enquiries?project_id=${projectA}`,
    ]) {
      const r = await t.request<ErrorBody>("GET", url, { token: scoped.access_token });
      expect(r.status, url).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    const create = await t.request<ErrorBody>("POST", "/api/v1/leads", {
      token: scoped.access_token,
      body: { full_name: "Scoped", phone: "9833300001", source: "WALK_IN", project_id: projectA },
    });
    expect(create.status).toBe(404);
    const bulk = await t.request<ErrorBody>("POST", "/api/v1/customers/portal/bulk-enable", {
      token: scoped.access_token,
      body: { project_id: projectA, dry_run: true },
    });
    expect(bulk.status).toBe(404);
    // the 360 of a scoped user hides bookings in foreign projects
    const s360 = await t.request<{ bookings: unknown[] }>(
      "GET",
      `/api/v1/customers/${(await t.request<{ items: Customer[] }>("GET", "/api/v1/customers?search=9876500011", { token: admin.access_token })).body.items[0]!.id}/360`,
      { token: scoped.access_token },
    );
    expect(s360.status).toBe(200);
    expect(s360.body.bookings).toEqual([]);
    const adminFiltered = await t.request<{ total: number }>("GET", `/api/v1/leads?project_id=${projectA}`, {
      token: admin.access_token,
    });
    expect(adminFiltered.status).toBe(200);
    expect(adminFiltered.body.total).toBeGreaterThan(0);
    // every CRM staff route carries a permission
    const crm = t.app.routeRegistry.filter((r) => /^\/api\/v1\/(customers|leads|enquiries)/.test(r.url));
    expect(crm.length).toBeGreaterThan(30);
    expect(crm.filter((r) => !r.permission).map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });
});
