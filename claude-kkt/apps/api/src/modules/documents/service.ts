import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import {
  ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES,
  type ActorType, type AllowedUploadMime, type DocumentEntityType, type DocumentRow, type DocumentVariant,
} from "@kkt/contracts";
import { customers, documentTypes, documents, users, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import { sha256, signPayload, verifyPayload } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { createStorage, type Storage } from "../../lib/storage.js";

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
const THUMB_WIDTH = 480;
const MEDIUM_WIDTH = 1080;
/** Images above this many pixels (width × height) are refused before any decoding (decompression-bomb guard). */
export const MAX_IMAGE_PIXELS = 50_000_000;
const EXT: Record<AllowedUploadMime, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Filename extensions that honestly describe each accepted type (anything else gets the canonical one appended). */
const HONEST_EXT: Record<AllowedUploadMime, readonly string[]> = { "application/pdf": ["pdf"], "image/jpeg": ["jpg", "jpeg", "jpe", "jfif"], "image/png": ["png"], "image/webp": ["webp"] };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let storageInstance: Storage | null = null;
/** The process-wide storage driver (lazy so tests can point STORAGE_LOCAL_DIR elsewhere before the first upload). */
export function storage(): Storage {
  storageInstance ??= createStorage();
  return storageInstance;
}

/** Input of storeBuffer(). */
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
export interface DocumentTypeInfo { id: string; name: string; isKyc: boolean; appliesTo: string[] }

/** Loads an active document type of the company; 400 when it does not exist. */
export async function loadDocumentType(executor: Executor, companyId: string, id: string): Promise<DocumentTypeInfo> {
  const [t] = await executor
    .select({ id: documentTypes.id, name: documentTypes.name, isKyc: documentTypes.isKyc, appliesTo: documentTypes.appliesTo })
    .from(documentTypes)
    .where(and(eq(documentTypes.id, id), eq(documentTypes.companyId, companyId), eq(documentTypes.isActive, true)))
    .limit(1);
  if (!t) throw ApiError.badRequest("document_type_id does not refer to an active document type", { issues: [{ path: "document_type_id", message: "Unknown document type" }] });
  return t;
}

/**
 * Applies the document-type rules: the type must apply to the entity kind (422 DOCUMENT_TYPE_NOT_APPLICABLE), KYC types force
 * `is_sensitive` and can never be shared with the customer (422 KYC_NOT_SHAREABLE). Returns the effective flags.
 */
export function applyTypeRules(type: DocumentTypeInfo | null, entityType: DocumentEntityType, flags: { isSensitive: boolean; sharedWithCustomer: boolean }): { isSensitive: boolean; sharedWithCustomer: boolean } {
  if (!type) return flags;
  if (type.appliesTo.length > 0 && !type.appliesTo.includes(entityType)) {
    throw ApiError.rule(`Document type "${type.name}" does not apply to ${entityType.toLowerCase().replace(/_/g, " ")} records`, "DOCUMENT_TYPE_NOT_APPLICABLE", { document_type_id: type.id, applies_to: type.appliesTo, entity_type: entityType });
  }
  if (!type.isKyc) return flags;
  if (flags.sharedWithCustomer) throw ApiError.rule("KYC documents cannot be shared with the customer", "KYC_NOT_SHAREABLE", { document_type_id: type.id });
  return { isSensitive: true, sharedWithCustomer: false };
}

/** Sniffs the real media type from the bytes (never trusts extension or client MIME); 415 for anything outside the allow-list. */
export async function detectMime(buffer: Buffer): Promise<AllowedUploadMime> {
  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime;
  if (!mime || !(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "Only PDF, JPEG, PNG and WebP files are accepted", { detected: mime ?? null, allowed: [...ALLOWED_UPLOAD_MIME_TYPES] });
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

/**
 * Validates and stores an uploaded file inside the caller's transaction: 15 MB cap (413), magic-byte type check (415), sha256,
 * uuid storage key, webp thumb/medium variants for images, document-type/KYC rules. Returns the inserted row. Audit is the caller's job.
 */
export async function storeBuffer(tx: Executor, input: StoreBufferInput): Promise<DocumentRecord> {
  if (input.buffer.length === 0) throw ApiError.badRequest("Uploaded file is empty");
  if (input.buffer.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`, { max_bytes: MAX_UPLOAD_BYTES, size_bytes: input.buffer.length });
  const mime = await detectMime(input.buffer);
  const type = input.documentTypeId ? await loadDocumentType(tx, input.companyId, input.documentTypeId) : null;
  const flags = applyTypeRules(type, input.entityType, { isSensitive: input.isSensitive ?? false, sharedWithCustomer: input.sharedWithCustomer ?? false });
  // Image bombs: refuse by declared dimensions (header only) before a single pixel is decoded.
  const dims = mime === "application/pdf" ? null : await imageDimensions(input.buffer);

  const { key, base } = buildStorageKey(input.companyId, EXT[mime]);
  const written: string[] = [];
  const store = storage();
  try {
    await store.put(key, input.buffer, mime);
    written.push(key);
    let variants: DocumentRecord["variants"] = null;
    if (mime !== "application/pdf") {
      // A rendition failure (truncated/odd image) must never lose the original: the document is kept without variants.
      const img = await makeVariants(input.buffer).catch(() => null);
      if (img) {
        await store.put(`${base}_thumb.webp`, img.thumb, "image/webp");
        written.push(`${base}_thumb.webp`);
        await store.put(`${base}_medium.webp`, img.medium, "image/webp");
        written.push(`${base}_medium.webp`);
        variants = { thumb_key: `${base}_thumb.webp`, medium_key: `${base}_medium.webp`, width: img.width ?? dims?.width ?? null, height: img.height ?? dims?.height ?? null };
      } else if (dims) {
        variants = { width: dims.width, height: dims.height };
      }
    }
    const [row] = await tx
      .insert(documents)
      .values({
        companyId: input.companyId,
        entityType: input.entityType,
        entityId: input.entityId,
        documentTypeId: type?.id ?? null,
        title: input.title?.trim() || null,
        fileName: safeFileName(input.filename, mime),
        mime,
        sizeBytes: input.buffer.length,
        sha256: sha256(input.buffer),
        storageKey: key,
        variants,
        isSensitive: flags.isSensitive,
        sharedWithCustomer: flags.sharedWithCustomer,
        uploadedByType: input.uploadedByType ?? "STAFF",
        uploadedBy: input.uploadedBy,
      })
      .returning();
    if (!row) throw new Error("documents insert returned no row");
    return row;
  } catch (err) {
    await Promise.all(written.map((k) => store.remove(k).catch(() => undefined)));
    throw err;
  }
}

/** Reads the declared image dimensions from the header (no pixel decoding); 413 when they exceed MAX_IMAGE_PIXELS, 415 when unreadable. */
async function imageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  } catch {
    throw new ApiError(415, "UNSUPPORTED_MEDIA", "Image could not be decoded");
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) throw new ApiError(415, "UNSUPPORTED_MEDIA", "Image has no readable dimensions");
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Image exceeds ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`, { max_pixels: MAX_IMAGE_PIXELS, width, height });
  }
  return { width, height };
}

/** Generates the webp thumb (≈480 px wide) and medium (≈1080 px wide) renditions; throws when the bytes are not a decodable image. */
async function makeVariants(buffer: Buffer): Promise<{ thumb: Buffer; medium: Buffer; width: number | null; height: number | null }> {
  const opts = { limitInputPixels: MAX_IMAGE_PIXELS };
  const meta = await sharp(buffer, opts).metadata();
  const [thumb, medium] = await Promise.all([
    sharp(buffer, opts).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
    sharp(buffer, opts).rotate().resize({ width: MEDIUM_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
  ]);
  return { thumb, medium, width: meta.width ?? null, height: meta.height ?? null };
}

/**
 * Trims a client filename to something printable and bounded (metadata + Content-Disposition only): path components, control
 * characters, quotes and leading dots are dropped, and when the extension does not honestly describe the detected type
 * (`invoice.pdf.exe`, `photo.jpg` that is really a PNG) the canonical extension is appended so downloads open with the right app.
 */
export function safeFileName(name: string, mime?: AllowedUploadMime): string {
  const base = name.split(/[\\/]/).filter(Boolean).pop() ?? "file";
  let clean = base.replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^[. ]+/, "").trim().slice(0, 180);
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

interface LinkPayload extends Record<string, string | number> { d: string; v: DocumentVariant }

/** Signed, short-lived download URL for a document rendition (served by `GET /api/v1/files/:token`). */
export function signedUrl(documentId: string, variant: DocumentVariant = "original", ttlSeconds = SIGNED_LINK_TTL_SECONDS): { url: string; expires_at: string } {
  const token = signPayload({ d: documentId, v: variant } satisfies LinkPayload, ttlSeconds);
  return { url: `${config.API_PUBLIC_URL}/api/v1/files/${token}`, expires_at: new Date((Math.floor(Date.now() / 1000) + ttlSeconds) * 1000).toISOString() };
}

/** Verifies a `/files/:token` token; null when forged or expired. */
export function verifyLinkToken(token: string): { documentId: string; variant: DocumentVariant } | null {
  const data = verifyPayload<LinkPayload>(token);
  if (!data || typeof data.d !== "string" || !UUID_RE.test(data.d) || !["original", "thumb", "medium"].includes(String(data.v))) return null;
  return { documentId: data.d, variant: data.v };
}

/** Long-lived public URL for CMS media (served by the web/public module through streamDocument()). */
export function publicMediaUrl(documentId: string, variant: DocumentVariant = "original"): string {
  const q = variant === "original" ? "" : `?variant=${variant}`;
  return `${config.API_PUBLIC_URL}/api/v1/public/media/${documentId}${q}`;
}

/** Storage key of a rendition; null when the document has no such variant. */
export function variantKey(doc: Pick<DocumentRecord, "storageKey" | "variants">, variant: DocumentVariant): string | null {
  if (variant === "original") return doc.storageKey;
  const key = variant === "thumb" ? doc.variants?.thumb_key : doc.variants?.medium_key;
  return key ?? null;
}

/** MIME and download filename of a rendition (the original's name is re-checked against its type so a stored legacy name cannot lie). */
export function variantMeta(doc: Pick<DocumentRecord, "mime" | "fileName">, variant: DocumentVariant): { mime: string; fileName: string } {
  const honest = (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(doc.mime) ? safeFileName(doc.fileName, doc.mime as AllowedUploadMime) : safeFileName(doc.fileName);
  if (variant === "original") return { mime: doc.mime, fileName: honest };
  const stem = honest.replace(/\.[^.]+$/, "");
  return { mime: "image/webp", fileName: `${stem}_${variant}.webp` };
}

/** What streamDocument() returns. */
export interface DocumentStream { stream: Readable; mime: string; size: number | null; fileName: string }

/**
 * Opens a stream of a live (not deleted) document rendition; null when the document, the variant or the stored object is missing.
 * The original streams from storage with its recorded size; the (small) webp renditions are read whole so Content-Length is exact.
 */
export async function streamDocument(executor: Executor, documentId: string, variant: DocumentVariant = "original"): Promise<DocumentStream | null> {
  if (!UUID_RE.test(documentId)) return null;
  const [doc] = await executor.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.isDeleted, false))).limit(1);
  if (!doc) return null;
  const key = variantKey(doc, variant);
  if (!key) return null;
  const store = storage();
  if (!(await store.exists(key))) return null;
  const { mime, fileName } = variantMeta(doc, variant);
  if (variant === "original") return { stream: await store.stream(key), mime, size: Number(doc.sizeBytes), fileName };
  const bytes = await store.get(key);
  return { stream: Readable.from([bytes]), mime, size: bytes.length, fileName };
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
  const urlFor = (variant: DocumentVariant): string | null => {
    if (!hasVariants) return null;
    return d.entityType === "CMS" ? publicMediaUrl(d.id, variant) : signedUrl(d.id, variant).url;
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
    thumb_url: urlFor("thumb"),
    medium_url: urlFor("medium"),
    is_sensitive: d.isSensitive,
    shared_with_customer: d.sharedWithCustomer,
    uploaded_by_type: d.uploadedByType,
    uploaded_by: d.uploadedBy,
    uploaded_by_name: d.uploadedByType === "STAFF" ? j.staffName : d.uploadedByType === "CUSTOMER" ? j.customerName : "system",
    is_deleted: d.isDeleted,
    created_at: new Date(d.createdAt).toISOString(),
  };
}

/** Loads one joined document by id within the company (optionally including soft-deleted rows); null when missing. */
export async function loadJoined(executor: Executor, companyId: string, id: string, opts: { includeDeleted?: boolean; forUpdate?: boolean } = {}): Promise<DocumentJoined | null> {
  const where = and(eq(documents.id, id), eq(documents.companyId, companyId), opts.includeDeleted ? undefined : eq(documents.isDeleted, false));
  const q = withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic()).where(where).limit(1);
  const rows = await (opts.forUpdate ? q.for("update", { of: documents }) : q);
  return (rows[0] as DocumentJoined | undefined) ?? null;
}

/** Live documents of one entity, newest first (sensitive rows only when `includeSensitive`). */
export async function listForEntity(executor: Executor, companyId: string, entityType: DocumentEntityType, entityId: string, opts: { includeSensitive?: boolean } = {}): Promise<DocumentRow[]> {
  const rows = await withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic())
    .where(and(eq(documents.companyId, companyId), eq(documents.entityType, entityType), eq(documents.entityId, entityId), eq(documents.isDeleted, false), opts.includeSensitive ? undefined : eq(documents.isSensitive, false)))
    .orderBy(desc(documents.createdAt), desc(documents.id));
  return (rows as DocumentJoined[]).map(toDocumentRow);
}

/** Loads the given documents (any entity) as wire rows in one query, in id order; used by callers holding `attachment_ids`. */
export async function loadRows(executor: Executor, companyId: string, ids: readonly string[]): Promise<DocumentRow[]> {
  if (ids.length === 0) return [];
  const rows = await withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic())
    .where(and(eq(documents.companyId, companyId), inArray(documents.id, [...ids]), eq(documents.isDeleted, false)));
  const byId = new Map((rows as DocumentJoined[]).map((r) => [r.doc.id, toDocumentRow(r)]));
  return ids.map((id) => byId.get(id)).filter((r): r is DocumentRow => r !== undefined);
}

/**
 * Documents a customer may see in the portal: live, non-sensitive rows flagged `shared_with_customer` on the booking, on the
 * customer record, or on the booking's payments. Never returns KYC/sensitive documents (SPEC §16).
 */
export async function documentsSharedWithCustomer(executor: Executor, ref: { bookingId?: string | null; customerId?: string | null }): Promise<DocumentRow[]> {
  const targets: SQL[] = [];
  if (ref.bookingId) {
    targets.push(and(eq(documents.entityType, "BOOKING"), eq(documents.entityId, ref.bookingId))!);
    targets.push(and(eq(documents.entityType, "PAYMENT"), inArray(documents.entityId, sql`(select p.id from payments p where p.booking_id = ${ref.bookingId})`))!);
  }
  if (ref.customerId) targets.push(and(eq(documents.entityType, "CUSTOMER"), eq(documents.entityId, ref.customerId))!);
  if (targets.length === 0) return [];
  const rows = await withDocumentJoins(executor.select(DOCUMENT_SELECT).from(documents).$dynamic())
    .where(and(eq(documents.isDeleted, false), eq(documents.sharedWithCustomer, true), eq(documents.isSensitive, false), or(...targets)))
    .orderBy(desc(documents.createdAt), desc(documents.id));
  return (rows as DocumentJoined[]).map(toDocumentRow);
}
