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

export interface CreateDbOptions {
  /** Pool size (postgres.js `max`). */
  max?: number;
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
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
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
