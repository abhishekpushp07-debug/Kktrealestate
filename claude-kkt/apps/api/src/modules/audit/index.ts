import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AuditLogFilterSchema,
  AuditLogListResponseSchema,
  IdSchema,
  ListQuerySchema,
  LoginEventRowSchema,
  UserTypeSchema,
  listEnvelope,
  type AuditLogRow,
  type LoginEventRow,
} from "@kkt/contracts";
import { auditLogs, loginEvents } from "@kkt/db";
import { sendCsv } from "../../lib/csv.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";

type DbAudit = typeof auditLogs.$inferSelect;
type DbLogin = typeof loginEvents.$inferSelect;

function toRow(a: DbAudit): AuditLogRow {
  return {
    id: a.id,
    actor_type: a.actorType,
    actor_id: a.actorId,
    actor_name: a.actorName,
    action: a.action,
    entity_type: a.entityType,
    entity_id: a.entityId,
    before: a.before ?? null,
    after: a.after ?? null,
    ip: a.ip,
    request_id: a.requestId,
    created_at: a.createdAt.toISOString(),
  };
}

function toLogin(l: DbLogin): LoginEventRow {
  return {
    id: l.id,
    subject_type: l.subjectType,
    identifier: l.identifier,
    success: l.success,
    reason: l.reason,
    ip: l.ip,
    user_agent: l.userAgent,
    created_at: l.createdAt.toISOString(),
  };
}

const LoginEventFilterSchema = ListQuerySchema.extend({
  identifier: z.string().max(200).optional(),
  success: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional(),
  subject_type: UserTypeSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Audit module: read-only views of audit_logs and login_events (permission audit.view). */
export async function auditModule(app: FastifyInstance): Promise<void> {
  async function listAudit(companyId: string, q: z.infer<typeof AuditLogFilterSchema>, extra: SQL[] = []) {
    const where: (SQL | undefined)[] = [eq(auditLogs.companyId, companyId), ...extra];
    if (q.actor_type) where.push(eq(auditLogs.actorType, q.actor_type));
    if (q.actor_id) where.push(eq(auditLogs.actorId, q.actor_id));
    if (q.action) where.push(eq(auditLogs.action, q.action));
    if (q.entity_type) where.push(eq(auditLogs.entityType, q.entity_type));
    if (q.entity_id) where.push(eq(auditLogs.entityId, q.entity_id));
    if (q.from) where.push(gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00+05:30`)));
    if (q.to) where.push(lte(auditLogs.createdAt, new Date(`${q.to}T23:59:59.999+05:30`)));
    return paginate<DbAudit>(app.dbReplica, {
      table: auditLogs,
      where: and(...where.filter((w): w is SQL => w !== undefined)),
      search: {
        columns: [auditLogs.action, auditLogs.actorName, auditLogs.entityType, sql`${auditLogs.entityId}::text`],
        term: q.search,
      },
      sort: {
        allowed: { created_at: auditLogs.createdAt, action: auditLogs.action, entity_type: auditLogs.entityType },
        default: "-created_at",
        requested: q.sort,
      },
      ...listPaging(q),
    });
  }

  const auditCsv = [
    "created_at",
    "actor_type",
    "actor_name",
    "action",
    "entity_type",
    "entity_id",
    "ip",
    "request_id",
  ].map((k) => ({ key: k, header: k }));

  route(app, {
    method: "GET",
    url: "/audit-logs",
    permission: "audit.view",
    schema: { querystring: AuditLogFilterSchema, response: { 200: AuditLogListResponseSchema }, summary: "Audit log" },
    handler: async (req, reply) => {
      const r = await listAudit(req.user!.companyId, req.query);
      const items = r.items.map(toRow);
      if (req.query.format === "csv")
        return sendCsv(reply, "audit-logs.csv", auditCsv, items as unknown as Record<string, unknown>[]);
      return { ...r, items };
    },
  });

  route(app, {
    method: "GET",
    url: "/audit-logs/entity/:type/:id",
    permission: "audit.view",
    schema: {
      params: z.object({ type: z.string().max(60), id: IdSchema }),
      querystring: AuditLogFilterSchema,
      response: { 200: AuditLogListResponseSchema },
      summary: "History of one entity",
    },
    handler: async (req) => {
      const r = await listAudit(req.user!.companyId, req.query, [
        eq(auditLogs.entityType, req.params.type),
        eq(auditLogs.entityId, req.params.id),
      ]);
      return { ...r, items: r.items.map(toRow) };
    },
  });

  route(app, {
    method: "GET",
    url: "/audit-logs/login-events",
    permission: "audit.view",
    schema: {
      querystring: LoginEventFilterSchema,
      response: { 200: listEnvelope(LoginEventRowSchema) },
      summary: "Login attempts",
    },
    handler: async (req, reply) => {
      const q = req.query;
      const where: (SQL | undefined)[] = [
        sql`(${loginEvents.companyId} = ${req.user!.companyId} or ${loginEvents.companyId} is null)`,
      ];
      if (q.identifier) where.push(eq(loginEvents.identifier, q.identifier));
      if (q.success !== undefined) where.push(eq(loginEvents.success, q.success));
      if (q.subject_type) where.push(eq(loginEvents.subjectType, q.subject_type));
      if (q.from) where.push(gte(loginEvents.createdAt, new Date(`${q.from}T00:00:00+05:30`)));
      if (q.to) where.push(lte(loginEvents.createdAt, new Date(`${q.to}T23:59:59.999+05:30`)));
      const r = await paginate<DbLogin>(app.dbReplica, {
        table: loginEvents,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [loginEvents.identifier, loginEvents.ip, loginEvents.reason], term: q.search },
        sort: {
          allowed: { created_at: loginEvents.createdAt, identifier: loginEvents.identifier },
          default: "-created_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = r.items.map(toLogin);
      if (q.format === "csv")
        return sendCsv(
          reply,
          "login-events.csv",
          ["created_at", "subject_type", "identifier", "success", "reason", "ip", "user_agent"].map((k) => ({
            key: k,
            header: k,
          })),
          items as unknown as Record<string, unknown>[],
        );
      return { ...r, items };
    },
  });
}
