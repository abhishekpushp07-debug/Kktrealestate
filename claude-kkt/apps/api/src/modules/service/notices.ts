/**
 * Notices for buyers (SPEC §13/§15): per project or company-wide, publish/expiry window, soft delete via is_published=false.
 * Publishing notifies every customer with an ACTIVE/COMPLETED booking in the project (or all such customers) exactly once.
 */
import { and, desc, eq, gt, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  NoticeCreateSchema,
  NoticeFilterSchema,
  NoticeListResponseSchema,
  NoticeRowSchema,
  NoticeUpdateSchema,
  type NoticeRow,
  type PortalNoticeRow,
} from "@kkt/contracts";
import {
  bookingCoApplicants,
  bookings,
  customers,
  notices,
  notifications,
  projects,
  users,
  type Executor,
} from "@kkt/db";
import { actorFromRequest, writeAudit, type AuditActor } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate, type ListResult } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import { notify, withdraw } from "../notifications/index.js";
import { customerProjectIdsSubquery } from "./ticketService.js";

/** A notices row. */
export type DbNotice = typeof notices.$inferSelect;
/** Audit / notification entity type of a notice. */
export const NOTICE_ENTITY = "notice";

interface NoticeJoined {
  n: DbNotice;
  projectName: string | null;
  createdByName: string | null;
}

const NOTICE_SELECT = { n: notices, projectName: projects.name, createdByName: users.name };

function withNoticeJoins(q: PgSelect): PgSelect {
  return q.leftJoin(projects, eq(projects.id, notices.projectId)).leftJoin(users, eq(users.id, notices.createdBy));
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Wire row of a notice (staff shape). */
export function toNoticeRow(j: NoticeJoined): NoticeRow {
  const n = j.n;
  return {
    id: n.id,
    company_id: n.companyId,
    created_at: new Date(n.createdAt).toISOString(),
    updated_at: new Date(n.updatedAt).toISOString(),
    created_by: n.createdBy,
    version: n.version,
    project_id: n.projectId,
    project_name: j.projectName,
    title: n.title,
    body_md: n.bodyMd,
    publish_at: iso(n.publishAt),
    expires_at: iso(n.expiresAt),
    is_published: n.isPublished,
    created_by_name: j.createdByName,
  };
}

async function loadNotice(
  executor: Executor,
  companyId: string,
  id: string,
  forUpdate = false,
): Promise<NoticeJoined | null> {
  const q = withNoticeJoins(executor.select(NOTICE_SELECT).from(notices).$dynamic())
    .where(and(eq(notices.id, id), eq(notices.companyId, companyId)))
    .limit(1);
  const rows = await (forUpdate ? q.for("update", { of: notices }) : q);
  return (rows[0] as NoticeJoined | undefined) ?? null;
}

/** Loads a notice for staff; 404 when missing or (project notice) outside the user's scope. */
async function requireNotice(
  executor: Executor,
  user: StaffContext,
  id: string,
  forUpdate = false,
): Promise<NoticeJoined> {
  const j = await loadNotice(executor, user.companyId, id, forUpdate);
  if (!j) throw ApiError.notFound("Notice");
  if (j.n.projectId) ensureProjectAccess(user, j.n.projectId, "Notice");
  return j;
}

/** True when the notice is live right now (published, publish_at reached, not expired). */
export function isLive(n: Pick<DbNotice, "isPublished" | "publishAt" | "expiresAt">, now = new Date()): boolean {
  if (!n.isPublished) return false;
  if (n.publishAt && new Date(n.publishAt).getTime() > now.getTime()) return false;
  if (n.expiresAt && new Date(n.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

/** Customers (primary + co-applicants) with an ACTIVE/COMPLETED booking in the project, or in any project when `projectId` is null. */
async function noticeRecipients(tx: Executor, companyId: string, projectId: string | null): Promise<string[]> {
  const projectCond = projectId ? sql`and b.project_id = ${projectId}` : sql.empty();
  const rows = await tx.execute<{ customer_id: string }>(sql`
    select distinct m.customer_id from (
      select b.customer_id from ${bookings} b where b.company_id = ${companyId} and b.status in ('ACTIVE', 'COMPLETED') ${projectCond}
      union
      select bc.customer_id from ${bookingCoApplicants} bc join ${bookings} b on b.id = bc.booking_id where b.company_id = ${companyId} and b.status in ('ACTIVE', 'COMPLETED') ${projectCond}
    ) m join ${customers} c on c.id = m.customer_id and c.is_active = true`);
  return rows.map((r) => r.customer_id);
}

/**
 * Sends "notice.published" to the eligible customers once per notice (skipped when the notice is not live yet, or when a
 * NOTICE_PUBLISHED notification for it already exists). Returns the number of customers notified.
 */
export async function notifyNoticePublished(
  tx: Executor,
  n: DbNotice,
  projectName: string | null,
  now = new Date(),
): Promise<number> {
  if (!isLive(n, now)) return 0;
  // Withdrawn rows (left by an earlier unpublish) do not count: republishing must reach the buyers again.
  const [already] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.entityType, NOTICE_ENTITY),
        eq(notifications.entityId, n.id),
        eq(notifications.type, "NOTICE_PUBLISHED"),
        eq(notifications.isWithdrawn, false),
      ),
    )
    .limit(1);
  if (already) return 0;
  const customerIds = await noticeRecipients(tx, n.companyId, n.projectId);
  return notify(tx, {
    companyId: n.companyId,
    recipients: customerIds.map((id) => ({ type: "CUSTOMER" as const, id })),
    type: "NOTICE_PUBLISHED",
    title: projectName ? `${projectName}: ${n.title}` : n.title,
    body: n.bodyMd.slice(0, 140),
    entityType: NOTICE_ENTITY,
    entityId: n.id,
    link: `/notices/${n.id}`,
  });
}

/** Hourly sweep (shares the SLA job): notices whose publish_at has now been reached are notified; returns the notice count notified. */
export async function notifyDueNotices(executor: Executor, now = new Date()): Promise<number> {
  const due = await executor
    .select(NOTICE_SELECT)
    .from(notices)
    .leftJoin(projects, eq(projects.id, notices.projectId))
    .leftJoin(users, eq(users.id, notices.createdBy))
    .where(
      and(
        eq(notices.isPublished, true),
        or(isNull(notices.publishAt), lte(notices.publishAt, now)),
        or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
        sql`not exists (select 1 from ${notifications} nt where nt.entity_type = ${NOTICE_ENTITY} and nt.entity_id = ${notices.id} and nt.type = 'NOTICE_PUBLISHED' and nt.is_withdrawn = false)`,
      ),
    );
  let sent = 0;
  for (const j of due as NoticeJoined[]) {
    const n = await executor.transaction((tx) => notifyNoticePublished(tx, j.n, j.projectName, now));
    if (n > 0) sent += 1;
  }
  return sent;
}

/** Notices visible to a customer: live, company-wide or in a project of the customer's ACTIVE/COMPLETED bookings; `is_read` from the bell. */
export async function noticesForCustomer(
  executor: Executor,
  customerId: string,
  q: {
    page?: number | undefined;
    page_size?: number | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<ListResult<PortalNoticeRow>> {
  const [c] = await executor
    .select({ companyId: customers.companyId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) throw ApiError.notFound("Customer");
  const now = new Date();
  const isRead = sql<boolean>`coalesce((select bool_or(nt.is_read) from ${notifications} nt where nt.recipient_type = 'CUSTOMER' and nt.recipient_id = ${customerId} and nt.entity_type = ${NOTICE_ENTITY} and nt.entity_id = ${notices.id} and nt.is_withdrawn = false), false)`;
  const result = await paginate<{ n: DbNotice; projectName: string | null; isRead: boolean }>(executor, {
    table: notices,
    select: { n: notices, projectName: projects.name, isRead },
    join: (qb) => qb.leftJoin(projects, eq(projects.id, notices.projectId)),
    where: and(
      eq(notices.companyId, c.companyId),
      eq(notices.isPublished, true),
      or(isNull(notices.publishAt), lte(notices.publishAt, now)),
      or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
      or(isNull(notices.projectId), sql`${notices.projectId} in ${customerProjectIdsSubquery(customerId)}`),
    ),
    sort: { allowed: { publish_at: notices.publishAt }, default: "-publish_at" },
    page: q.page ?? 1,
    page_size: q.page_size ?? 25,
    cursor: q.cursor,
    limit: q.limit,
  });
  return {
    ...result,
    items: result.items.map((r) => ({
      id: r.n.id,
      title: r.n.title,
      body_md: r.n.bodyMd,
      project_name: r.projectName,
      publish_at: (r.n.publishAt ? new Date(r.n.publishAt) : new Date(r.n.createdAt)).toISOString(),
      expires_at: iso(r.n.expiresAt),
      is_read: Boolean(r.isRead),
    })),
  };
}

function assertWindow(publishAt: Date | null, expiresAt: Date | null): void {
  if (publishAt && expiresAt && publishAt.getTime() > expiresAt.getTime())
    throw ApiError.badRequest("expires_at must be after publish_at", { field: "expires_at" });
}

async function assertProject(tx: Executor, user: StaffContext, projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const [p] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, user.companyId)))
    .limit(1);
  if (!p) throw ApiError.badRequest("project_id does not exist", { field: "project_id" });
  ensureProjectAccess(user, projectId);
}

const idParams = z.object({ id: IdSchema });
const CSV_COLUMNS: readonly (keyof NoticeRow)[] = [
  "title",
  "project_name",
  "is_published",
  "publish_at",
  "expires_at",
  "created_by_name",
  "created_at",
];

function meta(req: FastifyRequest): { actor: AuditActor; ip: string; requestId: string } {
  return { actor: actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

/** Registers the /notices staff routes. */
export function noticeRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/notices",
    permission: "cms.read",
    schema: { querystring: NoticeFilterSchema, response: { 200: NoticeListResponseSchema }, summary: "List notices" },
    handler: async (req, reply) => {
      const q = req.query;
      const user = req.user!;
      const where: (SQL | undefined)[] = [eq(notices.companyId, user.companyId)];
      if (q.project_id) {
        ensureProjectAccess(user, q.project_id);
        where.push(eq(notices.projectId, q.project_id));
      }
      if (q.is_published !== undefined) where.push(eq(notices.isPublished, q.is_published));
      const scope = scopeFilter(user, notices.projectId);
      if (scope) where.push(or(isNull(notices.projectId), scope));
      const result = await paginate<NoticeJoined>(app.dbReplica, {
        table: notices,
        select: NOTICE_SELECT,
        join: withNoticeJoins,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [notices.title, notices.bodyMd], term: q.search },
        sort: {
          allowed: {
            publish_at: notices.publishAt,
            created_at: notices.createdAt,
            title: notices.title,
            expires_at: notices.expiresAt,
          },
          default: "-created_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = result.items.map(toNoticeRow);
      if (q.format === "csv")
        return sendCsv(
          reply,
          "notices.csv",
          CSV_COLUMNS.map((k) => ({ key: k, header: k })),
          items,
        );
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: "/notices",
    permission: "cms.write",
    idempotent: true,
    schema: {
      body: NoticeCreateSchema,
      response: { 201: NoticeRowSchema },
      summary: "Create a notice (publishing notifies the buyers concerned)",
    },
    handler: async (req, reply) => {
      const b = req.body;
      const user = req.user!;
      const m = meta(req);
      const row = await app.db.transaction(async (tx) => {
        await assertProject(tx, user, b.project_id);
        const publishAt = b.publish_at ? new Date(b.publish_at) : b.is_published ? new Date() : null;
        const expiresAt = b.expires_at ? new Date(b.expires_at) : null;
        assertWindow(publishAt, expiresAt);
        const [created] = await tx
          .insert(notices)
          .values({
            companyId: user.companyId,
            projectId: b.project_id ?? null,
            title: b.title,
            bodyMd: b.body_md,
            publishAt,
            expiresAt,
            isPublished: b.is_published,
            createdBy: user.id,
          })
          .returning();
        if (!created) throw new Error("insert returned no row");
        const j = (await loadNotice(tx, user.companyId, created.id))!;
        const notified = await notifyNoticePublished(tx, created, j.projectName);
        const view = toNoticeRow(j);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: m.actor,
          action: "notice.create",
          entityType: NOTICE_ENTITY,
          entityId: created.id,
          after: { ...view, customers_notified: notified },
          ip: m.ip,
          requestId: m.requestId,
        });
        return view;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "GET",
    url: "/notices/:id",
    permission: "cms.read",
    schema: { params: idParams, response: { 200: NoticeRowSchema }, summary: "One notice" },
    handler: async (req) => toNoticeRow(await requireNotice(app.dbReplica, req.user!, req.params.id)),
  });

  route(app, {
    method: "PATCH",
    url: "/notices/:id",
    permission: "cms.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(NoticeUpdateSchema),
      response: { 200: NoticeRowSchema },
      summary: "Update a notice (publishing notifies once)",
    },
    handler: async (req) => {
      const b = req.body;
      const user = req.user!;
      const version = expectedVersion(req, b);
      const m = meta(req);
      return app.db.transaction(async (tx) => {
        const existing = await requireNotice(tx, user, req.params.id, true);
        const before = toNoticeRow(existing);
        if (b.project_id !== undefined) await assertProject(tx, user, b.project_id);
        const changes: Record<string, unknown> = {};
        if (b.project_id !== undefined) changes["projectId"] = b.project_id;
        if (b.title !== undefined) changes["title"] = b.title;
        if (b.body_md !== undefined) changes["bodyMd"] = b.body_md;
        if (b.publish_at !== undefined) changes["publishAt"] = b.publish_at ? new Date(b.publish_at) : null;
        if (b.expires_at !== undefined) changes["expiresAt"] = b.expires_at ? new Date(b.expires_at) : null;
        if (b.is_published !== undefined) changes["isPublished"] = b.is_published;
        const willPublish = (changes["isPublished"] ?? existing.n.isPublished) as boolean;
        const publishAt = (
          changes["publishAt"] !== undefined ? changes["publishAt"] : existing.n.publishAt
        ) as Date | null;
        const expiresAt = (
          changes["expiresAt"] !== undefined ? changes["expiresAt"] : existing.n.expiresAt
        ) as Date | null;
        assertWindow(publishAt, expiresAt);
        // A live notice always carries a publish_at (the customer list sorts and pages by it): publishing without one, or clearing it, means "now".
        if (willPublish && !publishAt) changes["publishAt"] = new Date();
        const updated = await applyUpdate(tx, notices, req.params.id, version, changes, NOTICE_ENTITY);
        const j = (await loadNotice(tx, user.companyId, updated.id))!;
        let notified = 0;
        if (updated.isPublished) notified = await notifyNoticePublished(tx, updated, j.projectName);
        else if (existing.n.isPublished) await withdraw(tx, NOTICE_ENTITY, updated.id);
        const view = toNoticeRow(j);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: m.actor,
          action: "notice.update",
          entityType: NOTICE_ENTITY,
          entityId: updated.id,
          before,
          after: { ...view, customers_notified: notified },
          ip: m.ip,
          requestId: m.requestId,
        });
        return view;
      });
    },
  });

  route(app, {
    method: "DELETE",
    url: "/notices/:id",
    permission: "cms.write",
    schema: {
      params: idParams,
      response: { 200: NoticeRowSchema },
      summary: "Unpublish (soft delete) a notice; its bell notifications are withdrawn (If-Match optional)",
    },
    handler: async (req) => {
      const user = req.user!;
      const m = meta(req);
      return app.db.transaction(async (tx) => {
        const existing = await requireNotice(tx, user, req.params.id, true);
        const version = optionalExpectedVersion(req, null, existing.n.version);
        const updated = await applyUpdate(tx, notices, req.params.id, version, { isPublished: false }, NOTICE_ENTITY);
        const retracted = await withdraw(tx, NOTICE_ENTITY, updated.id);
        const view = toNoticeRow((await loadNotice(tx, user.companyId, updated.id))!);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: m.actor,
          action: "notice.delete",
          entityType: NOTICE_ENTITY,
          entityId: updated.id,
          before: { is_published: existing.n.isPublished },
          after: { is_published: false, ...retracted },
          ip: m.ip,
          requestId: m.requestId,
        });
        return view;
      });
    },
  });
}

/** Newest live notices of a project (or company-wide), for dashboards; bounded. */
export async function liveNotices(
  executor: Executor,
  companyId: string,
  projectId: string | null,
  limit = 10,
): Promise<NoticeRow[]> {
  const now = new Date();
  const rows = await withNoticeJoins(executor.select(NOTICE_SELECT).from(notices).$dynamic())
    .where(
      and(
        eq(notices.companyId, companyId),
        eq(notices.isPublished, true),
        or(isNull(notices.publishAt), lte(notices.publishAt, now)),
        or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
        projectId ? or(isNull(notices.projectId), eq(notices.projectId, projectId)) : isNull(notices.projectId),
      ),
    )
    .orderBy(desc(notices.publishAt), desc(notices.id))
    .limit(limit);
  return (rows as NoticeJoined[]).map(toNoticeRow);
}
