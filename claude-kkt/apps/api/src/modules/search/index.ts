import type { FastifyInstance } from "fastify";
import { SearchQuerySchema, SearchResponseSchema, type SearchEntityType, type SearchResult } from "@kkt/contracts";
import { escapeLike } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { readWithinBudget } from "../../lib/statementBudget.js";
import type { StaffContext } from "../../lib/scope.js";

/**
 * Time budget of one search (pool wait + execution): a slower search is stopped by PostgreSQL's own `statement_timeout` (the query is
 * killed, not abandoned) and answers with no results. See lib/statementBudget.ts for why this is not an out-of-band cancel.
 */
const BUDGET_MS = 150;

/** Searches stopped by the budget since the last log line; logged at most once per 10 s (a storm would otherwise log every one). */
let budgetMisses = 0;
let budgetLoggedAt = 0;
function reportBudgetMiss(log: { warn: (obj: object, msg: string) => void }): void {
  budgetMisses += 1;
  const now = Date.now();
  if (now - budgetLoggedAt < 10_000) return;
  log.warn(
    { stopped: budgetMisses, budget_ms: BUDGET_MS },
    "search exceeded its time budget; answered with no results",
  );
  budgetMisses = 0;
  budgetLoggedAt = now;
}

const ALL_TYPES: readonly SearchEntityType[] = ["PROJECT", "BLOCK", "FLAT", "CUSTOMER", "BOOKING"];

interface Row {
  ord: number;
  type: SearchEntityType;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

/** `project_id = any($scope)` for scoped users, `true` for all-project users, `false` for a scoped user with no projects. */
function scopeSql(user: StaffContext, column: string, params: unknown[]): string {
  if (user.allProjects) return "true";
  if (user.projectIds.length === 0) return "false";
  params.push(user.projectIds);
  return `${column} = any($${params.length}::uuid[])`;
}

/**
 * A project-scoped user only finds customers in their scope — the same rule as every customer route (lib/scope.ts
 * customerScopeCondition): primary applicant or co-applicant on a booking in one of their projects, the customer of a lead or a site visit
 * for one, or a record they created themselves that is not linked to any project yet. All-project users see every customer.
 */
function customerScopeSql(user: StaffContext, params: unknown[]): string {
  if (user.allProjects) return "true";
  params.push(user.id);
  const uid = `$${params.length}::uuid`;
  const ownUnlinked = `(c.created_by = ${uid}
      and not exists (select 1 from bookings xb where xb.customer_id = c.id)
      and not exists (select 1 from booking_co_applicants xbc where xbc.customer_id = c.id)
      and not exists (select 1 from leads xl where xl.customer_id = c.id and xl.project_id is not null)
      and not exists (select 1 from site_visits xv where xv.customer_id = c.id))`;
  if (user.projectIds.length === 0) return ownUnlinked;
  params.push(user.projectIds);
  const p = `$${params.length}::uuid[]`;
  return `(exists (select 1 from bookings sb where sb.project_id = any(${p}) and (sb.customer_id = c.id or exists (select 1 from booking_co_applicants sbc where sbc.booking_id = sb.id and sbc.customer_id = c.id)))
    or exists (select 1 from leads sl where sl.customer_id = c.id and sl.project_id = any(${p}))
    or exists (select 1 from site_visits sv where sv.customer_id = c.id and sv.project_id = any(${p}))
    or ${ownUnlinked})`;
}

/** Entity types the caller may see: each one needs its own read permission (customers carry PII, bookings carry money). */
export function permittedTypes(
  user: Pick<StaffContext, "permissions">,
  requested: readonly SearchEntityType[],
): Set<SearchEntityType> {
  const need: Partial<Record<SearchEntityType, string>> = {
    PROJECT: "project.read",
    BLOCK: "project.read",
    FLAT: "project.read",
    CUSTOMER: "customer.read",
    BOOKING: "booking.read",
  };
  return new Set(
    requested.filter((t) => {
      const p = need[t];
      return p !== undefined && user.permissions.has(p);
    }),
  );
}

/** One UNION ALL statement with a limited branch per entity type (the old five parallel queries took five pool connections per keystroke). */
function buildSearch(
  user: StaffContext,
  term: string,
  types: Set<SearchEntityType>,
  per: number,
): { text: string; params: unknown[] } {
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
      from customers c where c.company_id = ${company} and c.is_active and ${customerScopeSql(user, params)} and (c.full_name ilike ${contains} or c.phone ilike ${prefix} or c.customer_code ilike ${prefix}) limit ${per})`);
  }
  if (types.has("BOOKING")) {
    branches.push(`(select 5, 'BOOKING', bk.id, bk.booking_number, cu.full_name || ' · ' || coalesce(bk.flat_snapshot->>'flat_number', '') || ' · ' || bk.status, '/bookings/' || bk.id
      from bookings bk join customers cu on cu.id = bk.customer_id where bk.company_id = ${company} and ${scopeSql(user, "bk.project_id", params)} and (bk.booking_number ilike ${prefix} or cu.full_name ilike ${contains}) limit ${per})`);
  }
  return { text: `select * from (${branches.join(" union all ")}) s order by ord`, params };
}

/**
 * Command-palette search across projects, blocks, flats, customers and bookings (ILIKE: prefix on codes/numbers/phones, contains on names;
 * scope-aware; 20 results max). Each entity type is gated by its own read permission: PROJECT/BLOCK/FLAT → project.read,
 * CUSTOMER → customer.read, BOOKING → booking.read; types the caller may not read are silently left out.
 */
export async function searchModule(app: FastifyInstance): Promise<void> {
  route(app, {
    method: "GET",
    url: "/search",
    permission: ["project.read", "customer.read", "booking.read"],
    schema: {
      querystring: SearchQuerySchema,
      response: { 200: SearchResponseSchema },
      summary: "Global search (Ctrl/Cmd+K)",
    },
    handler: async (req) => {
      const user = req.user as StaffContext;
      const q = req.query;
      const limit = Math.min(20, q.limit);
      const per = Math.max(3, Math.ceil(limit / 2));
      const types = permittedTypes(user, q.types ?? ALL_TYPES);
      if (types.size === 0) return { results: [], recent: [] };
      const { text, params } = buildSearch(user, q.q, types, per);
      const rows = await readWithinBudget<Row>(app.sql, text, params, BUDGET_MS);
      if (rows === null) {
        reportBudgetMiss(req.log);
        return { results: [], recent: [] };
      }
      const results: SearchResult[] = rows
        .slice(0, limit)
        .map((r) => ({ type: r.type, id: r.id, label: r.label, sublabel: r.sublabel, href: r.href }));
      return { results, recent: [] };
    },
  });
}
