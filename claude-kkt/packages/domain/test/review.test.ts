/**
 * Adversarial review suite: every SPEC rule this package owns, checked row by row and at the edges.
 */
import { describe, expect, it } from "vitest";
import {
  MoneyError,
  ageingBucket,
  amountInWords,
  availability,
  bucketCapCheck,
  demandStageId,
  demandStatuses,
  deriveLedger,
  evaluateDues,
  financialYear,
  financialYearAt,
  formatINR,
  formatINRShort,
  formatNumber,
  generateFlats,
  icsForVisit,
  installmentAmounts,
  isValidAadhaar,
  missingStagesForTower,
  parseNumber,
  physicalFloors,
  plcAmount,
  priceFlat,
  schedulePreview,
  slotKey,
  sortLedgerEvents,
  toISTDateString,
  toPaise,
  unitFloors,
  validatePlan,
  verhoeffCheckDigit,
  verhoeffValidate,
  type Bucket,
  type DuesBooking,
  type LedgerEvent,
  type PlanInstallmentInput,
  type PlanSnapshotInstallment,
  type PlcRule,
  type PricingFlat,
  type TowerStage,
  type VisitSettings,
} from "../src/index.js";

const L = (lakh: number): number => lakh * 100_000 * 100;
const CRORE_PAISE = 1_000_000_000;

describe("SPEC §11 worked example, every one of the 20 rows", () => {
  const cumulative = [10, 15, 25, 30, 40, 50, 60, 75, 85, 100];
  const payments: { bucket: Bucket; lakh: number }[] = [
    { bucket: "ACCOUNT", lakh: 4 },
    { bucket: "CASH", lakh: 8 },
    { bucket: "ACCOUNT", lakh: 12 },
    { bucket: "CASH", lakh: 5 },
    { bucket: "CASH", lakh: 10 },
    { bucket: "ACCOUNT", lakh: 15 },
    { bucket: "CASH", lakh: 7 },
    { bucket: "CASH", lakh: 20 },
    { bucket: "ACCOUNT", lakh: 9 },
    { bucket: "CASH", lakh: 10 },
  ];
  // [cash due, account due, total due] after each payment, in lakh (SPEC table)
  const afterPayment: [number, number, number][] = [
    [6, 0, 6],
    [1, 2, 3],
    [7, -6, 1],
    [5, -4, 1],
    [1, 0, 1],
    [7, -11, -4],
    [6, -7, -1],
    [-5, -1, -6],
    [1, -6, -5],
    [0, 0, 0],
  ];

  it("demands come from the telescoping engine and the ledger reproduces the table to the paise", () => {
    const plan = cumulative.map((cum, i) => ({ seq: i + 1, percent: cum - (cumulative[i - 1] ?? 0) }));
    const amounts = installmentAmounts(L(60), L(40), plan);
    const events: LedgerEvent[] = [];
    amounts.forEach((amount, i) => {
      const at = `2026-${String(i + 1).padStart(2, "0")}-01T05:00:00Z`;
      events.push({
        kind: "DEMAND",
        at,
        label: `Installment ${i + 1}`,
        cashPaise: amount.cashPaise,
        accountPaise: amount.accountPaise,
        refNumber: `DM-${i + 1}`,
      });
      const payment = payments[i] as { bucket: Bucket; lakh: number };
      events.push({
        kind: "PAYMENT",
        at,
        bucket: payment.bucket,
        amountPaise: L(payment.lakh),
        refNumber: `RC-${i + 1}`,
      });
    });
    const { rows, summary } = deriveLedger(events);
    expect(rows).toHaveLength(20);
    let cashPaid = 0;
    let accountPaid = 0;
    let cashRaised = 0;
    let accountRaised = 0;
    for (let i = 0; i < 10; i += 1) {
      const demandRow = rows[2 * i];
      const paymentRow = rows[2 * i + 1];
      const pct = cumulative[i]! - (cumulative[i - 1] ?? 0);
      cashRaised += (L(60) * pct) / 100;
      accountRaised += (L(40) * pct) / 100;
      // Demand row: raised moves, paid does not.
      expect(demandRow, `demand row ${i + 1}`).toMatchObject({
        seq: 2 * i + 1,
        event: "DEMAND",
        bucket: null,
        amountPaise: (L(100) * pct) / 100,
        cashOrderRaisedPaise: cashRaised,
        accountOrderRaisedPaise: accountRaised,
        cashPaidCumPaise: cashPaid,
        accountPaidCumPaise: accountPaid,
        cashDuePaise: cashRaised - cashPaid,
        accountDuePaise: accountRaised - accountPaid,
        totalDuePaise: cashRaised + accountRaised - cashPaid - accountPaid,
        refNumber: `DM-${i + 1}`,
        entryDate: `2026-${String(i + 1).padStart(2, "0")}-01`,
      });
      const payment = payments[i] as { bucket: Bucket; lakh: number };
      if (payment.bucket === "CASH") {
        cashPaid += L(payment.lakh);
      } else {
        accountPaid += L(payment.lakh);
      }
      const [cashDue, accountDue, totalDue] = afterPayment[i] as [number, number, number];
      expect(paymentRow, `payment row ${i + 1}`).toMatchObject({
        seq: 2 * i + 2,
        event: "PAYMENT",
        bucket: payment.bucket,
        amountPaise: L(payment.lakh),
        cashPaidCumPaise: cashPaid,
        accountPaidCumPaise: accountPaid,
        cashDuePaise: L(cashDue),
        accountDuePaise: L(accountDue),
        totalDuePaise: L(totalDue),
        refNumber: `RC-${i + 1}`,
      });
    }
    expect(summary).toMatchObject({
      cashOrderRaisedPaise: L(60),
      accountOrderRaisedPaise: L(40),
      cashPaidPaise: L(60),
      accountPaidPaise: L(40),
      totalDuePaise: 0,
      isClosed: false,
    });
  });

  it("the advance rows are negative dues, and a payment beyond raised but within agreed passes the cap", () => {
    // Row #3: account raised 10 L, paid 16 L → advance 6 L; cap is agreed 40 L so it is fine.
    expect(
      bucketCapCheck({ bucket: "ACCOUNT", bucketAgreedPaise: L(40), bucketPaidPaise: L(4), amountPaise: L(12) }),
    ).toEqual({ ok: true });
    // Row #8 would push cash to 50 L paid; still within 60 L agreed.
    expect(
      bucketCapCheck({ bucket: "CASH", bucketAgreedPaise: L(60), bucketPaidPaise: L(30), amountPaise: L(20) }),
    ).toEqual({ ok: true });
    // One paisa beyond agreed is the only block.
    const blocked = bucketCapCheck({
      bucket: "CASH",
      bucketAgreedPaise: L(60),
      bucketPaidPaise: L(50),
      amountPaise: L(10) + 1,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.details.headroomPaise).toBe(L(10));
      expect(blocked.message).toBe(
        "Cash agreed ₹60,00,000; already received ₹50,00,000; cannot accept ₹10,00,000.01 – revise the agreement first",
      );
    }
    // Headroom never goes negative even when paid already exceeds agreed (e.g. after a downward revision was refused).
    const over = bucketCapCheck({
      bucket: "ACCOUNT",
      bucketAgreedPaise: L(10),
      bucketPaidPaise: L(12),
      amountPaise: 1,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.details.headroomPaise).toBe(0);
    }
    // Zero-amount is accepted by the cap (amount > 0 is enforced by the ledger/API, not the cap).
    expect(
      bucketCapCheck({ bucket: "ACCOUNT", bucketAgreedPaise: L(10), bucketPaidPaise: L(10), amountPaise: 0 }),
    ).toEqual({ ok: true });
  });

  it("demand statuses derived FIFO from the worked example after row #3 (account advance)", () => {
    const demands = [
      { id: "d1", cashPaise: L(6), accountPaise: L(4) },
      { id: "d2", cashPaise: L(3), accountPaise: L(2) },
      { id: "d3", cashPaise: L(6), accountPaise: L(4) },
    ];
    const statuses = demandStatuses(demands, L(8), L(16));
    expect(statuses.map((s) => s.status)).toEqual(["PAID", "PARTIALLY_PAID", "PARTIALLY_PAID"]);
    expect(statuses[1]).toMatchObject({ cashPaidPaise: L(2), accountPaidPaise: L(2) });
    expect(statuses[2]).toMatchObject({ cashPaidPaise: 0, accountPaidPaise: L(4) });
    // Negative paid (over-reversed) never allocates.
    expect(demandStatuses(demands, -1, -1).every((s) => s.status === "OPEN")).toBe(true);
  });
});

describe("SPEC §10 telescoping rounding", () => {
  it("33.33 / 33.33 / 33.34 on ₹1 Cr split 60/40, to the paise", () => {
    const plan = [
      { seq: 1, percent: "33.33" },
      { seq: 2, percent: "33.33" },
      { seq: 3, percent: "33.34" },
    ];
    const amounts = installmentAmounts(L(60), L(40), plan);
    expect(amounts.map((a) => a.cashPaise)).toEqual([199_980_000, 199_980_000, 200_040_000]);
    expect(amounts.map((a) => a.accountPaise)).toEqual([133_320_000, 133_320_000, 133_360_000]);
    expect(amounts.reduce((s, a) => s + a.cashPaise + a.accountPaise, 0)).toBe(CRORE_PAISE);
    expect(amounts.map((a) => a.cumulativeBp)).toEqual([3333, 6666, 10000]);
  });
  it("odd paise agreed values still sum exactly and never produce a negative installment", () => {
    const odd = [
      { seq: 1, percent: "33.33" },
      { seq: 2, percent: "33.33" },
      { seq: 3, percent: "33.34" },
    ];
    for (const cash of [1, 2, 3, 7, 99, 101, 1_000_000_001, 333_333_333_33, 999_999_999_99]) {
      const amounts = installmentAmounts(cash, cash + 1, odd);
      expect(amounts.reduce((s, a) => s + a.cashPaise, 0)).toBe(cash);
      expect(amounts.reduce((s, a) => s + a.accountPaise, 0)).toBe(cash + 1);
      expect(amounts.every((a) => a.cashPaise >= 0 && a.accountPaise >= 0)).toBe(true);
    }
    // 1 paisa agreed with 10 × 10 %: nine zeros and a single paisa in whichever installment crosses 0.5.
    const tenths = Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, percent: 10 }));
    const tiny = installmentAmounts(1, 0, tenths);
    expect(tiny.reduce((s, a) => s + a.cashPaise, 0)).toBe(1);
    expect(tiny.filter((a) => a.cashPaise === 1)).toHaveLength(1);
    expect(tiny[4]?.cashPaise).toBe(1); // 50 % of 1 paisa rounds half-up to 1
  });
  it("installments are processed in sequence order regardless of input order", () => {
    const amounts = installmentAmounts(L(60), L(40), [
      { seq: 3, percent: 50 },
      { seq: 1, percent: 10 },
      { seq: 2, percent: 40 },
    ]);
    expect(amounts.map((a) => a.seq)).toEqual([1, 2, 3]);
    expect(amounts.map((a) => a.cashPaise)).toEqual([L(6), L(24), L(30)]);
  });
  it("rejects negative or fractional agreed amounts and >2-decimal percents", () => {
    expect(() => installmentAmounts(-1, 0, [{ seq: 1, percent: 100 }])).toThrow(MoneyError);
    expect(() => installmentAmounts(0, -1, [{ seq: 1, percent: 100 }])).toThrow(MoneyError);
    expect(() => installmentAmounts(1.5, 0, [{ seq: 1, percent: 100 }])).toThrow(MoneyError);
    expect(() => installmentAmounts(100, 0, [{ seq: 1, percent: "33.333" }])).toThrow(MoneyError);
    expect(installmentAmounts(0, 0, [{ seq: 1, percent: 100 }])[0]).toMatchObject({ cashPaise: 0, accountPaise: 0 });
  });
});

describe("SPEC §10 trigger evaluation edge cases", () => {
  const stages: TowerStage[] = [
    { stageId: "plinth", name: "Plinth", isPossession: false, status: "COMPLETED", completedOn: "2026-03-15" },
    { stageId: "slab1", name: "1st Slab", isPossession: false, status: "COMPLETED", completedOn: null },
    { stageId: "poss", name: "Possession", isPossession: true, status: "COMPLETED", completedOn: "2027-06-30" },
  ];
  const installments: PlanSnapshotInstallment[] = [
    { seq: 1, name: "Booking", percent: 10, triggerType: "ON_BOOKING" },
    { seq: 2, name: "Plinth", percent: 30, triggerType: "ON_STAGE", triggerStageId: "plinth" },
    { seq: 3, name: "Slab", percent: 30, triggerType: "ON_STAGE", triggerStageId: "slab1" },
    { seq: 4, name: "Possession", percent: 30, triggerType: "ON_POSSESSION" },
  ];
  const booking: DuesBooking = {
    bookingDate: "2026-02-01",
    cashAgreedPaise: L(60),
    accountAgreedPaise: L(40),
    planSnapshot: { installments },
  };

  it("attributes an ON_POSSESSION demand to the tower's possession stage so undo can find it", () => {
    const dues = evaluateDues({ booking, towerStages: stages, existingDemands: [], today: "2027-07-01" });
    const possession = dues.find((d) => d.seq === 4);
    expect(possession).toMatchObject({
      triggerStageId: "poss",
      triggerDate: "2027-06-30",
      triggerLabel: "On possession",
    });
    expect(demandStageId(installments[3] as PlanSnapshotInstallment, stages)).toBe("poss");
    expect(demandStageId(installments[1] as PlanSnapshotInstallment, stages)).toBe("plinth");
    expect(demandStageId(installments[0] as PlanSnapshotInstallment, stages)).toBe(null);
    expect(demandStageId({ triggerType: "ON_POSSESSION", triggerStageId: null }, [])).toBe(null);
  });
  it("a COMPLETED stage without a completion date is not treated as satisfied (no silent demand with a bogus date)", () => {
    const dues = evaluateDues({ booking, towerStages: stages, existingDemands: [], today: "2027-07-01" });
    expect(dues.map((d) => d.seq)).toEqual([1, 2, 4]);
  });
  it("ON_BOOKING is satisfied at the booking date even when today is earlier (SPEC: 'yes, at booking date')", () => {
    const dues = evaluateDues({ booking, towerStages: [], existingDemands: [], today: "2026-01-01" });
    expect(dues.map((d) => d.seq)).toEqual([1]);
    expect(dues[0]?.triggerDate).toBe("2026-02-01");
  });
  it("stage installments are skipped when the tower has no such stage, ON_STAGE with null stage id never fires", () => {
    const weird: PlanSnapshotInstallment[] = [
      { seq: 1, name: "x", percent: 100, triggerType: "ON_STAGE", triggerStageId: null },
    ];
    expect(
      evaluateDues({
        booking: { ...booking, planSnapshot: { installments: weird } },
        towerStages: stages,
        existingDemands: [],
        today: "2030-01-01",
      }),
    ).toEqual([]);
  });
  it("schedule preview forecasts the possession stage date through the possession stage id", () => {
    const pending = stages.map((s) => ({ ...s, status: "PENDING" as const, completedOn: null }));
    const rows = schedulePreview({
      booking,
      towerStages: pending,
      existingDemands: [],
      today: "2026-02-02",
      expectedStageDates: { poss: "2028-01-01", plinth: "2026-05-01" },
    });
    expect(rows[3]).toMatchObject({
      status: "NOT_YET_DUE",
      expectedTriggerDate: "2028-01-01",
      expectedDueDate: "2028-01-16",
    });
    expect(rows[1]).toMatchObject({ expectedTriggerDate: "2026-05-01", expectedDueDate: "2026-05-16" });
    expect(rows[2]?.expectedTriggerDate).toBe(null);
    // A demand that is OPEN past its due date is OVERDUE; on its due date it is still RAISED.
    const withDemand = [
      { installmentSeq: 1, installmentName: "Booking", status: "OPEN" as const, dueDate: "2026-02-16" },
    ];
    expect(
      schedulePreview({ booking, towerStages: pending, existingDemands: withDemand, today: "2026-02-16" })[0]?.status,
    ).toBe("RAISED");
    expect(
      schedulePreview({ booking, towerStages: pending, existingDemands: withDemand, today: "2026-02-17" })[0]?.status,
    ).toBe("OVERDUE");
  });
  it("catch-up on a tower past several stages raises them all once, and a second run raises nothing", () => {
    const done = stages.map((s) => ({ ...s, completedOn: s.completedOn ?? "2026-09-01" }));
    const first = evaluateDues({ booking, towerStages: done, existingDemands: [], today: "2027-07-01" });
    expect(first.map((d) => d.seq)).toEqual([1, 2, 3, 4]);
    expect(first.reduce((s, d) => s + d.totalPaise, 0)).toBe(L(100));
    const existing = first.map((d) => ({ installmentSeq: d.seq, installmentName: d.name, status: "OPEN" as const }));
    expect(evaluateDues({ booking, towerStages: done, existingDemands: existing, today: "2027-07-01" })).toEqual([]);
    // VOIDed demands (after a stage undo) are raised again once the stage completes again.
    const voided = existing.map((d) => (d.installmentSeq === 3 ? { ...d, status: "VOID" as const } : d));
    expect(
      evaluateDues({ booking, towerStages: done, existingDemands: voided, today: "2027-07-01" }).map((d) => d.seq),
    ).toEqual([3]);
  });
});

describe("SPEC §8 plan validation", () => {
  const good: PlanInstallmentInput[] = [
    { seq: 1, name: "On booking", percent: 10, triggerType: "ON_BOOKING", dueDays: 7 },
    { seq: 2, name: "30 days", percent: 85, triggerType: "DAYS_AFTER_BOOKING", triggerDays: 30 },
    { seq: 3, name: "Possession", percent: 5, triggerType: "ON_POSSESSION" },
  ];
  it("Down Payment 10:85:5 is valid; 99.99 and 100.01 are not", () => {
    expect(validatePlan(good).ok).toBe(true);
    const short = good.map((i) => (i.seq === 2 ? { ...i, percent: "84.99" } : i));
    expect(validatePlan(short).errors.map((e) => e.code)).toEqual(["PERCENT_SUM"]);
    const long = good.map((i) => (i.seq === 2 ? { ...i, percent: 85.01 } : i));
    expect(validatePlan(long).errors[0]?.details).toEqual({ totalBasisPoints: 10001, totalPercent: "100.01" });
  });
  it("duplicate names (case/space-insensitive) are rejected because dues de-duplicate by name", () => {
    const dup = good.map((i) => (i.seq === 3 ? { ...i, name: "  ON   BOOKING " } : i));
    const result = validatePlan(dup);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["DUPLICATE_NAME"]);
    expect(result.errors[0]?.seq).toBe(3);
  });
  it("referenced stages must exist when the caller supplies the master stage ids", () => {
    const clp: PlanInstallmentInput[] = [
      { seq: 1, name: "Booking", percent: 10, triggerType: "ON_BOOKING" },
      { seq: 2, name: "Plinth", percent: 40, triggerType: "ON_STAGE", triggerStageId: "plinth" },
      { seq: 3, name: "Roof", percent: 50, triggerType: "ON_STAGE", triggerStageId: "ghost" },
    ];
    expect(validatePlan(clp).ok).toBe(true);
    const checked = validatePlan(clp, { knownStageIds: ["plinth", "slab1"] });
    expect(checked.ok).toBe(false);
    expect(checked.errors).toEqual([
      {
        code: "UNKNOWN_STAGE",
        message: "Installment 3: construction stage ghost does not exist",
        seq: 3,
        details: { stageId: "ghost" },
      },
    ]);
    expect(missingStagesForTower(clp, ["plinth"])).toEqual(["ghost"]);
    expect(missingStagesForTower(clp, ["plinth", "ghost"])).toEqual([]);
  });
  it("Flexi 10:40:50 spread across five stages (10 % each) sums exactly", () => {
    const flexi: PlanInstallmentInput[] = [
      { seq: 1, name: "Booking", percent: 10, triggerType: "ON_BOOKING" },
      { seq: 2, name: "60 days", percent: 40, triggerType: "DAYS_AFTER_BOOKING", triggerDays: 60 },
      ...["s10", "s11", "s12", "s13", "s14"].map((id, i) => ({
        seq: 3 + i,
        name: `Stage ${id}`,
        percent: 10,
        triggerType: "ON_STAGE" as const,
        triggerStageId: id,
      })),
    ];
    expect(validatePlan(flexi)).toMatchObject({ ok: true, totalBasisPoints: 10000 });
    const amounts = installmentAmounts(L(60), L(40), flexi);
    expect(amounts.map((a) => a.cashPaise)).toEqual([L(6), L(24), L(6), L(6), L(6), L(6), L(6)]);
  });
});

describe("SPEC §5 pricing", () => {
  const flat: PricingFlat = {
    floor: 1,
    floorStart: 1,
    superBuiltupSqft: 1250,
    isCorner: false,
    facing: "EAST",
    flatTypeId: "ft",
  };
  it("FLOOR_RISE is never negative: negative value, or floor below floorStart, yields zero", () => {
    const rise: PlcRule = {
      plcTypeId: "fr",
      name: "Floor rise",
      calcMode: "FLOOR_RISE",
      value: 2500,
      appliesTo: "ALL",
    };
    expect(plcAmount(rise, { ...flat, floor: 1 }, 0)).toBe(0);
    expect(plcAmount(rise, { ...flat, floor: 5 }, 0)).toBe(2500 * 4 * 1250);
    expect(plcAmount(rise, { ...flat, floor: 0, floorStart: 1 }, 0)).toBe(0);
    expect(plcAmount({ ...rise, value: -2500 }, { ...flat, floor: 5 }, 0)).toBe(0);
    expect(plcAmount(rise, { ...flat, floor: 3, floorStart: 0 }, 0)).toBe(2500 * 3 * 1250);
    // Zero-amount PLC lines are not written into the breakup.
    const result = priceFlat({
      flat: { ...flat, floor: 1 },
      rateCard: { rates: [{ flatTypeId: "ft", ratePerSqftPaise: 560_000, lumpSumPaise: null }], plcRules: [rise] },
    });
    expect(result.breakup).toHaveLength(1);
    expect(result.totalPaise).toBe(560_000 * 1250);
  });
  it("PERCENT PLC uses the base price, half-up, with fractional areas", () => {
    const vastu: PlcRule = {
      plcTypeId: "v",
      name: "Vastu",
      calcMode: "PERCENT",
      value: 1.5,
      appliesTo: "FACING_IN",
      facings: ["east"],
    };
    const result = priceFlat({
      flat: { ...flat, superBuiltupSqft: 1250.33 },
      rateCard: { rates: [{ flatTypeId: "ft", ratePerSqftPaise: 560_000, lumpSumPaise: null }], plcRules: [vastu] },
    });
    const base = (560_000 * 125_033) / 100; // 700_184_800
    expect(result.breakup[0]?.amountPaise).toBe(base);
    expect(result.breakup[1]).toEqual({ label: "Vastu", amountPaise: Math.round((base * 150) / 10000) });
    expect(result.ratePerSqftPaise).toBe(560_000);
  });
  it("lump sum rate ignores area and reports an effective rate", () => {
    const result = priceFlat({
      flat,
      rateCard: { rates: [{ flatTypeId: "ft", ratePerSqftPaise: 999, lumpSumPaise: CRORE_PAISE }], plcRules: [] },
    });
    expect(result.totalPaise).toBe(CRORE_PAISE);
    expect(result.ratePerSqftPaise).toBe(800_000);
  });
});

describe("SPEC §4 flat generation count for Tower C (15 floors, skip 13, refuge 7)", () => {
  it("physical floors are 1..15 minus 13; unit floors also drop 7; 4 per floor → 52 flats", () => {
    const block = {
      code: "C",
      floors: 15,
      floorStart: 1,
      skipFloors: [13],
      refugeFloors: [7],
      podiumFloors: [],
      floorPlans: [{ fromFloor: 1, toFloor: 15, floorPlanTemplateId: "t" }],
      numberingPattern: "{block}-{floor}{pos2}",
    };
    expect(physicalFloors(block)).toHaveLength(14);
    expect(unitFloors(block)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15]);
    const ft = {
      id: "f",
      code: "F",
      name: "F",
      rooms: [{ roomTypeId: "r", roomTypeName: "Bedroom", label: "B", lengthFt: 1, widthFt: 1, sqft: 1 }],
      areas: [{ areaTypeId: "a", areaTypeCode: "SUPER_BUILT_UP", areaTypeName: "SBU", sqft: 1000 }],
      carpetSqft: 800,
      builtupSqft: 900,
      superBuiltupSqft: 1000,
      baseRatePerSqftPaise: 500_000,
      basePricePaise: null,
    };
    const template = {
      id: "t",
      flatsPerFloor: 4,
      positions: [1, 2, 3, 4].map((position) => ({ position, flatTypeId: "f" })),
    };
    const flats = generateFlats(block, [template], [ft], () => ({
      breakup: [],
      totalPaise: 1,
      ratePerSqftPaise: null,
    }));
    expect(flats).toHaveLength(52);
    expect(flats.map((f) => f.flatNumber)).toContain("C-1504");
    expect(flats.map((f) => f.flatNumber)).not.toContain("C-1301");
    expect(flats.map((f) => f.flatNumber)).not.toContain("C-701");
    expect(flats.map((f) => f.flatNumber)).not.toContain("C-1601");
    // Ground-floor start: 0..8 is nine physical floors, labelled G then 1..8.
    const ground = generateFlats(
      {
        ...block,
        floors: 8,
        floorStart: 0,
        skipFloors: [],
        refugeFloors: [],
        floorPlans: [{ fromFloor: 0, toFloor: 8, floorPlanTemplateId: "t" }],
      },
      [template],
      [ft],
      () => ({ breakup: [], totalPaise: 1, ratePerSqftPaise: null }),
    );
    expect(ground).toHaveLength(36);
    expect(ground[0]?.flatNumber).toBe("C-G01");
  });
});

describe("Verhoeff / Aadhaar", () => {
  it("rejects every single-digit mutation at every position for many numbers", () => {
    let seed = 987654321;
    for (let n = 0; n < 50; n += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const body = `${2 + (seed % 8)}${String(seed).padStart(10, "0").slice(0, 10)}`;
      const full = body + String(verhoeffCheckDigit(body));
      expect(full).toHaveLength(12);
      expect(isValidAadhaar(full)).toBe(true);
      for (let pos = 0; pos < 12; pos += 1) {
        const original = Number(full[pos]);
        for (let delta = 1; delta <= 9; delta += 1) {
          const altered = full.slice(0, pos) + String((original + delta) % 10) + full.slice(pos + 1);
          expect(verhoeffValidate(altered), `mutation at ${pos} of ${full}`).toBe(false);
        }
      }
      // Adjacent transpositions are caught too (the point of Verhoeff over Luhn).
      for (let pos = 0; pos < 11; pos += 1) {
        if (full[pos] !== full[pos + 1]) {
          const swapped = full.slice(0, pos) + full[pos + 1] + full[pos] + full.slice(pos + 2);
          expect(verhoeffValidate(swapped), `transposition at ${pos} of ${full}`).toBe(false);
        }
      }
    }
  });
  it("the formatted and unformatted forms agree and a leading 0/1 is rejected", () => {
    expect(isValidAadhaar("2341-2341-2346")).toBe(true);
    expect(isValidAadhaar("0341234123" + String(verhoeffCheckDigit("03412341230")))).toBe(false);
    expect(isValidAadhaar("")).toBe(false);
    expect(verhoeffValidate("")).toBe(false);
  });
});

describe("Money formatting", () => {
  it("amountInWords for ₹1,00,00,000 and neighbours", () => {
    expect(amountInWords(CRORE_PAISE)).toBe("Rupees One Crore Only");
    expect(amountInWords(CRORE_PAISE - 1)).toBe(
      "Rupees Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only",
    );
    expect(amountInWords(CRORE_PAISE + 100)).toBe("Rupees One Crore One Only");
    expect(amountInWords(toPaise("12,50,000"))).toBe("Rupees Twelve Lakh Fifty Thousand Only");
    expect(amountInWords(toPaise("1,00,000"))).toBe("Rupees One Lakh Only");
    expect(amountInWords(toPaise("10,00,000"))).toBe("Rupees Ten Lakh Only");
    expect(amountInWords(toPaise("1,00,00,00,000"))).toBe("Rupees One Hundred Crore Only");
    expect(amountInWords(toPaise("1,000.01"))).toBe("Rupees One Thousand and One Paise Only");
  });
  it("formatINR for 7-digit and 9-digit rupee values and the short forms", () => {
    expect(formatINR(toPaise("1234567"))).toBe("₹12,34,567");
    expect(formatINR(toPaise("123456789"))).toBe("₹12,34,56,789");
    expect(formatINR(toPaise("9999999"))).toBe("₹99,99,999");
    expect(formatINR(toPaise("100000000"))).toBe("₹10,00,00,000");
    expect(formatINR(toPaise("1234567.89"))).toBe("₹12,34,567.89");
    expect(formatINR(toPaise("-123456789"))).toBe("-₹12,34,56,789");
    expect(formatINRShort(toPaise("1234567"))).toBe("₹12.3 L");
    expect(formatINRShort(toPaise("123456789"))).toBe("₹12.3 Cr");
    expect(formatINRShort(toPaise("4500000"))).toBe("₹45 L");
    expect(formatINRShort(toPaise("12000000"))).toBe("₹1.2 Cr");
    expect(formatINRShort(toPaise("99999.49"))).toBe("₹99,999");
    expect(formatINRShort(toPaise("99999.50"))).toBe("₹1 L");
  });
});

describe("Financial year boundary in IST", () => {
  it("31 Mar belongs to the closing FY, 1 Apr opens the next, evaluated on the IST calendar date", () => {
    expect(financialYear("2026-03-31").label).toBe("2526");
    expect(financialYear("2026-04-01").label).toBe("2627");
    expect(financialYear("2026-03-31")).toMatchObject({
      start: "2025-04-01",
      end: "2026-03-31",
      startYear: 2025,
      endYear: 2026,
    });
    // 18:29:59Z on 31 Mar is 23:59:59 IST → still FY 25-26; one second later it is 1 Apr IST.
    expect(financialYearAt("2026-03-31T18:29:59Z").label).toBe("2526");
    expect(financialYearAt("2026-03-31T18:30:00Z").label).toBe("2627");
    expect(toISTDateString("2026-03-31T18:30:00Z")).toBe("2026-04-01");
    // A UTC-naive caller that passes a "+05:30" stamp gets the same answer.
    expect(financialYearAt("2026-04-01T00:00:00+05:30").label).toBe("2627");
    expect(financialYearAt("2026-03-31T23:59:59+05:30").label).toBe("2526");
    // 1 Jan 2100 IST sits in FY Apr 2099–Mar 2100 → "9900" (century roll-over keeps two digits each).
    expect(financialYearAt(new Date("2099-12-31T18:30:00Z")).label).toBe("9900");
    expect(financialYearAt(new Date("2100-04-01T00:00:00+05:30")).label).toBe("0001");
  });
  it("receipt numbers follow the configured pattern and parse back", () => {
    const fy = financialYear("2025-06-15");
    expect(formatNumber("SGB/", fy.label, 1)).toBe("SGB/2526/0001");
    expect(formatNumber("CUST-", fy.label, 12345)).toBe("CUST-2526/12345");
    expect(parseNumber("SGB/2526/0001")).toEqual({ prefix: "SGB/", fy: "2526", seq: 1 });
    expect(parseNumber("SGB-2526-0001", "{prefix}{fy}-{seq:4}")).toEqual({ prefix: "SGB-", fy: "2526", seq: 1 });
    expect(parseNumber("nonsense")).toBe(null);
  });
});

describe("Site visits", () => {
  const settings: VisitSettings = {
    enabled: true,
    visitDays: [1, 2, 3, 4, 5, 6],
    startTime: "10:00",
    endTime: "17:00",
    slotMinutes: 60,
    seatsPerSlot: 3,
    minLeadHours: 12,
    maxDaysAhead: 30,
    blackoutDates: ["2026-10-27", "2026-11-02"],
  };
  it("hides past slots relative to nowIST (lead hours cross midnight) and blackout dates", () => {
    // Monday 26 Oct 2026 23:00 IST = 17:30Z; 12 h lead → nothing before 11:00 on the 27th; the 27th is blackout anyway.
    const now = "2026-10-26T17:30:00Z";
    const days = availability({ settings, from: "2026-10-26", to: "2026-10-28", nowIST: now, bookedCounts: new Map() });
    expect(days.map((d) => d.date)).toEqual(["2026-10-28"]);
    expect(days[0]?.slots).toHaveLength(7);
    // Same instant written as +05:30 gives the same result.
    expect(
      availability({
        settings,
        from: "2026-10-26",
        to: "2026-10-28",
        nowIST: "2026-10-26T23:00:00+05:30",
        bookedCounts: new Map(),
      }),
    ).toEqual(days);
    // 2 h lead at 09:30 on a Wednesday: 10:00 and 11:00 slots are gone, 12:00 stays.
    const morning = availability({
      settings: { ...settings, minLeadHours: 2 },
      from: "2026-10-28",
      to: "2026-10-28",
      nowIST: "2026-10-28T09:30:00+05:30",
      bookedCounts: new Map(),
    });
    expect(morning[0]?.slots.map((s) => s.start)).toEqual(["12:00", "13:00", "14:00", "15:00", "16:00"]);
    // Exactly on the lead boundary the slot is kept (start ≥ now + lead).
    const exact = availability({
      settings: { ...settings, minLeadHours: 2 },
      from: "2026-10-28",
      to: "2026-10-28",
      nowIST: "2026-10-28T10:00:00+05:30",
      bookedCounts: new Map(),
    });
    expect(exact[0]?.slots[0]?.start).toBe("12:00");
    // Blackout on a Monday removes the whole day; a Sunday is never offered.
    const week = availability({ settings, from: "2026-11-01", to: "2026-11-03", nowIST: now, bookedCounts: new Map() });
    expect(week.map((d) => d.date)).toEqual(["2026-11-03"]);
  });
  it("the last seat shows 1 left and the next booking makes the slot disappear", () => {
    const now = "2026-10-26T17:30:00Z";
    const twoBooked = new Map([[slotKey("2026-10-28", "10:00"), 2]]);
    expect(
      availability({ settings, from: "2026-10-28", to: "2026-10-28", nowIST: now, bookedCounts: twoBooked })[0]
        ?.slots[0],
    ).toEqual({ start: "10:00", end: "11:00", available: 1 });
    const full = new Map([[slotKey("2026-10-28", "10:00"), 3]]);
    expect(
      availability({ settings, from: "2026-10-28", to: "2026-10-28", nowIST: now, bookedCounts: full })[0]?.slots[0]
        ?.start,
    ).toBe("11:00");
    // Requests outside the window return nothing; from > to is empty, not an error.
    expect(
      availability({ settings, from: "2026-12-01", to: "2026-12-31", nowIST: now, bookedCounts: new Map() }),
    ).toEqual([]);
    expect(
      availability({ settings, from: "2026-10-30", to: "2026-10-28", nowIST: now, bookedCounts: new Map() }),
    ).toEqual([]);
    expect(() =>
      availability({ settings, from: "2026-13-01", to: "2026-10-28", nowIST: now, bookedCounts: new Map() }),
    ).toThrow();
  });
  it("ICS has VTIMEZONE and VALARM, CRLF endings, and escapes ; , \\ and newlines", () => {
    const ics = icsForVisit({
      uid: "SV-2526/0007@kkt",
      summary: "Site visit; Ganesh Green Villas, Patna",
      description: "Line 1\nLine 2 with a backslash \\ and a comma, here",
      location: "Danapur; Patna",
      date: "2026-11-03",
      start: "15:00",
      end: "16:00",
      stamp: "2026-10-26T17:30:00Z",
    });
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Asia/Kolkata\r\n");
    expect(ics).toContain("TZOFFSETFROM:+0530\r\nTZOFFSETTO:+0530\r\nTZNAME:IST");
    expect(ics).toContain("DTSTART;TZID=Asia/Kolkata:20261103T150000\r\nDTEND;TZID=Asia/Kolkata:20261103T160000");
    expect(ics).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder: Site visit\\; Ganesh Green Villas\\, Patna\r\nTRIGGER:-PT1H\r\nEND:VALARM",
    );
    expect(ics).toContain("SUMMARY:Site visit\\; Ganesh Green Villas\\, Patna");
    expect(ics).toContain("LOCATION:Danapur\\; Patna");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2 with a backslash \\\\ and a comma\\, here");
    expect(ics).not.toContain("URL:");
    // Every physical line is ≤ 75 octets and the alarm sits inside the event.
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.indexOf("BEGIN:VEVENT")).toBeLessThan(ics.indexOf("BEGIN:VALARM"));
    expect(ics.indexOf("END:VALARM")).toBeLessThan(ics.indexOf("END:VEVENT"));
    // No bare LF anywhere.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("Ledger ordering and closure", () => {
  it("orders the same instant written with different offsets as equal, and bare dates before instants of that IST day", () => {
    const events: LedgerEvent[] = [
      { kind: "PAYMENT", at: "2026-01-02T01:00:00+05:30", bucket: "CASH", amountPaise: 1, refNumber: "p-0130Z" },
      { kind: "PAYMENT", at: "2026-01-01T23:00:00Z", bucket: "CASH", amountPaise: 2, refNumber: "p-2300Z" },
      { kind: "DEMAND", at: "2026-01-01T19:30:00Z", cashPaise: 1, accountPaise: 0, refNumber: "d-1930Z" },
      { kind: "DEMAND", at: "2026-01-02", cashPaise: 1, accountPaise: 0, refNumber: "d-date" },
      { kind: "PAYMENT", at: "2026-01-01T18:00:00Z", bucket: "CASH", amountPaise: 3, refNumber: "p-1800Z-prev-day" },
    ];
    // 2026-01-01T19:30Z == 2026-01-02T01:00+05:30 (same instant): DEMAND sorts before PAYMENT by kind priority.
    expect(sortLedgerEvents(events).map((e) => e.refNumber)).toEqual([
      "p-1800Z-prev-day",
      "d-date",
      "d-1930Z",
      "p-0130Z",
      "p-2300Z",
    ]);
    const { rows } = deriveLedger(events);
    expect(rows.map((r) => r.entryDate)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-02",
      "2026-01-02",
      "2026-01-02",
    ]);
    expect(rows.at(-1)?.cashPaidCumPaise).toBe(6);
  });
  it("after CANCELLATION no further money event is accepted, and the refund shows as a negative amount", () => {
    const { summary, rows } = deriveLedger([
      { kind: "DEMAND", at: "2026-01-01", cashPaise: L(6), accountPaise: L(4) },
      { kind: "PAYMENT", at: "2026-01-02", bucket: "CASH", amountPaise: L(6) },
      { kind: "CANCELLATION", at: "2026-01-03", refundPaise: L(5), deductionPaise: L(1) },
    ]);
    expect(rows[2]).toMatchObject({ event: "CANCELLATION", amountPaise: -L(5) });
    expect(summary.isClosed).toBe(true);
    expect(() =>
      deriveLedger([{ kind: "CANCELLATION", at: "2026-01-01", refundPaise: 0, deductionPaise: 0 }], summary),
    ).toThrow(/closed/);
    expect(() => deriveLedger([{ kind: "DEMAND", at: "2026-01-04", cashPaise: 1, accountPaise: 1 }], summary)).toThrow(
      /closed/,
    );
  });
  it("ageing buckets by due date", () => {
    expect(ageingBucket("2026-05-01", "2026-04-30")).toBe("NOT_DUE");
    expect(ageingBucket("2026-05-01", "2026-05-01")).toBe("D0_30");
    expect(ageingBucket("2026-05-01", "2026-05-31")).toBe("D0_30");
    expect(ageingBucket("2026-05-01", "2026-06-01")).toBe("D31_60");
    expect(ageingBucket("2026-05-01", "2026-06-30")).toBe("D31_60");
    expect(ageingBucket("2026-05-01", "2026-07-30")).toBe("D61_90");
    expect(ageingBucket("2026-05-01", "2026-07-31")).toBe("D90_PLUS");
  });
});
