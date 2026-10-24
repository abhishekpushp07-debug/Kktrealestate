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
}

export interface DbHandle {
  db: DB;
  sql: Sql;
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
  const db = drizzle(client, { schema });
  return {
    db,
    sql: client,
    close: () => client.end({ timeout: 5 }),
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
