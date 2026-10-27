/**
 * Two-bucket ledger persistence (SPEC §11) — the booking ledger is a BOOK OF RECORD (contract C7): rows are only ever appended.
 *   - appendEvent is the O(1) hot path under the booking advisory lock: one row at the end of the booking's CURRENT epoch
 *     (bookings.ledger_epoch). A voided demand appends a DEMAND_VOIDED row; it never vanishes from the ledger.
 *   - rebuild derives every row again from the source tables (demands — voided ones included —, payments, other charges, revisions,
 *     cancellation) with the same domain engine and compares them with the current epoch row by row. With `write`, a differing result is
 *     written as a NEW epoch (ledger_epoch + 1) with a ledger_rebuilds row (reason, actor, summary diff) and the superseded epoch is closed
 *     by a LEDGER_RESTATED row; an identical result writes nothing. Nothing is ever UPDATEd or DELETEd (src/sql/0006_money_guards.sql).
 * Every reader (ledger endpoint, summaries, integrity, reports, portal) reads the current epoch; older epochs stay readable as history.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { LedgerRebuildReason, LedgerRebuildSummary, LedgerTotals } from "@kkt/contracts";
import {
  appendLedgerRow,
  bpOfPaise,
  deriveLedger,
  diffLedgerRows,
  emptyLedgerSummary,
  ledgerEntryDate,
  toBasisPoints,
  todayIST,
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
  ledgerRebuilds,
  payments,
  type AgreementValues,
  type Executor,
  type Tx,
} from "@kkt/db";
import { ApiError } from "../../../lib/errors.js";
import { lockBooking, type BookingRecord, type MoneyActor } from "../common.js";

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
  /** Row-by-row differences between the current epoch and the rebuild (event, source id, amounts, every running balance). */
  rowMismatches: LedgerRowDifference[];
  stored: Record<string, number>;
  recomputed: Record<string, number>;
}

/** Options of rebuild(). */
export interface RebuildOptions {
  /**
   * Write the result: `true` and `"if-changed"` behave the same since the ledger became append-only (contract C7) — a result that differs
   * from the current epoch is written as a new epoch, the booking summary columns are corrected when they differ, and an identical result
   * writes nothing. Without `write` the rebuild only compares (integrity finding e).
   */
  write?: boolean | "if-changed";
  /** Why the ledger is being rebuilt (ledger_rebuilds.reason); default ADMIN_RECOMPUTE. */
  reason?: LedgerRebuildReason;
  /** Who caused it (a STAFF actor is recorded as ledger_rebuilds.actor_id; anything else is the system). */
  actor?: MoneyActor | null;
}

/** What a written rebuild did. */
export interface RebuildWrite {
  /** True when anything was written (a new epoch and/or corrected summary columns). */
  written: boolean;
  /** True when the rows differed and were written as a new epoch. */
  restated: boolean;
  /** The booking's current epoch after the call. */
  epoch: number;
  /** ledger_rebuilds.id of the restatement, when one was written. */
  rebuildId: string | null;
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

/**
 * The booking's current epoch as a scalar subquery: lets a ledger read filter on (booking_id, epoch) — the leading columns of
 * ledger_entries_booking_epoch_seq_uq — without a separate round trip for bookings.ledger_epoch.
 */
export function currentEpochOf(bookingId: string | SQL): SQL<number> {
  return sql<number>`(select ${bookings.ledgerEpoch} from ${bookings} where ${bookings.id} = ${bookingId})`;
}

/** WHERE clause of a booking's ledger rows in one epoch (default: the current one). */
export function epochRows(bookingId: string, epoch?: number): SQL {
  return and(
    eq(ledgerEntries.bookingId, bookingId),
    eq(ledgerEntries.epoch, epoch ?? currentEpochOf(bookingId)),
  ) as SQL;
}

/** Insert values for a derived ledger row. */
function rowValues(
  companyId: string,
  bookingId: string,
  row: LedgerRow,
  epoch: number,
): typeof ledgerEntries.$inferInsert {
  return {
    companyId,
    bookingId,
    epoch,
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
export async function writeSummary(tx: Executor, bookingId: string, summary: LedgerSummary): Promise<void> {
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
  const next = await prepareAppend(tx, bookingId, event);
  await Promise.all([tx.insert(ledgerEntries).values(next.values), writeSummary(tx, bookingId, next.summary)]);
  return next;
}

/**
 * The next ledger row of a booking's current epoch — computed, NOT written — with its insert values. For a caller that must write the
 * row later in its own statement (payment posting writes it in the same statement that allocates the receipt number). The caller holds
 * the booking locks and writes nothing else to the ledger in between.
 */
export async function prepareAppend(
  tx: Executor,
  bookingId: string,
  event: LedgerEvent,
): Promise<AppendResult & { values: typeof ledgerEntries.$inferInsert }> {
  const [[booking], [last]] = await Promise.all([
    tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1),
    tx.select().from(ledgerEntries).where(epochRows(bookingId)).orderBy(desc(ledgerEntries.seq)).limit(1),
  ]);
  if (!booking) throw ApiError.notFound("Booking");
  const prev = summaryFromLast(last, booking);
  const next = appendLedgerRow(prev, event);
  return { ...next, values: rowValues(booking.companyId, bookingId, next.row, booking.ledgerEpoch) };
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
  /**
   * The compensating row of a voided demand (contract C7): it takes back exactly what the ledger raised for the demand by the time it was
   * voided — the demand's telescoping amounts under the agreement in force at the void (its DEMAND row plus every AGREEMENT_CHANGE
   * re-cut since). The live void and the rebuild compute it the same way (demandAmountsFor), so they produce the same row.
   */
  demandVoided(
    d: Pick<DemandRecord, "id" | "installmentName" | "demandNumber" | "voidReason">,
    amounts: { cashPaise: number; accountPaise: number },
    at: Date,
  ): LedgerEvent {
    return {
      kind: "DEMAND_VOIDED",
      at: at.toISOString(),
      label: `${d.installmentName} (voided)`,
      note: d.voidReason,
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

/** The instant a VOID demand was voided (voided_at; rows voided before that column was always set fall back to updated_at); null otherwise. */
function voidInstant(d: Pick<DemandRecord, "status" | "voidedAt" | "updatedAt">): Date | null {
  if (d.status !== "VOID") return null;
  return d.voidedAt ?? d.updatedAt;
}

/** Rebuilds the event list of a booking from its source tables. */
export async function sourceEvents(
  db: Executor,
  booking: BookingRecord,
): Promise<{ events: LedgerEvent[]; opening: LedgerSummary }> {
  const id = booking.id;
  const [demandRows, paymentRows, chargeRows, revisionRows, planRevisionRows] = await Promise.all([
    // voided demands included: their DEMAND row stays in the book and a DEMAND_VOIDED row takes it back out
    db.select().from(demands).where(eq(demands.bookingId, id)).orderBy(asc(demands.postedAt)),
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
  const cancelledAt = booking.cancellation ? new Date(booking.cancellation.at).getTime() : null;
  const out: LedgerEvent[] = [];
  for (const d of demandRows) {
    out.push(events.demand(d, demandAmountsFor(d, agreedAt(revisionRows, current, d.postedAt))));
    const voidedAt = voidInstant(d);
    // a void after the ledger was closed (a cancelled booking touched by an older stage undo) is not a ledger event: the closed book
    // keeps the demand as it stood at closing
    if (voidedAt && (cancelledAt === null || voidedAt.getTime() < cancelledAt))
      out.push(events.demandVoided(d, demandAmountsFor(d, agreedAt(revisionRows, current, voidedAt)), voidedAt));
  }
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
      // the demands live when the revision re-cut them: raised before it and not voided before it
      if (d.postedAt.getTime() > r.revisedAt.getTime()) continue;
      const voidedAt = voidInstant(d);
      if (voidedAt && voidedAt.getTime() <= r.revisedAt.getTime()) continue;
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
  if (booking.cancellation)
    out.push(
      events.cancellation({
        ...booking.cancellation,
        // the money columns (migration 0005) are the source of truth; the jsonb keeps the history text
        refund_paise: booking.cancellationRefundPaise ?? booking.cancellation.refund_paise,
        deduction_paise: booking.cancellationDeductionPaise ?? booking.cancellation.deduction_paise,
      }),
    );
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

/** The six C7 totals of a ledger position (a stored row, a derived summary, or nothing yet). */
export function ledgerTotals(
  x:
    | Pick<
        LedgerEntryRecord,
        | "cashDuePaise"
        | "accountDuePaise"
        | "totalDuePaise"
        | "otherChargesDuePaise"
        | "cashPaidCumPaise"
        | "accountPaidCumPaise"
      >
    | null
    | undefined,
): LedgerTotals {
  return {
    cash_due_paise: x?.cashDuePaise ?? 0,
    account_due_paise: x?.accountDuePaise ?? 0,
    total_due_paise: x?.totalDuePaise ?? 0,
    other_charges_due_paise: x?.otherChargesDuePaise ?? 0,
    cash_paid_paise: x?.cashPaidCumPaise ?? 0,
    account_paid_paise: x?.accountPaidCumPaise ?? 0,
  };
}

/** C7 totals of a domain summary. */
function summaryTotals(s: LedgerSummary): LedgerTotals {
  return {
    cash_due_paise: s.cashDuePaise,
    account_due_paise: s.accountDuePaise,
    total_due_paise: s.totalDuePaise,
    other_charges_due_paise: s.otherChargesDuePaise,
    cash_paid_paise: s.cashPaidPaise,
    account_paid_paise: s.accountPaidPaise,
  };
}

/**
 * Writes a restatement (contract C7): the canonical rows as epoch n + 1, a ledger_rebuilds row (reason, actor, summary diff), a
 * LEDGER_RESTATED row closing epoch n (zero amount, its last balances carried, ref_id = the rebuild) and bookings.ledger_epoch = n + 1.
 * Inserts only. The caller holds the booking locks.
 */
async function writeEpoch(
  tx: Executor,
  booking: BookingRecord,
  storedRows: readonly LedgerEntryRecord[],
  derived: { rows: LedgerRow[]; summary: LedgerSummary },
  rowMismatches: readonly LedgerRowDifference[],
  opts: RebuildOptions,
): Promise<string> {
  const from = booking.ledgerEpoch;
  const to = from + 1;
  const at = new Date();
  const reason: LedgerRebuildReason = opts.reason ?? "ADMIN_RECOMPUTE";
  const last = storedRows[storedRows.length - 1];
  const summary: LedgerRebuildSummary = {
    rows_before: storedRows.length,
    rows_after: derived.rows.length,
    differences: rowMismatches.map((d) => ({ ...d })),
    before: ledgerTotals(last),
    after: summaryTotals(derived.summary),
  };
  const [log] = await tx
    .insert(ledgerRebuilds)
    .values({
      companyId: booking.companyId,
      bookingId: booking.id,
      fromEpoch: from,
      toEpoch: to,
      reason,
      actorId: opts.actor?.type === "STAFF" ? (opts.actor.id ?? null) : null,
      at,
      summary: summary as unknown as Record<string, unknown>,
    })
    .returning({ id: ledgerRebuilds.id });
  if (!log) throw new Error("ledger_rebuilds insert returned no row");
  const writes: Promise<unknown>[] = [];
  if (last)
    writes.push(
      tx.insert(ledgerEntries).values({
        companyId: booking.companyId,
        bookingId: booking.id,
        epoch: from,
        seq: last.seq + 1,
        at,
        entryDate: todayIST(at),
        event: "LEDGER_RESTATED",
        label: `Ledger restated as epoch ${to}`,
        bucket: null,
        amountPaise: 0,
        cashPaidCumPaise: last.cashPaidCumPaise,
        accountPaidCumPaise: last.accountPaidCumPaise,
        cashOrderRaisedPaise: last.cashOrderRaisedPaise,
        accountOrderRaisedPaise: last.accountOrderRaisedPaise,
        cashDuePaise: last.cashDuePaise,
        accountDuePaise: last.accountDuePaise,
        totalDuePaise: last.totalDuePaise,
        otherChargesDuePaise: last.otherChargesDuePaise,
        refNumber: null,
        refId: log.id,
        note: reason,
      }),
    );
  if (derived.rows.length > 0)
    writes.push(
      tx.insert(ledgerEntries).values(derived.rows.map((r) => rowValues(booking.companyId, booking.id, r, to))),
    );
  writes.push(tx.update(bookings).set({ ledgerEpoch: to }).where(eq(bookings.id, booking.id)));
  await Promise.all(writes);
  return log.id;
}

/**
 * Derives the whole ledger again from the source tables — in the canonical posting order the live path appends in (domain
 * sortLedgerEvents) — and compares it with the stored booking summary AND, row by row, with the current epoch (integrity finding e).
 * With `write` (admin recompute / repair / revisions / undo / LEDGER_REBUILD, under the booking lock) a differing result becomes a new
 * epoch (see writeEpoch) and differing summary columns are corrected; an identical result writes nothing.
 */
export async function rebuild(
  tx: Executor,
  bookingId: string,
  opts: RebuildOptions = {},
): Promise<RebuildResult & RebuildWrite> {
  const write = opts.write === true || opts.write === "if-changed";
  if (write) await lockBooking(tx as Tx, bookingId);
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw ApiError.notFound("Booking");
  const [{ events, opening }, storedRows] = await Promise.all([
    sourceEvents(tx, booking),
    tx.select().from(ledgerEntries).where(epochRows(bookingId, booking.ledgerEpoch)).orderBy(asc(ledgerEntries.seq)),
  ]);
  const derived = deriveLedger(events, opening);
  const stored = summaryFigures(booking);
  const recomputed = summaryFigures(derived.summary);
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
  const out: RebuildWrite = { written: false, restated: false, epoch: booking.ledgerEpoch, rebuildId: null };
  if (write && rowMismatches.length > 0) {
    out.rebuildId = await writeEpoch(tx, booking, storedRows, derived, rowMismatches, opts);
    out.restated = true;
    out.epoch = booking.ledgerEpoch + 1;
  }
  if (write && (out.restated || mismatches.length > 0)) {
    await writeSummary(tx, bookingId, derived.summary);
    out.written = true;
  }
  return { rows: derived.rows, summary: derived.summary, mismatches, rowMismatches, stored, recomputed, ...out };
}

/** Stored ledger rows of a booking in seq order: the current epoch (the book of record), or an older one when `epoch` is given. */
export async function ledgerRows(db: Executor, bookingId: string, epoch?: number): Promise<LedgerEntryRecord[]> {
  return db.select().from(ledgerEntries).where(epochRows(bookingId, epoch)).orderBy(asc(ledgerEntries.seq));
}

/** Restatements of a booking's ledger (newest first), with the acting staff user's name. */
export async function ledgerRebuildRows(
  db: Executor,
  bookingId: string,
): Promise<(typeof ledgerRebuilds.$inferSelect & { actorName: string | null })[]> {
  const rows = await db
    .select({
      r: ledgerRebuilds,
      actorName: sql<string | null>`(select u.name from users u where u.id = ${ledgerRebuilds.actorId})`,
    })
    .from(ledgerRebuilds)
    .where(eq(ledgerRebuilds.bookingId, bookingId))
    .orderBy(desc(ledgerRebuilds.at), desc(ledgerRebuilds.toEpoch));
  return rows.map((x) => ({ ...x.r, actorName: x.actorName }));
}

/** Business date of an event (re-exported for callers that need the same rule). */
export { ledgerEntryDate };
