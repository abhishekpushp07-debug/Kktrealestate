import type { FastifyInstance } from "fastify";
import { registerJob } from "../../jobs/index.js";
import { registerExportRoutes } from "./exports.js";
import { renditionsJob, storageSweep } from "./renditions.js";
import { storage as documentStorage } from "./service.js";
import { registerDocumentRoutes } from "./routes.js";

export {
  uploadDocument,
  prepareUpload,
  stageUpload,
  insertStagedDocument,
  discardStagedUpload,
  signedUrl,
  publicMediaUrl,
  streamDocument,
  listForEntity,
  loadRows,
  documentsSharedWithCustomer,
  toDocumentRow,
  loadJoined,
  withDocumentJoins,
  DOCUMENT_SELECT,
  verifyLinkToken,
  variantKey,
  variantMeta,
  safeFileName,
  SIGNED_LINK_TTL_SECONDS,
  MAX_IMAGE_PIXELS,
  type StoreBufferInput,
  type PreparedUpload,
  type StagedUpload,
  type DocumentRecord,
  type DocumentJoined,
  type DocumentStream,
} from "./service.js";
export { storeFile, withTempDir, signFileToken, verifyFileToken, fileTokenKey } from "./files.js";
export {
  runCsvExport,
  cleanupExports,
  exportLink,
  exportFileName,
  toExportRow,
  resolveListRoute,
  exportUrl,
  EXPORT_TTL_DAYS,
  RESERVED_EXPORT_KEYS,
} from "./exports.js";
export { storage as documentStorage } from "./service.js";
export {
  renderDocument,
  requestRenditions,
  storageSweep,
  renditionStatus,
  imageSlots,
  deletionBackoffMs,
  PENDING_ORPHAN_AFTER_MS,
  type RenditionStatus,
} from "./renditions.js";
export {
  resolveEntity,
  requireEntity,
  assertEntityWrite,
  documentScopeCondition,
  ENTITY_WRITE_PERMISSION,
  type EntityRef,
} from "./entities.js";

/**
 * Documents & media module (SPEC §13, §2, §16): multipart uploads validated by file signature, uuid storage keys (written outside any
 * transaction, tracked in storage_pending_objects until their row commits), webp renditions by the DOCUMENT_RENDITIONS job, KYC
 * sensitivity rules, soft delete, signed 15-minute links and the public `/files/:token` stream; the STORAGE_SWEEP job; plus the
 * asynchronous CSV exports (`/exports`, jobs EXPORT_CSV and EXPORT_CLEANUP). Auto-registered under /api/v1.
 */
export default async function documentsModule(app: FastifyInstance): Promise<void> {
  registerDocumentRoutes(app);
  registerExportRoutes(app);
  // renditions run on the heavy queue after the upload committed; the sweep cleans up uploads that never committed (jobs/index.ts)
  registerJob("DOCUMENT_RENDITIONS", async (ctx) => renditionsJob(ctx, documentStorage()));
  registerJob("STORAGE_SWEEP", async (ctx) =>
    storageSweep(ctx.db, documentStorage(), { app: ctx.app, ...(ctx.signal ? { signal: ctx.signal } : {}) }),
  );
}
