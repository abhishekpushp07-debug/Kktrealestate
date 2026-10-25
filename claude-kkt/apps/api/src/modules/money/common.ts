import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { todayIST } from "@kkt/domain";
import { bookings, companies, withAdvisoryLock, type Address, type Executor, type Tx } from "@kkt/db";
import { actorFromRequest, SYSTEM_ACTOR, type AuditActor } from "../../lib/audit.js";
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
export async function loadBooking(tx: Executor, companyId: string, id: string, forUpdate = false): Promise<BookingRecord> {
  const q = tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.companyId, companyId))).limit(1).$dynamic();
  const rows = await (forUpdate ? q.for("update") : q);
  const row = rows[0];
  if (!row) throw ApiError.notFound("Booking");
  return row;
}

/**
 * Serialises every money operation of a booking (ledger seq, running balances, bucket cap, demand raising).
 * Lock order is always booking row (FOR UPDATE) → advisory lock, so a dues run and a payment on the same booking can never deadlock
 * (the payment path locks the row first; a job that only took the advisory lock would then block on the row while holding the advisory lock).
 */
export async function lockBooking(tx: Tx, bookingId: string): Promise<void> {
  await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId)).for("update");
  await withAdvisoryLock(tx, `booking:${bookingId}`);
}

/** Renders a postal address on one line. */
export function formatAddress(a: Address | null | undefined): string | null {
  if (!a) return null;
  return [a.line1, a.line2, a.locality, a.city, a.state, a.pincode].filter((p) => p && String(p).trim() !== "").join(", ");
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

import { asc, inArray } from "drizzle-orm";
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
  const rows = await db.select().from(blockStages).where(eq(blockStages.blockId, blockId)).orderBy(asc(blockStages.sortOrder));
  return rows.map((s) => ({ stageId: s.stageId, name: s.name, isPossession: s.isPossession, status: s.status, completedOn: s.completedOn }));
}

/** Tower stages for many blocks in one query, keyed by block id. */
export async function loadTowerStagesMany(db: Executor, blockIds: readonly string[]): Promise<Map<string, TowerStage[]>> {
  const out = new Map<string, TowerStage[]>();
  const ids = [...new Set(blockIds)];
  if (ids.length === 0) return out;
  const rows = await db.select().from(blockStages).where(inArray(blockStages.blockId, ids)).orderBy(asc(blockStages.blockId), asc(blockStages.sortOrder));
  for (const s of rows) {
    const list = out.get(s.blockId) ?? [];
    list.push({ stageId: s.stageId, name: s.name, isPossession: s.isPossession, status: s.status, completedOn: s.completedOn });
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
