import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { VersionSchema, type VersionConflictDetails } from "@kkt/contracts";
import { auditLogs, type Executor } from "@kkt/db";
import { ApiError } from "./errors.js";

/** A table with `id` and `version` columns (every mutable business table). */
export type VersionedTable = PgTable & { id: AnyPgColumn; version: AnyPgColumn };

/** The version a request carries: `body.version` (a number) or the `If-Match: "<n>"` / `W/"<n>"` header; null when neither is present. */
export function requestVersion(req: Pick<FastifyRequest, "headers">, body?: unknown): number | null {
  if (body && typeof body === "object" && typeof (body as { version?: unknown }).version === "number") return (body as { version: number }).version;
  const header = req.headers["if-match"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw) {
    const n = Number(raw.replace(/^W\//, "").replace(/"/g, "").trim());
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return null;
}

/** 400 VERSION_REQUIRED (a precondition-required error carried as 400 so every client handles it like a validation failure). */
export function versionRequired(): ApiError {
  return new ApiError(400, "VERSION_REQUIRED", "version is required (body.version or If-Match header)", { issues: [{ path: "version", message: "Required: send the version you read (body.version or If-Match)", code: "version_required" }] });
}

/** Reads the expected version from the body (`version`) or the `If-Match: "<n>"` header; 400 VERSION_REQUIRED when neither is present. */
export function expectedVersion(req: FastifyRequest, body?: { version?: number } | null): number {
  const v = requestVersion(req, body);
  if (v === null) throw versionRequired();
  return v;
}

/**
 * Like expectedVersion() but falls back to `current` when neither body.version nor If-Match is present. Only for state-change POST
 * actions (deactivate/restore, clear/bounce, …): the API keeps accepting them without a version, but the ERP always sends one
 * (docs/API-CONVENTIONS.md "Versions"). PATCH routes never use this: the version policy rejects a version-less PATCH first.
 */
export function optionalExpectedVersion(req: FastifyRequest, body: { version?: number } | null | undefined, current: number): number {
  return requestVersion(req, body) ?? current;
}

/**
 * Staff PATCH routes still accepted without a version while their ERP screens are rewired (docs/TODO-integration.md): the photo flag
 * toggle and the plan-assignment edit. The integration stage empties this list once the ERP sends `version` / If-Match there.
 */
export const VERSION_POLICY_EXEMPT: readonly string[] = ["/api/v1/construction/photos/:photoId", "/api/v1/payment-plan-assignments/:id"];

/** True when a route must carry a version: every staff (erp-audience) PATCH except the transitional exemptions. Portal self-service edits are exempt. */
export function requiresVersion(method: string, url: string | undefined, cfg: { audience?: string; public?: boolean } | undefined): boolean {
  if (method !== "PATCH" || !url) return false;
  if (cfg?.public || cfg?.audience === "portal") return false;
  return !VERSION_POLICY_EXEMPT.includes(url);
}

/**
 * Version policy (audit F4): a staff PATCH without `version` (body) or If-Match is 400 VERSION_REQUIRED before the handler runs, so no
 * route can fall back to last-writer-wins. Runs as a preHandler (after authentication and permission checks, after body validation).
 */
export function installVersionPolicy(app: FastifyInstance): void {
  app.addHook("preHandler", async (req) => {
    if (!requiresVersion(req.method, req.routeOptions.url, req.routeOptions.config as { audience?: string; public?: boolean })) return;
    if (requestVersion(req, req.body) === null) throw versionRequired();
  });
}

/** Throws 409 VERSION_CONFLICT when `current` differs from `expected`. */
export async function assertVersion(executor: Executor, table: VersionedTable, id: string, current: number, expected: number, entityType?: string): Promise<void> {
  if (current === expected) return;
  throw await versionConflict(executor, table, id, current, entityType);
}

/**
 * Builds the 409 with `details.current` and `details.changed_by` (from the latest audit row of the entity).
 * Pass `entityType` whenever it is known so the lookup uses the (entity_type, entity_id, created_at) index instead of scanning audit_logs.
 */
export async function versionConflict(executor: Executor, _table: VersionedTable, id: string, current: number, entityType?: string): Promise<ApiError> {
  const [last] = await executor
    .select({ actorName: auditLogs.actorName, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, id), entityType ? eq(auditLogs.entityType, entityType) : undefined))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  const details: VersionConflictDetails = { current, changed_by: last?.actorName ?? null, changed_at: last?.createdAt ? new Date(last.createdAt).toISOString() : null };
  return ApiError.conflict("VERSION_CONFLICT", `This record was changed by ${details.changed_by ?? "someone else"} (now at version ${current}). Reload and try again.`, details);
}

/**
 * `UPDATE table SET …, version = version + 1 WHERE id = $id AND version = $expected RETURNING *`.
 * 409 VERSION_CONFLICT (with the current version and who changed it) when no row matched; 404 when the row does not exist.
 */
export async function applyUpdate<T extends VersionedTable>(tx: Executor, table: T, id: string, expected: number, changes: Record<string, unknown>, entityType?: string): Promise<T["$inferSelect"]> {
  const set = { ...changes, version: sql`${table.version} + 1` } as unknown as PgUpdateSetSource<T>;
  const rows = (await tx.update(table).set(set).where(and(eq(table.id, id), eq(table.version, expected))).returning()) as T["$inferSelect"][];
  const row = rows[0];
  if (row) return row;
  const [cur] = (await tx.select({ version: table.version }).from(table as PgTable).where(eq(table.id, id)).limit(1)) as { version: number }[];
  if (!cur) throw ApiError.notFound();
  throw await versionConflict(tx, table, id, cur.version, entityType);
}

/**
 * Makes `version` optional in an update body schema so the expected version may also arrive via `If-Match` (expectedVersion() enforces
 * one of them). The schema is extended in place (`safeExtend`), never rebuilt from `.shape`, so `.refine()` / `.superRefine()` checks survive.
 */
export function withOptionalVersion<T extends z.ZodType>(schema: T): T {
  const obj = schema as unknown as { shape?: Record<string, z.ZodType>; safeExtend?: (shape: Record<string, z.ZodType>) => z.ZodType };
  if (!obj.shape || !("version" in obj.shape)) return schema;
  if (typeof obj.safeExtend === "function") return obj.safeExtend({ version: VersionSchema.optional() }) as unknown as T;
  // Zod without safeExtend: accept a missing version by pre-filling the sentinel 0 and letting the inner schema keep its refinements.
  return z.preprocess((v) => (v && typeof v === "object" && !("version" in (v as object)) ? { ...(v as object), version: undefined } : v), schema) as unknown as T;
}
