import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { payments, type DB } from "@kkt/db";
import { addDays, formatNumber, todayIST } from "@kkt/domain";
import { JOB_SCHEDULES } from "../../src/jobs/index.js";
import { dailyDues, nightlyIntegrityJob, raiseDuesForAll, rebuild, repair } from "../../src/modules/money/index.js";
import { numberSql } from "../../src/modules/money/services/receipts.js";
import { resolveSearchRefs, searchWhere } from "../../src/modules/money/services/search.js";
import { completeStage, createMoneyWorld, LIST_PRICE_PAISE, resetStage, type MoneyWorld } from "./fixtures/money.js";
import { post, towerCBody } from "./fixtures/inventory.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Phase 7 money track (docs/hardening/phase7-money.md):
 *  1. DAILY_DUES isolates every booking (lock first, read after; a failing booking is recorded and the run goes on)
 *  2. integrity runs once a night; repair re-checks a flagged demand's trigger under the booking lock
 *  3. the booking ledger is a book of record (contract C7): epochs, DEMAND_VOIDED, ledger_rebuilds; database guards
 *  4. stage undo never rewrites a closed booking (CANCELLED skipped, COMPLETED → 409 BOOKING_CLOSED)
 *  5. the receipt number is allocated by the posting's last statement (gapless, same format)
 *  6. payment / demand search resolves bookings and customers first and filters by ids or own indexed columns
 *  7. cancellation refund / deduction are read from the money columns
 */

const L = 10_000_000;
const CR = 100 * L;

type Booking = {
  id: string;
  version: number;
  status: string;
  booking_number: string;
  cancellation: { refund_paise: number; deduction_paise: number } | null;
  summary: {
    total_due_paise: number;
    cash: { paid_paise: number; order_raised_paise: number; due_paise: number };
    account: { paid_paise: number; order_raised_paise: number; due_paise: number };
  };
};
type Flat = { id: string; version: number; status: string; flat_number: string };
type List<T> = { items: T[]; total: number };
type LedgerRow = {
  seq: number;
  event: string;
  ref_id: string | null;
  ref_number: string | null;
  label: string | null;
  note: string | null;
  amount_paise: number;
  cash_paid_cum_paise: number;
  account_paid_cum_paise: number;
  cash_order_raised_paise: number;
  account_order_raised_paise: number;
  cash_due_paise: number;
  account_due_paise: number;
  total_due_paise: number;
  other_charges_due_paise: number;
};
type Totals = {
  cash_due_paise: number;
  account_due_paise: number;
  total_due_paise: number;
  other_charges_due_paise: number;
  cash_paid_paise: number;
  account_paid_paise: number;
};
type LedgerPage = List<LedgerRow> & {
  epoch: number;
  current_epoch: number;
  summary: Totals & { total_due_paise: number };
  epoch_totals: Totals;
};
type Demand = {
  id: string;
  demand_number: string;
  installment_seq: number;
  status: string;
  paid_paise: number;
  cash_demand_paise: number;
  account_demand_paise: number;
};
type Payment = { id: string; receipt_number: string; version: number; status: string };
type Integrity = { ok: boolean; findings: { type: string; booking_id: string; demand_id: string | null }[] };

let t: TestContext;
let admin: string;
let accounts: string;
let w: MoneyWorld;
let today: string;
let n = 0;
const key = () => `p7m-${Date.now()}-${++n}`;
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
async function book(flatId: string, customerId: string, extra: Record<string, unknown> = {}): Promise<Booking> {
  const r = await t.request<Booking>("POST", "/api/v1/bookings", {
    token: admin,
    body: bookingBody(flatId, customerId, extra),
    headers: { "idempotency-key": key() },
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
}
async function getBooking(id: string): Promise<Booking> {
  const r = await t.request<Booking>("GET", `/api/v1/bookings/${id}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function ledgerPage(id: string, query = ""): Promise<LedgerPage> {
  const r = await t.request<LedgerPage>("GET", `/api/v1/bookings/${id}/ledger?page_size=200${query}`, {
    token: admin,
  });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function demandsOf(id: string): Promise<Demand[]> {
  const r = await t.request<List<Demand>>("GET", `/api/v1/bookings/${id}/demands?page_size=200&include_inactive=true`, {
    token: admin,
  });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}
async function pay(
  bookingId: string,
  bucket: "CASH" | "ACCOUNT",
  amount: number,
  extra: Record<string, unknown> = {},
): Promise<Payment> {
  const r = await t.request<{ payment: Payment }>("POST", "/api/v1/payments", {
    token: accounts,
    headers: { "idempotency-key": key() },
    body: {
      booking_id: bookingId,
      against: "FLAT_VALUE",
      bucket,
      amount_paise: amount,
      payment_date: today,
      payment_mode_id: w.modes.CASH,
      ...extra,
    },
  });
  expect(r.status, r.text).toBe(201);
  return r.body.payment;
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
async function stageStatus(blockId: string, stageId: string, completedOn: string = today): Promise<void> {
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
async function undo(blockId: string, stageId: string) {
  return t.request<ErrorBody & { voided_demand_numbers: string[] }>(
    "POST",
    `/api/v1/blocks/${blockId}/construction/undo`,
    {
      token: admin,
      body: { version: await blockVersion(blockId), stage_id: stageId, reason: "Recorded on the wrong tower" },
      headers: { "idempotency-key": key() },
    },
  );
}
let towerSeq = 0;
async function newTower(floors = 1): Promise<{ id: string; flats: Flat[] }> {
  towerSeq += 1;
  const code = `M${towerSeq}`;
  const block = await post<{ id: string }>(
    t,
    admin,
    "/api/v1/blocks",
    towerCBody(w.sgh.id, w.basics, {
      name: `Tower ${code}`,
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
  return { id: block.id, flats: r.body.items };
}
/** Expects a database error raised by the money guards (src/sql/0006_money_guards.sql). */
async function rejectsGuard(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, "the statement should have been refused").not.toBeNull();
  expect(String((caught as Error).message)).toMatch(pattern);
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  w = await createMoneyWorld(t, admin);
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
describe("1. DAILY_DUES: lock first, read after; one failing booking never stops the others", () => {
  it("a booking forced to fail is recorded (id + code) and every other booking still gets its demand", async () => {
    const tower = await newTower(1);
    const made: Booking[] = [];
    for (const [i, f] of tower.flats.slice(0, 3).entries())
      made.push(await book(f.id, w.customers[i]!, { payment_plan_id: w.plans.DP }));
    // the run goes in (booking date, id) order: poison the FIRST booking so the others all come after it
    const ordered = [...made].sort((a, b) => (a.id < b.id ? -1 : 1));
    const poison = ordered[0]!;
    // a 3-decimal percent in the plan snapshot makes the engine throw a MoneyError for this booking only
    await t.app
      .sql`update bookings set plan_snapshot = jsonb_set(plan_snapshot, '{installments,1,percent}', '85.555'::jsonb) where id = ${poison.id}`;
    try {
      await poisonedRun(tower.id, poison, ordered);
    } finally {
      await t.app
        .sql`update bookings set plan_snapshot = jsonb_set(plan_snapshot, '{installments,1,percent}', '85'::jsonb) where id = ${poison.id}`;
    }
  });

  async function poisonedRun(towerId: string, poison: Booking, ordered: Booking[]): Promise<void> {
    const r = await t.request<{
      demands_raised: number;
      bookings_processed: number;
      bookings_failed: number;
      failures: { booking_id: string; booking_number: string | null; code: string }[];
    }>("POST", "/api/v1/dues/run", { token: admin, body: { block_id: towerId, as_of: addDays(today, 31) } });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ bookings_processed: 3, bookings_failed: 1, demands_raised: 2 });
    expect(r.body.failures).toEqual([
      expect.objectContaining({ booking_id: poison.id, booking_number: poison.booking_number, code: "INVALID_AMOUNT" }),
    ]);
    for (const b of ordered.slice(1)) {
      const d = (await demandsOf(b.id)).find((x) => x.installment_seq === 2);
      expect(d, `booking ${b.booking_number} must get its 30-day demand`).toMatchObject({
        status: "OPEN",
        cash_demand_paise: 51 * L,
        account_demand_paise: 34 * L,
      });
    }
    expect((await demandsOf(poison.id)).filter((d) => d.installment_seq === 2)).toHaveLength(0);
    // the failure is counted for the alert
    const metrics = await t.app.inject({ method: "GET", url: "/api/v1/metrics" });
    if (metrics.statusCode === 200)
      expect(metrics.body).toMatch(/kkt_dues_booking_failures_total\{code="INVALID_AMOUNT"\} [1-9]/);
  }

  it("the nightly job completes, reports the failures per company and in total, and bells the Super Admins once per run", async () => {
    const tower = await newTower(1);
    const b = await book(tower.flats[0]!.id, w.customers[4]!, { payment_plan_id: w.plans.DP });
    await t.app
      .sql`update bookings set plan_snapshot = jsonb_set(plan_snapshot, '{installments,0,percent}', '10.005'::jsonb) where id = ${b.id}`;
    const bellsBefore = (
      await t.app.sql<{ n: number }[]>`select count(*)::int as n from notifications where type = 'JOB_FAILED'`
    )[0]!.n;
    let result: Record<string, unknown>;
    try {
      result = await dailyDues(t.app.db);
    } finally {
      await t.app
        .sql`update bookings set plan_snapshot = jsonb_set(plan_snapshot, '{installments,0,percent}', '10'::jsonb) where id = ${b.id}`;
    }
    expect(result["bookings_failed"]).toBeGreaterThanOrEqual(1);
    const mine = result[t.companyId] as { bookings_failed: number; failures: { booking_id: string; code: string }[] };
    expect(mine.failures).toContainEqual({
      booking_id: b.id,
      booking_number: b.booking_number,
      code: "INVALID_AMOUNT",
    });
    const bells = await t.app.sql<{ title: string; body: string; recipient_type: string }[]>`
      select title, body, recipient_type from notifications where type = 'JOB_FAILED' order by created_at desc`;
    const superAdmins = (
      await t.app.sql<{ n: number }[]>`
        select count(*)::int as n from users u join roles r on r.id = u.role_id
        where u.company_id = ${t.companyId} and u.is_active and r.name = 'Super Admin'`
    )[0]!.n;
    expect(bells.length - bellsBefore).toBe(superAdmins); // one bell per Super Admin, one run
    expect(bells[0]!.title).toContain("DAILY_DUES");
    expect(bells[0]!.body).toContain(b.booking_number);
  });

  it("a concurrent agreement revision is respected: the run waits for the booking lock and raises the demand on the new amounts", async () => {
    const tower = await newTower(1);
    const b = await book(tower.flats[0]!.id, w.customers[5]!, { payment_plan_id: w.plans.DP });
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    // a revision in flight: the booking row is updated (and locked) but not yet committed
    const revision = t.app.sql.begin(async (tx) => {
      await tx`update bookings set agreement_value_paise = ${120 * L}, cash_agreed_paise = ${70 * L}, account_agreed_paise = ${50 * L} where id = ${b.id}`;
      locked();
      await released;
    });
    await holding;
    const run = raiseDuesForAll(t.app.db, addDays(today, 31), { bookingId: b.id });
    // the run is now waiting for the booking lock (it must not have read the booking yet)
    for (let i = 0; i < 50; i += 1) {
      const waiting = await t.app.sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
      if (waiting[0]!.n > 0) break;
      await sleep(20);
    }
    release();
    await revision;
    const summary = await run;
    expect(summary.failures).toEqual([]);
    expect(summary.demandsRaised).toBe(1);
    const d = (await demandsOf(b.id)).find((x) => x.installment_seq === 2)!;
    // 85 % of the REVISED agreement (70 L cash / 50 L account), never of the 60 / 40 read before the lock
    expect(d).toMatchObject({ cash_demand_paise: 59.5 * L, account_demand_paise: 42.5 * L });
  });
});

// ---------------------------------------------------------------------------
describe("2. integrity runs once a night; repair re-checks under the booking lock", () => {
  it("exactly one schedule runs the integrity report, and DAILY_DUES no longer runs it a second time", async () => {
    expect(JOB_SCHEDULES.filter((s) => s.name === "NIGHTLY_INTEGRITY")).toHaveLength(1);
    const runs = async () => (await t.app.sql<{ n: number }[]>`select count(*)::int as n from integrity_runs`)[0]!.n;
    const before = await runs();
    const dues = await dailyDues(t.app.db);
    expect(JSON.stringify(dues)).not.toContain("integrity");
    expect(await runs()).toBe(before);
    const companies = (await t.app.sql<{ n: number }[]>`select count(*)::int as n from companies`)[0]!.n;
    await nightlyIntegrityJob(t.app.db);
    expect(await runs()).toBe(before + companies);
  });

  it("a demand flagged UNSATISFIED whose stage is completed again before the repair locks the booking is kept, not voided", async () => {
    const tower = await newTower(1);
    const b = await book(tower.flats[0]!.id, w.customers[6]!);
    await completeStage(t, tower.id, w.stages.EXCAVATION, today);
    const run = await t.request<{ demands_raised: number }>("POST", "/api/v1/dues/run", {
      token: admin,
      body: { booking_id: b.id },
    });
    expect(run.body.demands_raised).toBe(1);
    const demand = (await demandsOf(b.id)).find((d) => d.installment_seq === 2)!;
    // the stage is put back without the undo rule (a manufactured anomaly) → the demand is UNSATISFIED
    await resetStage(t, tower.id, w.stages.EXCAVATION);
    expect((await integrity(b.id)).findings.map((f) => [f.type, f.demand_id])).toEqual([
      ["UNSATISFIED_DEMAND", demand.id],
    ]);
    // the repair's own report sees the anomaly; the stage is completed again before the repair's unit of work takes the lock
    let fired = false;
    const raced = new Proxy(t.app.db, {
      get(obj, prop, receiver) {
        if (prop === "transaction")
          return async (fn: (tx: unknown) => Promise<unknown>, cfg?: unknown) => {
            if (!fired && cfg === undefined) {
              fired = true;
              await completeStage(t, tower.id, w.stages.EXCAVATION, today);
            }
            return (obj as DB).transaction(fn as never, cfg as never);
          };
        const v = Reflect.get(obj, prop, receiver) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(obj) : v;
      },
    }) as DB;
    const result = await repair(raced, { companyId: t.companyId, bookingId: b.id }, undefined, [b.id]);
    expect(fired).toBe(true);
    expect(result.demands_voided).toBe(0);
    expect(result.kept_now_satisfied).toEqual([demand.demand_number]);
    expect((await demandsOf(b.id)).find((d) => d.id === demand.id)?.status).toBe("OPEN");
    expect((await integrity(b.id)).ok).toBe(true);
  });
  it("repairing a demand that never reached the ledger (inserted behind the API) restates the book coherently", async () => {
    const tower = await newTower(1);
    const b = await book(tower.flats[0]!.id, w.customers[1]!, { payment_plan_id: w.plans.FLEXI });
    // an UNSATISFIED demand written straight into the table (no DEMAND row) with amounts that are not the plan's
    await t.app
      .sql`insert into demands (company_id, booking_id, project_id, block_id, customer_id, demand_number, installment_seq,
        installment_name, trigger_type, trigger_stage_id, percent, cumulative_percent, cash_demand_paise, account_demand_paise,
        total_demand_paise, demand_date, due_date)
      select company_id, id, project_id, block_id, customer_id, 'DM-FAKE/7001', 4, 'Brickwork', 'ON_STAGE', ${w.stages.BRICKWORK},
        10, 60, ${600 * L}, ${400 * L}, ${1000 * L}, ${today}, ${today} from bookings where id = ${b.id}`;
    expect((await integrity(b.id)).findings.map((f) => f.type)).toContain("UNSATISFIED_DEMAND");
    const r = await t.request<{ demands_voided: number; report_after: Integrity }>(
      "POST",
      "/api/v1/dues/integrity/repair",
      {
        token: admin,
        body: { confirm: "REPAIR", booking_ids: [b.id] },
        headers: { "idempotency-key": key() },
      },
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body.demands_voided).toBe(1);
    expect(r.body.report_after.findings.filter((f) => f.booking_id === b.id)).toEqual([]);
    // the restated book carries the fake demand's DEMAND and DEMAND_VOIDED rows at the PLAN's amounts and nets to nothing
    const ledger = await ledgerPage(b.id);
    expect(ledger).toMatchObject({ epoch: 2, current_epoch: 2 });
    const fake = ledger.items.filter((x) => x.ref_number === "DM-FAKE/7001");
    expect(fake.map((x) => [x.event, x.amount_paise])).toEqual([
      ["DEMAND", 10 * L],
      ["DEMAND_VOIDED", -10 * L],
    ]);
    const bk = await getBooking(b.id);
    expect(bk.summary.cash).toMatchObject({ order_raised_paise: 6 * L, due_paise: 6 * L });
    expect(
      await t.app.sql`select reason, from_epoch, to_epoch from ledger_rebuilds where booking_id = ${b.id}`,
    ).toEqual([{ reason: "INTEGRITY_REPAIR", from_epoch: 1, to_epoch: 2 }]);
  });
});

// ---------------------------------------------------------------------------
describe("3. the ledger is a book of record (contract C7)", () => {
  let b: Booking;
  let tower: { id: string; flats: Flat[] };

  it("agreement revision and stage undo append to the current epoch; nothing is rewritten and no restatement is needed", async () => {
    tower = await newTower(2);
    b = await book(tower.flats[0]!.id, w.customers[7]!);
    await pay(b.id, "CASH", 3 * L);
    const rev = await t.request("POST", `/api/v1/bookings/${b.id}/agreement-revisions`, {
      token: admin,
      headers: { "idempotency-key": key(), "if-match": `"${(await getBooking(b.id)).version}"` },
      body: {
        agreement_value_paise: 110 * L,
        cash_agreed_paise: 65 * L,
        account_agreed_paise: 45 * L,
        reason: "Upgraded flooring",
      },
    });
    expect(rev.status, rev.text).toBe(201);
    await stageStatus(tower.id, w.stages.EXCAVATION);
    const before = await ledgerPage(b.id);
    expect(before.items.map((r) => r.event)).toEqual(["DEMAND", "PAYMENT", "AGREEMENT_CHANGE", "DEMAND"]);
    const u = await undo(tower.id, w.stages.EXCAVATION);
    expect(u.status, u.text).toBe(200);
    const after = await ledgerPage(b.id);
    expect(after).toMatchObject({ epoch: 1, current_epoch: 1 });
    expect(after.items.slice(0, 4)).toEqual(before.items); // every earlier row untouched (ids included)
    expect(after.items[4]).toMatchObject({
      event: "DEMAND_VOIDED",
      ref_id: before.items[3]!.ref_id,
      amount_paise: -before.items[3]!.amount_paise,
    });
    const rebuilds = await t.app.sql`select * from ledger_rebuilds where booking_id = ${b.id}`;
    expect(rebuilds).toHaveLength(0);
    expect((await integrity(b.id)).ok).toBe(true);
    // C7 summary: server-computed totals equal the booking summary
    const bk = await getBooking(b.id);
    expect(after.summary).toMatchObject({
      cash_due_paise: bk.summary.cash.due_paise,
      account_due_paise: bk.summary.account.due_paise,
      total_due_paise: bk.summary.total_due_paise,
      cash_paid_paise: 3 * L,
      account_paid_paise: 0,
    });
    expect(after.epoch_totals).toEqual({
      cash_due_paise: after.items.at(-1)!.cash_due_paise,
      account_due_paise: after.items.at(-1)!.account_due_paise,
      total_due_paise: after.items.at(-1)!.total_due_paise,
      other_charges_due_paise: after.items.at(-1)!.other_charges_due_paise,
      cash_paid_paise: after.items.at(-1)!.cash_paid_cum_paise,
      account_paid_paise: after.items.at(-1)!.account_paid_cum_paise,
    });
  });

  it("a rebuild that differs writes a new epoch + ledger_rebuilds row (reason, actor, summary diff); the old epoch stays, closed by LEDGER_RESTATED; an identical rebuild writes nothing", async () => {
    const epoch1 = await ledgerPage(b.id);
    // a ledger in a stale order (written by an older engine): two rows swapped, below the guard, test-only
    await t.app.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update ledger_entries set seq = -1 where booking_id = ${b.id} and seq = 1`;
      await tx`update ledger_entries set seq = 1 where booking_id = ${b.id} and seq = 2`;
      await tx`update ledger_entries set seq = 2 where booking_id = ${b.id} and seq = -1`;
    });
    const stale = await ledgerPage(b.id);
    const actorId = (await t.app.sql<{ id: string }[]>`select id from users where email = 'admin@sgb.in'`)[0]!.id;
    const res = await t.app.db.transaction((tx) =>
      rebuild(tx, b.id, {
        write: true,
        reason: "ADMIN_RECOMPUTE",
        actor: { type: "STAFF", id: actorId, name: "Admin" },
      }),
    );
    expect(res).toMatchObject({ written: true, restated: true, epoch: 2 });
    const current = await ledgerPage(b.id);
    expect(current).toMatchObject({ epoch: 2, current_epoch: 2 });
    expect(current.items.map((r) => [r.seq, r.event, r.ref_id, r.total_due_paise])).toEqual(
      epoch1.items.map((r) => [r.seq, r.event, r.ref_id, r.total_due_paise]),
    );
    // epoch 1 is kept as it was, plus its closing LEDGER_RESTATED row
    const old = await ledgerPage(b.id, "&epoch=1");
    expect(old).toMatchObject({ epoch: 1, current_epoch: 2 });
    expect(old.items.slice(0, stale.items.length)).toEqual(stale.items);
    expect(old.items.at(-1)).toMatchObject({
      event: "LEDGER_RESTATED",
      amount_paise: 0,
      note: "ADMIN_RECOMPUTE",
      total_due_paise: stale.items.at(-1)!.total_due_paise,
    });
    const missing = await t.request<ErrorBody>("GET", `/api/v1/bookings/${b.id}/ledger?epoch=3`, { token: admin });
    expect(missing.status).toBe(404);
    const list = await t.request<
      List<{
        from_epoch: number;
        to_epoch: number;
        reason: string;
        actor: { id: string; name: string | null } | null;
        summary: { rows_before: number; rows_after: number; differences: { position: number; field: string }[] };
      }>
    >("GET", `/api/v1/bookings/${b.id}/ledger/rebuilds`, { token: admin });
    expect(list.status, list.text).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      from_epoch: 1,
      to_epoch: 2,
      reason: "ADMIN_RECOMPUTE",
      actor: { id: actorId },
      summary: { rows_before: stale.items.length, rows_after: epoch1.items.length },
    });
    expect(list.body.items[0]!.summary.differences[0]).toMatchObject({ position: 1 });
    // identical → nothing written anywhere
    const count = async () =>
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from ledger_entries where booking_id = ${b.id}`)[0]!
        .n;
    const rows = await count();
    const again = await t.app.db.transaction((tx) => rebuild(tx, b.id, { write: true }));
    expect(again).toMatchObject({ written: false, restated: false, epoch: 2 });
    expect(await count()).toBe(rows);
    expect(await t.app.sql`select 1 from ledger_rebuilds where booking_id = ${b.id}`).toHaveLength(1);
    // the live path appends to the new epoch; integrity reads the current epoch only
    await pay(b.id, "CASH", L);
    const next = await ledgerPage(b.id);
    expect(next.items.at(-1)).toMatchObject({ seq: epoch1.items.length + 1, event: "PAYMENT" });
    expect((await integrity(b.id)).ok).toBe(true);
  });

  it("the database refuses UPDATE / DELETE / TRUNCATE of the books and edits of a posted payment's financial facts", async () => {
    const p = await pay(b.id, "CASH", 2 * L);
    await rejectsGuard(
      t.app.sql`update payments set amount_paise = amount_paise + 100 where id = ${p.id}`,
      /immutable/,
    );
    await rejectsGuard(t.app.sql`update payments set bucket = 'ACCOUNT' where id = ${p.id}`, /immutable/);
    await rejectsGuard(t.app.sql`update payments set payment_date = payment_date - 1 where id = ${p.id}`, /immutable/);
    await rejectsGuard(
      t.app.sql`update payments set instrument = '{"number":"X1"}'::jsonb where id = ${p.id}`,
      /immutable/,
    );
    await rejectsGuard(
      t.app.sql`update payments set status = 'PENDING' where id = ${p.id}`,
      /cannot move from CLEARED/,
    );
    await rejectsGuard(t.app.sql`delete from ledger_entries where booking_id = ${b.id}`, /append-only/);
    await rejectsGuard(t.app.sql`update ledger_entries set note = 'x' where booking_id = ${b.id}`, /append-only/);
    await rejectsGuard(t.app.sql`update ledger_rebuilds set reason = 'x' where booking_id = ${b.id}`, /append-only/);
    await rejectsGuard(t.app.sql`delete from ledger_rebuilds where booking_id = ${b.id}`, /append-only/);
    await rejectsGuard(t.app.sql`truncate ledger_entries`, /TRUNCATE is only allowed together with bookings/);
    await rejectsGuard(t.app.sql`truncate ledger_rebuilds`, /TRUNCATE is only allowed together with bookings/);
    // lifecycle columns and remarks stay writable (the drizzle path the services use)
    await t.app.db.update(payments).set({ remarks: "counter receipt" }).where(eq(payments.id, p.id));
    // a full reset (bookings truncated with their books, as the guarded reseed does) is allowed — rolled back here
    await expect(
      t.app.sql.begin(async (tx) => {
        await tx`truncate bookings, ledger_entries, ledger_rebuilds cascade`;
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from ledger_entries where booking_id = ${b.id}`)[0]!
        .n,
    ).toBeGreaterThan(0);
    // reversal (CLEARED → REVERSED) still works through the API
    const fresh = (await t.app.sql<{ version: number }[]>`select version from payments where id = ${p.id}`)[0]!;
    const rev = await t.request("POST", `/api/v1/payments/${p.id}/reverse`, {
      token: admin,
      body: { version: fresh.version, reason: "Posted against the wrong booking" },
    });
    expect(rev.status, rev.text).toBe(200);
    expect((await ledgerPage(b.id)).items.at(-1)).toMatchObject({ event: "REVERSAL", amount_paise: -2 * L });
  });

  it("cheque clear and bounce keep working under the payment guard", async () => {
    const cheque = async (no: string) => {
      const r = await t.request<{ payment: Payment }>("POST", "/api/v1/payments", {
        token: accounts,
        headers: { "idempotency-key": key() },
        body: {
          booking_id: b.id,
          against: "FLAT_VALUE",
          bucket: "ACCOUNT",
          amount_paise: L,
          payment_date: today,
          payment_mode_id: w.modes.CHEQUE,
          bank_account_id: w.bankAccountId,
          instrument: { number: no, date: today, bank_name: "SBI" },
        },
      });
      expect(r.status, r.text).toBe(201);
      return r.body.payment;
    };
    const c1 = await cheque("CHQ-7001");
    const c2 = await cheque("CHQ-7002");
    const cleared = await t.request("POST", `/api/v1/payments/${c1.id}/clear`, {
      token: accounts,
      body: { version: c1.version },
    });
    expect(cleared.status, cleared.text).toBe(200);
    const bounced = await t.request("POST", `/api/v1/payments/${c2.id}/bounce`, {
      token: accounts,
      body: { version: c2.version, reason: "Insufficient funds" },
    });
    expect(bounced.status, bounced.text).toBe(200);
    await rejectsGuard(
      t.app.sql`update payments set status = 'CLEARED' where id = ${c2.id}`,
      /cannot move from BOUNCED/,
    );
    expect((await integrity(b.id)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("4. stage undo never rewrites a closed booking", () => {
  it("CANCELLED bookings are skipped — paid or unpaid — and their closed ledgers stay as they were", async () => {
    const tower = await newTower(1);
    const [f1, f2, f3] = tower.flats;
    const open = await book(f1!.id, w.customers[0]!);
    const paidCancelled = await book(f2!.id, w.customers[1]!);
    const unpaidCancelled = await book(f3!.id, w.customers[2]!);
    await stageStatus(tower.id, w.stages.EXCAVATION);
    // the paid one is paid ON the demand date (today): before this change it blocked the undo forever
    await pay(paidCancelled.id, "CASH", 9 * L);
    const cancel = async (id: string, refund: number) => {
      const r = await t.request<Booking>("POST", `/api/v1/bookings/${id}/cancel`, {
        token: admin,
        headers: { "if-match": `"${(await getBooking(id)).version}"` },
        body: { reason: "Customer withdrew", deduction_paise: 0, refund_paise: refund },
      });
      expect(r.status, r.text).toBe(200);
    };
    await cancel(paidCancelled.id, 9 * L);
    await cancel(unpaidCancelled.id, 0);
    const before = {
      paid: (await ledgerPage(paidCancelled.id)).items,
      unpaid: (await ledgerPage(unpaidCancelled.id)).items,
      paidDemands: await demandsOf(paidCancelled.id),
      unpaidDemands: await demandsOf(unpaidCancelled.id),
    };
    const u = await undo(tower.id, w.stages.EXCAVATION);
    expect(u.status, u.text).toBe(200);
    const openDemand = (await demandsOf(open.id)).find((d) => d.installment_seq === 2)!;
    expect(u.body.voided_demand_numbers).toEqual([openDemand.demand_number]);
    expect(openDemand.status).toBe("VOID");
    expect((await ledgerPage(paidCancelled.id)).items).toEqual(before.paid);
    expect((await ledgerPage(unpaidCancelled.id)).items).toEqual(before.unpaid);
    expect(await demandsOf(paidCancelled.id)).toEqual(before.paidDemands);
    expect(await demandsOf(unpaidCancelled.id)).toEqual(before.unpaidDemands);
    expect(before.paidDemands.find((d) => d.installment_seq === 2)?.status).toBe("CANCELLED");
  });

  it("an undo that would void a demand of a COMPLETED (handed-over) booking answers 409 BOOKING_CLOSED listing it, and nothing changes", async () => {
    const tower = await newTower(1);
    const [f1, f2] = tower.flats;
    // booked 40 days ago: the on-booking and 30-day installments are raised at creation (catch-up)
    const bookedOn = addDays(today, -40);
    const handed = await book(f1!.id, w.customers[3]!, {
      payment_plan_id: w.plans.DP,
      booking_date: bookedOn,
      plan_accepted_on: bookedOn,
    });
    const open = await book(f2!.id, w.customers[4]!, { payment_plan_id: w.plans.DP });
    // advances paid BEFORE possession: they fund the possession demand once it is raised (the audit's "earlier advance" case)
    await pay(handed.id, "CASH", 60 * L, { payment_date: addDays(today, -1) });
    await pay(handed.id, "ACCOUNT", 40 * L, {
      payment_date: addDays(today, -1),
      payment_mode_id: w.modes.UPI,
      bank_account_id: w.bankAccountId,
      instrument: { number: `UPI-${key()}` },
    });
    await stageStatus(tower.id, w.stages.POSSESSION);
    const done = await t.request<Booking>("POST", `/api/v1/bookings/${handed.id}/complete`, {
      token: admin,
      body: { version: (await getBooking(handed.id)).version },
    });
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    const before = {
      ledger: (await ledgerPage(handed.id)).items,
      demands: await demandsOf(handed.id),
      openDemands: await demandsOf(open.id),
      version: await blockVersion(tower.id),
    };
    const possession = before.demands.find((d) => d.installment_seq === 3)!;
    const u = await undo(tower.id, w.stages.POSSESSION);
    expect(u.status, u.text).toBe(409);
    expect(u.body.error.code).toBe("BOOKING_CLOSED");
    expect(u.body.error.details?.["bookings"]).toEqual([
      {
        booking_id: handed.id,
        booking_number: handed.booking_number,
        status: "COMPLETED",
        demand_numbers: [possession.demand_number],
      },
    ]);
    expect((await ledgerPage(handed.id)).items).toEqual(before.ledger);
    expect(await demandsOf(handed.id)).toEqual(before.demands);
    expect(await demandsOf(open.id)).toEqual(before.openDemands);
    expect(await blockVersion(tower.id)).toBe(before.version);
    expect((await getBooking(handed.id)).status).toBe("COMPLETED");
  });
});

// ---------------------------------------------------------------------------
describe("5. receipt numbering in the posting's last statement", () => {
  it("renders exactly like domain formatNumber for every pattern shape", async () => {
    const cases: [string, string, string, number][] = [
      ["SGB/", "2526", "{prefix}{fy}/{seq:4}", 7],
      ["SGB/", "2526", "{prefix}{fy}/{seq:4}", 123456],
      ["R-", "2627", "{prefix}{seq}", 42],
      ["X", "2627", "{fy}-{seq:6}-{prefix}", 9],
      ["Q%_'\"", "2627", "{prefix}{fy}{seq:2}", 3],
    ];
    for (const [prefix, fy, pattern, seq] of cases) {
      const [row] = await t.app.db.execute<{ v: string }>(
        sql`select ${numberSql(sql`${seq}::bigint`, prefix, fy, pattern)} as v`,
      );
      expect(row!.v).toBe(formatNumber(prefix, fy, seq, pattern));
    }
  });

  it("numbers stay gapless and contiguous under concurrency, and a posting that fails consumes no number", async () => {
    const tower = await newTower(1);
    const b = await book(tower.flats[0]!.id, w.customers[5]!);
    const seqOf = (r: string) => Number(r.split("/").pop());
    const first = await pay(b.id, "CASH", L);
    // a posting that fails after validation (bucket cap) consumes nothing; concurrent postings share one gapless sequence
    const over = await t.request<ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: {
        booking_id: b.id,
        against: "FLAT_VALUE",
        bucket: "CASH",
        amount_paise: 70 * L,
        payment_date: today,
        payment_mode_id: w.modes.CASH,
      },
    });
    expect(over.status).toBe(409);
    const sameKey = key();
    const body = {
      booking_id: b.id,
      against: "FLAT_VALUE",
      bucket: "CASH",
      amount_paise: L,
      payment_date: today,
      payment_mode_id: w.modes.CASH,
    };
    const racing = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        t.request<{ payment: Payment }>("POST", "/api/v1/payments", {
          token: accounts,
          headers: { "idempotency-key": key() },
          body,
        }),
      ),
      t.request<{ payment: Payment }>("POST", "/api/v1/payments", {
        token: accounts,
        headers: { "idempotency-key": sameKey },
        body,
      }),
      t.request<{ payment: Payment }>("POST", "/api/v1/payments", {
        token: accounts,
        headers: { "idempotency-key": sameKey },
        body,
      }),
    ]);
    for (const r of racing) expect([200, 201, 409]).toContain(r.status);
    const last = await pay(b.id, "CASH", L);
    const rows = await t.app.sql<{ receipt_number: string; idempotency_key: string | null }[]>`
      select receipt_number, idempotency_key from payments where company_id = ${t.companyId}`;
    const mine = rows.map((r) => seqOf(r.receipt_number)).filter((s) => s >= seqOf(first.receipt_number));
    expect(rows.filter((r) => r.idempotency_key === sameKey)).toHaveLength(1);
    mine.sort((a, c) => a - c);
    expect(mine).toEqual(Array.from({ length: mine.length }, (_, i) => seqOf(first.receipt_number) + i));
    expect(mine.at(-1)).toBe(seqOf(last.receipt_number));
    // each receipt's ledger row, audit row and notification carry the allocated number
    const [ledgerRow] = await t.app.sql<{ ref_number: string; label: string }[]>`
      select ref_number, label from ledger_entries where ref_id = ${last.id}`;
    expect(ledgerRow).toEqual({ ref_number: last.receipt_number, label: `Receipt ${last.receipt_number}` });
    const [audit] = await t.app.sql<{ after: { receipt_number: string } }[]>`
      select after from audit_logs where action = 'payment.post' and entity_id = ${last.id}`;
    expect(audit!.after.receipt_number).toBe(last.receipt_number);
    const bells = await t.app.sql<{ title: string }[]>`select title from notifications where entity_id = ${last.id}`;
    expect(bells.length).toBeGreaterThan(0);
    for (const bell of bells) expect(bell.title).toContain(`(receipt ${last.receipt_number})`);
    expect((await integrity(b.id)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("6. payment and demand search: bookings / customers resolved first, then ids or own indexed columns", () => {
  let target: Booking;
  let receipt: Payment;

  it("returns exactly what the joined OR returned, for every searched column", async () => {
    const tower = await newTower(1);
    target = await book(tower.flats[0]!.id, w.customers[6]!);
    receipt = await pay(target.id, "CASH", L);
    await t.request("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: {
        booking_id: target.id,
        against: "FLAT_VALUE",
        bucket: "ACCOUNT",
        amount_paise: L,
        payment_date: today,
        payment_mode_id: w.modes.CHEQUE,
        bank_account_id: w.bankAccountId,
        instrument: { number: "SRCH-99123", date: today, bank_name: "HDFC" },
      },
    });
    const customer = (
      await t.app.sql<{ full_name: string }[]>`select full_name from customers where id = ${w.customers[6]!}`
    )[0]!.full_name;
    const terms = [
      target.booking_number,
      customer.slice(0, 5),
      tower.flats[0]!.flat_number,
      receipt.receipt_number,
      "SRCH-991",
      "zz-no-such-thing",
    ];
    for (const term of terms) {
      const pattern = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const expectedPayments = (
        await t.app.sql<{ id: string }[]>`
          select p.id from payments p
          join bookings b on b.id = p.booking_id join flats f on f.id = b.flat_id join customers c on c.id = p.customer_id
          where p.company_id = ${t.companyId} and (p.receipt_number ilike ${pattern} or b.booking_number ilike ${pattern}
            or c.full_name ilike ${pattern} or f.flat_number ilike ${pattern} or (p.instrument ->> 'number') ilike ${pattern})`
      )
        .map((r) => r.id)
        .sort();
      const got = await t.request<List<{ id: string }>>(
        "GET",
        `/api/v1/payments?page_size=200&search=${encodeURIComponent(term)}`,
        { token: admin },
      );
      expect(got.status, got.text).toBe(200);
      expect(got.body.items.map((r) => r.id).sort(), `payments search "${term}"`).toEqual(expectedPayments);
      expect(got.body.total).toBe(expectedPayments.length);
      const expectedDemands = (
        await t.app.sql<{ id: string }[]>`
          select d.id from demands d
          join bookings b on b.id = d.booking_id join flats f on f.id = b.flat_id join customers c on c.id = d.customer_id
          where d.company_id = ${t.companyId} and d.status <> 'VOID' and (d.demand_number ilike ${pattern}
            or b.booking_number ilike ${pattern} or c.full_name ilike ${pattern} or f.flat_number ilike ${pattern}
            or d.installment_name ilike ${pattern})`
      )
        .map((r) => r.id)
        .sort();
      const gotDemands = await t.request<List<{ id: string }>>(
        "GET",
        `/api/v1/demands?page_size=200&search=${encodeURIComponent(term)}`,
        { token: admin },
      );
      expect(gotDemands.status, gotDemands.text).toBe(200);
      expect(gotDemands.body.items.map((r) => r.id).sort(), `demands search "${term}"`).toEqual(expectedDemands);
    }
    // the bound fallback (more matches than the inline id lists allow) answers the same rows as the id lists
    for (const term of ["BK", customer.slice(0, 3)]) {
      const count = async (bound?: number) => {
        const refs = await resolveSearchRefs(t.app.db, t.companyId, term, bound);
        const cond = searchWhere(refs, t.companyId, {
          booking: payments.bookingId,
          customer: payments.customerId,
          own: [payments.receiptNumber, sql`(${payments.instrument} ->> 'number')`],
        })!;
        const rows = await t.app.db.execute<{ id: string }>(
          sql`select id from payments where company_id = ${t.companyId} and ${cond} order by id`,
        );
        return { refs, ids: rows.map((r) => r.id) };
      };
      const fast = await count();
      const fallback = await count(0);
      expect(fallback.refs!.bookingIds === null || fallback.refs!.customerIds === null).toBe(true);
      expect(fallback.ids).toEqual(fast.ids);
      expect(fast.ids.length).toBeGreaterThan(0);
    }
  });

  it("EXPLAIN: the payment search is answered from indexes (BitmapOr of trigram and FK indexes), never a scan of payments", async () => {
    const resolved = await resolveSearchRefs(t.app.db, t.companyId, target.booking_number);
    expect(resolved!.bookingIds).toContain(target.id);
    // both id lists non-empty, so every branch of the OR is in the plan
    const refs = { ...resolved!, customerIds: [w.customers[6]!] };
    const cond = searchWhere(refs, t.companyId, {
      booking: payments.bookingId,
      customer: payments.customerId,
      own: [payments.receiptNumber, sql`(${payments.instrument} ->> 'number')`],
    })!;
    const plan = await t.app.db.transaction(async (tx) => {
      // the test tables are tiny: switch the sequential scan off so the plan shows what the indexes can do at scale
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = await tx.execute<{ "QUERY PLAN": string }>(sql`explain select id from payments where ${cond}`);
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    expect(plan).not.toMatch(/Seq Scan on payments/);
    expect(plan).toMatch(/BitmapOr/);
    expect(plan).toMatch(/payments_receipt_number_trgm_idx/);
    expect(plan).toMatch(/payments_instrument_number_trgm_idx/);
    expect(plan).toMatch(/payments_booking_status_idx/);
    expect(plan).toMatch(/payments_customer_id_idx/);
  });
});

// ---------------------------------------------------------------------------
describe("7. cancellation money lives in bigint columns", () => {
  it("the booking detail and the ledger read refund / deduction from the columns; the jsonb is history only", async () => {
    const tower = await newTower(1);
    const b = await book(tower.flats[0]!.id, w.customers[7]!);
    await pay(b.id, "CASH", 5 * L);
    const r = await t.request<Booking>("POST", `/api/v1/bookings/${b.id}/cancel`, {
      token: admin,
      headers: { "if-match": `"${(await getBooking(b.id)).version}"` },
      body: { reason: "Customer withdrew", deduction_paise: L, refund_paise: 4 * L },
    });
    expect(r.status, r.text).toBe(200);
    const [row] = await t.app.sql<{ refund: number; deduction: number }[]>`
      select cancellation_refund_paise::int as refund, cancellation_deduction_paise::int as deduction from bookings where id = ${b.id}`;
    expect(row).toEqual({ refund: 4 * L, deduction: L });
    // a drifted jsonb copy never changes the money figures
    await t.app
      .sql`update bookings set cancellation = jsonb_set(cancellation, '{refund_paise}', '1'::jsonb) where id = ${b.id}`;
    const detail = await getBooking(b.id);
    expect(detail.cancellation).toMatchObject({ refund_paise: 4 * L, deduction_paise: L });
    const ledger = await ledgerPage(b.id);
    expect(ledger.items.at(-1)).toMatchObject({ event: "CANCELLATION", amount_paise: -4 * L });
    const check = await t.app.db.transaction((tx) => rebuild(tx, b.id));
    expect(check.rowMismatches).toEqual([]);
  });
});
