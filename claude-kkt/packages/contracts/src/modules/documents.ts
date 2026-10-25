import { z } from "zod";
import { ActorTypeSchema, DocumentEntityTypeSchema } from "../enums.js";
import { BoolQuerySchema, IdSchema, ListQuerySchema, SignedLinkSchema, TimestampSchema, VersionSchema, listEnvelope } from "../common.js";

/** Maximum upload size (15 MB). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** MIME types accepted for uploads (validated by file signature server-side). */
export const ALLOWED_UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const AllowedUploadMimeSchema = z.enum(ALLOWED_UPLOAD_MIME_TYPES);
export type AllowedUploadMime = z.infer<typeof AllowedUploadMimeSchema>;

/** Metadata sent alongside a multipart upload. */
export const DocumentUploadMetaSchema = z.strictObject({
  entity_type: DocumentEntityTypeSchema,
  entity_id: IdSchema,
  document_type_id: IdSchema.optional().nullable(),
  title: z.string().trim().min(1).max(200).optional(),
  is_sensitive: z.boolean().default(false),
  shared_with_customer: z.boolean().default(false),
});
export type DocumentUploadMeta = z.infer<typeof DocumentUploadMetaSchema>;

/** Document row (never exposes storage keys). */
export const DocumentRowSchema = z.object({
  id: IdSchema,
  entity_type: DocumentEntityTypeSchema,
  entity_id: IdSchema,
  document_type_id: IdSchema.nullable(),
  document_type_name: z.string().nullable(),
  is_kyc: z.boolean(),
  title: z.string(),
  file_name: z.string(),
  mime: z.string(),
  size_bytes: z.int().min(0),
  sha256: z.string(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  has_variants: z.boolean(),
  thumb_url: z.string().nullable(),
  medium_url: z.string().nullable(),
  is_sensitive: z.boolean(),
  shared_with_customer: z.boolean(),
  version: VersionSchema,
  uploaded_by_type: ActorTypeSchema,
  uploaded_by: IdSchema.nullable(),
  uploaded_by_name: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: TimestampSchema,
});
export type DocumentRow = z.infer<typeof DocumentRowSchema>;

/** Update a document's title or sharing flags (KYC docs cannot be shared). */
export const DocumentUpdateSchema = z.strictObject({
  version: VersionSchema,
  title: z.string().trim().min(1).max(200).optional(),
  is_sensitive: z.boolean().optional(),
  shared_with_customer: z.boolean().optional(),
  document_type_id: IdSchema.optional().nullable(),
});
export type DocumentUpdate = z.infer<typeof DocumentUpdateSchema>;

/** List filter for documents. */
export const DocumentFilterSchema = ListQuerySchema.extend({
  entity_type: DocumentEntityTypeSchema.optional(),
  entity_id: IdSchema.optional(),
  document_type_id: IdSchema.optional(),
  shared_with_customer: BoolQuerySchema.optional(),
  include_deleted: BoolQuerySchema.default(false),
});
export type DocumentFilter = z.infer<typeof DocumentFilterSchema>;
export const DocumentListResponseSchema = listEnvelope(DocumentRowSchema);
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

/** Short-lived signed download link. */
export const DocumentDownloadLinkResponseSchema = SignedLinkSchema.extend({ file_name: z.string(), mime: z.string() });
export type DocumentDownloadLinkResponse = z.infer<typeof DocumentDownloadLinkResponseSchema>;

/** Upload response. */
export const DocumentUploadResponseSchema = z.object({ document: DocumentRowSchema });
export type DocumentUploadResponse = z.infer<typeof DocumentUploadResponseSchema>;

/** Stored renditions of a document: the original bytes, or the webp thumbnail (≈480 px) / medium (≈1080 px) generated for images. */
export const DOCUMENT_VARIANTS = ["original", "thumb", "medium"] as const;
export const DocumentVariantSchema = z.enum(DOCUMENT_VARIANTS);
export type DocumentVariant = z.infer<typeof DocumentVariantSchema>;

/** `POST /documents/:id/link?variant=` selector (defaults to the original). */
export const DocumentLinkQuerySchema = z.object({ variant: DocumentVariantSchema.default("original") });
export type DocumentLinkQuery = z.infer<typeof DocumentLinkQuerySchema>;

/** Business-rule codes raised by the documents module (`details.rule` of a 422 BUSINESS_RULE). */
export const DOCUMENT_RULES = ["KYC_NOT_SHAREABLE", "DOCUMENT_TYPE_NOT_APPLICABLE"] as const;
export type DocumentRule = (typeof DOCUMENT_RULES)[number];
