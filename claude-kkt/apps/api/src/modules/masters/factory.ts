import { and, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ActiveStateResponseSchema, IdSchema, MasterFilterSchema, UsageResponseSchema, VersionedSchema, type UsageResponse } from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import { actorFromRequest, writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { fromListQuery, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { applyUpdate, expectedVersion } from "../../lib/version.js";
import type { DbRow, MasterKindDef, WriteContext } from "./types.js";

const idParams = z.object({ id: IdSchema });

function ctxOf(app: FastifyInstance, req: FastifyRequest): WriteContext {
  const user = req.user!;
  return { app, req, user, companyId: user.companyId };
}

/** Loads a master row by id within the company; 404 when missing. */
export async function loadMasterRow(db: Executor, def: MasterKindDef, companyId: string, id: string, forUpdate = false): Promise<DbRow> {
  const q = db.select().from(def.table).where(and(eq(def.table.id, id), eq(def.table.companyId, companyId))).limit(1).$dynamic();
  const rows = (await (forUpdate ? q.for("update") : q)) as DbRow[];
  const row = rows[0];
  if (!row) throw ApiError.notFound(def.entity.replace(/_/g, " "));
  return row;
}

/** Hydrates one row through the kind's batch mapper. */
export async function viewOne(db: Executor, def: MasterKindDef, row: DbRow, companyId: string): Promise<Record<string, unknown>> {
  const [v] = await def.toRows(db, [row], companyId);
  if (!v) throw new Error("toRows returned nothing");
  return v;
}

/** Creates one master row (insert + afterWrite + audit) inside `tx`. */
export async function createMaster(tx: Executor, def: MasterKindDef, ctx: WriteContext, input: Record<string, unknown>): Promise<DbRow> {
  const values = await def.prepare(tx, input, ctx, null);
  let created: DbRow | undefined;
  try {
    const rows = (await tx.insert(def.table).values({ ...values, companyId: ctx.companyId, createdBy: ctx.user.id } as never).returning()) as DbRow[];
    created = rows[0];
  } catch (e) { translatePgError(e, `A ${def.entity.replace(/_/g, " ")} with this ${def.keyField}`); }
  if (!created) throw new Error("insert returned no row");
  if (def.afterWrite) await def.afterWrite(tx, created, input, ctx, "create");
  const view = await viewOne(tx, def, created, ctx.companyId);
  await writeAudit(tx, { companyId: ctx.companyId, actor: actorFromRequest(ctx.req), action: `${def.entity}.create`, entityType: def.entity, entityId: String(created["id"]), after: view, ip: ctx.req.clientIp, requestId: ctx.req.id });
  return created;
}

/** Updates one master row with optimistic concurrency (+ afterWrite + audit) inside `tx`. */
export async function updateMaster(tx: Executor, def: MasterKindDef, ctx: WriteContext, id: string, version: number, input: Record<string, unknown>): Promise<DbRow> {
  const existing = await loadMasterRow(tx, def, ctx.companyId, id, true);
  const before = await viewOne(tx, def, existing, ctx.companyId);
  const { version: _v, ...patch } = input;
  const values = await def.prepare(tx, patch, ctx, existing);
  let updated: DbRow;
  try { updated = (await applyUpdate(tx, def.table, id, version, values)) as DbRow; } catch (e) { translatePgError(e, `A ${def.entity.replace(/_/g, " ")} with this ${def.keyField}`); }
  if (def.afterWrite) await def.afterWrite(tx, updated, patch, ctx, "update");
  const after = await viewOne(tx, def, updated, ctx.companyId);
  await writeAudit(tx, { companyId: ctx.companyId, actor: actorFromRequest(ctx.req), action: `${def.entity}.update`, entityType: def.entity, entityId: id, before, after, ip: ctx.req.clientIp, requestId: ctx.req.id });
  return updated;
}

/** Computes the usage response for a master row. */
export async function usageOf(db: Executor, def: MasterKindDef, companyId: string, id: string): Promise<UsageResponse> {
  const used_by = (await def.usage(db, companyId, id)).filter((u) => u.count > 0);
  return { usage_count: used_by.reduce((s, u) => s + u.count, 0), used_by };
}

/** Registers the standard CRUD surface of one master kind under /masters/{path}. */
export function registerMasterKind(app: FastifyInstance, def: MasterKindDef): void {
  const base = `/masters/${def.path}`;
  const filterSchema = def.filterSchema ?? MasterFilterSchema;
  const label = def.entity.replace(/_/g, " ");

  route(app, {
    method: "GET", url: base, permission: "master.read",
    schema: { querystring: filterSchema, response: { 200: def.listSchema }, summary: `List ${def.path.replace(/-/g, " ")}`, tags: ["masters"] },
    handler: async (req, reply) => {
      const q = req.query as z.infer<typeof MasterFilterSchema> & Record<string, unknown>;
      const companyId = req.user!.companyId;
      const where: (SQL | undefined)[] = [eq(def.table.companyId, companyId)];
      if (!q.include_inactive) where.push(eq(def.table.isActive, true));
      if (def.extraWhere) where.push(def.extraWhere(q));
      const result = await paginate<DbRow>(app.dbReplica, {
        table: def.table,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: def.searchColumns, term: q.search },
        sort: { allowed: def.sortable, default: def.defaultSort, requested: q.sort },
        ...fromListQuery(q),
      });
      const items = await def.toRows(app.dbReplica, result.items, companyId);
      if (q.format === "csv") return sendCsv(reply, `${def.path}.csv`, def.csvColumns.map((k) => ({ key: k, header: k, value: (r: Record<string, unknown>) => (Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => typeof x !== "object") ? (r[k] as unknown[]).join("|") : r[k]) })), items);
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST", url: base, permission: "master.write", idempotent: true,
    schema: { body: def.createSchema, response: { 201: def.rowSchema }, summary: `Create ${label}`, tags: ["masters"] },
    handler: async (req, reply) => {
      const ctx = ctxOf(app, req);
      const view = await app.db.transaction(async (tx) => {
        const created = await createMaster(tx, def, ctx, req.body as Record<string, unknown>);
        return viewOne(tx, def, created, ctx.companyId);
      });
      return reply.code(201).send(view);
    },
  });

  route(app, {
    method: "GET", url: `${base}/:id`, permission: "master.read",
    schema: { params: idParams, response: { 200: def.rowSchema }, summary: `Get ${label}`, tags: ["masters"] },
    handler: async (req) => {
      const companyId = req.user!.companyId;
      return viewOne(app.dbReplica, def, await loadMasterRow(app.dbReplica, def, companyId, req.params.id), companyId);
    },
  });

  route(app, {
    method: "PATCH", url: `${base}/:id`, permission: "master.write",
    schema: { params: idParams, body: def.updateSchema, response: { 200: def.rowSchema }, summary: `Update ${label}`, tags: ["masters"] },
    handler: async (req) => {
      const ctx = ctxOf(app, req);
      const body = req.body as Record<string, unknown> & { version?: number };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const updated = await updateMaster(tx, def, ctx, req.params.id, version, body);
        return viewOne(tx, def, updated, ctx.companyId);
      });
    },
  });

  route(app, {
    method: "GET", url: `${base}/:id/usage`, permission: "master.read",
    schema: { params: idParams, response: { 200: UsageResponseSchema }, summary: `Where ${label} is used`, tags: ["masters"] },
    handler: async (req) => {
      const companyId = req.user!.companyId;
      await loadMasterRow(app.dbReplica, def, companyId, req.params.id);
      return usageOf(app.dbReplica, def, companyId, req.params.id);
    },
  });

  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST", url: `${base}/:id/${action}`, permission: "master.write",
      schema: { params: idParams, body: VersionedSchema.partial().optional(), response: { 200: ActiveStateResponseSchema }, summary: `${action === "deactivate" ? "Deactivate" : "Restore"} ${label}`, tags: ["masters"] },
      handler: async (req) => {
        const ctx = ctxOf(app, req);
        return app.db.transaction(async (tx) => {
          const existing = await loadMasterRow(tx, def, ctx.companyId, req.params.id, true);
          if (action === "deactivate") {
            const usage = await usageOf(tx, def, ctx.companyId, req.params.id);
            if (usage.usage_count > 0) throw ApiError.conflict("IN_USE", `This ${label} is used by ${usage.usage_count} record(s) and cannot be deactivated`, usage);
          }
          const version = req.body?.version ?? Number(existing["version"]);
          const updated = (await applyUpdate(tx, def.table, req.params.id, version, action === "deactivate" ? { isActive: false, deactivatedAt: new Date() } : { isActive: true, deactivatedAt: null })) as DbRow;
          await writeAudit(tx, { companyId: ctx.companyId, actor: actorFromRequest(req), action: `${def.entity}.${action}`, entityType: def.entity, entityId: req.params.id, before: { is_active: existing["isActive"] }, after: { is_active: updated["isActive"] }, ip: req.clientIp, requestId: req.id });
          return { id: String(updated["id"]), is_active: Boolean(updated["isActive"]), version: Number(updated["version"]) };
        });
      },
    });
  }

  if (def.extraRoutes) def.extraRoutes(app, def);
}

/** `count(*)` of rows in `table` matching `where`, as a number. */
export async function countWhere(db: Executor, table: string, where: SQL): Promise<number> {
  const rows = await db.execute<{ n: number | string }>(sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`);
  return Number(rows[0]?.n ?? 0);
}
