import { createDb } from "@kkt/db";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { ensureBootstrap } from "./bootstrap.js";

/** `pnpm --filter @kkt/api seed`: bootstrap company/roles/users now; the full demo seed is added by a later module. */
async function main(): Promise<void> {
  const handle = createDb(config.DATABASE_URL, { max: 2 });
  try {
    const result = await ensureBootstrap(handle.db);
    logger.info({ companyId: result.companyId, created: result.created }, "bootstrap seed ensured");
    logger.warn("full demo seed not yet implemented");
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "seed failed");
  process.exit(1);
});
