import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { runMigrations } from "@kkt/db";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { ensureBootstrap } from "./seed/bootstrap.js";
import { seedDemo } from "./seed/run.js";
import { startWorker, type RunningWorker } from "./worker.js";

/** Number of HTTP worker processes this boot runs (API_WORKERS; `auto` = available CPUs). */
function workerCount(): number {
  return config.API_WORKERS === 0 ? Math.max(1, availableParallelism()) : config.API_WORKERS;
}

/** Migrations when RUN_MIGRATIONS_ON_BOOT is set. */
async function migrate(): Promise<void> {
  if (!config.RUN_MIGRATIONS_ON_BOOT) return;
  await runMigrations(config.DATABASE_URL);
  logger.info("migrations applied");
}

/** Bootstrap company/roles/users and the demo data (docs/SEED.md) the first time the database has no projects; a no-op afterwards. */
async function seed(app: Awaited<ReturnType<typeof buildApp>>): Promise<void> {
  const result = await ensureBootstrap(app.db);
  if (result.created) logger.info({ companyId: result.companyId }, "bootstrap seed created");
  await app.ready();
  const seeded = await seedDemo(app);
  if (!seeded.skipped) logger.info({ counts: seeded.counts, durationMs: seeded.durationMs }, "demo seed created");
}

/** One HTTP process: builds the app, seeds when asked, listens, optionally runs the in-process job worker, and shuts down gracefully. */
async function serve(opts: { runJobs: boolean; seed: boolean }): Promise<void> {
  const app = await buildApp({ logger: true });
  if (opts.seed) await seed(app);
  let worker: RunningWorker | null = null;
  if (opts.runJobs) worker = await startWorker(app.db);
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  logger.info({ port: config.API_PORT, pid: process.pid, docs: `${config.API_PUBLIC_URL}/api/v1/docs` }, "api listening");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, pid: process.pid }, "shutting down");
    const timer = setTimeout(() => { logger.error("forced exit after 15 s"); process.exit(1); }, 15_000);
    try {
      if (worker) await worker.close();
      await app.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown error");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/** Primary of a multi-process boot: prepares the database once, forks the workers, replaces crashed ones, forwards shutdown signals. */
async function supervise(count: number): Promise<void> {
  await migrate();
  if (config.SEED_ON_BOOT) {
    const app = await buildApp({ logger: true });
    try { await seed(app); } finally { await app.close(); }
  }
  let stopping = false;
  const fork = (index: number) => {
    const w = cluster.fork({ KKT_WORKER_INDEX: String(index) });
    w.on("exit", (code, signal) => {
      if (stopping) return;
      logger.error({ index, code, signal }, "api worker exited; restarting");
      setTimeout(() => fork(index), 1000);
    });
  };
  for (let i = 0; i < count; i++) fork(i);
  logger.info({ workers: count, port: config.API_PORT }, "api cluster started");
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "stopping api cluster");
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(signal);
    const timer = setTimeout(() => process.exit(1), 20_000);
    cluster.on("exit", () => {
      if (Object.keys(cluster.workers ?? {}).length === 0) { clearTimeout(timer); process.exit(0); }
    });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

/** Boots the API: single process by default; with API_WORKERS > 1 (or `auto`) a primary prepares the database and forks HTTP workers. */
async function main(): Promise<void> {
  const count = workerCount();
  if (count > 1 && cluster.isPrimary) return supervise(count);
  if (cluster.isWorker) {
    // forked by supervise(): the primary already migrated and seeded; only the first worker runs the in-process jobs
    return serve({ runJobs: config.RUN_JOBS_IN_API && process.env["KKT_WORKER_INDEX"] === "0", seed: false });
  }
  await migrate();
  return serve({ runJobs: config.RUN_JOBS_IN_API, seed: config.SEED_ON_BOOT });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "api failed to start");
  process.exit(1);
});
