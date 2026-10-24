import { describe, expect, it } from "vitest";
import {
  evaluateDues,
  hasDemandFor,
  installmentAmounts,
  schedulePreview,
  triggerDate,
  triggerLabel,
  type DuesBooking,
  type PlanSnapshotInstallment,
  type TowerStage,
} from "../src/index.js";
import { randInt, randomPercentBps, rng } from "./helpers.js";

const installments: PlanSnapshotInstallment[] = [
  { seq: 1, name: "On Booking", percent: 10, triggerType: "ON_BOOKING", dueDays: 7 },
  { seq: 2, name: "30 days", percent: 15, triggerType: "DAYS_AFTER_BOOKING", triggerDays: 30, dueDays: 10 },
  { seq: 3, name: "Plinth", percent: 25, triggerType: "ON_STAGE", triggerStageId: "plinth", triggerStageName: "Plinth" },
  { seq: 4, name: "Slab 1", percent: 20, triggerType: "ON_STAGE", triggerStageId: "slab1", triggerStageName: "1st Slab" },
  { seq: 5, name: "Fixed", percent: 10, triggerType: "ON_DATE", triggerDate: "2026-12-01" },
  { seq: 6, name: "Possession", percent: 20, triggerType: "ON_POSSESSION", dueDays: 30 },
];

const stages: TowerStage[] = [
  { stageId: "exc", name: "Excavation", isPossession: false, status: "COMPLETED", completedOn: "2026-01-10" },
  { stageId: "plinth", name: "Plinth", isPossession: false, status: "COMPLETED", completedOn: "2026-03-15" },
  { stageId: "slab1", name: "1st Slab", isPossession: false, status: "IN_PROGRESS", completedOn: null },
  { stageId: "poss", name: "Possession", isPossession: true, status: "PENDING", completedOn: null },
];

const booking: DuesBooking = {
  bookingDate: "2026-02-01",
  cashAgreedPaise: 6_000_000_00,
  accountAgreedPaise: 4_000_000_00,
  planSnapshot: { installments },
};

describe("triggerDate / triggerLabel", () => {
  it("resolves each trigger type", () => {
    expect(triggerDate(installments[0] as PlanSnapshotInstallment, "2026-02-01", stages)).toBe("2026-02-01");
    expect(triggerDate(installments[1] as PlanSnapshotInstallment, "2026-02-01", stages)).toBe("2026-03-03");
    expect(triggerDate(installments[2] as PlanSnapshotInstallment, "2026-02-01", stages)).toBe("2026-03-15");
    expect(triggerDate(installments[3] as PlanSnapshotInstallment, "2026-02-01", stages)).toBe(null);
    expect(triggerDate(installments[4] as PlanSnapshotInstallment, "2026-02-01", stages)).toBe("2026-12-01");
    expect(triggerDate(installments[5] as PlanSnapshotInstallment, "2026-02-01", stages)).toBe(null);
    const done = stages.map((s) => (s.isPossession ? { ...s, status: "COMPLETED" as const, completedOn: "2027-06-30" } : s));
    expect(triggerDate(installments[5] as PlanSnapshotInstallment, "2026-02-01", done)).toBe("2027-06-30");
    expect(() => triggerDate(installments[0] as PlanSnapshotInstallment, "bad", stages)).toThrow();
  });
  it("labels", () => {
    expect(triggerLabel(installments[0] as PlanSnapshotInstallment)).toBe("On booking");
    expect(triggerLabel(installments[1] as PlanSnapshotInstallment)).toBe("30 days after booking");
    expect(triggerLabel(installments[2] as PlanSnapshotInstallment)).toBe("On stage: Plinth");
    expect(triggerLabel(installments[3] as PlanSnapshotInstallment, "First Slab")).toBe("On stage: First Slab");
    expect(triggerLabel(installments[4] as PlanSnapshotInstallment)).toBe("On 1 Dec 2026");
    expect(triggerLabel(installments[5] as PlanSnapshotInstallment)).toBe("On possession");
  });
});

describe("installmentAmounts (telescoping)", () => {
  it("matches the worked example increments", () => {
    const plan = [10, 5, 10, 5, 10, 10, 10, 15, 10, 15].map((p, i) => ({ seq: i + 1, percent: p }));
    const amounts = installmentAmounts(6_000_000_00, 4_000_000_00, plan);
    expect(amounts.map((a) => a.cashPaise)).toEqual([6, 3, 6, 3, 6, 6, 6, 9, 6, 9].map((l) => l * 100_000_00));
    expect(amounts.map((a) => a.accountPaise)).toEqual([4, 2, 4, 2, 4, 4, 4, 6, 4, 6].map((l) => l * 100_000_00));
    expect(amounts.map((a) => a.cumulativeBp)).toEqual([1000, 1500, 2500, 3000, 4000, 5000, 6000, 7500, 8500, 10000]);
  });
  it("sums exactly to the agreed amounts for awkward values", () => {
    const plan = [{ seq: 1, percent: "33.33" }, { seq: 2, percent: "33.33" }, { seq: 3, percent: "33.34" }];
    const amounts = installmentAmounts(1_000_001, 999_999, plan);
    expect(amounts.reduce((s, a) => s + a.cashPaise, 0)).toBe(1_000_001);
    expect(amounts.reduce((s, a) => s + a.accountPaise, 0)).toBe(999_999);
    expect(amounts.map((a) => a.cashPaise)).toEqual([333_300, 333_301, 333_400]);
  });
  it("property: random splits and percent lists always telescope to the agreed total", () => {
    const next = rng(42);
    for (let i = 0; i < 300; i += 1) {
      const count = randInt(next, 1, 12);
      const bps = randomPercentBps(next, count);
      const plan = bps.map((bp, index) => ({ seq: index + 1, percent: `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}` }));
      const total = randInt(next, 1, 2_000_000_000_00);
      const cash = randInt(next, 0, total);
      const account = total - cash;
      const amounts = installmentAmounts(cash, account, plan);
      expect(amounts.reduce((s, a) => s + a.cashPaise, 0)).toBe(cash);
      expect(amounts.reduce((s, a) => s + a.accountPaise, 0)).toBe(account);
      expect(amounts.at(-1)?.cumulativeBp).toBe(10000);
      for (const a of amounts) {
        expect(a.cashPaise).toBeGreaterThanOrEqual(0);
        expect(a.accountPaise).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("evaluateDues", () => {
  it("raises satisfied, un-demanded installments with labels, dates and amounts", () => {
    const dues = evaluateDues({ booking, towerStages: stages, existingDemands: [], today: "2026-04-01" });
    expect(dues.map((d) => d.seq)).toEqual([1, 2, 3]);
    expect(dues[0]).toMatchObject({
      seq: 1,
      name: "On Booking",
      triggerType: "ON_BOOKING",
      triggerLabel: "On booking",
      triggerDate: "2026-02-01",
      dueDate: "2026-02-08",
      percent: "10.00",
      cumulativePercent: "10.00",
      cashPaise: 600_000_00,
      accountPaise: 400_000_00,
      totalPaise: 1_000_000_00,
    });
    expect(dues[1]).toMatchObject({ triggerDate: "2026-03-03", dueDate: "2026-03-13", cashPaise: 900_000_00, accountPaise: 600_000_00 });
    expect(dues[2]).toMatchObject({
      triggerLabel: "On stage: Plinth",
      triggerStageId: "plinth",
      triggerDate: "2026-03-15",
      dueDate: "2026-03-30",
      cumulativePercent: "50.00",
    });
  });
  it("respects today for time triggers and the default due days", () => {
    const dues = evaluateDues({ booking, towerStages: stages, existingDemands: [], today: "2026-03-02", defaultDueDays: 5 });
    expect(dues.map((d) => d.seq)).toEqual([1]);
    expect(evaluateDues({ booking, towerStages: stages, existingDemands: [], today: "2026-03-03" }).map((d) => d.seq)).toEqual([1, 2]);
    const dec = evaluateDues({ booking, towerStages: stages, existingDemands: [], today: "2026-12-01", defaultDueDays: 5 });
    expect(dec.map((d) => d.seq)).toEqual([1, 2, 3, 5]);
    expect(dec[3]?.dueDate).toBe("2026-12-06");
    expect(dec[3]?.triggerLabel).toBe("On 1 Dec 2026");
  });
  it("is idempotent by seq or normalised name and ignores VOID demands", () => {
    const existing = [
      { installmentSeq: 1, installmentName: "On Booking", status: "PAID" as const },
      { installmentSeq: 99, installmentName: "  30   DAYS ", status: "OPEN" as const },
      { installmentSeq: 3, installmentName: "Plinth", status: "VOID" as const },
    ];
    const dues = evaluateDues({ booking, towerStages: stages, existingDemands: existing, today: "2026-04-01" });
    expect(dues.map((d) => d.seq)).toEqual([3]);
    expect(hasDemandFor({ seq: 2, name: "30 days" }, existing)).toBe(true);
    expect(hasDemandFor({ seq: 3, name: "Plinth" }, existing)).toBe(false);
    const second = evaluateDues({
      booking,
      towerStages: stages,
      existingDemands: [...existing, ...dues.map((d) => ({ installmentSeq: d.seq, installmentName: d.name, status: "OPEN" as const }))],
      today: "2026-04-01",
    });
    expect(second).toEqual([]);
  });
  it("catch-up raises stage and possession installments once they complete", () => {
    const all = stages.map((s) => ({ ...s, status: "COMPLETED" as const, completedOn: s.completedOn ?? "2027-01-20" }));
    const dues = evaluateDues({ booking, towerStages: all, existingDemands: [], today: "2027-02-01" });
    expect(dues.map((d) => d.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dues[5]).toMatchObject({ triggerLabel: "On possession", triggerDate: "2027-01-20", dueDate: "2027-02-19", cumulativePercent: "100.00" });
    expect(dues.reduce((s, d) => s + d.cashPaise, 0)).toBe(booking.cashAgreedPaise);
    expect(dues.reduce((s, d) => s + d.accountPaise, 0)).toBe(booking.accountAgreedPaise);
  });
});

describe("schedulePreview", () => {
  it("gives every installment a status and expected dates", () => {
    const rows = schedulePreview({
      booking,
      towerStages: stages,
      existingDemands: [
        { installmentSeq: 1, installmentName: "On Booking", status: "PAID", dueDate: "2026-02-08", paidPaise: 1_000_000_00 },
        { installmentSeq: 2, installmentName: "30 days", status: "PARTIALLY_PAID", dueDate: "2026-03-13", paidPaise: 500_000_00 },
        { installmentSeq: 3, installmentName: "Plinth", status: "OPEN", dueDate: "2026-03-30" },
      ],
      today: "2026-04-01",
      expectedStageDates: { slab1: "2026-06-30" },
    });
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.status)).toEqual(["PAID", "PARTIALLY_PAID", "OVERDUE", "NOT_YET_DUE", "NOT_YET_DUE", "NOT_YET_DUE"]);
    expect(rows[0]?.paidPaise).toBe(1_000_000_00);
    expect(rows[1]?.paidPaise).toBe(500_000_00);
    expect(rows[2]?.expectedDueDate).toBe("2026-03-30");
    expect(rows[3]?.expectedTriggerDate).toBe("2026-06-30");
    expect(rows[3]?.expectedDueDate).toBe("2026-07-15");
    expect(rows[4]?.expectedTriggerDate).toBe("2026-12-01");
    expect(rows[5]?.expectedTriggerDate).toBe(null);
    expect(rows[5]?.expectedDueDate).toBe(null);
    expect(rows.map((r) => r.cumulativePercent)).toEqual(["10.00", "25.00", "50.00", "70.00", "80.00", "100.00"]);
    expect(rows.reduce((s, r) => s + r.totalPaise, 0)).toBe(10_000_000_00);
    expect(rows.filter((r) => r.demanded)).toHaveLength(3);
  });
  it("marks an open demand within its due date as RAISED and uses demand amounts when present", () => {
    const rows = schedulePreview({
      booking,
      towerStages: stages,
      existingDemands: [{ installmentSeq: 3, installmentName: "Plinth", status: "OPEN", dueDate: "2026-04-30", cashPaise: 1, accountPaise: 2 }],
      today: "2026-04-01",
    });
    expect(rows[2]?.status).toBe("RAISED");
    expect(rows[2]?.totalPaise).toBe(3);
    expect(rows[0]?.status).toBe("NOT_YET_DUE");
  });
});
