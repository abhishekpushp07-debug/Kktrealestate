// Applies the committed drizzle-kit migrations, then the hand-written SQL files in src/sql (triggers, functions, privileges), then the
// online files in src/sql/online (CREATE INDEX CONCURRENTLY, VALIDATE CONSTRAINT …, one statement at a time outside any transaction).
// Every step is idempotent, and unchanged hand-written files are not re-applied (checksums in drizzle.kkt_schema_files), so a deploy
// with nothing new takes no table locks. Rules for writing migrations: docs/DATA-MODEL.md "Writing migrations".
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
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
export const MIGRATIONS_FOLDER =
  process.env["KKT_MIGRATIONS_DIR"] ??
  firstExisting([
    join(here, "..", "drizzle"),
    join(here, "drizzle"),
    join(here, "..", "..", "..", "packages", "db", "drizzle"),
    join(process.cwd(), "packages", "db", "drizzle"),
  ]);

/** Folder holding the hand-written SQL applied after drizzle's migrations (override with KKT_SQL_DIR). Online files live in `online/`. */
export const SQL_FOLDER =
  process.env["KKT_SQL_DIR"] ??
  firstExisting([
    join(here, "sql"),
    join(here, "..", "sql"),
    join(here, "..", "..", "..", "packages", "db", "src", "sql"),
    join(process.cwd(), "packages", "db", "src", "sql"),
  ]);

/** Lists the hand-written SQL files in apply order (lexicographic: 0001_…, 0002_…). */
export async function listSqlFiles(folder: string = SQL_FOLDER): Promise<string[]> {
  if (!existsSync(folder)) return [];
  const names = await readdir(folder);
  return names
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => join(folder, n));
}

/** Lists the online SQL files (`<SQL_FOLDER>/online/*.sql`) in apply order. */
export async function listOnlineSqlFiles(folder: string = SQL_FOLDER): Promise<string[]> {
  return listSqlFiles(join(folder, "online"));
}

/** Advisory-lock key serialising migrations across processes (API replicas, the worker, CLI runs). */
export const MIGRATION_LOCK_KEY = "kkt:migrate";

/** Where the applied hand-written files are recorded (schema `drizzle`, next to drizzle's own journal; reset drops both). */
export const SCHEMA_FILES_TABLE = "drizzle.kkt_schema_files";

/** sha256 (hex) of a file's text. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Splits a SQL script into statements at top-level semicolons, keeping quoted strings, quoted identifiers, dollar-quoted bodies
 * (DO blocks, functions) and comments intact. Statements that are only comments/whitespace are dropped.
 */
export function splitSqlStatements(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === c) {
          if (text[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      i = j + 1;
    } else if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
      } else i += 1;
    } else if (c === ";") {
      out.push(text.slice(start, i));
      i += 1;
      start = i;
    } else i += 1;
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => stripComments(s).trim() !== "");
}

/** The statement without leading `--` / `/* … *\/` comments (for classification only). */
function stripComments(statement: string): string {
  let s = statement.trimStart();
  for (;;) {
    if (s.startsWith("--")) {
      const end = s.indexOf("\n");
      s = end === -1 ? "" : s.slice(end + 1).trimStart();
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2).trimStart();
    } else return s;
  }
}

const CONCURRENT_INDEX =
  /^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)([A-Za-z_][\w$]*)\2\s+ON\s+(?:ONLY\s+)?(?:"?public"?\.)?("?)([A-Za-z_][\w$]*)\4/i;

/** A parsed `CREATE [UNIQUE] INDEX CONCURRENTLY … name ON table` statement. */
export interface ConcurrentIndexStatement {
  unique: boolean;
  index: string;
  table: string;
}

/** Recognises a CREATE INDEX CONCURRENTLY statement (null for anything else). */
export function parseConcurrentIndex(statement: string): ConcurrentIndexStatement | null {
  const m = CONCURRENT_INDEX.exec(stripComments(statement));
  if (!m) return null;
  return { unique: Boolean(m[1]), index: m[3]!, table: m[5]! };
}

/** What happened to one online statement (returned by {@link applyOnlineSql} for logs and tests). */
export interface OnlineStatementResult {
  statement: string;
  action: "applied" | "applied-without-concurrently" | "skipped-unique-on-partitioned";
  droppedInvalidIndex?: string;
}

/**
 * Runs an online SQL script: each statement on its own, in autocommit (never inside a transaction block), so
 * `CREATE INDEX CONCURRENTLY` and `ALTER TABLE … VALIDATE CONSTRAINT` do not block writes. Before a `CREATE INDEX CONCURRENTLY` an
 * INVALID index of the same name — the leftover of a build that was interrupted (crash, deploy timeout, lock cancel) — is dropped
 * (`DROP INDEX CONCURRENTLY`), since `IF NOT EXISTS` would otherwise keep the broken index forever. PostgreSQL cannot build an index
 * concurrently on a partitioned table: there the statement runs without CONCURRENTLY, and a UNIQUE one is skipped (a unique index on a
 * partitioned table must contain the partition key; packages/db/partitions enforces such uniqueness with a trigger).
 */
export async function applyOnlineSql(sql: Sql, text: string): Promise<OnlineStatementResult[]> {
  const results: OnlineStatementResult[] = [];
  for (const statement of splitSqlStatements(text)) {
    const idx = parseConcurrentIndex(statement);
    if (!idx) {
      await sql.unsafe(statement);
      results.push({ statement, action: "applied" });
      continue;
    }
    const result: OnlineStatementResult = { statement, action: "applied" };
    const invalid = await sql<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ${idx.index} AND c.relnamespace = 'public'::regnamespace AND NOT i.indisvalid`;
    if (invalid.length > 0) {
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS public."${idx.index.replace(/"/g, '""')}"`);
      result.droppedInvalidIndex = idx.index;
    }
    const [target] = await sql<{ kind: string }[]>`
      SELECT c.relkind::text AS kind FROM pg_class c WHERE c.relname = ${idx.table} AND c.relnamespace = 'public'::regnamespace`;
    if (target?.kind === "p") {
      if (idx.unique) {
        result.action = "skipped-unique-on-partitioned";
      } else {
        await sql.unsafe(statement.replace(/\bCONCURRENTLY\s+/i, ""));
        result.action = "applied-without-concurrently";
      }
    } else {
      await sql.unsafe(statement);
    }
    results.push(result);
  }
  return results;
}

/** Options of {@link migrateHandle}. */
export interface MigrateOptions {
  /** Re-apply every hand-written file even when its checksum is unchanged (env KKT_MIGRATE_REAPPLY_SQL=true). */
  reapplyAll?: boolean;
  /** Called with a line per applied/skipped file (default: silent). */
  log?: (line: string) => void;
}

/** What one migration run did with the hand-written files. */
export interface MigrateReport {
  applied: string[];
  skipped: string[];
  online: Record<string, OnlineStatementResult[]>;
}

async function ensureSchemaFilesTable(sql: Sql): Promise<void> {
  await sql.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${SCHEMA_FILES_TABLE} (
    file text PRIMARY KEY,
    sha256 text NOT NULL,
    schema_marker text,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

/** Identifies the schema the hand-written files were applied to: the newest drizzle migration (its hash and timestamp). */
async function schemaMarker(sql: Sql): Promise<string> {
  const rows = await sql<{ marker: string | null }[]>`
    SELECT (SELECT hash || ':' || created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1) AS marker`;
  return rows[0]?.marker ?? "none";
}

/**
 * Runs the full migration (extensions, drizzle journal, src/sql/*.sql, src/sql/online/*.sql) on an already-open handle while holding the
 * session-level advisory lock {@link MIGRATION_LOCK_KEY}: concurrent replicas queue behind the first, then find nothing left to apply.
 *
 * A hand-written file in src/sql is (re-)applied when its sha256 differs from the one recorded in `drizzle.kkt_schema_files`, or when a
 * new drizzle migration was applied since (those files may need to cover new tables — e.g. the updated_at triggers); an online file only
 * when its sha256 changed. The record is written after the file succeeded, so an interrupted file runs again on the next deploy. The
 * handle needs a pool of at least 2 connections and should be opened with `timeouts: false` (index builds can be slow).
 */
export async function migrateHandle(handle: DbHandle, options: MigrateOptions = {}): Promise<MigrateReport> {
  const reapplyAll = options.reapplyAll ?? (process.env["KKT_MIGRATE_REAPPLY_SQL"] ?? "").toLowerCase() === "true";
  const log = options.log ?? (() => undefined);
  const report: MigrateReport = { applied: [], skipped: [], online: {} };
  await withSessionAdvisoryLock(handle, MIGRATION_LOCK_KEY, async () => {
    const sql = handle.sql;
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS citext");
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await drizzleMigrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    await ensureSchemaFilesTable(sql);
    const marker = await schemaMarker(sql);
    const recorded = new Map(
      (
        await sql<
          { file: string; sha256: string; schema_marker: string | null }[]
        >`SELECT file, sha256, schema_marker FROM drizzle.kkt_schema_files`
      ).map((r) => [r.file, r]),
    );
    const record = async (file: string, sum: string, fileMarker: string | null) => {
      await sql`
        INSERT INTO drizzle.kkt_schema_files (file, sha256, schema_marker, applied_at) VALUES (${file}, ${sum}, ${fileMarker}, now())
        ON CONFLICT (file) DO UPDATE SET sha256 = EXCLUDED.sha256, schema_marker = EXCLUDED.schema_marker, applied_at = now()`;
    };

    for (const path of await listSqlFiles()) {
      const file = path.slice(SQL_FOLDER.length + 1);
      const text = await readFile(path, "utf8");
      const sum = sha256(text);
      const prev = recorded.get(file);
      if (!reapplyAll && prev && prev.sha256 === sum && prev.schema_marker === marker) {
        report.skipped.push(file);
        log(`[db] ${file}: unchanged, skipped`);
        continue;
      }
      await sql.unsafe(text);
      await record(file, sum, marker);
      report.applied.push(file);
      log(`[db] ${file}: applied`);
    }

    for (const path of await listOnlineSqlFiles()) {
      const file = path.slice(SQL_FOLDER.length + 1);
      const text = await readFile(path, "utf8");
      const sum = sha256(text);
      const prev = recorded.get(file);
      if (!reapplyAll && prev && prev.sha256 === sum) {
        report.skipped.push(file);
        log(`[db] ${file}: unchanged, skipped`);
        continue;
      }
      report.online[file] = await applyOnlineSql(sql, text);
      await record(file, sum, null);
      report.applied.push(file);
      log(`[db] ${file}: applied online (${report.online[file].length} statements)`);
    }
  });
  return report;
}

/** Opens a connection to `url`, migrates it to the latest version and closes the connection. */
export async function runMigrations(
  url: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL,
  options: MigrateOptions = {},
): Promise<MigrateReport> {
  const handle = createDb(url, { max: 2, timeouts: false });
  try {
    return await migrateHandle(handle, options);
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL;
  runMigrations(url, { log: (line) => console.log(line) })
    .then(() => {
      console.log(`[db] migrated ${url.replace(/\/\/.*@/, "//***@")}`);
    })
    .catch((err: unknown) => {
      console.error("[db] migration failed", err);
      process.exitCode = 1;
    });
}
