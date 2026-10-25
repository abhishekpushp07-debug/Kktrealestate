// Database client factory and transaction helpers.
import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index.js";

/** Default development database URL (docker-compose / local Postgres 16). */
export const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/kkt";

/** Drizzle database handle typed with the full schema. */
export type DB = PostgresJsDatabase<typeof schema>;

/** Drizzle transaction handle (what `db.transaction(async (tx) => …)` passes in). */
export type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** Anything that can run a query: the database or a transaction. */
export type Executor = DB | Tx;

/**
 * Per-connection safety limits (Postgres session settings sent as startup parameters). A runaway query, a lock wait or a transaction
 * left idle by a crashed request is cut off instead of holding a pool connection (and its locks) until the HTTP client gives up.
 */
export interface DbTimeouts {
  /** `statement_timeout` in ms (0 = none). Env DB_STATEMENT_TIMEOUT_MS, default 15000. */
  statementTimeoutMs: number;
  /** `lock_timeout` in ms (0 = none). Env DB_LOCK_TIMEOUT_MS, default 5000. */
  lockTimeoutMs: number;
  /** `idle_in_transaction_session_timeout` in ms (0 = none). Env DB_IDLE_IN_TX_TIMEOUT_MS, default 30000. */
  idleInTransactionTimeoutMs: number;
  /** TCP connect timeout in seconds. Env DB_CONNECT_TIMEOUT_S, default 10. */
  connectTimeoutS: number;
}

/** Defaults of {@link DbTimeouts} (mirrored by the API's config validation). */
export const DEFAULT_DB_TIMEOUTS: Readonly<DbTimeouts> = Object.freeze({
  statementTimeoutMs: 15_000,
  lockTimeoutMs: 5_000,
  idleInTransactionTimeoutMs: 30_000,
  connectTimeoutS: 10,
});

function envInt(env: Record<string, string | undefined>, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/** Reads {@link DbTimeouts} from DB_STATEMENT_TIMEOUT_MS / DB_LOCK_TIMEOUT_MS / DB_IDLE_IN_TX_TIMEOUT_MS / DB_CONNECT_TIMEOUT_S. */
export function dbTimeoutsFromEnv(env: Record<string, string | undefined> = process.env): DbTimeouts {
  return {
    statementTimeoutMs: envInt(env, "DB_STATEMENT_TIMEOUT_MS", DEFAULT_DB_TIMEOUTS.statementTimeoutMs, 0),
    lockTimeoutMs: envInt(env, "DB_LOCK_TIMEOUT_MS", DEFAULT_DB_TIMEOUTS.lockTimeoutMs, 0),
    idleInTransactionTimeoutMs: envInt(env, "DB_IDLE_IN_TX_TIMEOUT_MS", DEFAULT_DB_TIMEOUTS.idleInTransactionTimeoutMs, 0),
    connectTimeoutS: envInt(env, "DB_CONNECT_TIMEOUT_S", DEFAULT_DB_TIMEOUTS.connectTimeoutS, 1),
  };
}

export interface CreateDbOptions {
  /** Pool size (postgres.js `max`). */
  max?: number;
  /**
   * Session limits; default {@link dbTimeoutsFromEnv}. `false` sends no statement/lock/idle limits (migrations: index builds and the
   * migration advisory lock may legitimately take long); the connect timeout still applies.
   */
  timeouts?: Partial<DbTimeouts> | false;
  /** Idle connection timeout in seconds. */
  idleTimeout?: number;
  /**
   * Run parameterised queries as named prepared statements (postgres.js caches them per connection, so Postgres plans each distinct
   * query once per connection instead of on every execution; a five-join list page spends ~1.3 ms planning vs ~0.3 ms executing).
   * Default: true unless DATABASE_PREPARE=false — set that behind PgBouncer in transaction mode older than 1.21.
   */
  prepare?: boolean;
}

/** Default for `prepare` from the environment. */
function prepareDefault(): boolean {
  return (process.env["DATABASE_PREPARE"] ?? "true").toLowerCase() !== "false";
}

type UnsafeFn = Sql["unsafe"];

/**
 * Makes `client.unsafe()` (what Drizzle's postgres-js driver calls for every query) default to `prepare: true`. Argument-less calls keep
 * the simple protocol (postgres.js picks it when there are no parameters), so multi-statement migration scripts are unaffected.
 * Transactions and savepoints hand Drizzle a fresh scoped client, so those are patched the same way as they are created.
 */
function withPreparedStatements<T extends Sql>(client: T): T {
  const target = client as unknown as { unsafe: UnsafeFn; begin: Sql["begin"]; savepoint?: unknown };
  const unsafe = target.unsafe.bind(client) as UnsafeFn;
  // Drizzle passes `{ prepare: false }` explicitly for every unnamed query, so the flag is overridden rather than defaulted.
  target.unsafe = ((query: string, args?: unknown, options?: Record<string, unknown>) => {
    if (args !== undefined && !Array.isArray(args)) return unsafe(query, { ...(args as Record<string, unknown>), prepare: true } as never);
    return unsafe(query, (args ?? []) as never, { ...(options ?? {}), prepare: true } as never);
  }) as unknown as UnsafeFn;
  if (typeof target.begin === "function") {
    const begin = target.begin.bind(client) as (...a: unknown[]) => unknown;
    target.begin = ((...args: unknown[]) => {
      const i = args.findIndex((a) => typeof a === "function");
      if (i === -1) return begin(...args);
      const fn = args[i] as (tx: Sql) => unknown;
      args[i] = (tx: Sql) => fn(withPreparedStatements(tx));
      return begin(...args);
    }) as unknown as Sql["begin"];
  }
  if (typeof target.savepoint === "function") {
    const savepoint = (target.savepoint as (...a: unknown[]) => unknown).bind(client);
    target.savepoint = (...args: unknown[]) => {
      const i = args.findIndex((a) => typeof a === "function");
      if (i === -1) return savepoint(...args);
      const fn = args[i] as (tx: Sql) => unknown;
      args[i] = (tx: Sql) => fn(withPreparedStatements(tx));
      return savepoint(...args);
    };
  }
  return client;
}

export interface DbHandle {
  db: DB;
  sql: Sql;
  close(): Promise<void>;
}

/** Primary + replica handles (ARCHITECTURE §6); `replica` is the primary when no replica URL is set. */
export interface DbCluster {
  primary: DbHandle;
  replica: DbHandle;
  /** True when `replica` is a separate pool on DATABASE_REPLICA_URL. */
  hasReplica: boolean;
  close(): Promise<void>;
}

/** Opens a postgres.js pool on `url` and wraps it in Drizzle; `close()` ends the pool. */
export function createDb(url: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL, options: CreateDbOptions = {}): DbHandle {
  const env = dbTimeoutsFromEnv();
  const t: DbTimeouts = options.timeouts === false ? env : { ...env, ...(options.timeouts ?? {}) };
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
    connect_timeout: t.connectTimeoutS,
    connection:
      options.timeouts === false
        ? {}
        : {
            statement_timeout: t.statementTimeoutMs,
            lock_timeout: t.lockTimeoutMs,
            idle_in_transaction_session_timeout: t.idleInTransactionTimeoutMs,
          },
    // bigint columns arrive as JS numbers (all amounts fit in 2^53); drizzle's
    // `bigint({ mode: "number" })` also parses them, this keeps raw `sql` results consistent.
    types: { bigint: { to: 20, from: [20], serialize: (v: number | bigint) => String(v), parse: (v: string) => Number(v) } },
    onnotice: () => undefined,
  });
  if (options.prepare ?? prepareDefault()) withPreparedStatements(client);
  const db = drizzle(client, { schema });
  return {
    db,
    sql: client,
    close: () => client.end({ timeout: 5 }),
  };
}

/** Opens the primary pool and, when `replicaUrl` is set, a read-replica pool for reports and public reads. */
export function createDbCluster(
  primaryUrl: string = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL,
  replicaUrl: string | undefined = process.env["DATABASE_REPLICA_URL"],
  options: CreateDbOptions = {},
): DbCluster {
  const primary = createDb(primaryUrl, options);
  const hasReplica = replicaUrl !== undefined && replicaUrl !== "" && replicaUrl !== primaryUrl;
  const replica = hasReplica ? createDb(replicaUrl, options) : primary;
  return {
    primary,
    replica,
    hasReplica,
    close: async () => {
      await primary.close();
      if (hasReplica) {
        await replica.close();
      }
    },
  };
}

/**
 * Runs `fn` while holding the session-level advisory lock `hashtext(key)` on a dedicated connection reserved from `handle`'s pool
 * (so the pool needs at least two connections: one holds the lock, the others do the work). Other processes calling this with the same
 * key wait until `fn` settles; the lock is always released, and a crashed holder's lock dies with its connection.
 */
export async function withSessionAdvisoryLock<T>(handle: DbHandle, key: string, fn: () => Promise<T>): Promise<T> {
  const max = (handle.sql.options as { max?: number }).max ?? 1;
  if (max < 2) throw new Error("withSessionAdvisoryLock needs a pool of at least 2 connections (one holds the lock)");
  const conn = await handle.sql.reserve();
  try {
    // The lock wait is unbounded on purpose (another replica may be mid-migration); a connection-level lock_timeout must not abort it.
    await conn.unsafe("SET lock_timeout = 0");
    await conn.unsafe("SET statement_timeout = 0");
    await conn`SELECT pg_advisory_lock(hashtext(${key}))`;
    try {
      return await fn();
    } finally {
      await conn`SELECT pg_advisory_unlock(hashtext(${key}))`.catch(() => undefined);
      await conn.unsafe("RESET lock_timeout; RESET statement_timeout").catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}

/** SQLSTATEs after which re-running the whole transaction is safe and expected to succeed: serialization_failure, deadlock_detected. */
export const RETRYABLE_TRANSACTION_SQLSTATES: readonly string[] = ["40001", "40P01"];

/** The retryable SQLSTATE carried by `err` (looking through Drizzle's `cause` wrappers), or null. */
export function retryableTransactionError(err: unknown): string | null {
  let e: unknown = err;
  for (let depth = 0; depth < 8 && e !== null && typeof e === "object"; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_TRANSACTION_SQLSTATES.includes(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export interface TransactionRetryOptions {
  /** Retries after the first attempt (default 3, so at most 4 attempts). */
  retries?: number;
  /** Backoff base in ms (default 25): attempt n waits a random 0..min(maxDelayMs, baseDelayMs·2^n) ms ("full jitter"). */
  baseDelayMs?: number;
  /** Backoff cap in ms (default 1000). */
  maxDelayMs?: number;
  /** Transaction isolation level (default: the database default, READ COMMITTED). */
  isolationLevel?: "read committed" | "repeatable read" | "serializable";
  /** Observer for each retry (logging/metrics). */
  onRetry?: (info: { attempt: number; code: string; delayMs: number; error: unknown }) => void;
  /** Sleep implementation (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `fn` in a transaction and re-runs the WHOLE transaction when Postgres aborts it with a serialization failure (40001) or a
 * deadlock (40P01) — the loser of a lock-order race — with jittered exponential backoff. Every other error is rethrown at once, and the
 * last retryable error is rethrown when the retries are exhausted. `fn` may run more than once, so it must not have side effects outside
 * the transaction (queue jobs, Redis writes, notifications) before it returns; do those after this resolves.
 */
export async function withTransactionRetry<T>(db: DB, fn: (tx: Tx, attempt: number) => Promise<T>, options: TransactionRetryOptions = {}): Promise<T> {
  const retries = Math.max(0, Math.floor(options.retries ?? 3));
  const base = options.baseDelayMs ?? 25;
  const cap = options.maxDelayMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const config = options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction((tx) => fn(tx, attempt), config);
    } catch (err) {
      const code = retryableTransactionError(err);
      if (code === null || attempt >= retries) throw err;
      const delayMs = Math.floor(Math.random() * Math.min(cap, base * 2 ** attempt));
      options.onRetry?.({ attempt: attempt + 1, code, delayMs, error: err });
      await sleep(delayMs);
    }
  }
}

/** Takes a transaction-scoped advisory lock on `hashtext(key)`; released automatically at COMMIT/ROLLBACK. */
export async function withAdvisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/** Atomically increments and returns the next value of the (company, scope, fy) sequence (starts at 1). */
export async function nextSequence(tx: Executor, companyId: string, scope: string, fy: string): Promise<number> {
  const rows = await tx.execute<{ value: number | string }>(sql`
    INSERT INTO ${schema.sequences} (company_id, scope, fy, value)
    VALUES (${companyId}, ${scope}, ${fy}, 1)
    ON CONFLICT (company_id, scope, fy)
    DO UPDATE SET value = ${schema.sequences}.value + 1
    RETURNING value
  `);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("nextSequence: INSERT … RETURNING produced no row");
  }
  return Number(row.value);
}
