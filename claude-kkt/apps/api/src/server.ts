// first: size the libuv thread pool before any module can use it (production also preloads it through telemetry.js)
import "./preload.js";
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { createDb, runMigrations } from "@kkt/db";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import {
  disableDependencyMetrics,
  enableDependencyMetrics,
  localMetrics,
  METRICS_CONTENT_TYPE,
  setupPrimaryAggregation,
  setupWorkerAggregation,
} from "./lib/metrics.js";
import { installProcessErrorHandlers } from "./lib/processErrors.js";
import { createStorage } from "./lib/storage.js";
import { effectiveConfig } from "./modules/system/bootConfig.js";
import { startMetricsServer } from "./modules/system/metricsServer.js";
import { gracefulShutdown, shutdownSettingsFromEnv, shutdownTelemetry } from "./modules/system/shutdown.js";
import { firstBoot } from "./seed/firstBoot.js";
import { seedDemo } from "./seed/run.js";
import { startWorker, type RunningWorker } from "./worker.js";

/**
 * API entry point.
 *
 *   node --import ./dist/telemetry.js dist/server.js            HTTP API (single process, or a node:cluster primary + workers)
 *   node dist/server.js migrate                                  one-shot: migrations + first boot (seed/firstBoot.ts), then exit
 *
 * Roles: with API_WORKERS > 1 (or `auto` on a multi-core box) the primary validates storage, migrates when enabled, runs the first boot
 * once, serves the cluster-wide metrics on METRICS_PORT and supervises the HTTP workers; a single process does all of that itself.
 * Production replicas run with RUN_MIGRATIONS_ON_BOOT=false and SEED_ON_BOOT=false — the migrate job/service owns schema changes
 * (docs/DEPLOY.md). Every one of them still bootstraps a database that has no company (BOOTSTRAP_* in production; the boot is refused
 * without them) — independent of SEED_ON_BOOT; the demo dataset needs SEED_ON_BOOT and SEED_DEMO.
 */

type App = Awaited<ReturnType<typeof buildApp>>;

/** Number of HTTP worker processes this boot runs (API_WORKERS; `auto` = available CPUs). */
function workerCount(): number {
  return config.API_WORKERS === 0 ? Math.max(1, availableParallelism()) : config.API_WORKERS;
}

/** Logs the effective configuration (never a secret). */
function logBoot(role: string, workers: number): void {
  logger.info({ config: effectiveConfig(config, { role, workers }) }, `kkt api ${role} starting`);
}

/** Fails fast when the object store is unusable (S3 bucket missing, credentials wrong, local directory not writable). */
async function validateStorage(): Promise<void> {
  await createStorage().check();
  logger.info({ driver: config.STORAGE_DRIVER }, "storage ok");
}

/** Migrations (always in `migrate` mode; otherwise only when RUN_MIGRATIONS_ON_BOOT). Advisory-locked in @kkt/db, so concurrent boots are safe. */
async function migrate(force = false): Promise<void> {
  if (!force && !config.RUN_MIGRATIONS_ON_BOOT) {
    logger.info("migrations skipped (RUN_MIGRATIONS_ON_BOOT=false; the migrate job owns them)");
    return;
  }
  await runMigrations(config.DATABASE_URL);
  logger.info("migrations applied");
}

/** Demo dataset seed on a built app (only reached when SEED_ON_BOOT and SEED_DEMO). */
async function demoSeed(app: App): Promise<Awaited<ReturnType<typeof seedDemo>>> {
  await app.ready();
  return seedDemo(app);
}

/** First boot on a built app (single process): bootstrap when the database has no company, the demo dataset when asked. */
async function prepare(app: App): Promise<void> {
  await firstBoot({ db: app.db, config, seedDemo: () => demoSeed(app) });
}

/**
 * First boot from the cluster primary / migrate job: a small dedicated pool answers "is there a company?" and runs the bootstrap; a full
 * app is built only for the demo dataset (it drives the real API in-process).
 */
async function prepareOnce(): Promise<void> {
  const handle = createDb(config.DATABASE_URL, { max: 2 });
  try {
    await firstBoot({
      db: handle.db,
      config,
      seedDemo: async () => {
        const app = await buildApp({ logger: true });
        try {
          return await demoSeed(app);
        } finally {
          await app.close();
        }
      },
    });
  } finally {
    await handle.close();
  }
}

/** One HTTP process: builds the app, seeds when asked, listens, optionally runs the in-process job worker, and shuts down gracefully. */
async function serve(opts: { index: number; runJobs: boolean; prepare: boolean; standalone: boolean }): Promise<void> {
  if (cluster.isWorker) setupWorkerAggregation();
  const app = await buildApp({ logger: true });
  if (opts.prepare) await prepare(app);
  let jobs: RunningWorker | null = null;
  if (opts.runJobs) jobs = await startWorker({ app });
  // Database/Redis-derived gauges (job failures, integrity findings, pool usage, queue depth) from exactly one process per host.
  if (opts.index === 0)
    enableDependencyMetrics({
      query: (text) => app.sql.unsafe(text) as unknown as Promise<Record<string, unknown>[]>,
      redis: app.redis,
    });
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  logger.info(
    { port: config.API_PORT, pid: process.pid, worker: opts.index, docs: `${config.API_PUBLIC_URL}/api/v1/docs` },
    "api listening",
  );
  const metricsServer = opts.standalone
    ? await startMetricsServer({
        port: config.METRICS_PORT,
        render: localMetrics,
        contentType: METRICS_CONTENT_TYPE,
        token: config.METRICS_TOKEN,
        log: logger,
      })
    : null;

  let stopping = false;
  const settings = shutdownSettingsFromEnv();
  const shutdown = (signal: string, fatal = false): Promise<void> => {
    if (stopping) return Promise.resolve();
    stopping = true;
    return gracefulShutdown(
      {
        app,
        // in-process jobs drain inside the HTTP shutdown deadline (the standalone worker has its own WORKER_DRAIN_TIMEOUT_MS)
        jobs: jobs ? { close: () => jobs!.close(Math.max(1_000, settings.timeoutMs - 5_000)) } : null,
        log: logger,
        settings,
        // after an uncaught exception the process exits non-zero even when the drain itself went well
        ...(fatal ? { exit: (code: number) => process.exit(code === 0 ? 1 : code) } : {}),
        inflight: () => app.inflightRequests?.() ?? 0,
        after: [
          () =>
            new Promise<void>((r) => {
              if (metricsServer) metricsServer.close(() => r());
              else r();
            }),
          () => disableDependencyMetrics(),
          () => shutdownTelemetry(),
        ],
      },
      signal,
    );
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // a cluster worker is told to stop by its primary (signal forwarded) or by a disconnect when the primary dies
  if (cluster.isWorker) cluster.worker?.on("disconnect", () => void shutdown("disconnect"));
  installProcessErrorHandlers({
    role: "api",
    log: logger,
    shutdown: (reason) => shutdown(reason, true),
    deadlineMs: settings.timeoutMs + 5_000,
  });
}

/** Primary of a multi-process boot: prepares the database once, serves aggregated metrics, forks the workers and replaces crashed ones. */
async function supervise(count: number): Promise<void> {
  logBoot("primary", count);
  await validateStorage();
  await migrate();
  await prepareOnce();
  const { clusterMetrics } = setupPrimaryAggregation();
  const metricsServer = await startMetricsServer({
    port: config.METRICS_PORT,
    render: clusterMetrics,
    contentType: METRICS_CONTENT_TYPE,
    token: config.METRICS_TOKEN,
    log: logger,
  });

  let stopping = false;
  const restarts = new Map<number, number[]>();
  const fork = (index: number) => {
    const w = cluster.fork({ KKT_WORKER_INDEX: String(index) });
    w.on("exit", (code, signal) => {
      if (stopping) return;
      // back off when a worker crash-loops (5 exits in a minute → 30 s pause) instead of hammering the database
      const now = Date.now();
      const recent = (restarts.get(index) ?? []).filter((t) => now - t < 60_000);
      recent.push(now);
      restarts.set(index, recent);
      const delay = recent.length >= 5 ? 30_000 : 1_000;
      logger.error(
        { index, code, signal, restarts_last_minute: recent.length, restart_in_ms: delay },
        "api worker exited; restarting",
      );
      setTimeout(() => {
        if (!stopping) fork(index);
      }, delay);
    });
  };
  for (let i = 0; i < count; i++) fork(i);
  logger.info({ workers: count, port: config.API_PORT, metrics_port: config.METRICS_PORT }, "api cluster started");

  const settings = shutdownSettingsFromEnv();
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "stopping api cluster (workers drain in-flight requests)");
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(signal);
    const finish = async (code: number) => {
      await new Promise<void>((r) => {
        if (metricsServer) metricsServer.close(() => r());
        else r();
      });
      await shutdownTelemetry();
      process.exit(code);
    };
    // workers have their own deadline; the primary waits a little longer, then gives up
    const timer = setTimeout(() => {
      logger.error("api workers did not stop in time; exiting");
      void finish(1);
    }, settings.timeoutMs + 5_000);
    const check = () => {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        clearTimeout(timer);
        void finish(0);
      }
    };
    cluster.on("exit", check);
    check();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  // the primary only supervises: an uncaught exception there stops the workers gracefully and exits non-zero
  installProcessErrorHandlers({
    role: "api",
    log: logger,
    shutdown: () =>
      new Promise<void>((resolve) => {
        stop("SIGTERM");
        cluster.on("exit", () => {
          if (Object.keys(cluster.workers ?? {}).length === 0) resolve();
        });
      }),
    deadlineMs: settings.timeoutMs + 10_000,
  });
}

/** `node dist/server.js migrate`: the one-shot migrate job (Compose service / Kubernetes Job). Runs as the database owner role. */
async function migrateJob(): Promise<void> {
  logBoot("migrate", 0);
  await migrate(true);
  await prepareOnce();
  logger.info("migrate job finished");
}

/** Boots the API: single process by default; with API_WORKERS > 1 (or `auto`) a primary prepares the database and forks HTTP workers. */
async function main(): Promise<void> {
  if (process.argv[2] === "migrate") {
    await migrateJob();
    process.exit(0);
  }
  const count = workerCount();
  if (count > 1 && cluster.isPrimary) return supervise(count);
  if (cluster.isWorker) {
    // forked by supervise(): the primary already validated storage, migrated and seeded; only the first worker runs the in-process jobs
    const index = Number(process.env["KKT_WORKER_INDEX"] ?? "0");
    return serve({ index, runJobs: config.RUN_JOBS_IN_API && index === 0, prepare: false, standalone: false });
  }
  logBoot("single", 1);
  await validateStorage();
  await migrate();
  return serve({ index: 0, runJobs: config.RUN_JOBS_IN_API, prepare: true, standalone: true });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "api failed to start");
  process.exit(1);
});
