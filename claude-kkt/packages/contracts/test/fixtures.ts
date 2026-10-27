import type { InstallmentInput } from "../src/index.js";

/** Deterministic v4-shaped UUID for test fixtures. */
export const U = (n: number): string => `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000000`;

const STAGE = U(99);

/** Builds one installment input with trigger details matching its trigger type. */
export function inst(
  seq: number,
  percent: number,
  trigger: InstallmentInput["trigger_type"] = "ON_STAGE",
): InstallmentInput {
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

/** Wraps installments in a plan create body. */
export function plan(installments: InstallmentInput[]) {
  return { name: "Standard CLP", code: "CLP", plan_type: "CONSTRUCTION_LINKED" as const, grace_days: 0, installments };
}

const BOOKING_BASE = {
  flat_id: U(1),
  customer_id: U(2),
  booking_date: "2026-04-01",
  agreement_value_paise: 1_00_00_000_00,
  cash_agreed_paise: 60_00_000_00,
  account_agreed_paise: 40_00_000_00,
  payment_plan_id: U(3),
  plan_acceptance_mode: "IN_PERSON" as const,
  plan_accepted_on: "2026-04-01",
};

/** A valid booking create body with overrides. */
export function booking(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BOOKING_BASE, ...overrides };
}

/** A scoped recompute request. */
export const ADMIN_RECOMPUTE_FIXTURE = { booking_id: U(7) };
