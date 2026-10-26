/**
 * Site-visit service (SPEC §15 SITE VISIT SCHEDULER): settings, availability (domain engine + booked counts), atomic capacity-checked
 * booking under an advisory lock, reschedule/cancel/outcome with lead stage side effects, wire rows, manage tokens and .ics files.
 * Exported for the ERP routes, the public routes, the dashboard and the daily nudge job.
 */
import { and, asc, eq, gt, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { Redis } from "ioredis";
import type { Utm, VisitRow, VisitSettings as VisitSettingsWire, VisitStatus } from "@kkt/contracts";
import {
  companies,
  customers,
  leads,
  notifications,
  projectVisitSettings,
  projects,
  siteVisits,
  users,
  withAdvisoryLock,
  type Executor,
  type Tx,
} from "@kkt/db";
import {
  addDays,
  availability,
  compareDates,
  dayOfWeek,
  icsForVisit,
  istDateTimeMs,
  slotKey,
  slotTimes,
  todayIST,
  type DayAvailability,
  type VisitSettings as DomainVisitSettings,
} from "@kkt/domain";
import { SYSTEM_ACTOR, writeAudit, type AuditActor } from "../../lib/audit.js";
import { loadCompany } from "../../lib/company.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { nextNumber } from "../../lib/numbering.js";
import { createOrTouchLead, recordLeadActivity, revertLeadStage, setLeadStage, type DbLead } from "../crm/index.js";
import { notify, notifyRole, withdraw } from "../notifications/index.js";
import { apiOrigin, clock, webOrigin } from "./shared.js";

export type DbVisit = typeof siteVisits.$inferSelect;
export type DbVisitSettings = typeof projectVisitSettings.$inferSelect;

/** Statuses that occupy a seat. */
export const SEAT_STATUSES: readonly VisitStatus[] = ["CONFIRMED", "RESCHEDULED", "COMPLETED", "NO_SHOW"];
/** Statuses of a visit that has not happened yet (counts as "upcoming" for the lead stage rules). */
export const UPCOMING_STATUSES: readonly VisitStatus[] = ["CONFIRMED", "RESCHEDULED"];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Loads the visit settings of a project, inserting the defaults (disabled) when none exist. */
export async function ensureVisitSettings(tx: Executor, projectId: string): Promise<DbVisitSettings> {
  const [existing] = await tx
    .select()
    .from(projectVisitSettings)
    .where(eq(projectVisitSettings.projectId, projectId))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(projectVisitSettings).values({ projectId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await tx
    .select()
    .from(projectVisitSettings)
    .where(eq(projectVisitSettings.projectId, projectId))
    .limit(1);
  if (!again) throw new Error("project_visit_settings insert produced no row");
  return again;
}

/** Visit settings without creating a row (public reads); null when none exist. */
export async function loadVisitSettings(db: Executor, projectId: string): Promise<DbVisitSettings | null> {
  const [row] = await db
    .select()
    .from(projectVisitSettings)
    .where(eq(projectVisitSettings.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** Domain-engine view of a settings row. */
export function domainSettings(row: DbVisitSettings): DomainVisitSettings {
  return {
    enabled: row.enabled,
    visitDays: row.visitDays,
    startTime: clock(row.startTime),
    endTime: clock(row.endTime),
    slotMinutes: row.slotMinutes,
    seatsPerSlot: row.seatsPerSlot,
    minLeadHours: row.minLeadHours,
    maxDaysAhead: row.maxDaysAhead,
    blackoutDates: row.blackoutDates,
  };
}

/** Wire view of a settings row. */
export function visitSettingsWire(row: DbVisitSettings): VisitSettingsWire {
  return {
    enabled: row.enabled,
    visit_days: row.visitDays,
    start_time: clock(row.startTime),
    end_time: clock(row.endTime),
    slot_minutes: row.slotMinutes as 30 | 60,
    seats_per_slot: row.seatsPerSlot,
    min_lead_hours: row.minLeadHours,
    max_days_ahead: row.maxDaysAhead,
    blackout_dates: row.blackoutDates,
    site_office_address: row.siteOfficeAddress ?? null,
    maps_link: row.mapsLink ?? null,
    instructions: row.instructions ?? null,
  };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** Non-cancelled visit counts per slot ("YYYY-MM-DD|HH:MM") for a project and date range, in one grouped query. */
export async function bookedCounts(
  db: Executor,
  projectId: string,
  from: string,
  to: string,
  excludeVisitId?: string | null,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ date: siteVisits.visitDate, start: siteVisits.slotStart, n: sql<number>`count(*)::int` })
    .from(siteVisits)
    .where(
      and(
        eq(siteVisits.projectId, projectId),
        gte(siteVisits.visitDate, from),
        lte(siteVisits.visitDate, to),
        ne(siteVisits.status, "CANCELLED"),
        excludeVisitId ? ne(siteVisits.id, excludeVisitId) : undefined,
      ),
    )
    .groupBy(siteVisits.visitDate, siteVisits.slotStart);
  return new Map(rows.map((r) => [slotKey(r.date, clock(r.start)), Number(r.n)]));
}

/** Clamps a requested range to [today, today + maxDaysAhead] and at most 62 days; defaults to the next 14 days. */
export function clampRange(
  settings: DbVisitSettings,
  from?: string,
  to?: string,
  now = new Date(),
): { from: string; to: string } {
  const today = todayIST(now);
  const last = addDays(today, settings.maxDaysAhead);
  let f = from ?? today;
  if (compareDates(f, today) < 0) f = today;
  let t = to ?? addDays(f, 13);
  if (compareDates(t, last) > 0) t = last;
  if (compareDates(t, addDays(f, 61)) > 0) t = addDays(f, 61);
  if (compareDates(t, f) < 0) t = f;
  return { from: f, to: t };
}

/** Availability per the SPEC algorithm (public: honours `enabled`, lead hours, blackouts, max days ahead, full slots hidden). */
export async function projectAvailability(
  db: Executor,
  projectId: string,
  settings: DbVisitSettings,
  from: string,
  to: string,
  opts: { excludeVisitId?: string | null; now?: Date; ignoreEnabled?: boolean } = {},
): Promise<DayAvailability[]> {
  const counts = await bookedCounts(db, projectId, from, to, opts.excludeVisitId ?? null);
  const s = domainSettings(settings);
  return availability({
    settings: opts.ignoreEnabled ? { ...s, enabled: true } : s,
    from,
    to,
    nowIST: opts.now ?? new Date(),
    bookedCounts: counts,
  });
}

/** The configured slot that starts at `start` on `date`, or null when the date/time is not a bookable slot of the settings. */
export function matchSlot(
  settings: DbVisitSettings,
  date: string,
  start: string,
  opts: { mode: "public" | "erp"; now?: Date },
): { start: string; end: string } {
  const now = opts.now ?? new Date();
  const s = domainSettings(settings);
  const today = todayIST(now);
  const issues: string[] = [];
  if (compareDates(date, today) < 0) issues.push("date is in the past");
  if (opts.mode === "public" && compareDates(date, addDays(today, s.maxDaysAhead)) > 0)
    issues.push(`date is more than ${s.maxDaysAhead} days ahead`);
  if (!s.visitDays.includes(dayOfWeek(date))) issues.push("no visits on this weekday");
  if (s.blackoutDates.includes(date)) issues.push("date is blacked out");
  const slot = slotTimes(s.startTime, s.endTime, s.slotMinutes).find((t) => t.start === start);
  if (!slot) issues.push("not a valid slot start");
  else if (opts.mode === "public" && istDateTimeMs(date, slot.start) < now.getTime() + s.minLeadHours * 3_600_000)
    issues.push(`slots need at least ${s.minLeadHours} hours notice`);
  else if (opts.mode === "erp" && istDateTimeMs(date, slot.end) < now.getTime()) issues.push("slot already ended");
  if (issues.length > 0 || !slot)
    throw ApiError.rule(`This slot cannot be booked: ${issues.join("; ")}`, "SLOT_INVALID", { date, start, issues });
  return slot;
}

/** Advisory lock key serialising bookings of one slot. */
export function slotLockKey(projectId: string, date: string, start: string): string {
  return `visit:${projectId}:${date}:${start}`;
}

/**
 * Takes the slot lock, recounts the non-cancelled visits of the slot and throws 409 SLOT_FULL when the seats are exhausted.
 * Must run inside the transaction that inserts/moves the visit so the count + insert are one atomic unit.
 */
export async function reserveSeat(
  tx: Tx,
  projectId: string,
  settings: DbVisitSettings,
  date: string,
  start: string,
  excludeVisitId?: string | null,
): Promise<void> {
  await withAdvisoryLock(tx, slotLockKey(projectId, date, start));
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(siteVisits)
    .where(
      and(
        eq(siteVisits.projectId, projectId),
        eq(siteVisits.visitDate, date),
        eq(siteVisits.slotStart, start),
        ne(siteVisits.status, "CANCELLED"),
        excludeVisitId ? ne(siteVisits.id, excludeVisitId) : undefined,
      ),
    );
  const booked = Number(row?.n ?? 0);
  if (booked >= settings.seatsPerSlot)
    throw ApiError.conflict("SLOT_FULL", "This slot has just filled up. Please pick another time.", {
      date,
      start,
      seats: settings.seatsPerSlot,
      booked,
      available: 0,
    });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface VisitSelect {
  v: DbVisit;
  projectName: string | null;
  leadNumber: string | null;
  assigneeName: string | null;
}

/** Drizzle selection for visit rows (use with joinVisit). */
export const VISIT_SELECT = {
  v: siteVisits,
  projectName: projects.name,
  leadNumber: leads.leadNumber,
  assigneeName: users.name,
};

/** Left-joins project, lead and assignee onto a site_visits query. */
export function joinVisit(q: PgSelect): PgSelect {
  return q
    .leftJoin(projects, eq(projects.id, siteVisits.projectId))
    .leftJoin(leads, eq(leads.id, siteVisits.leadId))
    .leftJoin(users, eq(users.id, siteVisits.assigneeUserId));
}

/** True when the slot has ended (IST) at `now`. */
export function isPast(v: Pick<DbVisit, "visitDate" | "slotEnd">, now = new Date()): boolean {
  return istDateTimeMs(v.visitDate, clock(v.slotEnd)) < now.getTime();
}

/** Wire row of a visit. */
export function visitRow(r: VisitSelect, now = new Date()): VisitRow {
  const v = r.v;
  return {
    id: v.id,
    company_id: v.companyId,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
    created_by: v.createdBy,
    version: v.version,
    visit_number: v.visitNumber,
    project_id: v.projectId,
    project_name: r.projectName ?? "",
    lead_id: v.leadId,
    lead_number: r.leadNumber ?? null,
    customer_id: v.customerId,
    visit_date: v.visitDate,
    slot_start: clock(v.slotStart),
    slot_end: clock(v.slotEnd),
    visitors: v.visitors,
    name: v.name,
    phone: v.phone,
    email: v.email,
    message: v.message,
    status: v.status,
    assignee_user_id: v.assigneeUserId,
    assignee_name: r.assigneeName ?? null,
    source: v.source,
    rescheduled_from: v.rescheduledFrom
      ? { visit_date: v.rescheduledFrom.visit_date, slot_start: clock(v.rescheduledFrom.slot_start) }
      : null,
    cancel_reason: v.cancelReason,
    notes: v.notes,
    outcome_marked_at: v.outcomeMarkedAt ? v.outcomeMarkedAt.toISOString() : null,
    is_past: isPast(v, now),
    is_moved: v.rescheduledFrom !== null,
    manage_url: null,
  };
}

/** Loads one visit (joined) in the company; 404 when missing. */
export async function loadVisitSelect(
  db: Executor,
  companyId: string,
  id: string,
  forUpdate = false,
): Promise<VisitSelect> {
  const q = joinVisit(db.select(VISIT_SELECT).from(siteVisits).$dynamic())
    .where(and(eq(siteVisits.id, id), eq(siteVisits.companyId, companyId)))
    .limit(1);
  const rows = (await (forUpdate ? q.for("update", { of: siteVisits }) : q)) as unknown as VisitSelect[];
  const row = rows[0];
  if (!row) throw ApiError.notFound("Site visit");
  return row;
}

/** How long a manage link outlives its visit. */
export const MANAGE_LINK_GRACE_MS = 24 * 3_600_000;

/** Expiry of a manage link: the end of the visit slot (IST) + 24 hours. */
export function manageTokenExpiry(date: string, slotEnd: string): Date {
  return new Date(istDateTimeMs(date, slotEnd) + MANAGE_LINK_GRACE_MS);
}

/** True when the manage link no longer works (expired, cancelled visit, or never given an expiry). */
export function isManageLinkExpired(v: Pick<DbVisit, "manageTokenExpiresAt">, now = new Date()): boolean {
  return !v.manageTokenExpiresAt || v.manageTokenExpiresAt.getTime() <= now.getTime();
}

/**
 * Loads a visit by its (unhashed) manage token; null when unknown. Expired links (visit end + 24 h, cancelled, or replaced by a reschedule)
 * are returned only with `includeExpired` so the public routes can answer 410 LINK_EXPIRED instead of 404.
 */
export async function loadVisitByToken(
  db: Executor,
  token: string,
  opts: { includeExpired?: boolean; forUpdate?: boolean } = {},
): Promise<VisitSelect | null> {
  const q = joinVisit(db.select(VISIT_SELECT).from(siteVisits).$dynamic())
    .where(eq(siteVisits.manageTokenHash, sha256(token)))
    .limit(1);
  const rows = (await (opts.forUpdate ? q.for("update", { of: siteVisits }) : q)) as unknown as VisitSelect[];
  const row = rows[0] ?? null;
  if (!row || opts.includeExpired) return row;
  return isManageLinkExpired(row.v) ? null : row;
}

/** How many replaced manage tokens a visit remembers (each reschedule replaces one). */
export const SUPERSEDED_TOKENS_KEPT = 20;

/**
 * True when `token` was a manage link of some visit that a reschedule has since replaced: the public routes answer 410 LINK_EXPIRED
 * for it (the visitor holds a real but outdated link) instead of 404 (a link that never existed).
 */
export async function isSupersededManageToken(db: Executor, token: string): Promise<boolean> {
  const rows = await db
    .select({ id: siteVisits.id })
    .from(siteVisits)
    .where(sql`${siteVisits.supersededTokenHashes} @> ARRAY[${sha256(token)}]::text[]`)
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Public .ics URL of a visit (manage token). */
export function icsUrl(token: string): string {
  return `${apiOrigin}/api/v1/public/site-visits/${encodeURIComponent(token)}.ics`;
}

/** Website manage page of a visit. */
export function manageUrl(token: string): string {
  return `${webOrigin}/visit/${encodeURIComponent(token)}`;
}

/** iCalendar text for a visit (Asia/Kolkata, 1-hour reminder). */
export function visitIcs(v: DbVisit, projectName: string, settings: DbVisitSettings | null, token: string): string {
  const location = [settings?.siteOfficeAddress, settings?.mapsLink].filter(Boolean).join(" · ") || projectName;
  const description = [
    `Site visit ${v.visitNumber} for ${v.name} (${v.visitors} visitor${v.visitors === 1 ? "" : "s"}).`,
    settings?.instructions ?? null,
    `Manage: ${manageUrl(token)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return icsForVisit({
    uid: `${v.id}@kkt`,
    summary: `Site visit: ${projectName}`,
    description,
    location,
    date: v.visitDate,
    start: clock(v.slotStart),
    end: clock(v.slotEnd),
    stamp: v.createdAt,
    url: manageUrl(token),
  });
}

// ---------------------------------------------------------------------------
// Lead side effects
// ---------------------------------------------------------------------------

async function loadLeadForUpdate(tx: Executor, leadId: string): Promise<DbLead | null> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1).for("update");
  return lead ?? null;
}

/** Lead → SITE_VISIT_SCHEDULED (records previous_stage, history, activity, audit) unless it is already there or closed. */
export async function scheduleLeadStage(
  tx: Executor,
  leadId: string,
  actor: AuditActor,
  meta: { ip?: string | null; requestId?: string | null },
): Promise<void> {
  const lead = await loadLeadForUpdate(tx, leadId);
  if (!lead || lead.stage === "SITE_VISIT_SCHEDULED" || lead.stage === "CONVERTED" || lead.stage === "LOST") return;
  await setLeadStage(tx, lead, "SITE_VISIT_SCHEDULED", { actor, note: "Site visit booked", ...meta });
}

/** Lead → SITE_VISIT_DONE when the visit is completed (only from the early stages). */
export async function completeLeadStage(
  tx: Executor,
  leadId: string,
  actor: AuditActor,
  meta: { ip?: string | null; requestId?: string | null },
): Promise<void> {
  const lead = await loadLeadForUpdate(tx, leadId);
  if (!lead || !["NEW", "CONTACTED", "SITE_VISIT_SCHEDULED"].includes(lead.stage)) return;
  await setLeadStage(tx, lead, "SITE_VISIT_DONE", { actor, note: "Site visit completed", ...meta });
}

/** Other upcoming (not cancelled, not past) visits of a lead, excluding one. */
export async function otherUpcomingVisits(
  db: Executor,
  leadId: string,
  excludeVisitId: string,
  now = new Date(),
): Promise<number> {
  const today = todayIST(now);
  const rows = await db
    .select({ date: siteVisits.visitDate, end: siteVisits.slotEnd })
    .from(siteVisits)
    .where(
      and(
        eq(siteVisits.leadId, leadId),
        ne(siteVisits.id, excludeVisitId),
        inArray(siteVisits.status, [...UPCOMING_STATUSES]),
        gte(siteVisits.visitDate, today),
      ),
    );
  return rows.filter((r) => !isPast({ visitDate: r.date, slotEnd: r.end }, now)).length;
}

/** After a cancellation: when the lead has no other upcoming visit and sits at SITE_VISIT_SCHEDULED, revert to its previous stage. */
export async function revertLeadAfterCancel(
  tx: Executor,
  leadId: string,
  visitId: string,
  actor: AuditActor,
): Promise<void> {
  const lead = await loadLeadForUpdate(tx, leadId);
  if (!lead || lead.stage !== "SITE_VISIT_SCHEDULED") return;
  if ((await otherUpcomingVisits(tx, leadId, visitId)) > 0) return;
  await revertLeadStage(tx, leadId, "Site visit cancelled", actor);
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

/** Input of bookVisit. */
export interface BookVisitInput {
  companyId: string;
  project: { id: string; name: string };
  settings: DbVisitSettings;
  date: string;
  start: string;
  name: string;
  phone: string;
  email?: string | null;
  visitors: number;
  message?: string | null;
  source: "WEBSITE" | "ERP";
  /** Existing lead (ERP) — otherwise a lead is created/touched from name + phone (website, or ERP without a lead). */
  leadId?: string | null;
  customerId?: string | null;
  assigneeUserId?: string | null;
  notes?: string | null;
  utm?: Utm | null;
  actor: AuditActor;
  createdBy?: string | null;
  redis?: Redis | null;
  ip?: string | null;
  requestId?: string | null;
  /** Slot validation mode (public enforces lead hours and max days ahead). */
  mode: "public" | "erp";
  now?: Date;
}

/** Result of bookVisit. */
export interface BookedVisit {
  visit: DbVisit;
  token: string;
  lead: DbLead | null;
}

/**
 * Books a visit atomically: slot validation → advisory lock + recount (409 SLOT_FULL) → create/touch lead (source SITE_VISIT) → insert the
 * visit (SV- number, CONFIRMED, assignee = lead's RM) → lead stage SITE_VISIT_SCHEDULED → VISIT_BOOKED activity → notify assignee → audit.
 */
export async function bookVisit(tx: Tx, input: BookVisitInput): Promise<BookedVisit> {
  const slot = matchSlot(input.settings, input.date, input.start, { mode: input.mode, now: input.now });
  await reserveSeat(tx, input.project.id, input.settings, input.date, slot.start);
  const company = await loadCompanyFor(tx, input.redis, input.companyId);
  const visitNumber = await nextNumber(tx, company, "visit", input.date);
  const meta = { ip: input.ip ?? null, requestId: input.requestId ?? null };

  let lead: DbLead | null = null;
  if (input.leadId) {
    lead = await loadLeadForUpdate(tx, input.leadId);
    if (!lead || lead.companyId !== input.companyId) throw ApiError.notFound("Lead");
    await recordLeadActivity(
      tx,
      lead.id,
      "VISIT_BOOKED",
      {
        visit_number: visitNumber,
        visit_date: input.date,
        slot_start: slot.start,
        slot_end: slot.end,
        visitors: input.visitors,
        source: input.source,
      },
      input.actor,
    );
  } else if (!input.customerId) {
    const r = await createOrTouchLead(tx, {
      companyId: input.companyId,
      phone: input.phone,
      name: input.name,
      email: input.email ?? null,
      projectId: input.project.id,
      source: "SITE_VISIT",
      message: input.message ?? null,
      utm: input.utm ?? null,
      consent: true,
      activityType: "VISIT_BOOKED",
      activityPayload: {
        visit_number: visitNumber,
        visit_date: input.date,
        slot_start: slot.start,
        slot_end: slot.end,
        visitors: input.visitors,
      },
      actor: input.actor,
      redis: input.redis ?? null,
      createdBy: input.createdBy ?? null,
      ...meta,
    });
    lead = r.lead;
  }

  let assignee = input.assigneeUserId ?? lead?.assignedUserId ?? null;
  if (!assignee && input.customerId) {
    const [c] = await tx
      .select({ rm: customers.relationshipManagerId })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    assignee = c?.rm ?? null;
  }
  if (!assignee && input.actor.type === "STAFF") assignee = input.actor.id;

  const token = randomToken(24);
  const [visit] = await tx
    .insert(siteVisits)
    .values({
      companyId: input.companyId,
      visitNumber,
      projectId: input.project.id,
      leadId: lead?.id ?? null,
      customerId: input.customerId ?? null,
      visitDate: input.date,
      slotStart: slot.start,
      slotEnd: slot.end,
      visitors: input.visitors,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      message: input.message ?? null,
      status: "CONFIRMED",
      assigneeUserId: assignee,
      manageTokenHash: sha256(token),
      manageTokenExpiresAt: manageTokenExpiry(input.date, slot.end),
      source: input.source,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!visit) throw new Error("site_visits insert returned no row");

  if (lead) await scheduleLeadStage(tx, lead.id, input.actor, meta);
  const title = `Site visit booked: ${input.name} · ${input.date} ${slot.start}`;
  const body = `${visitNumber} · ${input.project.name} · ${input.visitors} visitor${input.visitors === 1 ? "" : "s"}`;
  const note = {
    type: "VISIT_BOOKED" as const,
    title,
    body,
    entityType: "site_visit",
    entityId: visit.id,
    link: `/site-visits?id=${visit.id}`,
  };
  if (assignee && assignee !== (input.actor.type === "STAFF" ? input.actor.id : null))
    await notify(tx, { companyId: input.companyId, recipients: [{ type: "STAFF", id: assignee }], ...note });
  else if (!assignee) await notifyRole(tx, input.companyId, ["Sales"], note);
  await writeAudit(tx, {
    companyId: input.companyId,
    actor: input.actor,
    action: "site_visit.create",
    entityType: "site_visit",
    entityId: visit.id,
    after: auditView(visit),
    ...meta,
  });
  return { visit, token, lead };
}

async function loadCompanyFor(tx: Executor, redis: Redis | null | undefined, companyId: string) {
  if (redis) return loadCompany(tx, redis, companyId);
  const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw ApiError.notFound("Company");
  return c;
}

function auditView(v: DbVisit): Record<string, unknown> {
  return {
    visit_number: v.visitNumber,
    project_id: v.projectId,
    lead_id: v.leadId,
    customer_id: v.customerId,
    visit_date: v.visitDate,
    slot_start: clock(v.slotStart),
    slot_end: clock(v.slotEnd),
    visitors: v.visitors,
    name: v.name,
    phone: v.phone,
    status: v.status,
    assignee_user_id: v.assigneeUserId,
    source: v.source,
    rescheduled_from: v.rescheduledFrom,
    cancel_reason: v.cancelReason,
    notes: v.notes,
  };
}

/** Shared meta for state changes. */
export interface ChangeMeta {
  actor: AuditActor;
  ip?: string | null;
  requestId?: string | null;
}

/** Cancels a visit (seat freed), appends VISIT_CANCELLED, withdraws its notifications and reverts the lead stage when no other visit is upcoming. */
export async function cancelVisit(
  tx: Executor,
  visit: DbVisit,
  reason: string | null,
  meta: ChangeMeta,
): Promise<DbVisit> {
  if (visit.status === "CANCELLED") throw ApiError.rule("This visit is already cancelled", "VISIT_CANCELLED");
  if (visit.status === "COMPLETED" || visit.status === "NO_SHOW")
    throw ApiError.rule("A visit with an outcome cannot be cancelled", "VISIT_CLOSED");
  // The manage link dies with the visit (it could otherwise be used to see the visitor's details).
  const [updated] = await tx
    .update(siteVisits)
    .set({
      status: "CANCELLED",
      cancelReason: reason,
      manageTokenExpiresAt: new Date(),
      version: sql`${siteVisits.version} + 1`,
    })
    .where(eq(siteVisits.id, visit.id))
    .returning();
  if (!updated) throw ApiError.notFound("Site visit");
  if (visit.leadId) {
    await recordLeadActivity(
      tx,
      visit.leadId,
      "VISIT_CANCELLED",
      { visit_number: visit.visitNumber, visit_date: visit.visitDate, slot_start: clock(visit.slotStart), reason },
      meta.actor,
    );
    await revertLeadAfterCancel(tx, visit.leadId, visit.id, meta.actor);
  }
  await withdraw(tx, "site_visit", visit.id);
  await writeAudit(tx, {
    companyId: visit.companyId,
    actor: meta.actor,
    action: "site_visit.cancel",
    entityType: "site_visit",
    entityId: visit.id,
    before: auditView(visit),
    after: auditView(updated),
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
  });
  return updated;
}

/**
 * Moves a visit to another slot (capacity-checked, excluding itself), status RESCHEDULED, keeps the original slot in rescheduled_from.
 * The manage link is ROTATED: the old token stops working and the new one (returned as `newManageToken`, valid until the new slot's end
 * + 24 h) is what the visitor gets back (public reschedule) or what staff share (ERP reschedule response `manage_url`).
 */
export async function rescheduleVisit(
  tx: Tx,
  visit: DbVisit,
  settings: DbVisitSettings,
  date: string,
  start: string,
  notes: string | null | undefined,
  meta: ChangeMeta,
  mode: "public" | "erp" = "erp",
): Promise<DbVisit & { newManageToken: string }> {
  if (visit.status === "CANCELLED" || visit.status === "COMPLETED" || visit.status === "NO_SHOW")
    throw ApiError.rule("Only upcoming visits can be rescheduled", "VISIT_CLOSED");
  const slot = matchSlot(settings, date, start, { mode });
  if (date === visit.visitDate && slot.start === clock(visit.slotStart))
    throw ApiError.rule("The visit is already in this slot", "SAME_SLOT");
  await reserveSeat(tx, visit.projectId, settings, date, slot.start, visit.id);
  const original = visit.rescheduledFrom ?? { visit_date: visit.visitDate, slot_start: clock(visit.slotStart) };
  const token = randomToken(24);
  const [updated] = await tx
    .update(siteVisits)
    .set({
      visitDate: date,
      slotStart: slot.start,
      slotEnd: slot.end,
      status: "RESCHEDULED",
      rescheduledFrom: original,
      notes: notes === undefined ? visit.notes : notes,
      manageTokenHash: sha256(token),
      manageTokenExpiresAt: manageTokenExpiry(date, slot.end),
      supersededTokenHashes: visit.manageTokenHash
        ? [...visit.supersededTokenHashes, visit.manageTokenHash].slice(-SUPERSEDED_TOKENS_KEPT)
        : visit.supersededTokenHashes,
      version: sql`${siteVisits.version} + 1`,
    })
    .where(eq(siteVisits.id, visit.id))
    .returning();
  if (!updated) throw ApiError.notFound("Site visit");
  if (visit.leadId)
    await recordLeadActivity(
      tx,
      visit.leadId,
      "VISIT_RESCHEDULED",
      {
        visit_number: visit.visitNumber,
        from: { visit_date: visit.visitDate, slot_start: clock(visit.slotStart) },
        to: { visit_date: date, slot_start: slot.start },
      },
      meta.actor,
    );
  if (updated.assigneeUserId && updated.assigneeUserId !== (meta.actor.type === "STAFF" ? meta.actor.id : null)) {
    await notify(tx, {
      companyId: visit.companyId,
      recipients: [{ type: "STAFF", id: updated.assigneeUserId }],
      type: "VISIT_BOOKED",
      title: `Site visit moved: ${visit.name} · ${date} ${slot.start}`,
      body: visit.visitNumber,
      entityType: "site_visit",
      entityId: visit.id,
      link: `/site-visits?id=${visit.id}`,
    });
  }
  await writeAudit(tx, {
    companyId: visit.companyId,
    actor: meta.actor,
    action: "site_visit.reschedule",
    entityType: "site_visit",
    entityId: visit.id,
    before: auditView(visit),
    after: { ...auditView(updated), manage_link_rotated: true },
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
  });
  return Object.assign(updated, { newManageToken: token });
}

/** Marks the outcome: COMPLETED (lead → SITE_VISIT_DONE) or NO_SHOW; appends the matching activity. */
export async function markOutcome(
  tx: Executor,
  visit: DbVisit,
  outcome: "COMPLETED" | "NO_SHOW",
  notes: string | null | undefined,
  meta: ChangeMeta,
): Promise<DbVisit> {
  if (visit.status === "CANCELLED") throw ApiError.rule("A cancelled visit has no outcome", "VISIT_CANCELLED");
  if (visit.status === "COMPLETED" || visit.status === "NO_SHOW")
    throw ApiError.rule(`Outcome already marked (${visit.status})`, "OUTCOME_MARKED");
  const [updated] = await tx
    .update(siteVisits)
    .set({
      status: outcome,
      outcomeMarkedAt: new Date(),
      notes: notes === undefined ? visit.notes : notes,
      version: sql`${siteVisits.version} + 1`,
    })
    .where(eq(siteVisits.id, visit.id))
    .returning();
  if (!updated) throw ApiError.notFound("Site visit");
  if (visit.leadId) {
    await recordLeadActivity(
      tx,
      visit.leadId,
      outcome === "COMPLETED" ? "VISIT_COMPLETED" : "VISIT_NO_SHOW",
      {
        visit_number: visit.visitNumber,
        visit_date: visit.visitDate,
        slot_start: clock(visit.slotStart),
        notes: notes ?? null,
      },
      meta.actor,
    );
    if (outcome === "COMPLETED")
      await completeLeadStage(tx, visit.leadId, meta.actor, { ip: meta.ip ?? null, requestId: meta.requestId ?? null });
  }
  await withdraw(tx, "site_visit", visit.id);
  await writeAudit(tx, {
    companyId: visit.companyId,
    actor: meta.actor,
    action: outcome === "COMPLETED" ? "site_visit.complete" : "site_visit.no_show",
    entityType: "site_visit",
    entityId: visit.id,
    before: auditView(visit),
    after: auditView(updated),
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Daily nudge (job VISIT_OUTCOME_NUDGE, 09:00 IST)
// ---------------------------------------------------------------------------

/** Notifies assignees about past visits still CONFIRMED/RESCHEDULED (once per visit per day); returns how many were nudged. */
export async function nudgeVisitOutcomes(db: Executor, now = new Date()): Promise<{ nudged: number; pending: number }> {
  const today = todayIST(now);
  const rows = await db
    .select({ v: siteVisits, projectName: projects.name })
    .from(siteVisits)
    .leftJoin(projects, eq(projects.id, siteVisits.projectId))
    .where(and(inArray(siteVisits.status, [...UPCOMING_STATUSES]), lte(siteVisits.visitDate, today)))
    .orderBy(asc(siteVisits.visitDate), asc(siteVisits.slotStart));
  const past = rows.filter((r) => isPast(r.v, now));
  if (past.length === 0) return { nudged: 0, pending: 0 };
  const startOfDay = new Date(istDateTimeMs(today, "00:00"));
  const already = await db
    .select({ entityId: notifications.entityId })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "VISIT_OUTCOME_NUDGE"),
        inArray(
          notifications.entityId,
          past.map((r) => r.v.id),
        ),
        gt(notifications.createdAt, startOfDay),
      ),
    );
  const done = new Set(already.map((a) => a.entityId));
  let nudged = 0;
  for (const r of past) {
    if (done.has(r.v.id)) continue;
    const note = {
      type: "VISIT_OUTCOME_NUDGE" as const,
      title: `Mark outcome: ${r.v.name} · ${r.v.visitDate} ${clock(r.v.slotStart)}`,
      body: `${r.v.visitNumber} · ${r.projectName ?? ""} — was the visit completed or a no-show?`,
      entityType: "site_visit",
      entityId: r.v.id,
      link: `/site-visits?id=${r.v.id}`,
    };
    const n = r.v.assigneeUserId
      ? await notify(db, { companyId: r.v.companyId, recipients: [{ type: "STAFF", id: r.v.assigneeUserId }], ...note })
      : await notifyRole(db, r.v.companyId, ["Sales"], note);
    if (n > 0) nudged += 1;
  }
  return { nudged, pending: past.length };
}

/** Condition selecting past visits without an outcome (list filter needs_outcome). */
export function needsOutcomeCondition(now = new Date()): SQL {
  const today = todayIST(now);
  const nowClock = `${String(new Date(now.getTime() + 330 * 60_000).getUTCHours()).padStart(2, "0")}:${String(new Date(now.getTime() + 330 * 60_000).getUTCMinutes()).padStart(2, "0")}`;
  return and(
    inArray(siteVisits.status, [...UPCOMING_STATUSES]),
    or(
      sql`${siteVisits.visitDate} < ${today}`,
      and(eq(siteVisits.visitDate, today), sql`${siteVisits.slotEnd} < ${nowClock}::time`),
    ),
  )!;
}

/** Re-export so routes import the actor from one place. */
export { SYSTEM_ACTOR };
