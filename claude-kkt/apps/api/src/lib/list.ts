import { and, asc, count, desc, eq, getTableColumns, getTableName, gt, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgSelect, PgTable, SelectedFields } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
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
  /** Set by listPaging() for `format=csv`: the request's query object, under which the export facts (total, next cursor) are recorded. */
  csvExport?: object | undefined;
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

/**
 * Rows strictly after the cursor `(v, id)` in `ORDER BY col <dir>, id <dir>`. PostgreSQL sorts NULL as the largest value (NULLS LAST on
 * ASC, NULLS FIRST on DESC), so a nullable sort column needs explicit NULL branches: without them a page boundary inside the NULL block
 * (or, on ASC, any boundary before it) silently ends the listing — the async export would store a truncated file. Not-null columns of
 * the listed table keep the plain index-friendly condition; columns of joined tables count as nullable (LEFT JOINs).
 */
export function keysetAfter(col: AnyPgColumn, idCol: AnyPgColumn, v: unknown, id: string, direction: "asc" | "desc", nullable: boolean): SQL {
  const cmp = direction === "asc" ? gt : lt;
  const tie = cmp(idCol, id);
  if (v === null || v === undefined) {
    // cursor inside the NULL block: ASC (NULLs last) → only later NULLs; DESC (NULLs first) → later NULLs, then every non-NULL row
    const laterNulls = and(isNull(col), tie)!;
    return direction === "asc" ? laterNulls : or(laterNulls, isNotNull(col))!;
  }
  const after = or(cmp(col, v), and(eq(col, v), tie))!;
  // a non-NULL cursor on ASC still has the whole NULL block ahead of it; on DESC the NULLs came first and are done
  return nullable && direction === "asc" ? or(after, isNull(col))! : after;
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
  const tsSort = isTimestampColumn(sort.column);
  const conditions: (SQL | undefined)[] = [opts.where, searchCondition(opts.search?.columns ?? [], opts.search?.term)];
  const cursorMode = opts.cursor !== undefined || opts.limit !== undefined;
  const pageSize = cursorMode ? (opts.limit ?? 25) : (opts.page_size ?? 25);
  const page = cursorMode ? 1 : Math.max(1, opts.page ?? 1);
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    const nullable = !(sort.column.notNull && sort.column.table === opts.table);
    conditions.push(keysetAfter(sort.column, idCol, cursorValue(sort.column, c.v), c.id, sort.direction, nullable));
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
  if (opts.csvExport) csvExportFacts.set(opts.csvExport, { total, rows: items.length, cursorMode, nextCursor });
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

/** Upper bound of rows a synchronous `format=csv` export streams (larger exports go through `POST /exports`, a worker job). */
export const CSV_EXPORT_MAX_ROWS = 10_000;

/** Rows per page when the export job pages a CSV list with `X-Export-Cursor`. */
export const CSV_EXPORT_PAGE_ROWS = 5_000;

/** Effective CSV export limits (default CSV_EXPORT_MAX_ROWS / CSV_EXPORT_PAGE_ROWS; integration tests lower them to exercise the cap). */
export const csvExportLimits: { maxRows: number; pageRows: number } = { maxRows: CSV_EXPORT_MAX_ROWS, pageRows: CSV_EXPORT_PAGE_ROWS };

/** Request header that switches a `format=csv` list into keyset pages (`start` for the first page, then the returned cursor). */
export const EXPORT_CURSOR_HEADER = "x-export-cursor";

/** What a CSV list response reports about its rows (recorded by paginate, turned into X-Export-* headers by the onSend hook). */
export interface CsvExportFacts {
  total: number;
  rows: number;
  cursorMode: boolean;
  nextCursor: string | null;
}

/** Export facts by request query object (the handler's `req.query`); weak so nothing outlives its request. */
const csvExportFacts = new WeakMap<object, CsvExportFacts>();
/** Requested keyset page of a CSV export by request query object (from the X-Export-Cursor header). */
const csvExportCursors = new WeakMap<object, { cursor: string | undefined }>();

/** Export facts recorded for a request's query object (tests and the export job read headers instead). */
export function csvExportFactsOf(query: object): CsvExportFacts | undefined {
  return csvExportFacts.get(query);
}

/**
 * Pagination for a list handler: normal paging for JSON; for `format=csv` the whole filtered list capped at CSV_EXPORT_MAX_ROWS, or —
 * when the request carries `X-Export-Cursor` (the async export job) — one keyset page of CSV_EXPORT_PAGE_ROWS rows.
 * `origin` is the request's own query object (`req.query`); pass it when `q` is a derived copy (e.g. `listPaging({ ...rest, format }, req.query)`),
 * otherwise the X-Export-* headers and the export job's keyset pages cannot find the request.
 */
export function listPaging(q: ListQuery, origin: object = q): Pick<PaginateOptions, "page" | "page_size" | "cursor" | "limit" | "exact" | "csvExport"> {
  if (q.format === "csv") {
    const keyset = csvExportCursors.get(origin);
    if (keyset) return { cursor: keyset.cursor, limit: csvExportLimits.pageRows, exact: true, csvExport: origin };
    return { page: 1, page_size: csvExportLimits.maxRows, exact: true, csvExport: origin };
  }
  return fromListQuery(q);
}

/**
 * Installs the CSV export hooks (audit F5): a preHandler that turns `X-Export-Cursor` into a keyset CSV page, and an onSend hook that
 * answers every CSV list with `X-Export-Total` (rows matching the filters), `X-Export-Rows` (rows in this response),
 * `X-Export-Truncated: true` when rows were cut at CSV_EXPORT_MAX_ROWS (use POST /exports for the whole list), and
 * `X-Export-Next-Cursor` on keyset pages that have a next page.
 */
export function installListExports(app: FastifyInstance): void {
  app.addHook("preHandler", async (req) => {
    const raw = req.headers[EXPORT_CURSOR_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || req.method !== "GET" || !req.query || typeof req.query !== "object") return;
    csvExportCursors.set(req.query, { cursor: value === "start" ? undefined : value });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (!req.query || typeof req.query !== "object") return payload;
    const facts = csvExportFacts.get(req.query);
    if (!facts) return payload;
    reply.header("X-Export-Total", String(facts.total));
    reply.header("X-Export-Rows", String(facts.rows));
    if (facts.cursorMode) {
      if (facts.nextCursor) reply.header("X-Export-Next-Cursor", facts.nextCursor);
    } else if (facts.total > facts.rows) {
      reply.header("X-Export-Truncated", "true");
    }
    return payload;
  });
}
