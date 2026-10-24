// Applies the committed drizzle-kit migrations, then the hand-written SQL files in src/sql
// (triggers, functions). Every step is idempotent, so this is safe to run at every deploy.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, DEFAULT_DATABASE_URL, type DbHandle } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Folder holding drizzle-kit's generated migrations and journal. */
export const MIGRATIONS_FOLDER = join(here, "..", "drizzle");

/** Folder holding the hand-written SQL applied after drizzle's migrations. */
export const SQL_FOLDER = join(here, "sql");

/** Lists the hand-written SQL files in apply order (lexicographic: 0001_…, 0002_…). */
export async function listSqlFiles(folder: string = SQL_FOLDER): Promise<string[]> {
  const names = await readdir(folder);
  return names
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => join(folder, n));
}

/** Runs the full migration (drizzle journal, then src/sql/*.sql) on an already-open handle. */
export async function migrateHandle(handle: DbHandle): Promise<void> {
  await handle.sql.unsafe("CREATE EXTENSION IF NOT EXISTS citext");
  await drizzleMigrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  for (const file of await listSqlFiles()) {
    const text = await readFile(file, "utf8");
    await handle.sql.unsafe(text);
  }
}

/** Opens a connection to `url`, migrates it to the latest version and closes the connection. */
export async function runMigrations(url: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL): Promise<void> {
  const handle = createDb(url, { max: 1 });
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
