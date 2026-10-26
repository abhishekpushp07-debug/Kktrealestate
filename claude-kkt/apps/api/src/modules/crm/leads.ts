import { and, asc, count, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  LEAD_STAGES,
  LeadAssignSchema,
  LeadBoardQuerySchema,
  LeadConvertResponseSchema,
  LeadConvertSchema,
  LeadCreateSchema,
  LeadDetailResponseSchema,
  LeadFilterSchema,
  LeadFollowUpCreateSchema,
  LeadFollowUpRowSchema,
  LeadFollowUpsDueQuerySchema,
  LeadFollowUpsDueResponseSchema,
  LeadKanbanResponseSchema,
  LeadListResponseSchema,
  LeadRowSchema,
  LeadPatchSchema,
  LeadStageChangeBodySchema,
  type LeadRow,
  type LeadStage,
} from "@kkt/contracts";
import { bookingDrafts, customers, flatTypes, leadFollowUps, leads, projects, users, type Executor } from "@kkt/db";
import { istDateTimeMs, todayIST } from "@kkt/domain";
import { actorFromRequest, writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { escapeLike, listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion } from "../../lib/version.js";
import { canonicalPhone, createCustomer, loadCustomerSelect, metaOf, validationError } from "./customerService.js";
import {
  LEAD_SELECT,
  activitiesOf,
  createOrTouchLead,
  followUpsOf,
  getLeadRow,
  joinLead,
  leadRow,
  leadScopeCondition,
  loadLeadSelect,
  markLeadsRead,
  openLeadCondition,
  recordLeadActivity,
  setLeadStage,
  stageHistoryOf,
  toDbUtm,
  type LeadSelect,
} from "./leadService.js";

const idParams = z.object({ id: IdSchema });

/** Loads one lead for a staff user: 404 when missing or when the lead's project lies outside the user's scope. */
async function loadLeadFor(db: Executor, user: StaffContext, id: string, forUpdate = false): Promise<LeadSelect> {
  const sel = await loadLeadSelect(db, user.companyId, id, forUpdate);
  if (sel.l.projectId) ensureProjectAccess(user, sel.l.projectId, "Lead");
  return sel;
}

/** Project/flat type referenced by a lead must exist in the company; a scoped user cannot reference a foreign project (404). */
async function assertRefs(
  tx: Executor,
  user: StaffContext,
  projectId: string | null | undefined,
  flatTypeId: string | null | undefined,
  assignedUserId: string | null | undefined,
): Promise<void> {
  if (projectId) {
    ensureProjectAccess(user, projectId);
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, user.companyId)))
      .limit(1);
    if (!p) throw ApiError.notFound("Project");
  }
  if (flatTypeId) {
    const [f] = await tx
      .select({ id: flatTypes.id })
      .from(flatTypes)
      .where(and(eq(flatTypes.id, flatTypeId), eq(flatTypes.companyId, user.companyId)))
      .limit(1);
    if (!f) throw validationError("flat_type_id", "Flat type does not exist");
  }
  if (assignedUserId) {
    const [u] = await tx
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, assignedUserId), eq(users.companyId, user.companyId)))
      .limit(1);
    if (!u) throw validationError("assigned_user_id", "User does not exist");
    if (!u.isActive) throw validationError("assigned_user_id", "User is inactive");
  }
}

/** End of the business day (IST) as an instant: follow-ups due "today" are those at or before it. */
function endOfDayIST(date: string): Date {
  return new Date(istDateTimeMs(date, "23:59") + 59_999);
}

/** /leads routes: list, create (round robin), detail, update, stage, follow-ups, board, due follow-ups, assign, convert, read. */
export function leadRoutes(app: FastifyInstance): void {
  const meta = (req: FastifyRequest) => metaOf(req);

  route(app, {
    method: "GET",
    url: "/leads",
    permission: "lead.read",
    schema: { querystring: LeadFilterSchema, response: { 200: LeadListResponseSchema }, summary: "List leads" },
    handler: async (req, reply) => {
      const q = req.query;
      const user = req.user!;
      const where: (SQL | undefined)[] = [eq(leads.companyId, user.companyId), leadScopeCondition(user)];
      if (q.stage) where.push(eq(leads.stage, q.stage));
      if (q.source) where.push(eq(leads.source, q.source));
      if (q.project_id) {
        ensureProjectAccess(user, q.project_id);
        where.push(eq(leads.projectId, q.project_id));
      }
      if (q.assigned_user_id) where.push(eq(leads.assignedUserId, q.assigned_user_id));
      if (q.is_read !== undefined) where.push(eq(leads.isRead, q.is_read));
      if (q.from) where.push(gte(leads.createdAt, new Date(istDateTimeMs(q.from, "00:00"))));
      if (q.to) where.push(lte(leads.createdAt, endOfDayIST(q.to)));
      if (q.follow_up_due === true)
        where.push(
          and(openLeadCondition(), isNotNull(leads.nextFollowUpAt), lte(leads.nextFollowUpAt, endOfDayIST(todayIST()))),
        );
      if (q.follow_up_due === false)
        where.push(
          sql`(${leads.nextFollowUpAt} is null or ${leads.nextFollowUpAt} > ${endOfDayIST(todayIST()).toISOString()}::timestamptz)`,
        );
      const result = await paginate<LeadSelect>(app.dbReplica, {
        table: leads,
        select: LEAD_SELECT,
        join: (qb) => joinLead(qb),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [leads.fullName, leads.phone, leads.leadNumber, leads.email], term: q.search },
        sort: {
          allowed: {
            created_at: leads.createdAt,
            full_name: leads.fullName,
            stage: leads.stage,
            next_follow_up_at: leads.nextFollowUpAt,
            last_activity_at: leads.lastActivityAt,
            lead_number: leads.leadNumber,
          },
          default: "-created_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = result.items.map(leadRow);
      if (q.format === "csv") {
        const cols = [
          "lead_number",
          "full_name",
          "phone",
          "email",
          "project_name",
          "flat_type_name",
          "source",
          "stage",
          "assigned_user_name",
          "next_follow_up_at",
          "lost_reason",
          "created_at",
        ];
        return sendCsv(
          reply,
          "leads.csv",
          cols.map((k) => ({ key: k, header: k })),
          items as unknown as Record<string, unknown>[],
        );
      }
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: "/leads",
    permission: "lead.write",
    idempotent: true,
    schema: {
      body: LeadCreateSchema,
      response: { 201: LeadRowSchema },
      summary:
        "Create a lead (round-robin assignment to Sales when enabled; an open lead for the same phone + project → 409 DUPLICATE_LEAD)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const b = req.body;
      const row = await app.db.transaction(async (tx) => {
        await assertRefs(tx, user, b.project_id, b.flat_type_id, b.assigned_user_id);
        const { lead } = await createOrTouchLead(tx, {
          companyId: user.companyId,
          phone: canonicalPhone(b.phone),
          name: b.full_name,
          email: b.email ?? null,
          projectId: b.project_id ?? null,
          flatTypeId: b.flat_type_id ?? null,
          source: b.source,
          message: b.message ?? null,
          utm: b.utm ?? null,
          consent: b.consent,
          activityType: "CREATED",
          actor: actorFromRequest(req),
          assignedUserId: b.assigned_user_id ?? null,
          budgetMinPaise: b.budget_min_paise ?? null,
          budgetMaxPaise: b.budget_max_paise ?? null,
          nextFollowUpAt: b.next_follow_up_at ? new Date(b.next_follow_up_at) : null,
          createdBy: user.id,
          redis: app.redis,
          ip: req.clientIp,
          requestId: req.id,
          onExisting: "conflict",
        });
        return getLeadRow(tx, user.companyId, lead.id);
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "GET",
    url: "/leads/board",
    permission: "lead.read",
    schema: {
      querystring: LeadBoardQuerySchema,
      response: { 200: LeadKanbanResponseSchema },
      summary: "Kanban board: one column per stage with counts",
    },
    handler: async (req) => {
      const q = req.query;
      const user = req.user!;
      const where: (SQL | undefined)[] = [eq(leads.companyId, user.companyId), leadScopeCondition(user)];
      if (q.project_id) {
        ensureProjectAccess(user, q.project_id);
        where.push(eq(leads.projectId, q.project_id));
      }
      if (q.assigned_user_id) where.push(eq(leads.assignedUserId, q.assigned_user_id));
      if (q.source) where.push(eq(leads.source, q.source));
      if (q.search) {
        const term = escapeLike(q.search);
        where.push(
          sql`(${leads.fullName} ilike ${`%${term}%`} or ${leads.phone} ilike ${`${term}%`} or ${leads.leadNumber} ilike ${`${term}%`})`,
        );
      }
      const cond = and(...where.filter((w): w is SQL => w !== undefined));
      const db = app.dbReplica;
      // Counts per stage in one query; cards per column via a window function in one query (no per-stage round trips).
      const counts = await db.select({ stage: leads.stage, n: count() }).from(leads).where(cond).groupBy(leads.stage);
      const ranked = db
        .select({
          id: leads.id,
          stage: leads.stage,
          rn: sql<number>`row_number() over (partition by ${leads.stage} order by ${leads.lastActivityAt} desc, ${leads.id})`.as(
            "rn",
          ),
        })
        .from(leads)
        .where(cond)
        .as("ranked");
      const ids = await db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rn, q.limit));
      const rows =
        ids.length === 0
          ? []
          : ((await joinLead(db.select(LEAD_SELECT).from(leads).$dynamic())
              .where(
                inArray(
                  leads.id,
                  ids.map((r) => r.id),
                ),
              )
              .orderBy(sql`${leads.lastActivityAt} desc`)) as LeadSelect[]);
      const byStage = new Map<LeadStage, LeadRow[]>();
      for (const r of rows) {
        const list = byStage.get(r.l.stage) ?? [];
        list.push(leadRow(r));
        byStage.set(r.l.stage, list);
      }
      const countBy = new Map(counts.map((c) => [c.stage, Number(c.n)]));
      return {
        columns: LEAD_STAGES.map((stage) => ({
          stage,
          count: countBy.get(stage) ?? 0,
          leads: byStage.get(stage) ?? [],
        })),
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/leads/follow-ups/due",
    permission: "lead.read",
    schema: {
      querystring: LeadFollowUpsDueQuerySchema,
      response: { 200: LeadFollowUpsDueResponseSchema },
      summary: "My follow-ups due today (and overdue)",
    },
    handler: async (req) => {
      const user = req.user!;
      const date = req.query.date ?? todayIST();
      const end = endOfDayIST(date);
      const start = new Date(istDateTimeMs(date, "00:00"));
      const cond = and(
        eq(leads.companyId, user.companyId),
        leadScopeCondition(user),
        openLeadCondition(),
        isNotNull(leads.nextFollowUpAt),
        lte(leads.nextFollowUpAt, end),
        req.query.all ? undefined : eq(leads.assignedUserId, user.id),
      );
      const [rows, totals] = await Promise.all([
        joinLead(app.dbReplica.select(LEAD_SELECT).from(leads).$dynamic())
          .where(cond)
          .orderBy(asc(leads.nextFollowUpAt))
          .limit(req.query.limit) as unknown as Promise<LeadSelect[]>,
        app.dbReplica
          .select({
            total: count(),
            overdue: sql<number>`count(*) filter (where ${leads.nextFollowUpAt} < ${start.toISOString()}::timestamptz)`,
          })
          .from(leads)
          .where(cond),
      ]);
      return {
        date,
        items: rows.map(leadRow),
        total: Number(totals[0]?.total ?? 0),
        overdue: Number(totals[0]?.overdue ?? 0),
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/leads/:id",
    permission: "lead.read",
    schema: {
      params: idParams,
      response: { 200: LeadDetailResponseSchema },
      summary: "Lead detail with follow-ups, activities and stage history",
    },
    handler: async (req) => {
      const db = app.dbReplica;
      const sel = await loadLeadFor(db, req.user!, req.params.id);
      const [follow_ups, activities, stage_history] = await Promise.all([
        followUpsOf(db, sel.l.id),
        activitiesOf(db, sel.l.id),
        stageHistoryOf(db, sel.l.id),
      ]);
      return { ...leadRow(sel), follow_ups, activities, stage_history };
    },
  });

  route(app, {
    method: "PATCH",
    url: "/leads/:id",
    permission: "lead.write",
    schema: {
      params: idParams,
      body: LeadPatchSchema,
      response: { 200: LeadRowSchema },
      summary: "Update a lead (version required)",
    },
    handler: async (req) => {
      const user = req.user!;
      const b = req.body;
      const version = expectedVersion(req, b);
      return app.db.transaction(async (tx) => {
        const before = await loadLeadFor(tx, user, req.params.id, true);
        await assertRefs(tx, user, b.project_id, b.flat_type_id, b.assigned_user_id);
        const changes: Record<string, unknown> = {};
        if (b.full_name !== undefined) changes["fullName"] = b.full_name;
        if (b.phone !== undefined) changes["phone"] = canonicalPhone(b.phone);
        if (b.email !== undefined) changes["email"] = b.email;
        if (b.project_id !== undefined) changes["projectId"] = b.project_id;
        if (b.flat_type_id !== undefined) changes["flatTypeId"] = b.flat_type_id;
        if (b.budget_min_paise !== undefined) changes["budgetMinPaise"] = b.budget_min_paise;
        if (b.budget_max_paise !== undefined) changes["budgetMaxPaise"] = b.budget_max_paise;
        if (b.assigned_user_id !== undefined) changes["assignedUserId"] = b.assigned_user_id;
        if (b.message !== undefined) changes["message"] = b.message;
        if (b.utm !== undefined) changes["utm"] = toDbUtm(b.utm);
        if (b.next_follow_up_at !== undefined)
          changes["nextFollowUpAt"] = b.next_follow_up_at ? new Date(b.next_follow_up_at) : null;
        if (b.consent !== undefined) changes["consent"] = b.consent;
        const min = (changes["budgetMinPaise"] as number | null | undefined) ?? before.l.budgetMinPaise;
        const max = (changes["budgetMaxPaise"] as number | null | undefined) ?? before.l.budgetMaxPaise;
        if (min != null && max != null && min > max)
          throw validationError("budget_max_paise", "Minimum budget must be ≤ maximum");
        await applyUpdate(tx, leads, req.params.id, version, changes, "lead");
        if (b.assigned_user_id !== undefined && b.assigned_user_id !== before.l.assignedUserId)
          await recordLeadActivity(
            tx,
            req.params.id,
            "ASSIGNED",
            { assigned_user_id: b.assigned_user_id, via: "MANUAL" },
            actorFromRequest(req),
          );
        const after = await getLeadRow(tx, user.companyId, req.params.id);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "lead.update",
          entityType: "lead",
          entityId: req.params.id,
          before: leadRow(before) as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/leads/:id/stage",
    permission: "lead.write",
    schema: {
      params: idParams,
      body: LeadStageChangeBodySchema,
      response: { 200: LeadRowSchema },
      summary: "Move a lead along the pipeline (LOST needs a reason; CONVERTED only via /convert)",
    },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        const sel = await loadLeadFor(tx, user, req.params.id, true);
        if (sel.l.version !== req.body.version)
          await applyUpdate(tx, leads, req.params.id, req.body.version, {}, "lead"); // raises 409 VERSION_CONFLICT
        await setLeadStage(tx, sel.l, req.body.stage, {
          reason: req.body.lost_reason ?? req.body.reason ?? null,
          note: req.body.note ?? null,
          actor: actorFromRequest(req),
          ip: req.clientIp,
          requestId: req.id,
        });
        return getLeadRow(tx, user.companyId, req.params.id);
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/leads/:id/follow-ups",
    permission: "lead.write",
    idempotent: true,
    schema: {
      params: idParams,
      body: LeadFollowUpCreateSchema,
      response: { 201: LeadFollowUpRowSchema },
      summary: "Record a follow-up and schedule the next one",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const row = await app.db.transaction(async (tx) => {
        const sel = await loadLeadFor(tx, user, req.params.id, true);
        if (sel.l.stage === "CONVERTED" || sel.l.stage === "LOST")
          throw ApiError.rule("Follow-ups can only be recorded on open leads; reopen a lost lead first", "LEAD_CLOSED");
        const [f] = await tx
          .insert(leadFollowUps)
          .values({
            leadId: sel.l.id,
            note: req.body.note,
            doneAt: req.body.done_at ? new Date(req.body.done_at) : new Date(),
            nextAt: req.body.next_at ? new Date(req.body.next_at) : null,
            byUserId: user.id,
          })
          .returning();
        if (!f) throw new Error("follow-up insert returned no row");
        const patch: Record<string, unknown> = { lastActivityAt: new Date(), isRead: true };
        if (req.body.next_at !== undefined)
          patch["nextFollowUpAt"] = req.body.next_at ? new Date(req.body.next_at) : null;
        await tx.update(leads).set(patch).where(eq(leads.id, sel.l.id));
        await recordLeadActivity(
          tx,
          sel.l.id,
          "FOLLOW_UP",
          { note: req.body.note, next_at: req.body.next_at ?? null },
          actorFromRequest(req),
        );
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "lead.follow_up",
          entityType: "lead",
          entityId: sel.l.id,
          after: { note: req.body.note, next_at: req.body.next_at ?? null },
        });
        return {
          id: f.id,
          lead_id: f.leadId,
          note: f.note,
          done_at: f.doneAt ? f.doneAt.toISOString() : null,
          next_at: f.nextAt ? f.nextAt.toISOString() : null,
          by_user_id: f.byUserId,
          by_user_name: user.name,
          created_at: f.createdAt.toISOString(),
        };
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "POST",
    url: "/leads/:id/assign",
    permission: "lead.write",
    schema: {
      params: idParams,
      body: LeadAssignSchema,
      response: { 200: LeadRowSchema },
      summary: "Assign (or unassign) a lead",
    },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        const sel = await loadLeadFor(tx, user, req.params.id, true);
        await assertRefs(tx, user, null, null, req.body.assigned_user_id);
        await applyUpdate(
          tx,
          leads,
          req.params.id,
          req.body.version,
          { assignedUserId: req.body.assigned_user_id, lastActivityAt: new Date() },
          "lead",
        );
        await recordLeadActivity(
          tx,
          sel.l.id,
          "ASSIGNED",
          { assigned_user_id: req.body.assigned_user_id, previous_user_id: sel.l.assignedUserId, via: "MANUAL" },
          actorFromRequest(req),
        );
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "lead.assign",
          entityType: "lead",
          entityId: sel.l.id,
          before: { assigned_user_id: sel.l.assignedUserId },
          after: { assigned_user_id: req.body.assigned_user_id },
        });
        return getLeadRow(tx, user.companyId, req.params.id);
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/leads/:id/read",
    permission: "lead.read",
    schema: {
      params: idParams,
      body: z.object({ is_read: z.boolean().default(true) }).optional(),
      response: { 200: LeadRowSchema },
      summary: "Mark a lead read/unread",
    },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        await loadLeadFor(tx, user, req.params.id);
        await markLeadsRead(tx, user.companyId, [req.params.id], req.body?.is_read ?? true);
        return getLeadRow(tx, user.companyId, req.params.id);
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/leads/:id/convert",
    permission: "lead.write",
    idempotent: true,
    schema: {
      params: idParams,
      body: LeadConvertSchema,
      response: { 200: LeadConvertResponseSchema },
      summary: "Convert a lead: link or create the customer, stage CONVERTED, optional booking draft",
    },
    handler: async (req) => {
      const user = req.user!;
      const b = req.body;
      return app.db.transaction(async (tx) => {
        const sel = await loadLeadFor(tx, user, req.params.id, true);
        if (sel.l.stage === "CONVERTED") {
          // Converting twice is idempotent when it names the same customer; anything else is a closed-lead violation.
          if (sel.l.customerId && b.customer_id === sel.l.customerId) {
            const c = await loadCustomerSelect(tx, user.companyId, sel.l.customerId);
            return { lead: leadRow(sel), customer_id: c.c.id, customer_code: c.c.customerCode, booking_draft_id: null };
          }
          throw ApiError.rule("Lead is already converted", "LEAD_CLOSED", { customer_id: sel.l.customerId });
        }
        if (sel.l.version !== b.version) await applyUpdate(tx, leads, req.params.id, b.version, {}, "lead");
        let customerId: string;
        let customerCode: string;
        if (b.customer_id) {
          const c = await loadCustomerSelect(tx, user.companyId, b.customer_id);
          if (c.c.erasedAt || !c.c.isActive)
            throw ApiError.rule("A lead can only be linked to an active customer", "CUSTOMER_INACTIVE");
          customerId = c.c.id;
          customerCode = c.c.customerCode;
        } else {
          const input = b.customer!;
          const created = await createCustomer(
            tx,
            { user, redis: app.redis, meta: meta(req) },
            {
              ...input,
              source: input.source ?? sel.l.source,
              relationship_manager_id: input.relationship_manager_id ?? sel.l.assignedUserId ?? null,
            },
          );
          customerId = created.id;
          customerCode = created.customer_code;
        }
        await tx.update(leads).set({ customerId }).where(eq(leads.id, sel.l.id));
        const after = await setLeadStage(tx, { ...sel.l, customerId }, "CONVERTED", {
          actor: actorFromRequest(req),
          ip: req.clientIp,
          requestId: req.id,
          allowConverted: true,
          note: `Converted to customer ${customerCode}`,
        });
        await recordLeadActivity(
          tx,
          sel.l.id,
          "CONVERTED",
          { customer_id: customerId, customer_code: customerCode },
          actorFromRequest(req),
        );
        let bookingDraftId: string | null = null;
        if (b.start_booking) {
          const [draft] = await tx
            .insert(bookingDrafts)
            .values({
              companyId: user.companyId,
              userId: user.id,
              step: 2,
              payload: {
                lead_id: sel.l.id,
                customer_id: customerId,
                project_id: sel.l.projectId,
                flat_type_id: sel.l.flatTypeId,
              },
            })
            .returning({ id: bookingDrafts.id });
          bookingDraftId = draft?.id ?? null;
        }
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "lead.convert",
          entityType: "lead",
          entityId: sel.l.id,
          before: { stage: sel.l.stage },
          after: {
            stage: after.stage,
            customer_id: customerId,
            customer_code: customerCode,
            booking_draft_id: bookingDraftId,
          },
        });
        return {
          lead: await getLeadRow(tx, user.companyId, sel.l.id),
          customer_id: customerId,
          customer_code: customerCode,
          booking_draft_id: bookingDraftId,
        };
      });
    },
  });

  // Unread count for the leads inbox badge (website leads not yet opened).
  route(app, {
    method: "GET",
    url: "/leads/unread-count",
    permission: "lead.read",
    schema: { response: { 200: z.object({ unread: z.int().min(0) }) }, summary: "Unread leads" },
    handler: async (req) => {
      const [r] = await app.dbReplica
        .select({ n: count() })
        .from(leads)
        .where(
          and(
            eq(leads.companyId, req.user!.companyId),
            leadScopeCondition(req.user!),
            eq(leads.isRead, false),
            openLeadCondition(),
          ),
        );
      return { unread: Number(r?.n ?? 0) };
    },
  });

  // Who exists in the company for the assignee dropdown (active users; Sales first).
  route(app, {
    method: "GET",
    url: "/leads/assignees",
    permission: "lead.read",
    schema: {
      response: {
        200: z.object({ items: z.array(z.object({ id: IdSchema, name: z.string(), role_name: z.string() })) }),
      },
      summary: "Active staff selectable as lead assignee",
    },
    handler: async (req) => {
      const rows = await app.dbReplica.execute<{ id: string; name: string; role_name: string }>(sql`
        select u.id, u.name, r.name as role_name from users u join roles r on r.id = u.role_id
        where u.company_id = ${req.user!.companyId} and u.is_active order by (r.name = 'Sales') desc, u.name`);
      return { items: [...rows].map((r) => ({ id: r.id, name: r.name, role_name: r.role_name })) };
    },
  });

  // Convenience for the ERP: the lead's own customer (if converted) — kept tiny.
  route(app, {
    method: "GET",
    url: "/leads/:id/customer",
    permission: "lead.read",
    schema: {
      params: idParams,
      response: {
        200: z.object({
          customer_id: IdSchema.nullable(),
          customer_code: z.string().nullable(),
          full_name: z.string().nullable(),
        }),
      },
      summary: "Converted customer of a lead",
    },
    handler: async (req) => {
      const sel = await loadLeadFor(app.dbReplica, req.user!, req.params.id);
      if (!sel.l.customerId) return { customer_id: null, customer_code: null, full_name: null };
      const [c] = await app.dbReplica
        .select({ id: customers.id, code: customers.customerCode, name: customers.fullName })
        .from(customers)
        .where(eq(customers.id, sel.l.customerId))
        .limit(1);
      return c
        ? { customer_id: c.id, customer_code: c.code, full_name: c.name }
        : { customer_id: null, customer_code: null, full_name: null };
    },
  });
}
