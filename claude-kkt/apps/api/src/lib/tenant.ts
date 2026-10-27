import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { companies, type Executor } from "@kkt/db";
import { ApiError } from "./errors.js";

/**
 * Tenant resolution (contract C4). Every record carries a company id (SPEC §0); a request that is not authenticated names its company
 * one of these ways, tried in order:
 *   1. the authenticated principal's company (staff `req.user`, portal `req.customer`);
 *   2. header `x-kkt-company: <company slug>` (the website sends KKT_COMPANY_SLUG; API clients may send it);
 *   3. the request Host matched against `companies.hosts` (www./my. domains of each builder);
 *   4. the only company, when exactly one exists (today's single-tenant deployments);
 * otherwise 400 COMPANY_REQUIRED. A slug that names no company is also 400 COMPANY_REQUIRED (never a silent fallback to another
 * tenant). Staff and portal login bodies accept an optional `company` (slug) that takes the place of the header.
 */

/** Header naming the company by slug. */
export const COMPANY_HEADER = "x-kkt-company";

/** How long a slug / host / single-company answer is reused in this process (companies change rarely; a new host waits ≤ 30 s). */
const CACHE_TTL_MS = 30_000;
/**
 * Most entries the cache holds. Slugs and hosts come from unauthenticated requests (`x-kkt-company`, Host), and misses are cached too
 * (so a flood of unknown names costs one query each per 30 s, not one per request): without a bound, random names would grow the map
 * for the life of the process. The oldest entry is evicted first (a Map iterates in insertion order and a refresh re-inserts).
 */
export const TENANT_CACHE_MAX_ENTRIES = 1_000;
const cache = new Map<string, { id: string | null; at: number }>();

/** Drops the process-local cache (tests; after a company's slug or hosts change). */
export function clearTenantCache(): void {
  cache.clear();
}

/** Number of entries in the process-local cache (tests). */
export function tenantCacheSize(): number {
  return cache.size;
}

async function cachedLookup(key: string, load: () => Promise<string | null>, cacheMiss = true): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.id;
  const id = await load();
  if (id !== null || cacheMiss) {
    cache.delete(key);
    while (cache.size >= TENANT_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    cache.set(key, { id, at: Date.now() });
  }
  return id;
}

/** Lowercase kebab slug syntax (companies_slug_format_chk). */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Normalises a Host value: lowercase, no port, no trailing dot; null when empty or not a plausible host name. */
export function normaliseHost(host: string | undefined | null): string | null {
  if (!host) return null;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) return null; // IPv6 literal: never a company host
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9.-]{1,253}$/.test(h) ? h : null;
}

function companyRequired(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(400, "COMPANY_REQUIRED", message, details);
}

/** The company with this slug, or null. */
export async function companyIdBySlug(db: Executor, slug: string): Promise<string | null> {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s) || s.length > 100) return null;
  return cachedLookup(`slug:${s}`, async () => {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, s)).limit(1);
    return c?.id ?? null;
  });
}

/** The company whose `hosts` contains this host, or null (also null when, against the rules, two companies list it). */
export async function companyIdByHost(db: Executor, host: string): Promise<string | null> {
  const h = normaliseHost(host);
  if (!h) return null;
  return cachedLookup(`host:${h}`, async () => {
    const rows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(sql`${companies.hosts} @> ARRAY[${h}]::text[]`)
      .limit(2);
    return rows.length === 1 ? rows[0]!.id : null;
  });
}

/** The only company when exactly one exists, else null. */
export async function soleCompanyId(db: Executor): Promise<string | null> {
  // a miss is not cached: the first company of a fresh install must be found as soon as bootstrap created it
  return cachedLookup(
    "sole",
    async () => {
      const rows = await db.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(2);
      return rows.length === 1 ? rows[0]!.id : null;
    },
    false,
  );
}

/**
 * Resolves the company id for `req` (contract C4, see the module comment). `explicitSlug` is a slug named by the request body (login
 * `company`); it is checked like the header and wins over it.
 */
export async function resolveCompanyId(
  app: Pick<FastifyInstance, "db">,
  req: Pick<FastifyRequest, "headers" | "hostname"> & {
    user?: { companyId: string };
    customer?: { companyId: string };
  },
  explicitSlug?: string | null,
): Promise<string> {
  const principal = req.user?.companyId ?? req.customer?.companyId;
  if (principal) return principal;

  const header = req.headers[COMPANY_HEADER];
  const slug = (explicitSlug ?? (Array.isArray(header) ? header[0] : header))?.trim();
  if (slug) {
    const id = await companyIdBySlug(app.db, slug);
    if (!id) throw companyRequired(`No company has the slug "${slug.slice(0, 100)}"`, { company: slug.slice(0, 100) });
    return id;
  }

  const host = normaliseHost(req.hostname);
  if (host) {
    const id = await companyIdByHost(app.db, host);
    if (id) return id;
  }

  const sole = await soleCompanyId(app.db);
  if (sole) return sole;
  throw companyRequired(
    `Several companies are served here: name one with the ${COMPANY_HEADER} header (its slug) or a company host`,
    { header: COMPANY_HEADER },
  );
}
