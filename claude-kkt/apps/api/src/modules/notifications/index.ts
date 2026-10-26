import { and, count, eq, inArray, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  NotificationCountResponseSchema, NotificationFilterSchema, NotificationListResponseSchema, NotificationMarkReadSchema, NotificationRowSchema,
  PortalMarkReadSchema, PortalNotificationCountResponseSchema, PortalNotificationListResponseSchema, type NotificationRecipientType, type NotificationRow, type PortalNotificationRow,
} from "@kkt/contracts";
import { notifications } from "@kkt/db";
import { registerJob } from "../../jobs/index.js";
import { ApiError } from "../../lib/errors.js";
import { fromListQuery, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { sweepNotifications } from "./sweep.js";

export { notify, notifyRole, withdraw } from "./service.js";
export { sweepNotifications, SWEEP_TARGETS, SWEEP_BATCH, type SweepResult } from "./sweep.js";

type DbNotification = typeof notifications.$inferSelect;

function toRow(n: DbNotification): NotificationRow {
  return {
    id: n.id, recipient_type: n.recipientType, recipient_id: n.recipientId, type: n.type as NotificationRow["type"], title: n.title, body: n.body ?? "",
    entity_type: n.entityType, entity_id: n.entityId, link: n.link, is_read: n.isRead, read_at: n.readAt ? n.readAt.toISOString() : null, is_withdrawn: n.isWithdrawn, created_at: n.createdAt.toISOString(),
  };
}

const SCREEN_BY_ENTITY: Record<string, PortalNotificationRow["screen"]> = {
  demand: "DEMANDS", booking_other_charge: "DEMANDS", payment: "LEDGER", booking: "HOME", block_stage: "CONSTRUCTION", service_request: "REQUEST", notice: "NOTICE", document: "DOCUMENTS", installment: "SCHEDULE",
};

function toPortalRow(n: DbNotification): PortalNotificationRow {
  return {
    id: n.id, type: n.type as PortalNotificationRow["type"], title: n.title, body: n.body ?? "", screen: SCREEN_BY_ENTITY[n.entityType ?? ""] ?? "HOME",
    entity_id: n.entityId, booking_id: n.entityType === "booking" ? n.entityId : null, is_read: n.isRead, created_at: n.createdAt.toISOString(),
  };
}

/** Notifications module: staff bell at /notifications and customer bell at /portal/notifications (same storage). */
export async function notificationsModule(app: FastifyInstance): Promise<void> {
  registerJob("NOTIFICATION_SWEEP", async ({ db }) => ({ ...(await sweepNotifications(db)) }));
  const recipientOf = (req: { user?: { id: string }; customer?: { customerId: string } }): { type: NotificationRecipientType; id: string } =>
    req.user ? { type: "STAFF", id: req.user.id } : { type: "CUSTOMER", id: req.customer!.customerId };

  async function list(req: { user?: { id: string }; customer?: { customerId: string } }, q: z.infer<typeof NotificationFilterSchema>) {
    const r = recipientOf(req);
    const where: (SQL | undefined)[] = [eq(notifications.recipientType, r.type), eq(notifications.recipientId, r.id)];
    if (!q.include_withdrawn) where.push(eq(notifications.isWithdrawn, false));
    if (q.unread_only) where.push(eq(notifications.isRead, false));
    if (q.type) where.push(eq(notifications.type, q.type));
    return paginate<DbNotification>(app.dbReplica, {
      table: notifications,
      where: and(...where.filter((w): w is SQL => w !== undefined)),
      search: { columns: [notifications.title, notifications.body], term: q.search },
      sort: { allowed: { created_at: notifications.createdAt }, default: "-created_at", requested: q.sort },
      ...fromListQuery(q),
    });
  }

  async function unread(req: { user?: { id: string }; customer?: { customerId: string } }) {
    const r = recipientOf(req);
    const [row] = await app.dbReplica.select({ n: count() }).from(notifications).where(and(eq(notifications.recipientType, r.type), eq(notifications.recipientId, r.id), eq(notifications.isRead, false), eq(notifications.isWithdrawn, false)));
    return { unread: Number(row?.n ?? 0) };
  }

  async function markRead(req: { user?: { id: string }; customer?: { customerId: string } }, body: { ids?: string[] | undefined; all: boolean }) {
    const r = recipientOf(req);
    const where = [eq(notifications.recipientType, r.type), eq(notifications.recipientId, r.id), eq(notifications.isRead, false)];
    if (!body.all && body.ids) where.push(inArray(notifications.id, body.ids));
    const rows = await app.db.update(notifications).set({ isRead: true, readAt: new Date() }).where(and(...where)).returning({ id: notifications.id });
    return { updated: rows.length };
  }

  route(app, { method: "GET", url: "/notifications", permission: "notification.read", schema: { querystring: NotificationFilterSchema, response: { 200: NotificationListResponseSchema }, summary: "Staff bell" }, handler: async (req) => { const r = await list(req, req.query); return { ...r, items: r.items.map(toRow) }; } });
  route(app, { method: "GET", url: "/notifications/unread-count", permission: "notification.read", schema: { response: { 200: NotificationCountResponseSchema }, summary: "Unread count (excludes withdrawn)" }, handler: async (req) => unread(req) });
  route(app, { method: "POST", url: "/notifications/mark-read", permission: "notification.read", schema: { body: NotificationMarkReadSchema, response: { 200: z.object({ updated: z.int() }) }, summary: "Mark notifications read" }, handler: async (req) => markRead(req, req.body) });
  route(app, { method: "GET", url: "/notifications/:id", permission: "notification.read", schema: { params: z.object({ id: z.uuid() }), response: { 200: NotificationRowSchema }, summary: "One notification" }, handler: async (req) => {
    const r = recipientOf(req);
    const [n] = await app.db.select().from(notifications).where(and(eq(notifications.id, req.params.id), eq(notifications.recipientType, r.type), eq(notifications.recipientId, r.id))).limit(1);
    if (!n) throw ApiError.notFound("Notification");
    return toRow(n);
  } });

  route(app, { method: "GET", url: "/portal/notifications", audience: "portal", schema: { querystring: NotificationFilterSchema, response: { 200: PortalNotificationListResponseSchema }, summary: "Customer bell" }, handler: async (req) => { const r = await list(req, req.query); return { ...r, items: r.items.map(toPortalRow) }; } });
  route(app, { method: "GET", url: "/portal/notifications/unread-count", audience: "portal", schema: { response: { 200: PortalNotificationCountResponseSchema }, summary: "Customer unread count (Appendix C: {count})" }, handler: async (req) => ({ count: (await unread(req)).unread }) });
  route(app, { method: "POST", url: "/portal/notifications/mark-read", audience: "portal", schema: { body: PortalMarkReadSchema, response: { 200: z.object({ updated: z.int() }) }, summary: "Mark customer notifications read" }, handler: async (req) => markRead(req, req.body) });
}
