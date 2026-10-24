import { Queue, Worker, type Job } from "bullmq";
import { createDb, type DB, type DbHandle } from "@kkt/db";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { JOB_SCHEDULES, QUEUE_NAME, runJob } from "./jobs/index.js";

/** Connection options BullMQ needs (parsed from REDIS_URL). */
export function bullConnection(): { host: string; port: number; password?: string; db?: number; username?: string } {
  const u = new URL(config.REDIS_URL);
  const db = u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined;
  return { host: u.hostname || "localhost", port: Number(u.port || 6379), ...(u.password ? { password: decodeURIComponent(u.password) } : {}), ...(u.username ? { username: decodeURIComponent(u.username) } : {}), ...(db !== undefined && !Number.isNaN(db) ? { db } : {}) };
}

/** A running worker with its queue (closeable). */
export interface RunningWorker {
  queue: Queue;
  worker: Worker;
  close(): Promise<void>;
}

/** Registers the repeatable schedules on the queue (idempotent by scheduler id). */
export async function registerSchedules(queue: Queue): Promise<void> {
  for (const s of JOB_SCHEDULES) {
    await queue.upsertJobScheduler(`schedule:${s.name}`, { pattern: s.cron, tz: s.tz }, { name: s.name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } });
  }
}

/** Enqueues a job to run as soon as a worker is free (admin "run now"). */
export async function enqueueJob(queue: Queue, name: string, data: Record<string, unknown> = {}): Promise<string> {
  const job = await queue.add(name, data, { removeOnComplete: 100, removeOnFail: 100 });
  return job.id ?? "";
}

/** Starts the BullMQ worker for the kkt-jobs queue (optionally on an existing DB handle) and registers the schedules. */
export async function startWorker(existingDb?: DB): Promise<RunningWorker> {
  const connection = bullConnection();
  const handle: DbHandle | null = existingDb ? null : createDb(config.DATABASE_URL, { max: 4 });
  const db = existingDb ?? handle!.db;
  const queue = new Queue(QUEUE_NAME, { connection });
  await registerSchedules(queue);
  const worker = new Worker(QUEUE_NAME, async (job: Job) => runJob(db, job.name, (job.data ?? {}) as Record<string, unknown>), { connection, concurrency: 2 });
  worker.on("failed", (job, err) => logger.error({ job: job?.name, err }, "job failed"));
  worker.on("error", (err) => logger.error({ err }, "worker error"));
  logger.info({ queue: QUEUE_NAME, schedules: JOB_SCHEDULES.map((s) => `${s.name}@${s.cron}`) }, "worker started");
  return {
    queue,
    worker,
    close: async () => {
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
      if (handle) await handle.close().catch(() => undefined);
    },
  };
}

const isMain = /worker\.(ts|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  startWorker()
    .then((w) => {
      const stop = async () => { await w.close(); process.exit(0); };
      process.on("SIGTERM", () => void stop());
      process.on("SIGINT", () => void stop());
    })
    .catch((err: unknown) => { logger.fatal({ err }, "worker failed to start"); process.exit(1); });
}
