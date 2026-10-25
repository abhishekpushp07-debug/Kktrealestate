import type { LedgerRow, OtherChargeInput, PlanAcceptanceMode } from "@kkt/contracts";

/* ------------------------------------------------------------------ */
/* Cash / Account split with auto-balance                               */
/* ------------------------------------------------------------------ */

export interface Split {
  cash_paise: number;
  account_paise: number;
}

export type SplitMode = "AMOUNT" | "PERCENT";

function clampPaise(value: number, total: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.round(value)), Math.max(0, total));
}

/** Cash fixed by the user → account takes the remainder so the pair always sums to `total` exactly. */
export function splitFromCash(total: number, cash: number | null | undefined): Split {
  const safeTotal = Math.max(0, Math.round(total));
  const cashPaise = clampPaise(cash ?? 0, safeTotal);
  return { cash_paise: cashPaise, account_paise: safeTotal - cashPaise };
}

/** Account fixed by the user → cash takes the remainder. */
export function splitFromAccount(total: number, account: number | null | undefined): Split {
  const safeTotal = Math.max(0, Math.round(total));
  const accountPaise = clampPaise(account ?? 0, safeTotal);
  return { cash_paise: safeTotal - accountPaise, account_paise: accountPaise };
}

/** `percent` of `total` in paise (half-up rounding, two-decimal percent). */
export function percentToPaise(total: number, percent: number | null | undefined): number {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0;
  const safeTotal = Math.max(0, Math.round(total));
  const basisPoints = Math.round(percent * 100);
  return clampPaise((safeTotal * basisPoints) / 10_000, safeTotal);
}

/** Share of `total` as a percent with two decimals (0 when total is 0). */
export function paiseToPercent(total: number, paise: number): number {
  if (total <= 0) return 0;
  return Math.round((paise / total) * 10_000) / 100;
}

/** Cash percent typed by the user → cash amount rounded, account = exact remainder. */
export function splitFromCashPercent(total: number, cashPercent: number | null | undefined): Split {
  return splitFromCash(total, percentToPaise(total, cashPercent));
}

/** Account percent typed by the user → account amount rounded, cash = exact remainder. */
export function splitFromAccountPercent(total: number, accountPercent: number | null | undefined): Split {
  return splitFromAccount(total, percentToPaise(total, accountPercent));
}

/** Percent view of a split (cash %, account % = 100 − cash % so the pair reads as 100). */
export function splitPercents(total: number, split: Split): { cash: number; account: number } {
  const cash = paiseToPercent(total, split.cash_paise);
  return { cash, account: total > 0 ? Math.round((100 - cash) * 100) / 100 : 0 };
}

/**
 * When the agreement total changes keep the cash share (as a percent) and let account absorb the
 * rounding, so the split still sums exactly to the new total.
 */
export function rebalanceSplitForTotal(previous: Split, previousTotal: number, nextTotal: number): Split {
  const safeNext = Math.max(0, Math.round(nextTotal));
  if (previousTotal <= 0) return { cash_paise: safeNext, account_paise: 0 };
  const cashPercent = paiseToPercent(previousTotal, previous.cash_paise);
  return splitFromCashPercent(safeNext, cashPercent);
}

/** True when cash + account equals the agreement value exactly (integer paise). */
export function splitIsExact(total: number | null | undefined, split: Partial<Split> | null | undefined): boolean {
  if (total === null || total === undefined || !split) return false;
  const cash = split.cash_paise ?? null;
  const account = split.account_paise ?? null;
  if (cash === null || account === null) return false;
  return Number.isInteger(cash) && Number.isInteger(account) && cash >= 0 && account >= 0 && cash + account === Math.round(total);
}

/* ------------------------------------------------------------------ */
/* Other charges                                                        */
/* ------------------------------------------------------------------ */

export interface ChargeTotals {
  base_paise: number;
  gst_paise: number;
  total_paise: number;
}

/** GST on an other-charge line (half-up) and the line total. */
export function chargeLineTotals(amountPaise: number, gstPercent: number): ChargeTotals {
  const base = Math.max(0, Math.round(amountPaise));
  const gst = Math.round((base * Math.round(gstPercent * 100)) / 10_000);
  return { base_paise: base, gst_paise: gst, total_paise: base + gst };
}

/** Sum of every selected other-charge line including GST. */
export function otherChargesTotal(lines: readonly OtherChargeInput[]): ChargeTotals {
  return lines.reduce<ChargeTotals>(
    (sum, line) => {
      const totals = chargeLineTotals(line.amount_paise, line.gst_percent);
      return { base_paise: sum.base_paise + totals.base_paise, gst_paise: sum.gst_paise + totals.gst_paise, total_paise: sum.total_paise + totals.total_paise };
    },
    { base_paise: 0, gst_paise: 0, total_paise: 0 },
  );
}

/* ------------------------------------------------------------------ */
/* Ledger colouring                                                     */
/* ------------------------------------------------------------------ */

export type DueTone = "due" | "advance" | "settled";

/** Negative due = advance (green), positive = due (red), zero = settled. */
export function dueTone(paise: number | null | undefined): DueTone {
  if (paise === null || paise === undefined || !Number.isFinite(paise) || paise === 0) return "settled";
  return paise < 0 ? "advance" : "due";
}

export const DUE_TONE_CLASS: Readonly<Record<DueTone, string>> = {
  due: "text-danger-fg",
  advance: "text-success-fg",
  settled: "text-ink",
};

export type LedgerAmountTone = "credit" | "debit" | "neutral";

/** Payments read as credits (green), reversals / cancellations as debits (red), demands and changes neutral. */
export function ledgerAmountTone(row: Pick<LedgerRow, "event" | "amount_paise">): LedgerAmountTone {
  switch (row.event) {
    case "PAYMENT":
    case "OTHER_CHARGE_PAYMENT":
      return row.amount_paise < 0 ? "debit" : "credit";
    case "REVERSAL":
    case "OTHER_CHARGE_REVERSAL":
      return "debit";
    case "CANCELLATION":
      return row.amount_paise < 0 ? "debit" : "neutral";
    case "DEMAND":
    case "OTHER_CHARGE_DEMAND":
    case "AGREEMENT_CHANGE":
    case "PLAN_CHANGE":
      return "neutral";
  }
}

export const LEDGER_AMOUNT_CLASS: Readonly<Record<LedgerAmountTone, string>> = {
  credit: "text-success-fg",
  debit: "text-danger-fg",
  neutral: "text-ink",
};

/** Category chip for a ledger row: Cash / Account / Other charges / — */
export function ledgerCategory(row: Pick<LedgerRow, "event" | "bucket">): "CASH" | "ACCOUNT" | "OTHER" | null {
  if (row.event === "OTHER_CHARGE_DEMAND" || row.event === "OTHER_CHARGE_PAYMENT" || row.event === "OTHER_CHARGE_REVERSAL") return "OTHER";
  return row.bucket;
}

/* ------------------------------------------------------------------ */
/* Wizard state & validators                                            */
/* ------------------------------------------------------------------ */

export const WIZARD_STEPS = ["flat", "customer", "agreement", "plan", "charges", "review"] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number];
export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

/** The wizard's editable state. Ids only; display data is fetched from the API by id. */
export interface WizardState {
  project_id: string | null;
  block_id: string | null;
  flat_id: string | null;
  customer_id: string | null;
  co_applicant_ids: string[];
  booking_date: string;
  agreement_value_paise: number | null;
  cash_agreed_paise: number | null;
  account_agreed_paise: number | null;
  split_mode: SplitMode;
  payment_plan_id: string | null;
  plan_acceptance_mode: PlanAcceptanceMode;
  plan_accepted_on: string;
  plan_acceptance_document_id: string | null;
  other_charges: OtherChargeInput[];
  parking_slot_ids: string[];
  lead_id: string | null;
  sales_user_id: string | null;
  broker_name: string;
  remarks: string;
}

export function emptyWizardState(today: string): WizardState {
  return {
    project_id: null,
    block_id: null,
    flat_id: null,
    customer_id: null,
    co_applicant_ids: [],
    booking_date: today,
    agreement_value_paise: null,
    cash_agreed_paise: null,
    account_agreed_paise: null,
    split_mode: "AMOUNT",
    payment_plan_id: null,
    plan_acceptance_mode: "IN_PERSON",
    plan_accepted_on: today,
    plan_acceptance_document_id: null,
    other_charges: [],
    parking_slot_ids: [],
    lead_id: null,
    sales_user_id: null,
    broker_name: "",
    remarks: "",
  };
}

export type StepErrors = Readonly<Record<string, string>>;

export interface StepValidationContext {
  /** Today's business date (YYYY-MM-DD). */
  today: string;
  /** Current status of the chosen flat, when known (only AVAILABLE / HOLD may be booked). */
  flatStatus?: string | null;
  /** Whether at least one applicable plan exists for the tower (null = not loaded yet). */
  plansAvailable?: boolean | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string | null | undefined): value is string {
  return typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Per-step inline validation. Returns an empty object when the step is complete. */
export function validateStep(step: WizardStepId, state: WizardState, context: StepValidationContext): StepErrors {
  const errors: Record<string, string> = {};
  switch (step) {
    case "flat": {
      if (!state.project_id) errors.project_id = "Choose a project";
      if (!state.block_id) errors.block_id = "Choose a tower";
      if (!state.flat_id) errors.flat_id = "Pick a flat from the grid";
      else if (context.flatStatus && context.flatStatus !== "AVAILABLE" && context.flatStatus !== "HOLD") {
        errors.flat_id = `This flat is ${context.flatStatus.toLowerCase()} and cannot be booked`;
      }
      if (!isDate(state.booking_date)) errors.booking_date = "Enter the booking date";
      else if (state.booking_date > context.today) errors.booking_date = "Booking date cannot be in the future";
      break;
    }
    case "customer": {
      if (!state.customer_id) errors.customer_id = "Select or create the primary applicant";
      if (state.customer_id && state.co_applicant_ids.includes(state.customer_id)) errors.co_applicant_ids = "Primary applicant cannot also be a co-applicant";
      if (new Set(state.co_applicant_ids).size !== state.co_applicant_ids.length) errors.co_applicant_ids = "Duplicate co-applicants";
      if (state.co_applicant_ids.length > 10) errors.co_applicant_ids = "At most 10 co-applicants";
      break;
    }
    case "agreement": {
      const total = state.agreement_value_paise;
      if (total === null || !Number.isInteger(total)) errors.agreement_value_paise = "Enter the agreement value";
      else if (total <= 0) errors.agreement_value_paise = "Agreement value must be greater than 0";
      if (state.cash_agreed_paise === null) errors.cash_agreed_paise = "Enter the cash portion";
      if (state.account_agreed_paise === null) errors.account_agreed_paise = "Enter the account portion";
      if (total !== null && total > 0 && state.cash_agreed_paise !== null && state.account_agreed_paise !== null) {
        if (!splitIsExact(total, { cash_paise: state.cash_agreed_paise, account_paise: state.account_agreed_paise })) {
          errors.account_agreed_paise = "Cash + Account must equal the agreement value exactly";
        }
      }
      break;
    }
    case "plan": {
      if (context.plansAvailable === false) errors.payment_plan_id = "No payment plan is assigned to this tower. Assign one in Master data first.";
      else if (!state.payment_plan_id) errors.payment_plan_id = "Choose a payment plan";
      if (!isDate(state.plan_accepted_on)) errors.plan_accepted_on = "Enter the acceptance date";
      else {
        if (isDate(state.booking_date) && state.plan_accepted_on < state.booking_date) errors.plan_accepted_on = "Acceptance date cannot be before the booking date";
        if (state.plan_accepted_on > context.today) errors.plan_accepted_on = "Acceptance date cannot be in the future";
      }
      if (state.plan_acceptance_mode === "SIGNED_COPY" && !state.plan_acceptance_document_id) errors.plan_acceptance_document_id = "Upload the signed copy of the plan";
      break;
    }
    case "charges": {
      state.other_charges.forEach((line, index) => {
        if (!Number.isInteger(line.amount_paise) || line.amount_paise < 0) errors[`other_charges.${index}.amount_paise`] = "Enter a valid amount";
        if (line.gst_percent < 0 || line.gst_percent > 100) errors[`other_charges.${index}.gst_percent`] = "GST must be between 0 and 100";
      });
      const chargeIds = state.other_charges.map((line) => line.charge_type_id);
      if (new Set(chargeIds).size !== chargeIds.length) errors.other_charges = "A charge type can only be added once";
      if (state.other_charges.length > 30) errors.other_charges = "At most 30 charge lines";
      if (new Set(state.parking_slot_ids).size !== state.parking_slot_ids.length) errors.parking_slot_ids = "Duplicate parking slots";
      if (state.parking_slot_ids.length > 10) errors.parking_slot_ids = "At most 10 parking slots";
      break;
    }
    case "review": {
      for (const previous of WIZARD_STEPS) {
        if (previous === "review") break;
        Object.assign(errors, validateStep(previous, state, context));
      }
      if (state.broker_name.trim().length > 120) errors.broker_name = "At most 120 characters";
      if (state.remarks.trim().length > 2000) errors.remarks = "At most 2000 characters";
      break;
    }
  }
  return errors;
}

/** Index of the first step that is not yet valid (or the review step when everything passes). */
export function firstIncompleteStep(state: WizardState, context: StepValidationContext): number {
  for (let index = 0; index < WIZARD_STEPS.length - 1; index += 1) {
    const step = WIZARD_STEPS[index];
    if (step && Object.keys(validateStep(step, state, context)).length > 0) return index;
  }
  return WIZARD_STEPS.length - 1;
}

/** Strips empty strings / nulls into the wire shape for `POST /bookings`. */
export function toBookingCreatePayload(state: WizardState) {
  return {
    flat_id: state.flat_id ?? "",
    customer_id: state.customer_id ?? "",
    co_applicant_ids: state.co_applicant_ids,
    booking_date: state.booking_date,
    agreement_value_paise: state.agreement_value_paise ?? 0,
    cash_agreed_paise: state.cash_agreed_paise ?? 0,
    account_agreed_paise: state.account_agreed_paise ?? 0,
    payment_plan_id: state.payment_plan_id,
    plan_acceptance_mode: state.plan_acceptance_mode,
    plan_accepted_on: state.plan_accepted_on,
    plan_acceptance_document_id: state.plan_acceptance_document_id,
    other_charges: state.other_charges,
    parking_slot_ids: state.parking_slot_ids,
    lead_id: state.lead_id,
    sales_user_id: state.sales_user_id,
    broker_name: state.broker_name.trim() === "" ? null : state.broker_name.trim(),
    remarks: state.remarks.trim() === "" ? null : state.remarks.trim(),
  };
}

/**
 * The server-side draft only accepts `BookingBase.partial()` plus project/block ids (strict object),
 * so UI-only keys (split mode) stay in the browser.
 */
export function toDraftPayload(state: WizardState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    payload[key] = value;
  };
  put("project_id", state.project_id);
  put("block_id", state.block_id);
  put("flat_id", state.flat_id);
  put("customer_id", state.customer_id);
  put("co_applicant_ids", state.co_applicant_ids);
  put("booking_date", state.booking_date);
  put("agreement_value_paise", state.agreement_value_paise);
  put("cash_agreed_paise", state.cash_agreed_paise);
  put("account_agreed_paise", state.account_agreed_paise);
  put("payment_plan_id", state.payment_plan_id);
  put("plan_acceptance_mode", state.plan_acceptance_mode);
  put("plan_accepted_on", state.plan_accepted_on);
  put("plan_acceptance_document_id", state.plan_acceptance_document_id);
  put("other_charges", state.other_charges);
  put("parking_slot_ids", state.parking_slot_ids);
  put("lead_id", state.lead_id);
  put("sales_user_id", state.sales_user_id);
  put("broker_name", state.broker_name.trim() || null);
  put("remarks", state.remarks.trim() || null);
  return payload;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Rebuilds wizard state from a stored draft payload (server or localStorage); tolerant of junk. */
export function fromDraftPayload(payload: Record<string, unknown>, today: string): WizardState {
  const base = emptyWizardState(today);
  const charges: OtherChargeInput[] = Array.isArray(payload.other_charges)
    ? payload.other_charges.flatMap((raw) => {
        if (typeof raw !== "object" || raw === null) return [];
        const line = raw as Record<string, unknown>;
        const chargeTypeId = str(line.charge_type_id);
        const amount = int(line.amount_paise);
        const demandAt = line.demand_at;
        if (!chargeTypeId || amount === null || (demandAt !== "ON_BOOKING" && demandAt !== "ON_POSSESSION" && demandAt !== "MANUAL")) return [];
        const gst = typeof line.gst_percent === "number" && Number.isFinite(line.gst_percent) ? line.gst_percent : 0;
        return [{ charge_type_id: chargeTypeId, amount_paise: amount, gst_percent: gst, demand_at: demandAt }];
      })
    : [];
  const acceptance = payload.plan_acceptance_mode;
  const splitMode = payload.split_mode;
  return {
    ...base,
    project_id: str(payload.project_id),
    block_id: str(payload.block_id),
    flat_id: str(payload.flat_id),
    customer_id: str(payload.customer_id),
    co_applicant_ids: strList(payload.co_applicant_ids),
    booking_date: str(payload.booking_date) ?? today,
    agreement_value_paise: int(payload.agreement_value_paise),
    cash_agreed_paise: int(payload.cash_agreed_paise),
    account_agreed_paise: int(payload.account_agreed_paise),
    split_mode: splitMode === "PERCENT" ? "PERCENT" : "AMOUNT",
    payment_plan_id: str(payload.payment_plan_id),
    plan_acceptance_mode: acceptance === "SIGNED_COPY" || acceptance === "PORTAL" ? acceptance : "IN_PERSON",
    plan_accepted_on: str(payload.plan_accepted_on) ?? str(payload.booking_date) ?? today,
    plan_acceptance_document_id: str(payload.plan_acceptance_document_id),
    other_charges: charges,
    parking_slot_ids: strList(payload.parking_slot_ids),
    lead_id: str(payload.lead_id),
    sales_user_id: str(payload.sales_user_id),
    broker_name: str(payload.broker_name) ?? "",
    remarks: str(payload.remarks) ?? "",
  };
}

/** True when the wizard holds anything worth saving. */
export function wizardHasContent(state: WizardState): boolean {
  return Boolean(state.flat_id || state.customer_id || state.agreement_value_paise || state.other_charges.length || state.parking_slot_ids.length || state.remarks.trim());
}
