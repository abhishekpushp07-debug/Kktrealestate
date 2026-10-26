/**
 * BullMQ plumbing shared by the worker and the API: connection options (the main REDIS_URL), enqueue with the default retry policy,
 * repeatable schedules, and the once-per-deploy boot jobs (SPEC §10/§13 "at startup": reconciliation, dues catch-up, notification sweep).
 */
import { randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";
import { DateTime } from "luxon";
import type { JobName } from "@kkt/contracts";
import { jobRuns, type DB } from "@kkt/db";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { defaultJobOptions, JOB_SCHEDULES, QUEUE_NAME } from "./index.js";

/** Connection options BullMQ needs, parsed from the main REDIS_URL (BullMQ never shares the security Redis). */
export function bullConnection(url: string = config.REDIS_URL): ConnectionOptions & { host: string; port: number; db?: number } {
  const u = new URL(url);
  const db = u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined;
  return {
    host: u.hostname || "localhost",
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(db !== undefined && !Number.isNaN(db) ? { db } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

/** A new queue handle on the main Redis (callers close it). */
export function createQueue(url?: string): Queue {
  return new Queue(QUEUE_NAME, { connection: bullConnection(url), defaultJobOptions: defaultJobOptions() });
}

/** What enqueueJob hands back: the job_runs id the first attempt will use, and the BullMQ job id (the same uuid). */
export interface EnqueuedJob {
  runId: string;
  jobId: string;
  name: string;
  queuedAt: string;
  /** True when `dedupeId` matched a job that is still waiting, delayed (retry backoff) or running: nothing new was enqueued. */
  deduplicated: boolean;
}

/**
 * Enqueues a job to run as soon as a worker is free (3 attempts, exponential backoff). The run id doubles as the BullMQ job id.
 * `dedupeId` makes the add atomic against duplicates: while a job with the same id is pending or running (incl. its retries), the add
 * is a no-op that returns the existing job (`deduplicated: true`) — Redis decides, so parallel callers cannot both enqueue.
 */
export async function enqueueJob(queue: Queue, name: JobName, data: Record<string, unknown> = {}, opts: { runId?: string; delayMs?: number; dedupeId?: string } = {}): Promise<EnqueuedJob> {
  const runId = opts.runId ?? randomUUID();
  const job = await queue.add(name, { ...data, __run_id: runId }, {
    ...defaultJobOptions(), jobId: runId, ...(opts.delayMs ? { delay: opts.delayMs } : {}), ...(opts.dedupeId ? { deduplication: { id: opts.dedupeId } } : {}),
  });
  const jobId = job.id ?? runId;
  return { runId: jobId === runId ? runId : jobId, jobId, name, queuedAt: new Date(job.timestamp || Date.now()).toISOString(), deduplicated: jobId !== runId };
}

/** How long an HTTP request waits for the queue (Redis) before answering 503 instead of hanging on BullMQ's reconnect loop. */
export const ENQUEUE_DEADLINE_MS = 5_000;

/** enqueueJob with a deadline: rejects with an Error("job queue unreachable …") when Redis does not answer within `ms`. */
export async function enqueueJobWithin(queue: Queue, name: JobName, data: Record<string, unknown> = {}, opts: { runId?: string; delayMs?: number; dedupeId?: string } = {}, ms = ENQUEUE_DEADLINE_MS): Promise<EnqueuedJob> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      enqueueJob(queue, name, data, opts),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`job queue unreachable: ${name} not enqueued within ${ms} ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Result of registerSchedules. */
export interface ScheduleResult {
  scheduled: string[];
  /** Names without a handler in this process (warned, not scheduled). */
  unregistered: string[];
  /** Names whose schedule is switched off (e.g. PARTITION_MAINTENANCE without PARTITIONING_ENABLED). */
  disabled: string[];
}

/** Scheduler id of a job's repeatable schedule. */
export const schedulerId = (name: string) => `schedule:${name}`;

/**
 * Upserts the repeatable schedules (idempotent by scheduler id). A job without a handler is skipped with a warning instead of failing the
 * boot (a module that is not deployed yet), and a disabled schedule is removed so it stops firing.
 */
export async function registerSchedules(queue: Queue, registered: ReadonlySet<string>, log = logger): Promise<ScheduleResult> {
  const out: ScheduleResult = { scheduled: [], unregistered: [], disabled: [] };
  for (const s of JOB_SCHEDULES) {
    if (s.enabled && !s.enabled()) {
      await queue.removeJobScheduler(schedulerId(s.name)).catch(() => false);
      out.disabled.push(s.name);
      continue;
    }
    if (!registered.has(s.name)) {
      log.warn({ job: s.name }, "scheduled job has no handler in this process; not scheduled");
      out.unregistered.push(s.name);
      continue;
    }
    await queue.upsertJobScheduler(schedulerId(s.name), { pattern: s.cron, tz: s.tz }, { name: s.name, data: {}, opts: defaultJobOptions() });
    out.scheduled.push(s.name);
  }
  return out;
}

/** Next fire time of every repeatable schedule on the queue (scheduler id → ISO time); empty when the queue cannot be read. */
export async function nextRuns(queue: Queue): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (const s of await queue.getJobSchedulers(0, 199)) {
      if (s.next && s.name) out.set(s.name, new Date(s.next).toISOString());
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "could not read job schedulers");
  }
  return out;
}

/** The most recent 00:30 IST at or before `now` (the daily dues slot a catch-up must not have missed). */
export function lastDuesSlot(now: Date = new Date()): Date {
  const ist = DateTime.fromJSDate(now, { zone: "Asia/Kolkata" });
  let slot = ist.set({ hour: 0, minute: 30, second: 0, millisecond: 0 });
  if (slot > ist) slot = slot.minus({ days: 1 });
  return slot.toJSDate();
}

/** Last successful DAILY_DUES / DUES_CATCHUP start time, or null. */
export async function lastSuccessfulDuesRun(db: DB): Promise<Date | null> {
  const [row] = await db.select({ startedAt: jobRuns.startedAt }).from(jobRuns)
    .where(and(inArray(jobRuns.jobName, ["DAILY_DUES", "DUES_CATCHUP"]), eq(jobRuns.status, "OK"))).orderBy(desc(jobRuns.startedAt)).limit(1);
  return row?.startedAt ?? null;
}

/** Identity of this deploy for the boot lock: DEPLOY_ID (or GIT_SHA) plus APP_VERSION. */
export function deployId(env: Record<string, string | undefined> = process.env): string {
  return `${config.APP_VERSION}:${env["DEPLOY_ID"] ?? env["GIT_SHA"] ?? "default"}`;
}

/** How long the once-per-deploy boot lock is held (a crash-looping worker does not re-run the boot jobs on every restart). */
export const BOOT_LOCK_SECONDS = 6 * 3600;

/** Result of enqueueBootJobs. */
export interface BootJobsResult {
  /** False when another worker of this deploy already enqueued the boot jobs. */
  acquired: boolean;
  enqueued: EnqueuedJob[];
  skipped: { name: string; reason: string }[];
}

/**
 * Boot jobs, once per deploy (Redis lock `boot:jobs:<deploy>`): STARTUP_RECONCILIATION, NOTIFICATION_SWEEP, and the dues catch-up when
 * the last successful DAILY_DUES/DUES_CATCHUP run started before the latest 00:30 IST slot (DUES_CATCHUP when registered, else DAILY_DUES).
 */
export async function enqueueBootJobs(queue: Queue, deps: { db: DB; lockRedis: Redis; registered: ReadonlySet<string>; deploy?: string; now?: Date; log?: typeof logger }): Promise<BootJobsResult> {
  const log = deps.log ?? logger;
  const out: BootJobsResult = { acquired: false, enqueued: [], skipped: [] };
  const lockKey = `boot:jobs:${deps.deploy ?? deployId()}`;
  const lock = await deps.lockRedis.set(lockKey, `${process.pid}`, "EX", BOOT_LOCK_SECONDS, "NX");
  if (!lock) {
    log.info("boot jobs already enqueued for this deploy");
    return out;
  }
  out.acquired = true;
  try {
    // decide everything before enqueuing anything, so a failure leaves nothing half-done
    const last = await lastSuccessfulDuesRun(deps.db);
    const slot = lastDuesSlot(deps.now);
    const duesDone = Boolean(last && last >= slot);
    const want = async (name: JobName): Promise<void> => {
      if (!deps.registered.has(name)) {
        out.skipped.push({ name, reason: "no handler registered" });
        log.warn({ job: name }, "boot job has no handler in this process; skipped");
        return;
      }
      out.enqueued.push(await enqueueJob(queue, name, { __boot: true }));
    };
    await want("STARTUP_RECONCILIATION");
    if (duesDone) out.skipped.push({ name: "DUES_CATCHUP", reason: `last successful dues run ${last!.toISOString()} is after ${slot.toISOString()}` });
    else await want(deps.registered.has("DUES_CATCHUP") ? "DUES_CATCHUP" : "DAILY_DUES");
    await want("NOTIFICATION_SWEEP");
  } catch (err) {
    // release the once-per-deploy lock: otherwise a transient DB/Redis error at boot suppresses the boot jobs for BOOT_LOCK_SECONDS
    await deps.lockRedis.del(lockKey).catch(() => undefined);
    throw err;
  }
  log.info({ enqueued: out.enqueued.map((e) => e.name), skipped: out.skipped }, "boot jobs enqueued");
  return out;
}
