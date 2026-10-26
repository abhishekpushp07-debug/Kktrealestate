import { inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Permission } from "@kkt/contracts";
import { ApiError } from "./errors.js";

/** The authenticated staff member as attached to every staff request. */
export interface StaffContext {
  id: string;
  companyId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  isSystemRole: boolean;
  permissions: Set<string>;
  allProjects: boolean;
  projectIds: string[];
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  /** Refresh-token family id (`sid` claim). */
  sessionId: string;
}

/** The authenticated portal customer as attached to every portal request. */
export interface PortalContext {
  portalUserId: string;
  customerId: string;
  companyId: string;
  phone: string;
  name: string;
  mustChangePassword: boolean;
  sessionId: string;
}

/** Drizzle condition restricting `projectIdColumn` to the user's project scope; undefined when the user sees every project. */
export function scopeFilter(user: Pick<StaffContext, "allProjects" | "projectIds">, projectIdColumn: AnyPgColumn): SQL | undefined {
  if (user.allProjects) return undefined;
  if (user.projectIds.length === 0) return sql`false`;
  return inArray(projectIdColumn, user.projectIds);
}

/** Throws 404 (never 403) when a scoped user touches a project outside their scope, so other projects stay undiscoverable. */
export function ensureProjectAccess(user: Pick<StaffContext, "allProjects" | "projectIds">, projectId: string | null | undefined, entity = "Project"): void {
  if (user.allProjects) return;
  if (!projectId || !user.projectIds.includes(projectId)) throw ApiError.notFound(entity);
}

/** Throws 403 FORBIDDEN unless the user holds the permission code. */
export function assertPermission(user: Pick<StaffContext, "permissions">, code: Permission): void {
  if (!user.permissions.has(code)) throw ApiError.forbidden(`Missing permission ${code}`, { permission: code });
}

/** True when the user holds any of the given permission codes. */
export function hasAnyPermission(user: Pick<StaffContext, "permissions">, codes: readonly Permission[]): boolean {
  return codes.some((c) => user.permissions.has(c));
}

/** Name of the all-powerful system role (SPEC §1). */
export const SUPER_ADMIN_ROLE_NAME = "Super Admin";

/** True when the caller holds the Super Admin SYSTEM role (a custom role named "Super Admin" does not count). */
export function isSuperAdmin(user: Pick<StaffContext, "roleName" | "isSystemRole">): boolean {
  return user.roleName === SUPER_ADMIN_ROLE_NAME && user.isSystemRole;
}

/** Reasons carried in `details.reason` of the 403s that stop privilege escalation through user and role management. */
export type EscalationReason = "SELF_CHANGE" | "PERMISSION_ESCALATION" | "SCOPE_ESCALATION" | "SUPER_ADMIN_TARGET" | "TARGET_OUTRANKS_CALLER" | "SYSTEM_ROLE_SUPER_ADMIN_ONLY";

/** 403 FORBIDDEN with `details.reason` (and any extra details). */
export function escalationForbidden(reason: EscalationReason, message: string, details: Record<string, unknown> = {}): ApiError {
  return ApiError.forbidden(message, { reason, ...details });
}

/**
 * "Nobody may grant what they do not hold": throws 403 PERMISSION_ESCALATION (details.missing) when `permissions` contains a code the
 * caller does not hold. Super Admin holds everything and is never refused.
 */
export function assertCanGrant(user: Pick<StaffContext, "roleName" | "isSystemRole" | "permissions">, permissions: readonly string[], what = "this role"): void {
  if (isSuperAdmin(user)) return;
  const missing = [...new Set(permissions)].filter((p) => !user.permissions.has(p)).sort();
  if (missing.length > 0) throw escalationForbidden("PERMISSION_ESCALATION", `You cannot grant ${what}: it carries permissions you do not hold yourself`, { missing });
}
