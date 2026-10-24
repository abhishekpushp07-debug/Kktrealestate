/**
 * Auto-dues engine (SPEC §10): trigger evaluation, telescoping installment amounts that sum exactly to the
 * agreed amounts, idempotent "what to raise now" and the schedule preview.
 */
import { normalizeLabel } from "./canonical.js";
import { addDays, assertDateString, compareDates, formatDateLabel } from "./dates.js";
import { MoneyError, assertPaise, basisPointsToPercentString, bpOfPaise, toBasisPoints } from "./money.js";
import { sortBySeq, type TriggerType } from "./paymentPlan.js";

/** Status of a tower's stage record. */
export type StageStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

/** Demand status as stored. */
export type DemandStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID" | "CANCELLED";

/** Installment status as shown on the schedule. */
export type ScheduleStatus = "NOT_YET_DUE" | "RAISED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

export interface PlanSnapshotInstallment {
  seq: number;
  name: string;
  percent: number | string;
  triggerType: TriggerType;
  triggerDays?: number | null;
  triggerStageId?: string | null;
  triggerStageName?: string | null;
  triggerDate?: string | null;
  /** Days allowed to pay after the trigger; falls back to defaultDueDays. */
  dueDays?: number | null;
}

export interface TowerStage {
  stageId: string;
  name?: string;
  isPossession: boolean;
  status: StageStatus;
  completedOn: string | null;
}

export interface ExistingDemand {
  installmentSeq: number;
  installmentName: string;
  status: DemandStatus;
  dueDate?: string | null;
  cashPaise?: number;
  accountPaise?: number;
  paidPaise?: number;
}

export interface DuesBooking {
  bookingDate: string;
  cashAgreedPaise: number;
  accountAgreedPaise: number;
  planSnapshot: { installments: readonly PlanSnapshotInstallment[] };
}

export interface InstallmentAmount {
  seq: number;
  percentBp: number;
  cumulativeBp: number;
  cashPaise: number;
  accountPaise: number;
}

/** Default due days when neither the installment nor the caller gives one. */
export const DEFAULT_DUE_DAYS = 15;

/** The tower stage record an installment's stage trigger points at (possession stage for ON_POSSESSION), or undefined. */
function stageFor(inst: Pick<PlanSnapshotInstallment, "triggerType" | "triggerStageId">, towerStages: readonly TowerStage[]): TowerStage | undefined {
  switch (inst.triggerType) {
    case "ON_POSSESSION":
      return towerStages.find((s) => s.isPossession);
    case "ON_STAGE":
      return inst.triggerStageId ? towerStages.find((s) => s.stageId === inst.triggerStageId) : undefined;
    case "ON_BOOKING":
    case "DAYS_AFTER_BOOKING":
    case "ON_DATE":
      return undefined;
    default: {
      const never: never = inst.triggerType;
      throw new Error(`Unknown trigger type ${String(never)}`);
    }
  }
}

/** Finds the completed stage record satisfying an installment's stage trigger, or null. */
function completedStage(inst: PlanSnapshotInstallment, towerStages: readonly TowerStage[]): TowerStage | null {
  const stage = stageFor(inst, towerStages);
  if (!stage || stage.status !== "COMPLETED") {
    return null;
  }
  return stage;
}

/**
 * Stage id a demand for this installment is attributed to: the installment's stage for ON_STAGE, the tower's
 * possession stage for ON_POSSESSION (so undoing that stage can find and void the demand), else null.
 */
export function demandStageId(inst: Pick<PlanSnapshotInstallment, "triggerType" | "triggerStageId">, towerStages: readonly TowerStage[]): string | null {
  switch (inst.triggerType) {
    case "ON_STAGE":
      return inst.triggerStageId ?? null;
    case "ON_POSSESSION":
      return stageFor(inst, towerStages)?.stageId ?? inst.triggerStageId ?? null;
    case "ON_BOOKING":
    case "DAYS_AFTER_BOOKING":
    case "ON_DATE":
      return null;
    default: {
      const never: never = inst.triggerType;
      throw new Error(`Unknown trigger type ${String(never)}`);
    }
  }
}

/** Trigger date of an installment for a booking; null when the trigger is not (yet) satisfiable. */
export function triggerDate(inst: PlanSnapshotInstallment, bookingDate: string, towerStages: readonly TowerStage[]): string | null {
  assertDateString(bookingDate, "bookingDate");
  switch (inst.triggerType) {
    case "ON_BOOKING":
      return bookingDate;
    case "DAYS_AFTER_BOOKING":
      return addDays(bookingDate, inst.triggerDays ?? 0);
    case "ON_DATE":
      return inst.triggerDate ? assertDateString(inst.triggerDate, "triggerDate") : null;
    case "ON_STAGE":
    case "ON_POSSESSION": {
      const stage = completedStage(inst, towerStages);
      return stage?.completedOn ?? null;
    }
    default: {
      const never: never = inst.triggerType;
      throw new Error(`Unknown trigger type ${String(never)}`);
    }
  }
}

/** Human trigger label: "On booking", "30 days after booking", "On stage: Plinth", "On possession", "On 24 Oct 2026". */
export function triggerLabel(inst: PlanSnapshotInstallment, stageName?: string | null): string {
  switch (inst.triggerType) {
    case "ON_BOOKING":
      return "On booking";
    case "DAYS_AFTER_BOOKING":
      return `${inst.triggerDays ?? 0} days after booking`;
    case "ON_STAGE":
      return `On stage: ${stageName ?? inst.triggerStageName ?? inst.triggerStageId ?? "?"}`;
    case "ON_POSSESSION":
      return "On possession";
    case "ON_DATE":
      return `On ${inst.triggerDate ? formatDateLabel(inst.triggerDate) : "?"}`;
    default: {
      const never: never = inst.triggerType;
      throw new Error(`Unknown trigger type ${String(never)}`);
    }
  }
}

/**
 * Telescoping amounts per installment: amount_i = round(agreed × cum_i) − round(agreed × cum_(i−1)) in basis points,
 * so the sum of all installments equals the agreed amount exactly (when percents total 100.00).
 */
export function installmentAmounts(
  agreedCashPaise: number,
  agreedAccountPaise: number,
  installments: readonly Pick<PlanSnapshotInstallment, "seq" | "percent">[],
): InstallmentAmount[] {
  assertPaise(agreedCashPaise, "agreedCashPaise");
  assertPaise(agreedAccountPaise, "agreedAccountPaise");
  if (agreedCashPaise < 0 || agreedAccountPaise < 0) {
    throw new MoneyError(`Agreed amounts cannot be negative, got cash ${agreedCashPaise} / account ${agreedAccountPaise}`);
  }
  let cumulativeBp = 0;
  let prevCash = 0;
  let prevAccount = 0;
  return sortBySeq(installments).map((inst) => {
    const percentBp = toBasisPoints(inst.percent);
    cumulativeBp += percentBp;
    const cumCash = bpOfPaise(agreedCashPaise, cumulativeBp);
    const cumAccount = bpOfPaise(agreedAccountPaise, cumulativeBp);
    const amount: InstallmentAmount = {
      seq: inst.seq,
      percentBp,
      cumulativeBp,
      cashPaise: cumCash - prevCash,
      accountPaise: cumAccount - prevAccount,
    };
    prevCash = cumCash;
    prevAccount = cumAccount;
    return amount;
  });
}

/** Whether a non-void demand already covers an installment, matched by sequence OR normalised name. */
export function hasDemandFor(inst: Pick<PlanSnapshotInstallment, "seq" | "name">, existing: readonly ExistingDemand[]): boolean {
  const name = normalizeLabel(inst.name);
  return existing.some((d) => d.status !== "VOID" && (d.installmentSeq === inst.seq || normalizeLabel(d.installmentName) === name));
}

export interface DueToRaise {
  seq: number;
  name: string;
  triggerType: TriggerType;
  triggerLabel: string;
  triggerStageId: string | null;
  triggerDate: string;
  dueDate: string;
  /** Percent as "12.50". */
  percent: string;
  cumulativePercent: string;
  percentBp: number;
  cumulativeBp: number;
  cashPaise: number;
  accountPaise: number;
  totalPaise: number;
}

export interface EvaluateDuesInput {
  booking: DuesBooking;
  towerStages: readonly TowerStage[];
  existingDemands: readonly ExistingDemand[];
  today: string;
  /** Due days used when an installment has none (default 15). */
  defaultDueDays?: number;
}

/** Resolves the due-days for an installment. */
function dueDaysOf(inst: PlanSnapshotInstallment, defaultDueDays: number): number {
  return inst.dueDays ?? defaultDueDays;
}

/** Stage name lookup for labels. */
function stageNameFor(inst: PlanSnapshotInstallment, towerStages: readonly TowerStage[]): string | null {
  return stageFor(inst, towerStages)?.name ?? inst.triggerStageName ?? null;
}

/** Whether a trigger date counts as satisfied today: ON_BOOKING always is (SPEC §10), the rest once the date arrives. */
function isSatisfied(inst: PlanSnapshotInstallment, date: string | null, today: string): date is string {
  if (date === null) {
    return false;
  }
  return inst.triggerType === "ON_BOOKING" || compareDates(date, today) <= 0;
}

/** Installments whose trigger is satisfied as of today and have no non-void demand yet (idempotent by seq or name). */
export function evaluateDues(input: EvaluateDuesInput): DueToRaise[] {
  const { booking, towerStages, existingDemands, today } = input;
  assertDateString(today, "today");
  const defaultDueDays = input.defaultDueDays ?? DEFAULT_DUE_DAYS;
  const installments = sortBySeq(booking.planSnapshot.installments);
  const amounts = new Map(installmentAmounts(booking.cashAgreedPaise, booking.accountAgreedPaise, installments).map((a) => [a.seq, a] as const));
  const out: DueToRaise[] = [];
  for (const inst of installments) {
    if (hasDemandFor(inst, existingDemands)) {
      continue;
    }
    const date = triggerDate(inst, booking.bookingDate, towerStages);
    if (!isSatisfied(inst, date, today)) {
      continue;
    }
    const amount = amounts.get(inst.seq);
    if (!amount) {
      continue;
    }
    out.push({
      seq: inst.seq,
      name: inst.name,
      triggerType: inst.triggerType,
      triggerLabel: triggerLabel(inst, stageNameFor(inst, towerStages)),
      triggerStageId: demandStageId(inst, towerStages),
      triggerDate: date,
      dueDate: addDays(date, dueDaysOf(inst, defaultDueDays)),
      percent: basisPointsToPercentString(amount.percentBp),
      cumulativePercent: basisPointsToPercentString(amount.cumulativeBp),
      percentBp: amount.percentBp,
      cumulativeBp: amount.cumulativeBp,
      cashPaise: amount.cashPaise,
      accountPaise: amount.accountPaise,
      totalPaise: amount.cashPaise + amount.accountPaise,
    });
  }
  return out;
}

export interface ScheduleRow {
  seq: number;
  name: string;
  triggerType: TriggerType;
  triggerLabel: string;
  status: ScheduleStatus;
  /** Trigger date when known (satisfied, time-based or forecast), else null. */
  expectedTriggerDate: string | null;
  /** Due date (trigger + due days) when the trigger date is known, else null. */
  expectedDueDate: string | null;
  percent: string;
  cumulativePercent: string;
  cashPaise: number;
  accountPaise: number;
  totalPaise: number;
  paidPaise: number;
  /** True when a non-void demand exists for this installment. */
  demanded: boolean;
}

export interface SchedulePreviewInput extends EvaluateDuesInput {
  /** Optional forecast completion dates per stage id for stages not yet completed. */
  expectedStageDates?: Readonly<Record<string, string>>;
}

/** Status of a demanded installment from its demand record and today. */
function demandedStatus(demand: ExistingDemand, dueDate: string | null, today: string): ScheduleStatus {
  switch (demand.status) {
    case "PAID":
      return "PAID";
    case "PARTIALLY_PAID":
      return "PARTIALLY_PAID";
    case "OPEN":
    case "CANCELLED":
    case "VOID":
      return dueDate !== null && compareDates(today, dueDate) > 0 ? "OVERDUE" : "RAISED";
    default: {
      const never: never = demand.status;
      throw new Error(`Unknown demand status ${String(never)}`);
    }
  }
}

/** Forecast trigger date for a not-yet-satisfied stage trigger from the caller's expected stage dates. */
function forecastStageDate(inst: PlanSnapshotInstallment, towerStages: readonly TowerStage[], expected: Readonly<Record<string, string>>): string | null {
  const stageId = demandStageId(inst, towerStages);
  return stageId ? (expected[stageId] ?? null) : null;
}

/** Every installment of the plan with its schedule status, expected dates, amounts and paid so far. */
export function schedulePreview(input: SchedulePreviewInput): ScheduleRow[] {
  const { booking, towerStages, existingDemands, today } = input;
  assertDateString(today, "today");
  const defaultDueDays = input.defaultDueDays ?? DEFAULT_DUE_DAYS;
  const expected = input.expectedStageDates ?? {};
  const installments = sortBySeq(booking.planSnapshot.installments);
  const amounts = installmentAmounts(booking.cashAgreedPaise, booking.accountAgreedPaise, installments);
  return installments.map((inst, index) => {
    const amount = amounts[index];
    const cashPaise = amount?.cashPaise ?? 0;
    const accountPaise = amount?.accountPaise ?? 0;
    const name = normalizeLabel(inst.name);
    const demand = existingDemands.find((d) => d.status !== "VOID" && (d.installmentSeq === inst.seq || normalizeLabel(d.installmentName) === name));
    const satisfiedDate = triggerDate(inst, booking.bookingDate, towerStages);
    const expectedTriggerDate = satisfiedDate ?? forecastStageDate(inst, towerStages, expected);
    const dueDays = dueDaysOf(inst, defaultDueDays);
    const expectedDueDate = demand?.dueDate ?? (expectedTriggerDate ? addDays(expectedTriggerDate, dueDays) : null);
    const status: ScheduleStatus = demand ? demandedStatus(demand, expectedDueDate, today) : "NOT_YET_DUE";
    return {
      seq: inst.seq,
      name: inst.name,
      triggerType: inst.triggerType,
      triggerLabel: triggerLabel(inst, stageNameFor(inst, towerStages)),
      status,
      expectedTriggerDate,
      expectedDueDate,
      percent: basisPointsToPercentString(amount?.percentBp ?? 0),
      cumulativePercent: basisPointsToPercentString(amount?.cumulativeBp ?? 0),
      cashPaise: demand?.cashPaise ?? cashPaise,
      accountPaise: demand?.accountPaise ?? accountPaise,
      totalPaise: (demand?.cashPaise ?? cashPaise) + (demand?.accountPaise ?? accountPaise),
      paidPaise: demand?.paidPaise ?? 0,
      demanded: demand !== undefined,
    };
  });
}
