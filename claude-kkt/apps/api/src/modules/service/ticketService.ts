/**
 * Service requests (tickets) — SPEC §13. One place for loading/mapping tickets, the status machine, the staff mutations and the
 * customer-facing functions the portal module calls (internal notes are stripped there; anything not the customer's is 404).
 * Every mutation runs inside the caller's transaction, writes an audit row, bumps `version` and notifies inside the same transaction.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import {
  SERVICE_REOPEN_WINDOW_DAYS,
  type CustomerTicketDetail,
  type CustomerTicketRow,
  type ServiceMessageRow,
  type ServicePriority,
  type ServiceRequestDetailResponse,
  type ServiceRequestRow,
  type ServiceStatus,
} from "@kkt/contracts";
import { bookingCoApplicants, bookings, companies, customers, documents, projects, serviceCategories, serviceRequestMessages, serviceRequests, users, type Executor } from "@kkt/db";
import { DEFAULT_SLA_HOURS, isSlaBreached, slaDueAt, todayIST, type SlaHours } from "@kkt/domain";
import { writeAudit, type AuditActor } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { fromListQuery, paginate, type ListResult } from "../../lib/list.js";
import { nextNumber } from "../../lib/numbering.js";
import { ensureProjectAccess, type StaffContext } from "../../lib/scope.js";
import { applyUpdate } from "../../lib/version.js";
import { loadRows as loadDocumentRows } from "../documents/service.js";
import { notify, notifyRole } from "../notifications/service.js";

/** A service_requests row. */
export type DbTicket = typeof serviceRequests.$inferSelect;
/** A service_request_messages row. */
export type DbTicketMessage = typeof serviceRequestMessages.$inferSelect;

/** Statuses in which the SLA clock no longer runs. */
export const TERMINAL_STATUSES: readonly ServiceStatus[] = ["RESOLVED", "CLOSED"];

/** Allowed status transitions (NEW → IN_PROGRESS → AWAITING_CUSTOMER → RESOLVED → CLOSED, plus the reopen paths). */
export const STATUS_TRANSITIONS: Readonly<Record<ServiceStatus, readonly ServiceStatus[]>> = {
  NEW: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["AWAITING_CUSTOMER", "RESOLVED"],
  AWAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

/** Audit entity type and notification entity type of a ticket. */
export const TICKET_ENTITY = "service_request";
/** Roles that receive new-ticket / breach notifications when no assignee exists. */
export const TICKET_ADMIN_ROLES = ["Super Admin"] as const;
/** Role notified in addition for payment-related categories. */
export const PAYMENT_CATEGORY_ROLES = ["Accounts"] as const;

/** Request metadata carried into audit rows. */
export interface WriteMeta { ip?: string | null; requestId?: string | null }

/** Staff write context (the authenticated user + request metadata). */
export interface TicketWriteContext { user: StaffContext; meta: WriteMeta }

/** One joined ticket row as selected by every ticket query. */
export interface TicketJoined {
  sr: DbTicket;
  customerName: string;
  customerPhone: string;
  bookingNumber: string | null;
  projectId: string | null;
  projectName: string | null;
  flatNumber: string | null;
  categoryName: string | null;
  assigneeName: string | null;
  messageCount: number;
}

const FLAT_NUMBER = sql<string | null>`${bookings.flatSnapshot}->>'flat_number'`;

/** Selection used by every ticket query (row + customer, booking, project, category and assignee names + message count); no per-row lookups. */
export function ticketSelect(includeInternal: boolean) {
  const internalFilter = includeInternal ? sql.empty() : sql` and m.is_internal = false`;
  return {
    sr: serviceRequests,
    customerName: customers.fullName,
    customerPhone: customers.phone,
    bookingNumber: bookings.bookingNumber,
    projectId: bookings.projectId,
    projectName: projects.name,
    flatNumber: FLAT_NUMBER,
    categoryName: serviceCategories.name,
    assigneeName: users.name,
    messageCount: sql<number>`(select count(*)::int from service_request_messages m where m.ticket_id = ${serviceRequests.id}${internalFilter})`,
  };
}

/** Adds the customer/booking/project/category/assignee joins to a (dynamic) ticket query builder. */
export function withTicketJoins(q: PgSelect): PgSelect {
  return q
    .innerJoin(customers, eq(customers.id, serviceRequests.customerId))
    .leftJoin(bookings, eq(bookings.id, serviceRequests.bookingId))
    .leftJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(serviceCategories, eq(serviceCategories.id, serviceRequests.categoryId))
    .leftJoin(users, eq(users.id, serviceRequests.assigneeUserId));
}

/** Search columns for ticket lists (ticket number, subject, customer name/phone). */
export const TICKET_SEARCH_COLUMNS = [serviceRequests.ticketNumber, serviceRequests.subject, customers.fullName, customers.phone] as const;

/** Allow-listed sort fields for ticket lists. */
export const TICKET_SORTABLE = {
  created_at: serviceRequests.createdAt,
  updated_at: serviceRequests.updatedAt,
  priority: serviceRequests.priority,
  status: serviceRequests.status,
  sla_due_at: serviceRequests.slaDueAt,
  last_message_at: serviceRequests.lastMessageAt,
  ticket_number: serviceRequests.ticketNumber,
};

/** Condition: open ticket past its SLA (flagged by the job, or simply overdue right now). */
export function slaBreachedCondition(now: Date): SQL {
  return or(isNotNull(serviceRequests.slaBreachedAt), and(lt(serviceRequests.slaDueAt, now), notInArray(serviceRequests.status, [...TERMINAL_STATUSES])))!;
}

/**
 * Project scope for ticket lists: a scoped user sees tickets of bookings in their projects plus tickets without a booking
 * (nothing to scope by). Applied on the joined `bookings.project_id`.
 */
export function ticketScopeCondition(user: Pick<StaffContext, "allProjects" | "projectIds">): SQL | undefined {
  if (user.allProjects) return undefined;
  if (user.projectIds.length === 0) return isNull(serviceRequests.bookingId);
  return or(isNull(serviceRequests.bookingId), inArray(bookings.projectId, user.projectIds));
}

/** 404 (never 403) when the ticket's booking belongs to a project outside the user's scope. */
export function assertTicketScope(user: Pick<StaffContext, "allProjects" | "projectIds">, t: TicketJoined): void {
  if (t.projectId) ensureProjectAccess(user, t.projectId, "Service request");
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Wire row of a joined ticket (staff shape). */
export function toTicketRow(j: TicketJoined, now = new Date()): ServiceRequestRow {
  const t = j.sr;
  const terminal = TERMINAL_STATUSES.includes(t.status);
  return {
    id: t.id,
    company_id: t.companyId,
    ticket_number: t.ticketNumber,
    customer_id: t.customerId,
    customer_name: j.customerName,
    customer_phone: j.customerPhone,
    booking_id: t.bookingId,
    booking_number: j.bookingNumber,
    project_name: j.projectName,
    flat_number: j.flatNumber,
    category_id: String(t.categoryId),
    category_name: j.categoryName ?? "",
    priority: t.priority,
    subject: t.subject,
    description: t.description ?? "",
    status: t.status,
    assignee_user_id: t.assigneeUserId,
    assignee_name: j.assigneeName,
    sla_due_at: iso(t.slaDueAt),
    sla_breached_at: iso(t.slaBreachedAt),
    is_sla_breached: t.slaBreachedAt !== null || (t.slaDueAt ? isSlaBreached(t.slaDueAt, now, terminal) : false),
    resolved_at: iso(t.resolvedAt),
    closed_at: iso(t.closedAt),
    reopened_count: t.reopenedCount,
    rating: t.rating,
    rating_comment: t.ratingComment,
    last_message_at: iso(t.lastMessageAt),
    message_count: Number(j.messageCount ?? 0),
    created_at: new Date(t.createdAt).toISOString(),
    updated_at: new Date(t.updatedAt).toISOString(),
    version: t.version,
  };
}

/** True while a RESOLVED ticket is inside the customer reopen window. */
export function canReopen(t: Pick<DbTicket, "status" | "resolvedAt">, now = new Date()): boolean {
  if (t.status !== "RESOLVED" || !t.resolvedAt) return false;
  return now.getTime() - new Date(t.resolvedAt).getTime() <= SERVICE_REOPEN_WINDOW_DAYS * 86_400_000;
}

/** True when the customer may still rate (RESOLVED/CLOSED, not rated yet). */
export function canRate(t: Pick<DbTicket, "status" | "rating">): boolean {
  return TERMINAL_STATUSES.includes(t.status) && t.rating === null;
}

/** Customer-facing wire row: no staff ids or SLA internals, plus reopen/rate eligibility. */
export function toCustomerTicketRow(j: TicketJoined, now = new Date()): CustomerTicketRow {
  const { assignee_user_id: _a, assignee_name: _b, sla_due_at: _c, sla_breached_at: _d, is_sla_breached: _e, ...rest } = toTicketRow(j, now);
  return { ...rest, can_reopen: canReopen(j.sr, now), can_rate: canRate(j.sr) };
}

/** Loads one joined ticket of the company by id (optionally locked); null when missing. */
export async function loadTicket(executor: Executor, companyId: string, id: string, opts: { forUpdate?: boolean; includeInternal?: boolean } = {}): Promise<TicketJoined | null> {
  const q = withTicketJoins(executor.select(ticketSelect(opts.includeInternal ?? true)).from(serviceRequests).$dynamic())
    .where(and(eq(serviceRequests.id, id), eq(serviceRequests.companyId, companyId)))
    .limit(1);
  const rows = await (opts.forUpdate ? q.for("update", { of: serviceRequests }) : q);
  return (rows[0] as TicketJoined | undefined) ?? null;
}

/** Loads a ticket for staff: 404 when missing or outside the user's project scope. */
export async function requireStaffTicket(executor: Executor, user: StaffContext, id: string, forUpdate = false): Promise<TicketJoined> {
  const t = await loadTicket(executor, user.companyId, id, { forUpdate, includeInternal: true });
  if (!t) throw ApiError.notFound("Service request");
  assertTicketScope(user, t);
  return t;
}

/** Loads a ticket that belongs to the customer (internal-note-free counts); 404 otherwise. */
export async function requireCustomerTicket(executor: Executor, ticketId: string, customerId: string, forUpdate = false): Promise<TicketJoined> {
  const q = withTicketJoins(executor.select(ticketSelect(false)).from(serviceRequests).$dynamic())
    .where(and(eq(serviceRequests.id, ticketId), eq(serviceRequests.customerId, customerId)))
    .limit(1);
  const rows = await (forUpdate ? q.for("update", { of: serviceRequests }) : q);
  const t = rows[0] as TicketJoined | undefined;
  if (!t) throw ApiError.notFound("Service request");
  return t;
}

/** Thread of a ticket (internal notes only when `includeInternal`), attachments resolved in one documents query. */
export async function loadMessages(executor: Executor, companyId: string, ticketId: string, includeInternal: boolean): Promise<ServiceMessageRow[]> {
  const rows = await executor
    .select()
    .from(serviceRequestMessages)
    .where(and(eq(serviceRequestMessages.ticketId, ticketId), includeInternal ? undefined : eq(serviceRequestMessages.isInternal, false)))
    .orderBy(asc(serviceRequestMessages.createdAt), asc(serviceRequestMessages.id));
  const ids = [...new Set(rows.flatMap((r) => r.attachmentIds))];
  const docs = await loadDocumentRows(executor, companyId, ids);
  const byId = new Map(docs.map((d) => [d.id, d]));
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticketId,
    author_type: r.authorType,
    author_id: r.authorId,
    author_name: r.authorName ?? (r.authorType === "SYSTEM" ? "System" : ""),
    body: r.body,
    is_internal: r.isInternal,
    attachments: r.attachmentIds
      .map((id) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
      .map((d) => ({ id: d.id, file_name: d.file_name, mime: d.mime, thumb_url: d.thumb_url })),
    created_at: new Date(r.createdAt).toISOString(),
  }));
}

/** Staff detail: row + full thread including internal notes. */
export async function ticketDetail(executor: Executor, t: TicketJoined): Promise<ServiceRequestDetailResponse> {
  return { ...toTicketRow(t), messages: await loadMessages(executor, t.sr.companyId, t.sr.id, true) };
}

/** Customer detail: row + thread without internal notes. */
export async function customerTicketDetail(executor: Executor, t: TicketJoined): Promise<CustomerTicketDetail> {
  return { ...toCustomerTicketRow(t), messages: await loadMessages(executor, t.sr.companyId, t.sr.id, false) };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

type CompanyRow = typeof companies.$inferSelect;

async function companyRow(tx: Executor, companyId: string): Promise<CompanyRow> {
  const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw ApiError.notFound("Company");
  return c;
}

/** SLA hours per priority from company settings (defaults fill any gap). */
export function slaHoursOf(company: Pick<CompanyRow, "settings">): SlaHours {
  const cfg = (company.settings as { sla_hours?: Partial<Record<ServicePriority, number>> } | null)?.sla_hours ?? {};
  return { ...DEFAULT_SLA_HOURS, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0)) } as SlaHours;
}

async function resolveCategory(tx: Executor, companyId: string, categoryId: string): Promise<{ id: string; name: string; defaultPriority: ServicePriority }> {
  const [cat] = await tx
    .select({ id: serviceCategories.id, name: serviceCategories.name, defaultPriority: serviceCategories.defaultPriority, isActive: serviceCategories.isActive })
    .from(serviceCategories)
    .where(and(eq(serviceCategories.id, categoryId), eq(serviceCategories.companyId, companyId)))
    .limit(1);
  if (!cat) throw ApiError.badRequest("category_id does not exist", { field: "category_id" });
  if (!cat.isActive) throw ApiError.rule("Service category is inactive", "CATEGORY_INACTIVE", { category_id: categoryId });
  return cat;
}

async function resolveAssignee(tx: Executor, companyId: string, userId: string): Promise<{ id: string; name: string }> {
  const [u] = await tx.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId))).limit(1);
  if (!u) throw ApiError.badRequest("assignee_user_id does not exist", { field: "assignee_user_id" });
  if (!u.isActive) throw ApiError.rule("Assignee is inactive", "ASSIGNEE_INACTIVE", { assignee_user_id: userId });
  return u;
}

/** What a thread attachment may belong to: the ticket itself, its customer or its booking. */
export interface AttachmentOwner { ticketId?: string | null; customerId: string; bookingId: string | null }

/**
 * 400 unless every attachment id is a live, non-sensitive document of the company that belongs to this ticket (entity SERVICE_REQUEST),
 * its customer (entity CUSTOMER) or its booking (entity BOOKING). Anything else — another customer's file, a KYC document — would leak
 * its name and thumbnail into the thread (the customer sees public messages), so it is rejected as if it did not exist.
 */
export async function assertAttachments(tx: Executor, companyId: string, ids: readonly string[], owner: AttachmentOwner): Promise<void> {
  if (ids.length === 0) return;
  const belongs: SQL[] = [and(eq(documents.entityType, "CUSTOMER"), eq(documents.entityId, owner.customerId))!];
  if (owner.ticketId) belongs.push(and(eq(documents.entityType, "SERVICE_REQUEST"), eq(documents.entityId, owner.ticketId))!);
  if (owner.bookingId) belongs.push(and(eq(documents.entityType, "BOOKING"), eq(documents.entityId, owner.bookingId))!);
  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), inArray(documents.id, [...ids]), eq(documents.isDeleted, false), eq(documents.isSensitive, false), or(...belongs)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw ApiError.badRequest("attachment_ids references a document that does not exist or does not belong to this request", { field: "attachment_ids", missing });
}

/** Condition: the customer is primary applicant or co-applicant of the booking row. */
function bookingMemberCondition(customerId: string): SQL {
  return or(eq(bookings.customerId, customerId), sql`exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = ${bookings.id} and bc.customer_id = ${customerId})`)!;
}

/** Project ids of the customer's ACTIVE/COMPLETED bookings (primary or co-applicant). */
export function customerProjectIdsSubquery(customerId: string): SQL {
  return sql`(select b.project_id from ${bookings} b where b.status in ('ACTIVE', 'COMPLETED') and (b.customer_id = ${customerId} or exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = b.id and bc.customer_id = ${customerId})))`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Input of a ticket creation (staff on behalf of a customer, or the customer from the portal). */
export interface CreateTicketInput {
  customerId: string;
  bookingId?: string | null;
  categoryId: string;
  /** Defaults to the category's default priority. */
  priority?: ServicePriority | null;
  subject: string;
  description: string;
  attachmentIds?: readonly string[];
  assigneeUserId?: string | null;
}

function truncate(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Notifies the assignee (or Super Admin when unassigned) of a new ticket; payment categories also reach Accounts. */
async function notifyNewTicket(tx: Executor, t: DbTicket, customerName: string, categoryName: string): Promise<void> {
  const base = {
    type: "TICKET_NEW" as const,
    title: `New ticket ${t.ticketNumber}: ${t.subject}`,
    body: `${customerName} · ${categoryName} · ${t.priority}`,
    entityType: TICKET_ENTITY,
    entityId: t.id,
    link: `/service-requests/${t.id}`,
  };
  if (t.assigneeUserId) await notify(tx, { companyId: t.companyId, recipients: [{ type: "STAFF", id: t.assigneeUserId }], ...base });
  const roleNames: string[] = t.assigneeUserId ? [] : [...TICKET_ADMIN_ROLES];
  if (/payment/i.test(categoryName)) roleNames.push(...PAYMENT_CATEGORY_ROLES);
  if (roleNames.length > 0) await notifyRole(tx, t.companyId, roleNames, base);
}

async function createTicketCore(
  tx: Executor,
  companyId: string,
  input: CreateTicketInput,
  actor: AuditActor,
  meta: WriteMeta,
  opts: { scopeUser?: StaffContext | undefined; bookingNotTheirs: () => ApiError },
): Promise<TicketJoined> {
  const [customer] = await tx.select({ id: customers.id, name: customers.fullName, isActive: customers.isActive }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId))).limit(1);
  if (!customer) throw ApiError.badRequest("customer_id does not exist", { field: "customer_id" });
  if (!customer.isActive) throw ApiError.rule("Customer is inactive", "CUSTOMER_INACTIVE", { customer_id: input.customerId });

  let bookingId: string | null = null;
  if (input.bookingId) {
    const [b] = await tx.select({ id: bookings.id, projectId: bookings.projectId, member: bookingMemberCondition(input.customerId) }).from(bookings).where(and(eq(bookings.id, input.bookingId), eq(bookings.companyId, companyId))).limit(1);
    if (!b) throw opts.bookingNotTheirs();
    if (opts.scopeUser) ensureProjectAccess(opts.scopeUser, b.projectId, "Booking");
    if (!b.member) throw opts.bookingNotTheirs();
    bookingId = b.id;
  }

  const category = await resolveCategory(tx, companyId, input.categoryId);
  const priority = input.priority ?? category.defaultPriority;
  const assignee = input.assigneeUserId ? await resolveAssignee(tx, companyId, input.assigneeUserId) : null;
  const attachmentIds = [...(input.attachmentIds ?? [])];
  await assertAttachments(tx, companyId, attachmentIds, { customerId: customer.id, bookingId });

  const company = await companyRow(tx, companyId);
  const now = new Date();
  const ticketNumber = await nextNumber(tx, { id: company.id, fyStartMonth: company.fyStartMonth, numbering: company.numbering }, "ticket", todayIST(now));
  const [created] = await tx
    .insert(serviceRequests)
    .values({
      companyId, ticketNumber, customerId: customer.id, bookingId, categoryId: category.id, priority, subject: input.subject, description: input.description,
      status: "NEW", assigneeUserId: assignee?.id ?? null, slaDueAt: new Date(slaDueAt(now, priority, slaHoursOf(company))), lastMessageAt: now,
      createdBy: actor.type === "STAFF" ? actor.id : null, createdAt: now, updatedAt: now,
    })
    .returning();
  if (!created) throw new Error("insert returned no row");
  // The opening message carries the description and any attachments so the thread is complete on its own.
  await tx.insert(serviceRequestMessages).values({ ticketId: created.id, authorType: actor.type, authorId: actor.id, authorName: actor.name ?? customer.name, body: input.description, isInternal: false, attachmentIds });
  await notifyNewTicket(tx, created, customer.name, category.name);
  const loaded = await loadTicket(tx, companyId, created.id, { includeInternal: true });
  if (!loaded) throw new Error("ticket vanished after insert");
  await writeAudit(tx, { companyId, actor, action: "service_request.create", entityType: TICKET_ENTITY, entityId: created.id, after: toTicketRow(loaded, now), ip: meta.ip ?? null, requestId: meta.requestId ?? null });
  return loaded;
}

/** Staff creates a ticket on behalf of a customer (booking must belong to the customer and lie inside the user's scope). */
export async function createTicket(tx: Executor, ctx: TicketWriteContext, input: CreateTicketInput): Promise<ServiceRequestDetailResponse> {
  const actor: AuditActor = { type: "STAFF", id: ctx.user.id, name: ctx.user.name };
  const t = await createTicketCore(tx, ctx.user.companyId, input, actor, ctx.meta, {
    scopeUser: ctx.user,
    bookingNotTheirs: () => ApiError.badRequest("booking_id does not exist or does not belong to this customer", { field: "booking_id" }),
  });
  return ticketDetail(tx, t);
}

/** Portal: the customer raises a ticket (booking must be theirs — primary or co-applicant — else 404). */
export async function createTicketForCustomer(
  tx: Executor,
  input: { customerId: string; bookingId: string | null; categoryId: string; priority?: ServicePriority | null; subject: string; description: string; attachmentIds?: readonly string[] },
  meta: WriteMeta = {},
): Promise<CustomerTicketDetail> {
  const [c] = await tx.select({ companyId: customers.companyId, name: customers.fullName }).from(customers).where(eq(customers.id, input.customerId)).limit(1);
  if (!c) throw ApiError.notFound("Customer");
  const actor: AuditActor = { type: "CUSTOMER", id: input.customerId, name: c.name };
  const t = await createTicketCore(tx, c.companyId, { ...input, assigneeUserId: null }, actor, meta, { bookingNotTheirs: () => ApiError.notFound("Booking") });
  return customerTicketDetail(tx, t);
}

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

/** 422 BUSINESS_RULE (rule INVALID_STATUS_TRANSITION) unless `from → to` is allowed. */
export function assertTransition(from: ServiceStatus, to: ServiceStatus): void {
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    throw ApiError.rule(`Cannot move a ticket from ${from} to ${to}`, "INVALID_STATUS_TRANSITION", { from, to, allowed: STATUS_TRANSITIONS[from] });
  }
}

/** Column changes implied by a transition (resolved_at / closed_at stamps, reopen counter). */
export function statusPatch(current: Pick<DbTicket, "status" | "resolvedAt">, to: ServiceStatus, now: Date): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: to };
  if (to === "RESOLVED") patch["resolvedAt"] = now;
  if (to === "CLOSED") { patch["closedAt"] = now; if (!current.resolvedAt) patch["resolvedAt"] = now; }
  if (current.status === "RESOLVED" && to === "IN_PROGRESS") { patch["reopenedCount"] = sql`${serviceRequests.reopenedCount} + 1`; patch["resolvedAt"] = null; patch["closedAt"] = null; }
  return patch;
}

/** 409 TICKET_CLOSED: a closed ticket accepts no messages, edits or assignment (state conflict, like REOPEN_WINDOW_CLOSED / ALREADY_RATED). */
function assertOpen(t: DbTicket): void {
  if (t.status === "CLOSED") throw ApiError.conflict("TICKET_CLOSED", "This request is closed and can no longer be changed", { status: t.status, closed_at: iso(t.closedAt) });
}

async function notifyCustomerReply(tx: Executor, t: DbTicket, body: string): Promise<void> {
  await notify(tx, {
    companyId: t.companyId, recipients: [{ type: "CUSTOMER", id: t.customerId }], type: "TICKET_STAFF_REPLY",
    title: `Reply on your request ${t.ticketNumber}`, body: truncate(body), entityType: TICKET_ENTITY, entityId: t.id, link: `/requests/${t.id}`,
  });
}

/** Notifies the assignee (or Super Admin when unassigned) about customer activity on a ticket. */
async function notifyStaffOfCustomer(tx: Executor, t: DbTicket, title: string, body: string): Promise<void> {
  const base = { type: "TICKET_CUSTOMER_REPLY" as const, title, body: truncate(body), entityType: TICKET_ENTITY, entityId: t.id, link: `/service-requests/${t.id}` };
  if (t.assigneeUserId) await notify(tx, { companyId: t.companyId, recipients: [{ type: "STAFF", id: t.assigneeUserId }], ...base });
  else await notifyRole(tx, t.companyId, TICKET_ADMIN_ROLES, base);
}

// ---------------------------------------------------------------------------
// Staff mutations
// ---------------------------------------------------------------------------

/** PATCH: priority (re-derives sla_due_at from created_at + hours), category, subject, description. */
export async function updateTicket(
  tx: Executor,
  ctx: TicketWriteContext,
  id: string,
  expectedVersion: number,
  patch: { priority?: ServicePriority | undefined; category_id?: string | undefined; subject?: string | undefined; description?: string | undefined },
): Promise<ServiceRequestDetailResponse> {
  const existing = await requireStaffTicket(tx, ctx.user, id, true);
  assertOpen(existing.sr);
  const before = toTicketRow(existing);
  const changes: Record<string, unknown> = {};
  if (patch.subject !== undefined) changes["subject"] = patch.subject;
  if (patch.description !== undefined) changes["description"] = patch.description;
  if (patch.category_id !== undefined && patch.category_id !== existing.sr.categoryId) changes["categoryId"] = (await resolveCategory(tx, ctx.user.companyId, patch.category_id)).id;
  if (patch.priority !== undefined && patch.priority !== existing.sr.priority) {
    changes["priority"] = patch.priority;
    const company = await companyRow(tx, ctx.user.companyId);
    changes["slaDueAt"] = new Date(slaDueAt(existing.sr.createdAt, patch.priority, slaHoursOf(company)));
  }
  await applyUpdate(tx, serviceRequests, id, expectedVersion, changes, TICKET_ENTITY);
  const updated = (await loadTicket(tx, ctx.user.companyId, id, { includeInternal: true }))!;
  await writeAudit(tx, { companyId: ctx.user.companyId, actor: { type: "STAFF", id: ctx.user.id, name: ctx.user.name }, action: "service_request.update", entityType: TICKET_ENTITY, entityId: id, before, after: toTicketRow(updated), ip: ctx.meta.ip ?? null, requestId: ctx.meta.requestId ?? null });
  return ticketDetail(tx, updated);
}

/** Assigns (or unassigns with null) a ticket; the new assignee is notified. */
export async function assignTicket(tx: Executor, ctx: TicketWriteContext, id: string, expectedVersion: number, assigneeUserId: string | null): Promise<ServiceRequestDetailResponse> {
  const existing = await requireStaffTicket(tx, ctx.user, id, true);
  assertOpen(existing.sr);
  const assignee = assigneeUserId ? await resolveAssignee(tx, ctx.user.companyId, assigneeUserId) : null;
  const updated = await applyUpdate(tx, serviceRequests, id, expectedVersion, { assigneeUserId: assignee?.id ?? null }, TICKET_ENTITY);
  if (assignee && assignee.id !== existing.sr.assigneeUserId) {
    await notify(tx, {
      companyId: ctx.user.companyId, recipients: [{ type: "STAFF", id: assignee.id }], type: "TICKET_NEW",
      title: `Ticket ${updated.ticketNumber} assigned to you`, body: `${updated.subject} · ${updated.priority}`, entityType: TICKET_ENTITY, entityId: id, link: `/service-requests/${id}`,
    });
  }
  await writeAudit(tx, {
    companyId: ctx.user.companyId, actor: { type: "STAFF", id: ctx.user.id, name: ctx.user.name }, action: "service_request.assign", entityType: TICKET_ENTITY, entityId: id,
    before: { assignee_user_id: existing.sr.assigneeUserId, assignee_name: existing.assigneeName }, after: { assignee_user_id: assignee?.id ?? null, assignee_name: assignee?.name ?? null },
    ip: ctx.meta.ip ?? null, requestId: ctx.meta.requestId ?? null,
  });
  return ticketDetail(tx, (await loadTicket(tx, ctx.user.companyId, id, { includeInternal: true }))!);
}

/** Explicit status change; RESOLVED stamps resolved_at, CLOSED stamps closed_at; an optional note becomes a public reply. */
export async function changeStatus(tx: Executor, ctx: TicketWriteContext, id: string, expectedVersion: number, status: ServiceStatus, note?: string | null): Promise<ServiceRequestDetailResponse> {
  const existing = await requireStaffTicket(tx, ctx.user, id, true);
  assertTransition(existing.sr.status, status);
  const now = new Date();
  const patch = statusPatch(existing.sr, status, now);
  const noteText = note?.trim();
  if (noteText) {
    await tx.insert(serviceRequestMessages).values({ ticketId: id, authorType: "STAFF", authorId: ctx.user.id, authorName: ctx.user.name, body: noteText, isInternal: false, attachmentIds: [] });
    patch["lastMessageAt"] = now;
  }
  const updated = await applyUpdate(tx, serviceRequests, id, expectedVersion, patch, TICKET_ENTITY);
  if (noteText) await notifyCustomerReply(tx, updated, noteText);
  await writeAudit(tx, {
    companyId: ctx.user.companyId, actor: { type: "STAFF", id: ctx.user.id, name: ctx.user.name }, action: "service_request.status", entityType: TICKET_ENTITY, entityId: id,
    before: { status: existing.sr.status }, after: { status: updated.status, resolved_at: iso(updated.resolvedAt), closed_at: iso(updated.closedAt), note: noteText ?? null },
    ip: ctx.meta.ip ?? null, requestId: ctx.meta.requestId ?? null,
  });
  return ticketDetail(tx, (await loadTicket(tx, ctx.user.companyId, id, { includeInternal: true }))!);
}

/**
 * Staff message. Internal notes never reach the customer; a public reply notifies the customer and (when no explicit `status` is given)
 * moves a NEW ticket to IN_PROGRESS. An explicit `status` must be a valid transition (e.g. AWAITING_CUSTOMER when asking for information).
 */
export async function addStaffMessage(
  tx: Executor,
  ctx: TicketWriteContext,
  id: string,
  expectedVersion: number | null,
  input: { body: string; is_internal: boolean; attachment_ids: readonly string[]; status?: ServiceStatus | undefined },
): Promise<ServiceRequestDetailResponse> {
  const existing = await requireStaffTicket(tx, ctx.user, id, true);
  assertOpen(existing.sr);
  await assertAttachments(tx, ctx.user.companyId, input.attachment_ids, { ticketId: id, customerId: existing.sr.customerId, bookingId: existing.sr.bookingId });
  const now = new Date();
  const [msg] = await tx.insert(serviceRequestMessages).values({ ticketId: id, authorType: "STAFF", authorId: ctx.user.id, authorName: ctx.user.name, body: input.body, isInternal: input.is_internal, attachmentIds: [...input.attachment_ids] }).returning({ id: serviceRequestMessages.id });
  let patch: Record<string, unknown> = { lastMessageAt: now };
  if (input.status !== undefined && input.status !== existing.sr.status) {
    assertTransition(existing.sr.status, input.status);
    patch = { ...patch, ...statusPatch(existing.sr, input.status, now) };
  } else if (input.status === undefined && !input.is_internal && existing.sr.status === "NEW") {
    patch = { ...patch, ...statusPatch(existing.sr, "IN_PROGRESS", now) };
  }
  const updated = await applyUpdate(tx, serviceRequests, id, expectedVersion ?? existing.sr.version, patch, TICKET_ENTITY);
  if (!input.is_internal) await notifyCustomerReply(tx, updated, input.body);
  await writeAudit(tx, {
    companyId: ctx.user.companyId, actor: { type: "STAFF", id: ctx.user.id, name: ctx.user.name }, action: "service_request.message", entityType: TICKET_ENTITY, entityId: id,
    before: { status: existing.sr.status }, after: { message_id: msg?.id ?? null, is_internal: input.is_internal, status: updated.status, attachment_count: input.attachment_ids.length },
    ip: ctx.meta.ip ?? null, requestId: ctx.meta.requestId ?? null,
  });
  return ticketDetail(tx, (await loadTicket(tx, ctx.user.companyId, id, { includeInternal: true }))!);
}

// ---------------------------------------------------------------------------
// Customer (portal) functions
// ---------------------------------------------------------------------------

/** Customer list filter (portal `GET /portal/requests`). */
export interface CustomerTicketFilter {
  status?: ServiceStatus | undefined;
  booking_id?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  sort?: string | undefined;
}

/** Tickets raised by the customer, newest first (no staff ids, no internal-note counts). */
export async function listTicketsForCustomer(executor: Executor, customerId: string, q: CustomerTicketFilter = {}): Promise<ListResult<CustomerTicketRow>> {
  const where: (SQL | undefined)[] = [eq(serviceRequests.customerId, customerId)];
  if (q.status) where.push(eq(serviceRequests.status, q.status));
  if (q.booking_id) where.push(eq(serviceRequests.bookingId, q.booking_id));
  const result = await paginate<TicketJoined>(executor, {
    table: serviceRequests,
    select: ticketSelect(false),
    join: withTicketJoins,
    where: and(...where.filter((w): w is SQL => w !== undefined)),
    sort: { allowed: { created_at: serviceRequests.createdAt, updated_at: serviceRequests.updatedAt, last_message_at: serviceRequests.lastMessageAt, status: serviceRequests.status }, default: "-created_at", requested: q.sort },
    ...fromListQuery({ page: q.page ?? 1, page_size: q.page_size ?? 25, cursor: q.cursor, limit: q.limit, include_inactive: false }),
  });
  const now = new Date();
  return { ...result, items: result.items.map((r) => toCustomerTicketRow(r, now)) };
}

/** One ticket of the customer with its thread (internal notes stripped); 404 when it is not theirs. */
export async function ticketForCustomer(executor: Executor, ticketId: string, customerId: string): Promise<CustomerTicketDetail> {
  return customerTicketDetail(executor, await requireCustomerTicket(executor, ticketId, customerId));
}

/** Customer reply: AWAITING_CUSTOMER → IN_PROGRESS, notifies the assignee (or Super Admin). 404 when not theirs, 409 TICKET_CLOSED when closed. */
export async function addCustomerMessage(tx: Executor, ticketId: string, customerId: string, body: string, attachmentIds: readonly string[] = [], meta: WriteMeta = {}): Promise<CustomerTicketDetail> {
  const existing = await requireCustomerTicket(tx, ticketId, customerId, true);
  assertOpen(existing.sr);
  await assertAttachments(tx, existing.sr.companyId, attachmentIds, { ticketId, customerId, bookingId: existing.sr.bookingId });
  const now = new Date();
  const [msg] = await tx.insert(serviceRequestMessages).values({ ticketId, authorType: "CUSTOMER", authorId: customerId, authorName: existing.customerName, body, isInternal: false, attachmentIds: [...attachmentIds] }).returning({ id: serviceRequestMessages.id });
  const patch: Record<string, unknown> = { lastMessageAt: now };
  if (existing.sr.status === "AWAITING_CUSTOMER") Object.assign(patch, statusPatch(existing.sr, "IN_PROGRESS", now));
  const updated = await applyUpdate(tx, serviceRequests, ticketId, existing.sr.version, patch, TICKET_ENTITY);
  await notifyStaffOfCustomer(tx, updated, `Customer replied on ${updated.ticketNumber}`, body);
  await writeAudit(tx, {
    companyId: existing.sr.companyId, actor: { type: "CUSTOMER", id: customerId, name: existing.customerName }, action: "service_request.message", entityType: TICKET_ENTITY, entityId: ticketId,
    before: { status: existing.sr.status }, after: { message_id: msg?.id ?? null, is_internal: false, status: updated.status, attachment_count: attachmentIds.length }, ip: meta.ip ?? null, requestId: meta.requestId ?? null,
  });
  return customerTicketDetail(tx, (await requireCustomerTicket(tx, ticketId, customerId)));
}

/** Customer reopens a RESOLVED ticket within 7 days of resolved_at → IN_PROGRESS, reopened_count + 1; otherwise 409 REOPEN_WINDOW_CLOSED. */
export async function reopenByCustomer(tx: Executor, ticketId: string, customerId: string, reason?: string | null, meta: WriteMeta = {}): Promise<CustomerTicketDetail> {
  const existing = await requireCustomerTicket(tx, ticketId, customerId, true);
  const now = new Date();
  if (!canReopen(existing.sr, now)) {
    throw ApiError.conflict("REOPEN_WINDOW_CLOSED", `This request can only be reopened within ${SERVICE_REOPEN_WINDOW_DAYS} days of being resolved`, {
      status: existing.sr.status, resolved_at: iso(existing.sr.resolvedAt), window_days: SERVICE_REOPEN_WINDOW_DAYS,
    });
  }
  const patch = statusPatch(existing.sr, "IN_PROGRESS", now);
  const reasonText = reason?.trim();
  if (reasonText) {
    await tx.insert(serviceRequestMessages).values({ ticketId, authorType: "CUSTOMER", authorId: customerId, authorName: existing.customerName, body: `Reopened: ${reasonText}`, isInternal: false, attachmentIds: [] });
    patch["lastMessageAt"] = now;
  }
  const updated = await applyUpdate(tx, serviceRequests, ticketId, existing.sr.version, patch, TICKET_ENTITY);
  await notifyStaffOfCustomer(tx, updated, `Ticket ${updated.ticketNumber} reopened by customer`, reasonText ?? updated.subject);
  await writeAudit(tx, {
    companyId: existing.sr.companyId, actor: { type: "CUSTOMER", id: customerId, name: existing.customerName }, action: "service_request.reopen", entityType: TICKET_ENTITY, entityId: ticketId,
    before: { status: existing.sr.status, reopened_count: existing.sr.reopenedCount }, after: { status: updated.status, reopened_count: updated.reopenedCount, reason: reasonText ?? null }, ip: meta.ip ?? null, requestId: meta.requestId ?? null,
  });
  return customerTicketDetail(tx, await requireCustomerTicket(tx, ticketId, customerId));
}

/** Customer rates a RESOLVED/CLOSED ticket once (1–5); rating a RESOLVED ticket closes it. 422 when not resolved, 409 ALREADY_RATED. */
export async function rateByCustomer(tx: Executor, ticketId: string, customerId: string, rating: number, comment?: string | null, meta: WriteMeta = {}): Promise<CustomerTicketDetail> {
  const existing = await requireCustomerTicket(tx, ticketId, customerId, true);
  if (!TERMINAL_STATUSES.includes(existing.sr.status)) throw ApiError.rule("Only resolved or closed requests can be rated", "TICKET_NOT_RESOLVED", { status: existing.sr.status });
  if (existing.sr.rating !== null) throw ApiError.conflict("ALREADY_RATED", "This request has already been rated", { rating: existing.sr.rating });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw ApiError.badRequest("rating must be between 1 and 5", { field: "rating" });
  const now = new Date();
  const patch: Record<string, unknown> = { rating, ratingComment: comment?.trim() || null };
  if (existing.sr.status === "RESOLVED") Object.assign(patch, statusPatch(existing.sr, "CLOSED", now));
  const updated = await applyUpdate(tx, serviceRequests, ticketId, existing.sr.version, patch, TICKET_ENTITY);
  await writeAudit(tx, {
    companyId: existing.sr.companyId, actor: { type: "CUSTOMER", id: customerId, name: existing.customerName }, action: "service_request.rate", entityType: TICKET_ENTITY, entityId: ticketId,
    before: { status: existing.sr.status, rating: null }, after: { status: updated.status, rating: updated.rating, rating_comment: updated.ratingComment }, ip: meta.ip ?? null, requestId: meta.requestId ?? null,
  });
  return customerTicketDetail(tx, await requireCustomerTicket(tx, ticketId, customerId));
}
