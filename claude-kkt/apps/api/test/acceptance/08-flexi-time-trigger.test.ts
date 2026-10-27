import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@kkt/domain";
import {
  blockByCode,
  BOOT_TIMEOUT,
  bookingBody,
  bookingBySeq,
  bootAcceptance,
  createCustomer,
  demandsOf,
  flatsOf,
  getBooking,
  key,
  listAtCr,
  L,
  masterByCode,
  projectByCode,
  type Booking,
  type ErrorBody,
  type Harness,
} from "./harness.js";

/**
 * SPEC §18 scenario 8 (L249): "Flexi booking: 10% demand immediately; the 40% installment is raised exactly once when 60 days pass
 * (daily job or admin run), never twice."  SPEC L141 DAYS_AFTER_BOOKING, L151 unique (booking, seq), L152 admin "run dues now".
 */

type Run = { demands_raised: number; demand_numbers: string[]; bookings_processed: number };

let h: Harness;
let admin: string;
let sales: string;

async function runDues(body: Record<string, unknown>): Promise<Run> {
  const r = await h.request<Run & ErrorBody>("POST", "/api/v1/dues/run", {
    token: admin,
    body,
    headers: { "idempotency-key": key("dues") },
  });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

/** Telescoping share of an installment: cumulative(new) − cumulative(old) of the agreed amount (SPEC L147). */
function share(agreed: number, cumOld: number, cumNew: number): number {
  return Math.round((agreed * cumNew) / 100) - Math.round((agreed * cumOld) / 100);
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sales = (await h.loginAs("sales")).access_token;
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 8 — Flexi 10:40:50 on a fresh booking", () => {
  let booking: Booking;

  it("raises the 10 % booking installment immediately and nothing else", async () => {
    const sgh = await projectByCode(h, admin, "SGH");
    const towerC = await blockByCode(h, admin, sgh.id, "C");
    const flat = (await flatsOf(h, admin, towerC.id)).get("C-1103")!;
    await listAtCr(h, admin, [flat.id]);
    const flexi = await masterByCode<{ id: string; code: string }>(h, admin, "payment-plans", "FLEXI_10_40_50");
    const customer = await createCustomer(h, sales, "Acceptance Buyer Eight", "9898000008");
    const r = await h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
      token: sales,
      headers: { "idempotency-key": key() },
      body: bookingBody(h, flat.id, customer.id, { payment_plan_id: flexi.id }),
    });
    expect(r.status, r.text).toBe(201);
    booking = r.body;
    expect(booking.plan_snapshot.name).toBe("Flexi 10:40:50"); // SPEC L122 seed example
    // SPEC L140 ON_BOOKING → satisfied at booking date; SPEC L249 "10% demand immediately"
    expect(booking.summary.raised_percent).toBe(10);
    expect(booking.summary.cash).toMatchObject({ order_raised_paise: 6 * L, due_paise: 6 * L });
    expect(booking.summary.account).toMatchObject({ order_raised_paise: 4 * L, due_paise: 4 * L });
    expect(booking.schedule.map((s) => s.status)).toEqual([
      "RAISED",
      "NOT_YET_DUE",
      "NOT_YET_DUE",
      "NOT_YET_DUE",
      "NOT_YET_DUE",
      "NOT_YET_DUE",
      "NOT_YET_DUE",
    ]);
    const demands = await demandsOf(h, admin, booking.id, false);
    expect(demands.map((d) => d.installment_seq)).toEqual([1]);
    // Tower C is past Excavation, but Flexi has no Excavation installment → nothing else is caught up (SPEC L191 catch-up applies only to the plan's own installments)
  });

  it("the 40 % installment is NOT raised before day 60, is raised exactly once at day 60 even under concurrent runs, and never again", async () => {
    // SPEC L141: DAYS_AFTER_BOOKING → booking_date + n ≤ today; day 59 is too early
    const day59 = await runDues({ booking_id: booking.id, as_of: addDays(booking.booking_date, 59) });
    expect(day59.demands_raised).toBe(0);
    expect((await demandsOf(h, admin, booking.id, false)).map((d) => d.installment_seq)).toEqual([1]);
    // SPEC L152 admin "run dues now" / daily job on day 60: two simultaneous runs raise it exactly once (SPEC L151 unique constraint)
    const asOf = addDays(booking.booking_date, 60);
    const [a, b] = await Promise.all([
      runDues({ booking_id: booking.id, as_of: asOf }),
      runDues({ booking_id: booking.id, as_of: asOf }),
    ]);
    expect(a.demands_raised + b.demands_raised).toBe(1);
    // SPEC L138: a non-void demand already exists for the installment → skipped (idempotent) on later days
    expect((await runDues({ booking_id: booking.id, as_of: asOf })).demands_raised).toBe(0);
    expect((await runDues({ booking_id: booking.id, as_of: addDays(booking.booking_date, 61) })).demands_raised).toBe(
      0,
    );
    expect((await runDues({ booking_id: booking.id, as_of: addDays(booking.booking_date, 120) })).demands_raised).toBe(
      0,
    );
    const demands = await demandsOf(h, admin, booking.id, true);
    const live = demands.filter((d) => d.status !== "VOID");
    expect(live.map((d) => d.installment_seq)).toEqual([1, 2]);
    expect(demands.filter((d) => d.installment_seq === 2)).toHaveLength(1); // never twice, not even as VOID
    // SPEC L146: cash_demand = 40 % × 60 L, account_demand = 40 % × 40 L; due date = trigger date + due-days (SPEC L148)
    expect(live[1]).toMatchObject({
      cash_demand_paise: 24 * L,
      account_demand_paise: 16 * L,
      demand_date: asOf,
      installment_name: "60 days after booking",
    });
    expect(live[1]?.due_date).toBe(addDays(asOf, 15)); // company setting demand_due_days = 15 (bootstrap)
    const after = await getBooking(h, admin, booking.id);
    expect(after.summary.raised_percent).toBe(50);
    expect(after.summary.total_due_paise).toBe(50 * L);
    expect(after.schedule[1]?.status).toBe("RAISED");
  });
});

describe("scenario 8 — the seeded Flexi booking #7 (C-502, booked 20 days ago)", () => {
  it("has only its 10 % raised today; the 40 % appears exactly once on day 60 and the amounts are 40 % of each agreed bucket", async () => {
    const b7 = await bookingBySeq(h, admin, 7);
    expect(b7.plan_snapshot.name).toBe("Flexi 10:40:50");
    expect(b7.summary.raised_percent).toBe(10); // SEED.md: the 40 % (60 days) is NOT yet due
    expect(b7.booking_date).toBe(addDays(h.today, -20));
    expect((await runDues({ booking_id: b7.id })).demands_raised).toBe(0); // today = day 20
    expect((await runDues({ booking_id: b7.id, as_of: addDays(b7.booking_date, 59) })).demands_raised).toBe(0);
    const [a, b] = await Promise.all([
      runDues({ booking_id: b7.id, as_of: addDays(b7.booking_date, 60) }),
      runDues({ booking_id: b7.id, as_of: addDays(b7.booking_date, 60) }),
    ]);
    expect(a.demands_raised + b.demands_raised).toBe(1); // SPEC L249 "exactly once … never twice"
    expect((await runDues({ booking_id: b7.id, as_of: addDays(b7.booking_date, 90) })).demands_raised).toBe(0);
    const live = (await demandsOf(h, admin, b7.id, true)).filter((d) => d.status !== "VOID");
    expect(live.map((d) => d.installment_seq)).toEqual([1, 2]);
    expect(live[1]).toMatchObject({
      cash_demand_paise: share(b7.cash_agreed_paise, 10, 50),
      account_demand_paise: share(b7.account_agreed_paise, 10, 50),
    });
    expect((await getBooking(h, admin, b7.id)).summary.raised_percent).toBe(50);
    // a far-future as_of is refused rather than raising everything blindly
    const far = await h.request<ErrorBody>("POST", "/api/v1/dues/run", {
      token: admin,
      body: { booking_id: b7.id, as_of: "2099-01-01" },
    });
    expect(far.status).toBe(400);
  });
});
