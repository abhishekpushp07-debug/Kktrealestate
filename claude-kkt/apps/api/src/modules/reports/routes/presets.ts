/** Routes: saved report presets per user (SPEC §14 "saved presets"). */
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdSchema, ReportPresetCreateSchema, ReportPresetFilterSchema, ReportPresetListResponseSchema, ReportPresetRowSchema, type ReportPresetRow } from "@kkt/contracts";
import { reportPresets } from "@kkt/db";
import { actorFromRequest, auditMeta, writeAudit } from "../../../lib/audit.js";
import { ApiError } from "../../../lib/errors.js";
import { route } from "../../../lib/routes.js";
import { REPORT_CATALOG } from "./reports.js";

type PresetRecord = typeof reportPresets.$inferSelect;

/** Preset params are the report's own query parameters: anything else is rejected the way the report route itself would (400). */
function assertPresetParams(reportKey: string, params: Record<string, unknown>): void {
  const entry = REPORT_CATALOG.find((r) => r.key === reportKey);
  const allowed = [...(entry?.params ?? []), "format", "export"];
  const unknown = Object.keys(params).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw ApiError.badRequest(`Unknown parameters for ${reportKey}: ${unknown.join(", ")}`, { unknown, allowed });
}

function toRow(p: PresetRecord): ReportPresetRow {
  return { id: p.id, user_id: p.userId, report_key: p.reportKey as ReportPresetRow["report_key"], name: p.name, params: p.params, created_at: p.createdAt.toISOString() };
}

export function registerPresetRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/reports/presets", permission: "report.view",
    schema: { querystring: ReportPresetFilterSchema, response: { 200: ReportPresetListResponseSchema }, summary: "The caller's saved report presets" },
    handler: async (req) => {
      const user = req.user!;
      const rows = await app.dbReplica.select().from(reportPresets)
        .where(and(eq(reportPresets.companyId, user.companyId), eq(reportPresets.userId, user.id), req.query.report_key ? eq(reportPresets.reportKey, req.query.report_key) : undefined))
        .orderBy(asc(reportPresets.reportKey), asc(reportPresets.name));
      return { items: rows.map(toRow) };
    },
  });

  route(app, {
    method: "POST", url: "/reports/presets", permission: "report.view", idempotent: true,
    schema: { body: ReportPresetCreateSchema, response: { 201: ReportPresetRowSchema }, summary: "Save a report preset (per user; same name replaces nothing – names are unique per report)" },
    handler: async (req, reply) => {
      const user = req.user!;
      assertPresetParams(req.body.report_key, req.body.params);
      const row = await app.db.transaction(async (tx) => {
        const [dup] = await tx.select({ id: reportPresets.id }).from(reportPresets)
          .where(and(eq(reportPresets.userId, user.id), eq(reportPresets.reportKey, req.body.report_key), eq(reportPresets.name, req.body.name))).limit(1);
        if (dup) throw ApiError.conflict("DUPLICATE_PRESET", `You already have a "${req.body.name}" preset for this report`, { preset_id: dup.id });
        const [inserted] = await tx.insert(reportPresets).values({ companyId: user.companyId, userId: user.id, reportKey: req.body.report_key, name: req.body.name, params: req.body.params as Record<string, unknown>, createdBy: user.id }).returning();
        if (!inserted) throw new Error("preset insert returned no row");
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: "report_preset.create", entityType: "report_preset", entityId: inserted.id, after: { report_key: inserted.reportKey, name: inserted.name, params: inserted.params }, ...auditMeta(req) });
        return inserted;
      });
      return reply.code(201).send(toRow(row));
    },
  });

  route(app, {
    method: "DELETE", url: "/reports/presets/:id", permission: "report.view",
    schema: { params: z.object({ id: IdSchema }), response: { 204: z.null() }, summary: "Delete one of the caller's presets" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(reportPresets).where(and(eq(reportPresets.id, req.params.id), eq(reportPresets.userId, user.id), eq(reportPresets.companyId, user.companyId))).limit(1);
        if (!existing) throw ApiError.notFound("Preset");
        await tx.delete(reportPresets).where(eq(reportPresets.id, existing.id));
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: "report_preset.delete", entityType: "report_preset", entityId: existing.id, before: { report_key: existing.reportKey, name: existing.name, params: existing.params }, ...auditMeta(req) });
      });
      return reply.code(204).send();
    },
  });
}
