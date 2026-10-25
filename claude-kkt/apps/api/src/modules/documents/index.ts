import type { FastifyInstance } from "fastify";
import { registerDocumentRoutes } from "./routes.js";

export {
  storeBuffer, signedUrl, publicMediaUrl, streamDocument, listForEntity, loadRows, documentsSharedWithCustomer, toDocumentRow, loadJoined,
  verifyLinkToken, variantKey, variantMeta, SIGNED_LINK_TTL_SECONDS,
  type StoreBufferInput, type DocumentRecord, type DocumentJoined, type DocumentStream,
} from "./service.js";
export { resolveEntity, requireEntity, assertEntityWrite, documentScopeCondition, ENTITY_WRITE_PERMISSION, type EntityRef } from "./entities.js";

/**
 * Documents & media module (SPEC §13, §2, §16): multipart uploads validated by file signature, uuid storage keys, webp variants,
 * KYC sensitivity rules, soft delete, signed 15-minute links and the public `/files/:token` stream. Auto-registered under /api/v1.
 */
export default async function documentsModule(app: FastifyInstance): Promise<void> {
  registerDocumentRoutes(app);
}
