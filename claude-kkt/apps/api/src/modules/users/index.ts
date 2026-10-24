import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActiveStateResponseSchema,
  IdSchema,
  UserCreateSchema,
  UserFilterSchema,
  UserListResponseSchema,
  UserProjectScopeSchema,
  UserResetPasswordResponseSchema,
  UserResetPasswordSchema,
  UserRowSchema,
  UserUnlockSchema,
  UserUpdateSchema,
  VersionedSchema,
  type UserRow,
} from "@kkt/contracts";
import { projects, roles, userProjectScopes, users, type Executor } from "@kkt/db";
import { actorFromRequest, writeAudit } from "../../lib/audit.js";
import { bumpPermVersion } from "../../lib/cache.js";
import { sendCsv } from "../../lib/csv.js";
import { temporaryPassword } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { fromListQuery, paginate } from "../../lib/list.js";
import { hashPassword } from "../../lib/password.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { applyUpdate, expectedVersion } from "../../lib/version.js";
import { revokeAllFamilies } from "../auth/service.js";

type DbUser = typeof users.$inferSelect;
interface UserSelect { user: DbUser; roleName: string; projectIds: string[] }

const projectIdsSql = sql<string[]>`coalesce((select array_agg(${userProjectScopes.projectId}) from ${userProjectScopes} where ${userProjectScopes.userId} = ${users.id}), '{}'::uuid[])`;
const USER_SELECT = { user: users, roleName: roles.name, projectIds: projectIdsSql };

function toRow(r: UserSelect): UserRow {
  const u = r.user;
  return {
    id: u.id, company_id: u.companyId, created_at: u.createdAt.toISOString(), updated_at: u.updatedAt.toISOString(), created_by: u.createdBy, version: u.version,
    is_active: u.isActive, deactivated_at: u.deactivatedAt ? u.deactivatedAt.toISOString() : null,
    name: u.name, email: u.email, phone: u.phone, role_id: u.roleId, role_name: r.roleName, all_projects: u.allProjects, project_ids: r.projectIds ?? [],
    must_change_password: u.mustChangePassword, mfa_enabled: u.mfaEnabled, locked_until: u.lockedUntil ? u.lockedUntil.toISOString() : null,
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null, avatar_document_id: u.avatarDocumentId,
  };
}

/** Loads one user row (wire shape) scoped to the company; 404 when missing. */
export async function getUserRow(db: Executor, companyId: string, id: string): Promise<UserRow> {
  const [r] = await db.select(USER_SELECT).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
  if (!r) throw ApiError.notFound("User");
  return toRow(r);
}

async function assertRole(tx: Executor, companyId: string, roleId: string): Promise<void> {
  const [r] = await tx.select({ id: roles.id, isActive: roles.isActive }).from(roles).where(and(eq(roles.id, roleId), eq(roles.companyId, companyId))).limit(1);
  if (!r) throw ApiError.badRequest("role_id does not exist", { field: "role_id" });
  if (!r.isActive) throw ApiError.rule("Role is inactive", "ROLE_INACTIVE");
}

async function assertProjects(tx: Executor, companyId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, ids)));
  if (found.length !== new Set(ids).size) throw ApiError.badRequest("One or more project_ids do not exist", { field: "project_ids" });
}

async function replaceScopes(tx: Executor, userId: string, allProjects: boolean, projectIds: string[]): Promise<void> {
  await tx.delete(userProjectScopes).where(eq(userProjectScopes.userId, userId));
  if (!allProjects && projectIds.length > 0) await tx.insert(userProjectScopes).values([...new Set(projectIds)].map((projectId) => ({ userId, projectId })));
}

function meta(req: FastifyRequest) {
  return { actor: actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

/** Users module: CRUD, deactivate/activate, reset-password, unlock, project scopes (permission users.manage). */
export async function usersModule(app: FastifyInstance): Promise<void> {
  route(app, {
    method: "GET", url: "/users", permission: "users.manage",
    schema: { querystring: UserFilterSchema, response: { 200: UserListResponseSchema }, summary: "List staff users" },
    handler: async (req, reply) => {
      const q = req.query;
      const companyId = req.user!.companyId;
      const where: (SQL | undefined)[] = [eq(users.companyId, companyId)];
      if (!q.include_inactive) where.push(eq(users.isActive, true));
      if (q.role_id) where.push(eq(users.roleId, q.role_id));
      if (q.project_id) where.push(sql`exists (select 1 from ${userProjectScopes} where ${userProjectScopes.userId} = ${users.id} and ${userProjectScopes.projectId} = ${q.project_id})`);
      if (q.is_locked === true) where.push(gt(users.lockedUntil, new Date()));
      if (q.is_locked === false) where.push(sql`(${users.lockedUntil} is null or ${users.lockedUntil} <= now())`);
      const result = await paginate<UserSelect>(app.db, {
        table: users,
        select: USER_SELECT,
        join: (qb) => qb.innerJoin(roles, eq(roles.id, users.roleId)),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [users.name, users.email, users.phone], term: q.search },
        sort: { allowed: { name: users.name, email: users.email, created_at: users.createdAt, last_login_at: users.lastLoginAt, role_name: roles.name }, default: "name", requested: q.sort },
        ...fromListQuery(q),
      });
      const items = result.items.map(toRow);
      if (q.format === "csv") {
        return sendCsv(reply, "users.csv", ["name", "email", "phone", "role_name", "all_projects", "is_active", "mfa_enabled", "last_login_at"].map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      }
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST", url: "/users", permission: "users.manage", idempotent: true,
    schema: { body: UserCreateSchema, response: { 201: UserRowSchema.extend({ temp_password: z.string().optional() }) }, summary: "Create a staff user" },
    handler: async (req, reply) => {
      const ctx = req.user!;
      const body = req.body;
      const plain = body.password ?? temporaryPassword();
      const hash = await hashPassword(plain);
      const row = await app.db.transaction(async (tx) => {
        await assertRole(tx, ctx.companyId, body.role_id);
        await assertProjects(tx, ctx.companyId, body.project_ids);
        let created: DbUser | undefined;
        try {
          [created] = await tx.insert(users).values({
            companyId: ctx.companyId, name: body.name, email: body.email, phone: body.phone ?? null, passwordHash: hash, roleId: body.role_id,
            allProjects: body.all_projects, mustChangePassword: body.must_change_password, createdBy: ctx.id,
          }).returning();
        } catch (e) { translatePgError(e, "A user with this email"); }
        if (!created) throw new Error("insert returned no row");
        await replaceScopes(tx, created.id, body.all_projects, body.project_ids);
        const view = await getUserRow(tx, ctx.companyId, created.id);
        await writeAudit(tx, { companyId: ctx.companyId, ...meta(req), action: "user.create", entityType: "user", entityId: created.id, after: view as unknown as Record<string, unknown> });
        return view;
      });
      await bumpPermVersion(app.redis);
      return reply.code(201).send({ ...row, ...(body.password ? {} : { temp_password: plain }) });
    },
  });

  route(app, {
    method: "GET", url: "/users/:id", permission: "users.manage",
    schema: { params: z.object({ id: IdSchema }), response: { 200: UserRowSchema }, summary: "Get a staff user" },
    handler: async (req) => getUserRow(app.db, req.user!.companyId, req.params.id),
  });

  route(app, {
    method: "PATCH", url: "/users/:id", permission: "users.manage",
    schema: { params: z.object({ id: IdSchema }), body: UserUpdateSchema, response: { 200: UserRowSchema }, summary: "Update a staff user" },
    handler: async (req) => {
      const ctx = req.user!;
      const body = req.body;
      const version = expectedVersion(req, body);
      const row = await app.db.transaction(async (tx) => {
        const before = await getUserRow(tx, ctx.companyId, req.params.id);
        if (body.role_id) await assertRole(tx, ctx.companyId, body.role_id);
        if (body.project_ids) await assertProjects(tx, ctx.companyId, body.project_ids);
        const changes: Record<string, unknown> = {};
        if (body.name !== undefined) changes["name"] = body.name;
        if (body.email !== undefined) changes["email"] = body.email;
        if (body.phone !== undefined) changes["phone"] = body.phone;
        if (body.role_id !== undefined) changes["roleId"] = body.role_id;
        if (body.all_projects !== undefined) changes["allProjects"] = body.all_projects;
        if (body.must_change_password !== undefined) changes["mustChangePassword"] = body.must_change_password;
        try { await applyUpdate(tx, users, req.params.id, version, changes); } catch (e) { translatePgError(e, "A user with this email"); }
        const allProjects = body.all_projects ?? before.all_projects;
        if (body.all_projects !== undefined || body.project_ids !== undefined) {
          const ids = body.project_ids ?? before.project_ids;
          if (!allProjects && ids.length === 0) throw ApiError.badRequest("Pick at least one project for a scoped user", { field: "project_ids" });
          await replaceScopes(tx, req.params.id, allProjects, ids);
        }
        const after = await getUserRow(tx, ctx.companyId, req.params.id);
        await writeAudit(tx, { companyId: ctx.companyId, ...meta(req), action: "user.update", entityType: "user", entityId: req.params.id, before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> });
        return after;
      });
      await bumpPermVersion(app.redis);
      return row;
    },
  });

  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST", url: `/users/:id/${action}`, permission: "users.manage",
      schema: { params: z.object({ id: IdSchema }), body: VersionedSchema.partial().optional(), response: { 200: ActiveStateResponseSchema }, summary: `${action === "deactivate" ? "Deactivate" : "Reactivate"} a staff user` },
      handler: async (req) => {
        const ctx = req.user!;
        const result = await app.db.transaction(async (tx) => {
          const before = await getUserRow(tx, ctx.companyId, req.params.id);
          if (action === "deactivate" && before.id === ctx.id) throw ApiError.rule("You cannot deactivate your own account", "SELF_DEACTIVATE");
          const version = req.body?.version ?? before.version;
          const updated = await applyUpdate(tx, users, req.params.id, version, action === "deactivate" ? { isActive: false, deactivatedAt: new Date() } : { isActive: true, deactivatedAt: null });
          if (action === "deactivate") await revokeAllFamilies(tx, app.redis, "STAFF", req.params.id, "USER_DEACTIVATED");
          await writeAudit(tx, { companyId: ctx.companyId, ...meta(req), action: `user.${action}`, entityType: "user", entityId: req.params.id, before: { is_active: before.is_active }, after: { is_active: updated.isActive } });
          return { id: updated.id, is_active: updated.isActive, version: updated.version };
        });
        await bumpPermVersion(app.redis);
        return result;
      },
    });
  }

  route(app, {
    method: "POST", url: "/users/:id/reset-password", permission: "users.manage",
    schema: { params: z.object({ id: IdSchema }), body: UserResetPasswordSchema, response: { 200: UserResetPasswordResponseSchema }, summary: "Reset a user's password (temporary password shown once)" },
    handler: async (req) => {
      const ctx = req.user!;
      const plain = req.body.new_password ?? temporaryPassword();
      const hash = await hashPassword(plain);
      const result = await app.db.transaction(async (tx) => {
        await getUserRow(tx, ctx.companyId, req.params.id);
        const updated = await applyUpdate(tx, users, req.params.id, req.body.version, { passwordHash: hash, mustChangePassword: req.body.must_change_password, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null });
        await revokeAllFamilies(tx, app.redis, "STAFF", req.params.id, "PASSWORD_RESET");
        await writeAudit(tx, { companyId: ctx.companyId, ...meta(req), action: "user.reset_password", entityType: "user", entityId: req.params.id, after: { must_change_password: req.body.must_change_password } });
        return { id: updated.id, version: updated.version };
      });
      await bumpPermVersion(app.redis);
      return { ...result, ...(req.body.new_password ? {} : { temp_password: plain }) };
    },
  });

  route(app, {
    method: "POST", url: "/users/:id/unlock", permission: "users.manage",
    schema: { params: z.object({ id: IdSchema }), body: UserUnlockSchema, response: { 200: UserRowSchema }, summary: "Clear a lockout" },
    handler: async (req) => {
      const ctx = req.user!;
      return app.db.transaction(async (tx) => {
        await getUserRow(tx, ctx.companyId, req.params.id);
        await applyUpdate(tx, users, req.params.id, req.body.version, { failedAttempts: 0, lockedUntil: null });
        await writeAudit(tx, { companyId: ctx.companyId, ...meta(req), action: "user.unlock", entityType: "user", entityId: req.params.id });
        return getUserRow(tx, ctx.companyId, req.params.id);
      });
    },
  });

  route(app, {
    method: "PUT", url: "/users/:id/scope", permission: "users.manage",
    schema: { params: z.object({ id: IdSchema }), body: UserProjectScopeSchema, response: { 200: UserRowSchema }, summary: "Set a user's project scope" },
    handler: async (req) => {
      const ctx = req.user!;
      if (!req.body.all_projects && req.body.project_ids.length === 0) throw ApiError.badRequest("Pick at least one project for a scoped user", { field: "project_ids" });
      const row = await app.db.transaction(async (tx) => {
        const before = await getUserRow(tx, ctx.companyId, req.params.id);
        await assertProjects(tx, ctx.companyId, req.body.project_ids);
        await applyUpdate(tx, users, req.params.id, req.body.version, { allProjects: req.body.all_projects });
        await replaceScopes(tx, req.params.id, req.body.all_projects, req.body.project_ids);
        const after = await getUserRow(tx, ctx.companyId, req.params.id);
        await writeAudit(tx, { companyId: ctx.companyId, ...meta(req), action: "user.scope", entityType: "user", entityId: req.params.id, before: { all_projects: before.all_projects, project_ids: before.project_ids }, after: { all_projects: after.all_projects, project_ids: after.project_ids } });
        return after;
      });
      await bumpPermVersion(app.redis);
      return row;
    },
  });
}
