/**
 * Bulk loading for the scale seed (docs/SEED.md "Production-size data"): rows are streamed into Postgres with COPY … FROM STDIN in the
 * text format, a few thousand rows per write. Values are encoded here (NULL → \N, tab / newline / backslash escaped, arrays as Postgres
 * array literals, objects as JSON), so callers pass plain JS values in column order.
 */
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Sql } from "postgres";

/** A value COPY understands: null, scalars, dates, arrays (one dimension) and JSON objects. */
export type CopyValue = string | number | boolean | Date | null | undefined | readonly unknown[] | object;

/** One row as column → value (every row of a load has the same keys, in the same order). */
export type CopyRow = Record<string, CopyValue>;

function escapeText(s: string): string {
  return s.replace(/[\\\t\n\r]/g, (c) => (c === "\\" ? "\\\\" : c === "\t" ? "\\t" : c === "\n" ? "\\n" : "\\r"));
}

/** Postgres array literal element: always quoted, `"` and `\` escaped. */
function arrayElement(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  return `"${String(v).replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Encodes one value for the COPY text format. `json` marks a column whose arrays are JSON (jsonb), not Postgres arrays. */
export function copyField(v: CopyValue, json = false): string {
  if (v === null || v === undefined) return "\\N";
  if (typeof v === "string") return escapeText(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`COPY: non-finite number ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "t" : "f";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v) && !json) return escapeText(`{${(v as readonly unknown[]).map(arrayElement).join(",")}}`);
  return escapeText(JSON.stringify(v));
}

/** A table load: name, columns (in order) and which of them are jsonb. */
export interface CopySpec {
  table: string;
  columns: readonly string[];
  /** Columns holding jsonb (arrays in them are JSON arrays, not Postgres arrays). */
  json?: readonly string[];
}

/** Streams `rows` (each in `spec.columns` order) into `spec.table` with COPY; returns the row count. */
export async function copyRows(sql: Sql, spec: CopySpec, rows: Iterable<readonly CopyValue[]>): Promise<number> {
  const jsonCols = new Set(spec.json ?? []);
  const isJson = spec.columns.map((c) => jsonCols.has(c));
  let count = 0;
  function* lines(): Generator<string> {
    let chunk: string[] = [];
    for (const row of rows) {
      if (row.length !== spec.columns.length)
        throw new Error(`COPY ${spec.table}: row has ${row.length} values for ${spec.columns.length} columns`);
      chunk.push(row.map((v, i) => copyField(v, isJson[i])).join("\t"));
      count += 1;
      if (chunk.length >= 2000) {
        yield chunk.join("\n") + "\n";
        chunk = [];
      }
    }
    if (chunk.length > 0) yield chunk.join("\n") + "\n";
  }
  const cols = spec.columns.map((c) => `"${c}"`).join(", ");
  const writable = await sql.unsafe(`copy "${spec.table}" (${cols}) from stdin`).writable();
  await pipeline(Readable.from(lines()), writable);
  return count;
}

/** Streams object rows into `table` with COPY; the columns are the keys of the first row. Returns the row count. */
export async function copyObjects(
  sql: Sql,
  table: string,
  rows: readonly CopyRow[],
  json: readonly string[] = [],
): Promise<number> {
  const first = rows[0];
  if (!first) return 0;
  const columns = Object.keys(first);
  function* values(): Generator<CopyValue[]> {
    for (const r of rows) yield columns.map((c) => r[c]);
  }
  return copyRows(sql, { table, columns, json }, values());
}
