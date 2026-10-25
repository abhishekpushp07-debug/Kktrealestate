import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { completeStage, createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Reports module (SPEC §14 reports / dashboards / branded PDFs, §11 receipt & demand-letter rules, §18 scenario 13):
 * fixtures are built through the money module's API (bookings, payments, cheque, bounce, reversal, cancellation, a completed stage),
 * then every report is reconciled against the source rows, every report is fetched as JSON / csv / pdf, PDFs are inspected for their
 * text (receipt number, amount in words, CANCELLED watermark, full bank account on demand letters), strict queries → 400, scope → filtered
 * rows / 404, dashboards return exactly the widgets of the caller's role, presets are per user.
 */

const L = 10_000_000; // ₹1,00,000 in paise
const CR = 100 * L;
const NO_ID = "00000000-0000-4000-8000-000000000000";

type Booking = { id: string; version: number; status: string; booking_number: string; flat_id: string; summary: { cash: { due_paise: number }; account: { due_paise: number } } };
type Payment = { id: string; version: number; receipt_number: string; status: string; amount_paise: number; bucket: string | null; receipt_cancelled: boolean };
type PostResponse = { payment: Payment };
type Demand = { id: string; demand_number: string; installment_seq: number; status: string; due_date: string; total_demand_paise: number; paid_paise: number };
type List<T> = { items: T[]; total: number };

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let projectsTok: string;
let employee: string;
let salesId: string;
let w: MoneyWorld;
let today: string;
let keyCounter = 0;
const key = () => `reports-${Date.now()}-${++keyCounter}`;

let b1: Booking; // SGH A-101 Villa CLP: account 4L paid, Excavation raised 100 days ago → outstanding cash 9L + account 2L
let b2: Booking; // SGH A-102 DP 10:85:5: cash 8L paid (advance 2L), account 4L due, cheque 3L pending
let b3: Booking; // GGV G-101: reversed UPI + bounced cheque → nothing counts, 10L due
let b4: Booking; // SGH U-101: cancelled with refund
let b1Excavation: Demand;
let b3Reversed: Payment;
let b3Bounced: Payment;
let b2Cheque: Payment;
let b1Receipt: Payment;

async function createBooking(flatId: string, customerId: string, extra: Record<string, unknown> = {}): Promise<Booking> {
  const body = { flat_id: flatId, customer_id: customerId, booking_date: today, agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L, plan_acceptance_mode: "IN_PERSON", plan_accepted_on: today, ...extra };
  const r = await t.request<Booking>("POST", "/api/v1/bookings", { token: sales, body, headers: { "idempotency-key": key() } });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

async function pay(bookingId: string, bucket: "CASH" | "ACCOUNT", amount: number, mode: "CASH" | "UPI" | "CHEQUE", extra: Record<string, unknown> = {}): Promise<Payment> {
  const modeExtra = mode === "CASH" ? {} : mode === "UPI" ? { instrument: { number: `UPI${++keyCounter}` }, bank_account_id: w.bankAccountId } : { instrument: { number: `CHQ${++keyCounter}`, date: addDays(today, 3), bank_name: "SBI" }, bank_account_id: w.bankAccountId };
  const body = { booking_id: bookingId, against: "FLAT_VALUE", bucket, amount_paise: amount, payment_date: today, payment_mode_id: w.modes[mode], ...modeExtra, ...extra };
  const r = await t.request<PostResponse>("POST", "/api/v1/payments", { token: accounts, body, headers: { "idempotency-key": key() } });
  expect(r.status, r.text).toBe(201);
  return r.body.payment;
}

async function getBooking(id: string): Promise<Booking> {
  const r = await t.request<Booking>("GET", `/api/v1/bookings/${id}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function demandsOf(id: string): Promise<Demand[]> {
  const r = await t.request<List<Demand>>("GET", `/api/v1/bookings/${id}/demands?page_size=200&sort=posted_at`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}

async function sum(query: string): Promise<number> {
  const rows = await t.app.sql.unsafe<{ n: string | number | null }[]>(query);
  return Number(rows[0]?.n ?? 0);
}

/** Raw PDF bytes of a GET (asserts 200 + application/pdf + %PDF-1 header). */
async function fetchPdf(url: string, token = admin): Promise<Buffer> {
  const res = await t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "10.9.9.9" } });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  expect(String(res.headers["content-type"])).toContain("application/pdf");
  expect(String(res.headers["content-disposition"])).toContain("attachment");
  const buf = res.rawPayload;
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buf.subarray(0, 8).toString("latin1")).toMatch(/^%PDF-1\./);
  return buf;
}

/** Text of a pdfkit PDF: inflates every content stream and decodes the WinAnsi hex strings of the TJ operators. */
function pdfText(buf: Buffer): string {
  const latin = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const raw = Buffer.from(m[1]!, "latin1");
    let content: string;
    try { content = inflateSync(raw).toString("latin1"); } catch { content = raw.toString("latin1"); }
    for (const tj of content.matchAll(/\[((?:<[0-9A-Fa-f]*>\s*-?[\d.]*\s*)+)\]\s*TJ/g)) {
      const hex = [...tj[1]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map((h) => h[1]!).join("");
      out.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return out.join("\n");
}

async function json<T = Record<string, unknown>>(url: string, token = admin): Promise<T> {
  const r = await t.request<T>("GET", url, { token });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  const s = await t.loginAs("sales");
  sales = s.access_token;
  salesId = s.user.id;
  projectsTok = (await t.loginAs("projects")).access_token;
  employee = (await t.loginAs("employee")).access_token;
  w = await createMoneyWorld(t, admin);
  const flats = [...w.sgh.flats.values()];
  const flatsU = [...w.sgh.flatsU.values()];
  const flatsG = [...w.ggv.flats.values()];

  // B1: Villa CLP (default) → ON_BOOKING 6L/4L; account 4L paid by UPI; Excavation completed 100 days ago → 5% raised (3L/2L), due 85 days ago
  b1 = await createBooking(flats[0]!.id, w.customers[0]!, { sales_user_id: salesId });
  b1Receipt = await pay(b1.id, "ACCOUNT", 4 * L, "UPI");
  await completeStage(t, w.sgh.towerId, w.stages.EXCAVATION, addDays(today, -100));
  const run = await t.request<{ demands_raised: number }>("POST", "/api/v1/dues/run", { token: admin, body: { block_id: w.sgh.towerId } });
  expect(run.status, run.text).toBe(200);
  b1Excavation = (await demandsOf(b1.id)).find((d) => d.installment_seq === 2)!;
  expect(b1Excavation).toBeDefined();

  // B2: Down Payment 10:85:5 → ON_BOOKING 6L/4L; cash 8L paid (2L advance); a cheque of 3L pending in the Account bucket
  b2 = await createBooking(flats[1]!.id, w.customers[1]!, { payment_plan_id: w.plans.DP, sales_user_id: salesId });
  await pay(b2.id, "CASH", 8 * L, "CASH");
  b2Cheque = await pay(b2.id, "ACCOUNT", 3 * L, "CHEQUE");

  // B3 (GGV): a UPI receipt reversed and a cheque bounced → neither counts anywhere
  b3 = await createBooking(flatsG[0]!.id, w.customers[2]!);
  b3Reversed = await pay(b3.id, "CASH", 5 * L, "UPI");
  const rev = await t.request<Payment>("POST", `/api/v1/payments/${b3Reversed.id}/reverse`, { token: accounts, body: { version: b3Reversed.version, reason: "Posted on the wrong booking" } });
  expect(rev.status, rev.text).toBe(200);
  b3Reversed = rev.body;
  const chq = await pay(b3.id, "ACCOUNT", 2 * L, "CHEQUE");
  const bounced = await t.request<Payment>("POST", `/api/v1/payments/${chq.id}/bounce`, { token: accounts, body: { version: chq.version, reason: "Insufficient funds" } });
  expect(bounced.status, bounced.text).toBe(200);
  b3Bounced = bounced.body;

  // B4 (SGH Tower U): 1L cash then cancelled with 50k deduction and 50k refund
  b4 = await createBooking(flatsU[0]!.id, w.customers[3]!);
  await pay(b4.id, "CASH", 1 * L, "CASH");
  const fresh = await getBooking(b4.id);
  const cancel = await t.request<Booking>("POST", `/api/v1/bookings/${b4.id}/cancel`, { token: admin, body: { version: fresh.version, reason: "Customer withdrew", deduction_paise: 50_000_00, refund_paise: 50_000_00 } });
  expect(cancel.status, cancel.text).toBe(201 === cancel.status ? 201 : 200);
  b4 = cancel.body;

  // leads / enquiry / brochure / site visit for the funnel and the sales dashboard
  const sql = t.app.sql;
  const [lead1] = await sql<{ id: string }[]>`insert into leads (company_id, lead_number, full_name, phone, project_id, source, stage, assigned_user_id) values (${t.companyId}, 'LD-T/0001', 'Web Lead', '9800000001', ${w.sgh.id}, 'WEBSITE', 'NEW', ${salesId}) returning id`;
  await sql`insert into lead_activities (lead_id, type, actor_type, actor_id, at) values (${lead1!.id}, 'FOLLOW_UP', 'STAFF', ${salesId}, now() + interval '2 hours')`;
  await sql`insert into leads (company_id, lead_number, full_name, phone, project_id, source, stage, assigned_user_id, next_follow_up_at) values (${t.companyId}, 'LD-T/0002', 'Brochure Lead', '9800000002', ${w.sgh.id}, 'BROCHURE', 'CONVERTED', ${salesId}, now())`;
  await sql`insert into enquiries (company_id, lead_id, project_id, name, phone, reference_number) values (${t.companyId}, ${lead1!.id}, ${w.sgh.id}, 'Web Lead', '9800000001', 'ENQ-T/0001')`;
  await sql`insert into brochure_downloads (company_id, project_id, lead_id, token_hash, expires_at, downloaded_at) values (${t.companyId}, ${w.sgh.id}, ${lead1!.id}, 'tok-1', now() + interval '1 day', now())`;
  await sql`insert into site_visits (company_id, visit_number, project_id, lead_id, visit_date, slot_start, slot_end, name, phone, status, assignee_user_id) values (${t.companyId}, 'SV-T/0001', ${w.sgh.id}, ${lead1!.id}, ${today}, '10:00', '11:00', 'Web Lead', '9800000001', 'CONFIRMED', ${salesId})`;

  // the Project Admin is scoped to SGH only
  const [pa] = await sql<{ id: string }[]>`select id from users where email = 'projects@sgb.in'`;
  await sql`insert into user_project_scopes (user_id, project_id) values (${pa!.id}, ${w.sgh.id})`;
  await t.app.redis.incr("perm:version");
}, 180_000);
afterAll(async () => { await t?.close(); });

// ---------------------------------------------------------------------------
describe("reconciliation with the ledger (SPEC §18 scenario 13)", () => {
  it("collections total = Σ CLEARED payments; PENDING, BOUNCED and REVERSED never count; each period row adds up and modes sum to the total", async () => {
    const r = await json<{ rows: { cash_paise: number; account_paise: number; other_paise: number; total_paise: number; count: number; by_mode: { amount_paise: number }[] }[]; totals: { total_paise: number; count: number; cash_paise: number; account_paise: number } }>(`/api/v1/reports/collections?from=${addDays(today, -1)}&to=${today}`);
    const cleared = await sum(`select coalesce(sum(amount_paise), 0) as n from payments where status = 'CLEARED'`);
    const everything = await sum(`select coalesce(sum(amount_paise), 0) as n from payments`);
    expect(r.totals.total_paise).toBe(cleared);
    expect(everything).toBeGreaterThan(cleared); // pending 3L + bounced 2L + reversed 5L are excluded
    expect(r.totals.total_paise).toBe(4 * L + 8 * L + 1 * L);
    expect(r.totals.cash_paise).toBe(9 * L);
    expect(r.totals.account_paise).toBe(4 * L);
    for (const row of r.rows) {
      expect(row.cash_paise + row.account_paise + row.other_paise).toBe(row.total_paise);
      expect(row.by_mode.reduce((s, m) => s + m.amount_paise, 0)).toBe(row.total_paise);
    }
    const reversedOnly = await json<{ totals: { total_paise: number } }>(`/api/v1/reports/collections?from=${today}&to=${today}&status=REVERSED`);
    expect(reversedOnly.totals.total_paise).toBe(5 * L);
    const monthly = await json<{ rows: { period: string }[] }>(`/api/v1/reports/collections?from=${today}&to=${today}&group_by=MONTH&category=CASH&mode_code=CASH`);
    expect(monthly.rows[0]?.period).toBe(today.slice(0, 7));
  });

  it("outstanding = Σ positive bucket dues of ACTIVE bookings, advances = Σ negative parts, ageing buckets sum to outstanding, cancelled bookings excluded", async () => {
    const r = await json<{ as_of: string; rows: { label: string; total_due_paise: number; ageing: Record<string, number> }[]; totals: { cash_due_paise: number; account_due_paise: number; total_due_paise: number; bookings: number; ageing: Record<string, number> }; top_overdue: { booking_number: string; overdue_paise: number; days_overdue: number; bucket: string }[] }>("/api/v1/reports/outstanding-ageing");
    const expected = await sum(`select coalesce(sum(greatest(0, cash_order_raised_paise - cash_paid_paise) + greatest(0, account_order_raised_paise - account_paid_paise)), 0) as n from bookings where status = 'ACTIVE'`);
    expect(r.totals.total_due_paise).toBe(expected);
    // B1: cash 6L + 3L, account 2L · B2: account 4L · B3: 10L
    expect(r.totals.total_due_paise).toBe(11 * L + 4 * L + 10 * L);
    expect(r.totals.cash_due_paise).toBe(9 * L + 6 * L);
    expect(r.totals.account_due_paise).toBe(2 * L + 4 * L + 4 * L);
    expect(r.totals.bookings).toBe(3);
    const ageingSum = Object.values(r.totals.ageing).reduce((s, v) => s + v, 0);
    expect(ageingSum).toBe(r.totals.total_due_paise);
    expect(r.totals.ageing["D61_90"]).toBe(5 * L); // Excavation demand due 85 days ago
    expect(r.totals.ageing["NOT_DUE"]).toBe(20 * L);
    for (const row of r.rows) expect(Object.values(row.ageing).reduce((s, v) => s + v, 0)).toBe(row.total_due_paise);
    expect(r.rows.map((x) => x.label).sort()).toEqual(["Ganesh Green Villas", "Shree Ganesh Heights"]);
    expect(r.top_overdue).toHaveLength(1);
    expect(r.top_overdue[0]).toMatchObject({ booking_number: b1.booking_number, overdue_paise: 5 * L, bucket: "D61_90" });
    expect(r.top_overdue[0]!.days_overdue).toBe(85);

    const adv = await json<{ rows: { booking_number: string; cash_advance_paise: number; account_advance_paise: number; next_installment_name: string | null }[]; totals: { total_advance_paise: number; count: number } }>("/api/v1/reports/advances");
    const expectedAdv = await sum(`select coalesce(sum(greatest(0, cash_paid_paise - cash_order_raised_paise) + greatest(0, account_paid_paise - account_order_raised_paise)), 0) as n from bookings where status = 'ACTIVE'`);
    expect(adv.totals.total_advance_paise).toBe(expectedAdv);
    expect(adv.totals.total_advance_paise).toBe(2 * L);
    expect(adv.rows).toHaveLength(1);
    expect(adv.rows[0]).toMatchObject({ booking_number: b2.booking_number, cash_advance_paise: 2 * L, account_advance_paise: 0, next_installment_name: "30 days" });
    const byCustomer = await json<{ rows: { label: string }[] }>("/api/v1/reports/outstanding-ageing?group_by=CUSTOMER&top_n=1");
    expect(byCustomer.rows).toHaveLength(3);
  });

  it("demand vs collection per installment/stage reconciles with demands; cheques, cancellations and bank-wise receipts reconcile with payments", async () => {
    const dvc = await json<{ rows: { label: string; block_name: string; demands_count: number; demanded_paise: number; collected_paise: number; outstanding_paise: number; collection_percent: number }[]; totals: { demanded_paise: number; collected_paise: number; outstanding_paise: number } }>(`/api/v1/reports/demand-vs-collection?project_id=${w.sgh.id}`);
    const demanded = await sum(`select coalesce(sum(total_demand_paise), 0) as n from demands where project_id = '${w.sgh.id}' and status in ('OPEN','PARTIALLY_PAID','PAID')`);
    const collected = await sum(`select coalesce(sum(paid_paise), 0) as n from demands where project_id = '${w.sgh.id}' and status in ('OPEN','PARTIALLY_PAID','PAID')`);
    expect(dvc.totals.demanded_paise).toBe(demanded);
    expect(dvc.totals.collected_paise).toBe(collected);
    expect(dvc.totals.outstanding_paise).toBe(demanded - collected);
    expect(dvc.rows.find((r) => r.label === "Excavation")).toMatchObject({ block_name: "Tower A", demands_count: 1, demanded_paise: 5 * L, collected_paise: 0, collection_percent: 0 });
    const byStage = await json<{ rows: { label: string }[] }>(`/api/v1/reports/demand-vs-collection?project_id=${w.sgh.id}&group_by=STAGE`);
    expect(byStage.rows.map((r) => r.label)).toEqual(expect.arrayContaining(["On booking", "Excavation"]));

    const pending = await json<{ items: { receipt_number: string; instrument_date: string | null; days_in_hand: number }[]; totals: { count: number; amount_paise: number } }>("/api/v1/reports/cheques");
    expect(pending.totals).toEqual({ count: 1, amount_paise: 3 * L });
    expect(pending.items[0]).toMatchObject({ receipt_number: b2Cheque.receipt_number, instrument_date: addDays(today, 3), days_in_hand: 0 });
    const bouncedRep = await json<{ items: { receipt_number: string; status: string; bounce_reason: string | null }[]; totals: { count: number } }>("/api/v1/reports/cheques?status=BOUNCED");
    expect(bouncedRep.items.map((i) => i.receipt_number)).toEqual([b3Bounced.receipt_number]);
    expect(bouncedRep.items[0]).toMatchObject({ status: "BOUNCED", bounce_reason: "Insufficient funds" });

    const canc = await json<{ rows: { booking_number: string; paid_paise: number; deduction_paise: number; refund_paise: number; reason: string }[]; totals: { count: number; refund_paise: number } }>(`/api/v1/reports/cancellations?from=${today}&to=${today}`);
    expect(canc.totals).toMatchObject({ count: 1, refund_paise: 50_000_00 });
    expect(canc.rows[0]).toMatchObject({ booking_number: b4.booking_number, paid_paise: 1 * L, deduction_paise: 50_000_00, refund_paise: 50_000_00, reason: "Customer withdrew" });

    const bank = await json<{ rows: { bank_account_id: string | null; bank_account_label: string; amount_paise: number; by_mode: { mode_code: string; amount_paise: number }[] }[]; totals: { amount_paise: number; count: number } }>(`/api/v1/reports/bankwise-receipts?from=${today}&to=${today}`);
    const cleared = await sum(`select coalesce(sum(amount_paise), 0) as n from payments where status = 'CLEARED'`);
    expect(bank.totals.amount_paise).toBe(cleared);
    expect(bank.rows.find((r) => r.bank_account_id === w.bankAccountId)).toMatchObject({ amount_paise: 4 * L, by_mode: [{ mode_code: "UPI", amount_paise: 4 * L }] });
    expect(bank.rows.find((r) => r.bank_account_id === null)).toMatchObject({ amount_paise: 9 * L });
    for (const row of bank.rows) expect(row.by_mode.reduce((s, m) => s + m.amount_paise, 0)).toBe(row.amount_paise);
  });

  it("upcoming dues lists the time-triggered installment of the DP plan (85% at 30 days) and the roznamcha range matches cleared cash", async () => {
    const r = await json<{ rows: { booking_number: string; installment_name: string; expected_date: string; is_estimate: boolean; total_paise: number; cash_paise: number; account_paise: number }[]; by_month: { total_paise: number }[]; totals: { total_paise: number; count: number } }>(`/api/v1/reports/upcoming-dues?from=${today}&to=${addDays(today, 60)}`);
    const dp = r.rows.find((x) => x.booking_number === b2.booking_number);
    expect(dp).toMatchObject({ installment_name: "30 days", expected_date: addDays(today, 30), is_estimate: false, cash_paise: 51 * L, account_paise: 34 * L, total_paise: 85 * L });
    expect(r.totals.total_paise).toBe(r.rows.reduce((s, x) => s + x.total_paise, 0));
    expect(r.by_month.reduce((s, m) => s + m.total_paise, 0)).toBe(r.totals.total_paise);
    const none = await json<{ rows: unknown[] }>(`/api/v1/reports/upcoming-dues?from=${addDays(today, 100)}&to=${addDays(today, 120)}`);
    expect(none.rows).toHaveLength(0);

    const roz = await json<{ receipts: { amount_paise: number }[]; cash_received_paise: number; totals: { receipts_paise: number; pending_cheques_paise: number } }>(`/api/v1/reports/roznamcha?from=${today}&to=${today}`);
    expect(roz.totals.receipts_paise).toBe(13 * L);
    expect(roz.cash_received_paise).toBe(9 * L);
    expect(roz.totals.pending_cheques_paise).toBe(3 * L);
  });

  it("inventory, sales funnel and activity reports reflect the fixture", async () => {
    const inv = await json<{ by_block: { label: string; booked: number; available: number; total: number; sold_value_paise: number }[]; by_type: { label: string }[]; by_floor: { floor: number }[]; totals: { total: number; booked: number }; velocity: { month: string; bookings: number; cancellations: number }[]; realised_rate: { flat_type_name: string; realised_rate_paise: number | null; rate_card_rate_paise: number | null; bookings: number }[] }>("/api/v1/reports/inventory");
    const flatCount = await sum("select count(*) as n from flats");
    expect(inv.totals.total).toBe(flatCount);
    expect(inv.totals.booked).toBe(3);
    const towerA = inv.by_block.find((b) => b.label === "Tower A")!;
    expect(towerA).toMatchObject({ booked: 2, total: 12 });
    expect(towerA.sold_value_paise).toBeGreaterThan(0);
    expect(inv.by_type.length).toBe(4);
    expect(inv.by_floor.length).toBeGreaterThan(0);
    const thisMonth = inv.velocity.find((v) => v.month === today.slice(0, 7))!;
    expect(thisMonth).toMatchObject({ bookings: 4, cancellations: 1 });
    expect(inv.realised_rate.reduce((s, r) => s + r.bookings, 0)).toBe(3);
    expect(inv.realised_rate.every((r) => r.realised_rate_paise === null || r.realised_rate_paise > 0)).toBe(true);
    const scoped = await json<{ totals: { total: number } }>(`/api/v1/reports/inventory?project_id=${w.ggv.id}`);
    expect(scoped.totals.total).toBe(8);

    const funnel = await json<{ by_stage: { stage: string; count: number }[]; by_source: { source: string; leads: number; converted: number; conversion_percent: number }[]; by_salesperson: { user_id: string; leads: number; visits: number; bookings: number; booking_value_paise: number; avg_first_response_hours: number | null }[]; website: { enquiries: number; brochure_downloads: number; site_visits_booked: number; site_visits_by_status: { status: string; count: number }[] }; avg_response_hours: number | null; totals: { leads: number; converted: number; lost: number; bookings: number } }>(`/api/v1/reports/sales-funnel?from=${today}&to=${today}`);
    expect(funnel.totals).toEqual({ leads: 2, converted: 1, lost: 0, bookings: 4 });
    expect(funnel.by_stage.find((s) => s.stage === "NEW")?.count).toBe(1);
    expect(funnel.by_source.find((s) => s.source === "BROCHURE")).toMatchObject({ leads: 1, converted: 1, conversion_percent: 100 });
    const me = funnel.by_salesperson.find((s) => s.user_id === salesId)!;
    expect(me).toMatchObject({ leads: 2, visits: 1, bookings: 2, booking_value_paise: 2 * CR });
    expect(me.avg_first_response_hours).toBeCloseTo(2, 0);
    expect(funnel.avg_response_hours).toBeCloseTo(2, 0);
    expect(funnel.website).toMatchObject({ enquiries: 1, brochure_downloads: 1, site_visits_booked: 1, site_visits_by_status: [{ status: "CONFIRMED", count: 1 }] });
    const filtered = await json<{ totals: { leads: number } }>(`/api/v1/reports/sales-funnel?from=${today}&to=${today}&source=WEBSITE`);
    expect(filtered.totals.leads).toBe(1);

    await t.request("POST", "/api/v1/auth/login", { body: { email: "sales@sgb.in", password: "Wrong@12345" } });
    const audit = await json<List<{ kind: string; action: string }>>("/api/v1/reports/activity?page_size=5");
    expect(audit.total).toBeGreaterThan(0);
    expect(audit.items.every((i) => i.kind === "AUDIT")).toBe(true);
    const logins = await json<List<{ kind: string; identifier: string | null }>>("/api/v1/reports/activity?kind=LOGIN");
    expect(logins.total).toBeGreaterThanOrEqual(5);
    expect(logins.items[0]?.kind).toBe("LOGIN");
    const failed = await json<List<{ kind: string; identifier: string | null; reason: string | null }>>("/api/v1/reports/activity?kind=FAILED_LOGIN");
    expect(failed.total).toBeGreaterThanOrEqual(1);
    expect(failed.items.some((i) => i.identifier === "sales@sgb.in")).toBe(true);
    const paymentsAudit = await json<List<{ action: string }>>("/api/v1/reports/activity?entity_type=payment&page_size=200");
    expect(paymentsAudit.items.every((i) => i.action.startsWith("payment."))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("formats: every report answers JSON, csv and pdf; catalogue; strict queries", () => {
  it("GET /reports lists every key with path, formats and params", async () => {
    const r = await json<{ reports: { key: string; path: string; formats: string[]; required_params: string[] }[] }>("/api/v1/reports");
    expect(r.reports).toHaveLength(15);
    expect(r.reports.map((x) => x.key)).toEqual(expect.arrayContaining(["COLLECTIONS", "OUTSTANDING_AGEING", "ADVANCES", "DEMAND_VS_COLLECTION", "UPCOMING_DUES", "INVENTORY", "CUSTOMER_STATEMENT", "PAYMENT_SCHEDULE", "ALLOTMENT_LETTER", "CHEQUES", "CANCELLATIONS", "SALES_FUNNEL", "ROZNAMCHA", "BANKWISE_RECEIPTS", "ACTIVITY"]));
    expect(r.reports.find((x) => x.key === "COLLECTIONS")).toMatchObject({ path: "/reports/collections", formats: ["csv", "pdf"], required_params: ["from", "to"] });
  });

  it("every report returns 200 as JSON, text/csv (format=csv and export=CSV) and application/pdf starting with %PDF-1", async () => {
    const range = `from=${addDays(today, -30)}&to=${addDays(today, 60)}`;
    const urls = [
      `/api/v1/reports/collections?${range}`,
      "/api/v1/reports/outstanding-ageing",
      "/api/v1/reports/advances",
      `/api/v1/reports/demand-vs-collection?project_id=${w.sgh.id}`,
      `/api/v1/reports/upcoming-dues?${range}`,
      "/api/v1/reports/inventory",
      `/api/v1/reports/customer-statement?booking_id=${b1.id}`,
      `/api/v1/reports/payment-schedule?booking_id=${b1.id}`,
      "/api/v1/reports/cheques",
      "/api/v1/reports/cheques?status=BOUNCED",
      `/api/v1/reports/cancellations?${range}`,
      `/api/v1/reports/sales-funnel?${range}`,
      `/api/v1/reports/roznamcha?${range}`,
      `/api/v1/reports/bankwise-receipts?${range}`,
      "/api/v1/reports/activity",
      "/api/v1/reports/activity?kind=LOGIN",
    ];
    for (const url of urls) {
      const sep = url.includes("?") ? "&" : "?";
      const j = await t.request("GET", url, { token: admin });
      expect(j.status, `${url}: ${j.text}`).toBe(200);
      expect(String(j.headers["content-type"])).toContain("application/json");
      const csv = await t.request("GET", `${url}${sep}format=csv`, { token: admin });
      expect(csv.status, `${url} csv: ${csv.text}`).toBe(200);
      expect(String(csv.headers["content-type"])).toContain("text/csv");
      expect(String(csv.headers["content-disposition"])).toContain("attachment");
      expect(csv.text.split("\r\n")[0]!.length).toBeGreaterThan(0);
      const csv2 = await t.request("GET", `${url}${sep}export=CSV`, { token: admin });
      expect(csv2.status, `${url} export=CSV`).toBe(200);
      expect(String(csv2.headers["content-type"])).toContain("text/csv");
      const pdf = await fetchPdf(`${url}${sep}format=pdf`);
      expect(pdf.length).toBeGreaterThan(1000);
      const text = pdfText(pdf);
      expect(text).toContain("Shree Ganesh Builders");
      expect(text).toMatch(/Page 1 of \d+/);
      expect(text).toContain("IST");
    }
    const allot = await fetchPdf(`/api/v1/reports/allotment-letter?booking_id=${b1.id}&export=PDF`);
    expect(pdfText(allot)).toContain("ALLOTMENT LETTER");
    const allotJson = await json<{ booking_number: string; agreement_value_words: string; schedule: unknown[]; project_address: string }>(`/api/v1/reports/allotment-letter?booking_id=${b1.id}`);
    expect(allotJson.booking_number).toBe(b1.booking_number);
    expect(allotJson.agreement_value_words).toBe("Rupees One Crore Only");
    expect(allotJson.schedule).toHaveLength(10);
  });

  it("csv exports carry the report rows with RFC 4180 headers and the totals reconcile with JSON", async () => {
    const r = await t.request("GET", "/api/v1/reports/outstanding-ageing?format=csv", { token: admin });
    const lines = r.text.trim().split("\r\n");
    expect(lines[0]).toBe("label,bookings,cash_due_paise,account_due_paise,total_due_paise,NOT_DUE,D0_30,D31_60,D61_90,D90_PLUS");
    expect(lines).toHaveLength(3);
    const total = lines.slice(1).reduce((s, l) => s + Number(l.split(",")[4]), 0);
    expect(total).toBe(25 * L);
    const cheques = await t.request("GET", "/api/v1/reports/cheques?format=csv", { token: admin });
    expect(cheques.text).toContain(b2Cheque.receipt_number);
  });

  it("unknown query parameters, bad enums and from > to are 400 VALIDATION_ERROR; required params are enforced", async () => {
    const unknown = await t.request<ErrorBody>("GET", `/api/v1/reports/collections?from=${today}&to=${today}&foo=1`, { token: admin });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("VALIDATION_ERROR");
    const badEnum = await t.request<ErrorBody>("GET", `/api/v1/reports/collections?from=${today}&to=${today}&group_by=YEAR`, { token: admin });
    expect(badEnum.status).toBe(400);
    const missing = await t.request<ErrorBody>("GET", "/api/v1/reports/collections", { token: admin });
    expect(missing.status).toBe(400);
    const reversed = await t.request<ErrorBody>("GET", `/api/v1/reports/collections?from=${today}&to=${addDays(today, -5)}`, { token: admin });
    expect(reversed.status).toBe(400);
    const badFormat = await t.request<ErrorBody>("GET", "/api/v1/reports/advances?format=xlsx", { token: admin });
    expect(badFormat.status).toBe(400);
    const noProject = await t.request<ErrorBody>("GET", "/api/v1/reports/demand-vs-collection", { token: admin });
    expect(noProject.status).toBe(400);
    const dashUnknown = await t.request<ErrorBody>("GET", "/api/v1/dashboard?role=OWNER", { token: admin });
    expect(dashUnknown.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("branded PDFs: receipt, demand letter, allotment letter, statement (SPEC §11, §14)", () => {
  it("receipt PDF carries the receipt number, the amount in words ending in Only, the letterhead and page footer; a reversed receipt is watermarked CANCELLED", async () => {
    const ok = await fetchPdf(`/api/v1/payments/${b1Receipt.id}/receipt.pdf`, accounts);
    const text = pdfText(ok);
    expect(text).toContain(b1Receipt.receipt_number);
    expect(text).toContain("Rupees Four Lakh Only");
    expect(text).toContain("Only");
    expect(text).toContain("Shree Ganesh Builders");
    expect(text).toContain("GSTIN 10AABCS1234A1Z5");
    expect(text).toContain("PAYMENT RECEIPT");
    expect(text).toContain("Page 1 of 1");
    expect(text).toMatch(/Rs\. 4,00,000|₹4,00,000/);
    expect(text).not.toContain("CANCELLED");
    expect(text).not.toContain("subject to realisation");

    const reversed = await fetchPdf(`/api/v1/payments/${b3Reversed.id}/receipt.pdf`, accounts);
    const rt = pdfText(reversed);
    expect(rt).toContain("CANCELLED");
    expect(rt).toContain(b3Reversed.receipt_number);
    expect(rt).toContain("Rupees Five Lakh Only");

    const pending = await fetchPdf(`/api/v1/payments/${b2Cheque.id}/receipt.pdf`, accounts);
    const pt = pdfText(pending);
    expect(pt).toContain("subject to realisation of the cheque");
    expect(pt).not.toContain("CANCELLED");

    const bounced = await fetchPdf(`/api/v1/payments/${b3Bounced.id}/receipt.pdf`, accounts);
    expect(pdfText(bounced)).toContain("CANCELLED");
  });

  it("demand letter PDF shows both buckets, the due date and the FULL bank account number for the Account bucket", async () => {
    const pdf = await fetchPdf(`/api/v1/bookings/${b1.id}/demands/${b1Excavation.id}/letter.pdf`, accounts);
    const text = pdfText(pdf);
    expect(text).toContain("DEMAND LETTER");
    expect(text).toContain(b1Excavation.demand_number);
    expect(text).toContain(w.bankAccountNumber);
    expect(text).toContain("HDFC0000123");
    expect(text).toContain("Rupees Five Lakh Only");
    expect(text).toMatch(/Rs\. 3,00,000|₹3,00,000/);
    expect(text).toMatch(/Rs\. 2,00,000|₹2,00,000/);
    const wrongBooking = await t.request<ErrorBody>("GET", `/api/v1/bookings/${b2.id}/demands/${b1Excavation.id}/letter.pdf`, { token: accounts });
    expect(wrongBooking.status).toBe(404);
  });

  it("allotment letter and statement PDFs download; the statement JSON reconciles with the booking and lists the pending cheque", async () => {
    const allot = await fetchPdf(`/api/v1/bookings/${b1.id}/allotment-letter.pdf`, sales);
    const at = pdfText(allot);
    expect(at).toContain("ALLOTMENT LETTER");
    expect(at).toContain(b1.booking_number);
    expect(at).toContain("Rupees One Crore Only");
    expect(at).toContain("RERA BRERAP00123-1/23");

    const st = await json<{ booking: { booking_number: string; status: string; agreement_value_paise: number }; ledger: { event: string; total_due_paise: number }[]; schedule: { status: string }[]; pending_cheques: { receipt_number: string }[]; summary: { total_due_paise: number; cash_due_paise: number; account_due_paise: number; pending_cheques_paise: number }; revisions: unknown[]; other_charges: unknown[] }>(`/api/v1/reports/customer-statement?booking_id=${b2.id}`);
    expect(st.booking).toMatchObject({ booking_number: b2.booking_number, status: "ACTIVE", agreement_value_paise: CR });
    expect(st.summary).toMatchObject({ cash_due_paise: -2 * L, account_due_paise: 4 * L, total_due_paise: 2 * L, pending_cheques_paise: 3 * L });
    expect(st.pending_cheques.map((c) => c.receipt_number)).toEqual([b2Cheque.receipt_number]);
    expect(st.ledger.map((r) => r.event)).toEqual(["DEMAND", "PAYMENT"]);
    expect(st.ledger[st.ledger.length - 1]!.total_due_paise).toBe(st.summary.total_due_paise);
    expect(st.schedule).toHaveLength(3);
    expect(st.schedule[0]!.status).toBe("PARTIALLY_PAID");
    const stPdf = await fetchPdf(`/api/v1/bookings/${b2.id}/statement.pdf`, sales);
    const text = pdfText(stPdf);
    expect(text).toContain("STATEMENT OF ACCOUNT");
    expect(text).toContain(b2.booking_number);
    expect(text).toContain("(advance)");
    expect(text).toContain("Cheques in hand");
    const csv = await t.request("GET", `/api/v1/reports/customer-statement?booking_id=${b2.id}&format=csv`, { token: admin });
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[0]).toContain("total_due_paise");
  });

  it("documents are permission-guarded and scope-checked (404, never 403, outside scope; unknown ids 404)", async () => {
    const noPerm = await t.request<ErrorBody>("GET", `/api/v1/payments/${b1Receipt.id}/receipt.pdf`, { token: sales });
    expect(noPerm.status).toBe(403);
    const noReport = await t.request<ErrorBody>("GET", "/api/v1/reports/advances", { token: sales });
    expect(noReport.status).toBe(403);
    const employeeDash = await t.request("GET", "/api/v1/dashboard", { token: employee });
    expect(employeeDash.status).toBe(200);
    const missing = await t.request<ErrorBody>("GET", `/api/v1/payments/${NO_ID}/receipt.pdf`, { token: accounts });
    expect(missing.status).toBe(404);
    const missingBooking = await t.request<ErrorBody>("GET", `/api/v1/bookings/${NO_ID}/statement.pdf`, { token: admin });
    expect(missingBooking.status).toBe(404);
    // Project Admin is scoped to SGH: GGV documents and reports behave as not found
    const outOfScope = await t.request<ErrorBody>("GET", `/api/v1/bookings/${b3.id}/allotment-letter.pdf`, { token: projectsTok });
    expect(outOfScope.status).toBe(404);
    expect(outOfScope.body.error.code).toBe("NOT_FOUND");
    const inScope = await fetchPdf(`/api/v1/bookings/${b1.id}/statement.pdf`, projectsTok);
    expect(inScope.length).toBeGreaterThan(1000);
    const stOut = await t.request<ErrorBody>("GET", `/api/v1/reports/customer-statement?booking_id=${b3.id}`, { token: projectsTok });
    expect(stOut.status).toBe(404);
    const dvcOut = await t.request<ErrorBody>("GET", `/api/v1/reports/demand-vs-collection?project_id=${w.ggv.id}`, { token: projectsTok });
    expect(dvcOut.status).toBe(404);
    const collOut = await t.request<ErrorBody>("GET", `/api/v1/reports/collections?from=${today}&to=${today}&project_id=${w.ggv.id}`, { token: projectsTok });
    expect(collOut.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("project scope filters report rows", () => {
  it("a Project Admin scoped to SGH sees only SGH rows in outstanding, inventory, cheques, collections and the funnel", async () => {
    const out = await json<{ rows: { label: string }[]; totals: { total_due_paise: number; bookings: number } }>("/api/v1/reports/outstanding-ageing", projectsTok);
    expect(out.rows.map((r) => r.label)).toEqual(["Shree Ganesh Heights"]);
    expect(out.totals.bookings).toBe(2);
    expect(out.totals.total_due_paise).toBe(15 * L);
    const inv = await json<{ totals: { total: number }; by_block: { label: string }[] }>("/api/v1/reports/inventory", projectsTok);
    expect(inv.by_block.map((b) => b.label).sort()).toEqual(["Tower A", "Tower U"]);
    const bounced = await json<{ totals: { count: number } }>("/api/v1/reports/cheques?status=BOUNCED", projectsTok);
    expect(bounced.totals.count).toBe(0); // the bounced cheque is on GGV
    const coll = await json<{ totals: { total_paise: number } }>(`/api/v1/reports/collections?from=${today}&to=${today}`, projectsTok);
    expect(coll.totals.total_paise).toBe(13 * L); // GGV had no cleared money anyway; the reversed UPI never counts
    const adminColl = await json<{ totals: { total_paise: number } }>(`/api/v1/reports/collections?from=${today}&to=${today}`, admin);
    expect(adminColl.totals.total_paise).toBe(coll.totals.total_paise);
    const schedule = await t.request<ErrorBody>("GET", `/api/v1/reports/payment-schedule?booking_id=${b3.id}`, { token: projectsTok });
    expect(schedule.status).toBe(404);
    const funnel = await json<{ totals: { leads: number } }>(`/api/v1/reports/sales-funnel?from=${today}&to=${today}`, projectsTok);
    expect(funnel.totals.leads).toBe(2);
    const upcoming = await json<{ rows: { booking_number: string }[] }>(`/api/v1/reports/upcoming-dues?from=${today}&to=${addDays(today, 60)}`, projectsTok);
    expect(upcoming.rows.every((r) => r.booking_number !== b3.booking_number)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("saved presets (per user)", () => {
  it("create, list (own only), delete; duplicates 409; another user's preset is 404; audit rows written", async () => {
    const create = await t.request<{ id: string; report_key: string; name: string; params: Record<string, unknown> }>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "COLLECTIONS", name: "This month cash", params: { group_by: "DAY", category: "CASH" } }, headers: { "idempotency-key": key() } });
    expect(create.status, create.text).toBe(201);
    expect(create.body).toMatchObject({ report_key: "COLLECTIONS", name: "This month cash", params: { group_by: "DAY", category: "CASH" } });
    const dup = await t.request<ErrorBody>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "COLLECTIONS", name: "This month cash", params: {} } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_PRESET");
    const badKey = await t.request<ErrorBody>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "NOPE", name: "x", params: {} } });
    expect(badKey.status).toBe(400);
    const mine = await json<{ items: { id: string }[] }>("/api/v1/reports/presets", accounts);
    expect(mine.items.map((p) => p.id)).toEqual([create.body.id]);
    const filtered = await json<{ items: { id: string }[] }>("/api/v1/reports/presets?report_key=INVENTORY", accounts);
    expect(filtered.items).toHaveLength(0);
    const others = await json<{ items: { id: string }[] }>("/api/v1/reports/presets", admin);
    expect(others.items).toHaveLength(0);
    const notMine = await t.request<ErrorBody>("DELETE", `/api/v1/reports/presets/${create.body.id}`, { token: admin });
    expect(notMine.status).toBe(404);
    const del = await t.request("DELETE", `/api/v1/reports/presets/${create.body.id}`, { token: accounts });
    expect(del.status).toBe(204);
    const after = await json<{ items: unknown[] }>("/api/v1/reports/presets", accounts);
    expect(after.items).toHaveLength(0);
    const audits = await t.app.sql<{ action: string }[]>`select action from audit_logs where entity_type = 'report_preset' and entity_id = ${create.body.id} order by created_at`;
    expect(audits.map((a) => a.action)).toEqual(["report_preset.create", "report_preset.delete"]);
  });
});

// ---------------------------------------------------------------------------
describe("dashboards per role (SPEC §14)", () => {
  const widgets = {
    OWNER: ["collections_12m", "due_ageing", "inventory_by_project", "sales_velocity", "top_overdue", "pending_cheques", "enquiries_this_week", "construction_progress", "dues_raised_this_month", "upcoming_installments_30d", "totals"],
    ACCOUNTS: ["today", "this_month", "cheques_to_clear", "overdue_demands", "bounced_recent", "demand_status_counts"],
    SALES: ["pipeline", "follow_ups_due", "new_enquiries", "brochure_leads_this_week", "todays_visits", "availability", "my_bookings"],
    PROJECT_ADMIN: ["projects", "construction", "upcoming_stages", "demands_raised_this_month", "bookings_this_month", "open_tickets"],
    EMPLOYEE: ["projects", "notices"],
  };

  it("Owner: 12-month collections by bucket, ageing, inventory, velocity, top overdue, cheques, enquiries, progress, dues raised, upcoming 30 days", async () => {
    const r = await json<{ role: string; data: Record<string, unknown> & { collections_12m: { month: string; cash_paise: number; account_paise: number; total_paise: number }[]; due_ageing: Record<string, number>; top_overdue: { booking_number: string }[]; pending_cheques: { count: number; amount_paise: number }; inventory_by_project: { project_name: string; booked: number; construction_percent: number }[]; sales_velocity: { month: string; bookings: number }[]; enquiries_this_week: number; construction_progress: { block_name: string; percent: number; current_stage: string | null }[]; dues_raised_this_month: { count: number; amount_paise: number }; upcoming_installments_30d: { count: number; amount_paise: number }; totals: { total_due_paise: number; total_advance_paise: number; collected_this_month_paise: number; active_bookings: number } } }>("/api/v1/dashboard", admin);
    expect(r.role).toBe("OWNER");
    expect(Object.keys(r.data).sort()).toEqual([...widgets.OWNER].sort());
    expect(r.data.collections_12m).toHaveLength(12);
    const cur = r.data.collections_12m[11]!;
    expect(cur.month).toBe(today.slice(0, 7));
    expect(cur).toMatchObject({ cash_paise: 9 * L, account_paise: 4 * L, total_paise: 13 * L });
    expect(Object.values(r.data.due_ageing).reduce((s, v) => s + v, 0)).toBe(25 * L);
    expect(r.data.top_overdue[0]?.booking_number).toBe(b1.booking_number);
    expect(r.data.pending_cheques).toEqual({ count: 1, amount_paise: 3 * L });
    expect(r.data.inventory_by_project.find((p) => p.project_name === "Shree Ganesh Heights")).toMatchObject({ booked: 2 });
    expect(r.data.sales_velocity[11]).toMatchObject({ month: today.slice(0, 7), bookings: 4 });
    expect(r.data.enquiries_this_week).toBe(1);
    expect(r.data.construction_progress.find((b) => b.block_name === "Tower A")).toMatchObject({ current_stage: "Excavation" });
    expect(r.data.construction_progress.find((b) => b.block_name === "Tower A")!.percent).toBeGreaterThan(0);
    expect(r.data.dues_raised_this_month.count).toBeGreaterThanOrEqual(3);
    expect(r.data.upcoming_installments_30d).toMatchObject({ count: 1, amount_paise: 85 * L });
    expect(r.data.totals).toMatchObject({ total_due_paise: 25 * L, total_advance_paise: 2 * L, collected_this_month_paise: 13 * L, active_bookings: 3 });
    const scoped = await json<{ data: { inventory_by_project: { project_name: string }[]; totals: { total_due_paise: number } } }>(`/api/v1/dashboard?project_id=${w.ggv.id}`, admin);
    expect(scoped.data.inventory_by_project.map((p) => p.project_name)).toEqual(["Ganesh Green Villas"]);
    expect(scoped.data.totals.total_due_paise).toBe(10 * L);
    const keys = await t.app.redis.keys("dash:*");
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(await t.app.redis.ttl(keys[0]!)).toBeLessThanOrEqual(15);
  });

  it("Accounts: today/month collections, cheques to clear, overdue demands, bounced alerts, demand status counts", async () => {
    const r = await json<{ role: string; data: Record<string, unknown> & { today: { count: number; amount_paise: number }; this_month: { amount_paise: number; by_category: { category: string; amount_paise: number }[] }; cheques_to_clear: { receipt_number: string }[]; overdue_demands: { demand_number: string; days_overdue: number }[]; bounced_recent: { receipt_number: string }[]; demand_status_counts: { status: string; count: number }[] } }>("/api/v1/dashboard", accounts);
    expect(r.role).toBe("ACCOUNTS");
    expect(Object.keys(r.data).sort()).toEqual([...widgets.ACCOUNTS].sort());
    expect(r.data.today).toEqual({ count: 3, amount_paise: 13 * L });
    expect(r.data.this_month.amount_paise).toBe(13 * L);
    expect(r.data.this_month.by_category.reduce((s, c) => s + c.amount_paise, 0)).toBe(13 * L);
    expect(r.data.cheques_to_clear.map((c) => c.receipt_number)).toEqual([b2Cheque.receipt_number]);
    expect(r.data.overdue_demands.map((d) => d.demand_number)).toEqual([b1Excavation.demand_number]);
    expect(r.data.overdue_demands[0]!.days_overdue).toBe(85);
    expect(r.data.bounced_recent.map((c) => c.receipt_number)).toEqual([b3Bounced.receipt_number]);
    expect(r.data.demand_status_counts.reduce((s, c) => s + c.count, 0)).toBeGreaterThanOrEqual(4);
  });

  it("Sales: pipeline, follow-ups due, new enquiries, brochure leads this week, today's site visits, availability, my bookings", async () => {
    const r = await json<{ role: string; data: Record<string, unknown> & { pipeline: { stage: string; count: number }[]; follow_ups_due: { lead_number: string }[]; new_enquiries: number; brochure_leads_this_week: number; todays_visits: { visit_number: string; slot_start: string; status: string }[]; availability: { project_name: string }[]; my_bookings: { this_month: number; total: number; value_paise: number } } }>("/api/v1/dashboard", sales);
    expect(r.role).toBe("SALES");
    expect(Object.keys(r.data).sort()).toEqual([...widgets.SALES].sort());
    expect(r.data.pipeline).toHaveLength(7);
    expect(r.data.pipeline.find((p) => p.stage === "NEW")?.count).toBe(1);
    expect(r.data.follow_ups_due).toHaveLength(0); // the only lead with a follow-up is CONVERTED
    expect(r.data.new_enquiries).toBe(1);
    expect(r.data.brochure_leads_this_week).toBe(1);
    expect(r.data.todays_visits.map((v) => v.visit_number)).toEqual(["SV-T/0001"]);
    expect(r.data.todays_visits[0]).toMatchObject({ slot_start: "10:00", status: "CONFIRMED" });
    expect(r.data.availability).toHaveLength(2);
    expect(r.data.my_bookings).toEqual({ this_month: 2, total: 2, value_paise: 2 * CR });
  });

  it("Project Admin (scoped): progress, availability, upcoming stages with the installments they will raise, demands raised; Employee: projects + notices only", async () => {
    const r = await json<{ role: string; data: Record<string, unknown> & { projects: { project_name: string }[]; construction: { block_name: string; percent: number; current_stage: string | null; next_stage: string | null }[]; upcoming_stages: { block_name: string; stage_name: string; active_bookings: number; installment_total_paise: number }[]; demands_raised_this_month: { count: number }; bookings_this_month: number; open_tickets: number } }>("/api/v1/dashboard", projectsTok);
    expect(r.role).toBe("PROJECT_ADMIN");
    expect(Object.keys(r.data).sort()).toEqual([...widgets.PROJECT_ADMIN].sort());
    expect(r.data.projects.map((p) => p.project_name)).toEqual(["Shree Ganesh Heights"]);
    const towerA = r.data.construction.find((c) => c.block_name === "Tower A")!;
    expect(towerA).toMatchObject({ current_stage: "Excavation", next_stage: "Foundation" });
    expect(towerA.percent).toBeGreaterThan(0);
    const up = r.data.upcoming_stages.find((s) => s.block_name === "Tower A")!;
    // Foundation: Villa CLP 10% of B1 (1 Cr) + nothing for the DP booking
    expect(up).toMatchObject({ stage_name: "Foundation", active_bookings: 2, installment_total_paise: 10 * L });
    expect(r.data.bookings_this_month).toBe(3);
    expect(r.data.open_tickets).toBe(0);
    expect(r.data.demands_raised_this_month.count).toBeGreaterThanOrEqual(2);

    const e = await json<{ role: string; data: Record<string, unknown> & { projects: unknown[]; notices: unknown[] } }>("/api/v1/dashboard", employee);
    expect(e.role).toBe("EMPLOYEE");
    expect(Object.keys(e.data).sort()).toEqual([...widgets.EMPLOYEE].sort());
    expect(e.data.projects).toHaveLength(2);
    const outOfScope = await t.request<ErrorBody>("GET", `/api/v1/dashboard?project_id=${w.ggv.id}`, { token: projectsTok });
    expect(outOfScope.status).toBe(404);
  });
});
