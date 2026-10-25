/**
 * ERP site visits (SPEC §15, permission visit.read / visit.write): list + CSV, calendar, today, create for a lead/customer, reschedule
 * (capacity-checked), cancel, complete (lead → SITE_VISIT_DONE), no-show, notes/assignee, internal availability, and the daily nudge job.
 */
import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  IdSchema, VisitAvailabilityQuerySchema, VisitAvailabilityResponseSchema, VisitCalendarQuerySchema, VisitCalendarResponseSchema, VisitCancelSchema, VisitCreateSchema, VisitFilterSchema,
  VisitListResponseSchema, VisitOutcomeBodySchema, VisitOutcomeUpdateSchema, VisitRescheduleSchema, VisitRowSchema, VisitTodayResponseSchema, VisitUpdateSchema, type VisitRow,
} from "@kkt/contracts";
import { customers, leads, projectWebsiteSettings, siteVisits, users, type Executor } from "@kkt/db";
import { addDays, compareDates, dayOfWeek, eachDate, slotTimes, todayIST } from "@kkt/domain";
import { actorFromRequest, auditMeta, writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { registerJob } from "../../jobs/index.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../lib/scope.js";
import { assertVersion, expectedVersion, optionalExpectedVersion } from "../../lib/version.js";
import { loadScopedProject } from "./projectWebsite.js";
import { availabilityCachePath } from "./publicVisits.js";
import { bustPublicCache, clock } from "./shared.js";
import {
  VISIT_SELECT, bookVisit, cancelVisit, domainSettings, ensureVisitSettings, isPast, joinVisit, loadVisitSelect, markOutcome, needsOutcomeCondition, nudgeVisitOutcomes,
  projectAvailability, rescheduleVisit, visitRow, type VisitSelect,
} from "./visitService.js";

const idParams = z.object({ id: IdSchema });
const CSV_COLUMNS = ["visit_number", "project_name", "visit_date", "slot_start", "slot_end", "name", "phone", "email", "visitors", "status", "source", "assignee_name", "lead_number", "notes", "cancel_reason", "created_at"];

/** Loads a visit the user may see (404 outside project scope). */
async function loadScopedVisit(db: Executor, user: StaffContext, id: string, forUpdate = false): Promise<VisitSelect> {
  const r = await loadVisitSelect(db, user.companyId, id, forUpdate);
  ensureProjectAccess(user, r.v.projectId, "Site visit");
  return r;
}

async function slugOf(db: Executor, projectId: string): Promise<string | null> {
  const [w] = await db.select({ slug: projectWebsiteSettings.slug }).from(projectWebsiteSettings).where(eq(projectWebsiteSettings.projectId, projectId)).limit(1);
  return w?.slug ?? null;
}

async function bustAvailability(app: FastifyInstance, projectId: string): Promise<void> {
  const slug = await slugOf(app.db, projectId);
  if (slug) await bustPublicCache(app, availabilityCachePath(slug));
}

async function assertAssignee(db: Executor, companyId: string, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const [u] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
  if (!u || !u.isActive) throw ApiError.badRequest("assignee_user_id: user not found or inactive", { issues: [{ path: "assignee_user_id", message: "User not found or inactive" }] });
}

export function registerVisitRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/site-visits", permission: "visit.read",
    schema: { querystring: VisitFilterSchema, response: { 200: VisitListResponseSchema }, summary: "Site visits (filters: project, date range, status, assignee, lead, customer, source, needs_outcome; csv)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      if (q.project_id) ensureProjectAccess(user, q.project_id);
      const where: (SQL | undefined)[] = [eq(siteVisits.companyId, user.companyId), scopeFilter(user, siteVisits.projectId)];
      if (q.project_id) where.push(eq(siteVisits.projectId, q.project_id));
      if (q.from) where.push(gte(siteVisits.visitDate, q.from));
      if (q.to) where.push(lte(siteVisits.visitDate, q.to));
      if (q.status) where.push(eq(siteVisits.status, q.status));
      if (q.assignee_user_id) where.push(eq(siteVisits.assigneeUserId, q.assignee_user_id));
      if (q.lead_id) where.push(eq(siteVisits.leadId, q.lead_id));
      if (q.customer_id) where.push(eq(siteVisits.customerId, q.customer_id));
      if (q.source) where.push(eq(siteVisits.source, q.source));
      if (q.needs_outcome) where.push(needsOutcomeCondition());
      const result = await paginate<VisitSelect>(app.dbReplica, {
        table: siteVisits, select: VISIT_SELECT, join: joinVisit,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [siteVisits.name, siteVisits.phone, siteVisits.visitNumber], term: q.search },
        sort: { allowed: { visit_date: siteVisits.visitDate, created_at: siteVisits.createdAt, status: siteVisits.status, name: siteVisits.name, slot_start: siteVisits.slotStart }, default: "-visit_date", requested: q.sort },
        ...listPaging(q),
      });
      const items = result.items.map((r) => visitRow(r));
      if (q.format === "csv") return sendCsv(reply, "site-visits.csv", CSV_COLUMNS.map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      return { ...result, items };
    },
  });

  route(app, {
    method: "GET", url: "/site-visits/calendar", permission: "visit.read",
    schema: { querystring: VisitCalendarQuerySchema, response: { 200: VisitCalendarResponseSchema }, summary: "Day/week calendar: dates → slots → visits (is_moved marks rescheduled visits)" },
    handler: async (req) => {
      const user = req.user!;
      const q = req.query;
      const project = await loadScopedProject(app.dbReplica, user, q.project_id);
      if (compareDates(q.from, q.to) > 0) throw ApiError.badRequest("from must be on or before to");
      const to = compareDates(q.to, addDays(q.from, 30)) > 0 ? addDays(q.from, 30) : q.to;
      const settings = await app.db.transaction((tx) => ensureVisitSettings(tx, project.id));
      const s = domainSettings(settings);
      const rows = (await joinVisit(app.dbReplica.select(VISIT_SELECT).from(siteVisits).$dynamic())
        .where(and(eq(siteVisits.projectId, project.id), gte(siteVisits.visitDate, q.from), lte(siteVisits.visitDate, to), q.assignee_user_id ? eq(siteVisits.assigneeUserId, q.assignee_user_id) : undefined))
        .orderBy(asc(siteVisits.visitDate), asc(siteVisits.slotStart), asc(siteVisits.createdAt))) as unknown as VisitSelect[];
      const now = new Date();
      const times = slotTimes(s.startTime, s.endTime, s.slotMinutes);
      const days = eachDate(q.from, to).map((date) => {
        const mine = rows.filter((r) => r.v.visitDate === date);
        const starts = [...new Set([...times.map((t) => t.start), ...mine.map((r) => clock(r.v.slotStart))])].sort();
        const slots = starts.map((start) => {
          const inSlot = mine.filter((r) => clock(r.v.slotStart) === start);
          const end = times.find((t) => t.start === start)?.end ?? (inSlot[0] ? clock(inSlot[0].v.slotEnd) : start);
          const booked = inSlot.filter((r) => r.v.status !== "CANCELLED").length;
          return { start, end, seats: s.seatsPerSlot, booked, available: Math.max(0, s.seatsPerSlot - booked), is_past: isPast({ visitDate: date, slotEnd: end }, now), visits: inSlot.map((r) => visitRow(r, now)) };
        });
        return { date, is_visit_day: s.visitDays.includes(dayOfWeek(date)), is_blackout: s.blackoutDates.includes(date), slots };
      });
      return { project_id: project.id, days };
    },
  });

  route(app, {
    method: "GET", url: "/site-visits/availability", permission: "visit.read",
    schema: { querystring: VisitAvailabilityQuerySchema, response: { 200: VisitAvailabilityResponseSchema }, summary: "Internal availability for pickers (full slots hidden; optionally excluding the visit being moved)" },
    handler: async (req) => {
      const user = req.user!;
      const q = req.query;
      const project = await loadScopedProject(app.dbReplica, user, q.project_id);
      const settings = await app.db.transaction((tx) => ensureVisitSettings(tx, project.id));
      const to = compareDates(q.to, addDays(q.from, 61)) > 0 ? addDays(q.from, 61) : q.to;
      const days = await projectAvailability(app.dbReplica, project.id, { ...settings, minLeadHours: 0, maxDaysAhead: 365 }, q.from, to, { excludeVisitId: q.exclude_visit_id ?? null, ignoreEnabled: true });
      return { days };
    },
  });

  route(app, {
    method: "GET", url: "/site-visits/today", permission: "visit.read",
    schema: { querystring: z.object({ mine: z.preprocess((v) => v === "true" || v === true, z.boolean()).default(false) }), response: { 200: VisitTodayResponseSchema }, summary: "Today's site visits (IST) with quick-outcome counts" },
    handler: async (req) => {
      const user = req.user!;
      const date = todayIST();
      const rows = (await joinVisit(app.dbReplica.select(VISIT_SELECT).from(siteVisits).$dynamic())
        .where(and(eq(siteVisits.companyId, user.companyId), eq(siteVisits.visitDate, date), scopeFilter(user, siteVisits.projectId), req.query.mine ? eq(siteVisits.assigneeUserId, user.id) : undefined))
        .orderBy(asc(siteVisits.slotStart), asc(siteVisits.createdAt))) as unknown as VisitSelect[];
      const items = rows.map((r) => visitRow(r));
      const count = (s: VisitRow["status"][]) => items.filter((i) => s.includes(i.status)).length;
      return { date, items, counts: { total: items.length, pending: count(["CONFIRMED", "RESCHEDULED"]), completed: count(["COMPLETED"]), no_show: count(["NO_SHOW"]), cancelled: count(["CANCELLED"]) } };
    },
  });

  route(app, {
    method: "POST", url: "/site-visits", permission: "visit.write", idempotent: true,
    schema: { body: VisitCreateSchema, response: { 201: VisitRowSchema }, summary: "Create a site visit for a lead or customer (capacity-checked)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body;
      const project = await loadScopedProject(app.db, user, body.project_id);
      await assertAssignee(app.db, user.companyId, body.assignee_user_id);
      if (body.lead_id) {
        const [l] = await app.db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, body.lead_id), eq(leads.companyId, user.companyId))).limit(1);
        if (!l) throw ApiError.notFound("Lead");
      }
      if (body.customer_id) {
        const [c] = await app.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, body.customer_id), eq(customers.companyId, user.companyId))).limit(1);
        if (!c) throw ApiError.notFound("Customer");
      }
      const booked = await app.db.transaction(async (tx) => {
        const settings = await ensureVisitSettings(tx, project.id);
        return bookVisit(tx, {
          companyId: user.companyId, project: { id: project.id, name: project.name }, settings, date: body.visit_date, start: body.slot_start, name: body.name, phone: body.phone, email: body.email ?? null,
          visitors: body.visitors, message: body.message ?? null, source: "ERP", leadId: body.lead_id ?? null, customerId: body.customer_id ?? null, assigneeUserId: body.assignee_user_id ?? null, notes: body.notes ?? null,
          actor: actorFromRequest(req), createdBy: user.id, redis: app.redis, mode: "erp", ...auditMeta(req),
        });
      });
      await bustAvailability(app, project.id);
      return reply.code(201).send(visitRow(await loadVisitSelect(app.db, user.companyId, booked.visit.id)));
    },
  });

  route(app, {
    method: "GET", url: "/site-visits/:id", permission: "visit.read",
    schema: { params: idParams, response: { 200: VisitRowSchema }, summary: "One site visit" },
    handler: async (req) => visitRow(await loadScopedVisit(app.dbReplica, req.user!, req.params.id)),
  });

  route(app, {
    method: "PATCH", url: "/site-visits/:id", permission: "visit.write",
    schema: { params: idParams, body: VisitUpdateSchema.partial({ version: true }), response: { 200: VisitRowSchema }, summary: "Update notes, assignee or visitor count" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const version = expectedVersion(req, body);
      await assertAssignee(app.db, user.companyId, body.assignee_user_id);
      const id = await app.db.transaction(async (tx) => {
        const existing = await loadScopedVisit(tx, user, req.params.id, true);
        await assertVersion(tx, siteVisits, existing.v.id, existing.v.version, version, "site_visit");
        const changes: Partial<typeof siteVisits.$inferInsert> = {};
        if (body.assignee_user_id !== undefined) changes.assigneeUserId = body.assignee_user_id;
        if (body.notes !== undefined) changes.notes = body.notes;
        if (body.visitors !== undefined) changes.visitors = body.visitors;
        const [updated] = await tx.update(siteVisits).set({ ...changes, version: existing.v.version + 1 }).where(eq(siteVisits.id, existing.v.id)).returning();
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: "site_visit.update", entityType: "site_visit", entityId: existing.v.id, before: { assignee_user_id: existing.v.assigneeUserId, notes: existing.v.notes, visitors: existing.v.visitors }, after: { assignee_user_id: updated?.assigneeUserId, notes: updated?.notes, visitors: updated?.visitors }, ...auditMeta(req) });
        return existing.v.id;
      });
      return visitRow(await loadVisitSelect(app.db, user.companyId, id));
    },
  });

  route(app, {
    method: "POST", url: "/site-visits/:id/reschedule", permission: "visit.write",
    schema: { params: idParams, body: VisitRescheduleSchema.partial({ version: true }), response: { 200: VisitRowSchema }, summary: "Move a visit to another slot (capacity-checked; status RESCHEDULED, rescheduled_from kept)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const version = expectedVersion(req, body);
      const result = await app.db.transaction(async (tx) => {
        const existing = await loadScopedVisit(tx, user, req.params.id, true);
        await assertVersion(tx, siteVisits, existing.v.id, existing.v.version, version, "site_visit");
        const settings = await ensureVisitSettings(tx, existing.v.projectId);
        return rescheduleVisit(tx, existing.v, settings, body.visit_date, body.slot_start, body.notes, { actor: actorFromRequest(req), ...auditMeta(req) });
      });
      await bustAvailability(app, result.projectId);
      return visitRow(await loadVisitSelect(app.db, user.companyId, result.id));
    },
  });

  route(app, {
    method: "POST", url: "/site-visits/:id/cancel", permission: "visit.write",
    schema: { params: idParams, body: VisitCancelSchema.partial({ version: true }), response: { 200: VisitRowSchema }, summary: "Cancel with a reason (seat freed; lead stage reverts when no other visit is upcoming)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const result = await app.db.transaction(async (tx) => {
        const existing = await loadScopedVisit(tx, user, req.params.id, true);
        await assertVersion(tx, siteVisits, existing.v.id, existing.v.version, optionalExpectedVersion(req, body, existing.v.version), "site_visit");
        return cancelVisit(tx, existing.v, body.reason, { actor: actorFromRequest(req), ...auditMeta(req) });
      });
      await bustAvailability(app, result.projectId);
      return visitRow(await loadVisitSelect(app.db, user.companyId, result.id));
    },
  });

  for (const [action, outcome] of [["complete", "COMPLETED"], ["no-show", "NO_SHOW"]] as const) {
    route(app, {
      method: "POST", url: `/site-visits/:id/${action}`, permission: "visit.write",
      schema: { params: idParams, body: VisitOutcomeBodySchema.optional(), response: { 200: VisitRowSchema }, summary: outcome === "COMPLETED" ? "Mark completed (lead → Site Visit Done)" : "Mark no-show" },
      handler: async (req) => {
        const user = req.user!;
        const body = req.body ?? {};
        const result = await app.db.transaction(async (tx) => {
          const existing = await loadScopedVisit(tx, user, req.params.id, true);
          await assertVersion(tx, siteVisits, existing.v.id, existing.v.version, optionalExpectedVersion(req, body, existing.v.version), "site_visit");
          return markOutcome(tx, existing.v, outcome, body.notes, { actor: actorFromRequest(req), ...auditMeta(req) });
        });
        return visitRow(await loadVisitSelect(app.db, user.companyId, result.id));
      },
    });
  }

  route(app, {
    method: "POST", url: "/site-visits/:id/outcome", permission: "visit.write",
    schema: { params: idParams, body: VisitOutcomeUpdateSchema.partial({ version: true }), response: { 200: VisitRowSchema }, summary: "Mark outcome (COMPLETED | NO_SHOW)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const result = await app.db.transaction(async (tx) => {
        const existing = await loadScopedVisit(tx, user, req.params.id, true);
        await assertVersion(tx, siteVisits, existing.v.id, existing.v.version, optionalExpectedVersion(req, body, existing.v.version), "site_visit");
        return markOutcome(tx, existing.v, body.outcome, body.notes, { actor: actorFromRequest(req), ...auditMeta(req) });
      });
      return visitRow(await loadVisitSelect(app.db, user.companyId, result.id));
    },
  });
}

/** Daily 09:00 IST: nudge assignees about past visits without an outcome. */
registerJob("VISIT_OUTCOME_NUDGE", async (ctx) => nudgeVisitOutcomes(ctx.db));

