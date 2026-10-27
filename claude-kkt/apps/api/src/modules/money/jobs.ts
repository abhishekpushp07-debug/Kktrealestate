/**
 * Scheduled jobs of the money module (registered through the core job registry): DAILY_DUES (00:30 IST), NIGHTLY_INTEGRITY (00:45),
 * OVERDUE_NOTIFICATIONS (01:15) and DUES_CATCHUP (enqueue at worker/API boot — SPEC §10 "at startup": a server down across 00:30 IST
 * must not leave time-triggered dues unraised until the next night). Each works per company so the single-tenant setup needs no special casing.
 * The integrity report runs exactly once a night — as NIGHTLY_INTEGRITY (jobs/index.ts JOB_SCHEDULES), never again inside DAILY_DUES.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { bookings, companies, demands, notifications, withAdvisoryLock, type DB, type Tx } from "@kkt/db";
import { formatINR } from "@kkt/domain";
import { registerJob } from "../../jobs/index.js";
import { rebuildAllLedgers } from "./services/ledgerRebuild.js";
import { notify, notifyRole } from "../notifications/index.js";
import { logger } from "../../lib/logger.js";
import { ACCOUNTS_ROLES, moneyTransaction, todayDate } from "./common.js";
import { bookingRecipients, raiseDuesForAll, type RunSummary } from "./services/dues.js";
import { nightlyIntegrity } from "./services/integrity.js";

async function companyIds(db: DB): Promise<string[]> {
  return (await db.select({ id: companies.id }).from(companies)).map((c) => c.id);
}

/** Roles notified (once per run and company) when bookings failed in a dues run. */
export const DUES_FAILURE_ROLES = ["Super Admin"] as const;

/**
 * One JOB_FAILED bell per company and run listing the bookings that failed (their demands were not raised; everyone else's were).
 * Best effort: a failure to notify is logged, never turns a finished run into a failed one.
 */
async function notifyDuesFailures(db: DB, job: string, companyId: string, s: RunSummary): Promise<void> {
  if (s.failures.length === 0) return;
  const shown = s.failures
    .slice(0, 10)
    .map((f) => `${f.booking_number ?? f.booking_id} (${f.code})`)
    .join(", ");
  try {
    await db.transaction((tx) =>
      notifyRole(tx, companyId, DUES_FAILURE_ROLES, {
        type: "JOB_FAILED",
        title: `${job}: dues not raised for ${s.failures.length} booking${s.failures.length === 1 ? "" : "s"}`,
        body: `${shown}${s.failures.length > 10 ? ", …" : ""}. Every other booking was processed; fix these and run dues again.`,
        entityType: "job",
        entityId: null,
        link: "/admin/jobs",
      }),
    );
  } catch (err) {
    logger.error({ err, job, company_id: companyId }, "dues: could not notify the failed bookings");
  }
}

/** The per-company result of a dues run (job_runs.result): counts, demand numbers and the failed bookings with their error codes. */
function runResult(s: RunSummary): Record<string, unknown> {
  return {
    bookings_checked: s.bookingsChecked,
    demands_raised: s.demandsRaised,
    demand_numbers: s.demandNumbers,
    bookings_failed: s.failures.length,
    failures: s.failures.map((f) => ({ booking_id: f.booking_id, booking_number: f.booking_number, code: f.code })),
  };
}

/**
 * Daily dues: raise time-triggered installments for every active booking (per-booking isolation, see raiseDuesForAll). The result carries
 * `bookings_failed` per company and in total, the failures are counted in kkt_dues_booking_failures_total and Super Admins get one bell
 * per run; the run itself completes so one poison booking never blocks every later booking. Integrity is NIGHTLY_INTEGRITY's job.
 */
export async function dailyDues(db: DB): Promise<Record<string, unknown>> {
  return duesRun(db, "DAILY_DUES");
}

async function duesRun(db: DB, job: "DAILY_DUES" | "DUES_CATCHUP"): Promise<Record<string, unknown>> {
  const today = todayDate();
  const out: Record<string, unknown> = { as_of: today };
  let failed = 0;
  for (const companyId of await companyIds(db)) {
    const s = await raiseDuesForAll(db, today, { companyId });
    failed += s.failures.length;
    await notifyDuesFailures(db, job, companyId, s);
    out[companyId] = runResult(s);
  }
  out["bookings_failed"] = failed;
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

/**
 * Dues catch-up (SPEC §10 "at startup"): the same idempotent engine run as DAILY_DUES for every company, without the integrity
 * report — safe to enqueue at every boot and after any missed 00:30 run (demands are unique per installment, so nothing is raised twice).
 */
export async function duesCatchup(db: DB): Promise<Record<string, unknown>> {
  return duesRun(db, "DUES_CATCHUP");
}

const overdueKey = (demandId: string, today: string) => `overdue:${demandId}:${today}`;

/** Fast-path skip: the Redis marker written AFTER a successful notification commit (best effort; the database decides). */
async function alreadyMarked(app: FastifyInstance | null, demandId: string, today: string): Promise<boolean> {
  if (!app) return false;
  try {
    return (await app.redis.exists(overdueKey(demandId, today))) === 1;
  } catch {
    return false;
  }
}

/** The durable once-per-day guard, inside the notification transaction (serialised per demand and day by an advisory lock). */
async function notifiedToday(tx: Tx, demandId: string, today: string): Promise<boolean> {
  await withAdvisoryLock(tx, overdueKey(demandId, today));
  const [row] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.entityType, "demand"),
        eq(notifications.entityId, demandId),
        eq(notifications.type, "DEMAND_OVERDUE"),
        sql`${notifications.createdAt} >= ((${today}::date)::timestamp at time zone 'Asia/Kolkata')`,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Overdue demand notifications: once per demand per day to the buyer and Accounts. The day's claim is made only AFTER the notification
 * transaction commits (audit A7): a database failure leaves no marker, so the next run retries the notice instead of dropping it.
 */
export async function overdueNotifications(db: DB, app: FastifyInstance | null): Promise<Record<string, unknown>> {
  const today = todayDate();
  const rows = await db
    .select({ d: demands, b: bookings })
    .from(demands)
    .innerJoin(bookings, eq(bookings.id, demands.bookingId))
    .where(
      and(
        inArray(demands.status, ["OPEN", "PARTIALLY_PAID"]),
        lt(demands.dueDate, today),
        eq(bookings.status, "ACTIVE"),
      ),
    );
  let sent = 0;
  let skipped = 0;
  for (const { d, b } of rows) {
    if (await alreadyMarked(app, d.id, today)) {
      skipped += 1;
      continue;
    }
    const notified = await moneyTransaction(db, async (tx) => {
      if (await notifiedToday(tx, d.id, today)) return false;
      const outstanding = d.totalDemandPaise - d.paidPaise;
      const title = `Demand ${d.demandNumber} overdue (${d.installmentName})`;
      const body = `${formatINR(outstanding)} outstanding; due date was ${d.dueDate}`;
      await notify(tx, {
        companyId: d.companyId,
        recipients: await bookingRecipients(tx, b),
        type: "DEMAND_OVERDUE",
        title,
        body,
        entityType: "demand",
        entityId: d.id,
        link: `/bookings/${b.id}/demands`,
      });
      await notifyRole(tx, d.companyId, ACCOUNTS_ROLES, {
        type: "DEMAND_OVERDUE",
        title: `${title} – ${b.bookingNumber}`,
        body,
        entityType: "demand",
        entityId: d.id,
        link: `/bookings/${b.id}/demands`,
      });
      return true;
    });
    // committed (or found already done): only now is the day claimed in Redis
    if (app) await app.redis.set(overdueKey(d.id, today), "1", "EX", 2 * 24 * 3600).catch(() => undefined);
    if (notified) sent += 1;
    else skipped += 1;
  }
  return { as_of: today, overdue_demands: rows.length, notified: sent, already_notified_today: skipped };
}

/**
 * Registers the job handlers; `app` supplies Redis for the once-per-day fast path (null in a standalone worker: the database guard alone
 * keeps overdue notices to once per demand per day). The worker / boot sequence should enqueue DUES_CATCHUP (and STARTUP_RECONCILIATION) at start.
 */
export function registerMoneyJobs(app: FastifyInstance | null): void {
  registerJob("DAILY_DUES", async ({ db }) => dailyDues(db));
  registerJob("DUES_CATCHUP", async ({ db }) => duesCatchup(db));
  registerJob("NIGHTLY_INTEGRITY", async ({ db }) => nightlyIntegrityJob(db));
  registerJob("OVERDUE_NOTIFICATIONS", async ({ db }) => overdueNotifications(db, app));
  // admin job (POST /admin/jobs/LEDGER_REBUILD/run, data: {company_id?, dry_run?, batch_size?}); never scheduled
  registerJob("LEDGER_REBUILD", async ({ db, data }) => ({
    ...(await rebuildAllLedgers(db, {
      companyId: typeof data["company_id"] === "string" ? data["company_id"] : undefined,
      dryRun: data["dry_run"] === true,
      ...(typeof data["batch_size"] === "number" ? { batchSize: data["batch_size"] } : {}),
    })),
  }));
}
