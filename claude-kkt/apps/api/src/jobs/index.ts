/**
 * Core job registry and runner (audit A7). Business modules register handlers while the Fastify app is built (`registerJob`); the
 * standalone worker (src/worker.ts) builds the same app, so every handler exists there too. Rules:
 *   - a job name without a handler is an error (UnregisteredJobError), never a silent OK no-op;
 *   - every attempt is a `job_runs` row (RUNNING → OK | FAILED) and a failure is RETHROWN so BullMQ retries it (3 attempts, exponential
 *     backoff); after the final attempt the Super Admins are notified and ERROR_WEBHOOK_URL (when set) receives a JSON POST;
 *   - two queues: CRITICAL (dues, integrity, notifications, SLA, sweeps — time-critical, short) and HEAVY (backups, exports, ledger
 *     rebuild, re-encryption, image renditions — long, resumable), each with its own concurrency and lock settings (worker.ts);
 *   - every attempt has a time budget (JOB_TIMEOUT_MS): the handler's `signal` aborts at it, and a worker shutdown aborts heavy jobs the
 *     same way; handlers check the signal between batches. Heavy handlers save `saveCheckpoint(...)` after each batch and read
 *     `checkpoint` on start, so a re-run (retry, stall recovery, a deploy) resumes instead of starting over;
 *   - `job_runs.heartbeat_at` is renewed every 15 s while an attempt runs, so a dead worker's run is recognised within minutes.
 */
import { createHash, randomUUID } from "node:crypto";
import type { JobsOptions } from "bullmq";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { JobName } from "@kkt/contracts";
import { jobRuns, type DB } from "@kkt/db";
import { logger } from "../lib/logger.js";
import { jobInterruptionsTotal, recordJobRun } from "../lib/metrics.js";
import { alertJobFailure } from "./alerts.js";

/** Name of the CRITICAL BullMQ queue (every schedule and every job not listed in HEAVY_JOBS). The name predates the split. */
export const QUEUE_NAME = "kkt-jobs";
/** Name of the HEAVY BullMQ queue (HEAVY_JOBS: long, resumable work that must never delay DAILY_DUES). */
export const HEAVY_QUEUE_NAME = "kkt-jobs-heavy";

/** Jobs that run on the heavy queue. */
export const HEAVY_JOBS: ReadonlySet<JobName> = new Set<JobName>([
  "BACKUP_EXPORT",
  "LEDGER_REBUILD",
  "REENCRYPT_FIELDS",
  "EXPORT_CSV",
  "DOCUMENT_RENDITIONS",
]);

/** Which queue a job belongs on. */
export type QueueKind = "critical" | "heavy";

/** Queue kind of a job name. */
export function queueKindOf(name: string): QueueKind {
  return HEAVY_JOBS.has(name as JobName) ? "heavy" : "critical";
}

/** BullMQ queue name of a job name. */
export function queueNameOf(name: string): string {
  return queueKindOf(name) === "heavy" ? HEAVY_QUEUE_NAME : QUEUE_NAME;
}

/**
 * BullMQ worker settings per queue (explicit instead of BullMQ defaults). The lock is renewed every lockDuration / 2 while a job runs;
 * a job whose lock lapsed (its worker died or its event loop stalled for lockDuration) is "stalled" and moved back to wait at the next
 * check (stalledInterval) up to maxStalledCount times, then failed. Heavy jobs get a long lock (CPU-bound phases such as ZIP compression
 * can hold the event loop) and more stall recoveries (they resume from their checkpoint, so a recovery is cheap).
 */
export const WORKER_SETTINGS: Readonly<
  Record<QueueKind, { lockDuration: number; stalledInterval: number; maxStalledCount: number }>
> = {
  critical: { lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 1 },
  heavy: { lockDuration: 5 * 60_000, stalledInterval: 60_000, maxStalledCount: 3 },
};

/** How often a running attempt renews job_runs.heartbeat_at. */
export const JOB_HEARTBEAT_MS = 15_000;
/** A RUNNING row whose heartbeat is older than this belongs to a dead worker (JOB_RUN_SWEEP marks it ABANDONED). */
export const JOB_HEARTBEAT_STALE_MS = 3 * 60_000;
/** How long an attempt may keep running after its signal aborted before runJob gives up on it (it should stop at its next batch). */
export const JOB_ABORT_GRACE_MS = 30_000;

/** A job attempt stopped at its time budget. */
export class JobTimeoutError extends Error {
  readonly jobName: string;
  readonly timeoutMs: number;
  constructor(jobName: string, timeoutMs: number) {
    super(`Job ${jobName} exceeded its time budget of ${Math.round(timeoutMs / 1000)} s and was stopped`);
    this.name = "JobTimeoutError";
    this.jobName = jobName;
    this.timeoutMs = timeoutMs;
  }
}

/** A job attempt interrupted by a worker shutdown: it is put back on its queue (no attempt used) and resumes from its checkpoint. */
export class JobInterruptedError extends Error {
  readonly reason: string;
  constructor(reason = "worker shutdown") {
    super(`Job interrupted: ${reason}; it resumes from its checkpoint`);
    this.name = "JobInterruptedError";
    this.reason = reason;
  }
}

/** JSON resume point of a heavy job (job-specific: last processed id, page cursor, file part count…). */
export type JobCheckpoint = Record<string, unknown>;

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
  /**
   * Aborted when the attempt reaches its time budget (JOB_TIMEOUT_MS) or the worker shuts down (heavy jobs). Check it between batches
   * (`signal.throwIfAborted()`), after saving the checkpoint of the finished batch. Optional only for handler tests that build a context.
   */
  signal?: AbortSignal;
  /** Resume point saved by an earlier, interrupted attempt of the same queued job (null on a fresh start). */
  checkpoint?: JobCheckpoint | null;
  /** Saves the resume point after a finished batch (job_runs.checkpoint); a re-run of the job gets it back as `checkpoint`. */
  saveCheckpoint?: (checkpoint: JobCheckpoint) => Promise<void>;
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
  { name: "JOB_RUN_SWEEP", cron: "*/15 * * * *", tz: "Asia/Kolkata" },
  // phase 7: the audit hash chain (security track, modules/audit AUDIT_SEAL_SCHEDULE) and the storage orphan / deletion sweep
  { name: "AUDIT_SEAL", cron: "*/15 * * * *", tz: "Asia/Kolkata" },
  { name: "STORAGE_SWEEP", cron: "*/10 * * * *", tz: "Asia/Kolkata" },
];

/** Default time budget of a job run (JOB_TIMEOUT_MS overrides per job below). */
export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60_000;

/**
 * Time budget of each job: the longest a healthy run is expected to take. A run still RUNNING after TWICE its budget is considered
 * abandoned (its worker died mid-run: BullMQ retries the job under a new run id, so nothing would ever finish that row) and
 * JOB_RUN_SWEEP marks it ABANDONED. A run that does finish later still records its real outcome over it.
 */
export const JOB_TIMEOUT_MS: Partial<Record<JobName, number>> = {
  HOLD_EXPIRY: 5 * 60_000,
  IDEMPOTENCY_PURGE: 15 * 60_000,
  JOB_RUN_SWEEP: 5 * 60_000,
  DAILY_DUES: 60 * 60_000,
  DUES_CATCHUP: 60 * 60_000,
  NIGHTLY_INTEGRITY: 60 * 60_000,
  STARTUP_RECONCILIATION: 60 * 60_000,
  NOTIFICATION_SWEEP: 60 * 60_000,
  EXPORT_CSV: 60 * 60_000,
  BACKUP_EXPORT: 2 * 60 * 60_000,
  REENCRYPT_FIELDS: 2 * 60 * 60_000,
  LEDGER_REBUILD: 2 * 60 * 60_000,
  AUDIT_SEAL: 10 * 60_000,
  DOCUMENT_RENDITIONS: 5 * 60_000,
  STORAGE_SWEEP: 10 * 60_000,
};

/** Time budget of a job (JOB_TIMEOUT_MS, else DEFAULT_JOB_TIMEOUT_MS). */
export function jobTimeoutMs(name: string): number {
  return JOB_TIMEOUT_MS[name as JobName] ?? DEFAULT_JOB_TIMEOUT_MS;
}

/** Rows examined per JOB_RUN_SWEEP statement. */
export const JOB_RUN_SWEEP_BATCH = 1_000;

/**
 * JOB_RUN_SWEEP: marks job_runs rows that are still RUNNING after twice their job's time budget, or whose heartbeat stopped more than
 * JOB_HEARTBEAT_STALE_MS ago (their worker died), as ABANDONED (finished_at = now, error explains why). A run parked by a shutdown
 * (`result.interrupted`) is left alone until its budget rule applies: the next worker resumes it under the same row. Only rows still
 * RUNNING are touched, so a run that finishes concurrently keeps its real outcome.
 */
export async function sweepAbandonedJobRuns(
  db: DB,
  now: Date = new Date(),
): Promise<{ abandoned: number; jobs: Record<string, number> }> {
  const shortest = Math.min(DEFAULT_JOB_TIMEOUT_MS, ...Object.values(JOB_TIMEOUT_MS));
  const jobs: Record<string, number> = {};
  let abandoned = 0;
  let cursor: { at: Date; id: string } | null = null;
  for (;;) {
    // oldest first, keyset pages of (started_at, id): rows younger than twice the shortest budget can never be abandoned yet
    const rows: { id: string; jobName: string; startedAt: Date; heartbeatAt: Date | null; result: unknown }[] = await db
      .select({
        id: jobRuns.id,
        jobName: jobRuns.jobName,
        startedAt: jobRuns.startedAt,
        heartbeatAt: jobRuns.heartbeatAt,
        result: jobRuns.result,
      })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.status, "RUNNING"),
          lt(jobRuns.startedAt, new Date(now.getTime() - Math.min(2 * shortest, JOB_HEARTBEAT_STALE_MS))),
          cursor
            ? sql`(${jobRuns.startedAt}, ${jobRuns.id}) > (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(jobRuns.startedAt), asc(jobRuns.id))
      .limit(JOB_RUN_SWEEP_BATCH);
    const stale = rows.filter((r) => {
      if (now.getTime() - r.startedAt.getTime() > 2 * jobTimeoutMs(r.jobName)) return true;
      const parked = (r.result as { interrupted?: unknown } | null)?.interrupted === true;
      return !parked && r.heartbeatAt !== null && now.getTime() - r.heartbeatAt.getTime() > JOB_HEARTBEAT_STALE_MS;
    });
    if (stale.length > 0) {
      const updated = await db
        .update(jobRuns)
        .set({
          status: "ABANDONED",
          finishedAt: now,
          error:
            "Abandoned: still RUNNING after twice the job's time budget, or its heartbeat stopped (the worker running it died); a retry, if any, runs under its own run id",
        })
        .where(
          and(
            inArray(
              jobRuns.id,
              stale.map((r) => r.id),
            ),
            eq(jobRuns.status, "RUNNING"),
          ),
        )
        .returning({ jobName: jobRuns.jobName });
      for (const u of updated) jobs[u.jobName] = (jobs[u.jobName] ?? 0) + 1;
      abandoned += updated.length;
    }
    const last = rows[rows.length - 1];
    if (!last || rows.length < JOB_RUN_SWEEP_BATCH) break;
    cursor = { at: last.startedAt, id: last.id };
  }
  if (abandoned > 0) logger.warn({ abandoned, jobs }, "job runs marked ABANDONED");
  return { abandoned, jobs };
}

/** Attempts per job (first run + 2 retries). */
export const JOB_ATTEMPTS = 3;

/** Base delay of the exponential retry backoff (JOB_BACKOFF_MS, default 30 s → retries after 30 s and 60 s). */
export function jobBackoffMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env["JOB_BACKOFF_MS"]);
  return Number.isInteger(n) && n >= 0 ? n : 30_000;
}

/** BullMQ options every enqueued or scheduled job gets: 3 attempts with exponential backoff, bounded history. */
export function defaultJobOptions(): JobsOptions {
  return {
    attempts: JOB_ATTEMPTS,
    backoff: { type: "exponential", delay: jobBackoffMs() },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  };
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
  app.addHook("onClose", async () => {
    if (boundApp === app) boundApp = null;
  });
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
  /** Aborts the attempt from outside (the worker's shutdown); combined with the time budget. */
  signal?: AbortSignal;
  /** Identity of the queued job across attempts (BullMQ queue + job id): its saved checkpoint is handed to a re-run. */
  jobKey?: string;
  /** Time budget of this attempt (default jobTimeoutMs(name)). */
  timeoutMs?: number;
  /** How long an aborted handler may take to stop (default JOB_ABORT_GRACE_MS). */
  abortGraceMs?: number;
  /** Heartbeat interval (default JOB_HEARTBEAT_MS; tests shorten it). */
  heartbeatMs?: number;
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

/** Deterministic uuid for (queue, job id, attempt): a resumed or recovered attempt keeps its job_runs row (and its checkpoint). */
export function attemptRunId(jobKey: string, attempt: number): string {
  const h = createHash("sha256").update(`${jobKey}#${attempt}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Latest checkpoint saved for a queued job (any attempt that did not finish OK); null when there is none. */
export async function loadCheckpoint(db: DB, name: string, jobKey: string): Promise<JobCheckpoint | null> {
  const [row] = await db
    .select({ checkpoint: jobRuns.checkpoint })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, name), ne(jobRuns.status, "OK"), sql`${jobRuns.checkpoint} ->> '__job' = ${jobKey}`))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);
  if (!row?.checkpoint) return null;
  const { __job: _job, ...rest } = row.checkpoint as Record<string, unknown>;
  return rest;
}

/**
 * Waits for `work`; once `signal` aborts, gives the handler `graceMs` to notice and stop, then rejects with the abort reason (the handler
 * keeps running in the background, but its lock, its row and its retry are no longer held up by it).
 */
async function settleWithin<T>(work: Promise<T>, signal: AbortSignal, graceMs: number): Promise<T> {
  if (signal.aborted) return work;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const late = new Promise<never>((_, reject) => {
    onAbort = () => {
      timer = setTimeout(() => reject(signal.reason as Error), graceMs);
      timer.unref?.();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Runs one attempt of a job: records a job_runs row (RUNNING → OK | FAILED) around the handler. A failure is recorded with
 * `{attempt, max_attempts, will_retry}` and RETHROWN (so BullMQ retries); on the final attempt the failure alert runs first.
 */
export async function runJob(
  db: DB,
  name: string,
  data: Record<string, unknown> = {},
  opts: RunJobOptions = {},
): Promise<JobOutcome> {
  const attempt = Math.max(1, opts.attempt ?? 1);
  const maxAttempts = Math.max(attempt, opts.maxAttempts ?? 1);
  const runId = isUuid(opts.runId) ? opts.runId : randomUUID();
  await db
    .insert(jobRuns)
    .values({ id: runId, jobName: name, status: "RUNNING", heartbeatAt: new Date() })
    .onConflictDoUpdate({
      target: jobRuns.id,
      // a resumed attempt (same row) keeps its checkpoint
      set: {
        status: "RUNNING",
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        result: null,
        heartbeatAt: new Date(),
      },
    });
  const log = logger.child({ job: name, runId, attempt });
  const app = opts.app === undefined ? boundApp : opts.app;
  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  const timeoutMs = opts.timeoutMs ?? jobTimeoutMs(name);
  const budget = new AbortController();
  const budgetTimer = setTimeout(() => budget.abort(new JobTimeoutError(name, timeoutMs)), timeoutMs);
  budgetTimer.unref();
  const signal = opts.signal ? AbortSignal.any([budget.signal, opts.signal]) : budget.signal;
  const beat = setInterval(() => {
    db.update(jobRuns)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(jobRuns.id, runId), eq(jobRuns.status, "RUNNING")))
      .catch((e: unknown) => log.warn({ err: (e as Error).message }, "job heartbeat failed"));
  }, opts.heartbeatMs ?? JOB_HEARTBEAT_MS);
  beat.unref();
  const jobKey = opts.jobKey;
  try {
    const handler = jobHandler(name);
    const checkpoint = jobKey ? await loadCheckpoint(db, name, jobKey) : null;
    if (checkpoint) log.info({ checkpoint }, "job resumes from its checkpoint");
    const saveCheckpoint = async (cp: JobCheckpoint): Promise<void> => {
      await db
        .update(jobRuns)
        .set({ checkpoint: { ...cp, ...(jobKey ? { __job: jobKey } : {}) }, heartbeatAt: new Date() })
        .where(eq(jobRuns.id, runId));
    };
    const result = await settleWithin(
      handler({
        db,
        log,
        data: publicJobData(data),
        app: app ?? null,
        runId,
        attempt,
        maxAttempts,
        signal,
        checkpoint,
        saveCheckpoint,
      }),
      signal,
      opts.abortGraceMs ?? JOB_ABORT_GRACE_MS,
    );
    await db
      .update(jobRuns)
      .set({
        status: "OK",
        finishedAt: new Date(),
        checkpoint: null,
        result: { ...result, ...(attempt > 1 ? { attempt } : {}), ...(checkpoint ? { resumed: true } : {}) },
      })
      .where(eq(jobRuns.id, runId));
    recordJobRun(name, "OK", seconds());
    log.info({ result }, "job finished");
    return { runId, status: "OK", result };
  } catch (caught) {
    // a handler that noticed the abort throws the signal's reason (or its own AbortError): report the reason
    const err = signal.aborted && !(caught instanceof UnregisteredJobError) ? (signal.reason as Error) : caught;
    if (err instanceof JobInterruptedError) {
      // parked, not failed: the worker puts the job back on its queue and the next attempt resumes under this row
      jobInterruptionsTotal.inc({ job_name: name, reason: "shutdown" });
      await db
        .update(jobRuns)
        .set({
          heartbeatAt: null,
          result: { interrupted: true, reason: err.reason, attempt, at: new Date().toISOString() },
        })
        .where(eq(jobRuns.id, runId))
        .catch((e: unknown) => log.error({ err: e }, "could not record the interruption"));
      log.warn({ reason: err.reason }, "job interrupted; it resumes from its checkpoint");
      throw err;
    }
    if (err instanceof JobTimeoutError) jobInterruptionsTotal.inc({ job_name: name, reason: "timeout" });
    recordJobRun(name, "FAILED", seconds());
    const final = err instanceof UnregisteredJobError || attempt >= maxAttempts;
    const message = errorMessage(err);
    await db
      .update(jobRuns)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
        result: { attempt, max_attempts: maxAttempts, will_retry: !final },
      })
      .where(eq(jobRuns.id, runId))
      .catch((e: unknown) => log.error({ err: e }, "could not record the job failure"));
    log.error({ err, final }, final ? "job failed (final attempt)" : "job attempt failed; BullMQ will retry");
    // a tenant job (payload `company_id`) alerts only that company's Super Admins: its error text may carry that tenant's data
    const companyId = isUuid(data["company_id"]) ? data["company_id"] : null;
    if (final)
      await alertJobFailure(db, { jobName: name, runId, error: message, attempt, maxAttempts, companyId }).catch(
        (e: unknown) => log.error({ err: e }, "job failure alert failed"),
      );
    throw err;
  } finally {
    clearTimeout(budgetTimer);
    clearInterval(beat);
  }
}
