/**
 * Job worker (audit A7). The standalone process (`node dist/worker.js`, docker-compose `worker`) builds the FULL Fastify app without
 * listening, so every module registers its job handlers exactly as in the API, then consumes the kkt-jobs queue. On start it upserts the
 * repeatable schedules and enqueues the once-per-deploy boot jobs (jobs/queue.ts). The API can run the same consumer in-process
 * (RUN_JOBS_IN_API, server.ts → startWorker(app)).
 */
import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker, type Job, type Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { createDb, type DB, type DbHandle } from "@kkt/db";
import { config } from "./config.js";
import { isUuid, jobApp, registeredJobs, runJob, UnregisteredJobError, QUEUE_NAME } from "./jobs/index.js";
import { bullConnection, createQueue, enqueueBootJobs, registerSchedules, type BootJobsResult, type ScheduleResult } from "./jobs/queue.js";
import { logger } from "./lib/logger.js";

export { bullConnection, enqueueJob } from "./jobs/queue.js";

/** A running worker with its queue (closeable). */
export interface RunningWorker {
  queue: Queue;
  worker: Worker;
  schedules: ScheduleResult;
  boot: BootJobsResult | null;
  close(): Promise<void>;
}

/** Options of startWorker. */
export interface StartWorkerOptions {
  /** The built app (preferred): its DB handle, Redis and routes are handed to the handlers. */
  app?: FastifyInstance;
  /** DB handle when no app is given (a dedicated pool of 4 is opened otherwise). */
  db?: DB;
  /** Parallel jobs (default 2). */
  concurrency?: number;
  /** Upsert the repeatable schedules (default true). */
  schedules?: boolean;
  /** Enqueue the once-per-deploy boot jobs (default true). */
  boot?: boolean;
  /** Redis URL of the queue (default REDIS_URL). */
  redisUrl?: string;
}

/** Processes one BullMQ job: one runJob attempt; an unknown job name fails without retries. */
export function processJob(db: DB, app: FastifyInstance | null) {
  return async (job: Job): Promise<Record<string, unknown>> => {
    const data = (job.data ?? {}) as Record<string, unknown>;
    const attempt = job.attemptsMade + 1;
    // the first attempt uses the run id handed out at enqueue time; retries get their own job_runs rows
    const runId = attempt === 1 && isUuid(data["__run_id"]) ? data["__run_id"] : randomUUID();
    try {
      const outcome = await runJob(db, job.name, data, { app, attempt, maxAttempts: job.opts.attempts ?? 1, runId });
      return { run_id: outcome.runId, ...outcome.result };
    } catch (err) {
      if (err instanceof UnregisteredJobError) throw new UnrecoverableError(err.message);
      throw err;
    }
  };
}

/** Starts the BullMQ consumer for the kkt-jobs queue, upserts the schedules and enqueues the boot jobs. */
export async function startWorker(target?: DB | FastifyInstance | StartWorkerOptions): Promise<RunningWorker> {
  const opts: StartWorkerOptions = !target ? {} : isApp(target) ? { app: target } : isOptions(target) ? target : { db: target };
  const app = opts.app ?? jobApp();
  const handle: DbHandle | null = opts.app || opts.db ? null : createDb(config.DATABASE_URL, { max: 4 });
  const db = opts.app?.db ?? opts.db ?? handle!.db;
  const connection = bullConnection(opts.redisUrl);
  const queue = createQueue(opts.redisUrl);
  const registered = new Set(registeredJobs());
  const schedules = opts.schedules === false ? { scheduled: [], unregistered: [], disabled: [] } : await registerSchedules(queue, registered);
  const worker = new Worker(QUEUE_NAME, processJob(db, app), { connection, concurrency: opts.concurrency ?? 2 });
  worker.on("failed", (job, err) => logger.error({ job: job?.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, "job attempt failed"));
  worker.on("error", (err) => logger.error({ err }, "worker error"));
  let boot: BootJobsResult | null = null;
  if (opts.boot !== false) {
    const lockRedis = (app as unknown as { redisSecurity?: Redis } | null)?.redisSecurity ?? app?.redis ?? null;
    if (lockRedis) boot = await enqueueBootJobs(queue, { db, lockRedis, registered });
    else logger.warn("no Redis client for the boot lock; boot jobs not enqueued");
  }
  logger.info({ queue: QUEUE_NAME, registered: [...registered], scheduled: schedules.scheduled, unregistered: schedules.unregistered }, "worker started");
  return {
    queue,
    worker,
    schedules,
    boot,
    close: async () => {
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
      if (handle) await handle.close().catch(() => undefined);
    },
  };
}

function isApp(x: unknown): x is FastifyInstance {
  return typeof x === "object" && x !== null && typeof (x as { inject?: unknown }).inject === "function";
}

function isOptions(x: unknown): x is StartWorkerOptions {
  return typeof x === "object" && x !== null && !("select" in x) && ("app" in x || "db" in x || "boot" in x || "schedules" in x || "concurrency" in x || "redisUrl" in x);
}

/** Standalone entry point: build the full app (no listen), start the consumer, shut down on SIGTERM/SIGINT. */
async function main(): Promise<void> {
  const { buildApp } = await import("./app.js");
  // jobs write exports, backups and portal files: fail fast (like the API) when the object store is unusable
  const { createStorage } = await import("./lib/storage.js");
  await createStorage().check();
  const app = await buildApp({ logger: true });
  await app.ready();
  const running = await startWorker({ app });
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    const timer = setTimeout(() => process.exit(1), 30_000);
    try {
      await running.close();
      await app.close();
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

const isMain = /worker\.(ts|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  main().catch((err: unknown) => { logger.fatal({ err }, "worker failed to start"); process.exit(1); });
}
