/**
 * Portal service requests (SPEC §13/§16; Appendix C + additions): categories, list, JSON create, detail without internal notes, replies,
 * reopen within 7 days of RESOLVED, rating, and one-file-per-call multipart attachments stored through the documents module as
 * SERVICE_REQUEST documents uploaded by the CUSTOMER. An upload may carry a `message_id` text part naming one of the customer's own
 * messages on that ticket (the opening message right after create), in which case the document is appended to that message so the
 * photos of a new request show in the thread; without it the document waits to be carried by a reply's `attachment_ids`.
 * The ticket rules live in the service module; this file maps and guards.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PortalDocumentRowSchema,
  PortalRequestCategorySchema,
  PortalRequestCreateSchema,
  PortalRequestDetailResponseSchema,
  PortalRequestFilterSchema,
  PortalRequestListResponseSchema,
  PortalRequestMessageCreateSchema,
  PortalRequestRateSchema,
  PortalRequestReopenSchema,
  type CustomerTicketDetail,
  type CustomerTicketRow,
  type PortalDocumentRow,
  type PortalRequestCategory,
  type PortalRequestDetailResponse,
  type PortalRequestMessage,
  type PortalRequestRow,
  type ServiceMessageRow,
} from "@kkt/contracts";
import { documents, serviceCategories, serviceRequestMessages, type Executor } from "@kkt/db";
import { writeAudit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import type { ListResult } from "../../lib/list.js";
import { installMultipartIdempotency, uploadOf, type ParsedUpload } from "../../lib/multipart.js";
import { route } from "../../lib/routes.js";
import type { PortalContext } from "../../lib/scope.js";
import { loadJoined, toDocumentRow, uploadDocument } from "../documents/index.js";
import {
  addCustomerMessage,
  createTicketForCustomer,
  listTicketsForCustomer,
  rateByCustomer,
  reopenByCustomer,
  requireCustomerTicket,
  ticketForCustomer,
  type WriteMeta,
} from "../service/index.js";
import { customerOf, idParams } from "./common.js";
import { portalDocumentUrl } from "./files.js";

function meta(req: FastifyRequest): WriteMeta {
  return { ip: req.clientIp, requestId: req.id };
}

/** Customer ticket row → portal row (no staff ids: the service module already strips assignee / SLA fields). */
export function toPortalRequestRow(t: CustomerTicketRow): PortalRequestRow {
  return {
    id: t.id,
    ticket_number: t.ticket_number,
    booking_id: t.booking_id,
    flat_number: t.flat_number ?? "",
    category_name: t.category_name,
    priority: t.priority,
    subject: t.subject,
    description: t.description,
    status: t.status,
    can_reopen: t.can_reopen,
    can_rate: t.can_rate,
    rating: t.rating,
    last_message_at: t.last_message_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

/**
 * Thread message → portal message: the customer's own messages read "YOU"; staff show by name only; internal notes never reach here.
 * Attachment links are re-signed for the viewing customer (the service module's thumb_url only tells us a rendition exists): `thumb_url`
 * for the thread, `url` (medium rendition when one exists, else the original bytes) for the full-screen viewer and non-image files.
 */
export function toPortalMessage(m: ServiceMessageRow, customerId: string): PortalRequestMessage {
  const author = m.author_type === "CUSTOMER" ? "YOU" : m.author_type === "STAFF" ? "STAFF" : "SYSTEM";
  return {
    id: m.id,
    author,
    author_name: m.author_name,
    body: m.body,
    created_at: m.created_at,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      file_name: a.file_name,
      mime: a.mime,
      thumb_url: a.thumb_url ? portalDocumentUrl(customerId, a.id, "thumb").url : null,
      url: portalDocumentUrl(customerId, a.id, a.thumb_url ? "medium" : "original").url,
    })),
  };
}

export function toPortalRequestDetail(d: CustomerTicketDetail, customerId: string): PortalRequestDetailResponse {
  return {
    ...toPortalRequestRow(d),
    messages: d.messages.filter((m) => !m.is_internal).map((m) => toPortalMessage(m, customerId)),
  };
}

/**
 * Portal-side attachment rule (stricter than the service module's, which also admits any non-sensitive BOOKING document): a customer may
 * carry only documents they uploaded themselves, or documents already visible to them in the portal (shared, non-sensitive, on their own
 * customer record, the booking or the request). Anything else — another booking's paperwork, an internal note, another buyer's photo —
 * is 400 VALIDATION_ERROR on attachment_ids, exactly like a non-existent id, so nothing can be probed through the thread.
 */
export async function assertPortalAttachments(
  db: Executor,
  customer: Pick<PortalContext, "customerId" | "companyId">,
  ids: readonly string[],
  ref: { bookingId?: string | null; ticketId?: string | null },
): Promise<void> {
  if (ids.length === 0) return;
  const visible = [and(eq(documents.entityType, "CUSTOMER"), eq(documents.entityId, customer.customerId))!];
  if (ref.bookingId) visible.push(and(eq(documents.entityType, "BOOKING"), eq(documents.entityId, ref.bookingId))!);
  if (ref.ticketId)
    visible.push(and(eq(documents.entityType, "SERVICE_REQUEST"), eq(documents.entityId, ref.ticketId))!);
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, customer.companyId),
        inArray(documents.id, [...new Set(ids)]),
        eq(documents.isDeleted, false),
        eq(documents.isSensitive, false),
        or(
          and(eq(documents.uploadedByType, "CUSTOMER"), eq(documents.uploadedBy, customer.customerId)),
          and(eq(documents.sharedWithCustomer, true), or(...visible)),
        ),
      ),
    );
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw ApiError.invalid(
      "attachment_ids",
      "attachment_ids references a document that does not exist or does not belong to this request",
      "invalid",
      { missing },
    );
}

/** Active service categories (id, name, default priority) the portal's "raise request" form offers. */
export async function requestCategories(db: Executor, companyId: string): Promise<PortalRequestCategory[]> {
  const rows = await db
    .select({
      id: serviceCategories.id,
      name: serviceCategories.name,
      defaultPriority: serviceCategories.defaultPriority,
    })
    .from(serviceCategories)
    .where(and(eq(serviceCategories.companyId, companyId), eq(serviceCategories.isActive, true)))
    .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
  return rows.map((r) => ({ id: r.id, name: r.name, default_priority: r.defaultPriority }));
}

const MessageIdField = z.uuid();

/**
 * Stores one uploaded file as a SERVICE_REQUEST document of the customer's ticket (closed tickets refuse attachments). With a `message_id`
 * text part the document is also appended to that message — only a non-internal message the customer wrote on this ticket qualifies;
 * anything else (a staff message, another ticket's message, an unknown id) is 404 so nothing can be probed.
 */
export async function addRequestAttachment(
  app: FastifyInstance,
  customer: PortalContext,
  ticketId: string,
  upload: ParsedUpload,
  m: WriteMeta,
): Promise<PortalDocumentRow> {
  const rawMessageId = upload.fields["message_id"];
  let messageId: string | null = null;
  if (rawMessageId !== undefined && rawMessageId !== "") {
    const parsed = MessageIdField.safeParse(rawMessageId);
    if (!parsed.success) throw ApiError.invalid("message_id", "message_id must be a UUID");
    messageId = parsed.data;
  }
  // the file is validated and written to storage BEFORE the transaction (documents/service.ts uploadDocument); the ticket checks run
  // first without a lock (nothing is written for a foreign or closed ticket) and again under the row lock inside the transaction
  const closed = (status: string) =>
    ApiError.conflict("TICKET_CLOSED", "This request is closed and can no longer be changed", { status });
  const uploadInput = {
    companyId: customer.companyId,
    entityType: "SERVICE_REQUEST" as const,
    entityId: ticketId,
    buffer: upload.buffer,
    filename: upload.filename,
    uploadedBy: customer.customerId,
    uploadedByType: "CUSTOMER" as const,
  };
  const precheck = async () => {
    const t = await requireCustomerTicket(app.db, ticketId, customer.customerId, false);
    if (t.sr.status === "CLOSED") throw closed(t.sr.status);
  };
  return uploadDocument(
    app,
    uploadInput,
    async (tx, row) => {
      const t = await requireCustomerTicket(tx, ticketId, customer.customerId, true);
      if (t.sr.status === "CLOSED") throw closed(t.sr.status);
      let message: { id: string; attachmentIds: string[] } | null = null;
      if (messageId) {
        const [msg] = await tx
          .select({ id: serviceRequestMessages.id, attachmentIds: serviceRequestMessages.attachmentIds })
          .from(serviceRequestMessages)
          .where(
            and(
              eq(serviceRequestMessages.id, messageId),
              eq(serviceRequestMessages.ticketId, t.sr.id),
              eq(serviceRequestMessages.authorType, "CUSTOMER"),
              eq(serviceRequestMessages.authorId, customer.customerId),
              eq(serviceRequestMessages.isInternal, false),
            ),
          )
          .limit(1)
          .for("update");
        if (!msg) throw ApiError.notFound("Message");
        message = msg;
      }
      if (message && message.attachmentIds.length >= 10)
        throw ApiError.invalid("message_id", "A message may carry at most 10 attachments");
      if (message)
        await tx
          .update(serviceRequestMessages)
          .set({ attachmentIds: [...message.attachmentIds, row.id] })
          .where(eq(serviceRequestMessages.id, message.id));
      const joined = await loadJoined(tx, customer.companyId, row.id);
      const doc = toDocumentRow(joined!);
      await writeAudit(tx, {
        companyId: customer.companyId,
        actor: { type: "CUSTOMER", id: customer.customerId, name: customer.name },
        action: "document.upload",
        entityType: "document",
        entityId: row.id,
        after: {
          entity_type: "SERVICE_REQUEST",
          entity_id: t.sr.id,
          ticket_number: t.sr.ticketNumber,
          message_id: message?.id ?? null,
          file_name: doc.file_name,
          mime: doc.mime,
          size_bytes: doc.size_bytes,
        },
        ip: m.ip ?? null,
        requestId: m.requestId ?? null,
      });
      return {
        document_id: doc.id,
        kind: "ATTACHMENT",
        title: doc.title,
        document_type_name: doc.document_type_name,
        file_name: doc.file_name,
        mime: doc.mime,
        size_bytes: doc.size_bytes,
        shared_at: doc.created_at,
      };
    },
    { before: precheck },
  );
}

/** Registers the /portal/requests routes. */
export function registerRequestRoutes(app: FastifyInstance): void {
  // Multipart attachments share the documents module's Idempotency-Key fingerprint hook (digest of the file bytes).
  installMultipartIdempotency(app, (url) => url.endsWith("/portal/requests/:id/attachments"));
  route(app, {
    method: "GET",
    url: "/portal/requests/categories",
    audience: "portal",
    schema: {
      response: { 200: z.array(PortalRequestCategorySchema) },
      summary: "Service categories the customer may raise a request under",
    },
    handler: async (req) => requestCategories(app.dbReplica, customerOf(req).companyId),
  });

  route(app, {
    method: "GET",
    url: "/portal/requests",
    audience: "portal",
    schema: {
      querystring: PortalRequestFilterSchema,
      response: { 200: PortalRequestListResponseSchema },
      summary: "The customer's service requests",
    },
    handler: async (req): Promise<ListResult<PortalRequestRow>> => {
      const q = req.query;
      const result = await listTicketsForCustomer(app.dbReplica, customerOf(req).customerId, {
        status: q.status,
        booking_id: q.booking_id,
        page: q.page,
        page_size: q.page_size,
        cursor: q.cursor,
        limit: q.limit,
        sort: q.sort,
      });
      return { ...result, items: result.items.map(toPortalRequestRow) };
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/requests",
    audience: "portal",
    idempotent: true,
    schema: {
      body: PortalRequestCreateSchema,
      response: { 201: PortalRequestDetailResponseSchema },
      summary: "Raise a service request (JSON; attachments are uploaded afterwards)",
    },
    handler: async (req, reply) => {
      const c = customerOf(req);
      const b = req.body;
      const detail = await app.db.transaction(async (tx) => {
        await assertPortalAttachments(tx, c, b.attachment_ids, { bookingId: b.booking_id });
        return createTicketForCustomer(
          tx,
          {
            customerId: c.customerId,
            bookingId: b.booking_id,
            categoryId: b.category_id,
            subject: b.subject,
            description: b.description,
            attachmentIds: b.attachment_ids,
          },
          meta(req),
        );
      });
      return reply.code(201).send(toPortalRequestDetail(detail, c.customerId));
    },
  });

  route(app, {
    method: "GET",
    url: "/portal/requests/:id",
    audience: "portal",
    schema: {
      params: idParams,
      response: { 200: PortalRequestDetailResponseSchema },
      summary: "One request with its thread (internal staff notes never included)",
    },
    handler: async (req) => {
      const c = customerOf(req);
      return toPortalRequestDetail(await ticketForCustomer(app.dbReplica, req.params.id, c.customerId), c.customerId);
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/requests/:id/messages",
    audience: "portal",
    idempotent: true,
    schema: {
      params: idParams,
      body: PortalRequestMessageCreateSchema,
      response: { 201: PortalRequestDetailResponseSchema },
      summary: "Reply on a request",
    },
    handler: async (req, reply) => {
      const c = customerOf(req);
      const detail = await app.db.transaction(async (tx) => {
        // ownership first (404 for another buyer's request), then the portal attachment rule, then the service module's own checks
        const existing = await requireCustomerTicket(tx, req.params.id, c.customerId);
        await assertPortalAttachments(tx, c, req.body.attachment_ids, {
          bookingId: existing.sr.bookingId,
          ticketId: existing.sr.id,
        });
        return addCustomerMessage(tx, req.params.id, c.customerId, req.body.body, req.body.attachment_ids, meta(req));
      });
      return reply.code(201).send(toPortalRequestDetail(detail, c.customerId));
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/requests/:id/reopen",
    audience: "portal",
    idempotent: true,
    schema: {
      params: idParams,
      body: PortalRequestReopenSchema,
      response: { 200: PortalRequestDetailResponseSchema },
      summary: "Reopen a resolved request (within 7 days of resolution)",
    },
    handler: async (req) => {
      const c = customerOf(req);
      return toPortalRequestDetail(
        await app.db.transaction((tx) => reopenByCustomer(tx, req.params.id, c.customerId, req.body.reason, meta(req))),
        c.customerId,
      );
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/requests/:id/rate",
    audience: "portal",
    idempotent: true,
    schema: {
      params: idParams,
      body: PortalRequestRateSchema,
      response: { 200: PortalRequestDetailResponseSchema },
      summary: "Rate a resolved request (1–5, once)",
    },
    handler: async (req) => {
      const c = customerOf(req);
      return toPortalRequestDetail(
        await app.db.transaction((tx) =>
          rateByCustomer(tx, req.params.id, c.customerId, req.body.rating, req.body.comment ?? null, meta(req)),
        ),
        c.customerId,
      );
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/requests/:id/attachments",
    audience: "portal",
    idempotent: true,
    schema: {
      params: idParams,
      response: { 201: PortalDocumentRowSchema },
      summary: "Upload one photo / PDF for a request (multipart, field `file`, optional `message_id`)",
      description:
        "multipart/form-data with a single `file` part (PDF/JPEG/PNG/WebP ≤ 15 MB, validated by file signature). The returned document_id is then carried in a reply's attachment_ids — or, with a `message_id` text part naming one of your own messages on this request (the opening message after create), the file is appended to that message right away.",
    },
    handler: async (req, reply) => {
      const c = customerOf(req);
      const upload = uploadOf(req as unknown as FastifyRequest);
      return reply
        .code(201)
        .send(await addRequestAttachment(app, c, req.params.id, upload, meta(req as unknown as FastifyRequest)));
    },
  });
}
