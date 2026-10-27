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
  action: "applied" | "applied-per-partition" | "skipped-unique-on-partitioned";
  droppedInvalidIndex?: string;
  /** For "applied-per-partition": the partition indexes built concurrently and attached in this run. */
  partitionIndexes?: string[];
  /** How many times a statement was retried after a lock wait ran past the lock timeout. */
  lockRetries?: number;
}

/** Default `lock_timeout` (ms) of the migration's DDL: a statement that cannot get its table lock in time gives up and is retried. */
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 5_000;
/** Default number of retries after a lock timeout (with backoff 0.5 s, 1 s, 2 s … capped at 30 s: about 1.5 minutes in all). */
export const DEFAULT_MIGRATION_LOCK_RETRIES = 8;

/** The SQLSTATE carried by `err` (following Drizzle's `cause` wrappers), or null. */
function sqlState(err: unknown): string | null {
  let e: unknown = err;
  for (let depth = 0; depth < 8 && e !== null && typeof e === "object"; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** Retry settings of {@link withLockRetry}. */
export interface LockRetryOptions {
  /** Retries after a lock timeout (default {@link DEFAULT_MIGRATION_LOCK_RETRIES}). */
  lockRetries?: number;
  /** First backoff delay in ms, doubled on every retry and capped at 30 s (default 500). */
  lockRetryDelayMs?: number;
  log?: (line: string) => void;
}

/**
 * Runs `fn` (a migration step that is safe to run again: a single statement, or a script that ran as one transaction) and retries it
 * when it failed with 55P03 lock_not_available, i.e. its table lock was not granted within `lock_timeout`. Waiting without a timeout
 * would be worse than failing: an ALTER TABLE queued behind a long transaction blocks every later reader and writer of that table
 * until it gets its lock. Returns how many retries it took.
 */
export async function withLockRetry<T>(
  what: string,
  fn: () => Promise<T>,
  options: LockRetryOptions = {},
): Promise<{ value: T; retries: number }> {
  const retries = options.lockRetries ?? DEFAULT_MIGRATION_LOCK_RETRIES;
  const base = options.lockRetryDelayMs ?? 500;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { value: await fn(), retries: attempt };
    } catch (err) {
      if (sqlState(err) !== "55P03" || attempt >= retries) throw err;
      const delay = Math.min(30_000, base * 2 ** attempt);
      options.log?.(
        `[db] ${what}: table lock not granted within lock_timeout, retry ${attempt + 1}/${retries} in ${delay} ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Options of {@link applyOnlineSql}. */
export interface OnlineSqlOptions extends LockRetryOptions {
  /**
   * `lock_timeout` (ms) for the statements that take a blocking table lock (ALTER TABLE, DO blocks, the parent index of a partitioned
   * table, ATTACH), each retried on a timeout. Index builds CONCURRENTLY run without a lock timeout: their waits never block reads or
   * writes. Unset: the session's own setting applies to everything.
   */
  lockTimeoutMs?: number;
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Name of the index a partition gets for a partitioned parent index (≤ 63 bytes, stable across runs). */
export function partitionIndexName(parentIndex: string, partition: string): string {
  const name = `${partition}_${parentIndex}`;
  return Buffer.byteLength(name) <= 63 ? name : `${name.slice(0, 50)}_${sha256(name).slice(0, 12)}`;
}

/**
 * Runs an online SQL script: each statement on its own, in autocommit (never inside a transaction block), so
 * `CREATE INDEX CONCURRENTLY` and `ALTER TABLE … VALIDATE CONSTRAINT` do not block writes. Before a `CREATE INDEX CONCURRENTLY` an
 * INVALID index of the same name — the leftover of a build that was interrupted (crash, deploy timeout, lock cancel) — is dropped
 * (`DROP INDEX CONCURRENTLY`), since `IF NOT EXISTS` would otherwise keep the broken index forever. PostgreSQL cannot build an index
 * concurrently on a partitioned table, so there the runner does what the PostgreSQL manual prescribes for an online build: the parent
 * index is created `ON ONLY` the parent (no partition is scanned), each partition's index is built CONCURRENTLY and attached, and the
 * parent index becomes valid when the last one is attached. A UNIQUE one is skipped there (a unique index on a partitioned table must
 * contain the partition key; packages/db/partitions enforces such uniqueness with a trigger). All statements run on one connection
 * (reserved from the pool when `sql` is a pool).
 */
export async function applyOnlineSql(
  sql: Sql,
  text: string,
  options: OnlineSqlOptions = {},
): Promise<OnlineStatementResult[]> {
  const pooled = typeof (sql as { release?: unknown }).release !== "function";
  const conn: Sql = pooled ? ((await sql.reserve()) as unknown as Sql) : sql;
  const managed = options.lockTimeoutMs !== undefined;
  const setLockTimeout = async (ms: number) => {
    if (managed) await conn.unsafe(`SET lock_timeout = ${Math.max(0, Math.floor(ms))}`);
  };
  const blocking = async (what: string, statement: string): Promise<number> => {
    await setLockTimeout(options.lockTimeoutMs ?? 0);
    const { retries } = await withLockRetry(what, () => conn.unsafe(statement), options);
    return retries;
  };
  const dropInvalid = async (index: string): Promise<boolean> => {
    const invalid = await conn<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ${index} AND c.relnamespace = 'public'::regnamespace AND NOT i.indisvalid`;
    if (invalid.length === 0) return false;
    await setLockTimeout(0);
    await conn.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS public.${quoteIdent(index)}`);
    return true;
  };
  const results: OnlineStatementResult[] = [];
  try {
    for (const statement of splitSqlStatements(text)) {
      const idx = parseConcurrentIndex(statement);
      if (!idx) {
        const retries = await blocking("online statement", statement);
        results.push({ statement, action: "applied", ...(retries > 0 ? { lockRetries: retries } : {}) });
        continue;
      }
      const result: OnlineStatementResult = { statement, action: "applied" };
      const [target] = await conn<{ kind: string }[]>`
        SELECT c.relkind::text AS kind FROM pg_class c WHERE c.relname = ${idx.table} AND c.relnamespace = 'public'::regnamespace`;
      if (target?.kind === "p") {
        if (idx.unique) result.action = "skipped-unique-on-partitioned";
        else {
          result.partitionIndexes = await buildPartitionedIndex(
            conn,
            idx,
            statement,
            blocking,
            dropInvalid,
            setLockTimeout,
          );
          result.action = "applied-per-partition";
        }
        results.push(result);
        continue;
      }
      if (await dropInvalid(idx.index)) result.droppedInvalidIndex = idx.index;
      // a concurrent build waits for older transactions without blocking anyone: no lock timeout for it
      await setLockTimeout(0);
      await conn.unsafe(statement);
      results.push(result);
    }
  } finally {
    if (managed) await conn.unsafe("RESET lock_timeout").catch(() => undefined);
    if (pooled) (conn as unknown as { release: () => void }).release();
  }
  return results;
}

/**
 * Online index build on a partitioned table: `CREATE INDEX … ON ONLY parent` (catalog only, invalid until complete), then for every
 * partition without an attached index `CREATE INDEX CONCURRENTLY` + `ALTER INDEX parent ATTACH PARTITION`. Resumable: an interrupted
 * run leaves attached partitions attached and an INVALID partition index, which the next run drops and builds again. A parent index
 * that is already valid is left alone. Returns the partition indexes built in this run.
 */
async function buildPartitionedIndex(
  conn: Sql,
  idx: ConcurrentIndexStatement,
  statement: string,
  blocking: (what: string, statement: string) => Promise<number>,
  dropInvalid: (index: string) => Promise<boolean>,
  setLockTimeout: (ms: number) => Promise<void>,
): Promise<string[]> {
  const stripped = stripComments(statement);
  const head = CONCURRENT_INDEX.exec(stripped)!;
  const tail = stripped.slice(head[0].length);
  const [parent] = await conn<{ valid: boolean }[]>`
    SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ${idx.index} AND c.relnamespace = 'public'::regnamespace`;
  if (parent?.valid) return [];
  if (!parent)
    await blocking(
      `index ${idx.index}`,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(idx.index)} ON ONLY public.${quoteIdent(idx.table)}${tail}`,
    );
  const parts = await conn<{ part: string; kind: string; attached: string | null }[]>`
    SELECT c.relname AS part, c.relkind::text AS kind,
           (SELECT ci.relname FROM pg_inherits ii JOIN pg_index x ON x.indexrelid = ii.inhrelid JOIN pg_class ci ON ci.oid = ii.inhrelid
            WHERE ii.inhparent = to_regclass(${`public.${quoteIdent(idx.index)}`}) AND x.indrelid = c.oid LIMIT 1) AS attached
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = to_regclass(${`public.${quoteIdent(idx.table)}`})
    ORDER BY c.relname`;
  const built: string[] = [];
  for (const p of parts) {
    if (p.attached) continue;
    const child = partitionIndexName(idx.index, p.part);
    if (p.kind === "p") {
      // a sub-partitioned partition: same procedure one level down
      await buildPartitionedIndex(
        conn,
        { unique: false, index: child, table: p.part },
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdent(child)} ON public.${quoteIdent(p.part)}${tail}`,
        blocking,
        dropInvalid,
        setLockTimeout,
      );
    } else {
      await dropInvalid(child);
      await setLockTimeout(0);
      await conn.unsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdent(child)} ON public.${quoteIdent(p.part)}${tail}`,
      );
    }
    await blocking(
      `attach ${child}`,
      `ALTER INDEX public.${quoteIdent(idx.index)} ATTACH PARTITION public.${quoteIdent(child)}`,
    );
    built.push(child);
  }
  return built;
}

/** Options of {@link migrateHandle}. */
export interface MigrateOptions {
  /** Re-apply every hand-written file even when its checksum is unchanged (env KKT_MIGRATE_REAPPLY_SQL=true). */
  reapplyAll?: boolean;
  /** Called with a line per applied/skipped file (default: silent). */
  log?: (line: string) => void;
  /**
   * `lock_timeout` (ms) of the migration's blocking DDL (default {@link DEFAULT_MIGRATION_LOCK_TIMEOUT_MS}; 0 waits forever). A step
   * whose table lock is not granted in time is rolled back and retried ({@link withLockRetry}) instead of queueing behind a long
   * transaction while every later query on that table queues behind it. Index builds CONCURRENTLY never time out on locks.
   * {@link runMigrations} applies it to the drizzle journal too (as a connection parameter); {@link migrateHandle} applies it to the
   * hand-written and online files, and the journal step follows the handle's own setting.
   */
  lockTimeoutMs?: number;
  /** Retries after a lock timeout (default {@link DEFAULT_MIGRATION_LOCK_RETRIES}). */
  lockRetries?: number;
  /** First retry delay in ms (default 500, doubled per retry, capped at 30 s). */
  lockRetryDelayMs?: number;
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
 * handle needs a pool of at least 2 connections and no statement timeout (index builds can be slow); blocking DDL runs under
 * `lock_timeout` with retries (MigrateOptions.lockTimeoutMs).
 */
export async function migrateHandle(handle: DbHandle, options: MigrateOptions = {}): Promise<MigrateReport> {
  const reapplyAll = options.reapplyAll ?? (process.env["KKT_MIGRATE_REAPPLY_SQL"] ?? "").toLowerCase() === "true";
  const log = options.log ?? (() => undefined);
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MS;
  const retry: LockRetryOptions = {
    log,
    ...(options.lockRetries !== undefined ? { lockRetries: options.lockRetries } : {}),
    ...(options.lockRetryDelayMs !== undefined ? { lockRetryDelayMs: options.lockRetryDelayMs } : {}),
  };
  const report: MigrateReport = { applied: [], skipped: [], online: {} };
  await withSessionAdvisoryLock(handle, MIGRATION_LOCK_KEY, async () => {
    await handle.sql.unsafe("CREATE EXTENSION IF NOT EXISTS citext");
    await handle.sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    // the journal runs as one transaction: a lock timeout rolls all of it back, so running it again is safe
    await withLockRetry(
      "drizzle migrations",
      () => drizzleMigrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER }),
      retry,
    );
    // everything after the journal runs on one reserved connection with the migration's own session limits
    const sql = (await handle.sql.reserve()) as unknown as Sql;
    try {
      await sql.unsafe("SET statement_timeout = 0");
      await sql.unsafe(`SET lock_timeout = ${Math.max(0, Math.floor(lockTimeoutMs))}`);
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
        // a multi-statement script runs as one implicit transaction: a lock timeout rolls the whole file back before the retry
        await withLockRetry(file, () => sql.unsafe(text), retry);
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
        report.online[file] = await applyOnlineSql(sql, text, { ...retry, lockTimeoutMs });
        await sql.unsafe(`SET lock_timeout = ${Math.max(0, Math.floor(lockTimeoutMs))}`);
        await record(file, sum, null);
        report.applied.push(file);
        log(`[db] ${file}: applied online (${report.online[file].length} statements)`);
      }
    } finally {
      await sql.unsafe("RESET lock_timeout; RESET statement_timeout").catch(() => undefined);
      (sql as unknown as { release: () => void }).release();
    }
  });
  return report;
}

/** Opens a connection to `url`, migrates it to the latest version and closes the connection. */
export async function runMigrations(
  url: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL,
  options: MigrateOptions = {},
): Promise<MigrateReport> {
  // statement and idle limits off (index builds are slow), lock timeout on for the journal's DDL (see MigrateOptions.lockTimeoutMs)
  const handle = createDb(url, {
    max: 2,
    timeouts: {
      statementTimeoutMs: 0,
      idleInTransactionTimeoutMs: 0,
      lockTimeoutMs: options.lockTimeoutMs ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
    },
  });
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
