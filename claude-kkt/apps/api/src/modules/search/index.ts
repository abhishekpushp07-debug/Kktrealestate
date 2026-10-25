import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { SearchQuerySchema, SearchResponseSchema, type SearchEntityType, type SearchResult } from "@kkt/contracts";
import { escapeLike } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import type { StaffContext } from "../../lib/scope.js";

/** Server-side time budget: a search slower than this is cancelled (the query is killed, not abandoned) and answers with no results. */
const BUDGET_MS = 150;

const ALL_TYPES: readonly SearchEntityType[] = ["PROJECT", "BLOCK", "FLAT", "CUSTOMER", "BOOKING"];

interface Row { ord: number; type: SearchEntityType; id: string; label: string; sublabel: string | null; href: string }

/** `project_id = any($scope)` for scoped users, `true` for all-project users, `false` for a scoped user with no projects. */
function scopeSql(user: StaffContext, column: string, params: unknown[]): string {
  if (user.allProjects) return "true";
  if (user.projectIds.length === 0) return "false";
  params.push(user.projectIds);
  return `${column} = any($${params.length}::uuid[])`;
}

/** One UNION ALL statement with a limited branch per entity type (the old five parallel queries took five pool connections per keystroke). */
function buildSearch(user: StaffContext, term: string, types: Set<SearchEntityType>, per: number): { text: string; params: unknown[] } {
  const params: unknown[] = [user.companyId, `%${escapeLike(term)}%`, `${escapeLike(term)}%`];
  const [company, contains, prefix] = ["$1", "$2", "$3"];
  const branches: string[] = [];
  if (types.has("PROJECT")) {
    branches.push(`(select 1 as ord, 'PROJECT' as type, p.id, p.name as label, nullif(concat_ws(' · ', p.code, p.city), '') as sublabel, '/projects/' || p.id as href
      from projects p where p.company_id = ${company} and p.is_active and ${scopeSql(user, "p.id", params)} and (p.name ilike ${contains} or p.code ilike ${prefix}) limit ${per})`);
  }
  if (types.has("BLOCK")) {
    branches.push(`(select 2, 'BLOCK', b.id, b.name, pr.name, '/blocks/' || b.id
      from blocks b join projects pr on pr.id = b.project_id where b.company_id = ${company} and b.is_active and ${scopeSql(user, "b.project_id", params)} and (b.name ilike ${contains} or b.code ilike ${prefix}) limit ${per})`);
  }
  if (types.has("FLAT")) {
    branches.push(`(select 3, 'FLAT', f.id, f.flat_number, bl.name || ' · ' || f.status, '/blocks/' || f.block_id || '?flat=' || f.id
      from flats f join blocks bl on bl.id = f.block_id where f.company_id = ${company} and ${scopeSql(user, "f.project_id", params)} and f.flat_number ilike ${prefix} limit ${per})`);
  }
  if (types.has("CUSTOMER")) {
    branches.push(`(select 4, 'CUSTOMER', c.id, c.full_name, c.customer_code || ' · ' || c.phone, '/customers/' || c.id
      from customers c where c.company_id = ${company} and c.is_active and (c.full_name ilike ${contains} or c.phone ilike ${prefix} or c.customer_code ilike ${prefix}) limit ${per})`);
  }
  if (types.has("BOOKING")) {
    branches.push(`(select 5, 'BOOKING', bk.id, bk.booking_number, cu.full_name || ' · ' || coalesce(bk.flat_snapshot->>'flat_number', '') || ' · ' || bk.status, '/bookings/' || bk.id
      from bookings bk join customers cu on cu.id = bk.customer_id where bk.company_id = ${company} and ${scopeSql(user, "bk.project_id", params)} and (bk.booking_number ilike ${prefix} or cu.full_name ilike ${contains}) limit ${per})`);
  }
  return { text: `select * from (${branches.join(" union all ")}) s order by ord`, params };
}

/** Runs the search with a hard budget: on timeout the statement is cancelled server-side and an empty list is returned. */
async function runWithBudget(sql: Sql, text: string, params: unknown[], log: (msg: string) => void): Promise<Row[]> {
  const query = sql.unsafe(text, params as never[], { prepare: true });
  const timer = setTimeout(() => { log(`search exceeded ${BUDGET_MS} ms budget; cancelled`); void query.cancel(); }, BUDGET_MS);
  try {
    return (await query) as unknown as Row[];
  } catch (e) {
    if ((e as { code?: string }).code === "57014") return []; // query_canceled
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Command-palette search across projects, blocks, flats, customers and bookings (ILIKE: prefix on codes/numbers/phones, contains on names; scope-aware; 20 results max). */
export async function searchModule(app: FastifyInstance): Promise<void> {
  route(app, {
    method: "GET", url: "/search", permission: "project.read",
    schema: { querystring: SearchQuerySchema, response: { 200: SearchResponseSchema }, summary: "Global search (Ctrl/Cmd+K)" },
    handler: async (req) => {
      const user = req.user as StaffContext;
      const q = req.query;
      const limit = Math.min(20, q.limit);
      const per = Math.max(3, Math.ceil(limit / 2));
      const types = new Set<SearchEntityType>(q.types ?? ALL_TYPES);
      if (types.size === 0) return { results: [], recent: [] };
      const { text, params } = buildSearch(user, q.q, types, per);
      const rows = await runWithBudget(app.sql, text, params, (m) => req.log.warn(m));
      const results: SearchResult[] = rows.slice(0, limit).map((r) => ({ type: r.type, id: r.id, label: r.label, sublabel: r.sublabel, href: r.href }));
      return { results, recent: [] };
    },
  });
}
