/**
 * Job worker (audit A7). The standalone process (`node --import ./dist/telemetry.js dist/worker.js`, docker-compose `worker`) builds the
 * FULL Fastify app without listening, so every module registers its job handlers exactly as in the API, then consumes the two job queues:
 *
 *   - CRITICAL (`kkt-jobs`, WORKER_CRITICAL_CONCURRENCY): dues, integrity, notifications, SLA, sweeps — every schedule lives here;
 *   - HEAVY (`kkt-jobs-heavy`, WORKER_HEAVY_CONCURRENCY): backups, exports, ledger rebuild, re-encryption, image renditions.
 *
 * Each queue has explicit BullMQ lock/stall settings (jobs/index.ts WORKER_SETTINGS); every attempt gets an AbortSignal that fires at its
 * time budget. On SIGTERM the worker stops fetching, interrupts heavy jobs (they checkpoint at their next batch and go back to the queue
 * without using an attempt, so the next worker resumes them), and waits up to WORKER_DRAIN_TIMEOUT_MS for in-flight critical jobs.
 * It writes a heartbeat to Redis every 15 s and serves GET /health (contract C8) and GET /metrics on WORKER_HEALTH_PORT.
 * The API can run the same consumers in-process (RUN_JOBS_IN_API, server.ts → startWorker(app)); no health port then.
 */
import "./preload.js";
import { createServer, type Server } from "node:http";
import { hostname } from "node:os";
import { UnrecoverableError, WaitingError, Worker, type Job, type Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { WorkerHealthResponse } from "@kkt/contracts";
import { createDb, type DB, type DbHandle } from "@kkt/db";
import { config } from "./config.js";
import {
  attemptRunId,
  HEAVY_QUEUE_NAME,
  isUuid,
  JOB_ABORT_GRACE_MS,
  JobInterruptedError,
  jobApp,
  QUEUE_NAME,
  queueKindOf,
  registeredJobs,
  runJob,
  UnregisteredJobError,
  WORKER_SETTINGS,
  type QueueKind,
} from "./jobs/index.js";
import {
  bullConnection,
  createQueue,
  enqueueBootJobs,
  queueFor,
  registerSchedules,
  type BootJobsResult,
  type ScheduleResult,
} from "./jobs/queue.js";
import { logger } from "./lib/logger.js";
import { METRICS_CONTENT_TYPE, localMetrics, workerHeartbeat } from "./lib/metrics.js";
import { installProcessErrorHandlers } from "./lib/processErrors.js";

export { bullConnection, enqueueJob } from "./jobs/queue.js";

/** Redis key holding the latest heartbeat of any job worker (read by the API's /health). */
export const WORKER_HEARTBEAT_KEY = "kkt:worker:heartbeat";
/** Per-process heartbeat keys (`kkt:worker:heartbeat:<host>:<pid>`), expiring a minute after the last beat. */
export const WORKER_HEARTBEAT_PREFIX = "kkt:worker:heartbeat:";
/** How often a worker beats (contract C8: every 15 s). */
export const WORKER_HEARTBEAT_MS = 15_000;

/** What one heartbeat records. */
export interface WorkerHeartbeat {
  at: string;
  host: string;
  pid: number;
  queues: string[];
  version: string;
}

/** A running worker with its queues (closeable). */
export interface RunningWorker {
  /** The critical queue handle (heavy jobs added to it are routed to the heavy queue). */
  queue: Queue;
  heavyQueue: Queue;
  /** Consumer of the critical queue. */
  worker: Worker;
  heavyWorker: Worker;
  schedules: ScheduleResult;
  boot: BootJobsResult | null;
  /** Health listener (standalone worker only). */
  health: Server | null;
  /** Time of this worker's last successful heartbeat. */
  lastHeartbeatAt(): Date | null;
  /** The C8 health report (what GET /health answers). */
  healthReport(): Promise<{ status: 200 | 503; body: WorkerHealthResponse }>;
  /**
   * Graceful drain: stop fetching, interrupt heavy jobs (checkpoint → back to the queue), wait up to `timeoutMs` (default
   * WORKER_DRAIN_TIMEOUT_MS) for in-flight critical jobs, then interrupt / force-close what is left. `forced` is true when jobs had to be
   * abandoned to BullMQ's stall recovery.
   */
  drain(timeoutMs?: number): Promise<{ forced: boolean; interrupted: number }>;
  /** Drains (when not done yet) and closes queues, heartbeat, health listener and the worker's own DB pool. */
  close(timeoutMs?: number): Promise<void>;
}

/** Options of startWorker. */
export interface StartWorkerOptions {
  /** The built app (preferred): its DB handle, Redis and routes are handed to the handlers. */
  app?: FastifyInstance;
  /** DB handle when no app is given (a dedicated pool of 4 is opened otherwise). */
  db?: DB;
  /** Parallel jobs on the critical queue (default WORKER_CRITICAL_CONCURRENCY). */
  concurrency?: number;
  /** Parallel jobs on the heavy queue (default WORKER_HEAVY_CONCURRENCY). */
  heavyConcurrency?: number;
  /** Upsert the repeatable schedules (default true). */
  schedules?: boolean;
  /** Enqueue the once-per-deploy boot jobs (default true). */
  boot?: boolean;
  /** Redis URL of the queue (default REDIS_URL). */
  redisUrl?: string;
  /** Port of the C8 health listener (0 = any free port); default none (the standalone worker passes WORKER_HEALTH_PORT). */
  healthPort?: number;
  /** Heartbeat interval (default WORKER_HEARTBEAT_MS; tests shorten it). */
  heartbeatMs?: number;
  /** Grace an interrupted handler gets before its attempt is given up (default JOB_ABORT_GRACE_MS). */
  abortGraceMs?: number;
}

/** Signals that stop the jobs of one queue: `interrupt` aborts every running attempt with JobInterruptedError. */
interface QueueControl {
  interrupt: AbortController;
  running: number;
}

/**
 * Processes one BullMQ job: one runJob attempt. An unknown job name fails without retries; an attempt interrupted by a shutdown goes back
 * to its queue without using an attempt (it resumes from its checkpoint under the same job_runs row).
 */
export function processJob(
  db: DB,
  app: FastifyInstance | null,
  control?: QueueControl,
  opts: { abortGraceMs?: number } = {},
) {
  return async (job: Job, token?: string): Promise<Record<string, unknown>> => {
    const data = (job.data ?? {}) as Record<string, unknown>;
    const attempt = job.attemptsMade + 1;
    const jobKey = `${job.queueName}:${job.id ?? job.name}`;
    // the first attempt uses the run id handed out at enqueue time; later attempts a stable id per (job, attempt), so an interrupted
    // attempt that resumes keeps its row and checkpoint
    const runId = attempt === 1 && isUuid(data["__run_id"]) ? data["__run_id"] : attemptRunId(jobKey, attempt);
    if (control) control.running += 1;
    try {
      const outcome = await runJob(db, job.name, data, {
        app,
        attempt,
        maxAttempts: job.opts.attempts ?? 1,
        runId,
        jobKey,
        ...(control ? { signal: control.interrupt.signal } : {}),
        ...(opts.abortGraceMs !== undefined ? { abortGraceMs: opts.abortGraceMs } : {}),
      });
      return { run_id: outcome.runId, ...outcome.result };
    } catch (err) {
      if (err instanceof UnregisteredJobError) throw new UnrecoverableError(err.message);
      if (err instanceof JobInterruptedError && token) {
        // back to the queue without consuming an attempt; the next worker resumes from the saved checkpoint
        await job.moveToWait(token);
        throw new WaitingError(err.message);
      }
      throw err;
    } finally {
      if (control) control.running -= 1;
    }
  };
}

/** Starts the consumers of both job queues, upserts the schedules, enqueues the boot jobs and starts the heartbeat. */
export async function startWorker(target?: DB | FastifyInstance | StartWorkerOptions): Promise<RunningWorker> {
  const opts: StartWorkerOptions = !target
    ? {}
    : isApp(target)
      ? { app: target }
      : isOptions(target)
        ? target
        : { db: target };
  const app = opts.app ?? jobApp();
  const handle: DbHandle | null = opts.app || opts.db ? null : createDb(config.DATABASE_URL, { max: 4 });
  const db = opts.app?.db ?? opts.db ?? handle!.db;
  const connection = bullConnection(opts.redisUrl);
  const queue = createQueue(opts.redisUrl);
  const heavyQueue = queueFor(queue, "BACKUP_EXPORT");
  const registered = new Set(registeredJobs());
  const schedules =
    opts.schedules === false
      ? { scheduled: [], unregistered: [], disabled: [] }
      : await registerSchedules(queue, registered);
  const controls: Record<QueueKind, QueueControl> = {
    critical: { interrupt: new AbortController(), running: 0 },
    heavy: { interrupt: new AbortController(), running: 0 },
  };
  const grace = opts.abortGraceMs !== undefined ? { abortGraceMs: opts.abortGraceMs } : {};
  const worker = new Worker(QUEUE_NAME, processJob(db, app, controls.critical, grace), {
    connection,
    concurrency: opts.concurrency ?? config.WORKER_CRITICAL_CONCURRENCY,
    ...WORKER_SETTINGS.critical,
  });
  const heavyWorker = new Worker(HEAVY_QUEUE_NAME, processJob(db, app, controls.heavy, grace), {
    connection,
    concurrency: opts.heavyConcurrency ?? config.WORKER_HEAVY_CONCURRENCY,
    ...WORKER_SETTINGS.heavy,
  });
  for (const w of [worker, heavyWorker]) {
    w.on("failed", (job, err) => {
      if (err instanceof WaitingError || err?.name === "WaitingError") return;
      logger.error(
        { queue: w.name, job: job?.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message },
        "job attempt failed",
      );
    });
    w.on("error", (err) => logger.error({ err, queue: w.name }, "worker error"));
  }
  let boot: BootJobsResult | null = null;
  if (opts.boot !== false) {
    const lockRedis = (app as unknown as { redisSecurity?: Redis } | null)?.redisSecurity ?? app?.redis ?? null;
    if (lockRedis) boot = await enqueueBootJobs(queue, { db, lockRedis, registered });
    else logger.warn("no Redis client for the boot lock; boot jobs not enqueued");
  }

  // --- heartbeat (contract C8) ---
  const redis = (await queue.client) as unknown as Redis;
  const host = hostname();
  let lastBeat: Date | null = null;
  const beat = async (): Promise<void> => {
    const now = new Date();
    const record: WorkerHeartbeat = {
      at: now.toISOString(),
      host,
      pid: process.pid,
      queues: [QUEUE_NAME, HEAVY_QUEUE_NAME],
      version: config.APP_VERSION,
    };
    try {
      await redis
        .multi()
        .set(WORKER_HEARTBEAT_KEY, JSON.stringify(record), "EX", 24 * 3600)
        .set(`${WORKER_HEARTBEAT_PREFIX}${host}:${process.pid}`, JSON.stringify(record), "EX", 60)
        .exec();
      lastBeat = now;
      workerHeartbeat.set(now.getTime() / 1000);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "worker heartbeat failed");
    }
  };
  await beat();
  const beatTimer = setInterval(() => void beat(), opts.heartbeatMs ?? WORKER_HEARTBEAT_MS);
  beatTimer.unref();
  const heartbeatMs = opts.heartbeatMs ?? WORKER_HEARTBEAT_MS;

  let draining = false;
  let drained: Promise<{ forced: boolean; interrupted: number }> | null = null;
  let closed: Promise<void> | null = null;

  async function healthReport(): Promise<{ status: 200 | 503; body: WorkerHealthResponse }> {
    const redisOk = await withTimeout(redis.ping(), 1_000)
      .then(() => true)
      .catch(() => false);
    const queues: WorkerHealthResponse["queues"] = {};
    for (const [kind, q, w] of [
      ["critical", queue, worker],
      ["heavy", heavyQueue, heavyWorker],
    ] as const) {
      const counts = redisOk
        ? await withTimeout(q.getJobCounts("waiting", "delayed", "active"), 1_000).catch(() => null)
        : null;
      queues[kind] = {
        waiting: counts ? (counts["waiting"] ?? 0) : null,
        delayed: counts ? (counts["delayed"] ?? 0) : null,
        active: counts ? (counts["active"] ?? 0) : null,
        consuming: !draining && w.isRunning(),
      };
    }
    const fresh = lastBeat !== null && Date.now() - lastBeat.getTime() < 3 * heartbeatMs;
    const ok = redisOk && fresh && Object.values(queues).every((q) => q.consuming);
    return {
      status: ok ? 200 : 503,
      body: {
        status: ok ? "ok" : "down",
        redis: redisOk,
        queues,
        last_heartbeat_at: lastBeat ? lastBeat.toISOString() : null,
      },
    };
  }

  const health = opts.healthPort !== undefined ? await startHealthServer(opts.healthPort, healthReport) : null;

  async function drain(timeoutMs = config.WORKER_DRAIN_TIMEOUT_MS): Promise<{ forced: boolean; interrupted: number }> {
    drained ??= (async () => {
      draining = true;
      const interrupted = controls.heavy.running;
      logger.info(
        { critical_running: controls.critical.running, heavy_running: interrupted, drain_timeout_ms: timeoutMs },
        "worker draining: no new jobs; heavy jobs checkpoint and return to their queue",
      );
      // heavy jobs stop at their next batch boundary (checkpoint saved) and go back to the queue
      controls.heavy.interrupt.abort(new JobInterruptedError("worker shutdown"));
      // close() stops fetching at once and resolves when the active jobs of the queue settled
      const closing = Promise.all([worker.close(), heavyWorker.close()]);
      if (await settles(closing, timeoutMs)) return { forced: false, interrupted };
      // critical jobs still running after the drain window: ask them to stop too (they are idempotent, lock-protected and re-run)
      logger.warn(
        { critical_running: controls.critical.running },
        "drain timeout: interrupting the remaining critical jobs",
      );
      controls.critical.interrupt.abort(new JobInterruptedError("drain timeout"));
      if (await settles(closing, Math.min(opts.abortGraceMs ?? JOB_ABORT_GRACE_MS, 30_000) + 1_000))
        return { forced: false, interrupted: interrupted + 1 };
      logger.error("jobs did not stop; force-closing (BullMQ stall recovery re-runs them elsewhere)");
      await Promise.all([worker.close(true), heavyWorker.close(true)]).catch(() => undefined);
      return { forced: true, interrupted };
    })();
    return drained;
  }

  logger.info(
    {
      queues: { [QUEUE_NAME]: worker.opts.concurrency, [HEAVY_QUEUE_NAME]: heavyWorker.opts.concurrency },
      registered: [...registered],
      scheduled: schedules.scheduled,
      unregistered: schedules.unregistered,
      health_port: health ? (health.address() as { port: number } | null)?.port : null,
    },
    "worker started",
  );
  return {
    queue,
    heavyQueue,
    worker,
    heavyWorker,
    schedules,
    boot,
    health,
    lastHeartbeatAt: () => lastBeat,
    healthReport,
    drain,
    close: (timeoutMs?: number) =>
      (closed ??= (async () => {
        await drain(timeoutMs).catch((err: unknown) => logger.error({ err }, "worker drain failed"));
        clearInterval(beatTimer);
        await redis.del(`${WORKER_HEARTBEAT_PREFIX}${host}:${process.pid}`).catch(() => undefined);
        if (health) await new Promise<void>((r) => health.close(() => r()));
        await queue.close().catch(() => undefined);
        if (handle) await handle.close().catch(() => undefined);
      })()),
  };
}

/** True when `p` settled within `ms`. */
async function settles(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The worker's C8 listener: `GET /health` → 200/503 with the report; `GET /metrics` → this process's Prometheus registry (job counters,
 * kkt_worker_heartbeat_timestamp_seconds, process errors; METRICS_TOKEN bearer when set). Bind it to the private network only.
 */
export async function startHealthServer(
  port: number,
  report: () => Promise<{ status: 200 | 503; body: WorkerHealthResponse }>,
): Promise<Server | null> {
  const { isMetricsToken } = await import("./plugins/telemetry.js");
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "text/plain" }).end("method not allowed\n");
      return;
    }
    if (path === "/health" || path === "/") {
      report()
        .then((r) =>
          res
            .writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" })
            .end(JSON.stringify(r.body)),
        )
        .catch((err: unknown) =>
          res
            .writeHead(503, { "content-type": "application/json" })
            .end(JSON.stringify({ status: "down", error: (err as Error).message })),
        );
      return;
    }
    if (path === "/metrics") {
      if (config.METRICS_TOKEN && !isMetricsToken(req.headers.authorization, config.METRICS_TOKEN)) {
        res.writeHead(401, { "content-type": "text/plain", "www-authenticate": 'Bearer realm="metrics"' }).end();
        return;
      }
      localMetrics()
        .then((body) =>
          res.writeHead(200, { "content-type": METRICS_CONTENT_TYPE, "cache-control": "no-store" }).end(body),
        )
        .catch(() => res.writeHead(500).end());
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
  });
  return new Promise((resolve) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      logger.warn({ err: err.message, port }, "worker health listener not started");
      resolve(null);
    });
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

function isApp(x: unknown): x is FastifyInstance {
  return typeof x === "object" && x !== null && typeof (x as { inject?: unknown }).inject === "function";
}

function isOptions(x: unknown): x is StartWorkerOptions {
  return (
    typeof x === "object" &&
    x !== null &&
    !("select" in x) &&
    ("app" in x ||
      "db" in x ||
      "boot" in x ||
      "schedules" in x ||
      "concurrency" in x ||
      "redisUrl" in x ||
      "healthPort" in x ||
      "heavyConcurrency" in x)
  );
}

/** Kind of the queue a job name runs on (re-exported for callers that only import the worker). */
export { queueKindOf };

/**
 * Standalone entry point: build the full app (no listen), start the consumers and the health listener; on SIGTERM/SIGINT drain (critical
 * jobs up to WORKER_DRAIN_TIMEOUT_MS, heavy jobs checkpoint and requeue) and exit 0 — or 1 when jobs had to be force-closed or the stop
 * came from an uncaught exception.
 */
async function main(): Promise<void> {
  const { buildApp } = await import("./app.js");
  // jobs write exports, backups and portal files: fail fast (like the API) when the object store is unusable
  const { createStorage } = await import("./lib/storage.js");
  await createStorage().check();
  const app = await buildApp({ logger: true });
  await app.ready();
  const running = await startWorker({ app, healthPort: config.WORKER_HEALTH_PORT });
  let stopping = false;
  const stop = async (signal: string, code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    // last resort: the drain window plus time for the abort grace and the pools
    const hard = setTimeout(() => process.exit(1), config.WORKER_DRAIN_TIMEOUT_MS + JOB_ABORT_GRACE_MS + 30_000);
    hard.unref();
    let exitCode = code;
    try {
      const { forced } = await running.drain();
      if (forced) exitCode = 1;
      await running.close();
      await app.close();
    } catch (err) {
      logger.error({ err }, "worker shutdown error");
      exitCode = 1;
    } finally {
      clearTimeout(hard);
      const { shutdownTelemetry } = await import("./modules/system/shutdown.js");
      await shutdownTelemetry();
      process.exit(exitCode);
    }
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  installProcessErrorHandlers({
    role: "worker",
    log: logger,
    shutdown: (reason) => stop(reason, 1),
    deadlineMs: config.WORKER_DRAIN_TIMEOUT_MS + JOB_ABORT_GRACE_MS + 30_000,
  });
}

const isMain = /worker\.(ts|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, "worker failed to start");
    process.exit(1);
  });
}
