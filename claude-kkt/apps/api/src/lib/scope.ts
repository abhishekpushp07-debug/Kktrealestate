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
export function scopeFilter(
  user: Pick<StaffContext, "allProjects" | "projectIds">,
  projectIdColumn: AnyPgColumn,
): SQL | undefined {
  if (user.allProjects) return undefined;
  if (user.projectIds.length === 0) return sql`false`;
  return inArray(projectIdColumn, user.projectIds);
}

/**
 * Project scope of CUSTOMERS (SPEC §1: scoped users must not learn other projects exist). A project-scoped user sees a customer who is
 * linked to one of their projects — primary applicant or co-applicant on a booking there, the customer of a lead for it, or of a site
 * visit to it — or whom they created themselves and who is not linked to any project yet (a fresh record on its way to a booking).
 * `customerId` is the SQL of the customer id being tested (a column of the outer query, or a parameter); undefined for all-project users.
 * The inner tables are aliased, so an unqualified outer column can never bind to them.
 */
export function customerScopeCondition(
  user: Pick<StaffContext, "id" | "allProjects" | "projectIds">,
  customerId: SQL = sql.raw(`"customers"."id"`),
): SQL | undefined {
  if (user.allProjects) return undefined;
  const ownUnlinked = sql`exists (select 1 from customers sc where sc.id = ${customerId} and sc.created_by = ${user.id}
      and not exists (select 1 from bookings xb where xb.customer_id = ${customerId})
      and not exists (select 1 from booking_co_applicants xbc where xbc.customer_id = ${customerId})
      and not exists (select 1 from leads xl where xl.customer_id = ${customerId} and xl.project_id is not null)
      and not exists (select 1 from site_visits xv where xv.customer_id = ${customerId}))`;
  if (user.projectIds.length === 0) return ownUnlinked;
  const ids = sql.join(
    user.projectIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return sql`(exists (select 1 from bookings sb where sb.project_id in (${ids}) and (sb.customer_id = ${customerId}
        or exists (select 1 from booking_co_applicants sbc where sbc.booking_id = sb.id and sbc.customer_id = ${customerId})))
    or exists (select 1 from leads sl where sl.customer_id = ${customerId} and sl.project_id in (${ids}))
    or exists (select 1 from site_visits sv where sv.customer_id = ${customerId} and sv.project_id in (${ids}))
    or ${ownUnlinked})`;
}

/** Throws 404 (never 403) when a scoped user touches a project outside their scope, so other projects stay undiscoverable. */
export function ensureProjectAccess(
  user: Pick<StaffContext, "allProjects" | "projectIds">,
  projectId: string | null | undefined,
  entity = "Project",
): void {
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

/** Permissions that make a role an administrator for the MFA rule (settings, users, roles, admin tools). */
export const MFA_ADMIN_PERMISSIONS: readonly Permission[] = [
  "settings.manage",
  "users.manage",
  "roles.manage",
  "admin.tools",
];

/**
 * True when `force_mfa_for_admins` applies to this user: the role holds any of MFA_ADMIN_PERMISSIONS, or it is the Super Admin system
 * role. Decided by what the role can do, never by its name, so a renamed or custom all-powerful role cannot escape MFA.
 */
export function requiresAdminMfa(user: Pick<StaffContext, "permissions" | "roleName" | "isSystemRole">): boolean {
  return isSuperAdmin(user) || MFA_ADMIN_PERMISSIONS.some((p) => user.permissions.has(p));
}

/** Reasons carried in `details.reason` of the 403s that stop privilege escalation through user and role management. */
export type EscalationReason =
  | "SELF_CHANGE"
  | "PERMISSION_ESCALATION"
  | "SCOPE_ESCALATION"
  | "SUPER_ADMIN_TARGET"
  | "TARGET_OUTRANKS_CALLER"
  | "SYSTEM_ROLE_SUPER_ADMIN_ONLY";

/** 403 FORBIDDEN with `details.reason` (and any extra details). */
export function escalationForbidden(
  reason: EscalationReason,
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return ApiError.forbidden(message, { reason, ...details });
}

/**
 * "Nobody may grant what they do not hold": throws 403 PERMISSION_ESCALATION (details.missing) when `permissions` contains a code the
 * caller does not hold. Super Admin holds everything and is never refused.
 */
export function assertCanGrant(
  user: Pick<StaffContext, "roleName" | "isSystemRole" | "permissions">,
  permissions: readonly string[],
  what = "this role",
): void {
  if (isSuperAdmin(user)) return;
  const missing = [...new Set(permissions)].filter((p) => !user.permissions.has(p)).sort();
  if (missing.length > 0)
    throw escalationForbidden(
      "PERMISSION_ESCALATION",
      `You cannot grant ${what}: it carries permissions you do not hold yourself`,
      { missing },
    );
}
