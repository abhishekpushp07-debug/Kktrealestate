import { fillPlaceholders, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Executor } from "@kkt/db";
import type { Sql } from "postgres";

const dialect = new PgDialect();

/** The postgres.js client behind a Drizzle executor: the pool for `app.db` / `app.dbReplica`, the reserved connection in a transaction. */
export function clientOf(db: Executor): Sql {
  const client =
    (db as unknown as { $client?: Sql }).$client ?? (db as unknown as { session?: { client?: Sql } }).session?.client;
  if (!client) throw new Error("no postgres.js client behind this Drizzle executor");
  return client;
}

/** A statement compiled once; `run` binds the named placeholder values and executes it as a prepared statement. */
export interface CompiledSql<Row> {
  readonly text: string;
  run(db: Executor, values: Record<string, unknown>): Promise<Row[]>;
}

/**
 * Compiles a hot read statement to SQL text ONCE (Drizzle resolves table and column names at module load) instead of on every request:
 * building a large `sql` template (`sqlToQuery`, entity checks, name escaping) cost more CPU than PostgreSQL spent executing it. Values
 * are bound through `sql.placeholder(name)`; the statement runs through the same postgres.js client Drizzle would use (same type parsers),
 * as a prepared statement.
 */
export function compileSql<Row = Record<string, unknown>>(query: SQL): CompiledSql<Row> {
  const { sql: text, params } = dialect.sqlToQuery(query);
  return {
    text,
    run: async (db, values) =>
      (await clientOf(db).unsafe(text, fillPlaceholders(params, values) as never[], {
        prepare: true,
      })) as unknown as Row[],
  };
}
