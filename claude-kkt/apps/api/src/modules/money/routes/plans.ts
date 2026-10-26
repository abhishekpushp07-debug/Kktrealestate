/** Routes: /payment-plan-assignments (CRUD), /blocks/:id/applicable-plans, /bookings/preview-schedule (SPEC §8). */
import { and, eq, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ApplicablePlansBlockQuerySchema,
  ApplicablePlansResponseSchema,
  IdSchema,
  PlanAssignmentCreateSchema,
  PlanAssignmentFilterSchema,
  PlanAssignmentListResponseSchema,
  PlanAssignmentRowSchema,
  PlanAssignmentUpdateSchema,
  SchedulePreviewRequestSchema,
  SchedulePreviewResponseSchema,
  type PlanAssignmentRow,
} from "@kkt/contracts";
import { blocks, paymentPlanAssignments, paymentPlans, projects, type Executor } from "@kkt/db";
import { writeAudit } from "../../../lib/audit.js";
import { ApiError } from "../../../lib/errors.js";
import { listPaging, paginate } from "../../../lib/list.js";
import { translatePgError } from "../../../lib/pgErrors.js";
import { route } from "../../../lib/routes.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../../lib/scope.js";
import { applyUpdate, expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../../lib/version.js";
import { actorOf, loadCompanyRow } from "../common.js";
import {
  applicablePlanRows,
  assertPlanFitsScope,
  clearOtherDefaults,
  loadPlan,
  previewSchedule,
  scopeNames,
  type AssignmentRecord,
  type PlanRecord,
} from "../services/plans.js";

interface AssignmentSelect {
  a: AssignmentRecord;
  plan: PlanRecord;
}
const idParams = z.object({ id: IdSchema });

async function toRows(db: Executor, rows: readonly AssignmentSelect[]): Promise<PlanAssignmentRow[]> {
  const names = await scopeNames(
    db,
    rows.map((r) => r.a.projectId),
    rows.map((r) => r.a.blockId).filter((x): x is string => !!x),
  );
  return rows.map(({ a, plan }) => ({
    id: a.id,
    plan_id: a.planId,
    plan_name: plan.name,
    plan_code: plan.code,
    plan_type: plan.planType,
    project_id: a.projectId,
    project_name: names.projects.get(a.projectId) ?? "",
    block_id: a.blockId,
    block_name: a.blockId ? (names.blocks.get(a.blockId) ?? null) : null,
    is_default: a.isDefault,
    effective_from: a.effectiveFrom,
    effective_to: a.effectiveTo,
    is_active: a.isActive,
    version: a.version,
  }));
}

async function loadAssignment(
  db: Executor,
  user: StaffContext,
  id: string,
  forUpdate = false,
): Promise<AssignmentSelect> {
  const q = db
    .select({ a: paymentPlanAssignments, plan: paymentPlans })
    .from(paymentPlanAssignments)
    .innerJoin(paymentPlans, eq(paymentPlans.id, paymentPlanAssignments.planId))
    .where(and(eq(paymentPlanAssignments.id, id), eq(paymentPlanAssignments.companyId, user.companyId)))
    .limit(1)
    .$dynamic();
  const [row] = await (forUpdate ? q.for("update", { of: paymentPlanAssignments }) : q);
  if (!row) throw ApiError.notFound("Plan assignment");
  ensureProjectAccess(user, row.a.projectId, "Plan assignment");
  return row;
}

/** Loads a block of the project (400 when it is not in the project). */
async function assertBlockInProject(
  db: Executor,
  companyId: string,
  projectId: string,
  blockId: string | null | undefined,
): Promise<void> {
  if (!blockId) return;
  const [b] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(and(eq(blocks.id, blockId), eq(blocks.projectId, projectId), eq(blocks.companyId, companyId)))
    .limit(1);
  if (!b) throw ApiError.badRequest("block_id does not belong to the project", { field: "block_id" });
}

export function registerPlanRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/payment-plan-assignments",
    permission: "plan.manage",
    schema: {
      querystring: PlanAssignmentFilterSchema,
      response: { 200: PlanAssignmentListResponseSchema },
      summary: "List plan ↔ project/tower assignments",
    },
    handler: async (req) => {
      const user = req.user!;
      const q = req.query;
      if (q.project_id) ensureProjectAccess(user, q.project_id);
      const where: (SQL | undefined)[] = [
        eq(paymentPlanAssignments.companyId, user.companyId),
        scopeFilter(user, paymentPlanAssignments.projectId),
      ];
      if (!q.include_inactive || q.active_only) where.push(eq(paymentPlanAssignments.isActive, true));
      if (q.project_id) where.push(eq(paymentPlanAssignments.projectId, q.project_id));
      if (q.block_id) where.push(eq(paymentPlanAssignments.blockId, q.block_id));
      if (q.plan_id) where.push(eq(paymentPlanAssignments.planId, q.plan_id));
      const result = await paginate<AssignmentSelect>(app.dbReplica, {
        table: paymentPlanAssignments,
        select: { a: paymentPlanAssignments, plan: paymentPlans },
        join: (qb) => qb.innerJoin(paymentPlans, eq(paymentPlans.id, paymentPlanAssignments.planId)),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [paymentPlans.name, paymentPlans.code], term: q.search },
        sort: {
          allowed: {
            created_at: paymentPlanAssignments.createdAt,
            is_default: paymentPlanAssignments.isDefault,
            effective_from: paymentPlanAssignments.effectiveFrom,
            plan_name: paymentPlans.name,
          },
          default: "-is_default",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      return { ...result, items: await toRows(app.dbReplica, result.items) };
    },
  });

  route(app, {
    method: "POST",
    url: "/payment-plan-assignments",
    permission: "plan.manage",
    idempotent: true,
    schema: {
      body: PlanAssignmentCreateSchema,
      response: { 201: PlanAssignmentRowSchema },
      summary: "Assign a plan to a project or tower (stage check, one default per scope)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body;
      ensureProjectAccess(user, body.project_id);
      const row = await app.db.transaction(async (tx) => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, body.project_id), eq(projects.companyId, user.companyId)))
          .limit(1);
        if (!project) throw ApiError.notFound("Project");
        await assertBlockInProject(tx, user.companyId, body.project_id, body.block_id);
        const loaded = await loadPlan(tx, user.companyId, body.plan_id);
        await assertPlanFitsScope(tx, loaded, body.project_id, body.block_id ?? null);
        if (body.is_default) await clearOtherDefaults(tx, user.companyId, body.project_id, body.block_id ?? null, null);
        let created: AssignmentRecord | undefined;
        try {
          [created] = await tx
            .insert(paymentPlanAssignments)
            .values({
              companyId: user.companyId,
              planId: body.plan_id,
              projectId: body.project_id,
              blockId: body.block_id ?? null,
              isDefault: body.is_default,
              effectiveFrom: body.effective_from ?? null,
              effectiveTo: body.effective_to ?? null,
              isActive: body.is_active,
              createdBy: user.id,
            })
            .returning();
        } catch (e) {
          translatePgError(e, "An assignment of this plan to this project/tower");
        }
        if (!created) throw new Error("insert returned no row");
        const [view] = await toRows(tx, [{ a: created, plan: loaded.plan }]);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorOf(req),
          action: "plan_assignment.create",
          entityType: "payment_plan_assignment",
          entityId: created.id,
          after: view as unknown as Record<string, unknown>,
          ip: req.clientIp,
          requestId: req.id,
        });
        return view!;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "GET",
    url: "/payment-plan-assignments/:id",
    permission: "plan.manage",
    schema: { params: idParams, response: { 200: PlanAssignmentRowSchema }, summary: "One plan assignment" },
    handler: async (req) =>
      (await toRows(app.dbReplica, [await loadAssignment(app.dbReplica, req.user!, req.params.id)]))[0]!,
  });

  route(app, {
    method: "PATCH",
    url: "/payment-plan-assignments/:id",
    permission: "plan.manage",
    schema: {
      params: idParams,
      body: withOptionalVersion(PlanAssignmentUpdateSchema),
      response: { 200: PlanAssignmentRowSchema },
      summary: "Update default / effective dates / active flag",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      return app.db.transaction(async (tx) => {
        const existing = await loadAssignment(tx, user, req.params.id, true);
        const version = expectedVersion(req, body);
        const loaded = await loadPlan(tx, user.companyId, existing.a.planId, { allowInactive: true });
        if (body.is_active === true || (body.is_active === undefined && existing.a.isActive))
          await assertPlanFitsScope(tx, loaded, existing.a.projectId, existing.a.blockId);
        if (body.is_default === true)
          await clearOtherDefaults(tx, user.companyId, existing.a.projectId, existing.a.blockId, existing.a.id);
        const changes: Record<string, unknown> = {};
        if (body.is_default !== undefined) changes["isDefault"] = body.is_default;
        if (body.effective_from !== undefined) changes["effectiveFrom"] = body.effective_from;
        if (body.effective_to !== undefined) changes["effectiveTo"] = body.effective_to;
        if (body.is_active !== undefined) {
          changes["isActive"] = body.is_active;
          changes["deactivatedAt"] = body.is_active ? null : new Date();
        }
        const updated = await applyUpdate(
          tx,
          paymentPlanAssignments,
          existing.a.id,
          version,
          changes,
          "payment_plan_assignment",
        );
        const [before] = await toRows(tx, [existing]);
        const [after] = await toRows(tx, [{ a: updated, plan: loaded.plan }]);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorOf(req),
          action: "plan_assignment.update",
          entityType: "payment_plan_assignment",
          entityId: updated.id,
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
          ip: req.clientIp,
          requestId: req.id,
        });
        return after!;
      });
    },
  });

  route(app, {
    method: "DELETE",
    url: "/payment-plan-assignments/:id",
    permission: "plan.manage",
    schema: { params: idParams, response: { 204: z.null() }, summary: "Deactivate a plan assignment (soft delete)" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const existing = await loadAssignment(tx, user, req.params.id, true);
        const version = optionalExpectedVersion(req, null, existing.a.version);
        await applyUpdate(
          tx,
          paymentPlanAssignments,
          existing.a.id,
          version,
          { isActive: false, isDefault: false, deactivatedAt: new Date() },
          "payment_plan_assignment",
        );
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorOf(req),
          action: "plan_assignment.deactivate",
          entityType: "payment_plan_assignment",
          entityId: existing.a.id,
          before: { is_active: existing.a.isActive },
          after: { is_active: false },
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "GET",
    url: "/blocks/:id/applicable-plans",
    permission: "booking.read",
    schema: {
      params: idParams,
      querystring: ApplicablePlansBlockQuerySchema,
      response: { 200: ApplicablePlansResponseSchema },
      summary: "Plans assigned to the tower or its project, effective on the date, default first",
    },
    handler: async (req) => {
      const user = req.user!;
      const [block] = await app.dbReplica
        .select({ id: blocks.id, projectId: blocks.projectId })
        .from(blocks)
        .where(and(eq(blocks.id, req.params.id), eq(blocks.companyId, user.companyId)))
        .limit(1);
      if (!block) throw ApiError.notFound("Block");
      ensureProjectAccess(user, block.projectId, "Block");
      return {
        plans: await applicablePlanRows(app.dbReplica, user.companyId, block.projectId, block.id, req.query.on_date),
      };
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/preview-schedule",
    permission: "booking.read",
    schema: {
      body: SchedulePreviewRequestSchema,
      response: { 200: SchedulePreviewResponseSchema },
      summary: "Live schedule preview for the booking wizard",
    },
    handler: async (req) => {
      const user = req.user!;
      const [block] = await app.dbReplica
        .select({ id: blocks.id, projectId: blocks.projectId })
        .from(blocks)
        .where(and(eq(blocks.id, req.body.block_id), eq(blocks.companyId, user.companyId)))
        .limit(1);
      if (!block) throw ApiError.notFound("Block");
      ensureProjectAccess(user, block.projectId, "Block");
      const company = await loadCompanyRow(app.dbReplica, user.companyId);
      return previewSchedule(app.dbReplica, user.companyId, req.body, company.settings.demand_due_days);
    },
  });
}
