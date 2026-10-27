import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { runJob } from "../../src/jobs/index.js";
import { overdueNotifications } from "../../src/modules/money/index.js";
import { completeStage, createMoneyWorld, LIST_PRICE_PAISE, type MoneyWorld } from "./fixtures/money.js";
import { post, towerCBody } from "./fixtures/inventory.js";
import { buildTestApp, type ErrorBody, type TestContext, type TestResponse } from "./helpers.js";

/**
 * Money & business-rule hardening (audit group E + related A/C/G items):
 *  1 agreement value guard · 2 canonical ledger order + row-level integrity (e) · 3 plan ↔ tower fit at every change point, PLAN_STAGE_MISSING,
 *  handover needs every installment raised and agreed − paid ≤ 0 · 4 lock order / retry under concurrency · 5 crash-safe payment idempotency ·
 *  6 holds (reserve / release / lapsed / HOLD_EXPIRY) · 7 other-charge bells keyed by the line · 8 reversal on a COMPLETED booking ·
 *  9 idempotent booking drafts · 10 DUES_CATCHUP + overdue claim after commit · 11 bookings list payload.
 */

const L = 10_000_000;
const CR = 100 * L;

type Bucket = { agreed_paise: number; order_raised_paise: number; paid_paise: number; due_paise: number };
type Booking = {
  id: string;
  version: number;
  status: string;
  booking_number: string;
  flat_id: string;
  agreement_value_paise: number;
  list_price_paise?: number | null;
  price_deviation_reason?: string | null;
  price_deviation_by?: string | null;
  summary: {
    cash: Bucket;
    account: Bucket;
    total_due_paise: number;
    total_paid_paise: number;
    other_charges_due_paise: number;
  };
  other_charges: { id: string; name: string; total_paise: number; demand_number: string | null }[];
};
type Payment = { id: string; version: number; receipt_number: string; status: string };
type PostResponse = { payment: Payment; ledger_seq: number | null };
type LedgerRow = {
  seq: number;
  event: string;
  ref_number: string | null;
  ref_id: string | null;
  entry_date: string;
  amount_paise: number;
  cash_paid_cum_paise: number;
  account_paid_cum_paise: number;
  cash_order_raised_paise: number;
  account_order_raised_paise: number;
  cash_due_paise: number;
  account_due_paise: number;
  total_due_paise: number;
};
type List<T> = { items: T[]; total: number };
type Integrity = {
  ok: boolean;
  findings: { type: string; booking_id: string; detail: string; repairable: boolean; installment_seq: number | null }[];
  counts: Record<string, number>;
};
type Flat = {
  id: string;
  version: number;
  status: string;
  flat_number: string;
  hold_by_user_id: string | null;
  hold_until: string | null;
  price_paise: number;
};

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let sales2: string;
let salesId: string;
let w: MoneyWorld;
let today: string;
let keyCounter = 0;
const key = () => `mh-${Date.now()}-${++keyCounter}`;

function bookingBody(flatId: string, customerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    flat_id: flatId,
    customer_id: customerId,
    booking_date: today,
    agreement_value_paise: CR,
    cash_agreed_paise: 60 * L,
    account_agreed_paise: 40 * L,
    plan_acceptance_mode: "IN_PERSON",
    plan_accepted_on: today,
    ...extra,
  };
}
function book(token: string, body: Record<string, unknown>): Promise<TestResponse<Booking & ErrorBody>> {
  return t.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
    token,
    body,
    headers: { "idempotency-key": key() },
  });
}
async function mustBook(token: string, body: Record<string, unknown>): Promise<Booking> {
  const r = await book(token, body);
  expect(r.status, r.text).toBe(201);
  return r.body;
}
async function getBooking(id: string): Promise<Booking> {
  const r = await t.request<Booking>("GET", `/api/v1/bookings/${id}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function ledgerOf(id: string): Promise<LedgerRow[]> {
  const r = await t.request<List<LedgerRow>>("GET", `/api/v1/bookings/${id}/ledger?page_size=200`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}
function payBody(
  bookingId: string,
  bucket: "CASH" | "ACCOUNT",
  amount: number,
  date = today,
  mode: "CASH" | "UPI" = "CASH",
): Record<string, unknown> {
  return {
    booking_id: bookingId,
    against: "FLAT_VALUE",
    bucket,
    amount_paise: amount,
    payment_date: date,
    payment_mode_id: w.modes[mode],
    ...(mode === "UPI"
      ? { bank_account_id: w.bankAccountId, instrument: { number: `UPI${Date.now()}${++keyCounter}` } }
      : {}),
  };
}
async function pay(body: Record<string, unknown>, idem = key()): Promise<PostResponse> {
  const r = await t.request<PostResponse>("POST", "/api/v1/payments", {
    token: accounts,
    body,
    headers: { "idempotency-key": idem },
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
}
async function integrity(bookingId: string): Promise<Integrity> {
  const r = await t.request<Integrity>("GET", `/api/v1/dues/integrity?booking_id=${bookingId}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function blockVersion(blockId: string): Promise<number> {
  const r = await t.request<{ version: number }>("GET", `/api/v1/blocks/${blockId}/construction`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body.version;
}
function stageStatus(blockId: string, stageId: string, completedOn: string, intermediate: Record<string, string> = {}) {
  return blockVersion(blockId).then((version) =>
    t.request<{ demands_raised: number } & ErrorBody>("POST", `/api/v1/blocks/${blockId}/construction/status`, {
      token: admin,
      body: {
        version,
        stage_id: stageId,
        completed_on: completedOn,
        intermediate_dates: intermediate,
        notify_buyers: false,
      },
      headers: { "idempotency-key": key() },
    }),
  );
}
async function getFlat(id: string, token = admin): Promise<Flat> {
  const r = await t.request<Flat>("GET", `/api/v1/flats/${id}`, { token });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function newTower(
  projectId: string,
  name: string,
  code: string,
  floors: number,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; flats: Map<string, Flat> }> {
  const block = await post<{ id: string }>(
    t,
    admin,
    "/api/v1/blocks",
    towerCBody(projectId, w.basics, {
      name,
      code,
      floors,
      skip_floors: [],
      refuge_floors: [],
      floor_plans: [{ from_floor: 1, to_floor: floors, floor_plan_template_id: w.basics.templates.FP4 }],
      ...extra,
    }),
  );
  await t.app
    .sql`update flats set price_paise = ${LIST_PRICE_PAISE}, rate_card_id = null, price_breakup = ${JSON.stringify([{ label: "Base price", amount_paise: LIST_PRICE_PAISE }])}::jsonb where block_id = ${block.id}`;
  const r = await t.request<List<Flat>>("GET", `/api/v1/flats?block_id=${block.id}&page_size=200&sort=flat_number`, {
    token: admin,
  });
  return { id: block.id, flats: new Map(r.body.items.map((f) => [f.flat_number, f])) };
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  const s = await t.loginAs("sales");
  sales = s.access_token;
  salesId = s.user.id;
  w = await createMoneyWorld(t, admin);
  const roles = await t.request<List<{ id: string; name: string }>>("GET", "/api/v1/roles?page_size=50", {
    token: admin,
  });
  const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
  const u = await t.request("POST", "/api/v1/users", {
    token: admin,
    body: {
      name: "Second Sales",
      email: "sales2@sgb.in",
      role_id: salesRole.id,
      all_projects: true,
      project_ids: [],
      password: "Sales2@12345",
      must_change_password: false,
    },
  });
  expect(u.status, u.text).toBe(201);
  sales2 = (await t.login("sales2@sgb.in", "Sales2@12345")).access_token;
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
describe("1. agreement value guard (SPEC §12 'editable with permission')", () => {
  it("Sales books only at the flat's list price; a deviation needs agreement.edit AND a reason, is stored and audited", async () => {
    const atList = await mustBook(sales, bookingBody(w.sgh.flats.get("A-101")!.id, w.customers[0]!));
    const detail = await getBooking(atList.id);
    expect(detail).toMatchObject({
      agreement_value_paise: CR,
      list_price_paise: CR,
      price_deviation_reason: null,
      price_deviation_by: null,
    });

    const flat = w.sgh.flats.get("A-102")!;
    const cheap = { agreement_value_paise: CR - L, cash_agreed_paise: 59 * L, account_agreed_paise: 40 * L };
    // Sales: no agreement.edit → 422 even with a reason (the ₹1 Cr flat at ₹1 case of the audit)
    const salesTry = await book(
      sales,
      bookingBody(flat.id, w.customers[1]!, { ...cheap, price_deviation_reason: "Festive discount" }),
    );
    expect(salesTry.status).toBe(422);
    expect(salesTry.body.error).toMatchObject({
      code: "BUSINESS_RULE",
      details: {
        rule: "PRICE_DEVIATION_NOT_ALLOWED",
        list_price_paise: CR,
        agreement_value_paise: CR - L,
        needs: ["agreement.edit permission"],
      },
    });
    const oneRupee = await book(
      sales,
      bookingBody(flat.id, w.customers[1]!, {
        agreement_value_paise: 100,
        cash_agreed_paise: 100,
        account_agreed_paise: 0,
      }),
    );
    expect(oneRupee.body.error.details?.["rule"]).toBe("PRICE_DEVIATION_NOT_ALLOWED");
    // admin without a reason → 422
    const noReason = await book(admin, bookingBody(flat.id, w.customers[1]!, cheap));
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.details?.["needs"]).toEqual(["price_deviation_reason"]);
    expect((await getFlat(flat.id)).status).toBe("AVAILABLE");
    // admin with a reason → booked at the deviated value, recorded and audited
    const ok = await mustBook(
      admin,
      bookingBody(flat.id, w.customers[1]!, { ...cheap, price_deviation_reason: "Corner unit facing the substation" }),
    );
    const d = await getBooking(ok.id);
    expect(d).toMatchObject({
      agreement_value_paise: CR - L,
      list_price_paise: CR,
      price_deviation_reason: "Corner unit facing the substation",
    });
    expect(d.price_deviation_by).toBeTruthy();
    const [audit] = await t.app.sql<
      { before: { list_price_paise: number }; after: { deviation_paise: number; reason: string } }[]
    >`select before, after from audit_logs where action = 'booking.price_deviation' and entity_id = ${ok.id}`;
    expect(audit).toMatchObject({
      before: { list_price_paise: CR },
      after: { deviation_paise: -L, reason: "Corner unit facing the substation" },
    });
  });
});

// ---------------------------------------------------------------------------
describe("2. canonical ledger order (posting order) and row-level integrity (e)", () => {
  let g1: Booking;
  it("a payment dated before an earlier-posted demand keeps its seq and running balances through an agreement revision", async () => {
    g1 = await mustBook(
      sales,
      bookingBody(w.ggv.flats.get("G-101")!.id, w.customers[2]!, {
        booking_date: addDays(today, -30),
        plan_accepted_on: addDays(today, -30),
      }),
    );
    // Excavation completes yesterday → its demand is posted now; then a cheque received 20 days ago is posted
    const st = await stageStatus(w.ggv.towerId, w.stages.EXCAVATION, addDays(today, -1));
    expect(st.status, st.text).toBe(200);
    await pay(payBody(g1.id, "CASH", 7 * L, addDays(today, -20)));
    const live = await ledgerOf(g1.id);
    expect(live.map((r) => r.event)).toEqual(["DEMAND", "DEMAND", "PAYMENT"]);
    expect(live[2]!.entry_date).toBe(addDays(today, -20)); // business date kept for display, posting order kept for seq
    const b = await getBooking(g1.id);
    const rev = await t.request<ErrorBody>("POST", `/api/v1/bookings/${g1.id}/agreement-revisions`, {
      token: admin,
      body: {
        version: b.version,
        agreement_value_paise: CR,
        cash_agreed_paise: 55 * L,
        account_agreed_paise: 45 * L,
        reason: "Loan sanctioned higher",
      },
      headers: { "idempotency-key": key() },
    });
    expect(rev.status, rev.text).toBe(201);
    const after = await ledgerOf(g1.id);
    expect(after.map((r) => r.event)).toEqual(["DEMAND", "DEMAND", "PAYMENT", "AGREEMENT_CHANGE"]);
    const keyOf = (r: LedgerRow) => [
      r.seq,
      r.event,
      r.ref_id,
      r.amount_paise,
      r.cash_paid_cum_paise,
      r.account_paid_cum_paise,
      r.cash_due_paise,
      r.account_due_paise,
      r.total_due_paise,
    ];
    // rows before the revision are recomputed with the agreement in force when they were posted: identical to the live rows
    expect(after.slice(0, 3).map(keyOf)).toEqual(live.map(keyOf));
    expect((await integrity(g1.id)).ok).toBe(true);
  });

  it("finding (e) compares the stored ledger row by row: two swapped rows with identical aggregates are flagged and repaired", async () => {
    const before = await ledgerOf(g1.id);
    await t.app.sql.begin(async (tx) => {
      // manufacture the corruption below the append-only guard (src/sql/0006_money_guards.sql): test-only, as the superuser
      await tx`set local session_replication_role = replica`;
      await tx`update ledger_entries set seq = -2 where booking_id = ${g1.id} and seq = 2`;
      await tx`update ledger_entries set seq = 2 where booking_id = ${g1.id} and seq = 3`;
      await tx`update ledger_entries set seq = 3 where booking_id = ${g1.id} and seq = -2`;
    });
    const report = await integrity(g1.id);
    expect(report.ok).toBe(false);
    const f = report.findings.find((x) => x.type === "SUMMARY_MISMATCH");
    expect(f?.detail).toContain("Stored ledger rows differ from the rebuild");
    expect(f?.detail).not.toContain("Stored summary differs"); // every aggregate still agrees
    const repaired = await t.request<{ report_after: Integrity; ledgers_rebuilt: number }>(
      "POST",
      "/api/v1/dues/integrity/repair",
      { token: admin, body: { confirm: "REPAIR", booking_ids: [g1.id] }, headers: { "idempotency-key": key() } },
    );
    expect(repaired.status, repaired.text).toBe(200);
    expect(repaired.body.report_after.findings.filter((x) => x.booking_id === g1.id)).toEqual([]);
    // the repair restated the book as a new epoch (contract C7): the current epoch is the canonical ledger again
    expect((await ledgerOf(g1.id)).map((r) => [r.seq, r.event, r.ref_id])).toEqual(
      before.map((r) => [r.seq, r.event, r.ref_id]),
    );
    const rebuilds = await t.app.sql<{ reason: string; from_epoch: number; to_epoch: number }[]>`
      select reason, from_epoch, to_epoch from ledger_rebuilds where booking_id = ${g1.id}`;
    expect(rebuilds).toEqual([{ reason: "INTEGRITY_REPAIR", from_epoch: 1, to_epoch: 2 }]);
  });
});

// ---------------------------------------------------------------------------
describe("3. plan ↔ tower fit at every change point; handover needs every installment raised", () => {
  it("replacing a tower's stage sequence that drops a stage of an assigned plan → 409 PLAN_STAGES_MISSING (nothing changes)", async () => {
    const block = await t.request<{ version: number; stage_sequence: string[] }>(
      "GET",
      `/api/v1/blocks/${w.sgh.towerUId}`,
      { token: admin },
    );
    const without = block.body.stage_sequence.filter((id) => id !== w.stages.BRICKWORK);
    const r = await t.request<ErrorBody>("POST", `/api/v1/blocks/${w.sgh.towerUId}/stage-sequence`, {
      token: admin,
      body: { version: block.body.version, stage_sequence: without },
    });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("PLAN_STAGES_MISSING");
    const missing = r.body.error.details?.["missing_stages"] as { id: string; plan_name: string; block_id: string }[];
    expect(
      missing.some((m) => m.id === w.stages.BRICKWORK && m.block_id === w.sgh.towerUId && m.plan_name === "Villa CLP"),
    ).toBe(true);
    const same = await t.request<{ version: number; stage_sequence: string[] }>(
      "GET",
      `/api/v1/blocks/${w.sgh.towerUId}`,
      { token: admin },
    );
    expect(same.body).toMatchObject({ version: block.body.version, stage_sequence: block.body.stage_sequence });
    // the same through PATCH /blocks/:id
    const patch = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${w.sgh.towerUId}`, {
      token: admin,
      body: { version: block.body.version, stage_sequence: without },
    });
    expect(patch.status, patch.text).toBe(409);
    expect(patch.body.error.code).toBe("PLAN_STAGES_MISSING");
  });

  it("creating a tower under a project-wide assignment whose plan needs a stage the tower lacks → 409, no block is created", async () => {
    const seq = (
      await t.request<{ stage_sequence: string[] }>("GET", `/api/v1/blocks/${w.sgh.towerId}`, { token: admin })
    ).body.stage_sequence.filter((id) => id !== w.stages.PLASTERING);
    const r = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(w.sgh.id, w.basics, {
        name: "Tower X",
        code: "X",
        floors: 1,
        skip_floors: [],
        refuge_floors: [],
        floor_plans: [{ from_floor: 1, to_floor: 1, floor_plan_template_id: w.basics.templates.FP4 }],
        stage_sequence: seq,
      }),
      headers: { "idempotency-key": key() },
    });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("PLAN_STAGES_MISSING");
    const [{ n }] = (await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from blocks where code = 'X'`) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });

  it("editing a plan's installments onto a stage an assigned tower lacks → 409 (installments unchanged); an assignment edit re-validates too", async () => {
    const plan = await t.request<{ version: number; installments: { seq: number; trigger_stage_id: string | null }[] }>(
      "GET",
      `/api/v1/masters/payment-plans/${w.plans.FLEXI}`,
      { token: admin },
    );
    expect(plan.status, plan.text).toBe(200);
    const installments = [
      { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
      { seq: 2, name: "60 days", percent: 40, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 60 },
      { seq: 3, name: "Landscaping", percent: 50, trigger_type: "ON_STAGE", trigger_stage_id: w.alienStageId },
    ];
    const r = await t.request<ErrorBody>("PATCH", `/api/v1/masters/payment-plans/${w.plans.FLEXI}`, {
      token: admin,
      body: { version: plan.body.version, installments },
    });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("PLAN_STAGES_MISSING");
    const same = await t.request<{ version: number; installments: { trigger_stage_id: string | null }[] }>(
      "GET",
      `/api/v1/masters/payment-plans/${w.plans.FLEXI}`,
      { token: admin },
    );
    expect(same.body.version).toBe(plan.body.version);
    expect(same.body.installments.map((i) => i.trigger_stage_id)).not.toContain(w.alienStageId);
    // an edit that still fits every assigned tower goes through
    const fits = installments.map((i) =>
      i.seq === 3 ? { ...i, name: "Top Slab", trigger_stage_id: w.stages.TOP_SLAB } : i,
    );
    const ok = await t.request<ErrorBody>("PATCH", `/api/v1/masters/payment-plans/${w.plans.FLEXI}`, {
      token: admin,
      body: { version: plan.body.version, installments: fits },
    });
    expect(ok.status, ok.text).toBe(200);
  });

  let towerD: { id: string; flats: Map<string, Flat> };
  let d1: Booking;
  it("integrity reports PLAN_STAGE_MISSING (not auto-repairable) for a booking whose plan needs a stage its tower no longer has", async () => {
    towerD = await newTower(w.ggv.id, "Tower D", "D", 1);
    d1 = await mustBook(
      sales,
      bookingBody(towerD.flats.get("D-101")!.id, w.customers[3]!, {
        booking_date: addDays(today, -5),
        plan_accepted_on: addDays(today, -5),
      }),
    );
    expect((await integrity(d1.id)).ok).toBe(true);
    // drift the API now refuses: the tower loses its Flooring stage record
    await t.app.sql`delete from block_stages where block_id = ${towerD.id} and stage_id = ${w.stages.FLOORING}`;
    const report = await integrity(d1.id);
    const f = report.findings.find((x) => x.type === "PLAN_STAGE_MISSING");
    expect(f).toMatchObject({ booking_id: d1.id, installment_seq: 9, repairable: false });
    expect(report.counts["PLAN_STAGE_MISSING"]).toBe(1);
  });

  it("handover is blocked while an installment is unraised and the agreed value is not fully received, even when raised − paid ≤ 0", async () => {
    for (const s of [
      w.stages.EXCAVATION,
      w.stages.FOUNDATION,
      w.stages.PLINTH,
      w.stages.FIRST_SLAB,
      w.stages.TOP_SLAB,
      w.stages.BRICKWORK,
      w.stages.PLASTERING,
      w.stages.POSSESSION,
    ])
      await completeStage(t, towerD.id, s, addDays(today, -1));
    const run = await t.request<{ demands_raised: number }>("POST", "/api/v1/dues/run", {
      token: admin,
      body: { booking_id: d1.id },
    });
    expect(run.status, run.text).toBe(200);
    const b = await getBooking(d1.id);
    expect(b.summary.cash.order_raised_paise).toBe(54 * L); // 90 % raised: Flooring (10 %) can never be raised
    await pay(payBody(d1.id, "CASH", b.summary.cash.order_raised_paise));
    await pay(payBody(d1.id, "ACCOUNT", b.summary.account.order_raised_paise, today, "UPI"));
    const paid = await getBooking(d1.id);
    expect(paid.summary.total_due_paise).toBe(0); // the old raised − paid rule would have handed this over
    const r = await t.request<ErrorBody>("POST", `/api/v1/bookings/${d1.id}/complete`, {
      token: admin,
      body: { version: paid.version },
    });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("HANDOVER_BLOCKED");
    expect(r.body.error.details).toMatchObject({
      unraised_installments: [{ seq: 9, name: "Flooring" }],
      cash_short_paise: 6 * L,
      account_short_paise: 4 * L,
    });
    expect((await getFlat(towerD.flats.get("D-101")!.id)).status).toBe("BOOKED");
  });
});

// ---------------------------------------------------------------------------
describe("4. one lock order + transaction retry: stage completion, dues runs, payments and bookings in parallel", () => {
  it("never answers 5xx and leaves every ledger consistent", async () => {
    const flats = ["A-201", "A-202", "A-203"].map((n) => w.sgh.flats.get(n)!.id);
    const bks: Booking[] = [];
    for (const [i, f] of flats.entries())
      bks.push(
        await mustBook(
          sales,
          bookingBody(f, w.customers[4 + (i % 4)]!, {
            booking_date: addDays(today, -10),
            plan_accepted_on: addDays(today, -10),
          }),
        ),
      );
    const newFlats = ["A-204", "A-301", "A-302"];
    const stages = [w.stages.EXCAVATION, w.stages.FOUNDATION, w.stages.PLINTH];
    for (const [round, stageId] of stages.entries()) {
      const results = await Promise.all([
        stageStatus(w.sgh.towerId, stageId, today),
        t.request("POST", "/api/v1/dues/run", { token: admin, body: {} }),
        ...bks.map((b, i) =>
          t.request("POST", "/api/v1/payments", {
            token: accounts,
            body: payBody(b.id, i % 2 ? "ACCOUNT" : "CASH", L, today, i % 2 ? "UPI" : "CASH"),
            headers: { "idempotency-key": key() },
          }),
        ),
        book(sales, bookingBody(w.sgh.flats.get(newFlats[round]!)!.id, w.customers[round]!)),
        t.request("POST", "/api/v1/dues/run", { token: admin, body: { block_id: w.sgh.towerId } }),
      ]);
      for (const r of results) expect(r.status, r.text).toBeLessThan(500);
      expect(results[0]!.status, results[0]!.text).toBe(200);
      for (const r of results.slice(2, 5)) expect(r.status, r.text).toBe(201);
      expect(results[5]!.status, results[5]!.text).toBe(201);
    }
    const report = await t.request<Integrity>("GET", `/api/v1/dues/integrity?project_id=${w.sgh.id}`, { token: admin });
    expect(
      report.body.findings.filter((f) => f.type !== "PLAN_STAGE_MISSING"),
      JSON.stringify(report.body.findings),
    ).toEqual([]);
    // demand numbers stay unique and every stage was raised exactly once per booking
    const dup = await t.app
      .sql`select booking_id, installment_seq, count(*) from demands where status <> 'VOID' group by 1, 2 having count(*) > 1`;
    expect(dup.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("5. payment idempotency survives a lost replay record", () => {
  it("a retry whose plugin record vanished returns the original payment (same receipt, Idempotent-Replayed) and creates nothing; a different body is 422", async () => {
    const b = await mustBook(sales, bookingBody(w.sgh.flats.get("A-303")!.id, w.customers[5]!));
    const idem = key();
    const body = payBody(b.id, "CASH", 3 * L);
    const first = await pay(body, idem);
    const ledgerBefore = (await ledgerOf(b.id)).length;
    const forget = async () => {
      await t.app.sql`delete from idempotency_keys where key = ${idem}`;
      const keys = await t.app.redis.keys(`idem:*${idem}*`);
      if (keys.length) await t.app.redis.del(...keys);
    };
    await forget();
    const retry = await t.request<PostResponse>("POST", "/api/v1/payments", {
      token: accounts,
      body,
      headers: { "idempotency-key": idem },
    });
    expect(retry.status, retry.text).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.body.payment).toMatchObject({ id: first.payment.id, receipt_number: first.payment.receipt_number });
    expect(retry.body.ledger_seq).toBe(first.ledger_seq);
    const [{ n }] = (await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from payments where idempotency_key = ${idem}`) as unknown as [{ n: number }];
    expect(n).toBe(1);
    expect((await ledgerOf(b.id)).length).toBe(ledgerBefore);
    await forget();
    const other = await t.request<ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      body: { ...body, amount_paise: 4 * L },
      headers: { "idempotency-key": idem },
    });
    expect(other.status, other.text).toBe(422);
    expect(other.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
describe("6. holds: reserve / release / lapsed holds / HOLD_EXPIRY", () => {
  it("reserve holds for the caller (repeat extends); another user gets 409 and cannot release; a lapsed hold is bookable by anybody", async () => {
    const flat = w.sgh.flats.get("A-304")!;
    const r1 = await t.request<Flat>("POST", `/api/v1/flats/${flat.id}/reserve`, {
      token: sales,
      body: { minutes: 10 },
    });
    expect(r1.status, r1.text).toBe(200);
    expect(r1.body).toMatchObject({ status: "HOLD", hold_by_user_id: salesId });
    const until1 = Date.parse(r1.body.hold_until!);
    expect(until1 - Date.now()).toBeGreaterThan(8 * 60_000);
    const r2 = await t.request<Flat>("POST", `/api/v1/flats/${flat.id}/reserve`, {
      token: sales,
      body: { minutes: 20 },
    });
    expect(r2.status, r2.text).toBe(200);
    expect(Date.parse(r2.body.hold_until!)).toBeGreaterThan(until1);
    expect(
      (await t.request("POST", `/api/v1/flats/${flat.id}/reserve`, { token: sales, body: { minutes: 31 } })).status,
    ).toBe(400);
    const other = await t.request<ErrorBody>("POST", `/api/v1/flats/${flat.id}/reserve`, {
      token: sales2,
      body: { minutes: 5 },
    });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe("FLAT_NOT_AVAILABLE");
    expect((await t.request("POST", `/api/v1/flats/${flat.id}/release`, { token: sales2, body: {} })).status).toBe(403);
    expect((await book(sales2, bookingBody(flat.id, w.customers[6]!))).status).toBe(409);
    // the hold lapses → AVAILABLE for everybody even before the job runs
    const cellOf = async () => {
      const grid = await t.request<{
        floors: { cells: { flat_id: string; status: string; hold_until: string | null }[] }[];
      }>("GET", `/api/v1/blocks/${w.sgh.towerId}/grid`, { token: sales2 });
      return grid.body.floors.flatMap((f) => f.cells).find((c) => c.flat_id === flat.id)!;
    };
    expect((await cellOf()).status).toBe("HOLD");
    await t.app.sql`update flats set hold_until = now() - interval '1 minute' where id = ${flat.id}`;
    expect(await cellOf()).toMatchObject({ status: "AVAILABLE", hold_until: null }); // the wizard's picker offers it again
    const b = await mustBook(sales2, bookingBody(flat.id, w.customers[6]!));
    expect(b.status).toBe("ACTIVE");
    expect((await getFlat(flat.id)).status).toBe("BOOKED");
  });

  it("the holder or settings.manage releases; HOLD_EXPIRY releases lapsed holds with an audit row, unit counts and a bell for the holder", async () => {
    const flat = w.sgh.flatsU.get("U-201")!;
    expect(
      (await t.request("POST", `/api/v1/flats/${flat.id}/reserve`, { token: sales, body: { minutes: 5 } })).status,
    ).toBe(200);
    const rel = await t.request<Flat>("POST", `/api/v1/flats/${flat.id}/release`, {
      token: admin,
      body: { reason: "Customer walked away" },
    });
    expect(rel.status, rel.text).toBe(200);
    expect(rel.body).toMatchObject({ status: "AVAILABLE", hold_by_user_id: null, hold_until: null });
    expect(
      (await t.request("POST", `/api/v1/flats/${flat.id}/reserve`, { token: sales, body: { minutes: 5 } })).status,
    ).toBe(200);
    expect((await t.request("POST", `/api/v1/flats/${flat.id}/release`, { token: sales, body: {} })).status).toBe(200);
    expect(
      (await t.request("POST", `/api/v1/flats/${flat.id}/reserve`, { token: sales, body: { minutes: 5 } })).status,
    ).toBe(200);
    await t.app.sql`update flats set hold_until = now() - interval '2 minutes' where id = ${flat.id}`;
    const job = await runJob(t.app.db, "HOLD_EXPIRY");
    expect(job.status, job.error).toBe("OK");
    expect(job.result?.["flat_numbers"]).toContain("U-201");
    expect((await getFlat(flat.id)).status).toBe("AVAILABLE");
    const audits = await t.app
      .sql`select 1 from audit_logs where action = 'flat.hold_expired' and entity_id = ${flat.id}`;
    expect(audits.length).toBe(1);
    const bells = await t.app
      .sql`select 1 from notifications where type = 'HOLD_EXPIRED' and entity_id = ${flat.id} and recipient_id = ${salesId}`;
    expect(bells.length).toBe(1);
    const block = await t.request<{ unit_counts: { hold: number } }>("GET", `/api/v1/blocks/${w.sgh.towerUId}`, {
      token: admin,
    });
    expect(block.body.unit_counts.hold).toBe(0);
    // running again finds nothing
    expect((await runJob(t.app.db, "HOLD_EXPIRY")).result?.["released"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("7. other-charge demand bells are keyed by the charge line; possession undo withdraws them", () => {
  it("keys the bell by booking_other_charge + line id and withdraws exactly it on undo", async () => {
    const b = await mustBook(
      sales,
      bookingBody(w.ggv.flats.get("G-102")!.id, w.customers[7]!, {
        other_charges: [
          { charge_type_id: w.charges.REGISTRY, amount_paise: 25 * L, gst_percent: 0, demand_at: "ON_POSSESSION" },
        ],
      }),
    );
    const lineId = (await getBooking(b.id)).other_charges[0]!.id;
    const jump = await stageStatus(w.ggv.towerId, w.stages.POSSESSION, today);
    expect(jump.status, jump.text).toBe(200);
    const bells = await t.app.sql<
      { recipient_type: string; is_read: boolean }[]
    >`select recipient_type, is_read from notifications where entity_type = 'booking_other_charge' and entity_id = ${lineId}`;
    expect(bells.length).toBeGreaterThan(0);
    expect(
      (
        await t.app
          .sql`select 1 from notifications where entity_type = 'booking' and entity_id = ${b.id} and title like 'Registry%'`
      ).length,
    ).toBe(0);
    const version = await blockVersion(w.ggv.towerId);
    const undo = await t.request<{ undemanded_charge_numbers: string[] } & ErrorBody>(
      "POST",
      `/api/v1/blocks/${w.ggv.towerId}/construction/undo`,
      {
        token: admin,
        body: { version, stage_id: w.stages.POSSESSION, reason: "Possession entered by mistake" },
        headers: { "idempotency-key": key() },
      },
    );
    expect(undo.status, undo.text).toBe(200);
    expect(undo.body.undemanded_charge_numbers.length).toBe(1);
    expect(
      (
        await t.app
          .sql`select 1 from notifications where entity_type = 'booking_other_charge' and entity_id = ${lineId} and is_withdrawn = false`
      ).length,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("8. reversal on a COMPLETED booking", () => {
  it("409 BOOKING_COMPLETED without settings.manage; with it the booking reopens (ACTIVE, flat BOOKED, audit booking.reopened)", async () => {
    const date = addDays(today, -40);
    const b = await mustBook(
      sales,
      bookingBody(w.sgh.flatsU.get("U-101")!.id, w.customers[0]!, {
        booking_date: date,
        plan_accepted_on: date,
        payment_plan_id: w.plans.DP,
      }),
    );
    for (const s of Object.values(w.stages)) await completeStage(t, w.sgh.towerUId, s, addDays(today, -1));
    expect((await t.request("POST", "/api/v1/dues/run", { token: admin, body: { booking_id: b.id } })).status).toBe(
      200,
    );
    const cash = await pay(payBody(b.id, "CASH", 60 * L));
    await pay(payBody(b.id, "ACCOUNT", 40 * L, today, "UPI"));
    const done = await t.request<Booking & ErrorBody>("POST", `/api/v1/bookings/${b.id}/complete`, {
      token: admin,
      body: { version: (await getBooking(b.id)).version },
    });
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    expect((await getFlat(b.flat_id)).status).toBe("SOLD");

    const denied = await t.request<ErrorBody>("POST", `/api/v1/payments/${cash.payment.id}/reverse`, {
      token: accounts,
      body: { version: cash.payment.version, reason: "Cheque bounced after handover" },
    });
    expect(denied.status, denied.text).toBe(409);
    expect(denied.body.error.code).toBe("BOOKING_COMPLETED");
    const reversed = await t.request<ErrorBody>("POST", `/api/v1/payments/${cash.payment.id}/reverse`, {
      token: admin,
      body: { version: cash.payment.version, reason: "Cash deposit returned by bank" },
    });
    expect(reversed.status, reversed.text).toBe(200);
    const after = await getBooking(b.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.summary.total_due_paise).toBe(60 * L);
    expect((await getFlat(b.flat_id)).status).toBe("BOOKED");
    const [audit] = await t.app.sql<
      { after: { status: string; reason: string } }[]
    >`select after from audit_logs where action = 'booking.reopened' and entity_id = ${b.id}`;
    expect(audit?.after).toMatchObject({
      status: "ACTIVE",
      reason: expect.stringContaining("Cash deposit returned by bank"),
    });
    expect((await integrity(b.id)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("9. booking drafts are idempotent", () => {
  it("PUT with a client id upserts by (id, user): retries never duplicate; another user's id is 404", async () => {
    const id = "6f1c2c1e-6f5e-4c8e-9a51-2a9f7c0e1d11";
    const body = { id, step: 2, payload: { flat_id: w.sgh.flats.get("A-104")!.id } };
    for (let i = 0; i < 3; i += 1) {
      const r = await t.request<{ id: string; step: number }>("PUT", "/api/v1/booking-drafts", {
        token: sales,
        body: { ...body, step: 2 + (i === 2 ? 1 : 0) },
      });
      expect(r.status, r.text).toBe(200);
      expect(r.body.id).toBe(id);
    }
    const rows = await t.app.sql<{ step: number }[]>`select step from booking_drafts where id = ${id}`;
    expect(rows).toEqual([{ step: 3 }]);
    const stolen = await t.request<ErrorBody>("PUT", "/api/v1/booking-drafts", { token: sales2, body });
    expect(stolen.status).toBe(404);
    expect(await t.app.sql<{ step: number }[]>`select step from booking_drafts where id = ${id}`).toEqual([
      { step: 3 },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("10. missed-run safety nets", () => {
  it("DUES_CATCHUP is registered and idempotent", async () => {
    const first = await runJob(t.app.db, "DUES_CATCHUP");
    expect(first.status, first.error).toBe("OK");
    expect(first.result?.["as_of"]).toBe(today);
    const again = await runJob(t.app.db, "DUES_CATCHUP");
    const raised = Object.values(again.result ?? {})
      .filter((v): v is { demands_raised: number } => typeof v === "object" && v !== null)
      .reduce((s, v) => s + v.demands_raised, 0);
    expect(raised).toBe(0);
  });

  it("the once-per-day overdue claim is made only after the notification commits: a DB failure leaves no claim, the next run sends it", async () => {
    const date = addDays(today, -40);
    await mustBook(
      sales,
      bookingBody(w.sgh.flats.get("A-104")!.id, w.customers[1]!, {
        booking_date: date,
        plan_accepted_on: date,
        payment_plan_id: w.plans.DP,
      }),
    );
    await t.app.redis.del(...(await t.app.redis.keys("overdue:*")).concat(["overdue:none"]));
    await t.app.sql.unsafe(
      `create or replace function test_fail_overdue() returns trigger language plpgsql as $$ begin if new.type = 'DEMAND_OVERDUE' then raise exception 'simulated outage'; end if; return new; end $$`,
    );
    await t.app.sql.unsafe(
      "create trigger test_fail_overdue before insert on notifications for each row execute function test_fail_overdue()",
    );
    try {
      await expect(overdueNotifications(t.app.db, t.app)).rejects.toThrow();
      expect(await t.app.redis.keys("overdue:*")).toEqual([]);
    } finally {
      await t.app.sql.unsafe("drop trigger if exists test_fail_overdue on notifications");
    }
    const sent = await overdueNotifications(t.app.db, t.app);
    expect(sent["notified"]).toBeGreaterThan(0);
    expect((await t.app.redis.keys("overdue:*")).length).toBe(sent["notified"]);
    const again = await overdueNotifications(t.app.db, t.app);
    expect(again["notified"]).toBe(0);
    // Redis lost its markers: the database guard still keeps it to once per demand per day
    await t.app.redis.del(...(await t.app.redis.keys("overdue:*")));
    expect((await overdueNotifications(t.app.db, t.app))["notified"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("11. bookings list payload", () => {
  it("a 25-row page stays under 25 KB (heavy snapshots only on the detail)", async () => {
    const tower = await newTower(w.sgh.id, "Tower L", "L", 7);
    const flats = [...tower.flats.values()].slice(0, 25);
    const customers = w.customers;
    for (const [i, f] of flats.entries()) await mustBook(sales, bookingBody(f.id, customers[i % customers.length]!));
    const page = await t.request<
      List<Booking & { flat_snapshot: Record<string, unknown>; plan_snapshot: Record<string, unknown> }>
    >("GET", `/api/v1/bookings?block_id=${tower.id}&page_size=25`, { token: admin });
    expect(page.status, page.text).toBe(200);
    expect(page.body.items).toHaveLength(25);
    const liteBytes = Buffer.byteLength(page.text);
    // the same 25 rows as every row was before (full snapshots, schedule-derived next installment, every field): view=full
    const full = await t.request<List<Record<string, unknown>>>(
      "GET",
      `/api/v1/bookings?block_id=${tower.id}&page_size=25&view=full`,
      { token: admin },
    );
    expect(full.status, full.text).toBe(200);
    const fullBytes = Buffer.byteLength(full.text);
    // and on the wire (the API compresses responses ≥ 1 KB)
    const gz = await t.request("GET", `/api/v1/bookings?block_id=${tower.id}&page_size=25`, {
      token: admin,
      headers: { "accept-encoding": "gzip" },
    });
    const wireBytes = Number(gz.headers["content-length"] ?? Buffer.byteLength(gz.text));
    console.info(
      `GET /bookings 25 rows: compact ${liteBytes} bytes JSON (${wireBytes} gzip) · view=full ${fullBytes} bytes`,
    );
    expect(liteBytes).toBeLessThan(25_000);
    expect(liteBytes).toBeLessThan(fullBytes);
    const row = page.body.items[0]!;
    expect(row.plan_snapshot).toEqual({ name: "Villa CLP" });
    expect(row.flat_snapshot).toBeUndefined();
    expect(row.summary).toMatchObject({
      total_due_paise: 10 * L,
      total_paid_paise: 0,
      pending_cheques_paise: 0,
      cash: { agreed_paise: 60 * L, order_raised_paise: 6 * L, pending_paise: 0 },
    });
    expect(row).toMatchObject({
      booking_number: expect.any(String),
      customer_name: expect.any(String),
      customer_phone: expect.any(String),
      project_name: "Shree Ganesh Heights",
      block_name: "Tower L",
      co_applicants: [],
      project_id: w.sgh.id,
      flat_id: expect.any(String),
      customer_id: expect.any(String),
    });
    expect(full.body.items[0]).toMatchObject({
      flat_snapshot: { rooms: expect.any(Array) },
      plan_snapshot: { installments: expect.any(Array) },
      summary: { next_installment: expect.anything() },
    });
    // the detail still carries everything
    const detail = await t.request<{ plan_snapshot: { installments: unknown[] }; flat_snapshot: { rooms: unknown[] } }>(
      "GET",
      `/api/v1/bookings/${row.id}`,
      { token: admin },
    );
    expect(detail.body.plan_snapshot.installments.length).toBe(10);
    expect(detail.body.flat_snapshot.rooms.length).toBeGreaterThan(0);
  });
});
