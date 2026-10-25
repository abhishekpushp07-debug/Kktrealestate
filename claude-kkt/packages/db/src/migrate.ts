// Applies the committed drizzle-kit migrations, then the hand-written SQL files in src/sql
// (triggers, functions). Every step is idempotent, so this is safe to run at every deploy.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, DEFAULT_DATABASE_URL, withSessionAdvisoryLock, type DbHandle } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * First existing folder among `candidates` (the first one when none exists, so the error names a sensible path).
 * The package runs from three layouts: the source tree (`packages/db/src`), the API bundle (`apps/api/dist`, where tsup copies
 * `drizzle/` and `sql/` next to the entry) and the Docker image (`/app/dist` with `/app/drizzle` + `/app/sql`).
 */
function firstExisting(candidates: readonly string[]): string {
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

/** Folder holding drizzle-kit's generated migrations and journal (override with KKT_MIGRATIONS_DIR). */
export const MIGRATIONS_FOLDER = process.env["KKT_MIGRATIONS_DIR"] ?? firstExisting([
  join(here, "..", "drizzle"),
  join(here, "drizzle"),
  join(here, "..", "..", "..", "packages", "db", "drizzle"),
  join(process.cwd(), "packages", "db", "drizzle"),
]);

/** Folder holding the hand-written SQL applied after drizzle's migrations (override with KKT_SQL_DIR). */
export const SQL_FOLDER = process.env["KKT_SQL_DIR"] ?? firstExisting([
  join(here, "sql"),
  join(here, "..", "sql"),
  join(here, "..", "..", "..", "packages", "db", "src", "sql"),
  join(process.cwd(), "packages", "db", "src", "sql"),
]);

/** Lists the hand-written SQL files in apply order (lexicographic: 0001_…, 0002_…). */
export async function listSqlFiles(folder: string = SQL_FOLDER): Promise<string[]> {
  const names = await readdir(folder);
  return names
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => join(folder, n));
}

/** Advisory-lock key serialising migrations across processes (API replicas, the worker, CLI runs). */
export const MIGRATION_LOCK_KEY = "kkt:migrate";

/**
 * Runs the full migration (extensions, drizzle journal, then src/sql/*.sql) on an already-open handle while holding the session-level
 * advisory lock {@link MIGRATION_LOCK_KEY}: concurrent replicas queue behind the first, then find nothing left to apply. Every step is
 * idempotent. The handle needs a pool of at least 2 connections and should be opened with `timeouts: false` (index builds can be slow).
 */
export async function migrateHandle(handle: DbHandle): Promise<void> {
  await withSessionAdvisoryLock(handle, MIGRATION_LOCK_KEY, async () => {
    await handle.sql.unsafe("CREATE EXTENSION IF NOT EXISTS citext");
    await handle.sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await drizzleMigrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    for (const file of await listSqlFiles()) {
      const text = await readFile(file, "utf8");
      await handle.sql.unsafe(text);
    }
  });
}

/** Opens a connection to `url`, migrates it to the latest version and closes the connection. */
export async function runMigrations(url: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL): Promise<void> {
  const handle = createDb(url, { max: 2, timeouts: false });
  try {
    await migrateHandle(handle);
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL;
  runMigrations(url)
    .then(() => {
      console.log(`[db] migrated ${url.replace(/\/\/.*@/, "//***@")}`);
    })
    .catch((err: unknown) => {
      console.error("[db] migration failed", err);
      process.exitCode = 1;
    });
}
