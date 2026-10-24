import { and, asc, count, desc, eq, gt, ilike, lt, or, type SQL } from "drizzle-orm";
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
 * Runs a list query: offset mode (`page`/`page_size`, total via count(*)) or keyset mode (`cursor`+`limit`, cursor = base64url(sortValue,id)),
 * with ILIKE search, allow-listed sort and optional joins. One page query + one count query.
 */
export async function paginate<T = Record<string, unknown>>(executor: Executor, opts: PaginateOptions): Promise<ListResult<T>> {
  const sort = resolveSort(opts.sort);
  const idCol = opts.table.id;
  const dir = sort.direction === "asc" ? asc : desc;
  const cmp = sort.direction === "asc" ? gt : lt;
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
  const base: PgSelect = (opts.select ? executor.select(opts.select as SelectedFields) : executor.select()).from(opts.table).$dynamic();
  let pageQuery: PgSelect = opts.join ? opts.join(base) : base;
  pageQuery = pageQuery.where(where).orderBy(dir(sort.column), dir(idCol)).limit(pageSize + (cursorMode ? 1 : 0));
  if (!cursorMode) pageQuery = pageQuery.offset((page - 1) * pageSize);
  const countBase: PgSelect = executor.select({ total: count() }).from(opts.table).$dynamic();
  const countQuery = (opts.join ? opts.join(countBase) : countBase).where(and(...[opts.where, searchCondition(opts.search?.columns ?? [], opts.search?.term)].filter((c): c is SQL => c !== undefined)));
  const [rows, totals] = await Promise.all([pageQuery, countQuery]);
  const items = rows as unknown as T[];
  let nextCursor: string | null = null;
  if (cursorMode && items.length > pageSize) {
    items.length = pageSize;
    const last = items[items.length - 1] as Record<string, unknown>;
    nextCursor = encodeCursor({ v: rawSortValue(readSortValue(last, opts, sort.column, sort.field)), id: String(readId(last)) });
  }
  const totalRow = (totals as { total?: number | string }[])[0];
  return { items, total: Number(totalRow?.total ?? 0), page, page_size: pageSize, next_cursor: nextCursor };
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
export function fromListQuery(q: ListQuery): Pick<PaginateOptions, "page" | "page_size" | "cursor" | "limit"> {
  return { page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit };
}
