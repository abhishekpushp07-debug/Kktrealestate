// Drops and recreates the public schema, then migrates. Destructive: requires CONFIRM_RESET=yes
// and refuses to run when NODE_ENV=production.
import { fileURLToPath } from "node:url";
import { createDb, DEFAULT_DATABASE_URL } from "./client.js";
import { migrateHandle } from "./migrate.js";

export interface ResetGuards {
  nodeEnv: string | undefined;
  confirm: string | undefined;
}

/** Returns the reason a reset must be refused, or null when the guards allow it. */
export function resetRefusalReason(guards: ResetGuards): string | null {
  if (guards.nodeEnv === "production") {
    return "refusing to reset the database when NODE_ENV=production";
  }
  if (guards.confirm !== "yes") {
    return "refusing to reset the database without CONFIRM_RESET=yes";
  }
  return null;
}

/** Drops schema `public` (CASCADE), recreates it and runs every migration; honours the guards. */
export async function resetDatabase(
  url: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL,
  guards: ResetGuards = { nodeEnv: process.env["NODE_ENV"], confirm: process.env["CONFIRM_RESET"] },
): Promise<void> {
  const refusal = resetRefusalReason(guards);
  if (refusal !== null) {
    throw new Error(refusal);
  }
  const handle = createDb(url, { max: 2, timeouts: false });
  try {
    await handle.sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await handle.sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await handle.sql.unsafe("CREATE SCHEMA public");
    await migrateHandle(handle);
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL;
  resetDatabase(url)
    .then(() => {
      console.log(`[db] reset + migrated ${url.replace(/\/\/.*@/, "//***@")}`);
    })
    .catch((err: unknown) => {
      console.error("[db] reset failed", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
