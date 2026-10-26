import type { FastifyInstance } from "fastify";
import { registerExportRoutes } from "./exports.js";
import { registerDocumentRoutes } from "./routes.js";

export {
  storeBuffer, signedUrl, publicMediaUrl, streamDocument, listForEntity, loadRows, documentsSharedWithCustomer, toDocumentRow, loadJoined,
  verifyLinkToken, variantKey, variantMeta, safeFileName, SIGNED_LINK_TTL_SECONDS, MAX_IMAGE_PIXELS,
  type StoreBufferInput, type DocumentRecord, type DocumentJoined, type DocumentStream,
} from "./service.js";
export { storeFile, withTempDir, signFileToken, verifyFileToken, fileTokenKey } from "./files.js";
export { runCsvExport, cleanupExports, exportLink, exportFileName, toExportRow, resolveListRoute, exportUrl, EXPORT_TTL_DAYS, RESERVED_EXPORT_KEYS } from "./exports.js";
export { storage as documentStorage } from "./service.js";
export { resolveEntity, requireEntity, assertEntityWrite, documentScopeCondition, ENTITY_WRITE_PERMISSION, type EntityRef } from "./entities.js";

/**
 * Documents & media module (SPEC §13, §2, §16): multipart uploads validated by file signature, uuid storage keys, webp variants,
 * KYC sensitivity rules, soft delete, signed 15-minute links and the public `/files/:token` stream; plus the asynchronous CSV exports
 * (`/exports`, jobs EXPORT_CSV and EXPORT_CLEANUP). Auto-registered under /api/v1.
 */
export default async function documentsModule(app: FastifyInstance): Promise<void> {
  registerDocumentRoutes(app);
  registerExportRoutes(app);
}
