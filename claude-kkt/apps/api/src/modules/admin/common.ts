import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorFromRequest, auditMeta, type AuditActor } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import type { StaffContext } from "../../lib/scope.js";

/** The only role allowed to export backups, reseed or erase customers (SPEC §1/§2: "Super Admin: … backups, integrity tools"). */
export const SUPER_ADMIN_ROLE = "Super Admin";

/** Throws 403 SUPER_ADMIN_ONLY unless the caller holds the Super Admin system role (admin.tools alone is not enough). */
export function requireSuperAdmin(user: Pick<StaffContext, "roleName" | "isSystemRole">): void {
  if (user.roleName === SUPER_ADMIN_ROLE && user.isSystemRole) return;
  throw new ApiError(403, "SUPER_ADMIN_ONLY", "Only the Super Admin role may perform this action");
}

/** Actor + request metadata for audit rows written by admin tools. */
export interface AdminMeta {
  actor: AuditActor;
  ip: string | null;
  requestId: string | null;
}

/** Builds the audit metadata of a staff request. */
export function adminMeta(req: FastifyRequest): AdminMeta {
  const m = auditMeta(req);
  return { actor: actorFromRequest(req), ip: m.ip, requestId: m.requestId };
}

/** Staff context of an authenticated admin route (the auth plugin guarantees it). */
export function staff(req: FastifyRequest): StaffContext {
  const u = req.user;
  if (!u) throw ApiError.unauthenticated();
  return u;
}

/** ISO string or null. */
export function iso(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** `:id` path parameter (uuid). */
export const idParams = z.object({ id: z.uuid() });
