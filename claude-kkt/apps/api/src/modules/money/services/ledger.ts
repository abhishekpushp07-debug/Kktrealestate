/**
 * Two-bucket ledger persistence (SPEC §11): appendEvent is the O(1) hot path under the booking advisory lock; rebuild derives every
 * row again from the source tables (demands, payments, other charges, revisions, cancellation) with the same domain engine and
 * reports where the stored summary disagrees — used by admin recompute, agreement/plan revisions and the integrity report (e).
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  appendLedgerRow,
  bpOfPaise,
  deriveLedger,
  diffLedgerRows,
  emptyLedgerSummary,
  ledgerEntryDate,
  toBasisPoints,
  type LedgerEvent,
  type LedgerRow,
  type LedgerRowDifference,
  type LedgerSummary,
} from "@kkt/domain";
import {
  agreementRevisions,
  bookingOtherCharges,
  bookingPlanRevisions,
  bookings,
  demands,
  ledgerEntries,
  payments,
  type AgreementValues,
  type Executor,
  type Tx,
} from "@kkt/db";
import { ApiError } from "../../../lib/errors.js";
import { lockBooking, type BookingRecord } from "../common.js";

/** A stored ledger row. */
export type LedgerEntryRecord = typeof ledgerEntries.$inferSelect;

/** Where the stored summary disagrees with the recomputation. */
export interface SummaryMismatch {
  field: string;
  stored: number;
  recomputed: number;
}

/** Result of appendEvent. */
export interface AppendResult {
  row: LedgerRow;
  summary: LedgerSummary;
}

/** Result of rebuild. */
export interface RebuildResult {
  rows: LedgerRow[];
  summary: LedgerSummary;
  /** Aggregate figures (booking summary columns, row count, final dues) that differ. */
  mismatches: SummaryMismatch[];
  /** Row-by-row differences between the stored ledger and the rebuild (event, source id, amounts, every running balance). */
  rowMismatches: LedgerRowDifference[];
  stored: Record<string, number>;
  recomputed: Record<string, number>;
}

/** Opening summary of a booking from its last ledger row (bucket figures) and its stored other-charge columns. */
function summaryFromLast(last: LedgerEntryRecord | undefined, booking: BookingRecord): LedgerSummary {
  const agreed = { cashAgreedPaise: booking.cashAgreedPaise, accountAgreedPaise: booking.accountAgreedPaise };
  if (!last) return emptyLedgerSummary(agreed);
  const cashDue = last.cashOrderRaisedPaise - last.cashPaidCumPaise;
  const accountDue = last.accountOrderRaisedPaise - last.accountPaidCumPaise;
  return {
    seq: last.seq,
    cashOrderRaisedPaise: last.cashOrderRaisedPaise,
    accountOrderRaisedPaise: last.accountOrderRaisedPaise,
    cashPaidPaise: last.cashPaidCumPaise,
    accountPaidPaise: last.accountPaidCumPaise,
    otherChargesDemandedPaise: booking.otherChargesDemandedPaise,
    otherChargesPaidPaise: booking.otherChargesPaidPaise,
    cashDuePaise: cashDue,
    accountDuePaise: accountDue,
    totalDuePaise: cashDue + accountDue,
    otherChargesDuePaise: booking.otherChargesDemandedPaise - booking.otherChargesPaidPaise,
    cashAgreedPaise: booking.cashAgreedPaise,
    accountAgreedPaise: booking.accountAgreedPaise,
    isClosed: last.event === "CANCELLATION",
  };
}

/** Insert values for a derived ledger row. */
function rowValues(companyId: string, bookingId: string, row: LedgerRow): typeof ledgerEntries.$inferInsert {
  return {
    companyId,
    bookingId,
    seq: row.seq,
    at: new Date(row.at),
    entryDate: row.entryDate,
    event: row.event,
    label: row.label,
    bucket: row.bucket,
    amountPaise: row.amountPaise,
    cashPaidCumPaise: row.cashPaidCumPaise,
    accountPaidCumPaise: row.accountPaidCumPaise,
    cashOrderRaisedPaise: row.cashOrderRaisedPaise,
    accountOrderRaisedPaise: row.accountOrderRaisedPaise,
    cashDuePaise: row.cashDuePaise,
    accountDuePaise: row.accountDuePaise,
    totalDuePaise: row.totalDuePaise,
    otherChargesDuePaise: row.otherChargesDuePaise,
    refNumber: row.refNumber,
    refId: row.refId,
    note: row.note,
  };
}

/** Writes the summary columns of a booking from a ledger summary (raised % = Σ percent of non-void demands). */
async function writeSummary(tx: Executor, bookingId: string, summary: LedgerSummary): Promise<void> {
  await tx
    .update(bookings)
    .set({
      cashOrderRaisedPaise: summary.cashOrderRaisedPaise,
      accountOrderRaisedPaise: summary.accountOrderRaisedPaise,
      cashPaidPaise: summary.cashPaidPaise,
      accountPaidPaise: summary.accountPaidPaise,
      otherChargesDemandedPaise: summary.otherChargesDemandedPaise,
      otherChargesPaidPaise: summary.otherChargesPaidPaise,
      raisedPercent: sql`(select coalesce(sum(d.percent), 0) from demands d where d.booking_id = ${bookingId}::uuid and d.status <> 'VOID')`,
    })
    .where(eq(bookings.id, bookingId));
}

/**
 * Appends one event to a booking's ledger under the booking advisory lock: loads the last row (or the empty summary), computes the
 * next row with the domain engine, inserts it (seq = last + 1) and updates the booking's summary columns in the same unit of work.
 * The two reads travel together, and so do the two writes (pipelined on the transaction's connection: one round trip each).
 * `locked`: the caller already holds the booking locks (lockBooking) in this transaction, so they are not requested again.
 */
export async function appendEvent(
  tx: Tx,
  bookingId: string,
  event: LedgerEvent,
  opts: { locked?: boolean } = {},
): Promise<AppendResult> {
  if (!opts.locked) await lockBooking(tx, bookingId);
  const [[booking], [last]] = await Promise.all([
    tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1),
    tx
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.bookingId, bookingId))
      .orderBy(desc(ledgerEntries.seq))
      .limit(1),
  ]);
  if (!booking) throw ApiError.notFound("Booking");
  const prev = summaryFromLast(last, booking);
  const next = appendLedgerRow(prev, event);
  await Promise.all([
    tx.insert(ledgerEntries).values(rowValues(booking.companyId, bookingId, next.row)),
    writeSummary(tx, bookingId, next.summary),
  ]);
  return next;
}

/** Agreement values in force at an instant, given the revisions in time order and the booking's current values. */
function agreedAt(
  revisions: readonly { revisedAt: Date; before: AgreementValues; after: AgreementValues }[],
  current: AgreementValues,
  at: Date,
): AgreementValues {
  let values: AgreementValues = revisions[0]?.before ?? current;
  for (const r of revisions) {
    if (r.revisedAt.getTime() <= at.getTime()) values = r.after;
  }
  return values;
}

/** Telescoping amounts of a demand for given agreed values (same rounding as the dues engine). */
export function demandAmountsFor(
  d: { percent: number; cumulativePercent: number },
  agreed: { cash_agreed_paise: number; account_agreed_paise: number },
): { cashPaise: number; accountPaise: number } {
  const cumBp = toBasisPoints(d.cumulativePercent);
  const prevBp = cumBp - toBasisPoints(d.percent);
  return {
    cashPaise: bpOfPaise(agreed.cash_agreed_paise, cumBp) - bpOfPaise(agreed.cash_agreed_paise, prevBp),
    accountPaise: bpOfPaise(agreed.account_agreed_paise, cumBp) - bpOfPaise(agreed.account_agreed_paise, prevBp),
  };
}

type DemandRecord = typeof demands.$inferSelect;
type PaymentRecord = typeof payments.$inferSelect;
type OtherChargeRecord = typeof bookingOtherCharges.$inferSelect;

/** Event builders shared by the live append path and the rebuild so both produce identical rows. */
export const events = {
  demand(
    d: Pick<DemandRecord, "id" | "installmentName" | "triggerLabel" | "demandNumber" | "postedAt">,
    amounts: { cashPaise: number; accountPaise: number },
  ): LedgerEvent {
    return {
      kind: "DEMAND",
      at: d.postedAt.toISOString(),
      label: d.installmentName,
      note: d.triggerLabel,
      refNumber: d.demandNumber,
      refId: d.id,
      cashPaise: amounts.cashPaise,
      accountPaise: amounts.accountPaise,
    };
  },
  otherChargeDemand(c: Pick<OtherChargeRecord, "id" | "name" | "demandNumber" | "totalPaise">, at: Date): LedgerEvent {
    return {
      kind: "OTHER_CHARGE_DEMAND",
      at: at.toISOString(),
      label: c.name,
      refNumber: c.demandNumber,
      refId: c.id,
      amountPaise: c.totalPaise,
    };
  },
  payment(
    p: Pick<PaymentRecord, "id" | "receiptNumber" | "amountPaise" | "modeCode" | "bucket" | "paymentDate">,
    at: Date,
  ): LedgerEvent {
    return {
      kind: "PAYMENT",
      at: at.toISOString(),
      entryDate: p.paymentDate,
      bucket: p.bucket ?? "CASH",
      amountPaise: p.amountPaise,
      label: `Receipt ${p.receiptNumber}`,
      refNumber: p.receiptNumber,
      refId: p.id,
      note: p.modeCode,
    };
  },
  reversal(
    p: Pick<PaymentRecord, "id" | "receiptNumber" | "amountPaise" | "bucket" | "reversalReason">,
    at: Date,
  ): LedgerEvent {
    return {
      kind: "REVERSAL",
      at: at.toISOString(),
      bucket: p.bucket ?? "CASH",
      amountPaise: p.amountPaise,
      label: `Reversal of ${p.receiptNumber}`,
      refNumber: p.receiptNumber,
      refId: p.id,
      note: p.reversalReason ?? null,
    };
  },
  otherChargePayment(
    p: Pick<PaymentRecord, "id" | "receiptNumber" | "amountPaise" | "modeCode" | "paymentDate">,
    chargeName: string,
    at: Date,
  ): LedgerEvent {
    return {
      kind: "OTHER_CHARGE_PAYMENT",
      at: at.toISOString(),
      entryDate: p.paymentDate,
      amountPaise: p.amountPaise,
      label: `${chargeName} – Receipt ${p.receiptNumber}`,
      refNumber: p.receiptNumber,
      refId: p.id,
      note: p.modeCode,
    };
  },
  otherChargeReversal(
    p: Pick<PaymentRecord, "id" | "receiptNumber" | "amountPaise" | "reversalReason">,
    at: Date,
  ): LedgerEvent {
    return {
      kind: "OTHER_CHARGE_REVERSAL",
      at: at.toISOString(),
      amountPaise: p.amountPaise,
      label: `Reversal of ${p.receiptNumber}`,
      refNumber: p.receiptNumber,
      refId: p.id,
      note: p.reversalReason ?? null,
    };
  },
  agreementChange(
    r: { id: string; revisedAt: Date; reason: string; after: AgreementValues },
    adj: { cash: number; account: number },
  ): LedgerEvent {
    return {
      kind: "AGREEMENT_CHANGE",
      at: r.revisedAt.toISOString(),
      label: "Agreement revised",
      note: r.reason,
      refId: r.id,
      cashAgreedPaise: r.after.cash_agreed_paise,
      accountAgreedPaise: r.after.account_agreed_paise,
      cashRaisedAdjustmentPaise: adj.cash,
      accountRaisedAdjustmentPaise: adj.account,
    };
  },
  planChange(
    r: { id: string; at: Date; reason: string; afterName: string },
    adj: { cash: number; account: number },
  ): LedgerEvent {
    return {
      kind: "PLAN_CHANGE",
      at: r.at.toISOString(),
      label: `Plan changed to ${r.afterName}`,
      note: r.reason,
      refId: r.id,
      cashRaisedAdjustmentPaise: adj.cash,
      accountRaisedAdjustmentPaise: adj.account,
    };
  },
  cancellation(c: { at: string; reason: string; refund_paise: number; deduction_paise: number }): LedgerEvent {
    return {
      kind: "CANCELLATION",
      at: c.at,
      label: "Booking cancelled",
      note: c.reason,
      refundPaise: c.refund_paise,
      deductionPaise: c.deduction_paise,
    };
  },
};

/** Rebuilds the event list of a booking from its source tables. */
export async function sourceEvents(
  db: Executor,
  booking: BookingRecord,
): Promise<{ events: LedgerEvent[]; opening: LedgerSummary }> {
  const id = booking.id;
  const [demandRows, paymentRows, chargeRows, revisionRows, planRevisionRows] = await Promise.all([
    db
      .select()
      .from(demands)
      .where(and(eq(demands.bookingId, id), ne(demands.status, "VOID")))
      .orderBy(asc(demands.postedAt)),
    db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, id), inArray(payments.status, ["CLEARED", "REVERSED"]))),
    db.select().from(bookingOtherCharges).where(eq(bookingOtherCharges.bookingId, id)),
    db
      .select()
      .from(agreementRevisions)
      .where(eq(agreementRevisions.bookingId, id))
      .orderBy(asc(agreementRevisions.revisedAt)),
    db
      .select()
      .from(bookingPlanRevisions)
      .where(eq(bookingPlanRevisions.bookingId, id))
      .orderBy(asc(bookingPlanRevisions.at)),
  ]);
  const current: AgreementValues = {
    agreement_value_paise: booking.agreementValuePaise,
    cash_agreed_paise: booking.cashAgreedPaise,
    account_agreed_paise: booking.accountAgreedPaise,
  };
  const initial = revisionRows[0]?.before ?? current;
  const out: LedgerEvent[] = [];
  for (const d of demandRows)
    out.push(events.demand(d, demandAmountsFor(d, agreedAt(revisionRows, current, d.postedAt))));
  for (const c of chargeRows) if (c.demandedAt) out.push(events.otherChargeDemand(c, c.demandedAt));
  const chargeName = new Map(chargeRows.map((c) => [c.id, c.name]));
  for (const p of paymentRows) {
    const at = p.clearedAt ?? p.postedAt;
    if (p.against === "FLAT_VALUE" && p.bucket) {
      out.push(events.payment(p, at));
      if (p.status === "REVERSED" && p.reversedAt) out.push(events.reversal(p, p.reversedAt));
    } else if (p.against === "OTHER_CHARGE") {
      const name = (p.otherChargeId && chargeName.get(p.otherChargeId)) || "Other charge";
      out.push(events.otherChargePayment(p, name, at));
      if (p.status === "REVERSED" && p.reversedAt) out.push(events.otherChargeReversal(p, p.reversedAt));
    }
  }
  for (const r of revisionRows) {
    let cash = 0;
    let account = 0;
    for (const d of demandRows) {
      if (d.postedAt.getTime() > r.revisedAt.getTime()) continue;
      const before = demandAmountsFor(d, r.before);
      const after = demandAmountsFor(d, r.after);
      cash += after.cashPaise - before.cashPaise;
      account += after.accountPaise - before.accountPaise;
    }
    out.push(events.agreementChange(r, { cash, account }));
  }
  for (const r of planRevisionRows)
    out.push(
      events.planChange(
        { id: r.id, at: r.at, reason: r.reason, afterName: r.afterPlanSnapshot.name },
        { cash: 0, account: 0 },
      ),
    );
  if (booking.cancellation) out.push(events.cancellation(booking.cancellation));
  return {
    events: out,
    opening: emptyLedgerSummary({
      cashAgreedPaise: initial.cash_agreed_paise,
      accountAgreedPaise: initial.account_agreed_paise,
    }),
  };
}

/** Summary figures compared by the integrity report. */
function summaryFigures(s: {
  cashOrderRaisedPaise: number;
  accountOrderRaisedPaise: number;
  cashPaidPaise: number;
  accountPaidPaise: number;
  otherChargesDemandedPaise: number;
  otherChargesPaidPaise: number;
}): Record<string, number> {
  return {
    cash_order_raised_paise: s.cashOrderRaisedPaise,
    account_order_raised_paise: s.accountOrderRaisedPaise,
    cash_paid_paise: s.cashPaidPaise,
    account_paid_paise: s.accountPaidPaise,
    other_charges_demanded_paise: s.otherChargesDemandedPaise,
    other_charges_paid_paise: s.otherChargesPaidPaise,
  };
}

/**
 * Derives the whole ledger again from the source tables — in the canonical posting order the live path appends in (domain
 * sortLedgerEvents) — and compares it with the stored booking summary AND, row by row, with the stored ledger (integrity finding e).
 * With `write` (admin recompute / repair / revisions / undo) the stored rows and summary are replaced by the recomputation (under the booking lock).
 */
export async function rebuild(
  tx: Executor,
  bookingId: string,
  opts: { write?: boolean | "if-changed" } = {},
): Promise<RebuildResult & { written: boolean }> {
  if (opts.write) await lockBooking(tx as Tx, bookingId);
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw ApiError.notFound("Booking");
  const { events, opening } = await sourceEvents(tx, booking);
  const derived = deriveLedger(events, opening);
  const stored = summaryFigures(booking);
  const recomputed = summaryFigures(derived.summary);
  const storedRows = await tx
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.bookingId, bookingId))
    .orderBy(asc(ledgerEntries.seq));
  const last = storedRows[storedRows.length - 1];
  stored["ledger_rows"] = storedRows.length;
  recomputed["ledger_rows"] = derived.rows.length;
  stored["ledger_total_due_paise"] = last ? last.totalDuePaise : 0;
  recomputed["ledger_total_due_paise"] = derived.summary.totalDuePaise;
  stored["ledger_other_charges_due_paise"] = last ? last.otherChargesDuePaise : 0;
  recomputed["ledger_other_charges_due_paise"] = derived.summary.otherChargesDuePaise;
  const mismatches: SummaryMismatch[] = [];
  for (const field of Object.keys(recomputed)) {
    const s = stored[field] ?? 0;
    const r = recomputed[field] ?? 0;
    if (s !== r) mismatches.push({ field, stored: s, recomputed: r });
  }
  const rowMismatches = diffLedgerRows(storedRows, derived.rows);
  // "if-changed" (LEDGER_REBUILD): rewrite only a ledger/summary that differs from the canonical rebuild
  const write =
    opts.write === true || (opts.write === "if-changed" && (mismatches.length > 0 || rowMismatches.length > 0));
  if (write) {
    await tx.delete(ledgerEntries).where(eq(ledgerEntries.bookingId, bookingId));
    if (derived.rows.length > 0)
      await tx.insert(ledgerEntries).values(derived.rows.map((r) => rowValues(booking.companyId, bookingId, r)));
    await writeSummary(tx, bookingId, derived.summary);
  }
  return {
    rows: derived.rows,
    summary: derived.summary,
    mismatches,
    rowMismatches,
    stored,
    recomputed,
    written: write,
  };
}

/** Stored ledger rows of a booking in seq order. */
export async function ledgerRows(db: Executor, bookingId: string): Promise<LedgerEntryRecord[]> {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.bookingId, bookingId)).orderBy(asc(ledgerEntries.seq));
}

/** Business date of an event (re-exported for callers that need the same rule). */
export { ledgerEntryDate };
