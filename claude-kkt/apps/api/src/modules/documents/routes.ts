import { and, eq, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DocumentDownloadLinkResponseSchema,
  DocumentFilterSchema,
  DocumentLinkQuerySchema,
  DocumentRowSchema,
  DocumentListResponseSchema,
  DocumentUpdateSchema,
  DocumentUploadMetaSchema,
  DocumentUploadResponseSchema,
  IdSchema,
  coerceBoolean,
  type DocumentRow,
  type DocumentUploadMeta,
} from "@kkt/contracts";
import { documents } from "@kkt/db";
import { actorFromRequest, auditMeta, writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { installMultipartIdempotency, uploadOf } from "../../lib/multipart.js";
import { route } from "../../lib/routes.js";
import type { StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, withOptionalVersion } from "../../lib/version.js";
import { withdraw } from "../notifications/index.js";
import { assertEntityWrite, documentScopeCondition, requireEntity } from "./entities.js";
import {
  DOCUMENT_SELECT,
  SIGNED_LINK_TTL_SECONDS,
  applyTypeRules,
  loadDocumentType,
  loadJoined,
  signedUrl,
  storage,
  streamDocument,
  toDocumentRow,
  uploadDocument,
  variantKey,
  variantMeta,
  verifyLinkToken,
  withDocumentJoins,
  type DocumentJoined,
} from "./service.js";

const idParams = z.object({ id: IdSchema });
const ENTITY = "document";
const CSV_COLUMNS = [
  "id",
  "entity_type",
  "entity_id",
  "document_type_name",
  "title",
  "file_name",
  "mime",
  "size_bytes",
  "sha256",
  "is_sensitive",
  "shared_with_customer",
  "uploaded_by_name",
  "created_at",
];

/** True when the caller may see sensitive (KYC) documents. */
function canSeeSensitive(user: StaffContext): boolean {
  return user.permissions.has("customer.kyc_view");
}

/** Multipart field values are strings: coerce the booleans, treat blank optionals as absent, then validate with the contract schema. */
function parseUploadMeta(fields: Record<string, unknown>): DocumentUploadMeta {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val === undefined) continue;
    if ((k === "is_sensitive" || k === "shared_with_customer") && val !== "") raw[k] = coerceBoolean(val);
    else if (k === "document_type_id" && val === "") raw[k] = null;
    else if (k === "title" && val === "") continue;
    else if (val !== "") raw[k] = val;
  }
  const parsed = DocumentUploadMetaSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.map(String).join("."),
      message: i.message,
      code: i.code,
    }));
    throw ApiError.badRequest(
      issues
        .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
        .slice(0, 5)
        .join("; "),
      { issues },
    );
  }
  return parsed.data;
}

/** Loads a live document for a staff caller: 404 when missing, out of project scope, or sensitive and the caller lacks customer.kyc_view (when `hideSensitive`). */
async function loadForStaff(
  app: FastifyInstance,
  user: StaffContext,
  id: string,
  opts: { hideSensitive: boolean; forUpdate?: boolean },
): Promise<DocumentJoined> {
  const j = await loadJoined(opts.forUpdate ? app.db : app.dbReplica, user.companyId, id, {
    forUpdate: opts.forUpdate,
  });
  if (!j) throw ApiError.notFound("Document");
  await requireEntity(app.dbReplica, user, j.doc.entityType, j.doc.entityId);
  if (opts.hideSensitive && j.doc.isSensitive && !canSeeSensitive(user)) throw ApiError.notFound("Document");
  return j;
}

/** Documents routes: upload, list, meta, update, soft delete, signed link, and the public token stream. */
export function registerDocumentRoutes(app: FastifyInstance): void {
  // Multipart bodies are streamed, so the idempotency plugin cannot hash `req.body`; the shared hook parses the upload before
  // preHandler and registers a digest of fields + file bytes as the Idempotency-Key fingerprint (422 IDEMPOTENCY_MISMATCH on reuse).
  installMultipartIdempotency(app, (url) => url.endsWith("/documents"));

  route(app, {
    method: "POST",
    url: "/documents",
    permission: "document.write",
    idempotent: true,
    schema: {
      response: { 201: DocumentUploadResponseSchema },
      summary: "Upload a document (multipart)",
      description:
        "multipart/form-data: `file` (PDF/JPEG/PNG/WebP ≤ 15 MB, validated by file signature) plus fields entity_type, entity_id, document_type_id?, title?, is_sensitive?, shared_with_customer?. KYC document types force is_sensitive and cannot be shared.",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const upload = uploadOf(req);
      const meta = parseUploadMeta(upload.fields);
      assertEntityWrite(user, meta.entity_type);
      // validation and the storage write happen before the (short) transaction; renditions follow in a job (service.uploadDocument)
      const view = await uploadDocument(
        app,
        {
          companyId: user.companyId,
          entityType: meta.entity_type,
          entityId: meta.entity_id,
          buffer: upload.buffer,
          filename: upload.filename,
          documentTypeId: meta.document_type_id ?? null,
          title: meta.title ?? null,
          isSensitive: meta.is_sensitive,
          sharedWithCustomer: meta.shared_with_customer,
          uploadedBy: user.id,
          uploadedByType: "STAFF",
        },
        async (tx, row) => {
          // re-checked under the transaction: the entity may have been removed while the file was being written
          await requireEntity(tx, user, meta.entity_type, meta.entity_id);
          const joined = await loadJoined(tx, user.companyId, row.id);
          const doc = toDocumentRow(joined!);
          await writeAudit(tx, {
            companyId: user.companyId,
            actor: actorFromRequest(req),
            action: `${ENTITY}.upload`,
            entityType: ENTITY,
            entityId: row.id,
            after: auditSnapshot(doc),
            ...auditMeta(req),
          });
          return doc;
        },
        // a caller who may not attach to this entity is refused before anything is written to storage
        { before: async () => void (await requireEntity(app.db, user, meta.entity_type, meta.entity_id)) },
      );
      return reply.code(201).send({ document: view });
    },
  });

  route(app, {
    method: "GET",
    url: "/documents",
    permission: "document.read",
    schema: {
      querystring: DocumentFilterSchema,
      response: { 200: DocumentListResponseSchema },
      summary: "List documents of an entity",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      const where: (SQL | undefined)[] = [eq(documents.companyId, user.companyId)];
      if (q.entity_type && q.entity_id) {
        await requireEntity(app.dbReplica, user, q.entity_type, q.entity_id);
        where.push(eq(documents.entityType, q.entity_type), eq(documents.entityId, q.entity_id));
      } else {
        if (q.entity_type) where.push(eq(documents.entityType, q.entity_type));
        if (q.entity_id) where.push(eq(documents.entityId, q.entity_id));
        where.push(documentScopeCondition(app.dbReplica, user));
      }
      if (q.document_type_id) where.push(eq(documents.documentTypeId, q.document_type_id));
      if (q.shared_with_customer !== undefined) where.push(eq(documents.sharedWithCustomer, q.shared_with_customer));
      if (!q.include_deleted) where.push(eq(documents.isDeleted, false));
      if (!canSeeSensitive(user)) where.push(eq(documents.isSensitive, false));
      const result = await paginate<DocumentJoined>(app.dbReplica, {
        table: documents,
        select: DOCUMENT_SELECT,
        join: withDocumentJoins,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [documents.title, documents.fileName], term: q.search },
        sort: {
          allowed: {
            created_at: documents.createdAt,
            title: documents.title,
            file_name: documents.fileName,
            size_bytes: documents.sizeBytes,
          },
          default: "-created_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = result.items.map(toDocumentRow);
      if (q.format === "csv")
        return sendCsv(
          reply,
          "documents.csv",
          CSV_COLUMNS.map((k) => ({ key: k, header: k })),
          items as unknown as Record<string, unknown>[],
        );
      return { ...result, items };
    },
  });

  route(app, {
    method: "GET",
    url: "/documents/:id",
    permission: "document.read",
    schema: { params: idParams, response: { 200: DocumentRowSchema }, summary: "Document metadata" },
    handler: async (req) => toDocumentRow(await loadForStaff(app, req.user!, req.params.id, { hideSensitive: true })),
  });

  route(app, {
    method: "PATCH",
    url: "/documents/:id",
    permission: "document.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(DocumentUpdateSchema),
      response: { 200: DocumentRowSchema },
      summary: "Update title, type or sharing flags (KYC rules enforced); version required (body.version or If-Match)",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      return app.db.transaction(async (tx) => {
        const existing = await loadJoined(tx, user.companyId, req.params.id, { forUpdate: true });
        if (!existing) throw ApiError.notFound("Document");
        const doc = existing.doc;
        assertEntityWrite(user, doc.entityType);
        await requireEntity(tx, user, doc.entityType, doc.entityId);
        if (doc.isSensitive && !canSeeSensitive(user)) throw ApiError.notFound("Document");
        const before = toDocumentRow(existing);
        const typeId = body.document_type_id === undefined ? doc.documentTypeId : body.document_type_id;
        const type = typeId ? await loadDocumentType(tx, user.companyId, typeId) : null;
        const flags = applyTypeRules(type, doc.entityType, {
          isSensitive: body.is_sensitive ?? doc.isSensitive,
          sharedWithCustomer: body.shared_with_customer ?? doc.sharedWithCustomer,
        });
        const changes: Partial<typeof documents.$inferInsert> = {
          documentTypeId: type?.id ?? null,
          isSensitive: flags.isSensitive,
          sharedWithCustomer: flags.sharedWithCustomer,
          updatedAt: new Date(),
        };
        if (body.title !== undefined) changes.title = body.title;
        // Optimistic concurrency: `If-Match: "<version>"` or body.version is required (the version policy rejects a PATCH without one).
        await applyUpdate(
          tx,
          documents,
          doc.id,
          expectedVersion(req as unknown as FastifyRequest, body),
          changes,
          ENTITY,
        );
        const after = toDocumentRow((await loadJoined(tx, user.companyId, doc.id))!);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: `${ENTITY}.update`,
          entityType: ENTITY,
          entityId: doc.id,
          before: auditSnapshot(before),
          after: auditSnapshot(after),
          ...auditMeta(req),
        });
        return after;
      });
    },
  });

  route(app, {
    method: "DELETE",
    url: "/documents/:id",
    permission: "document.write",
    schema: { params: idParams, response: { 204: z.null() }, summary: "Soft-delete a document" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const existing = await loadJoined(tx, user.companyId, req.params.id, { forUpdate: true });
        if (!existing) throw ApiError.notFound("Document");
        assertEntityWrite(user, existing.doc.entityType);
        await requireEntity(tx, user, existing.doc.entityType, existing.doc.entityId);
        if (existing.doc.isSensitive && !canSeeSensitive(user)) throw ApiError.notFound("Document");
        await applyUpdate(
          tx,
          documents,
          existing.doc.id,
          expectedVersion(req as unknown as FastifyRequest, null),
          { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
          ENTITY,
        );
        await withdraw(tx, ENTITY, existing.doc.id);
        const before = toDocumentRow(existing);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: actorFromRequest(req),
          action: `${ENTITY}.delete`,
          entityType: ENTITY,
          entityId: existing.doc.id,
          before: auditSnapshot(before),
          after: { ...auditSnapshot(before), is_deleted: true },
          ...auditMeta(req),
        });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "POST",
    url: "/documents/:id/link",
    permission: "document.read",
    schema: {
      params: idParams,
      querystring: DocumentLinkQuerySchema,
      response: { 200: DocumentDownloadLinkResponseSchema },
      summary: "Signed 15-minute download link (sensitive documents need customer.kyc_view)",
    },
    handler: async (req) => {
      const user = req.user!;
      const j = await loadForStaff(app, user, req.params.id, { hideSensitive: false });
      if (j.doc.isSensitive && !canSeeSensitive(user))
        throw ApiError.forbidden("Missing permission customer.kyc_view", { permission: "customer.kyc_view" });
      // an image whose renditions do not exist yet (or failed) links its original: "the original is served until they exist"
      const variant =
        !variantKey(j.doc, req.query.variant) && j.doc.mime.startsWith("image/") ? "original" : req.query.variant;
      if (!variantKey(j.doc, variant)) throw ApiError.notFound(`${variant} variant`);
      const link = signedUrl(j.doc.id, variant, SIGNED_LINK_TTL_SECONDS);
      const meta = variantMeta(j.doc, variant);
      if (j.doc.isSensitive) {
        // Every access to a KYC/sensitive file is audited, like a KYC reveal (SPEC §2).
        await app.db.transaction(async (tx) => {
          await writeAudit(tx, {
            companyId: user.companyId,
            actor: actorFromRequest(req),
            action: `${ENTITY}.sensitive_link`,
            entityType: ENTITY,
            entityId: j.doc.id,
            after: { variant, expires_at: link.expires_at, entity_type: j.doc.entityType, entity_id: j.doc.entityId },
            ...auditMeta(req),
          });
        });
      }
      return { download_url: link.url, expires_at: link.expires_at, file_name: meta.fileName, mime: meta.mime };
    },
  });

  route(app, {
    method: "GET",
    url: "/files/:token",
    public: true,
    schema: {
      params: z.object({ token: z.string().min(1).max(100) }),
      response: { 200: z.any() },
      summary: "Stream a file through a signed, short-lived link (any malformed, forged or expired token is 404)",
      description:
        "Binary body: the document bytes (application/pdf, image/jpeg, image/png, image/webp), `Content-Disposition` inline for images and attachment otherwise.",
    },
    handler: async (req, reply) => {
      const link = verifyLinkToken(req.params.token);
      if (!link) throw ApiError.notFound("File");
      const file = await streamDocument(app.dbReplica, link.documentId, link.variant);
      if (!file) throw ApiError.notFound("File");
      const inline = file.mime.startsWith("image/");
      reply.header("Content-Type", file.mime);
      reply.header(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${asciiName(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      // the original standing in for a pending rendition must not be cached as that rendition
      reply.header(
        "Cache-Control",
        file.fallback ? "private, no-cache" : `private, max-age=${SIGNED_LINK_TTL_SECONDS}`,
      );
      reply.header("X-Content-Type-Options", "nosniff");
      // Signed links are embedded as <img>/<iframe> by the ERP on another origin (the token is the credential).
      reply.header("Cross-Origin-Resource-Policy", "cross-origin");
      if (file.size !== null) reply.header("Content-Length", String(file.size));
      return reply.send(file.stream);
    },
  });

  // Storage is created lazily; touching it at registration surfaces a misconfigured driver at boot instead of on the first upload.
  storage();
}

/** ASCII-only fallback filename for Content-Disposition. */
function asciiName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return ascii || "file";
}

/** Audit snapshot of a document row (no signed URLs, which would be noise that expires). */
function auditSnapshot(row: DocumentRow): Record<string, unknown> {
  const { thumb_url: _t, medium_url: _m, ...rest } = row;
  return rest;
}
