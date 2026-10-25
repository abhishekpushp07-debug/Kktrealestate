/**
 * Portal service requests (SPEC §13/§16; Appendix C + additions): categories, list, JSON create, detail without internal notes, replies,
 * reopen within 7 days of RESOLVED, rating, and one-file-per-call multipart attachments stored through the documents module as
 * SERVICE_REQUEST documents uploaded by the CUSTOMER. The ticket rules live in the service module; this file maps and guards.
 */
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PortalDocumentRowSchema, PortalRequestCategorySchema, PortalRequestCreateSchema, PortalRequestDetailResponseSchema, PortalRequestFilterSchema, PortalRequestListResponseSchema,
  PortalRequestMessageCreateSchema, PortalRequestRateSchema, PortalRequestReopenSchema,
  type CustomerTicketDetail, type CustomerTicketRow, type PortalDocumentRow, type PortalRequestDetailResponse, type PortalRequestMessage, type PortalRequestRow, type ServiceMessageRow,
} from "@kkt/contracts";
import { serviceCategories } from "@kkt/db";
import { writeAudit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import type { ListResult } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import type { PortalContext } from "../../lib/scope.js";
import { loadJoined, storeBuffer, toDocumentRow } from "../documents/index.js";
import { addCustomerMessage, createTicketForCustomer, listTicketsForCustomer, rateByCustomer, reopenByCustomer, requireCustomerTicket, ticketForCustomer, type WriteMeta } from "../service/index.js";
import { customerOf, idParams } from "./common.js";

function meta(req: FastifyRequest): WriteMeta {
  return { ip: req.clientIp, requestId: req.id };
}

/** Customer ticket row → portal row (no staff ids: the service module already strips assignee / SLA fields). */
export function toPortalRequestRow(t: CustomerTicketRow): PortalRequestRow {
  return {
    id: t.id, ticket_number: t.ticket_number, booking_id: t.booking_id, flat_number: t.flat_number ?? "", category_name: t.category_name, priority: t.priority,
    subject: t.subject, description: t.description, status: t.status, can_reopen: t.can_reopen, can_rate: t.can_rate, rating: t.rating,
    last_message_at: t.last_message_at, created_at: t.created_at, updated_at: t.updated_at,
  };
}

/** Thread message → portal message: the customer's own messages read "YOU"; staff show by name only; internal notes never reach here. */
export function toPortalMessage(m: ServiceMessageRow): PortalRequestMessage {
  const author = m.author_type === "CUSTOMER" ? "YOU" : m.author_type === "STAFF" ? "STAFF" : "SYSTEM";
  return { id: m.id, author, author_name: m.author_name, body: m.body, attachments: m.attachments.map((a) => ({ id: a.id, file_name: a.file_name, mime: a.mime, thumb_url: a.thumb_url })), created_at: m.created_at };
}

export function toPortalRequestDetail(d: CustomerTicketDetail): PortalRequestDetailResponse {
  return { ...toPortalRequestRow(d), messages: d.messages.filter((m) => !m.is_internal).map(toPortalMessage) };
}

/** A parsed single-file multipart upload. */
interface ParsedUpload { buffer: Buffer; filename: string }

/** Reads the one `file` part of a multipart request (413 at the 15 MB limit; 400 without a file). */
async function readSingleFile(req: FastifyRequest): Promise<ParsedUpload> {
  if (!req.isMultipart()) throw ApiError.badRequest("Expected a multipart/form-data upload with a `file` part");
  let file: ParsedUpload | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      if (file) { part.file.resume(); throw ApiError.badRequest("Upload exactly one file per request"); }
      file = { buffer: await part.toBuffer(), filename: part.filename || "file" };
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File exceeds the 15 MB limit");
    if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") throw ApiError.badRequest("Too many parts in the upload");
    throw err;
  }
  if (!file) throw ApiError.badRequest("Missing `file` part");
  return file;
}

/** Active service categories of the company, in display order. */
export async function requestCategories(db: FastifyInstance["db"], companyId: string): Promise<z.infer<typeof PortalRequestCategorySchema>[]> {
  const rows = await db
    .select({ id: serviceCategories.id, name: serviceCategories.name, defaultPriority: serviceCategories.defaultPriority })
    .from(serviceCategories)
    .where(and(eq(serviceCategories.companyId, companyId), eq(serviceCategories.isActive, true)))
    .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
  return rows.map((r) => ({ id: r.id, name: r.name, default_priority: r.defaultPriority }));
}

/** Stores one attachment on the customer's own ticket (404 when not theirs, 409 when closed) and returns its portal row. */
export async function addRequestAttachment(app: FastifyInstance, customer: PortalContext, ticketId: string, upload: ParsedUpload, m: WriteMeta): Promise<PortalDocumentRow> {
  return app.db.transaction(async (tx) => {
    const t = await requireCustomerTicket(tx, ticketId, customer.customerId, true);
    if (t.sr.status === "CLOSED") throw ApiError.conflict("TICKET_CLOSED", "This request is closed and can no longer be changed", { status: t.sr.status });
    const row = await storeBuffer(tx, { companyId: customer.companyId, entityType: "SERVICE_REQUEST", entityId: t.sr.id, buffer: upload.buffer, filename: upload.filename, uploadedBy: customer.customerId, uploadedByType: "CUSTOMER" });
    const joined = await loadJoined(tx, customer.companyId, row.id);
    const doc = toDocumentRow(joined!);
    await writeAudit(tx, {
      companyId: customer.companyId, actor: { type: "CUSTOMER", id: customer.customerId, name: customer.name }, action: "document.upload", entityType: "document", entityId: row.id,
      after: { entity_type: "SERVICE_REQUEST", entity_id: t.sr.id, ticket_number: t.sr.ticketNumber, file_name: doc.file_name, mime: doc.mime, size_bytes: doc.size_bytes }, ip: m.ip ?? null, requestId: m.requestId ?? null,
    });
    return { document_id: doc.id, kind: "ATTACHMENT", title: doc.title, document_type_name: doc.document_type_name, file_name: doc.file_name, mime: doc.mime, size_bytes: doc.size_bytes, shared_at: doc.created_at };
  });
}

/** Registers the /portal/requests routes. */
export function registerRequestRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/portal/requests/categories", audience: "portal",
    schema: { response: { 200: z.array(PortalRequestCategorySchema) }, summary: "Service categories the customer may raise a request under" },
    handler: async (req) => requestCategories(app.dbReplica, customerOf(req).companyId),
  });

  route(app, {
    method: "GET", url: "/portal/requests", audience: "portal",
    schema: { querystring: PortalRequestFilterSchema, response: { 200: PortalRequestListResponseSchema }, summary: "The customer's service requests" },
    handler: async (req): Promise<ListResult<PortalRequestRow>> => {
      const q = req.query;
      const result = await listTicketsForCustomer(app.dbReplica, customerOf(req).customerId, { status: q.status, booking_id: q.booking_id, page: q.page, page_size: q.page_size, cursor: q.cursor, limit: q.limit, sort: q.sort });
      return { ...result, items: result.items.map(toPortalRequestRow) };
    },
  });

  route(app, {
    method: "POST", url: "/portal/requests", audience: "portal", idempotent: true,
    schema: { body: PortalRequestCreateSchema, response: { 201: PortalRequestDetailResponseSchema }, summary: "Raise a service request (JSON; attachments are uploaded afterwards)" },
    handler: async (req, reply) => {
      const c = customerOf(req);
      const b = req.body;
      const detail = await app.db.transaction((tx) =>
        createTicketForCustomer(tx, { customerId: c.customerId, bookingId: b.booking_id, categoryId: b.category_id, subject: b.subject, description: b.description, attachmentIds: b.attachment_ids }, meta(req)),
      );
      return reply.code(201).send(toPortalRequestDetail(detail));
    },
  });

  route(app, {
    method: "GET", url: "/portal/requests/:id", audience: "portal",
    schema: { params: idParams, response: { 200: PortalRequestDetailResponseSchema }, summary: "One request with its thread (internal staff notes never included)" },
    handler: async (req) => toPortalRequestDetail(await ticketForCustomer(app.dbReplica, req.params.id, customerOf(req).customerId)),
  });

  route(app, {
    method: "POST", url: "/portal/requests/:id/messages", audience: "portal", idempotent: true,
    schema: { params: idParams, body: PortalRequestMessageCreateSchema, response: { 201: PortalRequestDetailResponseSchema }, summary: "Reply on a request" },
    handler: async (req, reply) => {
      const c = customerOf(req);
      const detail = await app.db.transaction((tx) => addCustomerMessage(tx, req.params.id, c.customerId, req.body.body, req.body.attachment_ids, meta(req)));
      return reply.code(201).send(toPortalRequestDetail(detail));
    },
  });

  route(app, {
    method: "POST", url: "/portal/requests/:id/reopen", audience: "portal", idempotent: true,
    schema: { params: idParams, body: PortalRequestReopenSchema, response: { 200: PortalRequestDetailResponseSchema }, summary: "Reopen a resolved request (within 7 days of resolution)" },
    handler: async (req) => {
      const c = customerOf(req);
      return toPortalRequestDetail(await app.db.transaction((tx) => reopenByCustomer(tx, req.params.id, c.customerId, req.body.reason, meta(req))));
    },
  });

  route(app, {
    method: "POST", url: "/portal/requests/:id/rate", audience: "portal", idempotent: true,
    schema: { params: idParams, body: PortalRequestRateSchema, response: { 200: PortalRequestDetailResponseSchema }, summary: "Rate a resolved request (1–5, once)" },
    handler: async (req) => {
      const c = customerOf(req);
      return toPortalRequestDetail(await app.db.transaction((tx) => rateByCustomer(tx, req.params.id, c.customerId, req.body.rating, req.body.comment ?? null, meta(req))));
    },
  });

  route(app, {
    method: "POST", url: "/portal/requests/:id/attachments", audience: "portal",
    schema: {
      params: idParams, response: { 201: PortalDocumentRowSchema }, summary: "Upload one photo / PDF for a request (multipart, field `file`)",
      description: "multipart/form-data with a single `file` part (PDF/JPEG/PNG/WebP ≤ 15 MB, validated by file signature). The returned document_id is then carried in a reply's attachment_ids.",
    },
    handler: async (req, reply) => {
      const c = customerOf(req);
      const upload = await readSingleFile(req as unknown as FastifyRequest);
      return reply.code(201).send(await addRequestAttachment(app, c, req.params.id, upload, meta(req as unknown as FastifyRequest)));
    },
  });
}
