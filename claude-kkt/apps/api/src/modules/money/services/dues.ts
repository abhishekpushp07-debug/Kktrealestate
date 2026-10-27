/**
 * Auto-dues engine persistence (SPEC §10): raises installment demands whose trigger is satisfied (idempotent by the partial unique
 * index on (booking, installment_seq) WHERE status <> VOID), voids stage demands on undo, and keeps demand statuses (FIFO per bucket) in step
 * with the ledger. Pure maths lives in @kkt/domain (evaluateDues, installmentAmounts, demandStatuses).
 */
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { ChargeDemandAt, DuesFailure } from "@kkt/contracts";
import { bookingOtherCharges, bookings, demands, payments, type DB, type Executor, type Tx } from "@kkt/db";
import { addDays, demandStageId, demandStatuses, evaluateDues, formatINR, type TowerStage } from "@kkt/domain";
import { writeAudit } from "../../../lib/audit.js";
import { ApiError, databaseErrorCode, mapMoneyError } from "../../../lib/errors.js";
import { logger } from "../../../lib/logger.js";
import { nextNumber } from "../../../lib/numbering.js";
import { duesBookingFailures } from "../metrics.js";
import { notify, notifyRole, withdraw } from "../../notifications/index.js";
import {
  ACCOUNTS_ROLES,
  Clock,
  loadCompanyRow,
  lockBooking,
  lockBookingsInOrder,
  moneyTransaction,
  numberingOf,
  snapshotInstallments,
  loadTowerStages,
  todayDate,
  type BookingRecord,
  type CompanyRecord,
  type MoneyActor,
  SYSTEM_MONEY_ACTOR,
} from "../common.js";
import { appendEvent, demandAmountsFor, events, rebuild } from "./ledger.js";

export type { DuesFailure } from "@kkt/contracts";

export type DemandRecord = typeof demands.$inferSelect;
export type OtherChargeRecord = typeof bookingOtherCharges.$inferSelect;

/** Options shared by the raise functions. */
export interface RaiseOptions {
  /** Business date the engine evaluates triggers against (default: today IST). */
  today?: string;
  actor?: MoneyActor;
  /** Strictly increasing instants for ledger ordering inside the unit of work. */
  clock?: Clock;
  /** Preloaded company row (numbering, settings). */
  company?: CompanyRecord;
  /** Preloaded tower stages of the booking's block. */
  towerStages?: TowerStage[];
}

/** Result of raising dues for one booking. */
export interface RaiseResult {
  raised: DemandRecord[];
  notifications: number;
}

/** Non-void demands of a booking in posting order. */
export async function nonVoidDemands(db: Executor, bookingId: string): Promise<DemandRecord[]> {
  return db
    .select()
    .from(demands)
    .where(and(eq(demands.bookingId, bookingId), ne(demands.status, "VOID")))
    .orderBy(asc(demands.postedAt), asc(demands.installmentSeq));
}

/** Customer recipients of a booking (primary + co-applicants). */
export async function bookingRecipients(
  db: Executor,
  booking: Pick<BookingRecord, "id" | "customerId">,
): Promise<{ type: "CUSTOMER"; id: string }[]> {
  const co = await db.execute<{ customer_id: string }>(
    sql`select customer_id from booking_co_applicants where booking_id = ${booking.id}::uuid`,
  );
  return [
    { type: "CUSTOMER" as const, id: booking.customerId },
    ...co.map((c) => ({ type: "CUSTOMER" as const, id: c.customer_id })),
  ];
}

/**
 * raise_due_installments(booking): evaluates the plan snapshot against the tower's stages and today, inserts ONE demand per satisfied
 * installment (ON CONFLICT on the partial unique index does nothing), appends a DEMAND ledger row and notifies the buyer and Accounts.
 * Also raises ON_POSSESSION other-charge demands once the possession stage is complete. Runs under the booking advisory lock.
 */
export async function raiseDues(tx: Tx, booking: BookingRecord, opts: RaiseOptions = {}): Promise<RaiseResult> {
  if (booking.status !== "ACTIVE") return { raised: [], notifications: 0 };
  const clock = opts.clock ?? new Clock();
  await lockBooking(tx, booking.id, clock);
  const today = opts.today ?? todayDate();
  const actor = opts.actor ?? SYSTEM_MONEY_ACTOR;
  const company = opts.company ?? (await loadCompanyRow(tx, booking.companyId));
  const towerStages = opts.towerStages ?? (await loadTowerStages(tx, booking.blockId));
  const existing = await nonVoidDemands(tx, booking.id);
  const due = evaluateDues({
    booking: {
      bookingDate: booking.bookingDate,
      cashAgreedPaise: booking.cashAgreedPaise,
      accountAgreedPaise: booking.accountAgreedPaise,
      planSnapshot: { installments: snapshotInstallments(booking.planSnapshot) },
    },
    towerStages,
    existingDemands: existing.map((d) => ({
      installmentSeq: d.installmentSeq,
      installmentName: d.installmentName,
      status: d.status,
      dueDate: d.dueDate,
      cashPaise: d.cashDemandPaise,
      accountPaise: d.accountDemandPaise,
      paidPaise: d.paidPaise,
    })),
    today,
    defaultDueDays: company.settings.demand_due_days,
  });
  const raised: DemandRecord[] = [];
  let notifications = 0;
  for (const d of due) {
    const demandNumber = await nextNumber(tx, numberingOf(company), "demand", today);
    const postedAt = clock.next();
    const [row] = await tx
      .insert(demands)
      .values({
        companyId: booking.companyId,
        bookingId: booking.id,
        projectId: booking.projectId,
        blockId: booking.blockId,
        customerId: booking.customerId,
        demandNumber,
        installmentSeq: d.seq,
        installmentName: d.name,
        triggerType: d.triggerType,
        triggerLabel: d.triggerLabel,
        triggerStageId: d.triggerStageId,
        percent: Number(d.percent),
        cumulativePercent: Number(d.cumulativePercent),
        cashDemandPaise: d.cashPaise,
        accountDemandPaise: d.accountPaise,
        totalDemandPaise: d.totalPaise,
        demandDate: d.triggerDate,
        dueDate: d.dueDate,
        status: "OPEN",
        paidPaise: 0,
        postedAt,
      })
      .onConflictDoNothing({
        target: [demands.bookingId, demands.installmentSeq],
        where: sql`${demands.status} <> 'VOID'`,
      })
      .returning();
    if (!row) continue; // raised concurrently: the unique index made double-raising impossible
    await appendEvent(
      tx,
      booking.id,
      events.demand(row, { cashPaise: row.cashDemandPaise, accountPaise: row.accountDemandPaise }),
    );
    raised.push(row);
    const title = `Installment demand ${row.demandNumber}: ${row.installmentName}`;
    const body =
      `${row.triggerLabel ?? ""} – Cash ${formatINR(row.cashDemandPaise)}, Account ${formatINR(row.accountDemandPaise)}; due ${row.dueDate}`.trim();
    notifications += await notify(tx, {
      companyId: booking.companyId,
      recipients: await bookingRecipients(tx, booking),
      type: "DEMAND_RAISED",
      title,
      body,
      entityType: "demand",
      entityId: row.id,
      link: `/bookings/${booking.id}/demands`,
    });
    notifications += await notifyRole(tx, booking.companyId, ACCOUNTS_ROLES, {
      type: "DEMAND_RAISED",
      title: `${title} (${booking.bookingNumber})`,
      body,
      entityType: "demand",
      entityId: row.id,
      link: `/bookings/${booking.id}/demands`,
    });
    await writeAudit(tx, {
      companyId: booking.companyId,
      actor,
      action: "demand.raise",
      entityType: "demand",
      entityId: row.id,
      after: {
        demand_number: row.demandNumber,
        booking_id: booking.id,
        installment_seq: row.installmentSeq,
        cash_demand_paise: row.cashDemandPaise,
        account_demand_paise: row.accountDemandPaise,
        due_date: row.dueDate,
      },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  }
  // other charges demanded "on possession"
  if (towerStages.some((s) => s.isPossession && s.status === "COMPLETED")) {
    const lines = await tx
      .select()
      .from(bookingOtherCharges)
      .where(
        and(
          eq(bookingOtherCharges.bookingId, booking.id),
          eq(bookingOtherCharges.demandAt, "ON_POSSESSION"),
          isNull(bookingOtherCharges.demandedAt),
        ),
      );
    for (const line of lines) await raiseOtherChargeDemand(tx, booking, line, { today, actor, clock, company });
  }
  if (raised.length > 0) await recomputeDemandStatuses(tx, booking.id);
  return { raised, notifications };
}

/** Notification / audit entity type of an other-charge line (its demand bell is keyed by the line id). */
export const OTHER_CHARGE_ENTITY_TYPE = "booking_other_charge";

/** Raises the demand of one other-charge line (ON_BOOKING at creation, ON_POSSESSION by the engine, MANUAL by staff). */
export async function raiseOtherChargeDemand(
  tx: Tx,
  booking: BookingRecord,
  line: OtherChargeRecord,
  opts: RaiseOptions & { dueDate?: string } = {},
): Promise<OtherChargeRecord> {
  if (line.demandedAt) return line;
  const clock = opts.clock ?? new Clock();
  await lockBooking(tx, booking.id, clock);
  const today = opts.today ?? todayDate();
  const company = opts.company ?? (await loadCompanyRow(tx, booking.companyId));
  const demandNumber = await nextNumber(tx, numberingOf(company), "demand", today);
  const demandedAt = clock.next();
  const dueDate = opts.dueDate ?? addDays(today, company.settings.demand_due_days);
  const [updated] = await tx
    .update(bookingOtherCharges)
    .set({ demandedAt, demandNumber, dueDate })
    .where(eq(bookingOtherCharges.id, line.id))
    .returning();
  if (!updated) throw new Error("other charge line vanished");
  await appendEvent(tx, booking.id, events.otherChargeDemand(updated, demandedAt));
  const actor = opts.actor ?? SYSTEM_MONEY_ACTOR;
  await writeAudit(tx, {
    companyId: booking.companyId,
    actor,
    action: "other_charge.demand",
    entityType: "booking_other_charge",
    entityId: line.id,
    after: { demand_number: demandNumber, total_paise: line.totalPaise, due_date: dueDate },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
  // keyed by the charge line (TODO-integration #6) so a possession undo withdraws exactly this bell
  await notify(tx, {
    companyId: booking.companyId,
    recipients: await bookingRecipients(tx, booking),
    type: "DEMAND_RAISED",
    title: `${line.name} demanded (${demandNumber})`,
    body: `${formatINR(line.totalPaise)} due ${dueDate}`,
    entityType: OTHER_CHARGE_ENTITY_TYPE,
    entityId: line.id,
    link: `/bookings/${booking.id}`,
  });
  return updated;
}

/**
 * Raises dues for every ACTIVE booking of a block (stage completion, admin run). Called inside the caller's transaction, which already
 * holds the block row. Every booking is locked first (ascending id) and only then are demand numbers allocated, so the demand
 * sequence row is always the LAST lock taken (see lockBookingsInOrder) and a concurrent dues run / booking cannot deadlock with it.
 */
export async function raiseDuesForBlock(
  tx: Tx,
  blockId: string,
  opts: RaiseOptions = {},
): Promise<{ bookingsChecked: number; raised: DemandRecord[]; notifications: number }> {
  const active = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.blockId, blockId), eq(bookings.status, "ACTIVE")))
    .orderBy(asc(bookings.id));
  await lockBookingsInOrder(
    tx,
    active.map((b) => b.id),
  );
  // re-read under the locks (a booking may have been cancelled / completed while we waited)
  const rows = active.length
    ? await tx
        .select()
        .from(bookings)
        .where(
          and(
            inArray(
              bookings.id,
              active.map((b) => b.id),
            ),
            eq(bookings.status, "ACTIVE"),
          ),
        )
        .orderBy(asc(bookings.bookingDate), asc(bookings.id))
    : [];
  const towerStages = opts.towerStages ?? (await loadTowerStages(tx, blockId));
  const company = opts.company ?? (rows[0] ? await loadCompanyRow(tx, rows[0].companyId) : undefined);
  const clock = opts.clock ?? new Clock();
  const raised: DemandRecord[] = [];
  let notifications = 0;
  for (const b of rows) {
    const r = await raiseDues(tx, b, { ...opts, towerStages, company, clock });
    raised.push(...r.raised);
    notifications += r.notifications;
  }
  return { bookingsChecked: rows.length, raised, notifications };
}

/** Scope of an engine run. */
export interface DuesScope {
  bookingId?: string | undefined;
  blockId?: string | undefined;
  projectId?: string | undefined;
  companyId?: string | undefined;
}

/** Summary of an engine run. */
export interface RunSummary {
  bookingsChecked: number;
  demandsRaised: number;
  demandNumbers: string[];
  notifications: number;
  /** Bookings whose unit of work failed (isolated: the run went on); empty on a clean run. */
  failures: (DuesFailure & { company_id: string })[];
}

/** Machine-readable code of a per-booking failure (ApiError code, INVALID_AMOUNT, SQLSTATE_<code> or INTERNAL_ERROR). */
export function failureCode(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  const money = mapMoneyError(err);
  if (money) return money.code;
  const sqlstate = databaseErrorCode(err);
  if (sqlstate) return `SQLSTATE_${sqlstate}`;
  return "INTERNAL_ERROR";
}

/**
 * Daily job / boot catch-up / admin "run dues now": every ACTIVE booking in scope, each in its OWN short transaction (moneyTransaction,
 * retried on 40001/40P01) so locks stay brief and one booking can never stop the others:
 *   1. the booking row is locked first (row FOR UPDATE + advisory lock, lockBooking) and only THEN are the booking (agreed amounts, plan
 *      snapshot, status) and its tower's stages read, so a revision, plan change, cancellation or stage undo that committed while we
 *      waited is seen — never a stale copy read before the lock;
 *   2. a booking whose unit of work throws is rolled back, logged, counted (kkt_dues_booking_failures_total) and listed in `failures`
 *      (booking id + number + error code), and the run continues with the next booking.
 * Time triggers (DAYS_AFTER_BOOKING, ON_DATE) are evaluated against `today`.
 */
export async function raiseDuesForAll(
  db: DB,
  today: string = todayDate(),
  scope: DuesScope = {},
  actor: MoneyActor = SYSTEM_MONEY_ACTOR,
): Promise<RunSummary> {
  const where = and(
    eq(bookings.status, "ACTIVE"),
    scope.bookingId ? eq(bookings.id, scope.bookingId) : undefined,
    scope.blockId ? eq(bookings.blockId, scope.blockId) : undefined,
    scope.projectId ? eq(bookings.projectId, scope.projectId) : undefined,
    scope.companyId ? eq(bookings.companyId, scope.companyId) : undefined,
  );
  const ids = await db
    .select({ id: bookings.id, companyId: bookings.companyId, bookingNumber: bookings.bookingNumber })
    .from(bookings)
    .where(where)
    .orderBy(asc(bookings.bookingDate), asc(bookings.id));
  const companies = new Map<string, CompanyRecord>();
  const summary: RunSummary = {
    bookingsChecked: 0,
    demandsRaised: 0,
    demandNumbers: [],
    notifications: 0,
    failures: [],
  };
  for (const { id, companyId, bookingNumber } of ids) {
    summary.bookingsChecked += 1;
    try {
      let company = companies.get(companyId);
      if (!company) {
        company = await loadCompanyRow(db, companyId);
        companies.set(companyId, company);
      }
      const co = company;
      const result = await moneyTransaction(db, async (tx) => {
        // lock FIRST, read after: the agreed amounts, plan snapshot, status and tower stages are those in force once we hold the booking
        const clock = new Clock();
        await lockBooking(tx, id, clock);
        const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).limit(1);
        if (!b || b.status !== "ACTIVE") return null;
        const towerStages = await loadTowerStages(tx, b.blockId);
        return raiseDues(tx, b, { today, actor, company: co, towerStages, clock });
      });
      if (result) {
        summary.demandsRaised += result.raised.length;
        summary.demandNumbers.push(...result.raised.map((d) => d.demandNumber));
        summary.notifications += result.notifications;
      }
    } catch (err) {
      const code = failureCode(err);
      const message = err instanceof Error ? err.message : String(err);
      summary.failures.push({ booking_id: id, booking_number: bookingNumber, company_id: companyId, code, message });
      duesBookingFailures.inc({ code });
      logger.error(
        { err, booking_id: id, booking_number: bookingNumber, code },
        "dues: booking failed; the run continues",
      );
    }
  }
  return summary;
}

/**
 * Derives every non-void demand's status and paid figure by allocating the booking's CLEARED money FIFO per bucket (domain demandStatuses).
 * CANCELLED demands keep their status; paid_paise is still refreshed so reports stay coherent.
 */
export async function recomputeDemandStatuses(tx: Executor, bookingId: string): Promise<void> {
  // both reads in one round trip (pipelined on the transaction's connection)
  const [[b], rows] = await Promise.all([
    tx
      .select({ cashPaid: bookings.cashPaidPaise, accountPaid: bookings.accountPaidPaise, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1),
    tx
      .select({
        id: demands.id,
        cash: demands.cashDemandPaise,
        account: demands.accountDemandPaise,
        status: demands.status,
        paid: demands.paidPaise,
      })
      .from(demands)
      .where(and(eq(demands.bookingId, bookingId), ne(demands.status, "VOID")))
      .orderBy(asc(demands.postedAt), asc(demands.installmentSeq)),
  ]);
  if (!b) return;
  const results = demandStatuses(
    rows.map((r) => ({ id: r.id, cashPaise: r.cash, accountPaise: r.account })),
    Math.max(0, b.cashPaid),
    Math.max(0, b.accountPaid),
  );
  const updates: Promise<unknown>[] = [];
  for (const [i, r] of results.entries()) {
    const cur = rows[i]!;
    const nextStatus = cur.status === "CANCELLED" ? "CANCELLED" : r.status;
    if (cur.status === nextStatus && cur.paid === r.paidPaise) continue;
    updates.push(tx.update(demands).set({ status: nextStatus, paidPaise: r.paidPaise }).where(eq(demands.id, r.id)));
  }
  // one round trip for every changed demand (distinct rows, so their order does not matter)
  await Promise.all(updates);
}

/**
 * Chronological FIFO allocation of a booking's CLEARED flat-value payments (by payment date, then posting order) to its non-void demands
 * (in raise order), per bucket. Returns, per demand, the receipts that funded it with their payment dates – the input of the UNDO RULE.
 */
async function demandFunding(
  tx: Executor,
  bookingId: string,
): Promise<Map<string, { receipt: string; date: string }[]>> {
  const [demandRows, paymentRows] = await Promise.all([
    tx
      .select({ id: demands.id, cash: demands.cashDemandPaise, account: demands.accountDemandPaise })
      .from(demands)
      .where(and(eq(demands.bookingId, bookingId), ne(demands.status, "VOID")))
      .orderBy(asc(demands.postedAt), asc(demands.installmentSeq)),
    tx
      .select({
        receipt: payments.receiptNumber,
        date: payments.paymentDate,
        bucket: payments.bucket,
        amount: payments.amountPaise,
      })
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "CLEARED"), eq(payments.against, "FLAT_VALUE")))
      .orderBy(asc(payments.paymentDate), asc(payments.postedAt)),
  ]);
  const out = new Map<string, { receipt: string; date: string }[]>();
  const open = {
    CASH: demandRows.map((d) => ({ id: d.id, left: d.cash })),
    ACCOUNT: demandRows.map((d) => ({ id: d.id, left: d.account })),
  };
  for (const p of paymentRows) {
    if (!p.bucket) continue;
    let amount = p.amount;
    for (const d of open[p.bucket]) {
      if (amount <= 0) break;
      if (d.left <= 0) continue;
      const take = Math.min(d.left, amount);
      d.left -= take;
      amount -= take;
      const list = out.get(d.id) ?? [];
      list.push({ receipt: p.receipt, date: p.date });
      out.set(d.id, list);
    }
  }
  return out;
}

/** Result of voiding stage demands. */
export type VoidStageResult = { blocked: true; reasons: string[] } | { blocked: false; voided: DemandRecord[] };

/** A closed booking a stage undo would have to rewrite (409 BOOKING_CLOSED details.bookings). */
export interface ClosedBookingRef {
  booking_id: string;
  booking_number: string;
  status: string;
  /** Demands of the stage the undo would void ([] when the booking was handed over on this possession stage). */
  demand_numbers: string[];
}

/**
 * Voids one demand and appends its DEMAND_VOIDED ledger row (contract C7: the demand never vanishes from the book). The caller holds the
 * booking locks; `clock` (which observed the booking's last ledger instant) gives the void its posting instant.
 */
async function voidAndRecord(
  tx: Tx,
  d: DemandRecord,
  reason: string,
  clock: Clock,
  set: { paidPaise?: number } = {},
): Promise<DemandRecord> {
  const voidedAt = clock.next();
  const [[v], [agreed]] = await Promise.all([
    tx
      .update(demands)
      .set({ status: "VOID", voidedAt, voidReason: reason, ...set })
      .where(eq(demands.id, d.id))
      .returning(),
    tx
      .select({ cash_agreed_paise: bookings.cashAgreedPaise, account_agreed_paise: bookings.accountAgreedPaise })
      .from(bookings)
      .where(eq(bookings.id, d.bookingId)),
  ]);
  if (!v || !agreed) throw new Error("demand or booking vanished while being voided");
  // what the ledger raised for this demand under the agreement in force now — the same amounts a rebuild takes back
  await appendEvent(tx, d.bookingId, events.demandVoided(v, demandAmountsFor(v, agreed), voidedAt), { locked: true });
  return v;
}

/**
 * UNDO RULE (SPEC §9): demands raised by a stage (ON_STAGE on that stage, or ON_POSSESSION when it is the possession stage) are voided,
 * unless any of them has been paid by a CLEARED payment dated on/after the demand – then the undo is blocked with reasons. Earlier advances
 * that were auto-applied never block (they return to credit). Voided demands lose their notifications (withdraw rule) and each leaves a
 * DEMAND_VOIDED row on its ledger. Each affected booking is locked (row + advisory) before anything is read, so a concurrent payment
 * cannot slip in.
 *
 * Only OPEN (ACTIVE) bookings are rewritten — SPEC §10 runs the engine for "every Active booking", and a cancelled booking's ledger is
 * closed (SPEC §12). CANCELLED bookings are skipped: their demands were already CANCELLED with the ledger and stay as the record of what
 * was raised. A COMPLETED (handed-over) booking is never rewritten either: when the undo would void one of its demands — or when the stage
 * is the possession stage its handover rests on (SPEC §12 "allowed when the possession stage is complete") — the undo answers
 * 409 BOOKING_CLOSED listing those bookings (reopen them first).
 */
export async function voidDemandsForStage(
  tx: Tx,
  blockId: string,
  stageId: string,
  reason: string,
  actor: MoneyActor = SYSTEM_MONEY_ACTOR,
): Promise<VoidStageResult> {
  const towerStages = await loadTowerStages(tx, blockId);
  const stage = towerStages.find((s) => s.stageId === stageId);
  const candidateIds = (
    await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.blockId, blockId), inArray(bookings.status, ["ACTIVE", "COMPLETED"])))
      .orderBy(asc(bookings.id))
  ).map((r) => r.id);
  const clock = new Clock();
  for (const id of candidateIds) await lockBooking(tx, id, clock);
  // statuses re-read under the locks (a booking may have been completed / cancelled while we waited)
  const [bookingRows, rows] = candidateIds.length
    ? await Promise.all([
        tx
          .select({ id: bookings.id, bookingNumber: bookings.bookingNumber, status: bookings.status })
          .from(bookings)
          .where(inArray(bookings.id, candidateIds)),
        tx
          .select()
          .from(demands)
          .where(and(inArray(demands.bookingId, candidateIds), ne(demands.status, "VOID")))
          .orderBy(asc(demands.bookingId), asc(demands.postedAt)),
      ])
    : [[], []];
  const bookingById = new Map(bookingRows.map((b) => [b.id, b]));
  // ON_STAGE demands carry trigger_stage_id; ON_POSSESSION ones are attributed through demandStageId (possession stage of the tower)
  const raisedByStage = rows.filter((d) => {
    if (d.triggerStageId === stageId) return true;
    if (d.triggerType === "ON_POSSESSION" && stage?.isPossession)
      return demandStageId({ triggerType: "ON_POSSESSION", triggerStageId: d.triggerStageId }, towerStages) === stageId;
    return false;
  });
  const closed = new Map<string, ClosedBookingRef>();
  for (const b of bookingRows)
    if (b.status === "COMPLETED" && stage?.isPossession)
      closed.set(b.id, { booking_id: b.id, booking_number: b.bookingNumber, status: b.status, demand_numbers: [] });
  for (const d of raisedByStage) {
    const b = bookingById.get(d.bookingId);
    if (!b || b.status === "ACTIVE") continue;
    const ref = closed.get(b.id) ?? {
      booking_id: b.id,
      booking_number: b.bookingNumber,
      status: b.status,
      demand_numbers: [],
    };
    ref.demand_numbers.push(d.demandNumber);
    closed.set(b.id, ref);
  }
  if (closed.size > 0) {
    const list = [...closed.values()].sort((a, b) => a.booking_number.localeCompare(b.booking_number));
    throw ApiError.conflict(
      "BOOKING_CLOSED",
      `Cannot undo ${stage?.name ?? "this stage"}: it would rewrite handed-over booking${list.length === 1 ? "" : "s"} ${list
        .map((b) => b.booking_number)
        .join(", ")}; reopen ${list.length === 1 ? "it" : "them"} first`,
      { bookings: list },
    );
  }
  const targets = raisedByStage.filter((d) => bookingById.get(d.bookingId)?.status === "ACTIVE");
  if (targets.length === 0) return { blocked: false, voided: [] };
  const reasons: string[] = [];
  const fundingCache = new Map<string, Map<string, { receipt: string; date: string }[]>>();
  for (const d of targets) {
    if (d.paidPaise <= 0) continue;
    let funding = fundingCache.get(d.bookingId);
    if (!funding) {
      funding = await demandFunding(tx, d.bookingId);
      fundingCache.set(d.bookingId, funding);
    }
    const later = (funding.get(d.id) ?? []).find((f) => f.date >= d.demandDate);
    if (later)
      reasons.push(
        `Demand ${d.demandNumber} has been paid by receipt ${later.receipt} dated ${later.date} (on/after the demand)`,
      );
  }
  if (reasons.length > 0) return { blocked: true, reasons };
  const voided: DemandRecord[] = [];
  for (const d of targets) {
    voided.push(await voidAndRecord(tx, d, reason, clock, { paidPaise: 0 }));
    await withdraw(tx, "demand", d.id);
    await writeAudit(tx, {
      companyId: d.companyId,
      actor,
      action: "demand.void",
      entityType: "demand",
      entityId: d.id,
      before: { status: d.status, paid_paise: d.paidPaise },
      after: { status: "VOID", void_reason: reason },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  }
  for (const bookingId of new Set(targets.map((d) => d.bookingId))) {
    // the DEMAND_VOIDED rows are already in the book; the rebuild only checks it (and restates an epoch that does not match)
    await rebuild(tx, bookingId, { write: true, reason: "STAGE_UNDO", actor });
    await recomputeDemandStatuses(tx, bookingId);
  }
  return { blocked: false, voided };
}

/**
 * Voids one demand (integrity repair, plan change) when it has no money applied — appending its DEMAND_VOIDED ledger row — and returns
 * false when it has money applied. The caller holds the booking locks; pass the unit of work's `clock` (it observed the booking's last
 * ledger instant) so the void is ordered after every earlier event.
 */
export async function voidDemand(
  tx: Tx,
  d: DemandRecord,
  reason: string,
  actor: MoneyActor = SYSTEM_MONEY_ACTOR,
  opts: { clock?: Clock } = {},
): Promise<boolean> {
  if (d.paidPaise > 0) return false;
  let clock = opts.clock;
  if (!clock) {
    clock = new Clock();
    await lockBooking(tx, d.bookingId, clock);
  }
  await voidAndRecord(tx, d, reason, clock);
  await withdraw(tx, "demand", d.id);
  await writeAudit(tx, {
    companyId: d.companyId,
    actor,
    action: "demand.void",
    entityType: "demand",
    entityId: d.id,
    before: { status: d.status },
    after: { status: "VOID", void_reason: reason },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
  return true;
}

/** Human label for a charge demand rule. */
export function demandAtLabel(d: ChargeDemandAt): string {
  switch (d) {
    case "ON_BOOKING":
      return "On booking";
    case "ON_POSSESSION":
      return "On possession";
    case "MANUAL":
      return "Manual";
  }
}
