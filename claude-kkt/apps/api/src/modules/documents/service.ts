import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata as SharpMetadata } from "sharp";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type ActorType,
  type AllowedUploadMime,
  type DocumentEntityType,
  type DocumentRow,
  type DocumentVariant,
} from "@kkt/contracts";
import {
  customers,
  documentTypes,
  documents,
  storagePendingObjects,
  users,
  type DB,
  type Executor,
  type Tx,
} from "@kkt/db";
import { config } from "../../config.js";
import { sha256, signLinkBody, verifyLinkBody } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { createStorage, type Storage } from "../../lib/storage.js";
import {
  clearPendingObjects,
  imageSlots,
  MAX_IMAGE_PIXELS,
  recordPendingObject,
  renditionStatus,
  requestRenditions,
  type StoredVariants,
} from "./renditions.js";

export { MAX_IMAGE_PIXELS } from "./renditions.js";

/** A documents table row. */
export type DocumentRecord = typeof documents.$inferSelect;

/** Row joined with its type and uploader name (what views are built from). */
export interface DocumentJoined {
  doc: DocumentRecord;
  typeName: string | null;
  isKyc: boolean | null;
  staffName: string | null;
  customerName: string | null;
}

/** Default lifetime of a signed download link (SPEC §2/§13: short-lived, 15 minutes). */
export const SIGNED_LINK_TTL_SECONDS = 15 * 60;
const EXT: Record<AllowedUploadMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** Filename extensions that honestly describe each accepted type (anything else gets the canonical one appended). */
const HONEST_EXT: Record<AllowedUploadMime, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg", "jpe", "jfif"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let storageInstance: Storage | null = null;
/** The process-wide storage driver (lazy so tests can point STORAGE_LOCAL_DIR elsewhere before the first upload). */
export function storage(): Storage {
  storageInstance ??= createStorage();
  return storageInstance;
}

/** Input of an upload (uploadDocument / prepareUpload). */
export interface StoreBufferInput {
  companyId: string;
  entityType: DocumentEntityType;
  entityId: string;
  buffer: Buffer;
  /** Original client filename (kept as metadata only; never part of the storage key). */
  filename: string;
  documentTypeId?: string | null;
  title?: string | null;
  isSensitive?: boolean;
  sharedWithCustomer?: boolean;
  uploadedBy: string | null;
  uploadedByType?: ActorType;
}

/** A document type as needed by the KYC/applies-to rules. */
export interface DocumentTypeInfo {
  id: string;
  name: string;
  isKyc: boolean;
  appliesTo: string[];
}

/** Loads an active document type of the company; 400 when it does not exist. */
export async function loadDocumentType(executor: Executor, companyId: string, id: string): Promise<DocumentTypeInfo> {
  const [t] = await executor
    .select({
      id: documentTypes.id,
      name: documentTypes.name,
      isKyc: documentTypes.isKyc,
      appliesTo: documentTypes.appliesTo,
    })
    .from(documentTypes)
    .where(and(eq(documentTypes.id, id), eq(documentTypes.companyId, companyId), eq(documentTypes.isActive, true)))
    .limit(1);
  if (!t)
    throw ApiError.badRequest("document_type_id does not refer to an active document type", {
      issues: [{ path: "document_type_id", message: "Unknown document type" }],
    });
  return t;
}

/**
 * Applies the document-type rules: the type must apply to the entity kind (422 DOCUMENT_TYPE_NOT_APPLICABLE), KYC types force
 * `is_sensitive` and can never be shared with the customer (422 KYC_NOT_SHAREABLE). Returns the effective flags.
 */
export function applyTypeRules(
  type: DocumentTypeInfo | null,
  entityType: DocumentEntityType,
  flags: { isSensitive: boolean; sharedWithCustomer: boolean },
): { isSensitive: boolean; sharedWithCustomer: boolean } {
  if (!type) return flags;
  if (type.appliesTo.length > 0 && !type.appliesTo.includes(entityType)) {
    throw ApiError.rule(
      `Document type "${type.name}" does not apply to ${entityType.toLowerCase().replace(/_/g, " ")} records`,
      "DOCUMENT_TYPE_NOT_APPLICABLE",
      { document_type_id: type.id, applies_to: type.appliesTo, entity_type: entityType },
    );
  }
  if (!type.isKyc) return flags;
  if (flags.sharedWithCustomer)
    throw ApiError.rule("KYC documents cannot be shared with the customer", "KYC_NOT_SHAREABLE", {
      document_type_id: type.id,
    });
  return { isSensitive: true, sharedWithCustomer: false };
}

/** Sniffs the real media type from the bytes (never trusts extension or client MIME); 415 for anything outside the allow-list. */
export async function detectMime(buffer: Buffer): Promise<AllowedUploadMime> {
  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime;
  if (!mime || !(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Only PDF, JPEG, PNG and WebP files are accepted", {
      detected: mime ?? null,
      allowed: [...ALLOWED_UPLOAD_MIME_TYPES],
    });
  }
  return mime as AllowedUploadMime;
}

/** Storage key `${companyId}/${yyyy}/${mm}/${uuid}.${ext}` — never derived from the client filename. */
export function buildStorageKey(companyId: string, ext: string, now = new Date()): { key: string; base: string } {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const base = `${companyId}/${yyyy}/${mm}/${randomUUID()}`;
  return { key: `${base}.${ext}`, base };
}

/** An upload that passed every check (type, size, document-type rules, image header) and has its storage key. Nothing is stored yet. */
export interface PreparedUpload {
  input: StoreBufferInput;
  mime: AllowedUploadMime;
  type: DocumentTypeInfo | null;
  flags: { isSensitive: boolean; sharedWithCustomer: boolean };
  dims: { width: number; height: number } | null;
  key: string;
  sha256: string;
}

/** An upload whose original is in storage (recorded in storage_pending_objects) but whose documents row is not committed yet. */
export interface StagedUpload extends PreparedUpload {
  staged: true;
}

/**
 * Step 1 of an upload — validation, no transaction: 15 MB cap (413), magic-byte type check (415), document-type / KYC rules, image
 * dimensions from the header (413 above MAX_IMAGE_PIXELS), sha256 and a uuid storage key. `executor` only reads the document type.
 */
export async function prepareUpload(executor: Executor, input: StoreBufferInput): Promise<PreparedUpload> {
  if (input.buffer.length === 0) throw ApiError.badRequest("Uploaded file is empty");
  if (input.buffer.length > MAX_UPLOAD_BYTES)
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`, {
      max_bytes: MAX_UPLOAD_BYTES,
      size_bytes: input.buffer.length,
    });
  const mime = await detectMime(input.buffer);
  const type = input.documentTypeId ? await loadDocumentType(executor, input.companyId, input.documentTypeId) : null;
  const flags = applyTypeRules(type, input.entityType, {
    isSensitive: input.isSensitive ?? false,
    sharedWithCustomer: input.sharedWithCustomer ?? false,
  });
  // Image bombs: refuse by declared dimensions (header only) before a single pixel is decoded.
  const dims = mime === "application/pdf" ? null : await imageDimensions(input.buffer);
  const { key } = buildStorageKey(input.companyId, EXT[mime]);
  return { input, mime, type, flags, dims, key, sha256: sha256(input.buffer) };
}

/**
 * Step 2 — outside any transaction: records the key in storage_pending_objects (autocommit) BEFORE the bytes are written, then writes the
 * original. A failed write removes both; a crash anywhere after the record leaves it for STORAGE_SWEEP (orphans older than an hour).
 */
export async function stageUpload(db: DB, prepared: PreparedUpload): Promise<StagedUpload> {
  await recordPendingObject(db, prepared.key, prepared.input.companyId, "document");
  try {
    await storage().put(prepared.key, prepared.input.buffer, prepared.mime);
  } catch (err) {
    await discardStagedUpload(db, { ...prepared, staged: true });
    throw err;
  }
  return { ...prepared, staged: true };
}

/**
 * Step 3 — inside the caller's transaction: inserts the documents row (images start with `renditions: PENDING`) and clears the pending
 * record, so the object belongs to the row exactly when the row commits. Audit is the caller's job.
 */
export async function insertStagedDocument(tx: Executor, staged: StagedUpload): Promise<DocumentRecord> {
  const input = staged.input;
  const variants: StoredVariants | null =
    staged.mime === "application/pdf"
      ? null
      : { width: staged.dims?.width ?? null, height: staged.dims?.height ?? null, renditions: "PENDING" };
  const [row] = await tx
    .insert(documents)
    .values({
      companyId: input.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      documentTypeId: staged.type?.id ?? null,
      title: input.title?.trim() || null,
      fileName: safeFileName(input.filename, staged.mime),
      mime: staged.mime,
      sizeBytes: input.buffer.length,
      sha256: staged.sha256,
      storageKey: staged.key,
      variants: variants as DocumentRecord["variants"],
      isSensitive: staged.flags.isSensitive,
      sharedWithCustomer: staged.flags.sharedWithCustomer,
      uploadedByType: input.uploadedByType ?? "STAFF",
      uploadedBy: input.uploadedBy,
    })
    .returning();
  if (!row) throw new Error("documents insert returned no row");
  await clearPendingObjects(tx, [staged.key]);
  return row;
}

/**
 * Failure path: removes the object and its pending record (best effort — whatever is left, STORAGE_SWEEP finds). Never deletes an object
 * that a committed row references (a transaction can report a failure after its COMMIT went through).
 */
export async function discardStagedUpload(db: DB, staged: StagedUpload): Promise<void> {
  try {
    const [owned] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.storageKey, staged.key))
      .limit(1);
    if (owned) return;
    await storage().remove(staged.key);
    await db.delete(storagePendingObjects).where(eq(storagePendingObjects.key, staged.key));
  } catch {
    /* left pending: the sweep removes it once it is an hour old */
  }
}

/**
 * The upload pipeline every entry point uses (staff documents, portal attachments, CMS media): validate and read dimensions → record the
 * pending key → write the original → ONE short transaction (`inTx`: the caller's checks, the documents row, the pending record cleared,
 * audit) → after COMMIT, enqueue the renditions (images). No image processing and no storage I/O happen while the transaction is open,
 * and the request never waits for renditions. `before` runs ahead of the storage write (cheap authorisation checks, so a request that
 * will be refused writes nothing).
 */
export async function uploadDocument<T>(
  app: Pick<FastifyInstance, "db" | "jobQueue" | "log">,
  input: StoreBufferInput,
  inTx: (tx: Tx, row: DocumentRecord) => Promise<T>,
  opts: { before?: () => Promise<void> } = {},
): Promise<T> {
  if (opts.before) await opts.before();
  const prepared = await prepareUpload(app.db, input);
  const staged = await stageUpload(app.db, prepared);
  let inserted: DocumentRecord | null = null;
  let result: T;
  try {
    result = await app.db.transaction(async (tx) => {
      const row = await insertStagedDocument(tx, staged);
      inserted = row;
      return inTx(tx, row);
    });
  } catch (err) {
    await discardStagedUpload(app.db, staged);
    throw err;
  }
  const row = inserted as DocumentRecord | null;
  if (row) await requestRenditions(app, row);
  return result;
}

/** Reads the declared image dimensions from the header (no pixel decoding); 413 when they exceed MAX_IMAGE_PIXELS, 415 when unreadable. */
async function imageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  let meta: SharpMetadata;
  try {
    meta = await imageSlots.run(() => sharp(buffer, { limitInputPixels: false }).metadata());
  } catch {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Image could not be decoded");
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Image has no readable dimensions");
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Image exceeds ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`, {
      max_pixels: MAX_IMAGE_PIXELS,
      width,
      height,
    });
  }
  return { width, height };
}

/**
 * Trims a client filename to something printable and bounded (metadata + Content-Disposition only): path components, control
 * characters, quotes and leading dots are dropped, and when the extension does not honestly describe the detected type
 * (`invoice.pdf.exe`, `photo.jpg` that is really a PNG) the canonical extension is appended so downloads open with the right app.
 */
export function safeFileName(name: string, mime?: AllowedUploadMime): string {
  const base = name.split(/[\\/]/).filter(Boolean).pop() ?? "file";
  let clean = base
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/^[. ]+/, "")
    .trim()
    .slice(0, 180);
  if (!clean || /^[. _-]*$/.test(clean)) clean = "file";
  if (mime) {
    const ext = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!HONEST_EXT[mime].includes(ext)) clean = `${clean.replace(/\.+$/, "")}.${EXT[mime]}`;
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const VARIANT_CODES: readonly DocumentVariant[] = ["original", "thumb", "medium"];
const TOKEN_BODY_BYTES = 16 + 1 + 6; // uuid, variant code, expiry (seconds, 48-bit)
/** Token family of document links in the LINK_SIGNING_KEYS ring (contract C9): never valid as another family's token. */
const FILE_LINK_LABEL = "kkt-files-v1";

/**
 * Signed link token `<kid>.<base64url(uuid ‖ variant ‖ exp)>.<base64url(HMAC-SHA256/128)>` (lib/crypto.ts signLinkBody, ≤ 63 chars with
 * kids of up to 8 characters): short enough for a plain `:token` route parameter (find-my-way's 100-char default). The kid names the
 * ring key, so a key rotation keeps the (15-minute) links issued before it valid while the old key stays configured.
 */
function encodeLinkToken(documentId: string, variant: DocumentVariant, exp: number): string {
  const body = Buffer.alloc(TOKEN_BODY_BYTES);
  Buffer.from(documentId.replace(/-/g, ""), "hex").copy(body, 0);
  body[16] = VARIANT_CODES.indexOf(variant);
  body.writeUIntBE(Math.max(0, Math.min(exp, 2 ** 48 - 1)), 17, 6);
  return signLinkBody(FILE_LINK_LABEL, body);
}

/** Signed, short-lived download URL for a document rendition (served by `GET /api/v1/files/:token`). */
export function signedUrl(
  documentId: string,
  variant: DocumentVariant = "original",
  ttlSeconds = SIGNED_LINK_TTL_SECONDS,
): { url: string; expires_at: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = encodeLinkToken(documentId, variant, exp);
  return { url: `${config.API_PUBLIC_URL}/api/v1/files/${token}`, expires_at: new Date(exp * 1000).toISOString() };
}

/**
 * Verifies a `/files/:token` token; null when malformed, forged or expired. The token is re-encoded from its decoded fields and
 * compared whole in constant time, so only the canonical spelling verifies (no base64 padding-bit twiddling, no sig truncation).
 */
export function verifyLinkToken(token: string): { documentId: string; variant: DocumentVariant } | null {
  if (token.length > 100 || !/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,2}$/.test(token)) return null;
  // verifyLinkBody compares the MAC in constant time over the canonical encoding (no padding-bit or truncation tricks)
  const body = verifyLinkBody(FILE_LINK_LABEL, token);
  if (!body || body.length !== TOKEN_BODY_BYTES) return null;
  const variant = VARIANT_CODES[body[16]!];
  if (!variant) return null;
  const hex = body.subarray(0, 16).toString("hex");
  const documentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const exp = body.readUIntBE(17, 6);
  if (exp < Math.floor(Date.now() / 1000)) return null;
  return { documentId, variant };
}

/** Long-lived public URL for CMS media (served by the web/public module through streamDocument()). */
export function publicMediaUrl(documentId: string, variant: DocumentVariant = "original"): string {
  const q = variant === "original" ? "" : `?variant=${variant}`;
  return `${config.API_PUBLIC_URL}/api/v1/public/media/${documentId}${q}`;
}

/** Storage key of a rendition; null when the document has no such variant. */
export function variantKey(
  doc: Pick<DocumentRecord, "storageKey" | "variants">,
  variant: DocumentVariant,
): string | null {
  if (variant === "original") return doc.storageKey;
  const key = variant === "thumb" ? doc.variants?.thumb_key : doc.variants?.medium_key;
  return key ?? null;
}

/** MIME and download filename of a rendition (the original's name is re-checked against its type so a stored legacy name cannot lie). */
export function variantMeta(
  doc: Pick<DocumentRecord, "mime" | "fileName">,
  variant: DocumentVariant,
): { mime: string; fileName: string } {
  const honest = (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(doc.mime)
    ? safeFileName(doc.fileName, doc.mime as AllowedUploadMime)
    : safeFileName(doc.fileName);
  if (variant === "original") return { mime: doc.mime, fileName: honest };
  const stem = honest.replace(/\.[^.]+$/, "");
  return { mime: "image/webp", fileName: `${stem}_${variant}.webp` };
}

/** What streamDocument() returns. */
export interface DocumentStream {
  stream: Readable;
  mime: string;
  size: number | null;
  fileName: string;
  /**
   * True when a thumb/medium rendition was asked for but does not exist yet (renditions pending or failed): the ORIGINAL is served. Callers
   * that cache by URL must not cache such a response for long (the rendition will replace it).
   */
  fallback?: boolean;
}

/**
 * Opens a stream of a live (not deleted) document rendition; null when the document, the variant or the stored object is missing.
 * The original streams from storage with its recorded size; the (small) webp renditions are read whole so Content-Length is exact.
 */
export async function streamDocument(
  executor: Executor,
  documentId: string,
  variant: DocumentVariant = "original",
): Promise<DocumentStream | null> {
  if (!UUID_RE.test(documentId)) return null;
  const [doc] = await executor
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.isDeleted, false)))
    .limit(1);
  if (!doc) return null;
  let key = variantKey(doc, variant);
  let served = variant;
  // the original is served until an image's renditions exist
  if (!key && variant !== "original" && doc.mime.startsWith("image/")) {
    key = doc.storageKey;
    served = "original";
  }
  if (!key) return null;
  const store = storage();
  if (!(await store.exists(key))) return null;
  const { mime, fileName } = variantMeta(doc, served);
  const fallback = served !== variant;
  if (served === "original")
    return { stream: await store.stream(key), mime, size: Number(doc.sizeBytes), fileName, fallback };
  const bytes = await store.get(key);
  return { stream: Readable.from([bytes]), mime, size: bytes.length, fileName, fallback };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Selection used by every documents query (row + type + uploader names) — one query, no per-row lookups. */
export const DOCUMENT_SELECT = {
  doc: documents,
  typeName: documentTypes.name,
  isKyc: documentTypes.isKyc,
  staffName: users.name,
  customerName: customers.fullName,
};

/** Adds the type/uploader joins to a (dynamic) documents query builder. */
export function withDocumentJoins(q: PgSelect): PgSelect {
  return q
    .leftJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .leftJoin(users, and(eq(documents.uploadedByType, "STAFF"), eq(users.id, documents.uploadedBy)))
    .leftJoin(customers, and(eq(documents.uploadedByType, "CUSTOMER"), eq(customers.id, documents.uploadedBy)));
}

/** Wire row for a joined document (storage keys never leave the server; image URLs are signed, or public for CMS media). */
export function toDocumentRow(j: DocumentJoined): DocumentRow {
  const d = j.doc;
  const hasVariants = Boolean(d.variants?.thumb_key && d.variants?.medium_key);
  const renditions = renditionStatus(d.mime, d.variants as StoredVariants | null);
  // until an image's renditions exist its thumb/medium links point at the original (a different URL, so nothing caches the original
  // under a rendition's address)
  const urlFor = (variant: DocumentVariant): string | null => {
    if (!hasVariants && !d.mime.startsWith("image/")) return null;
    const v: DocumentVariant = hasVariants ? variant : "original";
    return d.entityType === "CMS" ? publicMediaUrl(d.id, v) : signedUrl(d.id, v).url;
  };
  return {
    id: d.id,
    entity_type: d.entityType,
    entity_id: d.entityId,
    document_type_id: d.documentTypeId,
    document_type_name: j.typeName,
    is_kyc: j.isKyc ?? false,
    title: d.title ?? d.fileName,
    file_name: d.fileName,
    mime: d.mime,
    size_bytes: Number(d.sizeBytes),
    sha256: d.sha256,
    width: d.variants?.width ?? null,
    height: d.variants?.height ?? null,
    has_variants: hasVariants,
    renditions,
    thumb_url: urlFor("thumb"),
    medium_url: urlFor("medium"),
    is_sensitive: d.isSensitive,
    shared_with_customer: d.sharedWithCustomer,
    version: d.version,
    uploaded_by_type: d.uploadedByType,
    uploaded_by: d.uploadedBy,
    uploaded_by_name:
      d.uploadedByType === "STAFF" ? j.staffName : d.uploadedByType === "CUSTOMER" ? j.customerName : "system",
    is_deleted: d.isDeleted,
    created_at: new Date(d.createdAt).toISOString(),
  };
}

/** Loads one joined document by id within the company (optionally including soft-deleted rows); null when missing. */
export async function loadJoined(
  executor: Executor,
  companyId: string,
  id: string,
  opts: { includeDeleted?: boolean; forUpdate?: boolean } = {},
): Promise<DocumentJoined | null> {
  const where = and(
    eq(documents.id, id),
    eq(documents.companyId, companyId),
    opts.includeDeleted ? undefined : eq(documents.isDeleted, false),
  );
  const q = withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic()).where(where).limit(1);
  const rows = await (opts.forUpdate ? q.for("update", { of: documents }) : q);
  return (rows[0] as DocumentJoined | undefined) ?? null;
}

/** Live documents of one entity, newest first (sensitive rows only when `includeSensitive`). */
export async function listForEntity(
  executor: Executor,
  companyId: string,
  entityType: DocumentEntityType,
  entityId: string,
  opts: { includeSensitive?: boolean } = {},
): Promise<DocumentRow[]> {
  const rows = await withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic())
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.entityType, entityType),
        eq(documents.entityId, entityId),
        eq(documents.isDeleted, false),
        opts.includeSensitive ? undefined : eq(documents.isSensitive, false),
      ),
    )
    .orderBy(desc(documents.createdAt), desc(documents.id));
  return (rows as DocumentJoined[]).map(toDocumentRow);
}

/** Loads the given documents (any entity) as wire rows in one query, in id order; used by callers holding `attachment_ids`. */
export async function loadRows(executor: Executor, companyId: string, ids: readonly string[]): Promise<DocumentRow[]> {
  if (ids.length === 0) return [];
  const rows = await withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic()).where(
    and(eq(documents.companyId, companyId), inArray(documents.id, [...ids]), eq(documents.isDeleted, false)),
  );
  const byId = new Map((rows as DocumentJoined[]).map((r) => [r.doc.id, toDocumentRow(r)]));
  return ids.map((id) => byId.get(id)).filter((r): r is DocumentRow => r !== undefined);
}

/**
 * Documents a customer may see in the portal: live, non-sensitive rows flagged `shared_with_customer` on the booking, on the
 * customer record, or on the booking's payments. Never returns KYC/sensitive documents (SPEC §16).
 */
export async function documentsSharedWithCustomer(
  executor: Executor,
  ref: { bookingId?: string | null; customerId?: string | null },
): Promise<DocumentRow[]> {
  const targets: SQL[] = [];
  if (ref.bookingId) {
    targets.push(and(eq(documents.entityType, "BOOKING"), eq(documents.entityId, ref.bookingId))!);
    targets.push(
      and(
        eq(documents.entityType, "PAYMENT"),
        inArray(documents.entityId, sql`(select p.id from payments p where p.booking_id = ${ref.bookingId})`),
      )!,
    );
  }
  if (ref.customerId) targets.push(and(eq(documents.entityType, "CUSTOMER"), eq(documents.entityId, ref.customerId))!);
  if (targets.length === 0) return [];
  const rows = await withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic())
    .where(
      and(
        eq(documents.isDeleted, false),
        eq(documents.sharedWithCustomer, true),
        eq(documents.isSensitive, false),
        or(...targets),
      ),
    )
    .orderBy(desc(documents.createdAt), desc(documents.id));
  return (rows as DocumentJoined[]).map(toDocumentRow);
}
