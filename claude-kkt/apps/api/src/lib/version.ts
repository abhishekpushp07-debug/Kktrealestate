import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { VersionSchema, type VersionConflictDetails } from "@kkt/contracts";
import { auditLogs, type Executor } from "@kkt/db";
import { ApiError } from "./errors.js";

/** A table with `id` and `version` columns (every mutable business table). */
export type VersionedTable = PgTable & { id: AnyPgColumn; version: AnyPgColumn };

/** Reads the expected version from the body (`version`) or the `If-Match: "<n>"` header; 400 when neither is present. */
export function expectedVersion(req: FastifyRequest, body?: { version?: number } | null): number {
  if (body && typeof body.version === "number") return body.version;
  const header = req.headers["if-match"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw) {
    const n = Number(raw.replace(/^W\//, "").replace(/"/g, "").trim());
    if (Number.isInteger(n) && n >= 1) return n;
  }
  throw ApiError.badRequest("version is required (body.version or If-Match header)");
}

/** Like expectedVersion() but falls back to `current` when neither body.version nor If-Match is present (deactivate/restore style actions). */
export function optionalExpectedVersion(req: FastifyRequest, body: { version?: number } | null | undefined, current: number): number {
  if (body && typeof body.version === "number") return body.version;
  const header = req.headers["if-match"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw) {
    const n = Number(raw.replace(/^W\//, "").replace(/"/g, "").trim());
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return current;
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

/** Makes `version` optional in an update body schema so the expected version may also arrive via `If-Match` (expectedVersion() enforces one of them). */
export function withOptionalVersion<T extends z.ZodType>(schema: T): T {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  if (!shape || !("version" in shape)) return schema;
  return z.strictObject({ ...shape, version: VersionSchema.optional() }) as unknown as T;
}
