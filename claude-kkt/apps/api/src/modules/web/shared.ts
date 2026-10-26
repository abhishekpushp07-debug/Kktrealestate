import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { companies, documents, projects, type Executor } from "@kkt/db";
import { DEFAULT_NUMBER_PATTERN, financialYear, formatNumber } from "@kkt/domain";
import { config } from "../../config.js";
import type { AuditActor } from "../../lib/audit.js";
import { CACHE_BUDGET_MS, cached, redisUsable, withinBudget } from "../../lib/cache.js";
import { ApiError } from "../../lib/errors.js";
import type { NumberingCompany, NumberingScope } from "../../lib/numbering.js";
import { versionConflict, type VersionedTable } from "../../lib/version.js";

/** Cache-Control for every public JSON GET (docs/API-CONVENTIONS.md Appendix B). */
export const PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
/** Cache-Control for immutable media bytes (document ids never change content). */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Redis TTL of the public read cache. */
export const PUBLIC_CACHE_SECONDS = 60;
const PUBLIC_CACHE_PREFIX = "pub:";
/**
 * Generation counter of the public cache. Every CMS / website-settings / visit write bumps it, so cached entries written under the old
 * generation are simply never read again (no SCAN + DEL, and no race where an in-flight read repopulates a stale entry after the bust).
 */
export const PUBLIC_CACHE_VERSION_KEY = "pub:version";

/** API origin without a trailing slash (absolute URLs in public payloads). */
export const apiOrigin = config.API_PUBLIC_URL.replace(/\/+$/, "");
/** Website origin without a trailing slash (manage links). */
export const webOrigin = config.WEB_ORIGIN.replace(/\/+$/, "");

/** Absolute URL of a public media document (original or a variant). */
export function mediaUrl(documentId: string, variant?: "thumb" | "medium"): string {
  return `${apiOrigin}/api/v1/public/media/${documentId}${variant ? `?variant=${variant}` : ""}`;
}

/** The actor recorded for unauthenticated website actions. */
export const WEBSITE_ACTOR: AuditActor = { type: "SYSTEM", id: null, name: "website" };

/** Short upper-case reference code from a uuid (enquiry references, fake honeypot replies). */
export function shortCode(id: string, prefix: string): string {
  return `${prefix}${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Random 8-char upper-case code (honeypot replies that must look real but reference nothing). */
export function fakeCode(prefix: string): string {
  return `${prefix}${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * A believable document number for honeypot replies: the company's real pattern for the scope (`SV-2627/0417`), FY of `businessDate`,
 * random sequence. Bots that fill the honeypot must not be able to tell their submission was dropped (SPEC §15 "silently dropped").
 */
export function fakeNumber(
  company: Pick<NumberingCompany, "fyStartMonth" | "numbering">,
  scope: NumberingScope | "enquiry",
  businessDate: string,
  fallbackPrefix: string,
): string {
  const fy = financialYear(businessDate, company.fyStartMonth);
  const cfg = scope === "enquiry" ? undefined : company.numbering[scope];
  const seq = 100 + (randomBytes(2).readUInt16BE(0) % 9000);
  return formatNumber(cfg?.prefix ?? fallbackPrefix, fy.label, seq, cfg?.format ?? DEFAULT_NUMBER_PATTERN);
}

/** Postgres `time` values arrive as "HH:MM:SS"; the API speaks "HH:MM". */
export function clock(value: string | null | undefined): string {
  return (value ?? "").slice(0, 5);
}

/** Sets the public cache headers on a reply. */
export function publicHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
  reply.header("Vary", "Accept-Encoding");
}

type CacheEnvelope<T> = { ok: true; value: T } | { ok: false };

/** Current public cache generation ("0" when unset or Redis is unavailable). */
async function publicCacheVersion(app: FastifyInstance): Promise<string> {
  if (!redisUsable(app.redis)) return "0";
  try {
    return (
      (await withinBudget(app.redis.get(PUBLIC_CACHE_VERSION_KEY), CACHE_BUDGET_MS, "public cache version")) ?? "0"
    );
  } catch {
    return "0";
  }
}

/**
 * Canonical cache key of a public GET: route pattern + validated params + validated query (sorted). Built from what the Zod schemas
 * accepted, never from the raw URL, so `?junk=1`, `?junk=2`… on a route without a query schema cannot grow the Redis keyspace.
 */
export function publicCacheKey(req: FastifyRequest): string {
  const pattern = req.routeOptions.url ?? req.url.split("?")[0] ?? req.url;
  const params = Object.entries((req.params ?? {}) as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  const hasQuerySchema = Boolean((req.routeOptions.schema as { querystring?: unknown } | undefined)?.querystring);
  const query = hasQuerySchema
    ? Object.entries((req.query ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    : [];
  return `${pattern}|${params.join("&")}|${query.join("&")}`;
}

/**
 * Read-through cache for public GETs keyed by generation + route + validated inputs (60 s). `fn` returns null for "not found", which is
 * cached too so an unpublished slug cannot be used to hammer the database.
 */
export async function publicCached<T>(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<T | null>,
  notFoundEntity = "Resource",
): Promise<T> {
  const key = `${PUBLIC_CACHE_PREFIX}${await publicCacheVersion(app)}:${publicCacheKey(req)}`;
  const env = await cached<CacheEnvelope<T>>(app.redis, key, PUBLIC_CACHE_SECONDS, async () => {
    const value = await fn();
    return value === null ? { ok: false } : { ok: true, value };
  });
  if (!env.ok) throw ApiError.notFound(notFoundEntity);
  publicHeaders(reply);
  return env.value;
}

/**
 * Invalidates every cached public response by bumping the generation counter. Called after every CMS / website-settings / visit-settings
 * write and after bookings. `_pathPrefix` is accepted for call-site compatibility; invalidation is always global (entries expire in 60 s).
 */
export async function bustPublicCache(app: FastifyInstance, _pathPrefix = ""): Promise<void> {
  await app.redis.incr(PUBLIC_CACHE_VERSION_KEY).catch(() => undefined);
}

/** The one company whose website this API serves (single tenant today). */
export async function publicCompanyId(db: Executor): Promise<string | null> {
  const [c] = await db.select({ id: companies.id }).from(companies).orderBy(companies.createdAt).limit(1);
  return c?.id ?? null;
}

/**
 * Versioned update for singleton tables keyed by something other than `id` (site_settings.company_id, project_*_settings.project_id):
 * `UPDATE … SET …, version = version + 1 WHERE key = $k AND version = $expected RETURNING *`; 409 VERSION_CONFLICT when stale, 404 when missing.
 */
export async function updateByKey<T extends PgTable & { version: AnyPgColumn }>(
  tx: Executor,
  table: T,
  keyColumn: AnyPgColumn,
  keyValue: string,
  expected: number,
  changes: Record<string, unknown>,
  entityType: string,
): Promise<T["$inferSelect"]> {
  const set = { ...changes, version: sql`${table.version} + 1` } as unknown as PgUpdateSetSource<T>;
  const rows = (await tx
    .update(table)
    .set(set)
    .where(and(eq(keyColumn, keyValue), eq(table.version, expected)))
    .returning()) as T["$inferSelect"][];
  const row = rows[0];
  if (row) return row;
  const [cur] = (await tx
    .select({ version: table.version })
    .from(table as PgTable)
    .where(eq(keyColumn, keyValue))
    .limit(1)) as { version: number }[];
  if (!cur) throw ApiError.notFound(entityType.replace(/_/g, " "));
  throw await versionConflict(tx, table as unknown as VersionedTable, keyValue, cur.version, entityType);
}

/** A document row as this module needs it. */
export type DocumentRecord = typeof documents.$inferSelect;

/** Entity types whose non-sensitive images may be served through /public/media. */
export const PUBLIC_DOCUMENT_ENTITY_TYPES = new Set<DocumentRecord["entityType"]>([
  "CMS",
  "PROJECT",
  "BLOCK",
  "FLAT",
  "STAGE",
  "COMPANY",
]);

/** Loads live (non-deleted) documents by id in one query; missing ids are simply absent from the map. */
export async function loadDocuments(
  db: Executor,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, DocumentRecord>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(documents)
    .where(and(inArray(documents.id, unique), eq(documents.isDeleted, false)));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Public URLs for a document (variants fall back to the original when none were generated). */
export function documentUrls(doc: DocumentRecord | undefined): {
  url: string | null;
  thumb_url: string | null;
  medium_url: string | null;
  width: number | null;
  height: number | null;
} {
  if (!doc) return { url: null, thumb_url: null, medium_url: null, width: null, height: null };
  const isImage = doc.mime.startsWith("image/");
  return {
    url: mediaUrl(doc.id, isImage && doc.variants?.medium_key ? "medium" : undefined),
    thumb_url: isImage ? mediaUrl(doc.id, doc.variants?.thumb_key ? "thumb" : undefined) : null,
    medium_url: isImage ? mediaUrl(doc.id, doc.variants?.medium_key ? "medium" : undefined) : null,
    width: doc.variants?.width ?? null,
    height: doc.variants?.height ?? null,
  };
}

/** True when a document may be shown on the public website. */
export function isPublicDocument(doc: DocumentRecord | undefined): doc is DocumentRecord {
  return Boolean(doc && !doc.isDeleted && !doc.isSensitive && PUBLIC_DOCUMENT_ENTITY_TYPES.has(doc.entityType));
}

/** 400 VALIDATION_ERROR unless every referenced document exists in the company, is live and (optionally) is an image / a PDF. */
export async function assertDocuments(
  db: Executor,
  companyId: string,
  ids: readonly (string | null | undefined)[],
  kind: "image" | "pdf" | "any",
  field: string,
): Promise<Map<string, DocumentRecord>> {
  const docs = await loadDocuments(db, ids);
  for (const id of ids) {
    if (!id) continue;
    const d = docs.get(id);
    if (!d || d.companyId !== companyId)
      throw ApiError.invalid(field, `${field}: document ${id} not found`, "invalid", { document_id: id });
    if (d.isSensitive)
      throw ApiError.invalid(field, `${field}: sensitive documents cannot be published`, "invalid", {
        document_id: id,
      });
    if (kind === "image" && !d.mime.startsWith("image/"))
      throw ApiError.invalid(field, `${field}: document ${id} is not an image`, "invalid", { document_id: id });
    if (kind === "pdf" && d.mime !== "application/pdf")
      throw ApiError.invalid(field, `${field}: document ${id} is not a PDF`, "invalid", { document_id: id });
  }
  return docs;
}

/** Non-empty honeypot value → the request came from a bot; the caller answers 200 with a fake payload and creates nothing. */
export function isHoneypotTripped(body: { website?: string | null | undefined }): boolean {
  return typeof body.website === "string" && body.website.trim().length > 0;
}

/** Relaxed honeypot field: bots that fill it must receive a believable 200 instead of a 400 (SPEC §15 "silently dropped"). */
export const RelaxedHoneypotSchema = z.string().max(500).optional().nullable();

/** Rebuilds a strict public form schema with the honeypot relaxed (the contract schema itself refuses a filled honeypot). */
export function relaxHoneypot<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<Omit<T, "website"> & { website: typeof RelaxedHoneypotSchema }> {
  const { website: _w, ...rest } = schema.shape;
  return z.strictObject({ ...rest, website: RelaxedHoneypotSchema }) as unknown as z.ZodObject<
    Omit<T, "website"> & { website: typeof RelaxedHoneypotSchema }
  >;
}

/** Marks a public response as uncacheable (manage views, form replies). */
export function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

/**
 * Files the browser embeds or downloads from another origin (the website, the portal) – images via `<img>`, PDF attachments, .ics.
 * Helmet's default `Cross-Origin-Resource-Policy: same-origin` makes Chromium block such loads (ERR_BLOCKED_BY_RESPONSE), so these
 * streams opt in to cross-origin use; JSON routes keep the default and stay protected by the CORS allow-list.
 */
export function crossOriginFile(reply: FastifyReply): void {
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
}

/** Request metadata for audit rows written by public routes. */
export function publicMeta(req: FastifyRequest): { ip: string; requestId: string } {
  return { ip: req.clientIp, requestId: req.id };
}

/** User agent header, bounded. */
export function userAgent(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 300) : null;
}

/** ISO string of a Date or timestamp string. */
export function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Loads a project of the company; null when missing. */
export async function loadProjectById(
  db: Executor,
  companyId: string,
  projectId: string,
): Promise<typeof projects.$inferSelect | null> {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
    .limit(1);
  return p ?? null;
}

/** 400 VALIDATION_ERROR unless every id is a project of the company. */
export async function assertProjects(
  db: Executor,
  companyId: string,
  ids: readonly (string | null | undefined)[],
  field: string,
): Promise<void> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), inArray(projects.id, unique)));
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw ApiError.invalid(field, `${field}: project ${missing[0]} not found`, "invalid", { missing });
}
