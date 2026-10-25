/**
 * Scheduled jobs of the money module (registered through the core job registry): DAILY_DUES (00:30 IST), NIGHTLY_INTEGRITY (00:45) and
 * OVERDUE_NOTIFICATIONS (01:15). Each works per company so the single-tenant setup needs no special casing.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { bookings, companies, demands, notifications, type DB } from "@kkt/db";
import { formatINR } from "@kkt/domain";
import { registerJob } from "../../jobs/index.js";
import { notify, notifyRole } from "../notifications/service.js";
import { ACCOUNTS_ROLES, todayDate } from "./common.js";
import { bookingRecipients, raiseDuesForAll } from "./services/dues.js";
import { nightlyIntegrity } from "./services/integrity.js";

async function companyIds(db: DB): Promise<string[]> {
  return (await db.select({ id: companies.id }).from(companies)).map((c) => c.id);
}

/** Daily dues: raise time-triggered installments for every active booking, then report integrity (findings notify Super Admin + Accounts). */
export async function dailyDues(db: DB): Promise<Record<string, unknown>> {
  const today = todayDate();
  const out: Record<string, unknown> = { as_of: today };
  for (const companyId of await companyIds(db)) {
    const s = await raiseDuesForAll(db, today, { companyId });
    const report = await nightlyIntegrity(db, companyId);
    out[companyId] = { bookings_checked: s.bookingsChecked, demands_raised: s.demandsRaised, demand_numbers: s.demandNumbers, integrity_ok: report.ok, integrity_findings: report.findings.length };
  }
  return out;
}

/** Nightly integrity report for every company. */
export async function nightlyIntegrityJob(db: DB): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const companyId of await companyIds(db)) {
    const report = await nightlyIntegrity(db, companyId);
    out[companyId] = { ok: report.ok, bookings_checked: report.bookings_checked, counts: report.counts };
  }
  return out;
}

/** Marks a (demand, day) as notified; Redis NX when available, otherwise the notifications table (one DEMAND_OVERDUE per demand per day). */
async function claimOverdue(app: FastifyInstance | null, db: DB, demandId: string, today: string): Promise<boolean> {
  if (app) {
    try {
      const ok = await app.redis.set(`overdue:${demandId}:${today}`, "1", "EX", 2 * 24 * 3600, "NX");
      if (ok) return true;
      return false;
    } catch { /* fall back to the database */ }
  }
  const [row] = await db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.entityType, "demand"), eq(notifications.entityId, demandId), eq(notifications.type, "DEMAND_OVERDUE"), sql`${notifications.createdAt} >= (${today}::date)::timestamptz`)).limit(1);
  return !row;
}

/** Overdue demand notifications: once per demand per day to the buyer and Accounts. */
export async function overdueNotifications(db: DB, app: FastifyInstance | null): Promise<Record<string, unknown>> {
  const today = todayDate();
  const rows = await db.select({ d: demands, b: bookings }).from(demands).innerJoin(bookings, eq(bookings.id, demands.bookingId))
    .where(and(inArray(demands.status, ["OPEN", "PARTIALLY_PAID"]), lt(demands.dueDate, today), eq(bookings.status, "ACTIVE")));
  let sent = 0;
  let skipped = 0;
  for (const { d, b } of rows) {
    if (!(await claimOverdue(app, db, d.id, today))) { skipped += 1; continue; }
    await db.transaction(async (tx) => {
      const outstanding = d.totalDemandPaise - d.paidPaise;
      const title = `Demand ${d.demandNumber} overdue (${d.installmentName})`;
      const body = `${formatINR(outstanding)} outstanding; due date was ${d.dueDate}`;
      await notify(tx, { companyId: d.companyId, recipients: await bookingRecipients(tx, b), type: "DEMAND_OVERDUE", title, body, entityType: "demand", entityId: d.id, link: `/bookings/${b.id}/demands` });
      await notifyRole(tx, d.companyId, ACCOUNTS_ROLES, { type: "DEMAND_OVERDUE", title: `${title} – ${b.bookingNumber}`, body, entityType: "demand", entityId: d.id, link: `/bookings/${b.id}/demands` });
    });
    sent += 1;
  }
  return { as_of: today, overdue_demands: rows.length, notified: sent, already_notified_today: skipped };
}

/** Registers the three job handlers; `app` supplies Redis for the once-per-day guard. */
export function registerMoneyJobs(app: FastifyInstance | null): void {
  registerJob("DAILY_DUES", async ({ db }) => dailyDues(db));
  registerJob("NIGHTLY_INTEGRITY", async ({ db }) => nightlyIntegrityJob(db));
  registerJob("OVERDUE_NOTIFICATIONS", async ({ db }) => overdueNotifications(db, app));
}
