import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { createMoneyWorld, LIST_PRICE_PAISE, type MoneyWorld } from "./fixtures/money.js";
import { post, towerCBody } from "./fixtures/inventory.js";
import { createWebProject, publishWebProject } from "./fixtures/web.js";
import { buildTestApp, type ErrorBody, type TestContext, type TestResponse } from "./helpers.js";

/**
 * Adversarial review of the money & business-rule hardening track (money-hardening.test.ts covers the happy paths): bypasses, races and
 * neighbouring regressions that the first pass did not test.
 *  - integrity repair re-reads the demands it voids under the booking lock (a payment applied after the report is never voided away)
 *  - a stage-sequence change may not strand an ACTIVE booking's own plan snapshot (even with no assignment left to protect it)
 *  - stage undo and a cleared post-dated cheque keep posting order (seq + running balances) through a rebuild
 *  - inventory bulk status / price take flat rows before the block row (the booking engine's order): no deadlock 5xx under load
 *  - the public availability grid / unit counts treat a lapsed HOLD as AVAILABLE
 *  - the agreement guard ignores a reason at list price and rejects a blank reason; reserve respects project scope
 */

const L = 10_000_000;
const CR = 100 * L;

type Booking = {
  id: string;
  version: number;
  status: string;
  booking_number: string;
  flat_id: string;
  price_deviation_reason?: string | null;
  price_deviation_by?: string | null;
  list_price_paise?: number | null;
};
type Flat = { id: string; version: number; status: string; flat_number: string };
type List<T> = { items: T[]; total: number };
type LedgerRow = {
  seq: number;
  event: string;
  ref_id: string | null;
  amount_paise: number;
  cash_paid_cum_paise: number;
  account_paid_cum_paise: number;
  cash_order_raised_paise: number;
  account_order_raised_paise: number;
  cash_due_paise: number;
  account_due_paise: number;
  total_due_paise: number;
};
type Integrity = { ok: boolean; findings: { type: string; booking_id: string; detail: string }[] };

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let w: MoneyWorld;
let today: string;
let n = 0;
const key = () => `mr-${Date.now()}-${++n}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
async function stageStatus(blockId: string, stageId: string, completedOn: string): Promise<void> {
  const r = await t.request("POST", `/api/v1/blocks/${blockId}/construction/status`, {
    token: admin,
    body: {
      version: await blockVersion(blockId),
      stage_id: stageId,
      completed_on: completedOn,
      intermediate_dates: {},
      notify_buyers: false,
    },
    headers: { "idempotency-key": key() },
  });
  expect(r.status, r.text).toBe(200);
}
async function newTower(
  projectId: string,
  name: string,
  code: string,
  floors: number,
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
    }),
  );
  await t.app
    .sql`update flats set price_paise = ${LIST_PRICE_PAISE}, rate_card_id = null, price_breakup = ${JSON.stringify([{ label: "Base price", amount_paise: LIST_PRICE_PAISE }])}::jsonb where block_id = ${block.id}`;
  const r = await t.request<List<Flat>>("GET", `/api/v1/flats?block_id=${block.id}&page_size=200&sort=flat_number`, {
    token: admin,
  });
  return { id: block.id, flats: new Map(r.body.items.map((f) => [f.flat_number, f])) };
}
const ledgerKey = (r: LedgerRow) => [
  r.seq,
  r.event,
  r.ref_id,
  r.amount_paise,
  r.cash_paid_cum_paise,
  r.account_paid_cum_paise,
  r.cash_order_raised_paise,
  r.account_order_raised_paise,
  r.cash_due_paise,
  r.account_due_paise,
  r.total_due_paise,
];

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  w = await createMoneyWorld(t, admin);
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
describe("agreement value guard: neighbouring inputs", () => {
  it("a reason sent at list price records no deviation; a blank reason never unlocks a deviation", async () => {
    const atList = await mustBook(
      sales,
      bookingBody(w.sgh.flats.get("A-101")!.id, w.customers[0]!, { price_deviation_reason: "Not a deviation at all" }),
    );
    expect(await getBooking(atList.id)).toMatchObject({
      list_price_paise: CR,
      price_deviation_reason: null,
      price_deviation_by: null,
    });
    const [{ c }] = (await t.app.sql<
      { c: number }[]
    >`select count(*)::int as c from audit_logs where action = 'booking.price_deviation' and entity_id = ${atList.id}`) as unknown as [
      { c: number },
    ];
    expect(c).toBe(0);
    const blank = await book(
      admin,
      bookingBody(w.sgh.flats.get("A-102")!.id, w.customers[1]!, {
        agreement_value_paise: CR - L,
        cash_agreed_paise: 59 * L,
        price_deviation_reason: "   ",
      }),
    );
    expect([400, 422]).toContain(blank.status);
    expect(
      (await t.request<Flat>("GET", `/api/v1/flats/${w.sgh.flats.get("A-102")!.id}`, { token: admin })).body.status,
    ).toBe("AVAILABLE");
  });
});

// ---------------------------------------------------------------------------
describe("canonical order survives a stage undo and a cleared post-dated cheque", () => {
  it("rows before the voided demand keep seq, ids and every running balance; integrity stays clean", async () => {
    const tower = await newTower(w.ggv.id, "Tower R", "R", 1);
    const b = await mustBook(
      sales,
      bookingBody(tower.flats.get("R-101")!.id, w.customers[2]!, {
        booking_date: addDays(today, -30),
        plan_accepted_on: addDays(today, -30),
      }),
    );
    // a cheque dated 25 days ago is received (PENDING) before the Excavation demand exists
    const cheque = await t.request<{ payment: { id: string; version: number } }>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: {
        booking_id: b.id,
        against: "FLAT_VALUE",
        bucket: "ACCOUNT",
        amount_paise: 2 * L,
        payment_date: addDays(today, -25),
        payment_mode_id: w.modes.CHEQUE,
        bank_account_id: w.bankAccountId,
        instrument: { number: "CHQ-0091", date: addDays(today, -25), bank_name: "SBI" },
      },
    });
    expect(cheque.status, cheque.text).toBe(201);
    await stageStatus(tower.id, w.stages.EXCAVATION, addDays(today, -2));
    // a cash receipt dated 20 days ago is posted after that demand; then the cheque clears
    const cash = await t.request("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: {
        booking_id: b.id,
        against: "FLAT_VALUE",
        bucket: "CASH",
        amount_paise: 3 * L,
        payment_date: addDays(today, -20),
        payment_mode_id: w.modes.CASH,
      },
    });
    expect(cash.status, cash.text).toBe(201);
    const clear = await t.request("POST", `/api/v1/payments/${cheque.body.payment.id}/clear`, {
      token: accounts,
      body: { version: cheque.body.payment.version },
    });
    expect(clear.status, clear.text).toBe(200);
    const live = await ledgerOf(b.id);
    expect(live.map((r) => r.event)).toEqual(["DEMAND", "DEMAND", "PAYMENT", "PAYMENT"]);
    // Foundation raises a 5th row; undoing it voids that demand and rebuilds the whole ledger
    await stageStatus(tower.id, w.stages.FOUNDATION, addDays(today, -1));
    expect((await ledgerOf(b.id)).length).toBe(5);
    const undo = await t.request("POST", `/api/v1/blocks/${tower.id}/construction/undo`, {
      token: admin,
      body: {
        version: await blockVersion(tower.id),
        stage_id: w.stages.FOUNDATION,
        reason: "Entered on the wrong tower",
      },
      headers: { "idempotency-key": key() },
    });
    expect(undo.status, undo.text).toBe(200);
    const rebuilt = await ledgerOf(b.id);
    expect(rebuilt.map(ledgerKey)).toEqual(live.map(ledgerKey));
    expect((await integrity(b.id)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("plan ↔ tower fit: the bookings' own plan snapshots", () => {
  it("a stage-sequence change that strands an ACTIVE booking's installment is refused even when no assignment covers the tower any more", async () => {
    const tower = await newTower(w.ggv.id, "Tower S", "S", 1);
    const b = await mustBook(sales, bookingBody(tower.flats.get("S-101")!.id, w.customers[3]!));
    // the plan is no longer assigned to the project (so no assignment check protects the tower)
    const assignments = await t.request<List<{ id: string; version: number; plan_id: string }>>(
      "GET",
      `/api/v1/payment-plan-assignments?project_id=${w.ggv.id}`,
      { token: admin },
    );
    for (const a of assignments.body.items) {
      const del = await t.request("DELETE", `/api/v1/payment-plan-assignments/${a.id}`, { token: admin });
      expect(del.status, del.text).toBe(204);
    }
    const block = await t.request<{ version: number; stage_sequence: string[] }>("GET", `/api/v1/blocks/${tower.id}`, {
      token: admin,
    });
    const without = block.body.stage_sequence.filter((id) => id !== w.stages.BRICKWORK);
    const r = await t.request<ErrorBody>("POST", `/api/v1/blocks/${tower.id}/stage-sequence`, {
      token: admin,
      body: { version: block.body.version, stage_sequence: without },
    });
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("PLAN_STAGES_MISSING");
    expect(r.body.error.details?.["stranded_bookings"]).toEqual([
      {
        booking_id: b.id,
        booking_number: b.booking_number,
        installment_seq: 7,
        installment_name: "Brickwork",
        stage_id: w.stages.BRICKWORK,
        stage_name: expect.any(String),
      },
    ]);
    expect(
      (await t.request<{ stage_sequence: string[] }>("GET", `/api/v1/blocks/${tower.id}`, { token: admin })).body
        .stage_sequence,
    ).toEqual(block.body.stage_sequence);
    // a change that keeps every booked stage (an extra stage appended) still goes through
    const ok = await t.request("POST", `/api/v1/blocks/${tower.id}/stage-sequence`, {
      token: admin,
      body: { version: block.body.version, stage_sequence: [...block.body.stage_sequence, w.alienStageId] },
    });
    expect(ok.status, ok.text).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("integrity repair never voids a demand paid after the report", () => {
  it("re-reads the voidable demands under the booking lock", async () => {
    const tower = await newTower(w.sgh.id, "Tower V", "V", 1);
    const b = await mustBook(
      sales,
      bookingBody(tower.flats.get("V-101")!.id, w.customers[4]!, {
        booking_date: addDays(today, -10),
        plan_accepted_on: addDays(today, -10),
      }),
    );
    await stageStatus(tower.id, w.stages.EXCAVATION, addDays(today, -1));
    const [demand] = await t.app.sql<
      { id: string; demand_number: string }[]
    >`select id, demand_number from demands where booking_id = ${b.id} and installment_seq = 2 and status <> 'VOID'`;
    expect(demand).toBeTruthy();
    // drift: the stage reads PENDING again, so the report calls the Excavation demand unsatisfied (voidable, nothing paid yet)
    await t.app
      .sql`update block_stages set status = 'PENDING', completed_on = null, completed_at = null where block_id = ${tower.id} and stage_id = ${w.stages.EXCAVATION}`;
    expect((await integrity(b.id)).findings.map((f) => f.type)).toContain("UNSATISFIED_DEMAND");
    // while repair runs, another unit of work (a payment) holds the booking and applies money to that demand before committing
    let repair!: Promise<TestResponse<{ demands_voided: number; skipped_with_payments: string[] } & ErrorBody>>;
    await t.app.sql.begin(async (tx) => {
      await tx`select id from bookings where id = ${b.id} for update`;
      repair = t.request("POST", "/api/v1/dues/integrity/repair", {
        token: admin,
        body: { confirm: "REPAIR", booking_ids: [b.id] },
        headers: { "idempotency-key": key() },
      });
      await sleep(1500);
      await tx`update demands set paid_paise = 1, status = 'PARTIALLY_PAID' where id = ${demand!.id}`;
    });
    const r = await repair;
    expect(r.status, r.text).toBe(200);
    expect(r.body.skipped_with_payments).toContain(demand!.demand_number);
    expect(r.body.demands_voided).toBe(0);
    const [after] = await t.app.sql<{ status: string }[]>`select status from demands where id = ${demand!.id}`;
    expect(after!.status).not.toBe("VOID");
  });
});

// ---------------------------------------------------------------------------
describe("inventory bulk operations and the booking engine share one lock order", () => {
  it("bulk status / bulk price racing bookings in the same tower never answer 5xx and never stall on a deadlock", async () => {
    const tower = await newTower(w.sgh.id, "Tower K", "K", 6);
    const all = [...tower.flats.values()].sort((a, b) => a.flat_number.localeCompare(b.flat_number));
    let custIdx = 0;
    const started = Date.now();
    for (let round = 0; round < 6; round += 1) {
      const slice = all.slice(round * 4, round * 4 + 4);
      if (slice.length < 4) break;
      const results = await Promise.all([
        ...slice.slice(0, 3).map((f) => book(sales, bookingBody(f.id, w.customers[custIdx++ % w.customers.length]!))),
        t.request("POST", `/api/v1/blocks/${tower.id}/bulk-status`, {
          token: admin,
          body: { flat_ids: slice.map((f) => f.id), status: "BLOCKED", reason: "Owner's quota" },
        }),
        t.request("POST", `/api/v1/blocks/${tower.id}/bulk-price`, {
          token: admin,
          body: { block_id: tower.id, flat_ids: slice.map((f) => f.id), price_paise: LIST_PRICE_PAISE },
        }),
      ]);
      for (const r of results) expect(r.status, r.text).toBeLessThan(500);
    }
    // With the block taken before the flats (the old order) every round deadlocked against a booking holding its flat: Postgres only
    // breaks a deadlock after deadlock_timeout (1 s), so the six rounds took ≈ 12 s (the booking side was retried, so no 5xx showed).
    // In one lock order there is nothing to break: ≈ 0.5 s.
    expect(Date.now() - started).toBeLessThan(6000);
    // unit counts still match the flats
    const [counts] = await t.app.sql<
      { ok: boolean }[]
    >`select (b.unit_counts->>'booked')::int = (select count(*) from flats f where f.block_id = b.id and f.status = 'BOOKED') as ok from blocks b where b.id = ${tower.id}`;
    expect(counts!.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("lapsed holds on the public website", () => {
  it("the availability grid and unit counts show a HOLD past hold_until as AVAILABLE; a live hold stays unavailable", async () => {
    const wp = await createWebProject(t, admin, { name: "Review Heights", code: "RVH", suffix: "RV" });
    await publishWebProject(t, admin, wp);
    // A-102 is a HOLD whose window has passed; A-101 / A-201 are AVAILABLE, the rest are booked / sold / blocked
    await t.app.sql`update flats set hold_until = now() - interval '5 minutes' where id = ${wp.flats["A-102"]!}`;
    const r = await t.request<{
      availability: {
        blocks: {
          available_count: number;
          floors: { cells: { flat_number: string; availability: string; price_paise: number | null }[] }[];
        }[];
      };
      blocks: { available_units: number | null }[];
    }>("GET", `/api/v1/public/projects/${wp.slug}`);
    expect(r.status, r.text).toBe(200);
    const cells = r.body.availability.blocks.flatMap((b) => b.floors.flatMap((f) => f.cells));
    expect(cells.find((c) => c.flat_number === "A-102")).toMatchObject({
      availability: "AVAILABLE",
      price_paise: 5_100_000_00,
    });
    expect(cells.find((c) => c.flat_number === "A-103")!.availability).not.toBe("AVAILABLE");
    expect(r.body.availability.blocks[0]!.available_count).toBe(3);
    expect(r.body.blocks[0]!.available_units).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe("reserve respects project scope", () => {
  it("a Sales user scoped to one project cannot reserve (or learn about) a flat of another project", async () => {
    const roles = await t.request<List<{ id: string; name: string }>>("GET", "/api/v1/roles?page_size=50", {
      token: admin,
    });
    const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
    const u = await t.request("POST", "/api/v1/users", {
      token: admin,
      body: {
        name: "Scoped Sales",
        email: "scoped.sales@sgb.in",
        role_id: salesRole.id,
        all_projects: false,
        project_ids: [w.ggv.id],
        password: "Scoped@12345",
        must_change_password: false,
      },
    });
    expect(u.status, u.text).toBe(201);
    const scoped = (await t.login("scoped.sales@sgb.in", "Scoped@12345")).access_token;
    const flat = w.sgh.flats.get("A-301")!;
    const r = await t.request<ErrorBody>("POST", `/api/v1/flats/${flat.id}/reserve`, {
      token: scoped,
      body: { minutes: 5 },
    });
    expect(r.status, r.text).toBe(404);
    expect((await t.request<Flat>("GET", `/api/v1/flats/${flat.id}`, { token: admin })).body.status).toBe("AVAILABLE");
  });
});
