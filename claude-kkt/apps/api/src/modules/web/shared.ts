import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { companies, documents, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import type { AuditActor } from "../../lib/audit.js";
import { cached, invalidate } from "../../lib/cache.js";
import { ApiError } from "../../lib/errors.js";
import { versionConflict, type VersionedTable } from "../../lib/version.js";

/** Cache-Control for every public JSON GET (docs/API-CONVENTIONS.md Appendix B). */
export const PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
/** Cache-Control for immutable media bytes (document ids never change content). */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Redis TTL of the public read cache. */
export const PUBLIC_CACHE_SECONDS = 60;
const PUBLIC_CACHE_PREFIX = "pub:";

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

/**
 * Read-through cache for public GETs keyed by path + query (60 s). `fn` returns null for "not found", which is cached too
 * so an unpublished slug cannot be used to hammer the database.
 */
export async function publicCached<T>(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, fn: () => Promise<T | null>, notFoundEntity = "Resource"): Promise<T> {
  const key = `${PUBLIC_CACHE_PREFIX}${req.url}`;
  const env = await cached<CacheEnvelope<T>>(app.redis, key, PUBLIC_CACHE_SECONDS, async () => {
    const value = await fn();
    return value === null ? { ok: false } : { ok: true, value };
  });
  if (!env.ok) throw ApiError.notFound(notFoundEntity);
  publicHeaders(reply);
  return env.value;
}

/** Drops cached public responses (all of them, or those whose path starts with `pathPrefix`). Called after every CMS/website write. */
export async function bustPublicCache(app: FastifyInstance, pathPrefix = ""): Promise<void> {
  await invalidate(app.redis, `${PUBLIC_CACHE_PREFIX}${pathPrefix}`).catch(() => undefined);
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
export async function updateByKey<T extends PgTable & { version: AnyPgColumn }>(tx: Executor, table: T, keyColumn: AnyPgColumn, keyValue: string, expected: number, changes: Record<string, unknown>, entityType: string): Promise<T["$inferSelect"]> {
  const set = { ...changes, version: sql`${table.version} + 1` } as unknown as PgUpdateSetSource<T>;
  const rows = (await tx.update(table).set(set).where(and(eq(keyColumn, keyValue), eq(table.version, expected))).returning()) as T["$inferSelect"][];
  const row = rows[0];
  if (row) return row;
  const [cur] = (await tx.select({ version: table.version }).from(table as PgTable).where(eq(keyColumn, keyValue)).limit(1)) as { version: number }[];
  if (!cur) throw ApiError.notFound(entityType.replace(/_/g, " "));
  throw await versionConflict(tx, table as unknown as VersionedTable, keyValue, cur.version, entityType);
}

/** A document row as this module needs it. */
export type DocumentRecord = typeof documents.$inferSelect;

/** Entity types whose non-sensitive images may be served through /public/media. */
export const PUBLIC_DOCUMENT_ENTITY_TYPES = new Set<DocumentRecord["entityType"]>(["CMS", "PROJECT", "BLOCK", "FLAT", "STAGE", "COMPANY"]);

/** Loads live (non-deleted) documents by id in one query; missing ids are simply absent from the map. */
export async function loadDocuments(db: Executor, ids: readonly (string | null | undefined)[]): Promise<Map<string, DocumentRecord>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db.select().from(documents).where(and(inArray(documents.id, unique), eq(documents.isDeleted, false)));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Public URLs for a document (variants fall back to the original when none were generated). */
export function documentUrls(doc: DocumentRecord | undefined): { url: string | null; thumb_url: string | null; medium_url: string | null; width: number | null; height: number | null } {
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
export async function assertDocuments(db: Executor, companyId: string, ids: readonly (string | null | undefined)[], kind: "image" | "pdf" | "any", field: string): Promise<Map<string, DocumentRecord>> {
  const docs = await loadDocuments(db, ids);
  for (const id of ids) {
    if (!id) continue;
    const d = docs.get(id);
    if (!d || d.companyId !== companyId) throw ApiError.badRequest(`${field}: document ${id} not found`, { field, document_id: id });
    if (d.isSensitive) throw ApiError.badRequest(`${field}: sensitive documents cannot be published`, { field, document_id: id });
    if (kind === "image" && !d.mime.startsWith("image/")) throw ApiError.badRequest(`${field}: document ${id} is not an image`, { field, document_id: id });
    if (kind === "pdf" && d.mime !== "application/pdf") throw ApiError.badRequest(`${field}: document ${id} is not a PDF`, { field, document_id: id });
  }
  return docs;
}

/** Non-empty honeypot value → the request came from a bot; the caller answers 200 with a fake payload and creates nothing. */
export function isHoneypotTripped(body: { website?: string | null | undefined }): boolean {
  return typeof body.website === "string" && body.website.trim().length > 0;
}

/** Zod helper: relaxes the honeypot field so bots receive a believable 200 instead of a 400 (SPEC §15 "silently dropped"). */
export { z as zod } from "zod";
