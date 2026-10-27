import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { redactForAudit } from "../../src/lib/audit.js";
import { databaseErrorCode } from "../../src/lib/errors.js";
import { dailyDues, raiseDuesForAll } from "../../src/modules/money/index.js";
import { DuesRetryableError } from "../../src/modules/money/jobs.js";
import { rebuildAllLedgers } from "../../src/modules/money/services/ledgerRebuild.js";
import { completeStage, createMoneyWorld, LIST_PRICE_PAISE, type MoneyWorld } from "./fixtures/money.js";
import { post, towerCBody } from "./fixtures/inventory.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Phase 7 adversarial review of the money track (docs/hardening/phase7-review-money.md):
 *  R1. a database OUTAGE during a dues run is not one booking's failure: the run stops and rethrows (job retried, admin route 503);
 *  R2. a transient per-booking failure (lock timeout …) is isolated but makes the scheduled attempt fail so BullMQ retries it, and the
 *      Super Admin bell goes out once (finished run or last attempt);
 *  R3. failure messages shown to admins never carry raw database text;
 *  R4. LEDGER_REBUILD stops on an outage and logs / counts every failed booking;
 *  R5. the payment.post audit row has the same audit form as writeAudit (redactForAudit).
 */

const L = 10_000_000;
const CR = 100 * L;

type Booking = { id: string; booking_number: string };
type Flat = { id: string; flat_number: string };
type Demand = { installment_seq: number; status: string };

let t: TestContext;
let admin: string;
let accounts: string;
let w: MoneyWorld;
let today: string;
let n = 0;
const key = () => `p7r-${Date.now()}-${++n}`;

async function book(flatId: string, customerId: string, planId: string): Promise<Booking> {
  const r = await t.request<Booking>("POST", "/api/v1/bookings", {
    token: admin,
    headers: { "idempotency-key": key() },
    body: {
      flat_id: flatId,
      customer_id: customerId,
      booking_date: today,
      agreement_value_paise: CR,
      cash_agreed_paise: 60 * L,
      account_agreed_paise: 40 * L,
      plan_acceptance_mode: "IN_PERSON",
      plan_accepted_on: today,
      payment_plan_id: planId,
    },
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
}
async function seqs(bookingId: string): Promise<number[]> {
  const r = await t.request<{ items: Demand[] }>("GET", `/api/v1/bookings/${bookingId}/demands?page_size=200`, {
    token: admin,
  });
  expect(r.status, r.text).toBe(200);
  return r.body.items.map((d) => d.installment_seq).sort((a, b) => a - b);
}
let towerSeq = 0;
async function newTower(floors: number): Promise<{ id: string; flats: Flat[] }> {
  towerSeq += 1;
  const code = `R${towerSeq}`;
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
  const r = await t.request<{ items: Flat[] }>(
    "GET",
    `/api/v1/flats?block_id=${block.id}&page_size=200&sort=flat_number`,
    {
      token: admin,
    },
  );
  return { id: block.id, flats: r.body.items };
}
/** Three bookings of a fresh tower in dues-run order (booking date, then id). */
async function threeBookings(planId: string): Promise<{ towerId: string; ordered: Booking[] }> {
  const tower = await newTower(1);
  const made: Booking[] = [];
  for (const [i, f] of tower.flats.slice(0, 3).entries()) made.push(await book(f.id, w.customers[i]!, planId));
  return { towerId: tower.id, ordered: made.sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

/**
 * Installs a trigger that makes every `op` on `table` for one booking raise SQLSTATE `code` (a stand-in for a database failure that hits
 * that booking's unit of work only); returns the function that removes it.
 */
async function failFor(
  table: "demands" | "bookings",
  op: "INSERT" | "UPDATE",
  column: string,
  id: string,
  code: string,
) {
  const name = `kkt_test_fail_${n++}`;
  await t.app.sql.unsafe(`
    create function ${name}() returns trigger language plpgsql as $$
    begin
      if new.${column} = '${id}'::uuid then
        raise exception 'simulated failure: secret detail of row %', new.${column} using errcode = '${code}';
      end if;
      return new;
    end $$;
    create trigger ${name} before ${op} on ${table} for each row execute function ${name}();`);
  return async () => {
    await t.app.sql.unsafe(`drop trigger if exists ${name} on ${table}; drop function if exists ${name}();`);
  };
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

describe("R1. a database outage stops the dues run (retry), it is not one booking's failure", () => {
  it("raiseDuesForAll rethrows at the failing booking, the admin route answers 503, and a re-run raises what is missing", async () => {
    const { towerId, ordered } = await threeBookings(w.plans.DP);
    const asOf = addDays(today, 31);
    // 57P01 admin_shutdown: the server going away under the second booking's unit of work
    const drop = await failFor("demands", "INSERT", "booking_id", ordered[1]!.id, "57P01");
    try {
      const err = await raiseDuesForAll(t.app.db, asOf, { blockId: towerId }).catch((e: unknown) => e);
      expect(databaseErrorCode(err)).toBe("57P01");
      expect(await seqs(ordered[0]!.id)).toEqual([1, 2]); // committed before the outage
      expect(await seqs(ordered[1]!.id)).toEqual([1]);
      expect(await seqs(ordered[2]!.id)).toEqual([1]); // never reached: no silent "failure" recorded for it either
      const r = await t.request<ErrorBody>("POST", "/api/v1/dues/run", {
        token: admin,
        body: { block_id: towerId, as_of: asOf },
      });
      expect(r.status, r.text).toBe(503);
      expect(r.body.error.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      await drop();
    }
    const again = await raiseDuesForAll(t.app.db, asOf, { blockId: towerId });
    expect(again.failures).toEqual([]);
    expect(again.demandsRaised).toBe(2);
    for (const b of ordered) expect(await seqs(b.id)).toEqual([1, 2]);
  });
});

describe("R2/R3. transient failures are retried; failure messages are safe to show", () => {
  it("a lock timeout on one booking is isolated, counted as retryable, and its message carries no database text", async () => {
    const { towerId, ordered } = await threeBookings(w.plans.DP);
    const asOf = addDays(today, 31);
    const drop = await failFor("demands", "INSERT", "booking_id", ordered[0]!.id, "55P03");
    try {
      const s = await raiseDuesForAll(t.app.db, asOf, { blockId: towerId });
      expect(s.retryableFailures).toBe(1);
      expect(s.failures).toEqual([expect.objectContaining({ booking_id: ordered[0]!.id, code: "LOCK_TIMEOUT" })]);
      expect(s.failures[0]!.message).not.toMatch(/secret detail|simulated/);
      for (const b of ordered.slice(1)) expect(await seqs(b.id)).toEqual([1, 2]);
    } finally {
      await drop();
    }
  });

  it("an unexpected database error is reported as SQLSTATE_<code> with a generic message (raw text only in the log)", async () => {
    const { towerId, ordered } = await threeBookings(w.plans.DP);
    const drop = await failFor("demands", "INSERT", "booking_id", ordered[2]!.id, "P0001");
    try {
      const r = await t.request<{
        bookings_failed: number;
        failures: { booking_id: string; code: string; message: string }[];
      }>("POST", "/api/v1/dues/run", { token: admin, body: { block_id: towerId, as_of: addDays(today, 31) } });
      expect(r.status, r.text).toBe(200);
      expect(r.body.bookings_failed).toBe(1);
      expect(r.body.failures[0]).toMatchObject({ booking_id: ordered[2]!.id, code: "SQLSTATE_P0001" });
      expect(r.body.failures[0]!.message).not.toMatch(/secret detail|simulated/);
      expect(r.body.failures[0]!.message).toContain("P0001");
    } finally {
      await drop();
    }
  });

  it("DAILY_DUES fails an attempt with a transient failure (no bell before the last attempt) and a clean retry completes", async () => {
    const { towerId, ordered } = await threeBookings(w.plans.VILLA_CLP);
    await completeStage(t, towerId, w.stages.EXCAVATION, today);
    const bells = async () =>
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from notifications where type = 'JOB_FAILED'`)[0]!.n;
    const before = await bells();
    const drop = await failFor("demands", "INSERT", "booking_id", ordered[1]!.id, "55P03");
    try {
      const err = await dailyDues(t.app.db, { finalAttempt: false }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DuesRetryableError);
      expect((err as DuesRetryableError).retryable).toBe(1);
      expect(await bells()).toBe(before); // an attempt that will be retried does not bell
      expect(await seqs(ordered[0]!.id)).toEqual([1, 2]);
      expect(await seqs(ordered[2]!.id)).toEqual([1, 2]);
      expect(await seqs(ordered[1]!.id)).toEqual([1]);
      // the last attempt still failing: it bells (once) and fails, so the job framework alerts too
      await expect(dailyDues(t.app.db, { finalAttempt: true })).rejects.toBeInstanceOf(DuesRetryableError);
      expect(await bells()).toBeGreaterThan(before);
    } finally {
      await drop();
    }
    const after = await bells();
    const result = await dailyDues(t.app.db, { finalAttempt: false });
    expect(result["bookings_failed"]).toBe(0);
    expect(await seqs(ordered[1]!.id)).toEqual([1, 2]);
    expect(await bells()).toBe(after);
  });
});

describe("R4. LEDGER_REBUILD: outages stop the run, booking failures are logged and counted", () => {
  it("an outage rethrows; a booking-level failure is listed and counted while the others are restated", async () => {
    const { ordered } = await threeBookings(w.plans.DP);
    // drift every booking's summary column so the rebuild has to write (UPDATE bookings) for each of them
    const drift = async () => {
      for (const b of ordered)
        await t.app.sql`update bookings set cash_order_raised_paise = cash_order_raised_paise + 1 where id = ${b.id}`;
    };
    await drift();
    let drop = await failFor("bookings", "UPDATE", "id", ordered[0]!.id, "57P01");
    try {
      const err = await rebuildAllLedgers(t.app.db, { companyId: t.companyId }).catch((e: unknown) => e);
      expect(databaseErrorCode(err)).toBe("57P01");
    } finally {
      await drop();
    }
    drop = await failFor("bookings", "UPDATE", "id", ordered[0]!.id, "P0001");
    try {
      const r = await rebuildAllLedgers(t.app.db, { companyId: t.companyId });
      expect(r.failed_count).toBe(1);
      expect(r.failed).toEqual([
        { booking_id: ordered[0]!.id, booking_number: ordered[0]!.booking_number, code: "SQLSTATE_P0001" },
      ]);
      expect(r.figures_changed.map((c) => c.booking_id)).toEqual(
        expect.arrayContaining([ordered[1]!.id, ordered[2]!.id]),
      );
    } finally {
      await drop();
    }
    const clean = await rebuildAllLedgers(t.app.db, { companyId: t.companyId });
    expect(clean.failed_count).toBe(0);
    expect(clean.figures_changed.map((c) => c.booking_id)).toEqual([ordered[0]!.id]);
  });
});

describe("R5. the payment.post audit row is in writeAudit's audit form", () => {
  it("stores redactForAudit(after) with the allocated receipt number", async () => {
    const { ordered } = await threeBookings(w.plans.DP);
    const r = await t.request<{ payment: { id: string; receipt_number: string } }>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: {
        booking_id: ordered[0]!.id,
        against: "FLAT_VALUE",
        bucket: "ACCOUNT",
        amount_paise: 5 * L,
        payment_date: today,
        payment_mode_id: w.modes.NEFT,
        bank_account_id: w.bankAccountId,
        instrument: { number: "UTR778899", date: today, bank_name: "SBI", branch: "Boring Road" },
      },
    });
    expect(r.status, r.text).toBe(201);
    const [row] = await t.app.sql<{ after: Record<string, unknown>; mode_code: string }[]>`
      select a.after, p.mode_code from audit_logs a join payments p on p.id = a.entity_id::uuid
      where a.action = 'payment.post' and a.entity_id = ${r.body.payment.id}`;
    expect(row!.after).toEqual(
      redactForAudit({
        receipt_number: r.body.payment.receipt_number,
        booking_id: ordered[0]!.id,
        against: "FLAT_VALUE",
        bucket: "ACCOUNT",
        amount_paise: 5 * L,
        payment_date: today,
        mode_code: row!.mode_code,
        status: "CLEARED",
        instrument: { number: "UTR778899", date: today, bank_name: "SBI", branch: "Boring Road" },
      }),
    );
  });
});
