import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, financialYear, todayIST } from "@kkt/domain";
import { nightlyIntegrity, overdueNotifications, voidDemandsForStage } from "../../src/modules/money/index.js";
import { completeStage, createMoneyWorld, resetStage, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Money module (SPEC §8 plan assignments, §10 auto-dues + integrity, §11 ledger / payments / roznamcha, §12 booking engine) – adversarial pass:
 * concurrency on one booking, bucket cap at posting AND clearing, receipt numbering without gaps, FIFO demand statuses after advances,
 * the undo rule, plan change, cancellation/handover guards, scope → 404, permissions, audit hygiene and paging.
 */

const L = 10_000_000; // ₹1,00,000 in paise
const CR = 100 * L;
const NO_ID = "00000000-0000-4000-8000-000000000000";

type Bucket = { agreed_paise: number; order_raised_paise: number; paid_paise: number; due_paise: number; advance_paise: number; pending_paise: number };
type Summary = { raised_percent: number; cash: Bucket; account: Bucket; total_due_paise: number; total_paid_paise: number; other_charges_demanded_paise: number; other_charges_paid_paise: number; other_charges_due_paise: number; pending_cheques_paise: number; next_installment: { seq: number } | null };
type OtherCharge = { id: string; name: string; total_paise: number; gst_paise: number; demanded_at: string | null; demand_number: string | null; paid_paise: number; due_paise: number };
type ScheduleRow = { seq: number; status: string; demand_number: string | null; paid_paise: number; cash_paise: number; account_paise: number };
type Booking = {
  id: string; version: number; status: string; booking_number: string; flat_id: string; summary: Summary; other_charges: OtherCharge[]; schedule: ScheduleRow[];
  parking_slots: { id: string; number: string }[]; agreement_revisions: { reason: string }[]; plan_revisions: { reason: string; after_plan_snapshot: { name: string } }[]; plan_snapshot: { name: string }; cancellation: { refund_paise: number } | null; completed_at: string | null;
};
type Payment = { id: string; version: number; receipt_number: string; status: string; amount_paise: number; bucket: string | null; receipt_cancelled: boolean; bank_account_label: string | null };
type PostResponse = { payment: Payment; ledger_seq: number | null; receipt_url: string; summary: { cash_due_paise: number; account_due_paise: number; total_due_paise: number; other_charges_due_paise: number } };
type LedgerRow = { seq: number; event: string; entry_date: string; bucket: string | null; amount_paise: number; cash_due_paise: number; account_due_paise: number; total_due_paise: number; other_charges_due_paise: number; ref_number: string | null };
type List<T> = { items: T[]; total: number; page: number; page_size: number; next_cursor: string | null };
type Demand = { id: string; demand_number: string; installment_seq: number; status: string; paid_paise: number; cash_demand_paise: number; account_demand_paise: number; demand_date: string; trigger_stage_id: string | null };
type Integrity = { ok: boolean; findings: { type: string; booking_id: string; demand_number: string | null }[]; counts: Record<string, number> };

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let accountsId: string;
let w: MoneyWorld;
let today: string;
let fy: string;
let keyCounter = 0;
const key = () => `money-${Date.now()}-${++keyCounter}`;

function bookingBody(flatId: string, customerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { flat_id: flatId, customer_id: customerId, booking_date: today, agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L, plan_acceptance_mode: "IN_PERSON", plan_accepted_on: today, ...extra };
}

async function createBooking(token: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Booking> {
  const r = await t.request<Booking>("POST", "/api/v1/bookings", { token, body, headers: { "idempotency-key": key(), ...headers } });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

async function getBooking(id: string, token = admin): Promise<Booking> {
  const r = await t.request<Booking>("GET", `/api/v1/bookings/${id}`, { token });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function ledgerOf(id: string): Promise<LedgerRow[]> {
  const r = await t.request<List<LedgerRow>>("GET", `/api/v1/bookings/${id}/ledger?page_size=200`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}

async function demandsOf(id: string): Promise<Demand[]> {
  const r = await t.request<List<Demand>>("GET", `/api/v1/bookings/${id}/demands?include_inactive=true&page_size=200&sort=posted_at`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}

function payBody(bookingId: string, bucket: "CASH" | "ACCOUNT", amount: number, mode: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  // UPI carries its transaction reference (PAYMENT_MODE_DEFAULTS: requires_instrument) and, like every non-cash mode, the credited bank account
  const upi = mode === w.modes.UPI ? { instrument: { number: `UPI${++keyCounter}` }, bank_account_id: w.bankAccountId } : {};
  return { booking_id: bookingId, against: "FLAT_VALUE", bucket, amount_paise: amount, payment_date: today, payment_mode_id: mode, ...upi, ...extra };
}

async function pay(body: Record<string, unknown>, token = accounts, idemKey = key()): Promise<PostResponse> {
  const r = await t.request<PostResponse>("POST", "/api/v1/payments", { token, body, headers: { "idempotency-key": idemKey } });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

async function payFail(body: Record<string, unknown>, token = accounts): Promise<{ status: number; body: ErrorBody }> {
  const r = await t.request<ErrorBody>("POST", "/api/v1/payments", { token, body, headers: { "idempotency-key": key() } });
  return { status: r.status, body: r.body };
}

async function runDues(body: Record<string, unknown>): Promise<{ demands_raised: number; demand_numbers: string[]; bookings_processed: number }> {
  const r = await t.request<{ demands_raised: number; demand_numbers: string[]; bookings_processed: number }>("POST", "/api/v1/dues/run", { token: admin, body });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function integrity(bookingId: string): Promise<Integrity> {
  const r = await t.request<Integrity>("GET", `/api/v1/dues/integrity?booking_id=${bookingId}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

function receiptSeq(receipt: string): number {
  return Number(receipt.split("/").pop());
}

async function notificationsFor(entityType: string, entityId: string): Promise<{ type: string; recipient_type: string; recipient_id: string; is_withdrawn: boolean }[]> {
  return t.app.sql<{ type: string; recipient_type: string; recipient_id: string; is_withdrawn: boolean }[]>`select type, recipient_type, recipient_id, is_withdrawn from notifications where entity_type = ${entityType} and entity_id = ${entityId}`;
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  fy = financialYear(today, 4).label;
  const a = await t.loginAs("admin");
  admin = a.access_token;
  const acc = await t.loginAs("accounts");
  accounts = acc.access_token;
  accountsId = acc.user.id;
  sales = (await t.loginAs("sales")).access_token;
  w = await createMoneyWorld(t, admin);
});
afterAll(async () => { await t?.close(); });

// ---------------------------------------------------------------------------
describe("payment plans ↔ towers (SPEC §8)", () => {
  it("rejects a plan whose ON_STAGE installment names a stage missing from the tower (409 PLAN_STAGES_MISSING with details.missing_stages)", async () => {
    const alienPlan = await t.request<{ id: string }>("POST", "/api/v1/masters/payment-plans", { token: admin, body: { name: "Alien", code: "ALIEN", plan_type: "CUSTOM", installments: [{ seq: 1, name: "On booking", percent: 50, trigger_type: "ON_BOOKING" }, { seq: 2, name: "Landscaping", percent: 50, trigger_type: "ON_STAGE", trigger_stage_id: w.alienStageId }] } });
    expect(alienPlan.status, alienPlan.text).toBe(201);
    const r = await t.request<ErrorBody>("POST", "/api/v1/payment-plan-assignments", { token: admin, body: { plan_id: alienPlan.body.id, project_id: w.sgh.id, block_id: w.sgh.towerId } });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error.code).toBe("PLAN_STAGES_MISSING");
    expect((r.body.error.details?.["missing_stages"] as { id: string; name: string }[]).map((m) => m.id)).toEqual([w.alienStageId]);
    const bad = await t.request<ErrorBody>("POST", "/api/v1/masters/payment-plans", { token: admin, body: { name: "Bad", code: "BAD", plan_type: "CUSTOM", installments: [{ seq: 1, name: "On booking", percent: 99.5, trigger_type: "ON_BOOKING" }] } });
    expect([400, 422]).toContain(bad.status);
  });

  it("applicable plans of a tower are exactly the assigned ones, default first; preview totals equal the agreed amounts to the paise", async () => {
    const r = await t.request<{ plans: { plan_id: string; is_default: boolean; installments: { cumulative_percent: number }[] }[] }>("GET", `/api/v1/blocks/${w.sgh.towerId}/applicable-plans`, { token: sales });
    expect(r.status, r.text).toBe(200);
    expect(r.body.plans[0]?.plan_id).toBe(w.plans.VILLA_CLP);
    expect(r.body.plans[0]?.is_default).toBe(true);
    expect(r.body.plans.map((p) => p.plan_id).sort()).toEqual([w.plans.VILLA_CLP, w.plans.FLEXI, w.plans.DP].sort());
    expect(r.body.plans[0]?.installments.at(-1)?.cumulative_percent).toBe(100);
    const g = await t.request<{ plans: { plan_id: string }[] }>("GET", `/api/v1/blocks/${w.ggv.towerId}/applicable-plans`, { token: admin });
    expect(g.body.plans.map((p) => p.plan_id)).toEqual([w.plans.VILLA_CLP]);
    // odd agreed values: telescoping makes the rows sum exactly
    const preview = await t.request<{ rows: { cash_paise: number; account_paise: number; already_satisfied: boolean }[]; totals: { cash_paise: number; account_paise: number }; catch_up_paise: number }>("POST", "/api/v1/bookings/preview-schedule", { token: sales, body: { plan_id: w.plans.VILLA_CLP, block_id: w.sgh.towerId, booking_date: today, cash_agreed_paise: 33_333_333, account_agreed_paise: 66_666_667 } });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.rows).toHaveLength(10);
    expect(preview.body.rows.reduce((s, r) => s + r.cash_paise, 0)).toBe(33_333_333);
    expect(preview.body.rows.reduce((s, r) => s + r.account_paise, 0)).toBe(66_666_667);
    expect(preview.body.totals).toEqual({ cash_paise: 33_333_333, account_paise: 66_666_667, total_paise: 100_000_000 });
    expect(preview.body.catch_up_paise).toBe(10_000_000); // only the booking installment is satisfied on a pending tower
  });

  it("assignments: exactly one default per scope, versioned PATCH, soft delete removes the plan from the tower's dropdown; Sales cannot manage plans", async () => {
    const list = await t.request<List<{ id: string; plan_id: string; is_default: boolean; version: number }>>("GET", `/api/v1/payment-plan-assignments?project_id=${w.sgh.id}`, { token: admin });
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.filter((a) => a.is_default).map((a) => a.plan_id)).toEqual([w.plans.VILLA_CLP]);
    const dp = list.body.items.find((a) => a.plan_id === w.plans.DP)!;
    const villa = list.body.items.find((a) => a.plan_id === w.plans.VILLA_CLP)!;
    expect((await t.request("PATCH", `/api/v1/payment-plan-assignments/${dp.id}`, { token: sales, body: { version: dp.version, is_default: true } })).status).toBe(403);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/payment-plan-assignments/${dp.id}`, { token: admin, body: { version: dp.version + 7, is_default: true } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const made = await t.request<{ is_default: boolean; version: number }>("PATCH", `/api/v1/payment-plan-assignments/${dp.id}`, { token: admin, body: { version: dp.version, is_default: true } });
    expect(made.status, made.text).toBe(200);
    expect(made.body.is_default).toBe(true);
    const after = await t.request<List<{ id: string; plan_id: string; is_default: boolean; version: number }>>("GET", `/api/v1/payment-plan-assignments?project_id=${w.sgh.id}`, { token: admin });
    expect(after.body.items.filter((a) => a.is_default).map((a) => a.plan_id)).toEqual([w.plans.DP]);
    expect((await t.request<{ plans: { plan_id: string }[] }>("GET", `/api/v1/blocks/${w.sgh.towerId}/applicable-plans`, { token: admin })).body.plans[0]?.plan_id).toBe(w.plans.DP);
    // back to Villa CLP as the default, then deactivate the DP assignment
    const villaNow = after.body.items.find((a) => a.id === villa.id)!;
    expect((await t.request("PATCH", `/api/v1/payment-plan-assignments/${villa.id}`, { token: admin, body: { version: villaNow.version, is_default: true } })).status).toBe(200);
    const dpNow = (await t.request<List<{ id: string; version: number }>>("GET", `/api/v1/payment-plan-assignments?project_id=${w.sgh.id}`, { token: admin })).body.items.find((a) => a.id === dp.id)!;
    expect((await t.request("DELETE", `/api/v1/payment-plan-assignments/${dp.id}`, { token: admin, headers: { "if-match": `"${dpNow.version}"` } })).status).toBe(204);
    const plans = await t.request<{ plans: { plan_id: string; is_default: boolean }[] }>("GET", `/api/v1/blocks/${w.sgh.towerId}/applicable-plans`, { token: admin });
    expect(plans.body.plans.map((p) => p.plan_id).sort()).toEqual([w.plans.VILLA_CLP, w.plans.FLEXI].sort());
    expect(plans.body.plans[0]).toMatchObject({ plan_id: w.plans.VILLA_CLP, is_default: true });
    const inactive = await t.request<List<{ id: string; is_active: boolean }>>("GET", `/api/v1/payment-plan-assignments?project_id=${w.sgh.id}&include_inactive=true`, { token: admin });
    expect(inactive.body.items.find((a) => a.id === dp.id)?.is_active).toBe(false);
    // re-assign DP (the plan-change test below needs it)
    expect((await t.request("PATCH", `/api/v1/payment-plan-assignments/${dp.id}`, { token: admin, body: { version: dpNow.version + 1, is_active: true } })).status).toBe(200);
    expect((await t.request<{ plans: unknown[] }>("GET", `/api/v1/blocks/${w.sgh.towerId}/applicable-plans`, { token: admin })).body.plans).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
let b1: Booking; // A-101: payment rules
let b6: Booking; // A-203: concurrency
let d1: Demand; // booking installment demand of b1

describe("booking engine (SPEC §12)", () => {
  it("creates a booking: flat BOOKED, parking ALLOTTED, ON_BOOKING demand + on-booking other charge raised, snapshots, audit row; Idempotency-Key replay creates nothing", async () => {
    const flat = w.sgh.flats.get("A-101")!;
    const body = bookingBody(flat.id, w.customers[0]!, {
      other_charges: [
        { charge_type_id: w.charges.PARKING, amount_paise: 3 * L, gst_percent: 5, demand_at: "ON_BOOKING" },
        { charge_type_id: w.charges.REGISTRY, amount_paise: 25 * L, gst_percent: 18, demand_at: "ON_POSSESSION" }, // GST ignored: not taxable
        { charge_type_id: w.charges.LEGAL, amount_paise: 25_000_00, gst_percent: 18, demand_at: "MANUAL" },
      ],
      parking_slot_ids: [w.sgh.parkingIds[0]!],
      co_applicant_ids: [w.customers[1]!],
    });
    const k = key();
    b1 = await createBooking(sales, body, { "idempotency-key": k });
    expect(b1.booking_number).toBe(`BK-${fy}/0001`);
    expect(b1.status).toBe("ACTIVE");
    expect(b1.version).toBe(1);
    expect(b1.summary.raised_percent).toBe(10);
    expect(b1.summary.cash).toMatchObject({ agreed_paise: 60 * L, order_raised_paise: 6 * L, paid_paise: 0, due_paise: 6 * L, advance_paise: 0 });
    expect(b1.summary.account).toMatchObject({ agreed_paise: 40 * L, order_raised_paise: 4 * L, due_paise: 4 * L });
    expect(b1.summary.total_due_paise).toBe(10 * L);
    const parking = b1.other_charges.find((c) => c.name === "Car Parking")!;
    expect(parking.gst_paise).toBe(15_000_00);
    expect(parking.total_paise).toBe(3_15_000_00);
    expect(parking.demand_number).toMatch(new RegExp(`^DM-${fy}/\\d{4}$`));
    expect(b1.other_charges.find((c) => c.name.startsWith("Registry"))).toMatchObject({ gst_paise: 0, total_paise: 25 * L, demanded_at: null });
    expect(b1.summary.other_charges_demanded_paise).toBe(3_15_000_00);
    expect(b1.summary.other_charges_due_paise).toBe(3_15_000_00);
    expect(b1.parking_slots.map((p) => p.id)).toEqual([w.sgh.parkingIds[0]]);
    expect(b1.schedule).toHaveLength(10);
    expect(b1.schedule[0]).toMatchObject({ seq: 1, status: "RAISED" });
    expect(b1.schedule[1]?.status).toBe("NOT_YET_DUE");
    expect(b1.summary.next_installment?.seq).toBe(2);
    const [flatRow] = await t.app.sql<{ status: string; booking_id: string }[]>`select status, booking_id from flats where id = ${flat.id}`;
    expect(flatRow).toEqual({ status: "BOOKED", booking_id: b1.id });
    const [slot] = await t.app.sql<{ status: string }[]>`select status from parking_slots where id = ${w.sgh.parkingIds[0]!}`;
    expect(slot?.status).toBe("ALLOTTED");
    const ledger = await ledgerOf(b1.id);
    expect(ledger.map((r) => r.event)).toEqual(["OTHER_CHARGE_DEMAND", "DEMAND"]);
    expect(ledger.map((r) => r.seq)).toEqual([1, 2]);
    expect(ledger[1]).toMatchObject({ cash_due_paise: 6 * L, account_due_paise: 4 * L, total_due_paise: 10 * L, other_charges_due_paise: 3_15_000_00 });
    const audits = await t.app.sql<{ action: string }[]>`select action from audit_logs where entity_id = ${b1.id} and entity_type = 'booking'`;
    expect(audits.map((a) => a.action)).toContain("booking.create");
    d1 = (await demandsOf(b1.id))[0]!;
    expect(d1).toMatchObject({ installment_seq: 1, status: "OPEN", cash_demand_paise: 6 * L, account_demand_paise: 4 * L });
    const replay = await t.request<Booking>("POST", "/api/v1/bookings", { token: sales, body, headers: { "idempotency-key": k } });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.id).toBe(b1.id);
    expect(Number((await t.app.sql<{ n: string }[]>`select count(*)::text as n from bookings`)[0]!.n)).toBe(1);
    const stale = await t.request<ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(flat.id, w.customers[2]!) , headers: { "idempotency-key": key() } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("FLAT_NOT_AVAILABLE");
    expect(stale.body.error.details?.["booking_number"]).toBe(b1.booking_number);
  });

  it("validates: split must equal the agreement, booking date not in the future, plan must be applicable to the tower, inactive-plan / unknown customer rejected", async () => {
    const flat = w.sgh.flats.get("A-102")!;
    const badSplit = await t.request<ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(flat.id, w.customers[2]!, { cash_agreed_paise: 50 * L }) });
    expect(badSplit.status).toBe(400);
    const future = await t.request<ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(flat.id, w.customers[2]!, { booking_date: addDays(today, 1), plan_accepted_on: addDays(today, 1) }) });
    expect(future.status).toBe(422);
    expect(future.body.error.details?.["rule"]).toBe("BOOKING_DATE_FUTURE");
    const alien = (await t.request<List<{ id: string; code: string }>>("GET", "/api/v1/masters/payment-plans?search=ALIEN", { token: admin })).body.items.find((p) => p.code === "ALIEN")!;
    const notApplicable = await t.request<ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(flat.id, w.customers[2]!, { payment_plan_id: alien.id }) });
    expect(notApplicable.status).toBe(409);
    expect(notApplicable.body.error.code).toBe("PLAN_NOT_APPLICABLE");
    const noCustomer = await t.request<ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(flat.id, NO_ID) });
    expect(noCustomer.status).toBe(400);
    const noFlat = await t.request<ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(NO_ID, w.customers[2]!) });
    expect(noFlat.status).toBe(404);
    expect((await t.request("GET", `/api/v1/flats/${flat.id}`, { token: admin })).body).toMatchObject({ status: "AVAILABLE" });
  });

  it("two simultaneous bookings of the same flat → exactly one succeeds (acceptance 3)", async () => {
    const flat = w.sgh.flats.get("A-102")!;
    const [r1, r2] = await Promise.all([
      t.request<Booking>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(flat.id, w.customers[2]!), headers: { "idempotency-key": key() } }),
      t.request<Booking>("POST", "/api/v1/bookings", { token: admin, body: bookingBody(flat.id, w.customers[3]!), headers: { "idempotency-key": key() } }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses, `${r1.text}\n${r2.text}`).toEqual([201, 409]);
    const loser = (r1.status === 409 ? r1 : r2) as unknown as { body: ErrorBody };
    expect(loser.body.error.code).toBe("FLAT_NOT_AVAILABLE");
    const active = await t.app.sql<{ n: string }[]>`select count(*)::text as n from bookings where flat_id = ${flat.id} and status = 'ACTIVE'`;
    expect(Number(active[0]!.n)).toBe(1);
  });

  it("PATCH updates remarks / broker / co-applicants with version or If-Match (stale → 409); wizard drafts autosave, list and delete per user", async () => {
    const b = await getBooking(b1.id);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/bookings/${b1.id}`, { token: sales, body: { version: b.version + 3, remarks: "late" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(b.version);
    const noVersion = await t.request<ErrorBody>("PATCH", `/api/v1/bookings/${b1.id}`, { token: sales, body: { remarks: "x" } });
    expect(noVersion.status).toBe(400);
    const selfCo = await t.request<ErrorBody>("PATCH", `/api/v1/bookings/${b1.id}`, { token: sales, body: { version: b.version, co_applicant_ids: [w.customers[0]!] } });
    expect(selfCo.status).toBe(400);
    const patched = await t.request<Booking & { remarks: string; broker_name: string; co_applicants: { customer_id: string }[] }>("PATCH", `/api/v1/bookings/${b1.id}`, { token: sales, body: { remarks: "Corner unit", broker_name: "Patna Realty", co_applicant_ids: [w.customers[1]!, w.customers[2]!] }, headers: { "if-match": `"${b.version}"` } });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.version).toBe(b.version + 1);
    expect(patched.body).toMatchObject({ remarks: "Corner unit", broker_name: "Patna Realty" });
    expect(patched.body.co_applicants.map((c) => c.customer_id).sort()).toEqual([w.customers[1], w.customers[2]].sort());
    expect((await t.request("PATCH", `/api/v1/bookings/${b1.id}`, { token: accounts, body: { version: patched.body.version, remarks: "no" } })).status).toBe(403);
    b1 = await getBooking(b1.id);
    const draft = await t.request<{ id: string; step: number; flat_number: string | null }>("PUT", "/api/v1/booking-drafts", { token: sales, body: { step: 2, payload: { flat_id: w.sgh.flats.get("A-304")!.id, project_id: w.sgh.id } } });
    expect(draft.status, draft.text).toBe(200);
    expect(draft.body.flat_number).toBe("A-304");
    const again = await t.request<{ id: string; step: number }>("PUT", "/api/v1/booking-drafts", { token: sales, body: { id: draft.body.id, step: 3, payload: { flat_id: w.sgh.flats.get("A-304")!.id, customer_id: w.customers[2]! } } });
    expect(again.body).toMatchObject({ id: draft.body.id, step: 3 });
    const mine = await t.request<{ items: { id: string }[] }>("GET", "/api/v1/booking-drafts", { token: sales });
    expect(mine.body.items.map((d) => d.id)).toEqual([draft.body.id]);
    expect((await t.request<{ items: unknown[] }>("GET", "/api/v1/booking-drafts", { token: admin })).body.items).toHaveLength(0); // per user
    expect((await t.request("DELETE", `/api/v1/booking-drafts/${draft.body.id}`, { token: admin })).status).toBe(404);
    expect((await t.request("DELETE", `/api/v1/booking-drafts/${draft.body.id}`, { token: sales })).status).toBe(204);
  });

  it("handover is blocked while the possession stage is pending (409 HANDOVER_BLOCKED)", async () => {
    const r = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/complete`, { token: admin, body: { version: b1.version } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("HANDOVER_BLOCKED");
    expect(String(r.body.error.details?.["problems"])).toContain("Possession");
  });
});

// ---------------------------------------------------------------------------
describe("payments, bucket cap, instruments, reversal (SPEC §11)", () => {
  let lastReceipt = 0;
  let upi4L: Payment;
  let cheque5L: Payment;
  let cheque30L: Payment;
  let upi10L: Payment;

  it("Sales cannot post payments (403); posting without an Idempotency-Key is rejected (400 IDEMPOTENCY_KEY_REQUIRED)", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/payments", { token: sales, body: payBody(b1.id, "ACCOUNT", 4 * L, w.modes.UPI), headers: { "idempotency-key": key() } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
    const noKey = await t.request<ErrorBody>("POST", "/api/v1/payments", { token: accounts, body: payBody(b1.id, "ACCOUNT", 4 * L, w.modes.UPI) });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(Number((await t.app.sql<{ n: string }[]>`select count(*)::text as n from payments`)[0]!.n)).toBe(0);
  });

  it("validates date (≥ booking date, ≤ today), instrument reference for cheque/NEFT, bank account for non-cash, mode and bucket/charge shape", async () => {
    const early = await payFail(payBody(b1.id, "ACCOUNT", 4 * L, w.modes.UPI, { payment_date: addDays(today, -1) }));
    expect(early.status).toBe(422);
    expect(early.body.error.details?.["rule"]).toBe("PAYMENT_DATE_BEFORE_BOOKING");
    const future = await payFail(payBody(b1.id, "ACCOUNT", 4 * L, w.modes.UPI, { payment_date: addDays(today, 1) }));
    expect(future.status).toBe(422);
    expect(future.body.error.details?.["rule"]).toBe("PAYMENT_DATE_FUTURE");
    const noInstrument = await payFail(payBody(b1.id, "CASH", 5 * L, w.modes.CHEQUE, { bank_account_id: w.bankAccountId }));
    expect(noInstrument.status).toBe(400);
    expect(noInstrument.body.error.details?.["field"]).toBe("instrument.number");
    const noChequeDate = await payFail(payBody(b1.id, "CASH", 5 * L, w.modes.CHEQUE, { bank_account_id: w.bankAccountId, instrument: { number: "000123" } }));
    expect(noChequeDate.status).toBe(400);
    const noBank = await payFail(payBody(b1.id, "ACCOUNT", 4 * L, w.modes.NEFT, { instrument: { number: "NEFT123" } }));
    expect(noBank.status).toBe(400);
    expect(noBank.body.error.details?.["field"]).toBe("bank_account_id");
    const noBucket = await payFail({ booking_id: b1.id, against: "FLAT_VALUE", amount_paise: 100, payment_date: today, payment_mode_id: w.modes.UPI });
    expect(noBucket.status).toBe(400);
    const zero = await payFail(payBody(b1.id, "CASH", 0, w.modes.CASH));
    expect(zero.status).toBe(400);
    const unknownBooking = await payFail(payBody(NO_ID, "CASH", 100, w.modes.CASH));
    expect(unknownBooking.status).toBe(404);
    expect(Number((await t.app.sql<{ n: string }[]>`select count(*)::text as n from payments`)[0]!.n)).toBe(0);
    // rejected postings never consume a receipt number
    expect((await t.app.sql<{ n: string }[]>`select count(*)::text as n from sequences where scope = 'receipt'`)[0]!.n).toBe("0");
  });

  it("UPI clears immediately: PAYMENT ledger row with running balances, summary, demand status, receipt number per FY, notification; replay is identical and creates nothing", async () => {
    const k = key();
    const body = payBody(b1.id, "ACCOUNT", 4 * L, w.modes.UPI, { bank_account_id: w.bankAccountId, remarks: "Booking amount" });
    const r = await pay(body, accounts, k);
    upi4L = r.payment;
    expect(upi4L.receipt_number).toBe(`SGB/${fy}/0001`);
    lastReceipt = 1;
    expect(upi4L.status).toBe("CLEARED");
    expect(upi4L.bank_account_label).toBe("HDFC Bank ••6789");
    expect(r.ledger_seq).toBe(3);
    expect(r.summary).toEqual({ cash_due_paise: 6 * L, account_due_paise: 0, total_due_paise: 6 * L, other_charges_due_paise: 3_15_000_00 });
    const replay = await t.request<PostResponse>("POST", "/api/v1/payments", { token: accounts, body, headers: { "idempotency-key": k } });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body).toEqual(r);
    const mismatch = await t.request<ErrorBody>("POST", "/api/v1/payments", { token: accounts, body: { ...body, amount_paise: 1 }, headers: { "idempotency-key": k } });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(Number((await t.app.sql<{ n: string }[]>`select count(*)::text as n from payments`)[0]!.n)).toBe(1);
    const b = await getBooking(b1.id);
    expect(b.summary.account).toMatchObject({ paid_paise: 4 * L, due_paise: 0, advance_paise: 0 });
    expect(b.summary.total_paid_paise).toBe(4 * L);
    expect(b.schedule[0]).toMatchObject({ status: "PARTIALLY_PAID", paid_paise: 4 * L });
    const dem = (await demandsOf(b1.id))[0]!;
    expect(dem).toMatchObject({ status: "PARTIALLY_PAID", paid_paise: 4 * L });
    const ledger = await ledgerOf(b1.id);
    expect(ledger[2]).toMatchObject({ seq: 3, event: "PAYMENT", bucket: "ACCOUNT", amount_paise: 4 * L, entry_date: today, ref_number: upi4L.receipt_number, cash_due_paise: 6 * L, account_due_paise: 0, total_due_paise: 6 * L });
    const notes = await notificationsFor("payment", upi4L.id);
    expect(notes.filter((n) => n.recipient_type === "CUSTOMER").map((n) => n.recipient_id).sort()).toEqual([w.customers[0], w.customers[1], w.customers[2]].sort()); // primary + both co-applicants
    const receipt = await t.request<{ receipt_number: string; amount_words: string; subject_to_realisation: boolean; is_cancelled: boolean; company: { name: string } }>("GET", `/api/v1/payments/${upi4L.id}/receipt`, { token: accounts });
    expect(receipt.status, receipt.text).toBe(200);
    expect(receipt.body.amount_words).toMatch(/^Rupees Four Lakh Only$/);
    expect(receipt.body.subject_to_realisation).toBe(false);
    expect((await t.request("GET", `/api/v1/payments/${upi4L.id}/receipt`, { token: sales })).status).toBe(403);
  });

  it("cheques are PENDING (cheques in hand, excluded from paid) until cleared; clearing applies the payment and re-checks the cap", async () => {
    const r = await pay(payBody(b1.id, "CASH", 5 * L, w.modes.CHEQUE, { bank_account_id: w.bankAccountId, instrument: { number: "000123", date: today, bank_name: "SBI" } }));
    cheque5L = r.payment;
    expect(cheque5L.status).toBe("PENDING");
    expect(r.ledger_seq).toBeNull();
    expect(receiptSeq(cheque5L.receipt_number)).toBe(++lastReceipt);
    let b = await getBooking(b1.id);
    expect(b.summary.cash).toMatchObject({ paid_paise: 0, pending_paise: 5 * L, due_paise: 6 * L });
    expect(b.summary.pending_cheques_paise).toBe(5 * L);
    const receipt = await t.request<{ subject_to_realisation: boolean }>("GET", `/api/v1/payments/${cheque5L.id}/receipt`, { token: accounts });
    expect(receipt.body.subject_to_realisation).toBe(true);
    const inHand = await t.request<List<{ id: string; instrument_date: string | null; days_in_hand: number }>>("GET", "/api/v1/payments/cheques", { token: accounts });
    expect(inHand.status, inHand.text).toBe(200);
    expect(inHand.body.items.map((c) => c.id)).toEqual([cheque5L.id]);
    expect(inHand.body.items[0]).toMatchObject({ instrument_date: today, days_in_hand: 0 });
    const salesClear = await t.request<ErrorBody>("POST", `/api/v1/payments/${cheque5L.id}/clear`, { token: sales, body: { version: cheque5L.version } });
    expect(salesClear.status).toBe(403);
    const cleared = await t.request<Payment>("POST", `/api/v1/payments/${cheque5L.id}/clear`, { token: accounts, body: {}, headers: { "if-match": `"${cheque5L.version}"` } });
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body.status).toBe("CLEARED");
    expect(cleared.body.version).toBe(cheque5L.version + 1);
    const again = await t.request<ErrorBody>("POST", `/api/v1/payments/${cheque5L.id}/clear`, { token: accounts, body: { version: cleared.body.version } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("PAYMENT_NOT_PENDING");
    const noVersion = await t.request<ErrorBody>("POST", `/api/v1/payments/${cheque5L.id}/bounce`, { token: accounts, body: { reason: "Wrong entry" } });
    expect(noVersion.status).toBe(400);
    b = await getBooking(b1.id);
    expect(b.summary.cash).toMatchObject({ paid_paise: 5 * L, pending_paise: 0, due_paise: L });
    expect(b.summary.pending_cheques_paise).toBe(0);
    expect((await ledgerOf(b1.id)).at(-1)).toMatchObject({ seq: 4, event: "PAYMENT", bucket: "CASH", amount_paise: 5 * L, cash_due_paise: L, total_due_paise: L });
  });

  it("BUCKET CAP is enforced at clearing time too: a pending cheque that would push the bucket over its agreed value cannot be cleared; bouncing it never counts", async () => {
    cheque30L = (await pay(payBody(b1.id, "ACCOUNT", 30 * L, w.modes.CHEQUE, { bank_account_id: w.bankAccountId, instrument: { number: "000124", date: today } }))).payment;
    expect(receiptSeq(cheque30L.receipt_number)).toBe(++lastReceipt);
    upi10L = (await pay(payBody(b1.id, "ACCOUNT", 10 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }))).payment; // account paid 14 L, pending 30 L
    expect(receiptSeq(upi10L.receipt_number)).toBe(++lastReceipt);
    const clear = await t.request<ErrorBody>("POST", `/api/v1/payments/${cheque30L.id}/clear`, { token: accounts, body: { version: cheque30L.version } });
    expect(clear.status, clear.text).toBe(409);
    expect(clear.body.error.code).toBe("BUCKET_CAP_EXCEEDED");
    expect(clear.body.error.message).toBe("Account agreed ₹40,00,000; already received ₹14,00,000; cannot accept ₹30,00,000 – revise the agreement first");
    expect(clear.body.error.details).toMatchObject({ bucket: "ACCOUNT", agreed_paise: 40 * L, paid_paise: 14 * L, amount_paise: 30 * L, headroom_paise: 26 * L });
    expect((await getBooking(b1.id)).summary.account).toMatchObject({ paid_paise: 14 * L, pending_paise: 30 * L, advance_paise: 10 * L, due_paise: -10 * L });
    const bounced = await t.request<Payment>("POST", `/api/v1/payments/${cheque30L.id}/bounce`, { token: accounts, body: { version: cheque30L.version, reason: "Insufficient funds" } });
    expect(bounced.status, bounced.text).toBe(200);
    expect(bounced.body).toMatchObject({ status: "BOUNCED", receipt_cancelled: true });
    const b = await getBooking(b1.id);
    expect(b.summary.account).toMatchObject({ paid_paise: 14 * L, pending_paise: 0 });
    expect(b.summary.pending_cheques_paise).toBe(0);
    const staff = (await notificationsFor("payment", cheque30L.id)).filter((n) => n.type === "CHEQUE_BOUNCED");
    expect(staff.some((n) => n.recipient_type === "STAFF" && n.recipient_id === accountsId)).toBe(true);
    expect(staff.some((n) => n.recipient_type === "CUSTOMER")).toBe(true);
    const bouncedList = await t.request<List<{ id: string }>>("GET", "/api/v1/payments/cheques?status=BOUNCED", { token: accounts });
    expect(bouncedList.body.items.map((c) => c.id)).toEqual([cheque30L.id]);
    expect((await ledgerOf(b1.id)).some((r) => r.ref_number === cheque30L.receipt_number)).toBe(false);
  });

  it("reversal: negative REVERSAL row, summary decremented, receipt cancelled (never deleted); only cleared payments reverse; Accounts-only", async () => {
    const forbidden = await t.request<ErrorBody>("POST", `/api/v1/payments/${upi10L.id}/reverse`, { token: sales, body: { version: upi10L.version, reason: "Wrong booking" } });
    expect(forbidden.status).toBe(403);
    const r = await t.request<Payment>("POST", `/api/v1/payments/${upi10L.id}/reverse`, { token: accounts, body: { version: upi10L.version, reason: "Posted to the wrong booking" } });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ status: "REVERSED", receipt_cancelled: true });
    const twice = await t.request<ErrorBody>("POST", `/api/v1/payments/${upi10L.id}/reverse`, { token: accounts, body: { version: r.body.version, reason: "again" } });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("PAYMENT_NOT_CLEARED");
    const b = await getBooking(b1.id);
    expect(b.summary.account).toMatchObject({ paid_paise: 4 * L, due_paise: 0 });
    const last = (await ledgerOf(b1.id)).at(-1)!;
    expect(last).toMatchObject({ event: "REVERSAL", bucket: "ACCOUNT", amount_paise: -10 * L, ref_number: upi10L.receipt_number, account_due_paise: 0 });
    const receipt = await t.request<{ is_cancelled: boolean }>("GET", `/api/v1/payments/${upi10L.id}/receipt`, { token: accounts });
    expect(receipt.body.is_cancelled).toBe(true);
    expect(Number((await t.app.sql<{ n: string }[]>`select count(*)::text as n from payments where id = ${upi10L.id}`)[0]!.n)).toBe(1);
  });

  it("BUCKET CAP at posting: 409 with the explanatory message; Sales cannot revise; after an audited agreement revision the same payment succeeds (acceptance 5); each bucket ≥ paid", async () => {
    const over = await payFail(payBody(b1.id, "ACCOUNT", 37 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }));
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("BUCKET_CAP_EXCEEDED");
    expect(over.body.error.message).toBe("Account agreed ₹40,00,000; already received ₹4,00,000; cannot accept ₹37,00,000 – revise the agreement first");
    let b = await getBooking(b1.id);
    const salesRevise = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/agreement-revisions`, { token: sales, body: { version: b.version, agreement_value_paise: CR, cash_agreed_paise: 55 * L, account_agreed_paise: 45 * L, reason: "Loan sanctioned higher" } });
    expect(salesRevise.status).toBe(403);
    const belowPaid = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/agreement-revisions`, { token: admin, body: { version: b.version, agreement_value_paise: CR, cash_agreed_paise: 97 * L, account_agreed_paise: 3 * L, reason: "Wrong entry" } });
    expect(belowPaid.status).toBe(409);
    expect(belowPaid.body.error.code).toBe("BELOW_PAID");
    const badSum = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/agreement-revisions`, { token: admin, body: { version: b.version, agreement_value_paise: CR, cash_agreed_paise: 50 * L, account_agreed_paise: 45 * L, reason: "Wrong entry" } });
    expect(badSum.status).toBe(400);
    const stale = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/agreement-revisions`, { token: admin, body: { version: b.version + 5, agreement_value_paise: CR, cash_agreed_paise: 55 * L, account_agreed_paise: 45 * L, reason: "Wrong entry" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const revised = await t.request<Booking>("POST", `/api/v1/bookings/${b1.id}/agreement-revisions`, { token: admin, body: { version: b.version, agreement_value_paise: CR, cash_agreed_paise: 55 * L, account_agreed_paise: 45 * L, reason: "Loan sanctioned higher" }, headers: { "idempotency-key": key() } });
    expect(revised.status, revised.text).toBe(201);
    expect(revised.body.version).toBe(b.version + 1);
    expect(revised.body.agreement_revisions).toHaveLength(1);
    expect(revised.body.summary.cash).toMatchObject({ agreed_paise: 55 * L, order_raised_paise: 5_50_000_00 });
    expect(revised.body.summary.account).toMatchObject({ agreed_paise: 45 * L, order_raised_paise: 4_50_000_00, paid_paise: 4 * L, due_paise: 50_000_00 });
    const dem = (await demandsOf(b1.id)).find((d) => d.installment_seq === 1)!;
    expect(dem).toMatchObject({ cash_demand_paise: 5_50_000_00, account_demand_paise: 4_50_000_00 });
    const ledger = await ledgerOf(b1.id);
    const change = ledger.find((r) => r.event === "AGREEMENT_CHANGE")!;
    expect(change).toMatchObject({ cash_due_paise: 50_000_00, account_due_paise: 50_000_00 });
    expect(ledger.at(-1)?.total_due_paise).toBe(L);
    const audit = await t.app.sql<{ action: string; after: Record<string, unknown> }[]>`select action, after from audit_logs where entity_id = ${b1.id} and action = 'booking.agreement_revise'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ cash_agreed_paise: 55 * L, reason: "Loan sanctioned higher" });
    const ok = await pay(payBody(b1.id, "ACCOUNT", 37 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }));
    expect(receiptSeq(ok.payment.receipt_number)).toBe(++lastReceipt); // no gaps despite the rejected postings in between
    expect(ok.summary.account_due_paise).toBe(4_50_000_00 - 41 * L);
    b = await getBooking(b1.id);
    expect(b.summary.account).toMatchObject({ paid_paise: 41 * L, advance_paise: 41 * L - 4_50_000_00 });
    expect((await integrity(b1.id)).ok).toBe(true);
  });

  it("other charges: payments cannot exceed the line total (409 CHARGE_CAP_EXCEEDED); a manual line is demanded on request; separate sub-ledger figures", async () => {
    const parking = b1.other_charges.find((c) => c.name === "Car Parking")!;
    const legal = b1.other_charges.find((c) => c.name === "Legal Charges")!;
    const charge = (amount: number, lineId = parking.id) => ({ booking_id: b1.id, against: "OTHER_CHARGE", other_charge_id: lineId, amount_paise: amount, payment_date: today, payment_mode_id: w.modes.CASH });
    const over = await payFail(charge(parking.total_paise + 1));
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("CHARGE_CAP_EXCEEDED");
    const withBucket = await payFail({ ...charge(1000), bucket: "CASH" });
    expect(withBucket.status).toBe(400);
    const r = await pay(charge(parking.total_paise));
    expect(receiptSeq(r.payment.receipt_number)).toBe(++lastReceipt);
    expect(r.ledger_seq).not.toBeNull();
    expect(r.summary.other_charges_due_paise).toBe(0);
    const again = await payFail(charge(1));
    expect(again.status).toBe(409);
    let b = await getBooking(b1.id);
    expect(b.summary).toMatchObject({ other_charges_paid_paise: parking.total_paise, other_charges_due_paise: 0 });
    expect(b.other_charges.find((c) => c.id === parking.id)).toMatchObject({ paid_paise: parking.total_paise, due_paise: 0 });
    const salesDemand = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/other-charges/${legal.id}/demand`, { token: sales, body: { version: b.version } });
    expect(salesDemand.status).toBe(403);
    const demanded = await t.request<Booking>("POST", `/api/v1/bookings/${b1.id}/other-charges/${legal.id}/demand`, { token: accounts, body: { version: b.version, due_date: addDays(today, 10) } });
    expect(demanded.status, demanded.text).toBe(200);
    const line = demanded.body.other_charges.find((c) => c.id === legal.id)!;
    expect(line.demand_number).toMatch(/^DM-/);
    expect(line.total_paise).toBe(29_500_00); // 25,000 + 18% GST
    expect(demanded.body.summary.other_charges_due_paise).toBe(29_500_00);
    const twice = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b1.id}/other-charges/${legal.id}/demand`, { token: accounts, body: { version: demanded.body.version } });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("ALREADY_DEMANDED");
    b = demanded.body;
    const added = await t.request<Booking>("POST", `/api/v1/bookings/${b1.id}/other-charges`, { token: admin, body: { charge_type_id: w.charges.LEGAL, amount_paise: 1000_00, gst_percent: 18, demand_at: "MANUAL" }, headers: { "if-match": `"${b.version}"`, "idempotency-key": key() } });
    expect(added.status, added.text).toBe(201);
    expect(added.body.other_charges).toHaveLength(4);
  });

  it("demand letter carries both buckets and the default bank account for Account transfers; reads leave no audit trace of the account number", async () => {
    const r = await t.request<{ bank: { account_number: string; ifsc: string } | null; cash_demand_paise: number; account_demand_paise: number; total_words: string }>("GET", `/api/v1/bookings/${b1.id}/demands/${d1.id}/letter`, { token: accounts });
    expect(r.status, r.text).toBe(200);
    expect(r.body.bank).toMatchObject({ account_number: w.bankAccountNumber, ifsc: "HDFC0000123" });
    expect(r.body.cash_demand_paise).toBe(5_50_000_00);
    expect(r.body.total_words).toMatch(/^Rupees Ten Lakh Only$/);
    expect((await t.request("GET", `/api/v1/bookings/${b1.id}/demands/${d1.id}/letter`, { token: sales })).status).toBe(403);
    expect((await t.request("GET", `/api/v1/bookings/${b1.id}/demands/${NO_ID}/letter`, { token: accounts })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("concurrency on one booking (SPEC §11 atomic unit of work)", () => {
  it("10 concurrent small cash payments: all accepted, summary = Σ cleared, ledger seq contiguous, receipt numbers unique and contiguous", async () => {
    b6 = await createBooking(sales, bookingBody(w.sgh.flats.get("A-203")!.id, w.customers[5]!));
    const before = Number((await t.app.sql<{ value: string }[]>`select value::text from sequences where scope = 'receipt'`)[0]!.value);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => t.request<PostResponse>("POST", "/api/v1/payments", { token: accounts, body: payBody(b6.id, "CASH", 1000 * (i + 1), w.modes.CASH), headers: { "idempotency-key": key() } })));
    for (const r of results) expect(r.status, r.text).toBe(201);
    const receipts = results.map((r) => receiptSeq(r.body.payment.receipt_number)).sort((a, b) => a - b);
    expect(receipts).toEqual(Array.from({ length: 10 }, (_, i) => before + 1 + i));
    expect(new Set(results.map((r) => r.body.ledger_seq)).size).toBe(10);
    const b = await getBooking(b6.id);
    const expected = Array.from({ length: 10 }, (_, i) => 1000 * (i + 1)).reduce((s, x) => s + x, 0);
    expect(b.summary.cash.paid_paise).toBe(expected);
    const ledger = await ledgerOf(b6.id);
    expect(ledger.map((r) => r.seq)).toEqual(Array.from({ length: ledger.length }, (_, i) => i + 1));
    expect(ledger.at(-1)?.cash_due_paise).toBe(6 * L - expected);
    const sum = await t.app.sql<{ n: string }[]>`select coalesce(sum(amount_paise), 0)::text as n from payments where booking_id = ${b6.id} and status = 'CLEARED'`;
    expect(Number(sum[0]!.n)).toBe(expected);
    expect((await integrity(b6.id)).ok).toBe(true);
    // paged sub-lists (never unbounded)
    const page = await t.request<List<Payment>>("GET", `/api/v1/bookings/${b6.id}/payments?page_size=3&page=2&sort=amount_paise`, { token: sales });
    expect(page.status, page.text).toBe(200);
    expect(page.body).toMatchObject({ total: 10, page: 2, page_size: 3 });
    expect(page.body.items.map((p) => p.amount_paise)).toEqual([4000, 5000, 6000]);
    const keyset = await t.request<List<LedgerRow>>("GET", `/api/v1/bookings/${b6.id}/ledger?limit=4`, { token: sales });
    expect(keyset.body.items.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(keyset.body.next_cursor).toBeTruthy();
  });

  it("concurrent payment + reversal on the same booking stay consistent (summary = Σ cleared, integrity ok)", async () => {
    const list = await t.request<List<Payment>>("GET", `/api/v1/bookings/${b6.id}/payments?page_size=50`, { token: accounts });
    const victim = list.body.items.find((p) => p.amount_paise === 10_000)!;
    const [rev, post] = await Promise.all([
      t.request<Payment>("POST", `/api/v1/payments/${victim.id}/reverse`, { token: accounts, body: { version: victim.version, reason: "Duplicate entry" } }),
      t.request<PostResponse>("POST", "/api/v1/payments", { token: accounts, body: payBody(b6.id, "ACCOUNT", 2 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }), headers: { "idempotency-key": key() } }),
    ]);
    expect(rev.status, rev.text).toBe(200);
    expect(post.status, post.text).toBe(200 + 1);
    const b = await getBooking(b6.id);
    expect(b.summary.cash.paid_paise).toBe(55_000 - 10_000);
    expect(b.summary.account.paid_paise).toBe(2 * L);
    const ledger = await ledgerOf(b6.id);
    expect(ledger.map((r) => r.seq)).toEqual(Array.from({ length: ledger.length }, (_, i) => i + 1));
    expect(ledger.filter((r) => r.event === "REVERSAL")).toHaveLength(1);
    expect((await integrity(b6.id)).ok).toBe(true);
  });

  it("cheques in hand page by instrument date in keyset mode without losing rows", async () => {
    const dates = [today, addDays(today, -1), addDays(today, -2)];
    for (const [i, d] of dates.entries()) await pay(payBody(b6.id, "ACCOUNT", 1000 * (i + 1), w.modes.CHEQUE, { bank_account_id: w.bankAccountId, instrument: { number: `CHQ${i}`, date: d } }));
    const first = await t.request<List<{ id: string; instrument_date: string }>>("GET", "/api/v1/payments/cheques?limit=2", { token: accounts });
    expect(first.status, first.text).toBe(200);
    expect(first.body.items.map((c) => c.instrument_date)).toEqual([addDays(today, -2), addDays(today, -1)]);
    expect(first.body.next_cursor).toBeTruthy();
    const second = await t.request<List<{ id: string; instrument_date: string }>>("GET", `/api/v1/payments/cheques?limit=2&cursor=${encodeURIComponent(first.body.next_cursor!)}`, { token: accounts });
    expect(second.status, second.text).toBe(200);
    expect(second.body.items.map((c) => c.instrument_date)).toEqual([today]);
    expect(second.body.next_cursor).toBeNull();
    const all = await t.request<List<{ id: string }>>("GET", "/api/v1/payments/cheques?page_size=50", { token: accounts });
    expect(new Set([...first.body.items, ...second.body.items].map((c) => c.id)).size).toBe(all.body.total);
  });
});

// ---------------------------------------------------------------------------
describe("auto-dues engine, FIFO statuses, undo rule, plan change, integrity (SPEC §9–10)", () => {
  const U = () => w.sgh.towerUId;
  let u1: Booking; // advance before the stage demand
  let u2: Booking; // catch-up + FIFO
  let u3: Booking; // flexi
  let b4: Booking; // plan change (Tower A)

  it("UNDO RULE: an advance dated before the demand never blocks; a receipt dated on/after the demand that funds it does", async () => {
    const bookedOn = addDays(today, -10);
    u1 = await createBooking(admin, bookingBody(w.sgh.flatsU.get("U-101")!.id, w.customers[4]!, { booking_date: bookedOn, plan_accepted_on: bookedOn }));
    // ₹7 L cash advance dated 5 days ago: covers the ₹6 L booking demand and leaves ₹1 L in credit
    await pay(payBody(u1.id, "CASH", 7 * L, w.modes.CASH, { payment_date: addDays(today, -5) }));
    await completeStage(t, U(), w.stages.EXCAVATION, addDays(today, -2));
    const run = await runDues({ block_id: U() });
    expect(run.demands_raised).toBe(1);
    let demands = await demandsOf(u1.id);
    const d2 = demands.find((d) => d.installment_seq === 2)!;
    expect(d2).toMatchObject({ status: "PARTIALLY_PAID", paid_paise: L, demand_date: addDays(today, -2), cash_demand_paise: 3 * L, account_demand_paise: 2 * L });
    expect((await notificationsFor("demand", d2.id)).length).toBeGreaterThan(0);
    const summaryBefore = (await getBooking(u1.id)).summary;
    expect(summaryBefore.cash).toMatchObject({ order_raised_paise: 9 * L, paid_paise: 7 * L, due_paise: 2 * L });
    // not blocked: the only money on the demand is the earlier advance
    const first = await t.app.db.transaction((tx) => voidDemandsForStage(tx, U(), w.stages.EXCAVATION, "Stage undone"));
    expect(first).toMatchObject({ blocked: false });
    expect((first as { voided: unknown[] }).voided).toHaveLength(1);
    demands = await demandsOf(u1.id);
    expect(demands.find((d) => d.id === d2.id)?.status).toBe("VOID");
    expect((await notificationsFor("demand", d2.id)).filter((n) => !n.is_withdrawn)).toHaveLength(0);
    let b = await getBooking(u1.id);
    expect(b.summary.cash).toMatchObject({ order_raised_paise: 6 * L, paid_paise: 7 * L, due_paise: -L, advance_paise: L });
    expect(b.summary.raised_percent).toBe(10);
    expect((await ledgerOf(u1.id)).some((r) => r.ref_number === d2.demand_number)).toBe(false);
    await resetStage(t, U(), w.stages.EXCAVATION); // what the construction module does in the same unit of work
    const clean = await integrity(u1.id);
    expect(clean.ok, JSON.stringify(clean.findings)).toBe(true);
    // raise it again, then a receipt dated today funds the rest of it → undo is blocked with the receipt named
    await completeStage(t, U(), w.stages.EXCAVATION, addDays(today, -2));
    expect((await runDues({ block_id: U() })).demands_raised).toBe(1);
    const later = await pay(payBody(u1.id, "CASH", 2 * L, w.modes.CASH));
    const second = await t.app.db.transaction((tx) => voidDemandsForStage(tx, U(), w.stages.EXCAVATION, "Stage undone"));
    expect(second.blocked).toBe(true);
    expect((second as { reasons: string[] }).reasons[0]).toContain(later.payment.receipt_number);
    b = await getBooking(u1.id);
    expect(b.summary.cash).toMatchObject({ order_raised_paise: 9 * L, paid_paise: 9 * L, due_paise: 0 });
    expect((await demandsOf(u1.id)).filter((d) => d.status !== "VOID")).toHaveLength(2);
  });

  it("catch-up at creation raises every already-satisfied installment; stage completion raises for every active booking whose plan has it; FIFO per bucket turns advances into partial payments", async () => {
    u2 = await createBooking(admin, bookingBody(w.sgh.flatsU.get("U-102")!.id, w.customers[6]!));
    expect(u2.summary.raised_percent).toBe(15);
    expect(u2.schedule.slice(0, 3).map((r) => r.status)).toEqual(["RAISED", "RAISED", "NOT_YET_DUE"]);
    u3 = await createBooking(admin, bookingBody(w.sgh.flatsU.get("U-103")!.id, w.customers[7]!, { payment_plan_id: w.plans.FLEXI }));
    expect(u3.summary.raised_percent).toBe(10);
    // FIFO per bucket: cash 9 L pays D1 cash (6) + D2 cash (3); account 6 L pays D1 (4) + D2 (2)
    await pay(payBody(u2.id, "CASH", 9 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }));
    let demands = (await demandsOf(u2.id)).filter((d) => d.status !== "VOID");
    expect(demands.map((d) => [d.installment_seq, d.status, d.paid_paise])).toEqual([[1, "PARTIALLY_PAID", 6 * L], [2, "PARTIALLY_PAID", 3 * L]]);
    await pay(payBody(u2.id, "ACCOUNT", 6 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }));
    demands = (await demandsOf(u2.id)).filter((d) => d.status !== "VOID");
    expect(demands.map((d) => [d.installment_seq, d.status, d.paid_paise])).toEqual([[1, "PAID", 10 * L], [2, "PAID", 5 * L]]);
    await pay(payBody(u2.id, "CASH", 20 * L, w.modes.UPI, { bank_account_id: w.bankAccountId })); // advance within agreed → normal
    let b = await getBooking(u2.id);
    expect(b.summary.cash).toMatchObject({ paid_paise: 29 * L, order_raised_paise: 9 * L, due_paise: -20 * L, advance_paise: 20 * L });
    expect(b.summary.total_due_paise).toBe(-20 * L);
    // Foundation completes: Villa CLP bookings (u1, u2) get 10 %, the Flexi booking gets nothing
    await completeStage(t, U(), w.stages.FOUNDATION, today);
    const run = await runDues({ block_id: U() });
    expect(run.demands_raised).toBe(2);
    expect((await demandsOf(u3.id)).filter((d) => d.status !== "VOID")).toHaveLength(1);
    demands = (await demandsOf(u2.id)).filter((d) => d.status !== "VOID");
    expect(demands.map((d) => [d.installment_seq, d.status, d.paid_paise])).toEqual([[1, "PAID", 10 * L], [2, "PAID", 5 * L], [3, "PARTIALLY_PAID", 6 * L]]);
    b = await getBooking(u2.id);
    expect(b.summary.cash).toMatchObject({ order_raised_paise: 15 * L, paid_paise: 29 * L, due_paise: -14 * L });
    expect(b.summary.account).toMatchObject({ order_raised_paise: 10 * L, paid_paise: 6 * L, due_paise: 4 * L });
    expect(b.summary.total_due_paise).toBe(-10 * L);
    expect(b.schedule[2]).toMatchObject({ seq: 3, status: "PARTIALLY_PAID", paid_paise: 6 * L });
    const d3 = demands[2]!;
    const buyer = (await notificationsFor("demand", d3.id)).filter((n) => n.type === "DEMAND_RAISED");
    expect(buyer.some((n) => n.recipient_type === "CUSTOMER" && n.recipient_id === w.customers[6])).toBe(true);
    expect(buyer.some((n) => n.recipient_type === "STAFF" && n.recipient_id === accountsId)).toBe(true);
    // running the engine again raises nothing (idempotent by (booking, seq))
    expect((await runDues({ block_id: U() })).demands_raised).toBe(0);
    expect((await runDues({ booking_id: u2.id })).demands_raised).toBe(0);
    const report = await t.request<Integrity & { bookings_checked: number }>("GET", `/api/v1/dues/integrity?project_id=${w.sgh.id}`, { token: admin });
    expect(report.body.ok, JSON.stringify(report.body.findings)).toBe(true);
  });

  it("plan change is allowed only while no installment demand has been paid (409 PLAN_CHANGE_BLOCKED) and is recorded as a revision", async () => {
    b4 = await createBooking(sales, bookingBody(w.sgh.flats.get("A-201")!.id, w.customers[3]!, { payment_plan_id: w.plans.DP }));
    expect(b4.plan_snapshot.name).toBe("Down Payment 10:85:5");
    const same = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b4.id}/plan-change`, { token: admin, body: { version: b4.version, payment_plan_id: w.plans.DP, reason: "same" } });
    expect(same.status).toBe(422);
    const forbidden = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b4.id}/plan-change`, { token: sales, body: { version: b4.version, payment_plan_id: w.plans.FLEXI, reason: "Customer asked" } });
    expect(forbidden.status).toBe(403);
    const changed = await t.request<Booking>("POST", `/api/v1/bookings/${b4.id}/plan-change`, { token: admin, body: { payment_plan_id: w.plans.FLEXI, reason: "Customer asked for Flexi" }, headers: { "if-match": `"${b4.version}"` } });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.plan_snapshot.name).toBe("Flexi 10:40:50");
    expect(changed.body.plan_revisions).toHaveLength(1);
    expect(changed.body.plan_revisions[0]?.after_plan_snapshot.name).toBe("Flexi 10:40:50");
    expect(changed.body.summary.raised_percent).toBe(10);
    expect(changed.body.schedule).toHaveLength(7);
    const demands = await demandsOf(b4.id);
    expect(demands.map((d) => d.status).sort()).toEqual(["OPEN", "VOID"]);
    const ledger = await ledgerOf(b4.id);
    expect(ledger.map((r) => r.event)).toEqual(["PLAN_CHANGE", "DEMAND"]);
    expect(ledger.at(-1)?.total_due_paise).toBe(10 * L);
    expect((await integrity(b4.id)).ok).toBe(true);
    await pay(payBody(b4.id, "CASH", L, w.modes.CASH));
    const blocked = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b4.id}/plan-change`, { token: admin, body: { version: changed.body.version, payment_plan_id: w.plans.DP, reason: "back" } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("PLAN_CHANGE_BLOCKED");
  });

  it("integrity report flags and repairs manufactured anomalies (summary mismatch, unsatisfied demand); clean data has zero findings", async () => {
    expect((await integrity(u2.id)).ok).toBe(true);
    await t.app.sql`update bookings set cash_paid_paise = cash_paid_paise + 1 where id = ${u2.id}`;
    const broken = await integrity(u2.id);
    expect(broken.ok).toBe(false);
    expect(broken.findings.map((f) => f.type)).toEqual(["SUMMARY_MISMATCH"]);
    // a demand for an installment whose stage is still pending (Top Slab on the Flexi booking)
    await t.app.sql`insert into demands (company_id, booking_id, project_id, block_id, customer_id, demand_number, installment_seq, installment_name, trigger_type, trigger_stage_id, percent, cumulative_percent, cash_demand_paise, account_demand_paise, total_demand_paise, demand_date, due_date)
      values (${t.companyId}, ${u3.id}, ${w.sgh.id}, ${U()}, ${w.customers[7]!}, 'DM-FAKE/0001', 3, 'Top Slab', 'ON_STAGE', ${w.stages.TOP_SLAB}, 10, 60, ${6 * L}, ${4 * L}, ${10 * L}, ${today}, ${today})`;
    const fake = await integrity(u3.id);
    expect(fake.findings.map((f) => f.type).sort()).toEqual(["SUMMARY_MISMATCH", "UNSATISFIED_DEMAND"]);
    const salesRepair = await t.request<ErrorBody>("POST", "/api/v1/dues/integrity/repair", { token: sales, body: { confirm: "REPAIR" } });
    expect(salesRepair.status).toBe(403);
    const repaired = await t.request<{ demands_voided: number; summaries_fixed: number; report_after: Integrity }>("POST", "/api/v1/dues/integrity/repair", { token: admin, body: { confirm: "REPAIR", booking_ids: [u2.id, u3.id] } });
    expect(repaired.status, repaired.text).toBe(200);
    expect(repaired.body.demands_voided).toBe(1);
    expect(repaired.body.summaries_fixed).toBeGreaterThanOrEqual(1);
    expect(repaired.body.report_after.findings.filter((f) => f.booking_id === u2.id || f.booking_id === u3.id)).toHaveLength(0);
    expect((await getBooking(u2.id)).summary.cash.paid_paise).toBe(29 * L);
    const runs = await t.request<List<{ ok: boolean }>>("GET", "/api/v1/dues/integrity/runs", { token: admin });
    expect(runs.body.total).toBeGreaterThan(0);
  });

  it("a dues run racing payments on the same bookings never deadlocks or double-raises: every payment lands, each booking gets exactly one Plinth demand", async () => {
    await completeStage(t, U(), w.stages.PLINTH, today);
    const results = await Promise.all([
      t.request<{ demands_raised: number }>("POST", "/api/v1/dues/run", { token: admin, body: { block_id: U() } }),
      ...Array.from({ length: 5 }, (_, i) => t.request<PostResponse>("POST", "/api/v1/payments", { token: accounts, body: payBody(u2.id, "ACCOUNT", 1000 * (i + 1), w.modes.UPI), headers: { "idempotency-key": key() } })),
      ...Array.from({ length: 3 }, (_, i) => t.request<PostResponse>("POST", "/api/v1/payments", { token: accounts, body: payBody(u1.id, "ACCOUNT", 1000 * (i + 1), w.modes.CASH), headers: { "idempotency-key": key() } })),
      t.request<{ demands_raised: number }>("POST", "/api/v1/dues/run", { token: admin, body: { block_id: U() } }),
    ]);
    for (const r of results) expect([200, 201], r.text).toContain(r.status);
    const raised = (results[0]!.body as { demands_raised: number }).demands_raised + (results.at(-1)!.body as { demands_raised: number }).demands_raised;
    expect(raised).toBe(2); // u1 + u2 (Villa CLP); the Flexi booking has no Plinth installment
    for (const b of [u1, u2]) {
      const demands = (await demandsOf(b.id)).filter((d) => d.status !== "VOID");
      expect(demands.filter((d) => d.installment_seq === 4)).toHaveLength(1);
      const ledger = await ledgerOf(b.id);
      expect(ledger.map((r) => r.seq)).toEqual(Array.from({ length: ledger.length }, (_, i) => i + 1));
      expect((await integrity(b.id)).ok).toBe(true);
    }
    expect((await getBooking(u2.id)).summary.account.paid_paise).toBe(6 * L + 15_000);
    expect((await getBooking(u1.id)).summary.account.paid_paise).toBe(6_000);
  });

  it("Flexi: the 40 % installment is raised exactly once when 60 days pass, never twice, even under concurrent runs (acceptance 8)", async () => {
    const early = await runDues({ booking_id: u3.id, as_of: addDays(today, 59) });
    expect(early.demands_raised).toBe(0);
    const [r1, r2] = await Promise.all([runDues({ booking_id: u3.id, as_of: addDays(today, 60) }), runDues({ booking_id: u3.id, as_of: addDays(today, 60) })]);
    expect(r1.demands_raised + r2.demands_raised).toBe(1);
    expect((await runDues({ booking_id: u3.id, as_of: addDays(today, 61) })).demands_raised).toBe(0);
    const demands = (await demandsOf(u3.id)).filter((d) => d.status !== "VOID");
    expect(demands.map((d) => d.installment_seq)).toEqual([1, 2]);
    expect(demands[1]).toMatchObject({ cash_demand_paise: 24 * L, account_demand_paise: 16 * L });
    const far = await t.request<ErrorBody>("POST", "/api/v1/dues/run", { token: admin, body: { booking_id: u3.id, as_of: "2099-01-01" } });
    expect(far.status).toBe(400);
  });

  it("jobs: overdue demands notify the buyer and Accounts once per day; the nightly integrity run notifies Super Admin + Accounts when findings exist", async () => {
    const d3 = (await demandsOf(u2.id)).find((d) => d.installment_seq === 3)!;
    expect(d3.status).toBe("PARTIALLY_PAID");
    await t.app.sql`update demands set due_date = ${addDays(today, -3)} where id = ${d3.id}`;
    const first = await overdueNotifications(t.app.db, t.app);
    expect(first["notified"]).toBeGreaterThanOrEqual(1);
    const notes = (await notificationsFor("demand", d3.id)).filter((n) => n.type === "DEMAND_OVERDUE");
    expect(notes.some((n) => n.recipient_type === "CUSTOMER" && n.recipient_id === w.customers[6])).toBe(true);
    expect(notes.some((n) => n.recipient_type === "STAFF" && n.recipient_id === accountsId)).toBe(true);
    const second = await overdueNotifications(t.app.db, t.app);
    expect(second["already_notified_today"]).toBeGreaterThanOrEqual(1);
    expect((await notificationsFor("demand", d3.id)).filter((n) => n.type === "DEMAND_OVERDUE")).toHaveLength(notes.length);
    const overdueList = await t.request<List<{ id: string; days_overdue: number }>>("GET", "/api/v1/demands?overdue_only=true", { token: accounts });
    expect(overdueList.body.items.find((d) => d.id === d3.id)?.days_overdue).toBe(3);
    // a cheque received four days ago has been in hand for four days
    const old = (await pay(payBody(u1.id, "ACCOUNT", 1234, w.modes.CHEQUE, { payment_date: addDays(today, -4), bank_account_id: w.bankAccountId, instrument: { number: "OLD1", date: addDays(today, -4) } }))).payment;
    const inHand = await t.request<List<{ id: string; days_in_hand: number }>>("GET", "/api/v1/payments/cheques?page_size=50", { token: accounts });
    expect(inHand.body.items.find((c) => c.id === old.id)?.days_in_hand).toBe(4);
    // the Flexi 40 % demand raised with a future as_of is "not yet satisfied" today → the nightly run flags it and notifies
    const report = await nightlyIntegrity(t.app.db, t.companyId);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.booking_id === u3.id && f.type === "UNSATISFIED_DEMAND")).toBe(true);
    const alerts = await t.app.sql<{ recipient_id: string }[]>`select recipient_id from notifications where type = 'INTEGRITY_FINDINGS' and recipient_type = 'STAFF'`;
    expect(alerts.map((a) => a.recipient_id)).toContain(accountsId);
  });
});

// ---------------------------------------------------------------------------
describe("cancellation (SPEC §12)", () => {
  it("blocked by pending cheques and refund > paid; cancels with If-Match: demands CANCELLED, flat and parking AVAILABLE, ledger closed, further payments and reversals rejected", async () => {
    const flat = w.sgh.flats.get("A-202")!;
    let b5 = await createBooking(sales, bookingBody(flat.id, w.customers[2]!, { parking_slot_ids: [w.sgh.parkingIds[1]!] }));
    const cheque = (await pay(payBody(b5.id, "CASH", 2 * L, w.modes.CHEQUE, { bank_account_id: w.bankAccountId, instrument: { number: "7777", date: today } }))).payment;
    const pending = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b5.id}/cancel`, { token: admin, body: { version: b5.version, reason: "Customer withdrew" } });
    expect(pending.status).toBe(409);
    expect(pending.body.error.code).toBe("PENDING_PAYMENTS");
    expect(pending.body.error.details?.["receipt_numbers"]).toEqual([cheque.receipt_number]);
    await t.request("POST", `/api/v1/payments/${cheque.id}/bounce`, { token: accounts, body: { version: cheque.version, reason: "Stopped" } });
    const paid = (await pay(payBody(b5.id, "CASH", 2 * L, w.modes.UPI, { bank_account_id: w.bankAccountId }))).payment;
    const tooMuch = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b5.id}/cancel`, { token: admin, body: { version: b5.version, reason: "Wrong entry", refund_paise: 3 * L } });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("REFUND_EXCEEDS_PAID");
    const forbidden = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b5.id}/cancel`, { token: sales, body: { version: b5.version, reason: "Wrong entry" } });
    expect(forbidden.status).toBe(403);
    const stale = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b5.id}/cancel`, { token: admin, body: { version: 99, reason: "Wrong entry" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    b5 = await getBooking(b5.id);
    const cancelled = await t.request<Booking>("POST", `/api/v1/bookings/${b5.id}/cancel`, { token: admin, body: { reason: "Customer withdrew", deduction_paise: 50_000_00, refund_paise: 1_50_000_00 }, headers: { "if-match": `"${b5.version}"` } });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.cancellation?.refund_paise).toBe(1_50_000_00);
    expect(cancelled.body.schedule[0]?.status).toBe("RAISED"); // cancelled demand stays visible
    expect((await demandsOf(b5.id)).map((d) => d.status)).toEqual(["CANCELLED"]);
    const [flatRow] = await t.app.sql<{ status: string; booking_id: string | null }[]>`select status, booking_id from flats where id = ${flat.id}`;
    expect(flatRow).toEqual({ status: "AVAILABLE", booking_id: null });
    const [slot] = await t.app.sql<{ status: string; booking_id: string | null }[]>`select status, booking_id from parking_slots where id = ${w.sgh.parkingIds[1]!}`;
    expect(slot).toEqual({ status: "AVAILABLE", booking_id: null });
    const ledger = await ledgerOf(b5.id);
    expect(ledger.at(-1)).toMatchObject({ event: "CANCELLATION", amount_paise: -1_50_000_00 });
    const after = await payFail(payBody(b5.id, "CASH", 100, w.modes.CASH));
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe("BOOKING_NOT_ACTIVE");
    const reverse = await t.request<ErrorBody>("POST", `/api/v1/payments/${paid.id}/reverse`, { token: accounts, body: { version: paid.version, reason: "Wrong entry" } });
    expect(reverse.status).toBe(409);
    expect(reverse.body.error.code).toBe("BOOKING_NOT_ACTIVE");
    const again = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b5.id}/cancel`, { token: admin, body: { version: cancelled.body.version, reason: "Wrong entry" } });
    expect(again.status).toBe(409);
    const rebook = await createBooking(sales, bookingBody(flat.id, w.customers[3]!));
    expect(rebook.status).toBe("ACTIVE");
    const list = await t.request<List<Booking>>("GET", `/api/v1/bookings?status=CANCELLED`, { token: admin });
    expect(list.body.items.map((b) => b.id)).toEqual([b5.id]);
    const csv = await t.request("GET", "/api/v1/bookings?format=csv", { token: admin });
    expect(csv.status).toBe(200);
    expect(csv.text.split("\n")[0]).toContain("total_due_paise");
    expect(csv.text).toContain(b5.booking_number);
  });
});

// ---------------------------------------------------------------------------
describe("the worked example (SPEC §11, acceptance 4): ten rows to the rupee, final due ₹0, booking Completed, flat Sold", () => {
  it("reproduces all 10 rows", async () => {
    const flat = w.ggv.flats.get("G-101")!;
    const g = w.ggv.towerId;
    let b = await createBooking(admin, bookingBody(flat.id, w.customers[0]!, { other_charges: [{ charge_type_id: w.charges.REGISTRY, amount_paise: 25 * L, gst_percent: 0, demand_at: "ON_POSSESSION" }] }));
    const steps: { stage: keyof MoneyWorld["stages"] | null; bucket: "CASH" | "ACCOUNT"; amount: number; cash: number; account: number; total: number }[] = [
      { stage: null, bucket: "ACCOUNT", amount: 4 * L, cash: 6 * L, account: 0, total: 6 * L },
      { stage: "EXCAVATION", bucket: "CASH", amount: 8 * L, cash: L, account: 2 * L, total: 3 * L },
      { stage: "FOUNDATION", bucket: "ACCOUNT", amount: 12 * L, cash: 7 * L, account: -6 * L, total: L },
      { stage: "PLINTH", bucket: "CASH", amount: 5 * L, cash: 5 * L, account: -4 * L, total: L },
      { stage: "FIRST_SLAB", bucket: "CASH", amount: 10 * L, cash: L, account: 0, total: L },
      { stage: "TOP_SLAB", bucket: "ACCOUNT", amount: 15 * L, cash: 7 * L, account: -11 * L, total: -4 * L },
      { stage: "BRICKWORK", bucket: "CASH", amount: 7 * L, cash: 6 * L, account: -7 * L, total: -L },
      { stage: "PLASTERING", bucket: "CASH", amount: 20 * L, cash: -5 * L, account: -L, total: -6 * L },
      { stage: "FLOORING", bucket: "ACCOUNT", amount: 9 * L, cash: L, account: -6 * L, total: -5 * L },
      { stage: "POSSESSION", bucket: "CASH", amount: 10 * L, cash: 0, account: 0, total: 0 },
    ];
    for (const [i, s] of steps.entries()) {
      if (s.stage) {
        await completeStage(t, g, w.stages[s.stage], today);
        const run = await runDues({ block_id: g });
        expect(run.demands_raised, `stage ${s.stage}`).toBe(1);
      }
      const r = await pay(payBody(b.id, s.bucket, s.amount, s.bucket === "CASH" ? w.modes.CASH : w.modes.NEFT, s.bucket === "CASH" ? {} : { bank_account_id: w.bankAccountId, instrument: { number: `UTR${i + 1}` } }));
      expect(r.summary, `row #${i + 1}`).toMatchObject({ cash_due_paise: s.cash, account_due_paise: s.account, total_due_paise: s.total });
      const row = (await ledgerOf(b.id)).find((l) => l.ref_number === r.payment.receipt_number)!;
      expect(row, `ledger row #${i + 1}`).toMatchObject({ event: "PAYMENT", bucket: s.bucket, amount_paise: s.amount, cash_due_paise: s.cash, account_due_paise: s.account, total_due_paise: s.total });
    }
    b = await getBooking(b.id);
    expect(b.summary).toMatchObject({ raised_percent: 100, total_due_paise: 0, total_paid_paise: CR });
    expect(b.summary.cash).toMatchObject({ order_raised_paise: 60 * L, paid_paise: 60 * L, due_paise: 0 });
    expect(b.summary.account).toMatchObject({ order_raised_paise: 40 * L, paid_paise: 40 * L, due_paise: 0 });
    expect(b.schedule.every((r) => r.status === "PAID")).toBe(true);
    // possession completed → registry demanded on possession; handover blocked until it is paid
    const registry = b.other_charges[0]!;
    expect(registry.demand_number).toMatch(/^DM-/);
    expect(b.summary.other_charges_due_paise).toBe(25 * L);
    const blocked = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b.id}/complete`, { token: admin, body: { version: b.version } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("HANDOVER_BLOCKED");
    await pay({ booking_id: b.id, against: "OTHER_CHARGE", other_charge_id: registry.id, amount_paise: 25 * L, payment_date: today, payment_mode_id: w.modes.CASH });
    const salesComplete = await t.request<ErrorBody>("POST", `/api/v1/bookings/${b.id}/complete`, { token: sales, body: { version: b.version } });
    expect(salesComplete.status).toBe(403);
    const done = await t.request<Booking>("POST", `/api/v1/bookings/${b.id}/complete`, { token: admin, body: { version: b.version, completion_notes: "Keys handed over" } });
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.completed_at).toBeTruthy();
    const [flatRow] = await t.app.sql<{ status: string }[]>`select status from flats where id = ${flat.id}`;
    expect(flatRow?.status).toBe("SOLD");
    expect((await integrity(b.id)).ok).toBe(true);
    const ledger = await ledgerOf(b.id);
    expect(ledger.filter((r) => r.event === "DEMAND")).toHaveLength(10);
    const csv = await t.request("GET", `/api/v1/bookings/${b.id}/ledger?format=csv`, { token: accounts });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text.split("\r\n").filter(Boolean)).toHaveLength(ledger.length + 1);
    // the completed booking no longer accepts payments
    const late = await payFail(payBody(b.id, "CASH", 100, w.modes.CASH));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("BOOKING_NOT_ACTIVE");
  });
});

// ---------------------------------------------------------------------------
describe("roznamcha and contra entries (SPEC §11)", () => {
  it("day book: cash in hand from cleared cash receipts; a deposit cannot exceed it; Sales cannot record contra", async () => {
    const day = await t.request<{ opening_cash_paise: number; cash_received_paise: number; closing_cash_paise: number; receipts: { mode_code: string; category: string }[]; by_mode: { mode_code: string; amount_paise: number }[]; by_category: { category: string; amount_paise: number }[]; totals: { receipts_count: number; pending_cheques_paise: number } }>("GET", `/api/v1/roznamcha?date=${today}`, { token: accounts });
    expect(day.status, day.text).toBe(200);
    const [cash] = await t.app.sql<{ n: string }[]>`select coalesce(sum(p.amount_paise), 0)::text as n from payments p join payment_modes m on m.id = p.payment_mode_id where p.status = 'CLEARED' and m.is_cash and p.payment_date = ${today}`;
    const [cleared] = await t.app.sql<{ n: string; c: string }[]>`select coalesce(sum(amount_paise), 0)::text as n, count(*)::text as c from payments where status = 'CLEARED' and payment_date = ${today}`;
    expect(day.body.cash_received_paise).toBe(Number(cash!.n));
    expect(day.body.totals.receipts_count).toBe(Number(cleared!.c));
    expect(day.body.receipts.reduce((s, r) => s + 1, 0)).toBe(Number(cleared!.c));
    expect(day.body.by_mode.find((m) => m.mode_code === "CASH")?.amount_paise).toBe(Number(cash!.n));
    expect(day.body.by_category.reduce((s, c) => s + c.amount_paise, 0)).toBe(Number(cleared!.n));
    expect(day.body.opening_cash_paise).toBe(7 * L); // u1's backdated cash advance (5 days ago)
    const inHand = day.body.opening_cash_paise + day.body.cash_received_paise;
    const tooMuch = await t.request<ErrorBody>("POST", "/api/v1/roznamcha/contra", { token: accounts, body: { entry_date: today, type: "DEPOSIT", amount_paise: inHand + 1, bank_account_id: w.bankAccountId } });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("INSUFFICIENT_CASH");
    const forbidden = await t.request<ErrorBody>("POST", "/api/v1/roznamcha/contra", { token: sales, body: { entry_date: today, type: "DEPOSIT", amount_paise: 1, bank_account_id: w.bankAccountId } });
    expect(forbidden.status).toBe(403);
    const dep = await t.request<{ id: string; bank_account_label: string }>("POST", "/api/v1/roznamcha/contra", { token: accounts, body: { entry_date: today, type: "DEPOSIT", amount_paise: 5 * L, bank_account_id: w.bankAccountId, remarks: "Evening deposit" }, headers: { "idempotency-key": key() } });
    expect(dep.status, dep.text).toBe(201);
    expect(dep.body.bank_account_label).toBe("HDFC Bank ••6789");
    const after = await t.request<{ closing_cash_paise: number; cash_deposited_paise: number; contra_entries: unknown[] }>("GET", `/api/v1/roznamcha/range?from=${today}&to=${today}`, { token: accounts });
    expect(after.body.cash_deposited_paise).toBe(5 * L);
    expect(after.body.closing_cash_paise).toBe(inHand - 5 * L);
    expect(after.body.contra_entries).toHaveLength(1);
    const tomorrow = await t.request<{ opening_cash_paise: number }>("GET", `/api/v1/roznamcha?date=${addDays(today, 1)}`, { token: accounts });
    expect(tomorrow.body.opening_cash_paise).toBe(inHand - 5 * L);
    const list = await t.request<List<unknown>>("GET", "/api/v1/roznamcha/contra?type=DEPOSIT", { token: accounts });
    expect(list.body.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("scope → 404, permissions, audit hygiene (SPEC §1–2)", () => {
  let paSgh: string;
  let accSgh: string;
  let ggvBooking: Booking;
  let ggvPayment: Payment;

  it("project-scoped users get 404 (never 403) on every booking/payment route of another project", async () => {
    const roles = await t.request<List<{ id: string; name: string }>>("GET", "/api/v1/roles", { token: admin });
    const pa = roles.body.items.find((r) => r.name === "Project Admin")!;
    const acc = roles.body.items.find((r) => r.name === "Accounts")!;
    expect((await t.request("POST", "/api/v1/users", { token: admin, body: { name: "PA SGH", email: "pa.sgh@sgb.in", role_id: pa.id, all_projects: false, project_ids: [w.sgh.id], password: "Project@12345", must_change_password: false } })).status).toBe(201);
    expect((await t.request("POST", "/api/v1/users", { token: admin, body: { name: "Accounts SGH", email: "acc.sgh@sgb.in", role_id: acc.id, all_projects: false, project_ids: [w.sgh.id], password: "Accounts@12345", must_change_password: false } })).status).toBe(201);
    paSgh = (await t.login("pa.sgh@sgb.in", "Project@12345")).access_token;
    accSgh = (await t.login("acc.sgh@sgb.in", "Accounts@12345")).access_token;
    ggvBooking = await createBooking(admin, bookingBody(w.ggv.flats.get("G-102")!.id, w.customers[1]!));
    ggvPayment = (await pay(payBody(ggvBooking.id, "CASH", L, w.modes.CHEQUE, { bank_account_id: w.bankAccountId, instrument: { number: "9", date: today } }))).payment;
    const b = ggvBooking.id;
    for (const url of [`/bookings/${b}`, `/bookings/${b}/ledger`, `/bookings/${b}/schedule`, `/bookings/${b}/demands`, `/bookings/${b}/payments`, `/payments/${ggvPayment.id}`, `/payments/${ggvPayment.id}/receipt`, `/blocks/${w.ggv.towerId}/applicable-plans`]) {
      const r = await t.request<ErrorBody>("GET", `/api/v1${url}`, { token: accSgh });
      expect(r.status, url).toBe(404);
      expect(r.body.error.code, url).toBe("NOT_FOUND");
    }
    const posts: [string, unknown][] = [
      [`/payments/${ggvPayment.id}/clear`, { version: ggvPayment.version }],
      [`/payments/${ggvPayment.id}/bounce`, { version: ggvPayment.version, reason: "Wrong entry" }],
      [`/payments/${ggvPayment.id}/reverse`, { version: ggvPayment.version, reason: "Wrong entry" }],
      ["/payments", payBody(b, "CASH", 100, w.modes.CASH)],
    ];
    for (const [url, body] of posts) {
      const r = await t.request<ErrorBody>("POST", `/api/v1${url}`, { token: accSgh, body, headers: { "idempotency-key": key() } });
      expect(r.status, url).toBe(404);
    }
    for (const [url, body] of [[`/bookings/${b}`, { version: 1, remarks: "x" }]] as [string, unknown][]) {
      expect((await t.request("PATCH", `/api/v1${url}`, { token: paSgh, body })).status, url).toBe(404);
    }
    expect((await t.request("POST", `/api/v1/bookings/${b}/other-charges`, { token: paSgh, body: { version: 1, charge_type_id: w.charges.LEGAL, amount_paise: 1, gst_percent: 0, demand_at: "MANUAL" } })).status).toBe(404);
    expect((await t.request("POST", "/api/v1/bookings/preview-schedule", { token: paSgh, body: { plan_id: w.plans.VILLA_CLP, block_id: w.ggv.towerId, booking_date: today, cash_agreed_paise: 1, account_agreed_paise: 1 } })).status).toBe(404);
    expect((await t.request("POST", "/api/v1/bookings", { token: paSgh, body: bookingBody(w.ggv.flats.get("G-103")!.id, w.customers[1]!) })).status).toBe(404);
    const list = await t.request<List<Booking>>("GET", "/api/v1/bookings?page_size=100", { token: paSgh });
    expect(list.body.items.some((x) => x.id === b)).toBe(false);
    expect(list.body.items.length).toBeGreaterThan(0);
    const pays = await t.request<List<Payment>>("GET", `/api/v1/payments?booking_id=${b}`, { token: accSgh });
    expect(pays.body.total).toBe(0);
    const demands = await t.request<List<Demand>>("GET", `/api/v1/demands?booking_id=${b}`, { token: accSgh });
    expect(demands.body.total).toBe(0);
    expect((await t.request("GET", `/api/v1/payments?project_id=${w.ggv.id}`, { token: accSgh })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/dues/integrity?project_id=${w.ggv.id}`, { token: admin })).status).toBe(200);
    // the same routes work inside the scope
    expect((await t.request("GET", `/api/v1/bookings/${b1.id}/ledger`, { token: accSgh })).status).toBe(200);
    expect((await t.request("GET", `/api/v1/payments?booking_id=${b1.id}`, { token: accSgh })).status).toBe(200);
  });

  it("every money route declares a permission; Employee is read-only; audit rows exist for every mutation and never carry an account number", async () => {
    const money = t.app.routeRegistry.filter((r) => /^\/api\/v1\/(bookings|booking-drafts|payments|demands|roznamcha|dues|payment-plan-assignments)(\/|$)|applicable-plans/.test(r.url));
    expect(money.length).toBeGreaterThan(25);
    for (const r of money) expect(r.permission, `${r.method} ${r.url}`).toBeTruthy();
    const employee = (await t.loginAs("employee")).access_token;
    expect((await t.request("GET", "/api/v1/bookings", { token: employee })).status).toBe(403);
    expect((await t.request("GET", "/api/v1/payments", { token: employee })).status).toBe(403);
    expect((await t.request("GET", "/api/v1/roznamcha", { token: employee })).status).toBe(403);
    expect((await t.request("POST", "/api/v1/dues/run", { token: accounts, body: {} })).status).toBe(403);
    expect((await t.request("GET", "/api/v1/payment-plan-assignments", { token: sales })).status).toBe(403);
    const actions = await t.app.sql<{ action: string; n: string }[]>`select action, count(*)::text as n from audit_logs group by action`;
    const seen = new Set(actions.map((a) => a.action));
    for (const a of ["booking.create", "booking.agreement_revise", "booking.plan_change", "booking.cancel", "booking.complete", "payment.post", "payment.clear", "payment.bounce", "payment.reverse", "demand.raise", "demand.void", "other_charge.add", "other_charge.demand", "contra.create", "plan_assignment.create", "dues.run", "integrity.repair"]) {
      expect(seen.has(a), a).toBe(true);
    }
    const leak = await t.app.sql<{ n: string }[]>`select count(*)::text as n from audit_logs where coalesce(before::text, '') || coalesce(after::text, '') like ${`%${w.bankAccountNumber}%`}`;
    expect(Number(leak[0]!.n)).toBe(0);
    const leak4 = await t.app.sql<{ n: string }[]>`select count(*)::text as n from audit_logs where (action like 'payment.%' or action like 'contra.%') and (coalesce(after::text, '') like '%account_number%' or coalesce(after::text, '') like '%_enc%')`;
    expect(Number(leak4[0]!.n)).toBe(0);
    const payAudit = await t.app.sql<{ actor_name: string; ip: string | null; request_id: string | null }[]>`select actor_name, ip, request_id from audit_logs where action = 'payment.post' limit 1`;
    expect(payAudit[0]?.actor_name).toBeTruthy();
    expect(payAudit[0]?.request_id).toBeTruthy();
  });
});
