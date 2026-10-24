/**
 * Two-bucket payment ledger engine (SPEC §11): "track the split, don't gate the order".
 * deriveLedger rebuilds every row from events; appendLedgerRow is the O(1) incremental step; both agree.
 */
import { isValidDateString } from "./dates.js";
import { toEpochMs, toISTDateString } from "./ist.js";
import { assertPaise, formatINR } from "./money.js";

/** Money bucket of a booking. */
export type Bucket = "CASH" | "ACCOUNT";

/** Ledger event kinds, in the order they sort within the same instant. */
export type LedgerEventKind =
  | "DEMAND"
  | "PAYMENT"
  | "REVERSAL"
  | "AGREEMENT_CHANGE"
  | "PLAN_CHANGE"
  | "OTHER_CHARGE_DEMAND"
  | "OTHER_CHARGE_PAYMENT"
  | "OTHER_CHARGE_REVERSAL"
  | "CANCELLATION";

interface LedgerEventBase {
  /** Instant (RFC 3339) or business date (YYYY-MM-DD) of the event. */
  at: string;
  /** Business date override; defaults to the IST date of `at`. */
  entryDate?: string;
  label?: string;
  refNumber?: string | null;
  refId?: string | null;
  note?: string | null;
}

export interface DemandEvent extends LedgerEventBase {
  kind: "DEMAND";
  cashPaise: number;
  accountPaise: number;
}
export interface PaymentEvent extends LedgerEventBase {
  kind: "PAYMENT";
  bucket: Bucket;
  amountPaise: number;
}
export interface ReversalEvent extends LedgerEventBase {
  kind: "REVERSAL";
  bucket: Bucket;
  /** Positive magnitude of the reversed payment. */
  amountPaise: number;
}
export interface AgreementChangeEvent extends LedgerEventBase {
  kind: "AGREEMENT_CHANGE";
  cashAgreedPaise: number;
  accountAgreedPaise: number;
  /** Adjustment to raised amounts after recomputation (negative when dues shrink). */
  cashRaisedAdjustmentPaise?: number;
  accountRaisedAdjustmentPaise?: number;
}
export interface PlanChangeEvent extends LedgerEventBase {
  kind: "PLAN_CHANGE";
  /** Adjustment to raised amounts after recomputation (e.g. voided demands). */
  cashRaisedAdjustmentPaise?: number;
  accountRaisedAdjustmentPaise?: number;
}
export interface OtherChargeDemandEvent extends LedgerEventBase {
  kind: "OTHER_CHARGE_DEMAND";
  amountPaise: number;
}
export interface OtherChargePaymentEvent extends LedgerEventBase {
  kind: "OTHER_CHARGE_PAYMENT";
  amountPaise: number;
}
export interface OtherChargeReversalEvent extends LedgerEventBase {
  kind: "OTHER_CHARGE_REVERSAL";
  amountPaise: number;
}
export interface CancellationEvent extends LedgerEventBase {
  kind: "CANCELLATION";
  refundPaise: number;
  deductionPaise: number;
}

export type LedgerEvent =
  | DemandEvent
  | PaymentEvent
  | ReversalEvent
  | AgreementChangeEvent
  | PlanChangeEvent
  | OtherChargeDemandEvent
  | OtherChargePaymentEvent
  | OtherChargeReversalEvent
  | CancellationEvent;

export interface LedgerSummary {
  seq: number;
  cashOrderRaisedPaise: number;
  accountOrderRaisedPaise: number;
  cashPaidPaise: number;
  accountPaidPaise: number;
  otherChargesDemandedPaise: number;
  otherChargesPaidPaise: number;
  /** Derived: raised − paid per bucket (negative = advance). */
  cashDuePaise: number;
  accountDuePaise: number;
  totalDuePaise: number;
  otherChargesDuePaise: number;
  cashAgreedPaise: number | null;
  accountAgreedPaise: number | null;
  isClosed: boolean;
}

export interface LedgerRow {
  seq: number;
  at: string;
  entryDate: string;
  event: LedgerEventKind;
  label: string;
  bucket: Bucket | null;
  amountPaise: number;
  cashPaidCumPaise: number;
  accountPaidCumPaise: number;
  cashOrderRaisedPaise: number;
  accountOrderRaisedPaise: number;
  cashDuePaise: number;
  accountDuePaise: number;
  totalDuePaise: number;
  otherChargesDuePaise: number;
  refNumber: string | null;
  refId: string | null;
  note: string | null;
}

/** Error thrown for invalid ledger input. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Sort priority of each event kind within the same instant. */
export function ledgerKindPriority(kind: LedgerEventKind): number {
  switch (kind) {
    case "DEMAND":
      return 0;
    case "OTHER_CHARGE_DEMAND":
      return 1;
    case "AGREEMENT_CHANGE":
      return 2;
    case "PLAN_CHANGE":
      return 3;
    case "PAYMENT":
      return 4;
    case "OTHER_CHARGE_PAYMENT":
      return 5;
    case "REVERSAL":
      return 6;
    case "OTHER_CHARGE_REVERSAL":
      return 7;
    case "CANCELLATION":
      return 8;
    default: {
      const never: never = kind;
      throw new LedgerError(`Unknown ledger event kind ${String(never)}`);
    }
  }
}

/** Empty opening summary, optionally seeded with the agreed bucket values. */
export function emptyLedgerSummary(agreed?: { cashAgreedPaise: number; accountAgreedPaise: number } | null): LedgerSummary {
  return {
    seq: 0,
    cashOrderRaisedPaise: 0,
    accountOrderRaisedPaise: 0,
    cashPaidPaise: 0,
    accountPaidPaise: 0,
    otherChargesDemandedPaise: 0,
    otherChargesPaidPaise: 0,
    cashDuePaise: 0,
    accountDuePaise: 0,
    totalDuePaise: 0,
    otherChargesDuePaise: 0,
    cashAgreedPaise: agreed?.cashAgreedPaise ?? null,
    accountAgreedPaise: agreed?.accountAgreedPaise ?? null,
    isClosed: false,
  };
}

/** Business date of an event: explicit entryDate, a bare date `at`, or the IST date of the instant. */
export function ledgerEntryDate(event: Pick<LedgerEventBase, "at" | "entryDate">): string {
  if (event.entryDate) {
    return event.entryDate;
  }
  if (isValidDateString(event.at)) {
    return event.at;
  }
  return toISTDateString(event.at);
}

/** Recomputes the derived due figures of a summary. */
function withDerived(summary: LedgerSummary): LedgerSummary {
  const cashDuePaise = summary.cashOrderRaisedPaise - summary.cashPaidPaise;
  const accountDuePaise = summary.accountOrderRaisedPaise - summary.accountPaidPaise;
  return {
    ...summary,
    cashDuePaise,
    accountDuePaise,
    totalDuePaise: cashDuePaise + accountDuePaise,
    otherChargesDuePaise: summary.otherChargesDemandedPaise - summary.otherChargesPaidPaise,
  };
}

/** Applies a positive-amount guard for money-moving events. */
function positive(amount: number, what: string): number {
  assertPaise(amount, what);
  if (amount <= 0) {
    throw new LedgerError(`${what} must be positive, got ${amount}`);
  }
  return amount;
}

/** Applies one event to a summary, returning the next summary and the row's display amount/bucket/label. */
function applyEvent(prev: LedgerSummary, event: LedgerEvent): { next: LedgerSummary; amountPaise: number; bucket: Bucket | null; label: string } {
  if (prev.isClosed && event.kind !== "CANCELLATION") {
    throw new LedgerError(`Ledger is closed; cannot append ${event.kind}`);
  }
  switch (event.kind) {
    case "DEMAND": {
      assertPaise(event.cashPaise, "cashPaise");
      assertPaise(event.accountPaise, "accountPaise");
      const next = withDerived({
        ...prev,
        cashOrderRaisedPaise: prev.cashOrderRaisedPaise + event.cashPaise,
        accountOrderRaisedPaise: prev.accountOrderRaisedPaise + event.accountPaise,
      });
      return { next, amountPaise: event.cashPaise + event.accountPaise, bucket: null, label: event.label ?? "Demand" };
    }
    case "PAYMENT": {
      const amount = positive(event.amountPaise, "Payment amount");
      const next = withDerived({
        ...prev,
        cashPaidPaise: prev.cashPaidPaise + (event.bucket === "CASH" ? amount : 0),
        accountPaidPaise: prev.accountPaidPaise + (event.bucket === "ACCOUNT" ? amount : 0),
      });
      return { next, amountPaise: amount, bucket: event.bucket, label: event.label ?? "Payment" };
    }
    case "REVERSAL": {
      const amount = positive(event.amountPaise, "Reversal amount");
      const next = withDerived({
        ...prev,
        cashPaidPaise: prev.cashPaidPaise - (event.bucket === "CASH" ? amount : 0),
        accountPaidPaise: prev.accountPaidPaise - (event.bucket === "ACCOUNT" ? amount : 0),
      });
      return { next, amountPaise: -amount, bucket: event.bucket, label: event.label ?? "Payment reversed" };
    }
    case "AGREEMENT_CHANGE": {
      assertPaise(event.cashAgreedPaise, "cashAgreedPaise");
      assertPaise(event.accountAgreedPaise, "accountAgreedPaise");
      const cashAdj = event.cashRaisedAdjustmentPaise ?? 0;
      const accountAdj = event.accountRaisedAdjustmentPaise ?? 0;
      const prevTotal = (prev.cashAgreedPaise ?? 0) + (prev.accountAgreedPaise ?? 0);
      const next = withDerived({
        ...prev,
        cashAgreedPaise: event.cashAgreedPaise,
        accountAgreedPaise: event.accountAgreedPaise,
        cashOrderRaisedPaise: prev.cashOrderRaisedPaise + cashAdj,
        accountOrderRaisedPaise: prev.accountOrderRaisedPaise + accountAdj,
      });
      const newTotal = event.cashAgreedPaise + event.accountAgreedPaise;
      return { next, amountPaise: prev.cashAgreedPaise === null ? newTotal : newTotal - prevTotal, bucket: null, label: event.label ?? "Agreement revised" };
    }
    case "PLAN_CHANGE": {
      const cashAdj = event.cashRaisedAdjustmentPaise ?? 0;
      const accountAdj = event.accountRaisedAdjustmentPaise ?? 0;
      assertPaise(cashAdj, "cashRaisedAdjustmentPaise");
      assertPaise(accountAdj, "accountRaisedAdjustmentPaise");
      const next = withDerived({
        ...prev,
        cashOrderRaisedPaise: prev.cashOrderRaisedPaise + cashAdj,
        accountOrderRaisedPaise: prev.accountOrderRaisedPaise + accountAdj,
      });
      return { next, amountPaise: cashAdj + accountAdj, bucket: null, label: event.label ?? "Payment plan changed" };
    }
    case "OTHER_CHARGE_DEMAND": {
      const amount = positive(event.amountPaise, "Other charge demand");
      const next = withDerived({ ...prev, otherChargesDemandedPaise: prev.otherChargesDemandedPaise + amount });
      return { next, amountPaise: amount, bucket: null, label: event.label ?? "Other charge demanded" };
    }
    case "OTHER_CHARGE_PAYMENT": {
      const amount = positive(event.amountPaise, "Other charge payment");
      const next = withDerived({ ...prev, otherChargesPaidPaise: prev.otherChargesPaidPaise + amount });
      return { next, amountPaise: amount, bucket: null, label: event.label ?? "Other charge paid" };
    }
    case "OTHER_CHARGE_REVERSAL": {
      const amount = positive(event.amountPaise, "Other charge reversal");
      const next = withDerived({ ...prev, otherChargesPaidPaise: prev.otherChargesPaidPaise - amount });
      return { next, amountPaise: -amount, bucket: null, label: event.label ?? "Other charge payment reversed" };
    }
    case "CANCELLATION": {
      assertPaise(event.refundPaise, "refundPaise");
      assertPaise(event.deductionPaise, "deductionPaise");
      if (prev.isClosed) {
        throw new LedgerError("Ledger is already closed");
      }
      const next = withDerived({ ...prev, isClosed: true });
      return { next, amountPaise: event.refundPaise === 0 ? 0 : -event.refundPaise, bucket: null, label: event.label ?? "Booking cancelled" };
    }
    default: {
      const never: never = event;
      throw new LedgerError(`Unknown ledger event ${String(never)}`);
    }
  }
}

/** Builds the ledger row for a summary that already includes the event. */
function rowFrom(summary: LedgerSummary, event: LedgerEvent, amountPaise: number, bucket: Bucket | null, label: string): LedgerRow {
  return {
    seq: summary.seq,
    at: event.at,
    entryDate: ledgerEntryDate(event),
    event: event.kind,
    label,
    bucket,
    amountPaise,
    cashPaidCumPaise: summary.cashPaidPaise,
    accountPaidCumPaise: summary.accountPaidPaise,
    cashOrderRaisedPaise: summary.cashOrderRaisedPaise,
    accountOrderRaisedPaise: summary.accountOrderRaisedPaise,
    cashDuePaise: summary.cashDuePaise,
    accountDuePaise: summary.accountDuePaise,
    totalDuePaise: summary.totalDuePaise,
    otherChargesDuePaise: summary.otherChargesDuePaise,
    refNumber: event.refNumber ?? null,
    refId: event.refId ?? null,
    note: event.note ?? null,
  };
}

/** O(1) incremental step: applies one event to the previous summary and returns the next row and summary. */
export function appendLedgerRow(prevSummary: LedgerSummary, event: LedgerEvent): { row: LedgerRow; summary: LedgerSummary } {
  const applied = applyEvent(prevSummary, event);
  const summary: LedgerSummary = { ...applied.next, seq: prevSummary.seq + 1 };
  return { row: rowFrom(summary, event, applied.amountPaise, applied.bucket, applied.label), summary };
}

/** Epoch milliseconds of an event's `at` when it is an instant; 0 for a bare business date (sorts first within its day). */
function instantMs(at: string): number {
  return isValidDateString(at) ? 0 : toEpochMs(at);
}

/**
 * Sorts events by business date, then instant (so "+05:30" and "Z" stamps of the same moment compare equal),
 * then kind priority; stable; does not mutate the input.
 */
export function sortLedgerEvents<T extends LedgerEvent>(events: readonly T[]): T[] {
  const keyed = events.map((event, index) => ({ event, index, date: ledgerEntryDate(event), ms: instantMs(event.at) }));
  keyed.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    if (a.ms !== b.ms) {
      return a.ms - b.ms;
    }
    const byKind = ledgerKindPriority(a.event.kind) - ledgerKindPriority(b.event.kind);
    return byKind !== 0 ? byKind : a.index - b.index;
  });
  return keyed.map((k) => k.event);
}

export interface DerivedLedger {
  rows: LedgerRow[];
  summary: LedgerSummary;
}

/** Rebuilds the whole ledger from events (sorted by at, then kind priority) with running balances and a final summary. */
export function deriveLedger(events: readonly LedgerEvent[], opening?: LedgerSummary | null): DerivedLedger {
  let summary = opening ?? emptyLedgerSummary();
  const rows: LedgerRow[] = [];
  for (const event of sortLedgerEvents(events)) {
    const next = appendLedgerRow(summary, event);
    rows.push(next.row);
    summary = next.summary;
  }
  return { rows, summary };
}

export interface BucketCapInput {
  bucket: Bucket;
  bucketAgreedPaise: number;
  bucketPaidPaise: number;
  amountPaise: number;
}

export type BucketCapResult =
  | { ok: true }
  | { ok: false; code: "BUCKET_CAP_EXCEEDED"; message: string; details: { bucket: Bucket; agreedPaise: number; paidPaise: number; amountPaise: number; headroomPaise: number } };

/** Human label of a bucket. */
export function bucketLabel(bucket: Bucket): string {
  switch (bucket) {
    case "CASH":
      return "Cash";
    case "ACCOUNT":
      return "Account";
    default: {
      const never: never = bucket;
      throw new LedgerError(`Unknown bucket ${String(never)}`);
    }
  }
}

/** The only hard block: paid + amount must not exceed the bucket's agreed value. */
export function bucketCapCheck(input: BucketCapInput): BucketCapResult {
  assertPaise(input.bucketAgreedPaise, "bucketAgreedPaise");
  assertPaise(input.bucketPaidPaise, "bucketPaidPaise");
  assertPaise(input.amountPaise, "amountPaise");
  if (input.bucketPaidPaise + input.amountPaise <= input.bucketAgreedPaise) {
    return { ok: true };
  }
  const label = bucketLabel(input.bucket);
  return {
    ok: false,
    code: "BUCKET_CAP_EXCEEDED",
    message: `${label} agreed ${formatINR(input.bucketAgreedPaise)}; already received ${formatINR(input.bucketPaidPaise)}; cannot accept ${formatINR(input.amountPaise)} – revise the agreement first`,
    details: {
      bucket: input.bucket,
      agreedPaise: input.bucketAgreedPaise,
      paidPaise: input.bucketPaidPaise,
      amountPaise: input.amountPaise,
      headroomPaise: Math.max(0, input.bucketAgreedPaise - input.bucketPaidPaise),
    },
  };
}

/** Demand open/partial/paid status. */
export type DemandPaymentStatus = "OPEN" | "PARTIALLY_PAID" | "PAID";

export interface DemandForStatus {
  id: string;
  cashPaise: number;
  accountPaise: number;
}

export interface DemandStatusResult {
  id: string;
  status: DemandPaymentStatus;
  cashPaidPaise: number;
  accountPaidPaise: number;
  paidPaise: number;
}

/** Allocates paid money to demands FIFO per bucket (demands in raise order) and derives each demand's status. */
export function demandStatuses(demands: readonly DemandForStatus[], cashPaidPaise: number, accountPaidPaise: number): DemandStatusResult[] {
  assertPaise(cashPaidPaise, "cashPaidPaise");
  assertPaise(accountPaidPaise, "accountPaidPaise");
  let cashLeft = Math.max(0, cashPaidPaise);
  let accountLeft = Math.max(0, accountPaidPaise);
  return demands.map((demand) => {
    const cashAlloc = Math.min(cashLeft, Math.max(0, demand.cashPaise));
    const accountAlloc = Math.min(accountLeft, Math.max(0, demand.accountPaise));
    cashLeft -= cashAlloc;
    accountLeft -= accountAlloc;
    const total = demand.cashPaise + demand.accountPaise;
    const paid = cashAlloc + accountAlloc;
    const status: DemandPaymentStatus = paid >= total ? "PAID" : paid === 0 ? "OPEN" : "PARTIALLY_PAID";
    return { id: demand.id, status, cashPaidPaise: cashAlloc, accountPaidPaise: accountAlloc, paidPaise: paid };
  });
}
