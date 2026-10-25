import { eq } from "drizzle-orm";
import type { JobName } from "@kkt/contracts";
import { jobRuns, type DB } from "@kkt/db";
import { logger } from "../lib/logger.js";

/** Name of the BullMQ queue every scheduled/triggered job goes through. */
export const QUEUE_NAME = "kkt-jobs";

/** Context handed to each job handler. */
export interface JobContext {
  db: DB;
  log: typeof logger;
  /** Payload passed when the job was enqueued (empty for repeatable schedules). */
  data: Record<string, unknown>;
}

/** A job handler returns a small JSON result stored in job_runs. */
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

/** Repeatable schedule (cron in Asia/Kolkata) per job. */
export interface JobSchedule {
  name: JobName;
  cron: string;
  tz: string;
}

/** Cron schedules (IST): dues 00:30, integrity 00:45, overdue notifications 01:15, visit-outcome nudge 09:00. */
export const JOB_SCHEDULES: readonly JobSchedule[] = [
  { name: "DAILY_DUES", cron: "30 0 * * *", tz: "Asia/Kolkata" },
  { name: "NIGHTLY_INTEGRITY", cron: "45 0 * * *", tz: "Asia/Kolkata" },
  { name: "OVERDUE_NOTIFICATIONS", cron: "15 1 * * *", tz: "Asia/Kolkata" },
  { name: "VISIT_OUTCOME_NUDGE", cron: "0 9 * * *", tz: "Asia/Kolkata" },
  { name: "SLA_BREACH_CHECK", cron: "5 * * * *", tz: "Asia/Kolkata" },
];

const registry = new Map<string, JobHandler>();

/** Registers (or replaces) the handler for a job name; business modules call this at import time. */
export function registerJob(name: JobName, handler: JobHandler): void {
  registry.set(name, handler);
}

/** Returns the registered handler, or a placeholder that only logs (business handlers are added by later modules). */
export function jobHandler(name: string): JobHandler {
  return registry.get(name) ?? (async (ctx) => { ctx.log.info({ job: name }, "job handler not implemented yet; no-op"); return { implemented: false }; });
}

/** Names of every job that currently has a handler registered. */
export function registeredJobs(): string[] {
  return [...registry.keys()];
}

/** Runs a job by name, recording a job_runs row (RUNNING → OK | FAILED) around the handler. */
export async function runJob(db: DB, name: string, data: Record<string, unknown> = {}): Promise<{ runId: string; status: "OK" | "FAILED"; result?: Record<string, unknown>; error?: string }> {
  const [run] = await db.insert(jobRuns).values({ jobName: name, status: "RUNNING" }).returning({ id: jobRuns.id });
  const runId = run!.id;
  const log = logger.child({ job: name, runId });
  try {
    const result = await jobHandler(name)({ db, log, data });
    await db.update(jobRuns).set({ status: "OK", finishedAt: new Date(), result }).where(eq(jobRuns.id, runId));
    log.info({ result }, "job finished");
    return { runId, status: "OK", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(jobRuns).set({ status: "FAILED", finishedAt: new Date(), error: message }).where(eq(jobRuns.id, runId));
    log.error({ err }, "job failed");
    return { runId, status: "FAILED", error: message };
  }
}
