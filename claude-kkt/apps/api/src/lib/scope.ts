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
