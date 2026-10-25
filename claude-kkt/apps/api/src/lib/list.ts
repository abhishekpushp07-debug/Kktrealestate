import { and, asc, count, desc, eq, getTableColumns, getTableName, gt, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgSelect, PgTable, SelectedFields } from "drizzle-orm/pg-core";
import type { ListQuery } from "@kkt/contracts";
import { parseSort } from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import { ApiError } from "./errors.js";

/** A table with an `id` column (used as the keyset tiebreaker). */
export type ListableTable = PgTable & { id: AnyPgColumn };

/** Paginated result envelope (docs/API-CONVENTIONS.md). */
export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  next_cursor: string | null;
}

/** Options for paginate(). */
export interface PaginateOptions {
  table: ListableTable;
  /** Drizzle selection object (columns, sql expressions or whole tables); omit to select the whole table row. */
  select?: Record<string, unknown>;
  /** Adds joins to the dynamic query builder (applied to both the page and the count query). */
  join?: (q: PgSelect) => PgSelect;
  where?: SQL | undefined;
  /** ILIKE search across the given columns (term is escaped for %, _ and \). */
  search?: { columns: readonly (AnyPgColumn | SQL)[]; term: string | undefined };
  /** Allow-listed sort fields; `requested` is `field` or `-field`. */
  sort: { allowed: Record<string, AnyPgColumn>; default: string; requested?: string | undefined };
  page?: number;
  page_size?: number;
  cursor?: string | undefined;
  limit?: number | undefined;
  /** `true` forces an exact `count(*)`; otherwise tables above `estimateAbove` rows answer with the planner's estimate (ARCHITECTURE §6). */
  exact?: boolean | undefined;
  /** Row threshold (pg_class.reltuples) above which the total is estimated; default COUNT_ESTIMATE_ABOVE. */
  estimateAbove?: number | undefined;
}

/** Tables with more live rows than this (per pg_class) report an estimated `total` unless the caller asks for `exact=true`. */
export const COUNT_ESTIMATE_ABOVE = 10_000;

/** Name of the hidden select key carrying the microsecond-exact sort value of timestamp sorts (stripped from the items). */
const SORT_KEY = "__kkt_sort_key";

/** True for timestamp / timestamptz columns, whose JS Date values lose the microseconds Postgres stores. */
export function isTimestampColumn(col: AnyPgColumn): boolean {
  return col.columnType === "PgTimestamp" || col.columnType === "PgTimestampString";
}

/**
 * Microsecond-exact text key of a timestamp column (`YYYY-MM-DD HH24:MI:SS.US`, UTC). Keyset cursors on timestamp sorts carry this
 * text instead of a JS Date (millisecond precision), so rows written in the same millisecond are never skipped between pages.
 */
export function timestampSortKey(col: AnyPgColumn): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`;
}

/** The parameter a microsecond text key compares against: the column's own type, so the comparison stays index-friendly. */
function timestampParam(col: AnyPgColumn, key: string): SQL {
  const withTimezone = (col as unknown as { withTimezone?: boolean }).withTimezone === true;
  return withTimezone ? sql`(${key}::timestamp at time zone 'UTC')` : sql`${key}::timestamp`;
}

/** Escapes a search term for use inside an ILIKE pattern. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Builds an ILIKE "contains" condition over several columns, or undefined for an empty term. */
export function searchCondition(columns: readonly (AnyPgColumn | SQL)[], term: string | undefined): SQL | undefined {
  const t = term?.trim();
  if (!t) return undefined;
  const pattern = `%${escapeLike(t)}%`;
  const parts = columns.map((c) => ilike(c as AnyPgColumn, pattern));
  return parts.length === 1 ? parts[0] : or(...parts);
}

interface CursorPayload { v: string | number | boolean | null; id: string }

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify([p.v, p.id])).toString("base64url");
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[1] !== "string") throw new Error("bad");
    return { v: parsed[0] as CursorPayload["v"], id: parsed[1] };
  } catch {
    throw ApiError.badRequest("Invalid cursor");
  }
}

function cursorValue(col: AnyPgColumn, v: CursorPayload["v"]): unknown {
  if (v === null) return null;
  if (isTimestampColumn(col) && typeof v === "string") return timestampParam(col, v);
  return col.dataType === "date" && typeof v === "string" ? new Date(v) : v;
}

function rawSortValue(v: unknown): CursorPayload["v"] {
  if (v instanceof Date) return v.toISOString();
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** Resolves the requested sort against the allow-list (400 on unknown fields). */
export function resolveSort(sort: PaginateOptions["sort"]): { field: string; column: AnyPgColumn; direction: "asc" | "desc" } {
  const parsed = parseSort(sort.requested ?? sort.default);
  const column = sort.allowed[parsed.field];
  if (!column) throw ApiError.badRequest(`Cannot sort by "${parsed.field}"`, { allowed: Object.keys(sort.allowed) });
  return { field: parsed.field, column, direction: parsed.direction };
}

/**
 * Estimated row count of a filtered select from the planner (`EXPLAIN (FORMAT JSON)`), used for big tables instead of `count(*)`.
 * Falls back to null when the plan cannot be read, in which case the caller counts exactly.
 */
async function plannerEstimate(executor: Executor, query: PgSelect): Promise<number | null> {
  try {
    const rows = (await executor.execute(sql`explain (format json) ${query}`)) as unknown as Record<string, unknown>[];
    const raw = rows[0]?.["QUERY PLAN"];
    const plan = (typeof raw === "string" ? JSON.parse(raw) : raw) as { Plan?: { "Plan Rows"?: number } }[] | undefined;
    const n = plan?.[0]?.Plan?.["Plan Rows"];
    return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  } catch {
    return null;
  }
}

/** How long a table's pg_class row estimate is reused before being re-read (it only decides exact vs estimated counting). */
const TABLE_ESTIMATE_TTL_MS = 60_000;
const tableEstimates = new Map<string, { n: number; at: number }>();

/**
 * Live-row estimate of a table from pg_class (−1 when the table was never analysed), cached per process for TABLE_ESTIMATE_TTL_MS so a
 * list request costs two queries (page + count), not three. The estimate only picks the counting strategy, so staleness is harmless.
 */
async function tableEstimate(executor: Executor, table: PgTable): Promise<number> {
  const name = getTableName(table);
  const hit = tableEstimates.get(name);
  const now = Date.now();
  if (hit && now - hit.at < TABLE_ESTIMATE_TTL_MS) return hit.n;
  const rows = (await executor.execute(sql`select reltuples::float8 as n from pg_class where oid = ${`"${name}"`}::regclass`)) as unknown as { n: number | string }[];
  const n = Number(rows[0]?.n ?? -1);
  tableEstimates.set(name, { n, at: now });
  return n;
}

/** Forgets cached table estimates (tests that switch between exact and estimated counting). */
export function resetTableEstimates(): void {
  tableEstimates.clear();
}

/**
 * Runs a list query: offset mode (`page`/`page_size`, total via count(*)) or keyset mode (`cursor`+`limit`, cursor = base64url(sortValue,id)),
 * with ILIKE search, allow-listed sort and optional joins. One page query + one count query. Timestamp sorts page on a microsecond-exact
 * key; tables above `estimateAbove` rows report the planner's estimate as `total` unless `exact` is set.
 */
export async function paginate<T = Record<string, unknown>>(executor: Executor, opts: PaginateOptions): Promise<ListResult<T>> {
  const sort = resolveSort(opts.sort);
  const idCol = opts.table.id;
  const dir = sort.direction === "asc" ? asc : desc;
  const cmp = sort.direction === "asc" ? gt : lt;
  const tsSort = isTimestampColumn(sort.column);
  const conditions: (SQL | undefined)[] = [opts.where, searchCondition(opts.search?.columns ?? [], opts.search?.term)];
  const cursorMode = opts.cursor !== undefined || opts.limit !== undefined;
  const pageSize = cursorMode ? (opts.limit ?? 25) : (opts.page_size ?? 25);
  const page = cursorMode ? 1 : Math.max(1, opts.page ?? 1);
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    const v = cursorValue(sort.column, c.v);
    conditions.push(or(cmp(sort.column, v), and(eq(sort.column, v), cmp(idCol, c.id))));
  }
  const where = and(...conditions.filter((c): c is SQL => c !== undefined));
  // keyset paging on a timestamp: select its microsecond text key alongside the row so the next cursor is exact
  const withSortKey = cursorMode && tsSort;
  const selection: SelectedFields | undefined = withSortKey
    ? ({ ...(opts.select ?? getTableColumns(opts.table)), [SORT_KEY]: timestampSortKey(sort.column) } as SelectedFields)
    : (opts.select as SelectedFields | undefined);
  const base: PgSelect = (selection ? executor.select(selection) : executor.select()).from(opts.table).$dynamic();
  let pageQuery: PgSelect = opts.join ? opts.join(base) : base;
  pageQuery = pageQuery.where(where).orderBy(dir(sort.column), dir(idCol)).limit(pageSize + (cursorMode ? 1 : 0));
  if (!cursorMode) pageQuery = pageQuery.offset((page - 1) * pageSize);
  const countWhere = and(...[opts.where, searchCondition(opts.search?.columns ?? [], opts.search?.term)].filter((c): c is SQL => c !== undefined));
  const countBase: PgSelect = executor.select({ total: count() }).from(opts.table).$dynamic();
  const countQuery = (opts.join ? opts.join(countBase) : countBase).where(countWhere);
  const [rows, total] = await Promise.all([pageQuery, countRows(executor, opts, countQuery, countWhere)]);
  const items = rows as unknown as T[];
  let nextCursor: string | null = null;
  if (cursorMode && items.length > pageSize) {
    items.length = pageSize;
    const last = items[items.length - 1] as Record<string, unknown>;
    const v = withSortKey ? last[SORT_KEY] : readSortValue(last, opts, sort.column, sort.field);
    nextCursor = encodeCursor({ v: rawSortValue(v), id: String(readId(last)) });
  }
  if (withSortKey) for (const row of items as Record<string, unknown>[]) delete row[SORT_KEY];
  return { items, total, page, page_size: pageSize, next_cursor: nextCursor };
}

/** Exact `count(*)` for small tables or `exact=true`; the planner's estimate of the filtered query above the threshold. */
async function countRows(executor: Executor, opts: PaginateOptions, countQuery: PgSelect, where: SQL | undefined): Promise<number> {
  const exact = async () => {
    const totals = (await countQuery) as { total?: number | string }[];
    return Number(totals[0]?.total ?? 0);
  };
  if (opts.exact) return exact();
  const threshold = opts.estimateAbove ?? COUNT_ESTIMATE_ABOVE;
  if ((await tableEstimate(executor, opts.table)) <= threshold) return exact();
  const idsBase: PgSelect = executor.select({ id: opts.table.id }).from(opts.table).$dynamic();
  const estimate = await plannerEstimate(executor, (opts.join ? opts.join(idsBase) : idsBase).where(where));
  return estimate ?? exact();
}

/** Reads the sort value back from the last row: a flat select key, a nested table selection, or the full-row property. */
function readSortValue(last: Record<string, unknown>, opts: PaginateOptions, column: AnyPgColumn, field: string): unknown {
  for (const [k, c] of Object.entries(opts.select ?? {})) {
    if (c === column) return last[k];
    if (c && typeof c === "object" && !("queryChunks" in (c as object))) {
      const nestedKey = columnKey(c as PgTable, column);
      if (nestedKey !== undefined) return (last[k] as Record<string, unknown> | undefined)?.[nestedKey];
    }
  }
  const key = columnKey(opts.table, column) ?? field;
  return last[key];
}

/** Reads the row id from a flat or nested selection. */
function readId(last: Record<string, unknown>): unknown {
  if (last["id"] !== undefined) return last["id"];
  for (const v of Object.values(last)) if (v && typeof v === "object" && "id" in (v as object)) return (v as { id: unknown }).id;
  return undefined;
}

/** Finds the TS property name of a column on a table (for reading the sort value back from a full-row select). */
function columnKey(table: PgTable, column: AnyPgColumn): string | undefined {
  for (const [k, v] of Object.entries(table as unknown as Record<string, unknown>)) if (v === column) return k;
  return undefined;
}

/** Maps the common ListQuery pagination fields onto paginate() options (search/sort are passed explicitly by the caller). */
export function fromListQuery(q: ListQuery): Pick<PaginateOptions, "page" | "page_size" | "cursor" | "limit" | "exact"> {
  return { page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit, exact: q.exact };
}

/** Upper bound of rows a synchronous `format=csv` export streams (larger exports belong to a worker job). */
export const CSV_EXPORT_MAX_ROWS = 10_000;

/** Pagination for a list handler: normal paging for JSON, the whole filtered list (capped at CSV_EXPORT_MAX_ROWS) for `format=csv`. */
export function listPaging(q: ListQuery): Pick<PaginateOptions, "page" | "page_size" | "cursor" | "limit" | "exact"> {
  if (q.format === "csv") return { page: 1, page_size: CSV_EXPORT_MAX_ROWS, exact: true };
  return fromListQuery(q);
}
