/**
 * Payment plan validation (SPEC §8): percents sum to exactly 100.00, unique sequences, trigger details present,
 * at most one ON_BOOKING and one ON_POSSESSION; plus the tower-stage compatibility check.
 */
import { isValidDateString } from "./dates.js";
import { MoneyError, basisPointsToPercentString, toBasisPoints } from "./money.js";

/** Installment trigger types. */
export type TriggerType = "ON_BOOKING" | "DAYS_AFTER_BOOKING" | "ON_STAGE" | "ON_POSSESSION" | "ON_DATE";

/** Payment plan type. */
export type PlanType = "CONSTRUCTION_LINKED" | "DOWN_PAYMENT" | "TIME_LINKED" | "FLEXI" | "CUSTOM";

export interface PlanInstallmentInput {
  seq: number;
  name: string;
  /** Percent with at most 2 decimals, as a number or a decimal string. */
  percent: number | string;
  triggerType: TriggerType;
  triggerDays?: number | null;
  triggerStageId?: string | null;
  triggerDate?: string | null;
  dueDays?: number | null;
}

export type PlanValidationCode =
  | "EMPTY_PLAN"
  | "PERCENT_SUM"
  | "INVALID_PERCENT"
  | "DUPLICATE_SEQ"
  | "INVALID_SEQ"
  | "EMPTY_NAME"
  | "MULTIPLE_ON_BOOKING"
  | "MULTIPLE_ON_POSSESSION"
  | "TRIGGER_DAYS_REQUIRED"
  | "TRIGGER_STAGE_REQUIRED"
  | "TRIGGER_DATE_REQUIRED"
  | "INVALID_DUE_DAYS";

export interface PlanValidationError {
  code: PlanValidationCode;
  message: string;
  /** Installment sequence the error refers to, when it is specific to one. */
  seq?: number;
  details?: Record<string, unknown>;
}

export interface PlanValidationResult {
  ok: boolean;
  errors: PlanValidationError[];
  /** Total of all percents in basis points (10000 = 100.00%). */
  totalBasisPoints: number;
}

/** Parses a percent to basis points, returning null when it is not a valid ≤2-decimal number. */
export function percentToBasisPointsOrNull(percent: number | string): number | null {
  try {
    return toBasisPoints(percent);
  } catch (error) {
    if (error instanceof MoneyError) {
      return null;
    }
    throw error;
  }
}

/** Checks the trigger-specific detail of one installment. */
function validateTrigger(inst: PlanInstallmentInput): PlanValidationError | null {
  switch (inst.triggerType) {
    case "ON_BOOKING":
    case "ON_POSSESSION":
      return null;
    case "DAYS_AFTER_BOOKING":
      if (!Number.isInteger(inst.triggerDays) || (inst.triggerDays ?? 0) <= 0) {
        return { code: "TRIGGER_DAYS_REQUIRED", message: `Installment ${inst.seq}: DAYS_AFTER_BOOKING needs trigger days > 0`, seq: inst.seq };
      }
      return null;
    case "ON_STAGE":
      if (!inst.triggerStageId || inst.triggerStageId.trim() === "") {
        return { code: "TRIGGER_STAGE_REQUIRED", message: `Installment ${inst.seq}: ON_STAGE needs a construction stage`, seq: inst.seq };
      }
      return null;
    case "ON_DATE":
      if (!inst.triggerDate || !isValidDateString(inst.triggerDate)) {
        return { code: "TRIGGER_DATE_REQUIRED", message: `Installment ${inst.seq}: ON_DATE needs a valid YYYY-MM-DD date`, seq: inst.seq };
      }
      return null;
    default: {
      const never: never = inst.triggerType;
      throw new Error(`Unknown trigger type ${String(never)}`);
    }
  }
}

/** Validates a plan's installments and returns every problem found (empty errors means the plan is valid). */
export function validatePlan(installments: readonly PlanInstallmentInput[]): PlanValidationResult {
  const errors: PlanValidationError[] = [];
  if (installments.length === 0) {
    return { ok: false, errors: [{ code: "EMPTY_PLAN", message: "A payment plan needs at least one installment" }], totalBasisPoints: 0 };
  }
  const seqs = new Set<number>();
  let total = 0;
  let onBooking = 0;
  let onPossession = 0;
  for (const inst of installments) {
    if (!Number.isInteger(inst.seq) || inst.seq < 1) {
      errors.push({ code: "INVALID_SEQ", message: `Sequence must be a positive integer, got ${String(inst.seq)}`, seq: inst.seq });
    } else if (seqs.has(inst.seq)) {
      errors.push({ code: "DUPLICATE_SEQ", message: `Sequence ${inst.seq} is used more than once`, seq: inst.seq });
    } else {
      seqs.add(inst.seq);
    }
    if (inst.name.trim() === "") {
      errors.push({ code: "EMPTY_NAME", message: `Installment ${inst.seq} has no name`, seq: inst.seq });
    }
    const bp = percentToBasisPointsOrNull(inst.percent);
    if (bp === null || bp <= 0) {
      errors.push({ code: "INVALID_PERCENT", message: `Installment ${inst.seq}: percent must be > 0 with at most 2 decimals`, seq: inst.seq });
    } else {
      total += bp;
    }
    if (inst.triggerType === "ON_BOOKING") {
      onBooking += 1;
    }
    if (inst.triggerType === "ON_POSSESSION") {
      onPossession += 1;
    }
    const triggerError = validateTrigger(inst);
    if (triggerError) {
      errors.push(triggerError);
    }
    if (inst.dueDays !== undefined && inst.dueDays !== null && (!Number.isInteger(inst.dueDays) || inst.dueDays < 0)) {
      errors.push({ code: "INVALID_DUE_DAYS", message: `Installment ${inst.seq}: due days must be a non-negative integer`, seq: inst.seq });
    }
  }
  if (onBooking > 1) {
    errors.push({ code: "MULTIPLE_ON_BOOKING", message: "Only one installment may be ON_BOOKING", details: { count: onBooking } });
  }
  if (onPossession > 1) {
    errors.push({ code: "MULTIPLE_ON_POSSESSION", message: "Only one installment may be ON_POSSESSION", details: { count: onPossession } });
  }
  if (total !== 10000) {
    errors.push({
      code: "PERCENT_SUM",
      message: `Percents must sum to exactly 100.00, got ${basisPointsToPercentString(total)}`,
      details: { totalBasisPoints: total, totalPercent: basisPointsToPercentString(total) },
    });
  }
  return { ok: errors.length === 0, errors, totalBasisPoints: total };
}

/** Sorts installments by sequence (a copy). */
export function sortBySeq<T extends { seq: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.seq - b.seq);
}

/** Cumulative percent (basis points) reached after each installment, in sequence order. */
export function cumulativeBasisPoints(installments: readonly { seq: number; percent: number | string }[]): { seq: number; bp: number; cumulativeBp: number }[] {
  let running = 0;
  return sortBySeq(installments).map((inst) => {
    const bp = toBasisPoints(inst.percent);
    running += bp;
    return { seq: inst.seq, bp, cumulativeBp: running };
  });
}

/** Stage ids referenced by ON_STAGE installments that a tower's stage sequence lacks (unique, in plan order). */
export function missingStagesForTower(
  installments: readonly Pick<PlanInstallmentInput, "seq" | "triggerType" | "triggerStageId">[],
  towerStageIds: readonly string[],
): string[] {
  const have = new Set(towerStageIds);
  const missing: string[] = [];
  for (const inst of sortBySeq(installments)) {
    if (inst.triggerType === "ON_STAGE" && inst.triggerStageId && !have.has(inst.triggerStageId) && !missing.includes(inst.triggerStageId)) {
      missing.push(inst.triggerStageId);
    }
  }
  return missing;
}
