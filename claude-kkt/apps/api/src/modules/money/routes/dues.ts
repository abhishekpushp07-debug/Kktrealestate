/** Routes: /dues/run, /dues/integrity, /dues/integrity/repair, /dues/integrity/runs (SPEC §10 admin tools). */
import { and, eq, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { IntegrityRepairRequestSchema, IntegrityRepairResponseSchema, IntegrityReportResponseSchema, IntegrityRunFilterSchema, IntegrityRunListResponseSchema, IntegrityRunRequestSchema, RunDuesRequestSchema, RunDuesResponseSchema, type IntegrityCounts } from "@kkt/contracts";
import { integrityRuns } from "@kkt/db";
import { writeAudit } from "../../../lib/audit.js";
import { ApiError } from "../../../lib/errors.js";
import { listPaging, paginate } from "../../../lib/list.js";
import { route } from "../../../lib/routes.js";
import { ensureProjectAccess } from "../../../lib/scope.js";
import { actorOf, todayDate } from "../common.js";
import { raiseDuesForAll } from "../services/dues.js";
import { repair, runReport } from "../services/integrity.js";

const ZERO: IntegrityCounts = { UNSATISFIED_DEMAND: 0, MISSING_DEMAND: 0, DUPLICATE_DEMAND: 0, UNMAPPED_DEMAND: 0, SUMMARY_MISMATCH: 0 };

export function registerDuesRoutes(app: FastifyInstance): void {
  route(app, {
    method: "POST", url: "/dues/run", permission: "admin.tools",
    schema: { body: RunDuesRequestSchema, response: { 200: RunDuesResponseSchema }, summary: "Run the auto-dues engine now (whole company, a project, a tower or one booking; as_of for time triggers)" },
    handler: async (req) => {
      const user = req.user!;
      if (req.body.project_id) ensureProjectAccess(user, req.body.project_id);
      const startedAt = new Date();
      const today = req.body.as_of ?? todayDate();
      if (today > addDays(todayDate(), 3660)) throw ApiError.badRequest("as_of too far in the future");
      const s = await raiseDuesForAll(app.db, today, { companyId: user.companyId, bookingId: req.body.booking_id, blockId: req.body.block_id, projectId: req.body.project_id }, actorOf(req));
      await writeAudit(app.db, { companyId: user.companyId, actor: actorOf(req), action: "dues.run", entityType: "company", entityId: user.companyId, after: { as_of: today, bookings_checked: s.bookingsChecked, demands_raised: s.demandsRaised, demand_numbers: s.demandNumbers }, ip: req.clientIp, requestId: req.id });
      return { bookings_processed: s.bookingsChecked, bookings_checked: s.bookingsChecked, demands_raised: s.demandsRaised, demand_numbers: s.demandNumbers, notifications_sent: s.notifications, started_at: startedAt.toISOString(), finished_at: new Date().toISOString() };
    },
  });

  route(app, {
    method: "GET", url: "/dues/integrity", permission: "admin.tools",
    schema: { querystring: IntegrityRunRequestSchema, response: { 200: IntegrityReportResponseSchema }, summary: "Integrity report (a–e findings per booking); the run is persisted" },
    handler: async (req) => {
      const user = req.user!;
      if (req.query.project_id) ensureProjectAccess(user, req.query.project_id);
      const { report } = await runReport(app.db, { companyId: user.companyId, bookingId: req.query.booking_id, projectId: req.query.project_id }, { triggeredBy: user.id });
      return { ...report, triggered_by: user.name };
    },
  });

  route(app, {
    method: "POST", url: "/dues/integrity/repair", permission: "admin.tools",
    schema: { body: IntegrityRepairRequestSchema, response: { 200: IntegrityRepairResponseSchema }, summary: "Admin-confirmed repair: void unjustified demands without money, raise missing ones, rebuild ledgers" },
    handler: async (req) => {
      const user = req.user!;
      let bookingIds = req.body.booking_ids;
      if (req.body.run_id && !bookingIds) {
        const [run] = await app.db.select().from(integrityRuns).where(and(eq(integrityRuns.id, req.body.run_id), eq(integrityRuns.companyId, user.companyId))).limit(1);
        if (!run) throw ApiError.notFound("Integrity run");
        bookingIds = [...new Set((run.findings as { booking_id?: string }[]).map((f) => f.booking_id).filter((x): x is string => !!x))];
      }
      const result = await repair(app.db, { companyId: user.companyId }, actorOf(req), bookingIds);
      await writeAudit(app.db, { companyId: user.companyId, actor: actorOf(req), action: "integrity.repair_run", entityType: "company", entityId: user.companyId, after: { demands_voided: result.demands_voided, demands_raised: result.demands_raised, ledgers_rebuilt: result.ledgers_rebuilt, skipped_with_payments: result.skipped_with_payments }, ip: req.clientIp, requestId: req.id });
      return { ...result, report_after: { ...result.report_after, triggered_by: user.name } };
    },
  });

  route(app, {
    method: "GET", url: "/dues/integrity/runs", permission: "admin.tools",
    schema: { querystring: IntegrityRunFilterSchema, response: { 200: IntegrityRunListResponseSchema }, summary: "Stored integrity runs" },
    handler: async (req) => {
      const user = req.user!;
      const where: (SQL | undefined)[] = [eq(integrityRuns.companyId, user.companyId)];
      if (req.query.ok !== undefined) where.push(eq(integrityRuns.ok, req.query.ok));
      const result = await paginate<typeof integrityRuns.$inferSelect>(app.dbReplica, {
        table: integrityRuns, where: and(...where.filter((w): w is SQL => w !== undefined)),
        sort: { allowed: { ran_at: integrityRuns.ranAt }, default: "-ran_at", requested: req.query.sort }, ...listPaging(req.query),
      });
      return { ...result, items: result.items.map((r) => ({ id: r.id, ran_at: r.ranAt.toISOString(), triggered_by: r.triggeredBy ?? "system", ok: r.ok, counts: { ...ZERO, ...(r.counts as Partial<IntegrityCounts>) }, findings_count: (r.findings as unknown[]).length })) };
    },
  });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
