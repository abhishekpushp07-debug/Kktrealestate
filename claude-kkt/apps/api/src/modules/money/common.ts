import { and, eq, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { todayIST } from "@kkt/domain";
import {
  blocks,
  bookings,
  companies,
  flats,
  ledgerEntries,
  withTransactionRetry,
  type Address,
  type DB,
  type Executor,
  type Tx,
} from "@kkt/db";
import { actorFromRequest, SYSTEM_ACTOR, type AuditActor } from "../../lib/audit.js";
import { compileSql } from "../../lib/compiledSql.js";
import { ApiError } from "../../lib/errors.js";
import type { NumberingCompany } from "../../lib/numbering.js";

/** A booking row as stored. */
export type BookingRecord = typeof bookings.$inferSelect;

/** Company fields the money services need (numbering, FY start, settings). */
export type CompanyRecord = typeof companies.$inferSelect;

/** Who is acting and from where (request metadata is optional for jobs). */
export interface MoneyActor extends AuditActor {
  ip?: string | null;
  requestId?: string | null;
}

/** The SYSTEM actor used by jobs. */
export const SYSTEM_MONEY_ACTOR: MoneyActor = { ...SYSTEM_ACTOR };

/** Builds the money actor from a request (staff or portal). */
export function actorOf(req: FastifyRequest): MoneyActor {
  return { ...actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

/**
 * Strictly increasing instants inside one unit of work: every ledger event, demand and payment written in the same
 * transaction gets its own millisecond, so a rebuild from source tables (sorted by instant) reproduces the appended order exactly.
 */
export class Clock {
  private last: number;
  constructor(start: Date = new Date()) {
    this.last = start.getTime() - 1;
  }
  /** Next instant, at least 1 ms after the previous one and never before "now". */
  next(): Date {
    const now = Date.now();
    this.last = Math.max(this.last + 1, now);
    return new Date(this.last);
  }
  /**
   * Never hand out an instant at or before `at` (the booking's last ledger instant). Posting order is the canonical ledger order, so a
   * booking's events must have strictly increasing instants even when another process's clock ran ahead or a shared clock of a
   * tower-wide run got ahead of real time.
   */
  observe(at: Date | null | undefined): this {
    if (at) this.last = Math.max(this.last, at.getTime());
    return this;
  }
}

/** Today's business date (IST). */
export function todayDate(): string {
  return todayIST();
}

/** Loads the company row (numbering, FY, settings) inside the unit of work. */
export async function loadCompanyRow(tx: Executor, companyId: string): Promise<CompanyRecord> {
  const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw ApiError.notFound("Company");
  return c;
}

/** The subset nextNumber() needs. */
export function numberingOf(c: CompanyRecord): NumberingCompany {
  return { id: c.id, fyStartMonth: c.fyStartMonth, numbering: c.numbering };
}

/** Loads a booking of the company (404 when missing), optionally locked FOR UPDATE. */
export async function loadBooking(
  tx: Executor,
  companyId: string,
  id: string,
  forUpdate = false,
): Promise<BookingRecord> {
  const q = tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.companyId, companyId)))
    .limit(1)
    .$dynamic();
  const rows = await (forUpdate ? q.for("update") : q);
  const row = rows[0];
  if (!row) throw ApiError.notFound("Booking");
  return row;
}

/**
 * Booking row lock, then the booking advisory lock, in ONE statement: the MATERIALIZED CTE locks the row (FOR UPDATE) before the outer
 * select takes `pg_advisory_xact_lock(hashtext('booking:<id>'))` — the same key withAdvisoryLock used — so the lock order below holds by
 * construction and the pair costs one round trip instead of two.
 */
const LOCK_BOOKING_SQL = compileSql(sql`with locked as materialized (
    select ${bookings.id} from ${bookings} where ${bookings.id} = ${sql.placeholder("id")} for update)
  select pg_advisory_xact_lock(hashtext(${sql.placeholder("key")})) from locked`);

/**
 * Serialises every money operation of a booking (ledger seq, running balances, bucket cap, demand raising).
 * Lock order is always booking row (FOR UPDATE) → advisory lock, so a dues run and a payment on the same booking can never deadlock
 * (the payment path locks the row first; a job that only took the advisory lock would then block on the row while holding the advisory lock).
 * With a clock, the booking's last ledger instant is read AFTER both locks are held (its own statement, so its snapshot is taken after
 * the wait: a READ COMMITTED statement that waited for a lock would still read with the snapshot it started with).
 */
export async function lockBooking(tx: Tx, bookingId: string, clock?: Clock): Promise<void> {
  await LOCK_BOOKING_SQL.run(tx, { id: bookingId, key: `booking:${bookingId}` });
  if (clock) {
    const [last] = await tx
      .select({ at: ledgerEntries.at })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.bookingId, bookingId))
      .orderBy(desc(ledgerEntries.seq))
      .limit(1);
    clock.observe(last?.at ?? null);
  }
}

/**
 * LOCK ORDER for every unit of work that touches money (deadlock-free by construction):
 *   payment row → flat row → block row → booking rows (ascending id, row + advisory) → parking / charge / demand rows of those bookings
 *   → document-number sequence rows LAST (booking, demand, receipt numbers are allocated after every row lock is held).
 * Tower-wide work (stage completion / undo) takes the block row first and then every booking of the tower in id order, so a dues run
 * or a payment (one booking → its sequence row) can never wait on it in the opposite order.
 */
export async function lockBookingsInOrder(tx: Tx, bookingIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(bookingIds)].sort()) await lockBooking(tx, id);
}

/** Locks the flat row and then the block row of a booking (lock order above) before the booking itself is locked. */
export async function lockFlatAndBlockOf(tx: Tx, companyId: string, bookingId: string): Promise<void> {
  const [b] = await tx
    .select({ flatId: bookings.flatId, blockId: bookings.blockId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.companyId, companyId)))
    .limit(1);
  if (!b) return; // the caller's own loader answers 404
  await tx.select({ id: flats.id }).from(flats).where(eq(flats.id, b.flatId)).for("update");
  await tx.select({ id: blocks.id }).from(blocks).where(eq(blocks.id, b.blockId)).for("update");
}

/**
 * Every money / construction transaction runs through this: the whole unit of work is retried (jittered backoff) when Postgres aborts
 * it with 40001 (serialization failure) or 40P01 (deadlock victim), so a lock-order race never surfaces as a 500. `fn` may run more
 * than once — it must create its Clock and read its rows inside.
 */
export function moneyTransaction<T>(db: DB, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransactionRetry(db, (tx) => fn(tx), { retries: 4 });
}

/** Renders a postal address on one line. */
export function formatAddress(a: Address | null | undefined): string | null {
  if (!a) return null;
  return [a.line1, a.line2, a.locality, a.city, a.state, a.pincode]
    .filter((p) => p && String(p).trim() !== "")
    .join(", ");
}

/** ISO string of a Date or null. */
export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Numeric columns read as number (drizzle numeric mode number already does; guards strings from raw SQL). */
export function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

// ---------------------------------------------------------------------------
// Shared loaders / mappers used by the dues, booking, payment and integrity services
// ---------------------------------------------------------------------------

import { asc, desc, inArray } from "drizzle-orm";
import type { PlanSnapshotInstallment as DomainInstallment, TowerStage } from "@kkt/domain";
import { blockStages, type PlanSnapshot } from "@kkt/db";

/** Maps the stored (snake_case) plan snapshot installments onto the domain engine's shape. */
export function snapshotInstallments(snapshot: PlanSnapshot): DomainInstallment[] {
  return snapshot.installments.map((i) => ({
    seq: i.seq,
    name: i.name,
    percent: i.percent,
    triggerType: i.trigger_type,
    triggerDays: i.trigger_days ?? null,
    triggerStageId: i.trigger_stage_id ?? null,
    triggerStageName: i.trigger_stage_name ?? null,
    triggerDate: i.trigger_date ?? null,
    dueDays: i.due_days,
  }));
}

/** The tower's stage records as the dues engine reads them. */
export async function loadTowerStages(db: Executor, blockId: string): Promise<TowerStage[]> {
  const rows = await db
    .select()
    .from(blockStages)
    .where(eq(blockStages.blockId, blockId))
    .orderBy(asc(blockStages.sortOrder));
  return rows.map((s) => ({
    stageId: s.stageId,
    name: s.name,
    isPossession: s.isPossession,
    status: s.status,
    completedOn: s.completedOn,
  }));
}

/** Tower stages for many blocks in one query, keyed by block id. */
export async function loadTowerStagesMany(
  db: Executor,
  blockIds: readonly string[],
): Promise<Map<string, TowerStage[]>> {
  const out = new Map<string, TowerStage[]>();
  const ids = [...new Set(blockIds)];
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(blockStages)
    .where(inArray(blockStages.blockId, ids))
    .orderBy(asc(blockStages.blockId), asc(blockStages.sortOrder));
  for (const s of rows) {
    const list = out.get(s.blockId) ?? [];
    list.push({
      stageId: s.stageId,
      name: s.name,
      isPossession: s.isPossession,
      status: s.status,
      completedOn: s.completedOn,
    });
    out.set(s.blockId, list);
  }
  return out;
}

/** Groups rows by a key into a Map of arrays. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** Role names that receive accounts-side notifications. */
export const ACCOUNTS_ROLES = ["Accounts"] as const;
/** Role names that receive integrity findings. */
export const INTEGRITY_ROLES = ["Super Admin", "Accounts"] as const;
