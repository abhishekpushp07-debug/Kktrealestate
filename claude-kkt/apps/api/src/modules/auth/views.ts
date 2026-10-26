import { eq, sql } from "drizzle-orm";
import type { AuthCompany, AuthUser, Permission } from "@kkt/contracts";
import { roles, userProjectScopes, users, type Executor } from "@kkt/db";
import type { CompanyRecord } from "../../lib/company.js";
import { ApiError } from "../../lib/errors.js";

/** Builds the AuthUser wire shape (role, permissions, scopes) for a staff user id. */
export async function authUserView(db: Executor, userId: string): Promise<AuthUser> {
  const [row] = await db
    .select({
      user: users,
      roleName: roles.name,
      isSystem: roles.isSystem,
      permissions: roles.permissions,
      projectIds: sql<
        string[]
      >`coalesce((select array_agg(${userProjectScopes.projectId}) from ${userProjectScopes} where ${userProjectScopes.userId} = ${users.id}), '{}'::uuid[])`,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw ApiError.notFound("User");
  const u = row.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role_id: u.roleId,
    role_name: row.roleName,
    is_system_role: row.isSystem,
    permissions: row.permissions as Permission[],
    all_projects: u.allProjects,
    project_ids: row.projectIds ?? [],
    must_change_password: u.mustChangePassword,
    mfa_enabled: u.mfaEnabled,
    avatar_url: null,
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    version: u.version,
  };
}

/** Builds the AuthCompany wire shape from a company row. */
export function authCompanyView(c: CompanyRecord): AuthCompany {
  return {
    id: c.id,
    name: c.name,
    legal_name: c.legalName,
    logo_url: null,
    fy_start_month: c.fyStartMonth,
    settings: {
      demand_due_days: c.settings.demand_due_days,
      default_gst_percent: c.settings.default_gst_percent,
      round_robin_enabled: c.settings.round_robin_enabled,
      force_mfa_for_admins: c.settings.force_mfa_for_admins,
      booking_hold_hours: c.settings.booking_hold_hours,
    },
  };
}
