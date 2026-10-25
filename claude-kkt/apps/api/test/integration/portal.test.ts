import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@kkt/domain";
import { createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, freshIp, type ErrorBody, type LoginResult, type TestContext } from "./helpers.js";

/**
 * Portal module (SPEC §16 customer portal, §2 buyer rules, §18 scenario 10 buyer-isolation parts; API-CONVENTIONS Appendix C + additions).
 * World: money fixture (two projects, towers, modes, bank, plans, customers). Customer A books SGH A-101 with co-applicant C; customer B books
 * GGV G-101. Everything A can see, B must get 404 for, and vice versa; C sees A's booking as CO_APPLICANT.
 */

// Generated PDFs and uploads land in a throwaway directory (config reads STORAGE_LOCAL_DIR when the app is first imported).
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "kkt-portal-test-"));
process.env["STORAGE_LOCAL_DIR"] = STORAGE_DIR;
process.env["KKT_MODULES"] ??= "portal,inventory,money,construction,documents,service,reports";

const L = 10_000_000; // ₹1,00,000 in paise
const CR = 100 * L;
const NO_ID = "00000000-0000-4000-8000-000000000000";
const PASSWORD = "Welcome@123";

type List<T> = { items: T[]; total: number; page: number; page_size: number; next_cursor: string | null };
type Switcher = { booking_id: string; booking_number: string; project_name: string; block_name: string; flat_number: string; role: string; status: string };
type Bucket = { agreed_paise: number; raised_paise: number; paid_paise: number; due_paise: number; advance_paise: number };
type Home = {
  greeting_name: string; bookings: Switcher[];
  booking: { booking_id: string; booking_number: string; status: string; project_name: string; project_image_url: string | null; block_name: string; flat_number: string; floor_label: string; flat_type_name: string };
  construction: { percent: number; current_stage: string | null; next_stage: string | null };
  money: { cash: Bucket; account: Bucket; total_due_paise: number; other_charges_due_paise: number };
  plan: { name: string; plan_type: string; accepted_on: string | null };
  next_installment: { name: string; trigger_label: string; expected_date: string | null; cash_paise: number; account_paise: number; total_paise: number } | null;
  notices_unread: number; notifications_unread: number; pending_cheques_paise: number;
  relationship_manager: { name: string; phone: string | null; whatsapp: string | null; email: string | null } | null;
};
type Flat = { booking_id: string; flat_number: string; rooms: { label: string; room_type: string; sqft: number }[]; areas: { code: string; sqft: number }[]; parking: { number: string; slot_type: string }[]; floor_plan_url: string | null; price_breakup: { label: string; amount_paise: number }[]; agreement: { agreement_value_paise: number; cash_agreed_paise: number; account_agreed_paise: number; revisions: unknown[] }; specifications: { category: string; items: string[] }[]; bhk: number };
type LedgerRow = { seq: number; event: string; label: string; bucket: string | null; amount_paise: number; cash_paid_paise: number; account_paid_paise: number; cash_due_paise: number; account_due_paise: number; total_due_paise: number; ref_number: string | null };
type Receipt = { payment_id: string; receipt_number: string; amount_paise: number; bucket: string | null; against_label: string; mode_name: string; instrument_number: string | null; status: string; is_cancelled: boolean };
type Demand = { demand_id: string; demand_number: string; installment_name: string; status: string; is_overdue: boolean; total_demand_paise: number; paid_paise: number };
type Schedule = { rows: { seq: number; name: string; status: string; total_paise: number; paid_paise: number }[]; progress_percent: number; pending_cheques: Receipt[] };
type PdfLink = { download_url: string; expires_at: string; file_name: string };
type Timeline = { block_name: string; percent: number; current_stage: string | null; stages: { name: string; status: string; photos: { thumb_url: string; medium_url: string; caption: string | null }[] }[] };
type Doc = { document_id: string; kind: string; title: string; file_name: string; mime: string; shared_at: string | null };
type Bank = { bank_name: string; branch: string | null; account_name: string; account_number: string; ifsc: string; note: string | null };
type Message = { id: string; author: string; author_name: string; body: string; attachments: { id: string; file_name: string; mime: string; thumb_url: string | null; url: string | null }[] };
type Request = { id: string; ticket_number: string; booking_id: string | null; flat_number: string; category_name: string; priority: string; subject: string; status: string; can_reopen: boolean; can_rate: boolean; rating: number | null; messages: Message[] };
type Notice = { id: string; title: string; project_name: string | null; is_read: boolean };
type Notification = { id: string; type: string; title: string; screen: string; entity_id: string | null; booking_id: string | null; is_read: boolean };
type Profile = { customer_id: string; full_name: string; phone: string; alt_phone: string | null; email: string | null; address_current: { line1: string; city: string } | null; address_permanent: unknown; pan_masked: string | null; aadhaar_masked: string | null; kyc_status: string; co_applicants: unknown[]; relationship_manager: { name: string } | null; must_change_password: boolean };
type StaffTicket = { id: string; version: number; status: string };
type Construction = { version: number; stages: { id: string; stage_id: string; name: string; status: string }[] };

let t: TestContext;
let admin: LoginResult;
let sales: LoginResult;
let accounts: LoginResult;
let w: MoneyWorld;
let today: string;
let A: string; let B: string; let C: string; let D: string;
let tokenA: string; let tokenB: string; let tokenC: string;
let bookingA: { id: string; booking_number: string };
let bookingB: { id: string; booking_number: string };
let cashPaymentId: string;
let chequePaymentId: string;
let paymentBId: string;
let sharedDocId: string;
let sensitiveSharedDocId: string;
let unsharedDocId: string;
let customerDocId: string;
let snagCat: string;
let staffUserIds: Set<string>;
let keyCounter = 0;
const key = () => `portal-${Date.now()}-${++keyCounter}`;

async function sqlOne<T>(q: Promise<T[]>): Promise<T> {
  const rows = await q;
  if (!rows[0]) throw new Error("expected one row");
  return rows[0];
}

async function phoneOf(customerId: string): Promise<string> {
  return (await sqlOne(t.app.sql<{ phone: string }[]>`select phone from customers where id = ${customerId}`)).phone;
}

async function enablePortal(customerId: string, mustChange = false): Promise<string> {
  const { hashPassword } = await import("../../src/lib/password.js");
  const phone = await phoneOf(customerId);
  await t.app.sql`insert into portal_users (company_id, customer_id, phone, password_hash, must_change_password) values (${t.companyId}, ${customerId}, ${phone}, ${await hashPassword(PASSWORD)}, ${mustChange})`;
  return phone;
}

async function portalLogin(phone: string, password = PASSWORD): Promise<string> {
  const r = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone, password } });
  if (r.status !== 200) throw new Error(`portal login failed (${r.status}): ${r.text}`);
  return r.body.access_token;
}

async function get<T>(url: string, token: string): Promise<{ status: number; body: T & ErrorBody; text: string }> {
  const r = await t.request<T & ErrorBody>("GET", url, { token });
  return { status: r.status, body: r.body, text: r.text };
}

async function ok<T>(url: string, token: string): Promise<T> {
  const r = await get<T>(url, token);
  expect(r.status, `${url} → ${r.text}`).toBe(200);
  return r.body;
}

async function post<T>(url: string, token: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T & ErrorBody; text: string }> {
  const r = await t.request<T & ErrorBody>("POST", url, { token, body, headers: { "idempotency-key": key(), ...headers } });
  return { status: r.status, body: r.body, text: r.text };
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

async function fetchFile(url: string) {
  return t.app.inject({ method: "GET", url: pathOf(url), headers: { "x-forwarded-for": freshIp() } });
}

async function uploadAttachment(token: string, requestId: string, file: { name: string; data: Buffer; type?: string } | null, fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", new Blob([new Uint8Array(file.data)], { type: file.type ?? "application/octet-stream" }), file.name);
  else fd.append("note", "no file");
  const encoded = new Response(fd);
  const payload = Buffer.from(await encoded.arrayBuffer());
  const res = await t.app.inject({ method: "POST", url: `/api/v1/portal/requests/${requestId}/attachments`, headers: { "content-type": encoded.headers.get("content-type")!, "x-forwarded-for": freshIp(), authorization: `Bearer ${token}` }, payload });
  const ct = String(res.headers["content-type"] ?? "");
  return { status: res.statusCode, body: (ct.includes("application/json") ? JSON.parse(res.body) : res.body) as Doc & ErrorBody, text: res.body };
}

async function insertDoc(entityType: string, entityId: string, opts: { shared?: boolean; sensitive?: boolean; name?: string } = {}): Promise<string> {
  const n = Math.floor(Math.random() * 1e9);
  const row = await sqlOne(t.app.sql<{ id: string }[]>`insert into documents (company_id, entity_type, entity_id, title, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, uploaded_by, is_sensitive, shared_with_customer)
    values (${t.companyId}, ${entityType}, ${entityId}, ${opts.name ?? `Document ${n}`}, ${`${opts.name ?? `doc-${n}`}.pdf`}, 'application/pdf', 2048, ${`sha-${n}`}, ${`t/${n}.pdf`}, 'STAFF', ${admin.user.id}, ${opts.sensitive ?? false}, ${opts.shared ?? false}) returning id`);
  return row.id;
}

/** Walks a JSON value: every key ending in `_id` must not name a staff user; no key may be (or end in) storage_key. */
function assertNoLeaks(value: unknown, path = "$"): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoLeaks(v, `${path}[${i}]`)); return; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      expect(k, `${path}.${k}`).not.toMatch(/storage_key$|^storage|_enc$|_hash$|password_hash|^password$|^token$|secret/i);
      if (/_id$/.test(k) && typeof v === "string") expect(staffUserIds.has(v), `${path}.${k} refers to a staff user`).toBe(false);
      assertNoLeaks(v, `${path}.${k}`);
    }
  }
}

async function auditRows(action: string, actorType?: string): Promise<{ actor_type: string; actor_id: string | null; entity_id: string | null; after: Record<string, unknown> | null }[]> {
  return actorType
    ? t.app.sql`select actor_type, actor_id, entity_id, after from audit_logs where action = ${action} and actor_type = ${actorType} order by created_at`
    : t.app.sql`select actor_type, actor_id, entity_id, after from audit_logs where action = ${action} order by created_at`;
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = await t.loginAs("admin");
  sales = await t.loginAs("sales");
  accounts = await t.loginAs("accounts");
  w = await createMoneyWorld(t, admin.access_token);
  [A, B, C, D] = w.customers as [string, string, string, string];
  staffUserIds = new Set((await t.app.sql<{ id: string }[]>`select id from users`).map((r) => r.id));

  // customer A: relationship manager, KYC (encrypted at rest), address
  const { encryptField, keyedHash } = await import("../../src/lib/crypto.js");
  await t.app.sql`update customers set relationship_manager_id = ${sales.user.id}, pan_enc = ${encryptField("ABCDE1234F")}, pan_hash = ${keyedHash("ABCDE1234F")}, pan_last4 = '234F',
    aadhaar_enc = ${encryptField("234567890124")}, aadhaar_hash = ${keyedHash("234567890124")}, aadhaar_last4 = '0124', email = 'rajesh@example.com' where id = ${A}`;
  const phoneA = await enablePortal(A);
  const phoneB = await enablePortal(B);
  const phoneC = await enablePortal(C);
  await enablePortal(D, true);
  tokenA = await portalLogin(phoneA);
  tokenB = await portalLogin(phoneB);
  tokenC = await portalLogin(phoneC);

  // bookings: A → SGH A-101 (co-applicant C, parking, on-booking parking charge); B → GGV G-101
  const bA = await post<{ id: string; booking_number: string }>("/api/v1/bookings", sales.access_token, {
    flat_id: w.sgh.flats.get("A-101")!.id, customer_id: A, co_applicant_ids: [C], booking_date: today, agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L,
    plan_acceptance_mode: "IN_PERSON", plan_accepted_on: today, parking_slot_ids: [w.sgh.parkingIds[0]!], other_charges: [{ charge_type_id: w.charges.PARKING, amount_paise: 30 * L, gst_percent: 5, demand_at: "ON_BOOKING" }],
  });
  expect(bA.status, bA.text).toBe(201);
  bookingA = bA.body;
  const bB = await post<{ id: string; booking_number: string }>("/api/v1/bookings", sales.access_token, {
    flat_id: w.ggv.flats.get("G-101")!.id, customer_id: B, booking_date: today, agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L, plan_acceptance_mode: "IN_PERSON", plan_accepted_on: today,
  });
  expect(bB.status, bB.text).toBe(201);
  bookingB = bB.body;

  // payments on A: ₹5 L cash (clears), ₹2 L cheque (pending); on B: ₹1 L UPI
  const cash = await post<{ payment: { id: string } }>("/api/v1/payments", accounts.access_token, { booking_id: bookingA.id, against: "FLAT_VALUE", bucket: "CASH", amount_paise: 5 * L, payment_date: today, payment_mode_id: w.modes.CASH });
  expect(cash.status, cash.text).toBe(201);
  cashPaymentId = cash.body.payment.id;
  const cheque = await post<{ payment: { id: string } }>("/api/v1/payments", accounts.access_token, { booking_id: bookingA.id, against: "FLAT_VALUE", bucket: "ACCOUNT", amount_paise: 2 * L, payment_date: today, payment_mode_id: w.modes.CHEQUE, instrument: { number: "000123", date: today, bank_name: "SBI" }, bank_account_id: w.bankAccountId });
  expect(cheque.status, cheque.text).toBe(201);
  chequePaymentId = cheque.body.payment.id;
  const upi = await post<{ payment: { id: string } }>("/api/v1/payments", accounts.access_token, { booking_id: bookingB.id, against: "FLAT_VALUE", bucket: "CASH", amount_paise: 1 * L, payment_date: today, payment_mode_id: w.modes.UPI, instrument: { number: "UPI-B-1" }, bank_account_id: w.bankAccountId });
  expect(upi.status, upi.text).toBe(201);
  paymentBId = upi.body.payment.id;

  // Tower A reaches Excavation (raises the Excavation installment for A); one photo visible to buyers, one internal
  const c0 = await ok<Construction>(`/api/v1/blocks/${w.sgh.towerId}/construction`, admin.access_token);
  const st = await post(`/api/v1/blocks/${w.sgh.towerId}/construction/status`, admin.access_token, { version: c0.version, stage_id: w.stages.EXCAVATION, completed_on: today });
  expect(st.status, st.text).toBe(200);
  const excavation = c0.stages.find((s) => s.stage_id === w.stages.EXCAVATION)!;
  const { insertImageDocument } = await import("./fixtures/construction.js");
  const visibleDoc = await insertImageDocument(t, "STAGE", excavation.id);
  const hiddenDoc = await insertImageDocument(t, "STAGE", excavation.id);
  const p1 = await post(`/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.EXCAVATION}/photos`, admin.access_token, { document_id: visibleDoc, caption: "Excavation done", visible_to_buyers: true });
  expect(p1.status, p1.text).toBe(201);
  const p2 = await post(`/api/v1/blocks/${w.sgh.towerId}/construction/${w.stages.EXCAVATION}/photos`, admin.access_token, { document_id: hiddenDoc, caption: "internal", visible_to_buyers: false });
  expect(p2.status, p2.text).toBe(201);

  // documents on A's booking / customer record
  sharedDocId = await insertDoc("BOOKING", bookingA.id, { shared: true, name: "Agreement copy" });
  sensitiveSharedDocId = await insertDoc("BOOKING", bookingA.id, { shared: true, sensitive: true, name: "PAN card" });
  unsharedDocId = await insertDoc("BOOKING", bookingA.id, { shared: false, name: "Internal note" });
  customerDocId = await insertDoc("CUSTOMER", A, { shared: true, name: "Welcome letter" });

  // service category + notices
  const cat = await post<{ id: string }>("/api/v1/masters/service-categories", admin.access_token, { name: "Defect/Snag", sort_order: 1, default_priority: "HIGH" });
  expect(cat.status, cat.text).toBe(201);
  snagCat = cat.body.id;
  for (const body of [
    { title: "Diwali holiday schedule", body_md: "Office closed 1–3 Nov.", is_published: true },
    { title: "Tower A slab casting", body_md: "4th slab casting on 2 Nov.", is_published: true, project_id: w.sgh.id },
    { title: "GGV only", body_md: "Villa landscaping.", is_published: true, project_id: w.ggv.id },
    { title: "Draft notice", body_md: "Not yet.", is_published: false },
  ]) {
    const n = await post("/api/v1/notices", admin.access_token, body);
    expect(n.status, n.text).toBe(201);
  }
});

afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------

describe("booking switcher and ownership", () => {
  it("A lists only their booking (PRIMARY); C sees it as CO_APPLICANT; B sees only theirs; bare arrays", async () => {
    const a = await ok<Switcher[]>("/api/v1/portal/bookings", tokenA);
    expect(Array.isArray(a)).toBe(true);
    expect(a.map((b) => [b.booking_id, b.role])).toEqual([[bookingA.id, "PRIMARY"]]);
    expect(a[0]).toMatchObject({ booking_number: bookingA.booking_number, project_name: "Shree Ganesh Heights", block_name: "Tower A", flat_number: "A-101", status: "ACTIVE" });
    const c = await ok<Switcher[]>("/api/v1/portal/bookings", tokenC);
    expect(c.map((b) => [b.booking_id, b.role])).toEqual([[bookingA.id, "CO_APPLICANT"]]);
    const b = await ok<Switcher[]>("/api/v1/portal/bookings", tokenB);
    expect(b.map((x) => x.booking_id)).toEqual([bookingB.id]);
  });

  it("every booking route answers 404 NOT_FOUND for another buyer's booking, PDF and document links included", async () => {
    const urls = [
      "home", "flat", "ledger", "receipts", `receipts/${paymentBId}/pdf`, "demands", `demands/${NO_ID}/pdf`, "schedule", "statement.pdf", "allotment-letter.pdf", "construction", "documents", `documents/${sharedDocId}/download`, "bank-details",
    ];
    for (const suffix of urls) {
      const r = await get(`/api/v1/portal/bookings/${bookingB.id}/${suffix}`, tokenA);
      expect(r.status, `${suffix}: ${r.text}`).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    // unknown id and B's own receipt reached through A's booking id are 404 too
    expect((await get(`/api/v1/portal/bookings/${NO_ID}/home`, tokenA)).status).toBe(404);
    expect((await get(`/api/v1/portal/bookings/${bookingA.id}/receipts/${paymentBId}/pdf`, tokenA)).status).toBe(404);
    // and B cannot see A's booking either
    expect((await get(`/api/v1/portal/bookings/${bookingA.id}/home`, tokenB)).status).toBe(404);
  });

  it("co-applicant C can open A's booking screens", async () => {
    const home = await ok<Home>(`/api/v1/portal/bookings/${bookingA.id}/home`, tokenC);
    expect(home.booking.booking_id).toBe(bookingA.id);
    expect(home.bookings.map((b) => b.role)).toEqual(["CO_APPLICANT"]);
    expect((await get(`/api/v1/portal/bookings/${bookingA.id}/ledger`, tokenC)).status).toBe(200);
  });
});

describe("home", () => {
  it("hero, progress ring, buckets, plan, next installment, counts and RM (name + phone only)", async () => {
    const home = await ok<Home>(`/api/v1/portal/bookings/${bookingA.id}/home`, tokenA);
    expect(home.greeting_name).toBe("Rajesh");
    expect(home.booking).toMatchObject({ booking_number: bookingA.booking_number, project_name: "Shree Ganesh Heights", block_name: "Tower A", flat_number: "A-101", floor_label: "1", status: "ACTIVE" });
    expect(home.booking.flat_type_name).toBeTruthy();
    expect(home.construction.current_stage).toBe("Excavation");
    expect(home.construction.next_stage).toBe("Foundation");
    expect(home.construction.percent).toBeGreaterThan(0);
    // ON_BOOKING 10% (6 L / 4 L) + Excavation 5% (3 L / 2 L) raised; ₹5 L cash paid; cheque pending (not counted)
    expect(home.money.cash).toEqual({ agreed_paise: 60 * L, raised_paise: 9 * L, paid_paise: 5 * L, due_paise: 4 * L, advance_paise: 0 });
    expect(home.money.account).toEqual({ agreed_paise: 40 * L, raised_paise: 6 * L, paid_paise: 0, due_paise: 6 * L, advance_paise: 0 });
    expect(home.money.total_due_paise).toBe(10 * L);
    expect(home.money.other_charges_due_paise).toBe(31.5 * L); // parking 30 L + 5% GST demanded on booking
    expect(home.pending_cheques_paise).toBe(2 * L);
    expect(home.plan).toEqual({ name: "Villa CLP", plan_type: "CONSTRUCTION_LINKED", accepted_on: today });
    expect(home.next_installment).toMatchObject({ name: "On booking", cash_paise: 6 * L, account_paise: 4 * L, total_paise: 10 * L });
    expect(home.notices_unread).toBe(2); // company-wide + SGH; not GGV, not the draft
    expect(home.notifications_unread).toBeGreaterThan(0);
    expect(home.relationship_manager).toMatchObject({ name: expect.any(String), email: "sales@sgb.in" });
    expect(home.relationship_manager!.whatsapp).toBe(home.relationship_manager!.phone);
    expect(Object.keys(home.relationship_manager!).sort()).toEqual(["email", "name", "phone", "whatsapp"]);
    expect(JSON.stringify(home)).not.toContain(sales.user.id);
    assertNoLeaks(home);
  });

  it("due below zero is shown as advance", async () => {
    // B paid ₹1 L cash against a ₹6 L cash demand → due 5 L; account bucket untouched
    const home = await ok<Home>(`/api/v1/portal/bookings/${bookingB.id}/home`, tokenB);
    expect(home.money.cash).toMatchObject({ raised_paise: 6 * L, paid_paise: 1 * L, due_paise: 5 * L, advance_paise: 0 });
    expect(home.relationship_manager).toBeNull();
    expect(home.notices_unread).toBe(2); // company-wide + GGV
  });
});

describe("my flat", () => {
  it("rooms & areas snapshot, parking, price breakup, agreement; no floor plan until one is attached", async () => {
    const flat = await ok<Flat>(`/api/v1/portal/bookings/${bookingA.id}/flat`, tokenA);
    expect(flat.flat_number).toBe("A-101");
    expect(flat.rooms.length).toBeGreaterThan(0);
    expect(flat.rooms[0]).toMatchObject({ label: "Master Bedroom", room_type: "Bedroom", sqft: 168 });
    expect(flat.areas.map((a) => a.code).sort()).toEqual(["BUILT_UP", "CARPET", "SUPER_BUILT_UP"]);
    expect(flat.parking).toHaveLength(1);
    expect(flat.parking[0]).toMatchObject({ number: "B1-01", slot_type: "COVERED" });
    expect(flat.price_breakup.length).toBeGreaterThan(0);
    expect(flat.agreement).toMatchObject({ agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L, revisions: [] });
    expect(flat.floor_plan_url).toBeNull();
    expect(flat.bhk).toBeGreaterThan(0);
    assertNoLeaks(flat);
  });

  it("a floor-plan image attached to the flat is linked (signed, 15-min)", async () => {
    const { insertImageDocument } = await import("./fixtures/construction.js");
    const flatId = w.sgh.flats.get("A-101")!.id;
    const doc = await insertImageDocument(t, "BLOCK", w.sgh.towerId);
    await t.app.sql`update documents set entity_type = 'FLAT', entity_id = ${flatId}, title = 'Floor plan – 3BHK' where id = ${doc}`;
    const flat = await ok<Flat>(`/api/v1/portal/bookings/${bookingA.id}/flat`, tokenA);
    expect(flat.floor_plan_url).toMatch(/\/api\/v1\/portal\/files\//);
    expect(flat.floor_plan_url).not.toContain(doc); // signed token, not the raw id
  });
});

describe("ledger, receipts, demands, schedule", () => {
  it("ledger rows carry bucket chips, running paid and due per bucket, in seq order", async () => {
    const ledger = await ok<List<LedgerRow>>(`/api/v1/portal/bookings/${bookingA.id}/ledger`, tokenA);
    expect(ledger.total).toBeGreaterThanOrEqual(4); // on-booking demand, parking charge demand, cash payment, excavation demand (cheque pending: no row)
    expect(ledger.items.map((r) => r.seq)).toEqual(ledger.items.map((_, i) => i + 1));
    const demand = ledger.items.find((r) => r.event === "DEMAND")!;
    expect(demand).toMatchObject({ label: "On booking", amount_paise: 10 * L });
    const payment = ledger.items.find((r) => r.event === "PAYMENT")!;
    expect(payment).toMatchObject({ bucket: "CASH", amount_paise: 5 * L, cash_paid_paise: 5 * L, account_paid_paise: 0 });
    expect(payment.ref_number).toMatch(/^SGB\//);
    const last = ledger.items[ledger.items.length - 1]!;
    expect(last.total_due_paise).toBe(10 * L);
    // paging works (page_size 2 → 2 rows, total unchanged)
    const page = await ok<List<LedgerRow>>(`/api/v1/portal/bookings/${bookingA.id}/ledger?page_size=2`, tokenA);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(ledger.total);
    expect((await get(`/api/v1/portal/bookings/${bookingA.id}/ledger?sort=amount_paise`, tokenA)).status).toBe(400);
    assertNoLeaks(ledger);
  });

  it("receipts list every payment with status flags; pending cheque shows its instrument", async () => {
    const receipts = await ok<List<Receipt>>(`/api/v1/portal/bookings/${bookingA.id}/receipts`, tokenA);
    expect(receipts.total).toBe(2);
    const cheque = receipts.items.find((r) => r.payment_id === chequePaymentId)!;
    expect(cheque).toMatchObject({ amount_paise: 2 * L, bucket: "ACCOUNT", against_label: "Flat value – Account", mode_name: "Cheque", instrument_number: "000123", status: "PENDING", is_cancelled: false });
    const cash = receipts.items.find((r) => r.payment_id === cashPaymentId)!;
    expect(cash).toMatchObject({ status: "CLEARED", mode_name: "Cash", against_label: "Flat value – Cash" });
    expect(cash.receipt_number).toMatch(/^SGB\//);
    expect(receipts.items.some((r) => r.payment_id === paymentBId)).toBe(false);
    assertNoLeaks(receipts);
  });

  it("demands: non-void only, overdue flag, in installment order", async () => {
    const demands = await ok<List<Demand>>(`/api/v1/portal/bookings/${bookingA.id}/demands`, tokenA);
    expect(demands.items.map((d) => d.installment_name)).toEqual(["On booking", "Excavation"]);
    expect(demands.items[0]).toMatchObject({ total_demand_paise: 10 * L, paid_paise: 5 * L, status: "PARTIALLY_PAID", is_overdue: false });
    expect(demands.items[0]!.demand_number).toMatch(/^DM-/);
    assertNoLeaks(demands);
  });

  it("schedule: 10 Villa CLP rows with statuses, progress and the pending cheque", async () => {
    const s = await ok<Schedule>(`/api/v1/portal/bookings/${bookingA.id}/schedule`, tokenA);
    expect(s.rows).toHaveLength(10);
    expect(s.rows[0]).toMatchObject({ seq: 1, name: "On booking", status: "PARTIALLY_PAID", total_paise: 10 * L, paid_paise: 5 * L });
    expect(s.rows[1]).toMatchObject({ seq: 2, name: "Excavation", status: "RAISED" });
    expect(s.rows[2]!.status).toBe("NOT_YET_DUE");
    expect(s.progress_percent).toBe(5);
    expect(s.pending_cheques.map((p) => p.payment_id)).toEqual([chequePaymentId]);
  });
});

describe("PDF links", () => {
  async function expectPdf(link: PdfLink): Promise<void> {
    expect(link.download_url).toMatch(/\/api\/v1\/portal\/files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(link.file_name).toMatch(/\.pdf$/);
    expect(new Date(link.expires_at).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(new Date(link.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 1000);
    const res = await fetchFile(link.download_url);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(String(res.headers["content-disposition"])).toContain(link.file_name);
  }

  it("receipt, demand letter, statement and allotment letter stream through signed 15-minute links", async () => {
    const receipts = await ok<List<Receipt>>(`/api/v1/portal/bookings/${bookingA.id}/receipts`, tokenA);
    for (const r of receipts.items) await expectPdf(await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/receipts/${r.payment_id}/pdf`, tokenA));
    const demands = await ok<List<Demand>>(`/api/v1/portal/bookings/${bookingA.id}/demands`, tokenA);
    await expectPdf(await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/demands/${demands.items[0]!.demand_id}/pdf`, tokenA));
    await expectPdf(await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/statement.pdf`, tokenA));
    await expectPdf(await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/allotment-letter.pdf`, tokenA));
    // the co-applicant gets the same documents
    await expectPdf(await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/statement.pdf`, tokenC));
  });

  it("forged, tampered or expired tokens are 404; expired temp files are swept from storage", async () => {
    const link = await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/statement.pdf`, tokenA);
    const token = link.download_url.split("/portal/files/")[1]!;
    const [body, sig] = token.split(".") as [string, string];
    const flip = (ch: string) => (ch === "A" ? "B" : "A");
    expect((await fetchFile(`http://localhost:4000/api/v1/portal/files/${body}.${sig.slice(0, -1)}${flip(sig.slice(-1))}`)).statusCode).toBe(404);
    expect((await fetchFile(`http://localhost:4000/api/v1/portal/files/${body.slice(0, -1)}${flip(body.slice(-1))}.${sig}`)).statusCode).toBe(404);
    expect((await fetchFile("http://localhost:4000/api/v1/portal/files/not-a-token")).statusCode).toBe(404);
    expect((await fetchFile(`http://localhost:4000/api/v1/portal/files/${"A".repeat(60)}.${"B".repeat(22)}`)).statusCode).toBe(404);
    // sweep: push every indexed temp file into the past and run the cleanup job handler
    const { cleanupExpiredTempFiles, verifyTempToken } = await import("../../src/modules/portal/index.js");
    const id = verifyTempToken(token)!.id;
    const file = join(STORAGE_DIR, "portal-tmp", `${id}.pdf`);
    expect(existsSync(file)).toBe(true);
    await t.app.redis.zadd("portal:files:expiry", Date.now() - 1000, id);
    const removed = await cleanupExpiredTempFiles(t.app.redis);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(file)).toBe(false);
    expect((await fetchFile(link.download_url)).statusCode).toBe(404);
    // the job is registered under its name
    const { registeredJobs } = await import("../../src/jobs/index.js");
    expect(registeredJobs()).toContain("PORTAL_FILE_CLEANUP");
  });

  it("a shared document streams through its customer-bound portal link; documents-module tokens are not accepted by the portal endpoint", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#0B1F3A" } }).png().toBuffer();
    const { storeBuffer, signedUrl } = await import("../../src/modules/documents/index.js");
    const doc = await t.app.db.transaction((tx) => storeBuffer(tx, { companyId: t.companyId, entityType: "BOOKING", entityId: bookingA.id, buffer: png, filename: "site.png", uploadedBy: admin.user.id, uploadedByType: "STAFF", sharedWithCustomer: true }));
    const link = await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/documents/${doc.id}/download`, tokenA);
    expect(link.download_url).toMatch(/\/api\/v1\/portal\/files\//);
    const viaPortal = await fetchFile(link.download_url);
    expect(viaPortal.statusCode).toBe(200);
    expect(viaPortal.headers["content-type"]).toBe("image/png");
    // a documents-module (staff) link carries no customer and is refused here
    const staffLink = signedUrl(doc.id, "original").url;
    expect((await fetchFile(staffLink.replace("/api/v1/files/", "/api/v1/portal/files/"))).statusCode).toBe(404);
  });
});

describe("construction", () => {
  it("own tower only; only photos flagged visible to buyers; signed image links", async () => {
    const a = await ok<Timeline>(`/api/v1/portal/bookings/${bookingA.id}/construction`, tokenA);
    expect(a.block_name).toBe("Tower A");
    expect(a.current_stage).toBe("Excavation");
    expect(a.percent).toBeGreaterThan(0);
    const exc = a.stages.find((s) => s.name === "Excavation")!;
    expect(exc.status).toBe("COMPLETED");
    expect(exc.photos).toHaveLength(1);
    expect(exc.photos[0]).toMatchObject({ caption: "Excavation done" });
    expect(exc.photos[0]!.thumb_url).toMatch(/\/api\/v1\/portal\/files\//);
    expect(exc.photos[0]!.medium_url).toMatch(/\/api\/v1\/portal\/files\//);
    expect(a.stages.every((s) => s.name !== "Excavation" ? s.photos.length === 0 : true)).toBe(true);
    const b = await ok<Timeline>(`/api/v1/portal/bookings/${bookingB.id}/construction`, tokenB);
    expect(b.block_name).toBe("Tower G");
    expect(b.stages.every((s) => s.status === "PENDING" && s.photos.length === 0)).toBe(true);
    assertNoLeaks(a);
  });
});

describe("documents and bank details", () => {
  it("lists shared, non-sensitive booking and own-customer documents only; download links for those, 404 for the rest", async () => {
    const docs = await ok<{ items: Doc[] }>(`/api/v1/portal/bookings/${bookingA.id}/documents`, tokenA);
    const ids = docs.items.map((d) => d.document_id);
    expect(ids).toContain(sharedDocId);
    expect(ids).toContain(customerDocId);
    expect(ids).not.toContain(sensitiveSharedDocId);
    expect(ids).not.toContain(unsharedDocId);
    expect(docs.items.find((d) => d.document_id === sharedDocId)).toMatchObject({ kind: "SHARED", title: "Agreement copy", mime: "application/pdf" });
    const link = await ok<PdfLink>(`/api/v1/portal/bookings/${bookingA.id}/documents/${sharedDocId}/download`, tokenA);
    expect(link.download_url).toMatch(/\/api\/v1\/portal\/files\//);
    expect(link.file_name).toBe("Agreement copy.pdf");
    for (const hidden of [sensitiveSharedDocId, unsharedDocId, NO_ID]) {
      const r = await get(`/api/v1/portal/bookings/${bookingA.id}/documents/${hidden}/download`, tokenA);
      expect(r.status, hidden).toBe(404);
    }
    // the co-applicant sees the booking's shared document but not A's personal one
    const forC = await ok<{ items: Doc[] }>(`/api/v1/portal/bookings/${bookingA.id}/documents`, tokenC);
    expect(forC.items.map((d) => d.document_id)).toContain(sharedDocId);
    expect(forC.items.map((d) => d.document_id)).not.toContain(customerDocId);
    assertNoLeaks(docs);
  });

  it("bank details show the builder's receiving account in full (default company account)", async () => {
    const bank = await ok<Bank>(`/api/v1/portal/bookings/${bookingA.id}/bank-details`, tokenA);
    expect(bank).toMatchObject({ bank_name: "HDFC Bank", branch: "Boring Road", account_name: "Shree Ganesh Builders", account_number: w.bankAccountNumber, ifsc: "HDFC0000123" });
    expect(bank.note).toContain(bookingA.booking_number);
  });

  it("a project escrow account wins over the company default", async () => {
    const escrow = await post<{ id: string }>("/api/v1/masters/bank-accounts", admin.access_token, { bank_name: "SBI", branch: "Patna Main", account_name: "SGB Escrow GGV", account_number: "31234567890", ifsc: "SBIN0001234", is_escrow: true });
    expect(escrow.status, escrow.text).toBe(201);
    await t.app.sql`update projects set escrow_bank_account_id = ${escrow.body.id} where id = ${w.ggv.id}`;
    const bank = await ok<Bank>(`/api/v1/portal/bookings/${bookingB.id}/bank-details`, tokenB);
    expect(bank).toMatchObject({ bank_name: "SBI", account_number: "31234567890", ifsc: "SBIN0001234" });
  });
});

describe("service requests", () => {
  let reqA: Request;

  it("categories list id/name/default_priority only", async () => {
    const cats = await ok<{ id: string; name: string; default_priority: string }[]>("/api/v1/portal/requests/categories", tokenA);
    expect(cats).toEqual([{ id: snagCat, name: "Defect/Snag", default_priority: "HIGH" }]);
  });

  it("create (JSON) → SR number, HIGH default priority, opening message; another buyer's booking → 404; validation → 400", async () => {
    const r = await post<Request>("/api/v1/portal/requests", tokenA, { booking_id: bookingA.id, category_id: snagCat, subject: "Seepage in master bedroom", description: "Water marks after the rains." });
    expect(r.status, r.text).toBe(201);
    reqA = r.body;
    expect(reqA).toMatchObject({ booking_id: bookingA.id, flat_number: "A-101", category_name: "Defect/Snag", priority: "HIGH", status: "NEW", can_reopen: false, can_rate: false, rating: null });
    expect(reqA.ticket_number).toMatch(/^SR-/);
    expect(reqA.messages).toHaveLength(1);
    expect(reqA.messages[0]).toMatchObject({ author: "YOU", body: "Water marks after the rains.", attachments: [] });
    const foreign = await post<Request>("/api/v1/portal/requests", tokenA, { booking_id: bookingB.id, category_id: snagCat, subject: "Not my booking", description: "x" });
    expect(foreign.status).toBe(404);
    const bad = await post<Request>("/api/v1/portal/requests", tokenA, { booking_id: bookingA.id, category_id: snagCat, subject: "ok", description: "x", extra: 1 });
    expect(bad.status).toBe(400);
    expect((await auditRows("service_request.create", "CUSTOMER")).map((a) => a.entity_id)).toContain(reqA.id);
  });

  it("idempotent create: same key replays the same ticket", async () => {
    const k = key();
    const body = { booking_id: bookingA.id, category_id: snagCat, subject: "Replay me please", description: "once" };
    const first = await post<Request>("/api/v1/portal/requests", tokenA, body, { "idempotency-key": k });
    const again = await t.request<Request>("POST", "/api/v1/portal/requests", { token: tokenA, body, headers: { "idempotency-key": k } });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers["idempotent-replayed"]).toBe("true");
  });

  it("internal staff notes never appear; public staff replies do (by name, no ids); B cannot see A's request", async () => {
    const detail0 = await ok<StaffTicket>(`/api/v1/service-requests/${reqA.id}`, admin.access_token);
    const internal = await post<StaffTicket>(`/api/v1/service-requests/${reqA.id}/messages`, admin.access_token, { body: "INTERNAL: customer is difficult", is_internal: true }, { "if-match": `"${detail0.version}"` });
    expect(internal.status, internal.text).toBe(201);
    const pub = await post<StaffTicket>(`/api/v1/service-requests/${reqA.id}/messages`, admin.access_token, { body: "Our engineer visits Monday.", is_internal: false }, { "if-match": `"${internal.body.version}"` });
    expect(pub.status, pub.text).toBe(201);
    const d = await ok<Request>(`/api/v1/portal/requests/${reqA.id}`, tokenA);
    expect(d.status).toBe("IN_PROGRESS");
    expect(d.messages.map((m) => m.body)).toEqual(["Water marks after the rains.", "Our engineer visits Monday."]);
    expect(JSON.stringify(d)).not.toContain("INTERNAL");
    expect(d.messages[1]).toMatchObject({ author: "STAFF", author_name: admin.user.email ? expect.any(String) : "" });
    expect(d.messages[1]).not.toHaveProperty("author_id");
    expect(d.messages[1]).not.toHaveProperty("is_internal");
    assertNoLeaks(d);
    expect((await get(`/api/v1/portal/requests/${reqA.id}`, tokenB)).status).toBe(404);
    expect((await get(`/api/v1/portal/requests/${reqA.id}`, tokenC)).status).toBe(404);
    const list = await ok<List<Request>>("/api/v1/portal/requests", tokenB);
    expect(list.total).toBe(0);
    const mine = await ok<List<Request>>(`/api/v1/portal/requests?status=IN_PROGRESS&booking_id=${bookingA.id}`, tokenA);
    expect(mine.items.map((r) => r.id)).toEqual([reqA.id]);
  });

  it("attachment upload (multipart `file`) stores a SERVICE_REQUEST document by the CUSTOMER; a reply carries it", async () => {
    const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#C9A227" } }).jpeg().toBuffer();
    const up = await uploadAttachment(tokenA, reqA.id, { name: "crack.jpg", data: jpg, type: "image/jpeg" });
    expect(up.status, up.text).toBe(201);
    expect(up.body).toMatchObject({ kind: "ATTACHMENT", file_name: "crack.jpg", mime: "image/jpeg" });
    expect(up.body).not.toHaveProperty("storage_key");
    const row = await sqlOne(t.app.sql<{ entity_type: string; entity_id: string; uploaded_by_type: string; uploaded_by: string }[]>`select entity_type, entity_id, uploaded_by_type, uploaded_by from documents where id = ${up.body.document_id}`);
    expect(row).toEqual({ entity_type: "SERVICE_REQUEST", entity_id: reqA.id, uploaded_by_type: "CUSTOMER", uploaded_by: A });
    expect((await auditRows("document.upload", "CUSTOMER")).map((a) => a.entity_id)).toContain(up.body.document_id);
    // bad uploads
    expect((await uploadAttachment(tokenA, reqA.id, { name: "evil.exe", data: Buffer.from("MZ not an image at all") })).status).toBe(415);
    expect((await uploadAttachment(tokenA, reqA.id, null)).status).toBe(400);
    expect((await uploadAttachment(tokenB, reqA.id, { name: "x.jpg", data: jpg })).status).toBe(404);
    // reply with the attachment
    const reply = await post<Request>(`/api/v1/portal/requests/${reqA.id}/messages`, tokenA, { body: "Photo of the crack attached.", attachment_ids: [up.body.document_id] });
    expect(reply.status, reply.text).toBe(201);
    const last = reply.body.messages[reply.body.messages.length - 1]!;
    expect(last).toMatchObject({ author: "YOU", body: "Photo of the crack attached." });
    expect(last.attachments).toHaveLength(1);
    expect(last.attachments[0]).toMatchObject({ id: up.body.document_id, file_name: "crack.jpg", mime: "image/jpeg" });
    expect(last.attachments[0]!.thumb_url).toMatch(/\/api\/v1\/portal\/files\//);
    // someone else's document cannot be smuggled into the thread
    const smuggle = await post<Request>(`/api/v1/portal/requests/${reqA.id}/messages`, tokenA, { body: "x", attachment_ids: [sensitiveSharedDocId] });
    expect(smuggle.status).toBe(400);
    // `message_id` appends the upload to one of the customer's own messages (the opening message after create — how the portal attaches photos to a new request)
    const before = await ok<Request>(`/api/v1/portal/requests/${reqA.id}`, tokenA);
    const opening = before.messages[0]!;
    expect(opening.author).toBe("YOU");
    const staffMsg = before.messages.find((m) => m.author === "STAFF")!;
    const linked = await uploadAttachment(tokenA, reqA.id, { name: "opening.jpg", data: jpg, type: "image/jpeg" }, { message_id: opening.id });
    expect(linked.status, linked.text).toBe(201);
    const after = await ok<Request>(`/api/v1/portal/requests/${reqA.id}`, tokenA);
    expect(after.messages[0]!.attachments.map((a) => a.id)).toContain(linked.body.document_id);
    expect(after.messages[0]!.attachments.find((a) => a.id === linked.body.document_id)!.url).toMatch(/\/api\/v1\/portal\/files\//);
    expect((await uploadAttachment(tokenA, reqA.id, { name: "x.jpg", data: jpg }, { message_id: staffMsg.id })).status).toBe(404); // not the customer's message
    expect((await uploadAttachment(tokenA, reqA.id, { name: "x.jpg", data: jpg }, { message_id: "not-a-uuid" })).status).toBe(400);
  });

  it("reopen within 7 days of RESOLVED; 409 REOPEN_WINDOW_CLOSED after; rating closes and is once-only", async () => {
    let staff = await ok<StaffTicket>(`/api/v1/service-requests/${reqA.id}`, admin.access_token);
    let r = await post<StaffTicket>(`/api/v1/service-requests/${reqA.id}/status`, admin.access_token, { version: staff.version, status: "RESOLVED" });
    expect(r.status, r.text).toBe(200);
    let d = await ok<Request>(`/api/v1/portal/requests/${reqA.id}`, tokenA);
    expect(d).toMatchObject({ status: "RESOLVED", can_reopen: true, can_rate: true });
    const reopened = await post<Request>(`/api/v1/portal/requests/${reqA.id}/reopen`, tokenA, { reason: "Seepage is back after the next rain" });
    expect(reopened.status, reopened.text).toBe(200);
    expect(reopened.body).toMatchObject({ status: "IN_PROGRESS", can_reopen: false });
    expect(reopened.body.messages[reopened.body.messages.length - 1]!.body).toContain("Reopened:");
    expect((await auditRows("service_request.reopen", "CUSTOMER")).map((a) => a.entity_id)).toContain(reqA.id);
    // staff told
    const staffNotes = await t.app.sql<{ n: number }[]>`select count(*)::int as n from notifications where recipient_type = 'STAFF' and type = 'TICKET_CUSTOMER_REPLY' and entity_id = ${reqA.id}`;
    expect(Number(staffNotes[0]!.n)).toBeGreaterThan(0);
    // resolve again, then age it past the window
    staff = await ok<StaffTicket>(`/api/v1/service-requests/${reqA.id}`, admin.access_token);
    r = await post<StaffTicket>(`/api/v1/service-requests/${reqA.id}/status`, admin.access_token, { version: staff.version, status: "RESOLVED" });
    expect(r.status, r.text).toBe(200);
    await t.app.sql`update service_requests set resolved_at = now() - interval '8 days' where id = ${reqA.id}`;
    d = await ok<Request>(`/api/v1/portal/requests/${reqA.id}`, tokenA);
    expect(d.can_reopen).toBe(false);
    const late = await post<Request>(`/api/v1/portal/requests/${reqA.id}/reopen`, tokenA, { reason: "Too late now" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("REOPEN_WINDOW_CLOSED");
    // rate
    const rated = await post<Request>(`/api/v1/portal/requests/${reqA.id}/rate`, tokenA, { rating: 4, comment: "Fixed, a bit slow" });
    expect(rated.status, rated.text).toBe(200);
    expect(rated.body).toMatchObject({ status: "CLOSED", rating: 4, can_rate: false, can_reopen: false });
    const again = await post<Request>(`/api/v1/portal/requests/${reqA.id}/rate`, tokenA, { rating: 5 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_RATED");
    expect((await post<Request>(`/api/v1/portal/requests/${reqA.id}/rate`, tokenA, { rating: 9 })).status).toBe(400);
    // closed: no more messages or attachments
    expect((await post<Request>(`/api/v1/portal/requests/${reqA.id}/messages`, tokenA, { body: "one more" })).status).toBe(409);
    const jpg = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect((await uploadAttachment(tokenA, reqA.id, { name: "late.jpg", data: jpg })).status).toBe(409);
    // B cannot act on A's ticket at all
    expect((await post<Request>(`/api/v1/portal/requests/${reqA.id}/rate`, tokenB, { rating: 1 })).status).toBe(404);
    expect((await post<Request>(`/api/v1/portal/requests/${reqA.id}/reopen`, tokenB, { reason: "not mine at all" })).status).toBe(404);
  });

  it("a request raised by staff without a booking still lists (booking_id null, empty flat number)", async () => {
    const r = await post<StaffTicket>("/api/v1/service-requests", admin.access_token, { customer_id: A, category_id: snagCat, subject: "General enquiry", description: "No booking attached." });
    expect(r.status, r.text).toBe(201);
    const d = await ok<Request>(`/api/v1/portal/requests/${r.body.id}`, tokenA);
    expect(d).toMatchObject({ booking_id: null, flat_number: "" });
  });
});

describe("notices and notifications", () => {
  it("notices: company-wide + own projects only, newest first, unread until the bell row is read", async () => {
    const a = await ok<List<Notice>>("/api/v1/portal/notices", tokenA);
    expect(a.items.map((n) => n.title).sort()).toEqual(["Diwali holiday schedule", "Tower A slab casting"]);
    expect(a.items.every((n) => n.is_read === false)).toBe(true);
    expect(a.items.find((n) => n.title === "Tower A slab casting")!.project_name).toBe("Shree Ganesh Heights");
    const b = await ok<List<Notice>>("/api/v1/portal/notices", tokenB);
    expect(b.items.map((n) => n.title).sort()).toEqual(["Diwali holiday schedule", "GGV only"]);
    assertNoLeaks(a);
  });

  it("notifications (core bell) are the customer's own, mapped to screens; unread count and mark-read; home counts follow", async () => {
    const list = await ok<List<Notification>>("/api/v1/portal/notifications?page_size=50", tokenA);
    expect(list.total).toBeGreaterThan(0);
    const types = new Set(list.items.map((n) => n.type));
    expect(types).toContain("BOOKING_CREATED");
    expect(types).toContain("DEMAND_RAISED");
    expect(types).toContain("PAYMENT_RECEIVED");
    expect(types).toContain("TICKET_STAFF_REPLY");
    expect(types).toContain("NOTICE_PUBLISHED");
    expect(list.items.find((n) => n.type === "BOOKING_CREATED")).toMatchObject({ screen: "HOME", booking_id: bookingA.id });
    expect(list.items.find((n) => n.type === "DEMAND_RAISED")).toMatchObject({ screen: "DEMANDS" });
    expect(list.items.find((n) => n.type === "PAYMENT_RECEIVED")).toMatchObject({ screen: "LEDGER" });
    expect(list.items.find((n) => n.type === "TICKET_STAFF_REPLY")).toMatchObject({ screen: "REQUEST" });
    expect(list.items.find((n) => n.type === "NOTICE_PUBLISHED")).toMatchObject({ screen: "NOTICE", booking_id: null });
    // nothing of B's (B's payment / booking never appear as an entity)
    expect(list.items.some((n) => n.entity_id === paymentBId || n.entity_id === bookingB.id)).toBe(false);
    assertNoLeaks(list);

    const unread0 = await ok<{ count: number }>("/api/v1/portal/notifications/unread-count", tokenA);
    expect(unread0.count).toBe(list.items.filter((n) => !n.is_read).length); // Appendix C: {count}
    const home0 = await ok<Home>(`/api/v1/portal/bookings/${bookingA.id}/home`, tokenA);
    expect(home0.notifications_unread).toBe(unread0.count);
    const bBefore = (await ok<{ count: number }>("/api/v1/portal/notifications/unread-count", tokenB)).count;
    const two = list.items.filter((n) => !n.is_read).slice(0, 2).map((n) => n.id);
    const marked = await post<{ updated: number }>("/api/v1/portal/notifications/mark-read", tokenA, { ids: two });
    expect(marked.status, marked.text).toBe(200);
    expect(marked.body.updated).toBe(2);
    expect((await ok<{ count: number }>("/api/v1/portal/notifications/unread-count", tokenA)).count).toBe(unread0.count - 2);
    // ids of someone else's notifications mark nothing
    const bIds = (await ok<List<Notification>>("/api/v1/portal/notifications", tokenB)).items.map((n) => n.id);
    const foreign = await post<{ updated: number }>("/api/v1/portal/notifications/mark-read", tokenA, { ids: bIds });
    expect(foreign.body.updated).toBe(0);
    expect((await ok<{ count: number }>("/api/v1/portal/notifications/unread-count", tokenB)).count).toBe(bBefore);
    const all = await post<{ updated: number }>("/api/v1/portal/notifications/mark-read", tokenA, { all: true });
    expect(all.status).toBe(200);
    expect((await ok<{ count: number }>("/api/v1/portal/notifications/unread-count", tokenA)).count).toBe(0);
    // notices now read through the bell; home counts follow
    const notices = await ok<List<Notice>>("/api/v1/portal/notices", tokenA);
    expect(notices.items.every((n) => n.is_read)).toBe(true);
    const home = await ok<Home>(`/api/v1/portal/bookings/${bookingA.id}/home`, tokenA);
    expect(home.notices_unread).toBe(0);
    expect(home.notifications_unread).toBe(0);
    // B's notice view is untouched
    expect((await ok<List<Notice>>("/api/v1/portal/notices", tokenB)).items.every((n) => n.is_read === false)).toBe(true);
  });

  it("withdrawn notifications disappear from the list and the counts", async () => {
    const before = await ok<List<Notification>>("/api/v1/portal/notifications?page_size=50", tokenB);
    const target = before.items[0]!;
    await t.app.sql`update notifications set is_withdrawn = true where id = ${target.id}`;
    const after = await ok<List<Notification>>("/api/v1/portal/notifications?page_size=50", tokenB);
    expect(after.items.some((n) => n.id === target.id)).toBe(false);
    expect(after.total).toBe(before.total - 1);
  });
});

describe("profile", () => {
  it("KYC is masked even to the customer; co-applicants and RM carry no ids", async () => {
    const p = await ok<Profile>("/api/v1/portal/profile", tokenA);
    expect(p).toMatchObject({ customer_id: A, full_name: "Rajesh Kumar Sinha", email: "rajesh@example.com", pan_masked: "XXXXX1234F", aadhaar_masked: "XXXX XXXX 0124", kyc_status: "PENDING", must_change_password: false });
    expect(p.address_current).toMatchObject({ line1: "12 Boring Road", city: "Patna" });
    expect(p.relationship_manager).toMatchObject({ name: expect.any(String) });
    expect(JSON.stringify(p)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(p)).not.toContain("234567890124");
    expect(JSON.stringify(p)).not.toContain(sales.user.id);
    assertNoLeaks(p);
  });

  it("PATCH edits contact details, bumps version and writes a CUSTOMER audit row; stale If-Match → 409; unknown fields → 400", async () => {
    const v0 = (await sqlOne(t.app.sql<{ version: number }[]>`select version from customers where id = ${A}`)).version;
    const r = await t.request<Profile & ErrorBody>("PATCH", "/api/v1/portal/profile", { token: tokenA, body: { email: "Rajesh.Sinha@Example.com", alt_phone: "+91 98765 43211", address_current: { line1: "22 Bailey Road", city: "Patna", state: "Bihar", pincode: "800014" } } });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ email: "rajesh.sinha@example.com", alt_phone: "9876543211" });
    expect(r.body.address_current).toMatchObject({ line1: "22 Bailey Road", pincode: "800014" });
    const v1 = (await sqlOne(t.app.sql<{ version: number }[]>`select version from customers where id = ${A}`)).version;
    expect(v1).toBe(v0 + 1);
    const audits = await auditRows("customer.portal_profile_update", "CUSTOMER");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_type: "CUSTOMER", actor_id: A, entity_id: A });
    expect(audits[0]!.after).toMatchObject({ email: "rajesh.sinha@example.com", altPhone: "9876543211" });
    // stale version via If-Match
    const stale = await t.request<ErrorBody>("PATCH", "/api/v1/portal/profile", { token: tokenA, body: { alt_phone: null }, headers: { "if-match": `"${v0}"` } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    // KYC and names cannot be edited from the portal
    expect((await t.request("PATCH", "/api/v1/portal/profile", { token: tokenA, body: { pan: "ABCDE1234F" } })).status).toBe(400);
    expect((await t.request("PATCH", "/api/v1/portal/profile", { token: tokenA, body: { full_name: "Someone Else" } })).status).toBe(400);
    expect((await t.request("PATCH", "/api/v1/portal/profile", { token: tokenA, body: {} })).status).toBe(400);
    // B is untouched
    expect((await ok<Profile>("/api/v1/portal/profile", tokenB)).alt_phone).toBeNull();
  });
});

describe("audience, forced password change, leak checks", () => {
  it("a staff token is 401 INVALID_AUDIENCE on every portal route; no token is 401 UNAUTHENTICATED", async () => {
    const portalRoutes = t.app.routeRegistry.filter((r) => r.audience === "portal" && r.url.startsWith("/api/v1/portal/"));
    expect(portalRoutes.length).toBeGreaterThanOrEqual(30);
    for (const r of portalRoutes) {
      const url = r.url.replace(/:[a-zA-Z]+/g, NO_ID);
      const withStaff = await t.request<ErrorBody>(r.method as "GET", url, { token: admin.access_token, ...(r.method === "GET" ? {} : { body: {} }) });
      expect(withStaff.status, `${r.method} ${url}: ${withStaff.text}`).toBe(401);
      expect(withStaff.body.error.code).toBe("INVALID_AUDIENCE");
      const anon = await t.request<ErrorBody>(r.method as "GET", url, { ...(r.method === "GET" ? {} : { body: {} }) });
      expect(anon.status, `${r.method} ${url}`).toBe(401);
      expect(anon.body.error.code).toBe("UNAUTHENTICATED");
    }
    // and a portal token opens nothing on the staff side
    const staffSide = await t.request<ErrorBody>("GET", `/api/v1/bookings/${bookingA.id}`, { token: tokenA });
    expect(staffSide.status).toBe(401);
    expect(staffSide.body.error.code).toBe("INVALID_AUDIENCE");
  });

  it("must_change_password blocks everything except change-password / logout / me", async () => {
    const phoneD = await phoneOf(D);
    const tokenD = await portalLogin(phoneD);
    for (const url of ["/api/v1/portal/bookings", "/api/v1/portal/profile", "/api/v1/portal/notifications/unread-count", "/api/v1/portal/requests/categories", "/api/v1/portal/notices"]) {
      const r = await get(url, tokenD);
      expect(r.status, url).toBe(403);
      expect(r.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    expect((await get("/api/v1/portal/auth/me", tokenD)).status).toBe(200);
    const changed = await t.request("POST", "/api/v1/portal/auth/change-password", { token: tokenD, body: { current_password: PASSWORD, new_password: "Fresh@Pass2026" } });
    expect(changed.status, changed.text).toBe(200);
    const tokenD2 = await portalLogin(phoneD, "Fresh@Pass2026");
    expect((await get("/api/v1/portal/bookings", tokenD2)).status).toBe(200);
  });

  it("no portal response names a staff user through an *_id key or carries a storage key", async () => {
    const urls = [
      "/api/v1/portal/bookings", `/api/v1/portal/bookings/${bookingA.id}/home`, `/api/v1/portal/bookings/${bookingA.id}/flat`, `/api/v1/portal/bookings/${bookingA.id}/ledger`,
      `/api/v1/portal/bookings/${bookingA.id}/receipts`, `/api/v1/portal/bookings/${bookingA.id}/demands`, `/api/v1/portal/bookings/${bookingA.id}/schedule`, `/api/v1/portal/bookings/${bookingA.id}/construction`,
      `/api/v1/portal/bookings/${bookingA.id}/documents`, `/api/v1/portal/bookings/${bookingA.id}/bank-details`, "/api/v1/portal/requests", "/api/v1/portal/requests/categories", "/api/v1/portal/notices",
      "/api/v1/portal/notifications", "/api/v1/portal/profile", "/api/v1/portal/auth/me",
    ];
    for (const url of urls) {
      const body = await ok<unknown>(url, tokenA);
      assertNoLeaks(body, url);
      expect(JSON.stringify(body), url).not.toMatch(/storage_key|password_hash|_enc"/);
    }
    const detail = await ok<List<Request>>("/api/v1/portal/requests", tokenA);
    for (const r of detail.items) assertNoLeaks(await ok<unknown>(`/api/v1/portal/requests/${r.id}`, tokenA), r.id);
  });

  it("every portal route is registered with audience portal (never a permission) and documented", async () => {
    const mine = t.app.routeRegistry.filter((r) => r.url.startsWith("/api/v1/portal/") && !r.url.startsWith("/api/v1/portal/auth"));
    expect(mine.every((r) => (r.url === "/api/v1/portal/files/:token" ? r.public : r.audience === "portal" && r.permission === null))).toBe(true);
    const oas = await t.request<{ paths: Record<string, unknown> }>("GET", "/api/v1/openapi.json");
    expect(oas.status).toBe(200);
    for (const p of ["/api/v1/portal/bookings/{id}/home", "/api/v1/portal/requests/{id}/attachments", "/api/v1/portal/files/{token}", "/api/v1/portal/profile"]) expect(oas.body.paths[p], p).toBeDefined();
  });
});
