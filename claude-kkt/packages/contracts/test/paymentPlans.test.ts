import { describe, expect, it } from "vitest";
import {
  PaymentPlanCreateSchema,
  PaymentPlanUpdateSchema,
  InstallmentInputSchema,
  type InstallmentInput,
} from "../src/index.js";

const STAGE = "11111111-1111-4111-8111-111111111111";

function inst(seq: number, percent: number, trigger: InstallmentInput["trigger_type"] = "ON_STAGE"): InstallmentInput {
  return {
    seq,
    name: `Installment ${seq}`,
    percent,
    trigger_type: trigger,
    trigger_days: trigger === "DAYS_AFTER_BOOKING" ? 30 : null,
    trigger_stage_id: trigger === "ON_STAGE" ? STAGE : null,
    trigger_date: trigger === "ON_DATE" ? "2026-12-01" : null,
    due_days: 15,
    notes: null,
  };
}

function plan(installments: InstallmentInput[]) {
  return { name: "Standard CLP", code: "CLP", plan_type: "CONSTRUCTION_LINKED" as const, grace_days: 0, installments };
}

describe("PaymentPlanCreateSchema", () => {
  it("accepts a plan whose percents sum to exactly 100.00", () => {
    const r = PaymentPlanCreateSchema.safeParse(
      plan([inst(1, 10, "ON_BOOKING"), inst(2, 85, "DAYS_AFTER_BOOKING"), inst(3, 5, "ON_POSSESSION")]),
    );
    expect(r.success).toBe(true);
  });
  it("accepts two-decimal percents that sum to 100 without float drift", () => {
    const r = PaymentPlanCreateSchema.safeParse(plan([inst(1, 33.33, "ON_BOOKING"), inst(2, 33.33), inst(3, 33.34)]));
    expect(r.success).toBe(true);
  });
  it("rejects percents that do not sum to 100.00", () => {
    const r = PaymentPlanCreateSchema.safeParse(plan([inst(1, 10, "ON_BOOKING"), inst(2, 85)]));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message.includes("100.00") && i.message.includes("95.00"))).toBe(true);
  });
  it("rejects duplicate sequences", () => {
    const r = PaymentPlanCreateSchema.safeParse(plan([inst(1, 50, "ON_BOOKING"), inst(1, 50)]));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message.includes("unique"))).toBe(true);
  });
  it("rejects more than one ON_BOOKING or ON_POSSESSION", () => {
    const r1 = PaymentPlanCreateSchema.safeParse(plan([inst(1, 50, "ON_BOOKING"), inst(2, 50, "ON_BOOKING")]));
    expect(r1.success).toBe(false);
    expect(r1.error?.issues.some((i) => i.message.includes("ON_BOOKING"))).toBe(true);
    const r2 = PaymentPlanCreateSchema.safeParse(plan([inst(1, 50, "ON_POSSESSION"), inst(2, 50, "ON_POSSESSION")]));
    expect(r2.success).toBe(false);
    expect(r2.error?.issues.some((i) => i.message.includes("ON_POSSESSION"))).toBe(true);
  });
  it("requires trigger details per trigger type", () => {
    expect(InstallmentInputSchema.safeParse({ ...inst(1, 10, "ON_STAGE"), trigger_stage_id: null }).success).toBe(
      false,
    );
    expect(InstallmentInputSchema.safeParse({ ...inst(1, 10, "DAYS_AFTER_BOOKING"), trigger_days: null }).success).toBe(
      false,
    );
    expect(InstallmentInputSchema.safeParse({ ...inst(1, 10, "ON_DATE"), trigger_date: null }).success).toBe(false);
    expect(InstallmentInputSchema.safeParse(inst(1, 10, "ON_BOOKING")).success).toBe(true);
  });
  it("rejects unknown keys", () => {
    expect(PaymentPlanCreateSchema.safeParse({ ...plan([inst(1, 100, "ON_BOOKING")]), extra: 1 }).success).toBe(false);
  });
});

describe("PaymentPlanUpdateSchema", () => {
  it("validates installments only when present", () => {
    expect(PaymentPlanUpdateSchema.safeParse({ version: 2, name: "Renamed" }).success).toBe(true);
    expect(PaymentPlanUpdateSchema.safeParse({ version: 2, installments: [inst(1, 90, "ON_BOOKING")] }).success).toBe(
      false,
    );
    expect(PaymentPlanUpdateSchema.safeParse({ name: "no version" }).success).toBe(false);
  });
});
