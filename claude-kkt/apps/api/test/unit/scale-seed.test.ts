import { describe, expect, it } from "vitest";
import {
  addDays,
  deriveLedger,
  emptyLedgerSummary,
  evaluateDues,
  isCanonicalPhone,
  isValidAadhaar,
  isValidPAN,
  type TowerStage,
} from "@kkt/domain";
import type { PlanSnapshot } from "@kkt/db";
import { Rng, istAt, seriesAadhaar, seriesPan, seriesPhone } from "../../src/seed/scaleData.js";
import {
  bookBooks,
  planDemands,
  planPayments,
  type ScaleBookingInput,
  type ScaleModes,
} from "../../src/seed/scaleMoney.js";

/**
 * Scale seed building blocks (docs/SEED.md "Production-size data"): deterministic series and the money of a booking produced by the
 * production engines — the demands are exactly evaluateDues', payments never exceed what a bucket raised, and the stored books are what
 * deriveLedger makes of the same events.
 */
const STAGES = ["Excavation", "Foundation", "Plinth", "1st Slab", "Top Slab", "Possession"].map((name, i) => ({
  stageId: `00000000-0000-4000-8000-00000000000${i}`,
  name,
  isPossession: name === "Possession",
}));
const PLAN: PlanSnapshot = {
  plan_id: "00000000-0000-4000-8000-0000000000aa",
  name: "Test CLP",
  code: "TEST_CLP",
  plan_type: "CONSTRUCTION_LINKED",
  grace_days: 0,
  installments: [
    { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING", due_days: 15 },
    { seq: 2, name: "30 days", percent: 15, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 30, due_days: 15 },
    ...STAGES.slice(0, 5).map((s, i) => ({
      seq: i + 3,
      name: s.name,
      percent: i === 4 ? 25 : 10,
      trigger_type: "ON_STAGE" as const,
      trigger_stage_id: s.stageId,
      trigger_stage_name: s.name,
      due_days: 15,
    })),
    { seq: 8, name: "Possession", percent: 10, trigger_type: "ON_POSSESSION", due_days: 15 },
  ],
};
const MODES: ScaleModes = {
  cash: { id: "m-cash", code: "CASH", isCash: true },
  upi: { id: "m-upi", code: "UPI", isCash: false },
  neft: { id: "m-neft", code: "NEFT_RTGS", isCash: false },
  loan: { id: "m-loan", code: "LOAN_DISBURSEMENT", isCash: false },
  cheque: { id: "m-cheque", code: "CHEQUE", isCash: false },
};
const TODAY = "2026-10-27";

function booking(stagesDone: number, bookingDate = "2025-01-10"): ScaleBookingInput {
  const towerStages: TowerStage[] = STAGES.map((s, i) => ({
    ...s,
    status: i < stagesDone ? "COMPLETED" : i === stagesDone ? "IN_PROGRESS" : "PENDING",
    completedOn: i < stagesDone ? addDays("2024-10-01", (i + 1) * 70) : null,
  }));
  return {
    id: "00000000-0000-4000-8000-0000000000bb",
    bookingDate,
    createdAt: istAt(bookingDate, 12),
    cashAgreedPaise: 12_00_000_00,
    accountAgreedPaise: 48_37_500_00,
    planSnapshot: PLAN,
    towerStages,
    stageCompletedAt: new Map(
      towerStages.filter((s) => s.completedOn).map((s) => [s.stageId, istAt(s.completedOn!, 17)] as const),
    ),
    today: TODAY,
    now: istAt(TODAY, 20),
    defaultDueDays: 15,
  };
}

describe("scale seed series", () => {
  it("draws the same values for the same seed and different ones per fork", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const xs = Array.from({ length: 5 }, () => a.u32());
    expect(Array.from({ length: 5 }, () => b.u32())).toEqual(xs);
    expect(new Rng(7).fork("x").uuid()).toBe(new Rng(7).fork("x").uuid());
    expect(new Rng(7).fork("x").uuid()).not.toBe(new Rng(7).fork("y").uuid());
    expect(new Rng(1).uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("produces valid, unique phones, PANs and Aadhaar numbers by index (never the demo 98765432xx numbers)", () => {
    const phones = new Set<string>();
    const pans = new Set<string>();
    const aadhaars = new Set<string>();
    for (let i = 0; i < 30_000; i++) {
      const phone = seriesPhone("customer", i);
      expect(isCanonicalPhone(phone)).toBe(true);
      expect(phone.startsWith("98765432")).toBe(false);
      phones.add(phone);
      phones.add(seriesPhone("lead", i));
      pans.add(seriesPan(i, "K"));
      aadhaars.add(seriesAadhaar(i));
    }
    expect(phones.size).toBe(60_000);
    expect(pans.size).toBe(30_000);
    expect(aadhaars.size).toBe(30_000);
    for (const p of [...pans].slice(0, 500)) expect(isValidPAN(p), p).toBe(true);
    for (const a of [...aadhaars].slice(0, 500)) expect(isValidAadhaar(a), a).toBe(true);
  });
});

describe("scale seed money (production engines)", () => {
  it("raises exactly the demands evaluateDues finds due, stamped at the instant the live path raises them", () => {
    const b = booking(4);
    const demands = planDemands(new Rng(1), b);
    const due = evaluateDues({
      booking: {
        bookingDate: b.bookingDate,
        cashAgreedPaise: b.cashAgreedPaise,
        accountAgreedPaise: b.accountAgreedPaise,
        planSnapshot: {
          installments: PLAN.installments.map((i) => ({
            seq: i.seq,
            name: i.name,
            percent: i.percent,
            triggerType: i.trigger_type,
            triggerDays: i.trigger_days ?? null,
            triggerStageId: i.trigger_stage_id ?? null,
            triggerStageName: i.trigger_stage_name ?? null,
            triggerDate: null,
            dueDays: i.due_days,
          })),
        },
      },
      towerStages: b.towerStages,
      existingDemands: [],
      today: TODAY,
      defaultDueDays: 15,
    });
    expect(demands.map((d) => [d.seq, d.cashPaise, d.accountPaise, d.dueDate]).sort()).toEqual(
      due.map((d) => [d.seq, d.cashPaise, d.accountPaise, d.dueDate]).sort(),
    );
    // stages completed before the booking are caught up by the booking itself, later ones when the stage completes
    const onBooking = demands.find((d) => d.seq === 1)!;
    expect(onBooking.postedAt.getTime()).toBeGreaterThan(b.createdAt.getTime());
    const excavation = demands.find((d) => d.seq === 3)!;
    expect(excavation.raisedOn).toBe(b.bookingDate);
    const slab = demands.find((d) => d.seq === 6)!;
    expect(slab.raisedOn).toBe(slab.demandDate);
    expect(slab.postedAt.getTime()).toBeGreaterThan(b.stageCompletedAt.get(STAGES[3]!.stageId)!.getTime());
    expect([...demands].sort((x, y) => x.postedAt.getTime() - y.postedAt.getTime())).toEqual(demands);
  });

  it("never pays a bucket more than it raised, never before the booking or after today, and books it with deriveLedger", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const b = booking(seed % 7, addDays("2024-11-01", seed * 9));
      const rng = new Rng(seed);
      const demands = planDemands(rng, b);
      demands.forEach((d, i) => (d.demandNumber = `DM-T/${i + 1}`));
      const payments = planPayments(rng, b, demands, MODES);
      payments.forEach((p, i) => (p.receiptNumber = `RC-T/${i + 1}`));
      for (const bucket of ["CASH", "ACCOUNT"] as const) {
        const raised = demands.reduce((s, d) => s + (bucket === "CASH" ? d.cashPaise : d.accountPaise), 0);
        const paid = payments
          .filter((p) => p.bucket === bucket && p.status !== "BOUNCED")
          .reduce((s, p) => s + p.amountPaise, 0);
        expect(paid, `${seed} ${bucket}`).toBeLessThanOrEqual(raised);
      }
      for (const p of payments) {
        expect(p.paymentDate >= b.bookingDate && p.paymentDate <= TODAY).toBe(true);
        expect(p.postedAt.getTime()).toBeLessThanOrEqual(b.now.getTime());
        if (p.status === "CLEARED") expect(p.clearedAt).not.toBeNull();
      }
      const books = bookBooks(b, demands, payments);
      const cleared = payments.filter((p) => p.status === "CLEARED");
      const reference = deriveLedger(
        [
          ...demands.map((d) => ({
            kind: "DEMAND" as const,
            at: d.postedAt.toISOString(),
            refId: d.id,
            cashPaise: d.cashPaise,
            accountPaise: d.accountPaise,
          })),
          ...cleared.map((p) => ({
            kind: "PAYMENT" as const,
            at: p.clearedAt!.toISOString(),
            entryDate: p.paymentDate,
            refId: p.id,
            bucket: p.bucket,
            amountPaise: p.amountPaise,
          })),
        ],
        emptyLedgerSummary({ cashAgreedPaise: b.cashAgreedPaise, accountAgreedPaise: b.accountAgreedPaise }),
      );
      expect(books.rows.length).toBe(demands.length + cleared.length);
      expect(books.summary.totalDuePaise).toBe(reference.summary.totalDuePaise);
      expect(books.summary.cashPaidPaise).toBe(
        cleared.filter((p) => p.bucket === "CASH").reduce((s, p) => s + p.amountPaise, 0),
      );
      expect(books.rows.map((r) => r.refId)).toEqual(reference.rows.map((r) => r.refId));
      expect(books.pendingChequesPaise).toBe(
        payments.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amountPaise, 0),
      );
      expect(books.raisedPercent).toBeCloseTo(
        demands.reduce((s, d) => s + d.percent, 0),
        2,
      );
      const applied = books.demandStatus.reduce((s, d) => s + d.paidPaise, 0);
      expect(applied).toBeLessThanOrEqual(books.summary.cashPaidPaise + books.summary.accountPaidPaise);
    }
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const rng = new Rng(99);
      const b = booking(5);
      const d = planDemands(rng, b);
      return { d, p: planPayments(rng, b, d, MODES) };
    };
    expect(run()).toEqual(run());
  });
});
