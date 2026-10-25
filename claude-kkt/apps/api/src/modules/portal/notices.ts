/**
 * Portal notices and the buyer bell (SPEC §13 buyer bell + retraction rule, §16; Appendix C): notices come from the service module's
 * customer view; notifications are the customer's own rows only, withdrawn ones excluded, each mapped to the portal screen it opens and
 * the booking it concerns (resolved in one batch per entity kind — no per-row lookups).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  PortalMarkReadResponseSchema, PortalMarkReadSchema, PortalNoticeListResponseSchema, PortalNotificationListResponseSchema, PortalUnreadCountSchema,
  type NotificationType, type PortalMarkReadResponse, type PortalNotificationRow,
} from "@kkt/contracts";
import { blockStages, bookings, demands, notifications, payments, serviceRequests, type Executor } from "@kkt/db";
import { writeAudit } from "../../lib/audit.js";
import { paginate, type ListResult } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import type { PortalContext } from "../../lib/scope.js";
import { noticesForCustomer } from "../service/index.js";
import { unreadNotificationCount } from "./bookings.js";
import { PortalListQuerySchema, customerOf, memberCondition, type PortalListQuery } from "./common.js";

type NotificationRecord = typeof notifications.$inferSelect;
type Screen = PortalNotificationRow["screen"];

/** Which portal screen a notification type opens. */
export function screenFor(type: string): Screen {
  switch (type as NotificationType) {
    case "DEMAND_RAISED":
    case "DEMAND_OVERDUE":
      return "DEMANDS";
    case "PAYMENT_RECEIVED":
      return "LEDGER";
    case "STAGE_COMPLETED":
      return "CONSTRUCTION";
    case "TICKET_NEW":
    case "TICKET_CUSTOMER_REPLY":
    case "TICKET_STAFF_REPLY":
    case "TICKET_SLA_BREACH":
      return "REQUEST";
    case "NOTICE_PUBLISHED":
      return "NOTICE";
    default:
      return "HOME";
  }
}

/** Resolves the booking each notification concerns, one query per entity kind (demand, payment, booking, service_request, block_stage). */
async function bookingIdsFor(db: Executor, customer: PortalContext, rows: readonly NotificationRecord[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byKind = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.entityId || !r.entityType) continue;
    byKind.set(r.entityType, [...(byKind.get(r.entityType) ?? []), r.entityId]);
  }
  const pairs: Promise<{ id: string; bookingId: string | null }[]>[] = [];
  const dem = byKind.get("demand");
  if (dem) pairs.push(db.select({ id: demands.id, bookingId: demands.bookingId }).from(demands).where(inArray(demands.id, dem)));
  const pay = byKind.get("payment");
  if (pay) pairs.push(db.select({ id: payments.id, bookingId: payments.bookingId }).from(payments).where(inArray(payments.id, pay)));
  const tix = byKind.get("service_request");
  if (tix) pairs.push(db.select({ id: serviceRequests.id, bookingId: serviceRequests.bookingId }).from(serviceRequests).where(inArray(serviceRequests.id, tix)));
  const stages = byKind.get("block_stage");
  if (stages) {
    // the customer's booking on the tower the stage belongs to (co-applicants included)
    pairs.push(
      db.select({ id: blockStages.id, bookingId: bookings.id }).from(blockStages).innerJoin(bookings, eq(bookings.blockId, blockStages.blockId))
        .where(and(inArray(blockStages.id, stages), eq(bookings.companyId, customer.companyId), memberCondition(customer.customerId), sql`${bookings.status} <> 'CANCELLED'`)),
    );
  }
  for (const id of byKind.get("booking") ?? []) out.set(id, id);
  for (const list of await Promise.all(pairs)) for (const p of list) if (p.bookingId && !out.has(p.id)) out.set(p.id, p.bookingId);
  return out;
}

/** The customer's bell, newest first; withdrawn rows excluded (SPEC §13 retraction rule). */
export async function portalNotifications(db: Executor, customer: PortalContext, q: PortalListQuery): Promise<ListResult<PortalNotificationRow>> {
  const result = await paginate<NotificationRecord>(db, {
    table: notifications,
    where: and(eq(notifications.recipientType, "CUSTOMER"), eq(notifications.recipientId, customer.customerId), eq(notifications.isWithdrawn, false)),
    sort: { allowed: { created_at: notifications.createdAt }, default: "-created_at", requested: q.sort },
    page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit,
  });
  const bookingIds = await bookingIdsFor(db, customer, result.items);
  return {
    ...result,
    items: result.items.map((n) => ({
      id: n.id, type: n.type as NotificationType, title: n.title, body: n.body ?? "", screen: screenFor(n.type), entity_id: n.entityId,
      booking_id: n.entityId ? (bookingIds.get(n.entityId) ?? null) : null, is_read: n.isRead, created_at: new Date(n.createdAt).toISOString(),
    })),
  };
}

/** Marks the customer's own notifications read (by ids, or all); audited as a CUSTOMER action. */
export async function markNotificationsRead(db: FastifyInstance["db"], customer: PortalContext, input: { ids?: string[] | undefined; all: boolean }, meta: { ip: string; requestId: string }): Promise<PortalMarkReadResponse> {
  return db.transaction(async (tx) => {
    const own = and(eq(notifications.recipientType, "CUSTOMER"), eq(notifications.recipientId, customer.customerId), eq(notifications.isRead, false));
    const where = input.all ? own : and(own, inArray(notifications.id, input.ids ?? []));
    const marked = (input.all || (input.ids?.length ?? 0) > 0) ? await tx.update(notifications).set({ isRead: true, readAt: new Date() }).where(where).returning({ id: notifications.id }) : [];
    if (marked.length > 0) {
      await writeAudit(tx, {
        companyId: customer.companyId, actor: { type: "CUSTOMER", id: customer.customerId, name: customer.name }, action: "notification.mark_read", entityType: "notification", entityId: null,
        after: { marked: marked.length, all: input.all, ids: input.all ? null : marked.map((m) => m.id) }, ip: meta.ip, requestId: meta.requestId,
      });
    }
    return { marked: marked.length, unread_count: await unreadNotificationCount(tx, customer.customerId) };
  });
}

/** Registers /portal/notices and /portal/notifications routes. */
export function registerNoticeRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/portal/notices", audience: "portal",
    schema: { querystring: PortalListQuerySchema, response: { 200: PortalNoticeListResponseSchema }, summary: "Live notices: company-wide plus the projects of the customer's bookings" },
    handler: async (req) => noticesForCustomer(app.dbReplica, customerOf(req).customerId, { page: req.query.page, page_size: req.query.page_size, cursor: req.query.cursor, limit: req.query.limit }),
  });

  route(app, {
    method: "GET", url: "/portal/notifications", audience: "portal",
    schema: { querystring: PortalListQuerySchema, response: { 200: PortalNotificationListResponseSchema }, summary: "The customer's notifications (withdrawn ones excluded)" },
    handler: async (req) => portalNotifications(app.dbReplica, customerOf(req), req.query),
  });

  route(app, {
    method: "GET", url: "/portal/notifications/unread-count", audience: "portal",
    schema: { response: { 200: PortalUnreadCountSchema }, summary: "Unread notification count" },
    handler: async (req) => ({ count: await unreadNotificationCount(app.dbReplica, customerOf(req).customerId) }),
  });

  route(app, {
    method: "POST", url: "/portal/notifications/mark-read", audience: "portal",
    schema: { body: PortalMarkReadSchema, response: { 200: PortalMarkReadResponseSchema }, summary: "Mark notifications read (ids or all)" },
    handler: async (req) => markNotificationsRead(app.db, customerOf(req), { ids: req.body.ids, all: req.body.all }, { ip: req.clientIp, requestId: req.id }),
  });
}

/** Newest notifications of a customer (dashboards / tests). */
export async function latestNotifications(db: Executor, customerId: string, limit = 20): Promise<NotificationRecord[]> {
  return db.select().from(notifications).where(and(eq(notifications.recipientType, "CUSTOMER"), eq(notifications.recipientId, customerId), eq(notifications.isWithdrawn, false))).orderBy(desc(notifications.createdAt)).limit(limit);
}
