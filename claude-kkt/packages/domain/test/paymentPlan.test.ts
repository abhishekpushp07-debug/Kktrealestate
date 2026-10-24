import { describe, expect, it } from "vitest";
import { cumulativeBasisPoints, missingStagesForTower, validatePlan, type PlanInstallmentInput } from "../src/index.js";

const clp: PlanInstallmentInput[] = [
  { seq: 1, name: "On booking", percent: 10, triggerType: "ON_BOOKING", dueDays: 7 },
  { seq: 2, name: "Foundation", percent: "15.00", triggerType: "ON_STAGE", triggerStageId: "st-foundation" },
  { seq: 3, name: "Plinth", percent: 25, triggerType: "ON_STAGE", triggerStageId: "st-plinth" },
  { seq: 4, name: "60 days", percent: 25.5, triggerType: "DAYS_AFTER_BOOKING", triggerDays: 60 },
  { seq: 5, name: "Fixed", percent: 19.5, triggerType: "ON_DATE", triggerDate: "2027-01-01" },
  { seq: 6, name: "Possession", percent: 5, triggerType: "ON_POSSESSION" },
];

describe("validatePlan", () => {
  it("accepts a valid plan", () => {
    const result = validatePlan(clp);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.totalBasisPoints).toBe(10000);
  });
  it("rejects wrong sums in basis points (no float error)", () => {
    const sum99 = validatePlan([
      { seq: 1, name: "a", percent: "33.33", triggerType: "ON_BOOKING" },
      { seq: 2, name: "b", percent: "33.33", triggerType: "ON_POSSESSION" },
      { seq: 3, name: "c", percent: "33.33", triggerType: "DAYS_AFTER_BOOKING", triggerDays: 30 },
    ]);
    expect(sum99.ok).toBe(false);
    expect(sum99.errors[0]?.code).toBe("PERCENT_SUM");
    expect(sum99.errors[0]?.message).toContain("99.99");
    const floaty = validatePlan([
      { seq: 1, name: "a", percent: 0.1, triggerType: "ON_BOOKING" },
      { seq: 2, name: "b", percent: 0.2, triggerType: "ON_POSSESSION" },
      { seq: 3, name: "c", percent: 99.7, triggerType: "DAYS_AFTER_BOOKING", triggerDays: 30 },
    ]);
    expect(floaty.ok).toBe(true);
    expect(validatePlan([{ seq: 1, name: "a", percent: "33.333", triggerType: "ON_BOOKING" }]).errors.map((e) => e.code)).toContain("INVALID_PERCENT");
  });
  it("reports structural errors", () => {
    const result = validatePlan([
      { seq: 1, name: "a", percent: 50, triggerType: "ON_BOOKING" },
      { seq: 1, name: "b", percent: 20, triggerType: "ON_BOOKING" },
      { seq: 2, name: "", percent: 10, triggerType: "DAYS_AFTER_BOOKING", triggerDays: 0 },
      { seq: 3, name: "d", percent: 10, triggerType: "ON_STAGE" },
      { seq: 4, name: "e", percent: 5, triggerType: "ON_DATE", triggerDate: "2027-13-01" },
      { seq: 5, name: "f", percent: 2.5, triggerType: "ON_POSSESSION", dueDays: -1 },
      { seq: 6, name: "g", percent: 2.5, triggerType: "ON_POSSESSION" },
    ]);
    const codes = result.errors.map((e) => e.code);
    expect(result.ok).toBe(false);
    expect(codes).toContain("DUPLICATE_SEQ");
    expect(codes).toContain("MULTIPLE_ON_BOOKING");
    expect(codes).toContain("EMPTY_NAME");
    expect(codes).toContain("TRIGGER_DAYS_REQUIRED");
    expect(codes).toContain("TRIGGER_STAGE_REQUIRED");
    expect(codes).toContain("TRIGGER_DATE_REQUIRED");
    expect(codes).toContain("INVALID_DUE_DAYS");
    expect(codes).toContain("MULTIPLE_ON_POSSESSION");
    expect(codes).not.toContain("PERCENT_SUM");
    expect(result.errors.find((e) => e.code === "TRIGGER_STAGE_REQUIRED")?.seq).toBe(3);
  });
  it("rejects empty plans, zero percents and bad sequences", () => {
    expect(validatePlan([]).errors[0]?.code).toBe("EMPTY_PLAN");
    const codes = validatePlan([
      { seq: 0, name: "a", percent: 0, triggerType: "ON_BOOKING" },
      { seq: 2, name: "b", percent: 100, triggerType: "ON_POSSESSION" },
    ]).errors.map((e) => e.code);
    expect(codes).toContain("INVALID_SEQ");
    expect(codes).toContain("INVALID_PERCENT");
  });
  it("cumulative basis points", () => {
    expect(cumulativeBasisPoints(clp).map((c) => c.cumulativeBp)).toEqual([1000, 2500, 5000, 7550, 9500, 10000]);
  });
});

describe("missingStagesForTower", () => {
  it("lists stages the tower lacks, unique, in plan order", () => {
    expect(missingStagesForTower(clp, ["st-foundation", "st-plinth"])).toEqual([]);
    expect(missingStagesForTower(clp, ["st-foundation"])).toEqual(["st-plinth"]);
    expect(missingStagesForTower([...clp, { seq: 7, name: "x", percent: 1, triggerType: "ON_STAGE", triggerStageId: "st-plinth" }], [])).toEqual([
      "st-foundation",
      "st-plinth",
    ]);
  });
});
