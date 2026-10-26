/** Staff routes for service requests: list/csv, kanban board, SLA breaches, create, detail, patch, assign, messages, status. */
import { and, count, desc, eq, isNull, not, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  SERVICE_STATUSES,
  ServiceAssignSchema,
  ServiceBoardQuerySchema,
  ServiceFilterSchema,
  ServiceKanbanResponseSchema,
  ServiceListResponseSchema,
  ServiceMessageCreateSchema,
  ServiceRequestCreateSchema,
  ServiceRequestDetailResponseSchema,
  ServiceRequestUpdateSchema,
  ServiceStatusChangeSchema,
  type ServiceFilter,
  type ServiceRequestRow,
} from "@kkt/contracts";
import { bookings, customers, serviceRequests } from "@kkt/db";
import { sendCsv } from "../../lib/csv.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess } from "../../lib/scope.js";
import { expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import {
  TICKET_SEARCH_COLUMNS,
  TICKET_SORTABLE,
  addStaffMessage,
  assignTicket,
  changeStatus,
  createTicket,
  requireStaffTicket,
  slaBreachedCondition,
  ticketDetail,
  ticketScopeCondition,
  ticketSelect,
  toTicketRow,
  updateTicket,
  withTicketJoins,
  type TicketJoined,
  type TicketWriteContext,
} from "./ticketService.js";

const idParams = z.object({ id: IdSchema });

const CSV_COLUMNS: readonly (keyof ServiceRequestRow)[] = [
  "ticket_number",
  "status",
  "priority",
  "category_name",
  "subject",
  "customer_name",
  "customer_phone",
  "booking_number",
  "project_name",
  "flat_number",
  "assignee_name",
  "sla_due_at",
  "sla_breached_at",
  "is_sla_breached",
  "resolved_at",
  "closed_at",
  "reopened_count",
  "rating",
  "last_message_at",
  "created_at",
];

function ctxOf(req: FastifyRequest): TicketWriteContext {
  return { user: req.user!, meta: { ip: req.clientIp, requestId: req.id } };
}

/** Builds the WHERE of a staff ticket list from the typed filter (company, scope, typed filters). */
function ticketWhere(req: FastifyRequest, q: Partial<ServiceFilter>, now: Date): SQL {
  const user = req.user!;
  const where: (SQL | undefined)[] = [eq(serviceRequests.companyId, user.companyId), ticketScopeCondition(user)];
  if (q.status) where.push(eq(serviceRequests.status, q.status));
  if (q.priority) where.push(eq(serviceRequests.priority, q.priority));
  if (q.category_id) where.push(eq(serviceRequests.categoryId, q.category_id));
  if (q.assignee_user_id) where.push(eq(serviceRequests.assigneeUserId, q.assignee_user_id));
  if (q.customer_id) where.push(eq(serviceRequests.customerId, q.customer_id));
  if (q.booking_id) where.push(eq(serviceRequests.bookingId, q.booking_id));
  if (q.project_id) {
    ensureProjectAccess(user, q.project_id); // a scoped user must not learn that a foreign project exists: 404, never 403
    where.push(eq(bookings.projectId, q.project_id));
  }
  if (q.sla_breached === true) where.push(slaBreachedCondition(now));
  if (q.sla_breached === false) where.push(not(slaBreachedCondition(now)));
  if (q.unassigned === true) where.push(isNull(serviceRequests.assigneeUserId));
  return and(...where.filter((w): w is SQL => w !== undefined))!;
}

async function listTickets(app: FastifyInstance, req: FastifyRequest, q: ServiceFilter, extra?: SQL) {
  const now = new Date();
  const where = extra ? and(ticketWhere(req, q, now), extra)! : ticketWhere(req, q, now);
  const result = await paginate<TicketJoined>(app.dbReplica, {
    table: serviceRequests,
    select: ticketSelect(true),
    join: withTicketJoins,
    where,
    search: { columns: TICKET_SEARCH_COLUMNS, term: q.search },
    sort: { allowed: TICKET_SORTABLE, default: "-created_at", requested: q.sort },
    ...listPaging(q),
  });
  return { ...result, items: result.items.map((r) => toTicketRow(r, now)) };
}

/** Registers the /service-requests staff routes. */
export function ticketRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/service-requests",
    permission: "service.read",
    schema: {
      querystring: ServiceFilterSchema,
      response: { 200: ServiceListResponseSchema },
      summary: "List service requests (filters, search, csv)",
    },
    handler: async (req, reply) => {
      const result = await listTickets(app, req, req.query);
      if (req.query.format === "csv")
        return sendCsv(
          reply,
          "service-requests.csv",
          CSV_COLUMNS.map((k) => ({ key: k, header: k })),
          result.items,
        );
      return result;
    },
  });

  route(app, {
    method: "GET",
    url: "/service-requests/sla-breaches",
    permission: "service.read",
    schema: {
      querystring: ServiceFilterSchema,
      response: { 200: ServiceListResponseSchema },
      summary: "Open tickets past their SLA (flagged or overdue now)",
    },
    handler: async (req, reply) => {
      const now = new Date();
      const result = await listTickets(app, req, { ...req.query, sla_breached: undefined }, slaBreachedCondition(now));
      if (req.query.format === "csv")
        return sendCsv(
          reply,
          "sla-breaches.csv",
          CSV_COLUMNS.map((k) => ({ key: k, header: k })),
          result.items,
        );
      return result;
    },
  });

  route(app, {
    method: "GET",
    url: "/service-requests/board",
    permission: "service.read",
    schema: {
      querystring: ServiceBoardQuerySchema,
      response: { 200: ServiceKanbanResponseSchema },
      summary: "Kanban: one column per status",
    },
    handler: async (req) => {
      const now = new Date();
      const q = req.query;
      const where = ticketWhere(
        req,
        {
          priority: q.priority,
          category_id: q.category_id,
          assignee_user_id: q.assignee_user_id,
          project_id: q.project_id,
        },
        now,
      );
      // Per-status counts (one grouped query) and up to `column_limit` newest tickets per column (one capped query per column), all in parallel.
      const [counts, ...columns] = await Promise.all([
        app.dbReplica
          .select({ status: serviceRequests.status, n: count() })
          .from(serviceRequests)
          .innerJoin(customers, eq(customers.id, serviceRequests.customerId))
          .leftJoin(bookings, eq(bookings.id, serviceRequests.bookingId))
          .where(where)
          .groupBy(serviceRequests.status),
        ...SERVICE_STATUSES.map((status) =>
          withTicketJoins(app.dbReplica.select(ticketSelect(true)).from(serviceRequests).$dynamic())
            .where(and(where, eq(serviceRequests.status, status)))
            .orderBy(desc(serviceRequests.createdAt), desc(serviceRequests.id))
            .limit(q.column_limit),
        ),
      ]);
      const countBy = new Map(counts.map((c) => [c.status, Number(c.n)]));
      return {
        columns: SERVICE_STATUSES.map((status, i) => ({
          status,
          count: countBy.get(status) ?? 0,
          tickets: (columns[i] as TicketJoined[]).map((r) => toTicketRow(r, now)),
        })),
      };
    },
  });

  route(app, {
    method: "POST",
    url: "/service-requests",
    permission: "service.write",
    idempotent: true,
    schema: {
      body: ServiceRequestCreateSchema,
      response: { 201: ServiceRequestDetailResponseSchema },
      summary: "Create a ticket on behalf of a customer",
    },
    handler: async (req, reply) => {
      const b = req.body;
      const detail = await app.db.transaction((tx) =>
        createTicket(tx, ctxOf(req), {
          customerId: b.customer_id,
          bookingId: b.booking_id ?? null,
          categoryId: b.category_id,
          priority: b.priority ?? null,
          subject: b.subject,
          description: b.description,
          attachmentIds: b.attachment_ids,
          assigneeUserId: b.assignee_user_id ?? null,
        }),
      );
      return reply.code(201).send(detail);
    },
  });

  route(app, {
    method: "GET",
    url: "/service-requests/:id",
    permission: "service.read",
    schema: {
      params: idParams,
      response: { 200: ServiceRequestDetailResponseSchema },
      summary: "Ticket with its thread (internal notes included for staff)",
    },
    handler: async (req) =>
      ticketDetail(app.dbReplica, await requireStaffTicket(app.dbReplica, req.user!, req.params.id)),
  });

  route(app, {
    method: "PATCH",
    url: "/service-requests/:id",
    permission: "service.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(ServiceRequestUpdateSchema),
      response: { 200: ServiceRequestDetailResponseSchema },
      summary: "Edit priority / category / subject / description",
    },
    handler: async (req) => {
      const version = expectedVersion(req, req.body);
      const { version: _v, ...patch } = req.body;
      return app.db.transaction((tx) => updateTicket(tx, ctxOf(req), req.params.id, version, patch));
    },
  });

  route(app, {
    method: "POST",
    url: "/service-requests/:id/assign",
    permission: "service.assign",
    schema: {
      params: idParams,
      body: withOptionalVersion(ServiceAssignSchema),
      response: { 200: ServiceRequestDetailResponseSchema },
      summary: "Assign (or unassign) a ticket",
    },
    handler: async (req) => {
      const version = expectedVersion(req, req.body);
      return app.db.transaction((tx) =>
        assignTicket(tx, ctxOf(req), req.params.id, version, req.body.assignee_user_id),
      );
    },
  });

  route(app, {
    method: "POST",
    url: "/service-requests/:id/messages",
    permission: "service.write",
    idempotent: true,
    schema: {
      params: idParams,
      body: ServiceMessageCreateSchema,
      response: { 201: ServiceRequestDetailResponseSchema },
      summary: "Reply (public) or add an internal note",
    },
    handler: async (req, reply) => {
      const detail = await app.db.transaction(async (tx) => {
        const current = await requireStaffTicket(tx, req.user!, req.params.id);
        const version = optionalExpectedVersion(req, null, current.sr.version);
        return addStaffMessage(tx, ctxOf(req), req.params.id, version, req.body);
      });
      return reply.code(201).send(detail);
    },
  });

  route(app, {
    method: "POST",
    url: "/service-requests/:id/status",
    permission: "service.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(ServiceStatusChangeSchema),
      response: { 200: ServiceRequestDetailResponseSchema },
      summary: "Change status (NEW → IN_PROGRESS → AWAITING_CUSTOMER → RESOLVED → CLOSED)",
    },
    handler: async (req) => {
      const version = expectedVersion(req, req.body);
      return app.db.transaction((tx) =>
        changeStatus(tx, ctxOf(req), req.params.id, version, req.body.status, req.body.note ?? null),
      );
    },
  });
}
