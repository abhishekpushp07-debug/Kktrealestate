import { runMigrations } from "@kkt/db";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { ensureBootstrap } from "./seed/bootstrap.js";
import { startWorker, type RunningWorker } from "./worker.js";

/** Boots the API: migrations (optional), bootstrap seed (optional), HTTP listen, in-process worker (optional), graceful shutdown. */
async function main(): Promise<void> {
  if (config.RUN_MIGRATIONS_ON_BOOT) {
    await runMigrations(config.DATABASE_URL);
    logger.info("migrations applied");
  }
  const app = await buildApp({ logger: true });
  if (config.SEED_ON_BOOT) {
    const result = await ensureBootstrap(app.db);
    if (result.created) logger.info({ companyId: result.companyId }, "bootstrap seed created");
  }
  let worker: RunningWorker | null = null;
  if (config.RUN_JOBS_IN_API) worker = await startWorker(app.db);
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  logger.info({ port: config.API_PORT, docs: `${config.API_PUBLIC_URL}/api/v1/docs` }, "api listening");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
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

main().catch((err: unknown) => {
  logger.fatal({ err }, "api failed to start");
  process.exit(1);
});
