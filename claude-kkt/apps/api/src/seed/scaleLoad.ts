/**
 * Bulk loading for the scale seed (docs/SEED.md "Production-size data"): object rows are sent as one JSON document per batch and
 * expanded server-side — `INSERT INTO t (cols) SELECT cols FROM jsonb_populate_recordset(NULL::t, $1)` — a few thousand rows per
 * statement. Omitted columns take their defaults, JSON arrays become Postgres arrays for array columns, and a failing batch (constraint,
 * FK) raises like any statement and rolls the whole load back. (COPY FROM STDIN through postgres.js was the first choice, but its
 * writable never settles when the server rejects the data, so a constraint violation would hang the seed instead of failing it.)
 */
import type { Sql } from "postgres";

/** A value of one column: scalars, dates, arrays (array columns) and objects (jsonb). */
export type LoadValue = string | number | boolean | Date | null | undefined | readonly unknown[] | object;

/** One row as column → value (every row of a load has the same keys). */
export type LoadRow = Record<string, LoadValue>;

/** Rows per statement, and the JSON size at which a batch is cut early. */
const BATCH_ROWS = 5_000;
const BATCH_BYTES = 8 * 1024 * 1024;

/** Inserts object rows into `table`; the columns are the keys of the first row. Returns the row count. */
export async function insertObjects(sql: Sql, table: string, rows: readonly LoadRow[]): Promise<number> {
  const first = rows[0];
  if (!first) return 0;
  const columns = Object.keys(first);
  const cols = columns.map((c) => `"${c}"`).join(", ");
  const statement = `insert into "${table}" (${cols}) select ${cols} from jsonb_populate_recordset(null::"${table}", $1::text::jsonb)`;
  let batch: string[] = [];
  let bytes = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await sql.unsafe(statement, [`[${batch.join(",")}]`]);
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const json = JSON.stringify(row);
    batch.push(json);
    bytes += json.length;
    if (batch.length >= BATCH_ROWS || bytes >= BATCH_BYTES) await flush();
  }
  await flush();
  return rows.length;
}
