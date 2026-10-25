import { and, count, eq, inArray, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EnquiryFilterSchema, EnquiryListResponseSchema, EnquiryMarkReadSchema, EnquiryRowSchema, EnquiryUnreadCountSchema, IdSchema, type EnquiryRow, type Utm } from "@kkt/contracts";
import { enquiries, flatTypes, leads, projects, type Executor } from "@kkt/db";
import { writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess } from "../../lib/scope.js";
import { metaOf } from "./customerService.js";

const idParams = z.object({ id: IdSchema });

type DbEnquiry = typeof enquiries.$inferSelect;

/** One row of the joined enquiry selection. */
export interface EnquirySelect {
  e: DbEnquiry;
  leadNumber: string | null;
  projectName: string | null;
  flatTypeName: string | null;
}

/** Drizzle selection for enquiry rows; use with `joinEnquiry`. */
export const ENQUIRY_SELECT = { e: enquiries, leadNumber: leads.leadNumber, projectName: projects.name, flatTypeName: flatTypes.name };

/** Left-joins the lead, project and flat type of an enquiry (dynamic query builder). */
export function joinEnquiry(q: PgSelect): PgSelect {
  return q.leftJoin(leads, eq(leads.id, enquiries.leadId)).leftJoin(projects, eq(projects.id, enquiries.projectId)).leftJoin(flatTypes, eq(flatTypes.id, enquiries.flatTypeId));
}

/** Enquiry wire row (no ip, no internal storage). */
export function enquiryRow(r: EnquirySelect): EnquiryRow {
  const e = r.e;
  return {
    id: e.id, lead_id: e.leadId, lead_number: r.leadNumber ?? null, project_id: e.projectId, project_name: r.projectName ?? null, name: e.name, phone: e.phone, email: e.email,
    flat_type_name: r.flatTypeName ?? null, message: e.message, source_page: e.sourcePage, utm: (e.utm as Utm | null) ?? null, reference_number: e.referenceNumber, is_read: e.isRead, created_at: e.createdAt.toISOString(),
  };
}

/** Loads one enquiry of the company (joined); 404 when missing. */
export async function loadEnquirySelect(db: Executor, companyId: string, id: string): Promise<EnquirySelect> {
  const rows = (await db
    .select(ENQUIRY_SELECT)
    .from(enquiries)
    .leftJoin(leads, eq(leads.id, enquiries.leadId))
    .leftJoin(projects, eq(projects.id, enquiries.projectId))
    .leftJoin(flatTypes, eq(flatTypes.id, enquiries.flatTypeId))
    .where(and(eq(enquiries.id, id), eq(enquiries.companyId, companyId)))
    .limit(1)) as EnquirySelect[];
  const row = rows[0];
  if (!row) throw ApiError.notFound("Enquiry");
  return row;
}

/** Marks enquiries read/unread; returns the number of rows that changed. */
export async function markEnquiriesRead(tx: Executor, companyId: string, ids: string[], isRead: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx.update(enquiries).set({ isRead }).where(and(eq(enquiries.companyId, companyId), inArray(enquiries.id, ids), eq(enquiries.isRead, !isRead))).returning({ id: enquiries.id });
  return rows.length;
}

/** Enquiries inbox: list, unread badge, mark read (single and bulk). Rows are inserted by the public module through createEnquiry(). */
export function enquiryRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/enquiries", permission: "lead.read",
    schema: { querystring: EnquiryFilterSchema, response: { 200: EnquiryListResponseSchema }, summary: "Website enquiries inbox" },
    handler: async (req, reply) => {
      const q = req.query;
      const user = req.user!;
      const where: (SQL | undefined)[] = [eq(enquiries.companyId, user.companyId)];
      if (q.is_read !== undefined) where.push(eq(enquiries.isRead, q.is_read));
      if (q.project_id) { ensureProjectAccess(user, q.project_id); where.push(eq(enquiries.projectId, q.project_id)); }
      const result = await paginate<EnquirySelect>(app.dbReplica, {
        table: enquiries,
        select: ENQUIRY_SELECT,
        join: (qb) => joinEnquiry(qb),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [enquiries.name, enquiries.phone, enquiries.referenceNumber, enquiries.email], term: q.search },
        sort: { allowed: { created_at: enquiries.createdAt, name: enquiries.name, reference_number: enquiries.referenceNumber }, default: "-created_at", requested: q.sort },
        ...listPaging(q),
      });
      const items = result.items.map(enquiryRow);
      if (q.format === "csv") {
        const cols = ["reference_number", "name", "phone", "email", "project_name", "flat_type_name", "message", "source_page", "lead_number", "is_read", "created_at"];
        return sendCsv(reply, "enquiries.csv", cols.map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      }
      return { ...result, items };
    },
  });

  route(app, {
    method: "GET", url: "/enquiries/unread-count", permission: "lead.read",
    schema: { response: { 200: EnquiryUnreadCountSchema }, summary: "Unread enquiries (inbox badge)" },
    handler: async (req) => {
      const [r] = await app.dbReplica.select({ n: count() }).from(enquiries).where(and(eq(enquiries.companyId, req.user!.companyId), eq(enquiries.isRead, false)));
      return { unread: Number(r?.n ?? 0) };
    },
  });

  route(app, {
    method: "POST", url: "/enquiries/mark-read", permission: "lead.read",
    schema: { body: EnquiryMarkReadSchema, response: { 200: z.object({ updated: z.int().min(0) }) }, summary: "Mark several enquiries read/unread" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        const updated = await markEnquiriesRead(tx, user.companyId, req.body.ids, req.body.is_read);
        if (updated > 0) await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: req.body.is_read ? "enquiry.read" : "enquiry.unread", entityType: "enquiry", entityId: null, after: { ids: req.body.ids, updated } });
        return { updated };
      });
    },
  });

  route(app, {
    method: "GET", url: "/enquiries/:id", permission: "lead.read",
    schema: { params: idParams, response: { 200: EnquiryRowSchema }, summary: "One enquiry" },
    handler: async (req) => enquiryRow(await loadEnquirySelect(app.dbReplica, req.user!.companyId, req.params.id)),
  });

  route(app, {
    method: "POST", url: "/enquiries/:id/read", permission: "lead.read",
    schema: { params: idParams, body: z.object({ is_read: z.boolean().default(true) }).optional(), response: { 200: EnquiryRowSchema }, summary: "Mark one enquiry read (or unread)" },
    handler: async (req) => {
      const user = req.user!;
      const isRead = req.body?.is_read ?? true;
      return app.db.transaction(async (tx) => {
        const before = await loadEnquirySelect(tx, user.companyId, req.params.id);
        const updated = await markEnquiriesRead(tx, user.companyId, [before.e.id], isRead);
        if (updated > 0) {
          // Opening the enquiry also clears the unread flag of its lead (same inbox badge semantics).
          if (isRead && before.e.leadId) await tx.update(leads).set({ isRead: true }).where(and(eq(leads.id, before.e.leadId), eq(leads.isRead, false)));
          await writeAudit(tx, { companyId: user.companyId, ...metaOf(req), action: isRead ? "enquiry.read" : "enquiry.unread", entityType: "enquiry", entityId: before.e.id, before: { is_read: before.e.isRead }, after: { is_read: isRead } });
        }
        return enquiryRow(await loadEnquirySelect(tx, user.companyId, req.params.id));
      });
    },
  });
}
