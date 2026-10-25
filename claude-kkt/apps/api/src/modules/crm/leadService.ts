import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { Redis } from "ioredis";
import type { LeadActivityRow, LeadActivityType, LeadFollowUpRow, LeadRow, LeadSource, LeadStage, LeadStageHistoryRow, Utm } from "@kkt/contracts";
import { OPEN_LEAD_STAGES } from "@kkt/contracts";
import { companies, enquiries, flatTypes, leadActivities, leadFollowUps, leadStageHistory, leads, nextSequence, projects, roles, siteVisits, users, type Executor } from "@kkt/db";
import { DEFAULT_NUMBER_PATTERN, financialYear, formatNumber, normalizeIndianPhone, todayIST } from "@kkt/domain";
import { writeAudit, SYSTEM_ACTOR, type AuditActor } from "../../lib/audit.js";
import { loadCompany, type CompanyRecord } from "../../lib/company.js";
import { ApiError } from "../../lib/errors.js";
import { notify, notifyRole } from "../notifications/service.js";

export type DbLead = typeof leads.$inferSelect;

/** Stages that count as "open" (not LOST / CONVERTED). */
export const OPEN_STAGES: readonly LeadStage[] = OPEN_LEAD_STAGES;

// ---------------------------------------------------------------------------
// Numbering (scope "lead", prefix LD- unless the company numbering says otherwise)
// ---------------------------------------------------------------------------

/** Allocates the next lead number for the FY of `businessDate` (default today IST): LD-2627/0001. */
export async function nextLeadNumber(tx: Executor, company: Pick<CompanyRecord, "id" | "fyStartMonth" | "numbering">, businessDate = todayIST()): Promise<string> {
  const fy = financialYear(businessDate, company.fyStartMonth);
  const cfg = (company.numbering as unknown as Record<string, { prefix?: string; format?: string } | undefined>)["lead"] ?? { prefix: "LD-" };
  const seq = await nextSequence(tx, company.id, "lead", fy.label);
  return formatNumber(cfg.prefix ?? "LD-", fy.label, seq, cfg.format ?? DEFAULT_NUMBER_PATTERN);
}

/** Enquiry reference number shown to website visitors: ENQ-2627/0001. */
export async function nextEnquiryReference(tx: Executor, company: Pick<CompanyRecord, "id" | "fyStartMonth">, businessDate = todayIST()): Promise<string> {
  const fy = financialYear(businessDate, company.fyStartMonth);
  const seq = await nextSequence(tx, company.id, "enquiry", fy.label);
  return formatNumber("ENQ-", fy.label, seq);
}

/** Company row through the Redis cache when a client is available, straight from the database otherwise. */
export async function companyFor(tx: Executor, redis: Redis | null | undefined, companyId: string): Promise<CompanyRecord> {
  if (redis) return loadCompany(tx, redis, companyId);
  const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw ApiError.notFound("Company");
  return c;
}

// ---------------------------------------------------------------------------
// Round robin over active Sales users
// ---------------------------------------------------------------------------

/** Redis counter key of the company's lead round robin. */
export function roundRobinKey(companyId: string): string {
  return `rr:lead:${companyId}`;
}

/**
 * Next Sales user in rotation (active users of the system role "Sales", ordered by creation). The position comes from a Redis counter
 * per company; without Redis a Postgres sequence (scope "lead_rr") keeps the rotation transactional. Null when no Sales user exists.
 */
export async function nextRoundRobinUser(tx: Executor, companyId: string, redis: Redis | null | undefined): Promise<string | null> {
  const sales = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.companyId, companyId), eq(users.isActive, true), eq(roles.name, "Sales")))
    .orderBy(asc(users.createdAt), asc(users.id));
  if (sales.length === 0) return null;
  let counter: number;
  if (redis) {
    try {
      counter = await redis.incr(roundRobinKey(companyId));
    } catch {
      counter = await nextSequence(tx, companyId, "lead_rr", "ALL");
    }
  } else {
    counter = await nextSequence(tx, companyId, "lead_rr", "ALL");
  }
  return sales[(counter - 1) % sales.length]!.id;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface LeadSelect {
  l: DbLead;
  projectName: string | null;
  flatTypeName: string | null;
  assignedName: string | null;
  upcomingVisitAt: Date | string | null;
}

// "leads"."id" is spelled out: Drizzle renders selected columns unqualified for single-table queries and the sub-select has its own id.
const upcomingVisitSql = sql<string | null>`(
  select min((v.visit_date::text || 'T' || v.slot_start::text || '+05:30')::timestamptz) from ${siteVisits} v
  where v.lead_id = "leads"."id" and v.status in ('CONFIRMED', 'RESCHEDULED') and (v.visit_date::text || 'T' || v.slot_start::text || '+05:30')::timestamptz >= now())`;

/** Drizzle selection for lead rows; use with `joinLead`. */
export const LEAD_SELECT = { l: leads, projectName: projects.name, flatTypeName: flatTypes.name, assignedName: users.name, upcomingVisitAt: upcomingVisitSql };

/** Left-joins project, flat type and assignee (dynamic query builder). */
export function joinLead(q: PgSelect): PgSelect {
  return q.leftJoin(projects, eq(projects.id, leads.projectId)).leftJoin(flatTypes, eq(flatTypes.id, leads.flatTypeId)).leftJoin(users, eq(users.id, leads.assignedUserId));
}

/** Website UTM parameters as stored (string values only; null when nothing survives). */
export function toDbUtm(utm: Utm | Record<string, string | null | undefined> | null | undefined): Record<string, string> | null {
  if (!utm) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(utm)) if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  return Object.keys(out).length > 0 ? out : null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Lead wire row. */
export function leadRow(r: LeadSelect): LeadRow {
  const l = r.l;
  return {
    id: l.id, company_id: l.companyId, created_at: l.createdAt.toISOString(), updated_at: l.updatedAt.toISOString(), created_by: l.createdBy, version: l.version,
    lead_number: l.leadNumber, full_name: l.fullName, phone: l.phone, email: l.email, project_id: l.projectId, project_name: r.projectName ?? null, flat_type_id: l.flatTypeId, flat_type_name: r.flatTypeName ?? null,
    budget_min_paise: l.budgetMinPaise, budget_max_paise: l.budgetMaxPaise, source: l.source, stage: l.stage, previous_stage: l.previousStage, lost_reason: l.lostReason,
    assigned_user_id: l.assignedUserId, assigned_user_name: r.assignedName ?? null, customer_id: l.customerId, booking_id: l.bookingId, utm: (l.utm as Utm | null) ?? null, message: l.message,
    next_follow_up_at: iso(l.nextFollowUpAt), is_read: l.isRead, consent: l.consent, last_activity_at: iso(l.lastActivityAt), upcoming_visit_at: iso(r.upcomingVisitAt),
  };
}

/** Loads the joined selection of one lead in the company; 404 when missing. */
export async function loadLeadSelect(db: Executor, companyId: string, id: string, forUpdate = false): Promise<LeadSelect> {
  const q = db
    .select(LEAD_SELECT)
    .from(leads)
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(flatTypes, eq(flatTypes.id, leads.flatTypeId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .where(and(eq(leads.id, id), eq(leads.companyId, companyId)))
    .limit(1);
  const rows = (forUpdate ? await q.for("update", { of: leads }) : await q) as LeadSelect[];
  const row = rows[0];
  if (!row) throw ApiError.notFound("Lead");
  return row;
}

/** Lead wire row by id; 404 when missing. */
export async function getLeadRow(db: Executor, companyId: string, id: string): Promise<LeadRow> {
  return leadRow(await loadLeadSelect(db, companyId, id));
}

/** Follow-ups of a lead with author names (one query). */
export async function followUpsOf(db: Executor, leadId: string): Promise<LeadFollowUpRow[]> {
  const rows = await db.select({ f: leadFollowUps, byName: users.name }).from(leadFollowUps).leftJoin(users, eq(users.id, leadFollowUps.byUserId)).where(eq(leadFollowUps.leadId, leadId)).orderBy(sql`${leadFollowUps.createdAt} desc`);
  return rows.map((r) => ({ id: r.f.id, lead_id: r.f.leadId, note: r.f.note, done_at: iso(r.f.doneAt), next_at: iso(r.f.nextAt), by_user_id: r.f.byUserId, by_user_name: r.byName ?? null, created_at: r.f.createdAt.toISOString() }));
}

/** Activities of a lead, newest first, with actor names resolved in one query. */
export async function activitiesOf(db: Executor, leadId: string): Promise<LeadActivityRow[]> {
  const rows = await db
    .select({ a: leadActivities, staffName: users.name })
    .from(leadActivities)
    .leftJoin(users, and(eq(users.id, leadActivities.actorId), eq(leadActivities.actorType, "STAFF")))
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(sql`${leadActivities.at} desc`);
  return rows.map((r) => {
    const payload = (r.a.payload ?? {}) as Record<string, unknown>;
    const actorName = r.staffName ?? (typeof payload["actor_name"] === "string" ? (payload["actor_name"] as string) : null);
    return { id: r.a.id, lead_id: r.a.leadId, type: r.a.type as LeadActivityType, payload, actor_type: r.a.actorType, actor_id: r.a.actorId, actor_name: actorName, at: r.a.at.toISOString() };
  });
}

/** Stage history of a lead, newest first. */
export async function stageHistoryOf(db: Executor, leadId: string): Promise<LeadStageHistoryRow[]> {
  const rows = await db.select({ h: leadStageHistory, byName: users.name }).from(leadStageHistory).leftJoin(users, eq(users.id, leadStageHistory.byUserId)).where(eq(leadStageHistory.leadId, leadId)).orderBy(sql`${leadStageHistory.at} desc`);
  return rows.map((r) => ({ id: r.h.id, from_stage: r.h.fromStage, to_stage: r.h.toStage, by_user_id: r.h.byUserId, by_user_name: r.byName ?? null, reason: r.h.reason, at: r.h.at.toISOString() }));
}

// ---------------------------------------------------------------------------
// Exported service functions (used by the public/visits modules as well)
// ---------------------------------------------------------------------------

/** Appends a timeline activity and touches `last_activity_at`. */
export async function recordLeadActivity(tx: Executor, leadId: string, type: LeadActivityType, payload: Record<string, unknown>, actor: AuditActor = SYSTEM_ACTOR): Promise<void> {
  const enriched = actor.name && actor.type !== "STAFF" ? { ...payload, actor_name: actor.name } : payload;
  await tx.insert(leadActivities).values({ leadId, type, payload: enriched, actorType: actor.type, actorId: actor.id });
  await tx.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, leadId));
}

/** The open lead (stage not LOST/CONVERTED) for the same phone and project; `projectId` null matches leads without a project. */
export async function findOpenLeadByPhone(tx: Executor, companyId: string, phone: string, projectId: string | null | undefined): Promise<DbLead | null> {
  const canonical = normalizeIndianPhone(phone) ?? phone;
  const [row] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.companyId, companyId), eq(leads.phone, canonical), projectId ? eq(leads.projectId, projectId) : isNull(leads.projectId), inArray(leads.stage, [...OPEN_STAGES])))
    .orderBy(sql`${leads.createdAt} desc`)
    .limit(1);
  return row ?? null;
}

/** Input of createOrTouchLead. */
export interface CreateOrTouchLeadInput {
  companyId: string;
  phone: string;
  name: string;
  email?: string | null;
  projectId?: string | null;
  flatTypeId?: string | null;
  source: LeadSource;
  message?: string | null;
  utm?: Utm | null;
  consent?: boolean;
  /** Activity appended when an open lead already exists (and recorded as the first activity after CREATED on a new one). */
  activityType: LeadActivityType;
  activityPayload?: Record<string, unknown>;
  actor?: AuditActor;
  /** Preferred assignee; otherwise round robin when enabled in company settings. */
  assignedUserId?: string | null;
  budgetMinPaise?: number | null;
  budgetMaxPaise?: number | null;
  nextFollowUpAt?: Date | null;
  createdBy?: string | null;
  /** Redis for the round-robin counter (optional; a Postgres sequence is used without it). */
  redis?: Redis | null;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Website dedupe rule: when an open lead exists for the same phone + project, append an activity to it and return `created:false`;
 * otherwise create a new lead (number LD-, stage NEW, round-robin assignment when enabled and no assignee given, CREATED activity, audit).
 */
export async function createOrTouchLead(tx: Executor, input: CreateOrTouchLeadInput): Promise<{ lead: DbLead; created: boolean }> {
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) throw ApiError.badRequest("phone: Enter a valid 10-digit Indian mobile number", { issues: [{ path: "phone", message: "Enter a valid 10-digit Indian mobile number" }] });
  const actor = input.actor ?? SYSTEM_ACTOR;
  const existing = await findOpenLeadByPhone(tx, input.companyId, phone, input.projectId ?? null);
  if (existing) {
    await recordLeadActivity(tx, existing.id, input.activityType, { source: input.source, message: input.message ?? null, email: input.email ?? null, utm: input.utm ?? null, ...(input.activityPayload ?? {}) }, actor);
    const patch: Partial<typeof leads.$inferInsert> = { isRead: false };
    if (!existing.email && input.email) patch.email = input.email;
    if (!existing.flatTypeId && input.flatTypeId) patch.flatTypeId = input.flatTypeId;
    if (!existing.message && input.message) patch.message = input.message;
    if (input.consent) patch.consent = true;
    await tx.update(leads).set(patch).where(eq(leads.id, existing.id));
    const [lead] = await tx.select().from(leads).where(eq(leads.id, existing.id)).limit(1);
    return { lead: lead ?? existing, created: false };
  }
  const company = await companyFor(tx, input.redis, input.companyId);
  let assignedUserId = input.assignedUserId ?? null;
  if (!assignedUserId && company.settings.round_robin_enabled) assignedUserId = await nextRoundRobinUser(tx, input.companyId, input.redis);
  const leadNumber = await nextLeadNumber(tx, company);
  const [lead] = await tx
    .insert(leads)
    .values({
      companyId: input.companyId, leadNumber, fullName: input.name, phone, email: input.email ?? null, projectId: input.projectId ?? null, flatTypeId: input.flatTypeId ?? null,
      budgetMinPaise: input.budgetMinPaise ?? null, budgetMaxPaise: input.budgetMaxPaise ?? null, source: input.source, stage: "NEW", assignedUserId, utm: toDbUtm(input.utm), message: input.message ?? null,
      nextFollowUpAt: input.nextFollowUpAt ?? null, isRead: false, consent: input.consent ?? false, createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!lead) throw new Error("lead insert returned no row");
  await tx.insert(leadStageHistory).values({ leadId: lead.id, fromStage: null, toStage: "NEW", byUserId: actor.type === "STAFF" ? actor.id : null, reason: null });
  await recordLeadActivity(tx, lead.id, "CREATED", { source: input.source, lead_number: leadNumber }, actor);
  if (input.activityType !== "CREATED") await recordLeadActivity(tx, lead.id, input.activityType, { source: input.source, message: input.message ?? null, utm: input.utm ?? null, ...(input.activityPayload ?? {}) }, actor);
  if (assignedUserId) await recordLeadActivity(tx, lead.id, "ASSIGNED", { assigned_user_id: assignedUserId, via: input.assignedUserId ? "MANUAL" : "ROUND_ROBIN" }, actor);
  await writeAudit(tx, { companyId: input.companyId, actor, action: "lead.create", entityType: "lead", entityId: lead.id, after: { lead_number: leadNumber, full_name: input.name, phone, source: input.source, project_id: input.projectId ?? null, assigned_user_id: assignedUserId }, ip: input.ip ?? null, requestId: input.requestId ?? null });
  return { lead, created: true };
}

/** Options of setLeadStage. */
export interface StageChangeOptions {
  reason?: string | null;
  note?: string | null;
  actor?: AuditActor;
  ip?: string | null;
  requestId?: string | null;
  /** Allow moving to CONVERTED (only the convert flow passes this). */
  allowConverted?: boolean;
}

/**
 * Moves a lead to `stage` with stage history + STAGE_CHANGED activity + audit. LOST requires a reason (422 LOST_REASON_REQUIRED);
 * CONVERTED is refused unless `allowConverted` (422 USE_CONVERT); closed leads (LOST/CONVERTED) cannot move (422 LEAD_CLOSED).
 */
export async function setLeadStage(tx: Executor, lead: DbLead, stage: LeadStage, opts: StageChangeOptions = {}): Promise<DbLead> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  if (stage === "CONVERTED" && !opts.allowConverted) throw ApiError.rule("Leads are converted through POST /leads/:id/convert", "USE_CONVERT");
  if (lead.stage === "CONVERTED") throw ApiError.rule("A converted lead cannot change stage", "LEAD_CLOSED");
  if (lead.stage === "LOST" && stage !== "NEW" && stage !== "CONTACTED") throw ApiError.rule("A lost lead can only be reopened to New or Contacted", "LEAD_CLOSED");
  if (stage === lead.stage) throw ApiError.rule(`Lead is already in stage ${stage}`, "SAME_STAGE");
  const reason = opts.reason?.trim() || null;
  if (stage === "LOST" && (!reason || reason.length < 3)) throw ApiError.rule("A reason is required when marking a lead Lost", "LOST_REASON_REQUIRED", { field: "lost_reason" });
  const [updated] = await tx
    .update(leads)
    .set({ stage, previousStage: lead.stage, lostReason: stage === "LOST" ? reason : null, lastActivityAt: new Date(), version: sql`${leads.version} + 1` })
    .where(eq(leads.id, lead.id))
    .returning();
  if (!updated) throw ApiError.notFound("Lead");
  await tx.insert(leadStageHistory).values({ leadId: lead.id, fromStage: lead.stage, toStage: stage, byUserId: actor.type === "STAFF" ? actor.id : null, reason: reason ?? opts.note ?? null });
  await recordLeadActivity(tx, lead.id, "STAGE_CHANGED", { from: lead.stage, to: stage, reason, note: opts.note ?? null }, actor);
  await writeAudit(tx, { companyId: lead.companyId, actor, action: "lead.stage", entityType: "lead", entityId: lead.id, before: { stage: lead.stage }, after: { stage, lost_reason: stage === "LOST" ? reason : null }, ip: opts.ip ?? null, requestId: opts.requestId ?? null });
  return updated;
}

/** Reverts a lead to its previous stage (visit cancelled etc.); no-op when there is none or the lead is closed. */
export async function revertLeadStage(tx: Executor, leadId: string, reason: string, actor: AuditActor = SYSTEM_ACTOR): Promise<DbLead | null> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1).for("update");
  if (!lead || !lead.previousStage || lead.stage === "CONVERTED" || lead.stage === "LOST") return lead ?? null;
  const target = lead.previousStage;
  const [updated] = await tx
    .update(leads)
    .set({ stage: target, previousStage: lead.stage, lastActivityAt: new Date(), version: sql`${leads.version} + 1` })
    .where(eq(leads.id, lead.id))
    .returning();
  await tx.insert(leadStageHistory).values({ leadId: lead.id, fromStage: lead.stage, toStage: target, byUserId: actor.type === "STAFF" ? actor.id : null, reason });
  await recordLeadActivity(tx, lead.id, "STAGE_CHANGED", { from: lead.stage, to: target, reason, reverted: true }, actor);
  await writeAudit(tx, { companyId: lead.companyId, actor, action: "lead.stage_revert", entityType: "lead", entityId: lead.id, before: { stage: lead.stage }, after: { stage: target, reason } });
  return updated ?? null;
}

/** Input of createEnquiry (the public module validates the body and resolves slugs/codes to ids). */
export interface CreateEnquiryInput {
  companyId: string;
  name: string;
  phone: string;
  email?: string | null;
  projectId?: string | null;
  flatTypeId?: string | null;
  message?: string | null;
  sourcePage?: string | null;
  utm?: Utm | null;
  ip?: string | null;
  consent?: boolean;
  redis?: Redis | null;
  requestId?: string | null;
}

/**
 * Website enquiry: creates or touches the lead (source WEBSITE, dedupe rule), inserts the inbox row with a reference number,
 * and notifies the assignee plus the Sales/Marketing roles (ENQUIRY_NEW). Returns the enquiry, the lead and whether it was new.
 */
export async function createEnquiry(tx: Executor, input: CreateEnquiryInput): Promise<{ enquiry: typeof enquiries.$inferSelect; lead: DbLead; created: boolean }> {
  const { lead, created } = await createOrTouchLead(tx, {
    companyId: input.companyId, phone: input.phone, name: input.name, email: input.email ?? null, projectId: input.projectId ?? null, flatTypeId: input.flatTypeId ?? null, source: "WEBSITE",
    message: input.message ?? null, utm: input.utm ?? null, consent: input.consent ?? true, activityType: "ENQUIRY", activityPayload: { source_page: input.sourcePage ?? null }, actor: SYSTEM_ACTOR,
    redis: input.redis ?? null, ip: input.ip ?? null, requestId: input.requestId ?? null,
  });
  const company = await companyFor(tx, input.redis, input.companyId);
  const referenceNumber = await nextEnquiryReference(tx, company);
  const [enquiry] = await tx
    .insert(enquiries)
    .values({ companyId: input.companyId, leadId: lead.id, projectId: input.projectId ?? null, name: input.name, phone: lead.phone, email: input.email ?? null, flatTypeId: input.flatTypeId ?? null, message: input.message ?? null, sourcePage: input.sourcePage ?? null, utm: toDbUtm(input.utm), ip: input.ip ?? null, referenceNumber, isRead: false })
    .returning();
  if (!enquiry) throw new Error("enquiry insert returned no row");
  const title = `New website enquiry from ${input.name}`;
  const body = [lead.leadNumber, input.message ?? null].filter(Boolean).join(" · ");
  const base = { type: "ENQUIRY_NEW" as const, title, body, entityType: "enquiry", entityId: enquiry.id, link: `/website/enquiries?id=${enquiry.id}` };
  if (lead.assignedUserId) await notify(tx, { companyId: input.companyId, recipients: [{ type: "STAFF", id: lead.assignedUserId }], ...base });
  await notifyRole(tx, input.companyId, ["Sales", "Marketing"], base);
  return { enquiry, lead, created };
}

/** Marks leads read/unread (inbox badge); returns the number updated. */
export async function markLeadsRead(tx: Executor, companyId: string, ids: string[], isRead: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx.update(leads).set({ isRead }).where(and(eq(leads.companyId, companyId), inArray(leads.id, ids), eq(leads.isRead, !isRead))).returning({ id: leads.id });
  return rows.length;
}

/** SQL condition for open leads. */
export function openLeadCondition(): SQL {
  return notInArray(leads.stage, ["LOST", "CONVERTED"]);
}
