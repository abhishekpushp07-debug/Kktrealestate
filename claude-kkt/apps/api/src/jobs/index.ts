/**
 * Core job registry and runner (audit A7). Business modules register handlers while the Fastify app is built (`registerJob`); the
 * standalone worker (src/worker.ts) builds the same app, so every handler exists there too. Rules:
 *   - a job name without a handler is an error (UnregisteredJobError), never a silent OK no-op;
 *   - every attempt is a `job_runs` row (RUNNING → OK | FAILED) and a failure is RETHROWN so BullMQ retries it (3 attempts, exponential
 *     backoff); after the final attempt the Super Admins are notified and ERROR_WEBHOOK_URL (when set) receives a JSON POST.
 */
import { randomUUID } from "node:crypto";
import type { JobsOptions } from "bullmq";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { JobName } from "@kkt/contracts";
import { jobRuns, type DB } from "@kkt/db";
import { logger } from "../lib/logger.js";
import { alertJobFailure } from "./alerts.js";

/** Name of the BullMQ queue every scheduled/triggered job goes through. */
export const QUEUE_NAME = "kkt-jobs";

/** Context handed to each job handler. */
export interface JobContext {
  db: DB;
  log: typeof logger;
  /** Payload passed when the job was enqueued (empty for repeatable schedules; internal `__*` keys removed). */
  data: Record<string, unknown>;
  /** The fully built Fastify app (Redis, storage-backed routes, `inject`); null only for bare calls without an app (unit tests). */
  app: FastifyInstance | null;
  /** job_runs row id of this attempt. */
  runId: string;
  /** 1-based attempt number and the attempt budget of this job. */
  attempt: number;
  maxAttempts: number;
}

/** A job handler returns a small JSON result stored in job_runs. */
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

/** Repeatable schedule (cron in Asia/Kolkata) per job; `enabled()` false keeps the job registered but unscheduled. */
export interface JobSchedule {
  name: JobName;
  cron: string;
  tz: string;
  enabled?: () => boolean;
}

/** True when the monthly partition maintenance job may run (packages/db/partitions; off by default). */
export function partitioningEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env["PARTITIONING_ENABLED"] ?? "").trim().toLowerCase() === "true";
}

/**
 * Cron schedules (IST): dues 00:30, integrity 00:45, overdue notifications 01:15, visit-outcome nudge 09:00, SLA check hourly at :05,
 * portal temp files hourly at :20, idempotency purge hourly at :35, hold expiry every 5 minutes, export cleanup daily 03:10,
 * partition maintenance daily 02:20 (only with PARTITIONING_ENABLED=true; creating next month's partitions is idempotent).
 */
export const JOB_SCHEDULES: readonly JobSchedule[] = [
  { name: "DAILY_DUES", cron: "30 0 * * *", tz: "Asia/Kolkata" },
  { name: "NIGHTLY_INTEGRITY", cron: "45 0 * * *", tz: "Asia/Kolkata" },
  { name: "OVERDUE_NOTIFICATIONS", cron: "15 1 * * *", tz: "Asia/Kolkata" },
  { name: "VISIT_OUTCOME_NUDGE", cron: "0 9 * * *", tz: "Asia/Kolkata" },
  { name: "SLA_BREACH_CHECK", cron: "5 * * * *", tz: "Asia/Kolkata" },
  { name: "PORTAL_FILE_CLEANUP", cron: "20 * * * *", tz: "Asia/Kolkata" },
  { name: "IDEMPOTENCY_PURGE", cron: "35 * * * *", tz: "Asia/Kolkata" },
  { name: "HOLD_EXPIRY", cron: "*/5 * * * *", tz: "Asia/Kolkata" },
  { name: "EXPORT_CLEANUP", cron: "10 3 * * *", tz: "Asia/Kolkata" },
  { name: "PARTITION_MAINTENANCE", cron: "20 2 * * *", tz: "Asia/Kolkata", enabled: () => partitioningEnabled() },
];

/** Attempts per job (first run + 2 retries). */
export const JOB_ATTEMPTS = 3;

/** Base delay of the exponential retry backoff (JOB_BACKOFF_MS, default 30 s → retries after 30 s and 60 s). */
export function jobBackoffMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env["JOB_BACKOFF_MS"]);
  return Number.isInteger(n) && n >= 0 ? n : 30_000;
}

/** BullMQ options every enqueued or scheduled job gets: 3 attempts with exponential backoff, bounded history. */
export function defaultJobOptions(): JobsOptions {
  return { attempts: JOB_ATTEMPTS, backoff: { type: "exponential", delay: jobBackoffMs() }, removeOnComplete: { count: 500 }, removeOnFail: { count: 1000 } };
}

const registry = new Map<string, JobHandler>();

/** Raised when a job name has no handler in this process (a deployment/wiring bug: never recorded as OK). */
export class UnregisteredJobError extends Error {
  readonly jobName: string;
  constructor(name: string) {
    super(`Job ${name} has no handler registered in this process`);
    this.name = "UnregisteredJobError";
    this.jobName = name;
  }
}

/** Registers (or replaces) the handler for a job name; business modules call this while the app is built. */
export function registerJob(name: JobName, handler: JobHandler): void {
  registry.set(name, handler);
}

/** The registered handler; throws UnregisteredJobError when there is none. */
export function jobHandler(name: string): JobHandler {
  const handler = registry.get(name);
  if (!handler) throw new UnregisteredJobError(name);
  return handler;
}

/** True when `name` has a handler in this process. */
export function hasJob(name: string): boolean {
  return registry.has(name);
}

/** Names of every job that currently has a handler registered. */
export function registeredJobs(): string[] {
  return [...registry.keys()];
}

/**
 * The app job handlers receive when the caller of runJob/startWorker only has a DB handle (server.ts's in-process worker): the first
 * full app that registered a module binds itself here.
 */
let boundApp: FastifyInstance | null = null;

/** Binds the app handed to job handlers when none is passed explicitly (the redis plugin binds the root app it decorates). */
export function bindJobApp(app: FastifyInstance): void {
  boundApp = app;
  app.addHook("onClose", async () => { if (boundApp === app) boundApp = null; });
}

/** The app bound by bindJobApp (null before any full app was built). */
export function jobApp(): FastifyInstance | null {
  return boundApp;
}

/** Options of runJob. */
export interface RunJobOptions {
  app?: FastifyInstance | null;
  /** 1-based attempt number (BullMQ attemptsMade + 1); default 1. */
  attempt?: number;
  /** Attempt budget; default 1 (a direct call is its own final attempt). */
  maxAttempts?: number;
  /** Id for the job_runs row (the run id handed out when the job was enqueued); default a new uuid. */
  runId?: string;
}

/** Outcome of a successful run (failures are thrown). */
export interface JobOutcome {
  runId: string;
  status: "OK";
  result: Record<string, unknown>;
  /** Always undefined (failures are thrown); kept so callers can log `outcome.error` uniformly. */
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical uuid string. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Payload without the internal `__*` keys the queue adds (run id, manual marker). */
export function publicJobData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("__")));
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 4000);
}

/**
 * Runs one attempt of a job: records a job_runs row (RUNNING → OK | FAILED) around the handler. A failure is recorded with
 * `{attempt, max_attempts, will_retry}` and RETHROWN (so BullMQ retries); on the final attempt the failure alert runs first.
 */
export async function runJob(db: DB, name: string, data: Record<string, unknown> = {}, opts: RunJobOptions = {}): Promise<JobOutcome> {
  const attempt = Math.max(1, opts.attempt ?? 1);
  const maxAttempts = Math.max(attempt, opts.maxAttempts ?? 1);
  const runId = isUuid(opts.runId) ? opts.runId : randomUUID();
  await db.insert(jobRuns).values({ id: runId, jobName: name, status: "RUNNING" })
    .onConflictDoUpdate({ target: jobRuns.id, set: { status: "RUNNING", startedAt: new Date(), finishedAt: null, error: null, result: null } });
  const log = logger.child({ job: name, runId, attempt });
  const app = opts.app === undefined ? boundApp : opts.app;
  try {
    const handler = jobHandler(name);
    const result = await handler({ db, log, data: publicJobData(data), app: app ?? null, runId, attempt, maxAttempts });
    await db.update(jobRuns).set({ status: "OK", finishedAt: new Date(), result: { ...result, ...(attempt > 1 ? { attempt } : {}) } }).where(eq(jobRuns.id, runId));
    log.info({ result }, "job finished");
    return { runId, status: "OK", result };
  } catch (err) {
    const final = err instanceof UnregisteredJobError || attempt >= maxAttempts;
    const message = errorMessage(err);
    await db.update(jobRuns).set({ status: "FAILED", finishedAt: new Date(), error: message, result: { attempt, max_attempts: maxAttempts, will_retry: !final } })
      .where(eq(jobRuns.id, runId)).catch((e: unknown) => log.error({ err: e }, "could not record the job failure"));
    log.error({ err, final }, final ? "job failed (final attempt)" : "job attempt failed; BullMQ will retry");
    // a tenant job (payload `company_id`) alerts only that company's Super Admins: its error text may carry that tenant's data
    const companyId = isUuid(data["company_id"]) ? data["company_id"] : null;
    if (final) await alertJobFailure(db, { jobName: name, runId, error: message, attempt, maxAttempts, companyId }).catch((e: unknown) => log.error({ err: e }, "job failure alert failed"));
    throw err;
  }
}
