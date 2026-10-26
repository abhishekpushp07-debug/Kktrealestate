import { and, count, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActiveStateResponseSchema,
  ALL_PERMISSIONS,
  IdSchema,
  PERMISSION_GROUPS,
  PermissionCatalogResponseSchema,
  RoleCreateSchema,
  RoleFilterSchema,
  RoleListResponseSchema,
  RoleRowSchema,
  RoleUpdateSchema,
  VersionedSchema,
  type RoleRow,
} from "@kkt/contracts";
import { roles, users, type Executor } from "@kkt/db";
import { actorFromRequest, writeAudit } from "../../lib/audit.js";
import { bumpPermVersion } from "../../lib/cache.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { applyUpdate, expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import { assertCanGrant, escalationForbidden, isSuperAdmin } from "../../lib/scope.js";

type DbRole = typeof roles.$inferSelect;
interface RoleSelect {
  role: DbRole;
  userCount: number;
}

const userCountSql = sql<number>`(select count(*)::int from ${users} where ${users.roleId} = ${roles.id} and ${users.isActive})`;
const ROLE_SELECT = { role: roles, userCount: userCountSql };

function toRow(r: RoleSelect): RoleRow {
  const x = r.role;
  return {
    id: x.id,
    company_id: x.companyId,
    created_at: x.createdAt.toISOString(),
    updated_at: x.updatedAt.toISOString(),
    created_by: x.createdBy,
    version: x.version,
    is_active: x.isActive,
    deactivated_at: x.deactivatedAt ? x.deactivatedAt.toISOString() : null,
    name: x.name,
    description: x.description,
    permissions: x.permissions,
    is_system: x.isSystem,
    user_count: Number(r.userCount),
  };
}

/** Loads one role (wire shape) scoped to the company; 404 when missing. */
export async function getRoleRow(db: Executor, companyId: string, id: string): Promise<RoleRow> {
  const [r] = await db
    .select(ROLE_SELECT)
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.companyId, companyId)))
    .limit(1);
  if (!r) throw ApiError.notFound("Role");
  return toRow(r);
}

/** `dashboard.view` gates sign-in self-service (me, logout, change-password, sessions); a role without it could never use the ERP. */
const REQUIRED_PERMISSION = "dashboard.view";

function assertKnownPermissions(codes: readonly string[]): void {
  const unknown = codes.filter((c) => !(ALL_PERMISSIONS as readonly string[]).includes(c));
  if (unknown.length > 0) throw ApiError.badRequest("Unknown permission codes", { field: "permissions", unknown });
  if (codes.length === 0) throw ApiError.badRequest("Pick at least one permission", { field: "permissions" });
  if (!codes.includes(REQUIRED_PERMISSION))
    throw ApiError.badRequest(`Every role must include ${REQUIRED_PERMISSION} (it gates sign-in and self-service)`, {
      field: "permissions",
      required: REQUIRED_PERMISSION,
    });
}

function meta(req: FastifyRequest) {
  return { actor: actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

/** Roles module: custom roles as permission bundles; system roles immutable; permission catalog. */
export async function rolesModule(app: FastifyInstance): Promise<void> {
  const catalog = {
    groups: PERMISSION_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      permissions: g.permissions.map((p) => ({ code: p.code, label: p.label })),
    })),
  };
  for (const url of ["/roles/permissions", "/permissions"]) {
    route(app, {
      method: "GET",
      url,
      permission: "roles.manage",
      schema: { response: { 200: PermissionCatalogResponseSchema }, summary: "Permission catalog", tags: ["roles"] },
      handler: async () => catalog,
    });
  }

  route(app, {
    method: "GET",
    url: "/roles",
    permission: "roles.manage",
    schema: { querystring: RoleFilterSchema, response: { 200: RoleListResponseSchema }, summary: "List roles" },
    handler: async (req, reply) => {
      const q = req.query;
      const where: (SQL | undefined)[] = [eq(roles.companyId, req.user!.companyId)];
      if (!q.include_inactive) where.push(eq(roles.isActive, true));
      if (q.is_system !== undefined) where.push(eq(roles.isSystem, q.is_system));
      const result = await paginate<RoleSelect>(app.db, {
        table: roles,
        select: ROLE_SELECT,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [roles.name, roles.description], term: q.search },
        sort: {
          allowed: { name: roles.name, created_at: roles.createdAt, is_system: roles.isSystem },
          default: "name",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = result.items.map(toRow);
      if (q.format === "csv")
        return sendCsv(
          reply,
          "roles.csv",
          ["name", "description", "is_system", "is_active", "user_count", "permissions"].map((k) => ({
            key: k,
            header: k,
            value: (r: Record<string, unknown>) => (Array.isArray(r[k]) ? (r[k] as string[]).join("|") : r[k]),
          })),
          items as unknown as Record<string, unknown>[],
        );
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: "/roles",
    permission: "roles.manage",
    idempotent: true,
    schema: { body: RoleCreateSchema, response: { 201: RoleRowSchema }, summary: "Create a custom role" },
    handler: async (req, reply) => {
      const ctx = req.user!;
      assertKnownPermissions(req.body.permissions);
      assertCanGrant(ctx, req.body.permissions, "a role with these permissions");
      const row = await app.db.transaction(async (tx) => {
        let created: DbRole | undefined;
        try {
          [created] = await tx
            .insert(roles)
            .values({
              companyId: ctx.companyId,
              name: req.body.name,
              description: req.body.description ?? null,
              permissions: [...req.body.permissions],
              isSystem: false,
              createdBy: ctx.id,
            })
            .returning();
        } catch (e) {
          translatePgError(e, "A role with this name");
        }
        if (!created) throw new Error("insert returned no row");
        const view = await getRoleRow(tx, ctx.companyId, created.id);
        await writeAudit(tx, {
          companyId: ctx.companyId,
          ...meta(req),
          action: "role.create",
          entityType: "role",
          entityId: created.id,
          after: view as unknown as Record<string, unknown>,
        });
        return view;
      });
      await bumpPermVersion(app.redis);
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "GET",
    url: "/roles/:id",
    permission: "roles.manage",
    schema: { params: z.object({ id: IdSchema }), response: { 200: RoleRowSchema }, summary: "Get a role" },
    handler: async (req) => getRoleRow(app.db, req.user!.companyId, req.params.id),
  });

  route(app, {
    method: "PATCH",
    url: "/roles/:id",
    permission: "roles.manage",
    schema: {
      params: z.object({ id: IdSchema }),
      body: withOptionalVersion(RoleUpdateSchema),
      response: { 200: RoleRowSchema },
      summary: "Update a role (system roles: description only)",
    },
    handler: async (req) => {
      const ctx = req.user!;
      const body = req.body;
      const version = expectedVersion(req, body);
      const row = await app.db.transaction(async (tx) => {
        const before = await getRoleRow(tx, ctx.companyId, req.params.id);
        if (before.is_system && !isSuperAdmin(ctx))
          throw escalationForbidden("SYSTEM_ROLE_SUPER_ADMIN_ONLY", "Only a Super Admin can edit a system role");
        if (before.is_system && (body.name !== undefined || body.permissions !== undefined))
          throw ApiError.conflict("SYSTEM_ROLE", "System roles cannot be renamed or have their permissions changed");
        if (body.permissions) assertKnownPermissions(body.permissions);
        // The role as it will stand after the edit may only carry permissions the editor holds.
        if (!before.is_system) assertCanGrant(ctx, body.permissions ?? before.permissions, "this role");
        const changes: Record<string, unknown> = {};
        if (body.name !== undefined) changes["name"] = body.name;
        if (body.description !== undefined) changes["description"] = body.description;
        if (body.permissions !== undefined) changes["permissions"] = [...body.permissions];
        try {
          await applyUpdate(tx, roles, req.params.id, version, changes, "role");
        } catch (e) {
          translatePgError(e, "A role with this name");
        }
        const after = await getRoleRow(tx, ctx.companyId, req.params.id);
        await writeAudit(tx, {
          companyId: ctx.companyId,
          ...meta(req),
          action: "role.update",
          entityType: "role",
          entityId: req.params.id,
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      });
      await bumpPermVersion(app.redis);
      return row;
    },
  });

  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST",
      url: `/roles/:id/${action}`,
      permission: "roles.manage",
      schema: {
        params: z.object({ id: IdSchema }),
        body: VersionedSchema.partial().optional(),
        response: { 200: ActiveStateResponseSchema },
        summary: `${action === "deactivate" ? "Deactivate" : "Reactivate"} a role`,
      },
      handler: async (req) => {
        const ctx = req.user!;
        const result = await app.db.transaction(async (tx) => {
          const before = await getRoleRow(tx, ctx.companyId, req.params.id);
          if (action === "activate") assertCanGrant(ctx, before.permissions, "this role");
          if (action === "deactivate") {
            if (before.is_system) throw ApiError.conflict("SYSTEM_ROLE", "System roles cannot be deactivated");
            const [c] = await tx.select({ n: count() }).from(users).where(eq(users.roleId, req.params.id));
            const n = Number(c?.n ?? 0);
            if (n > 0)
              throw ApiError.conflict("IN_USE", `Role is assigned to ${n} user(s)`, {
                usage_count: n,
                used_by: [{ entity_type: "users", count: n }],
              });
          }
          const updated = await applyUpdate(
            tx,
            roles,
            req.params.id,
            optionalExpectedVersion(req, req.body, before.version),
            action === "deactivate"
              ? { isActive: false, deactivatedAt: new Date() }
              : { isActive: true, deactivatedAt: null },
            "role",
          );
          await writeAudit(tx, {
            companyId: ctx.companyId,
            ...meta(req),
            action: `role.${action}`,
            entityType: "role",
            entityId: req.params.id,
            before: { is_active: before.is_active },
            after: { is_active: updated.isActive },
          });
          return { id: updated.id, is_active: updated.isActive, version: updated.version };
        });
        await bumpPermVersion(app.redis);
        return result;
      },
    });
  }
}
