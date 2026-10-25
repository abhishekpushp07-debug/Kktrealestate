/**
 * Customer portal module (SPEC §16, §2 buyer rules, §18 scenario 10 buyer-isolation parts; API-CONVENTIONS Appendix C and its additions).
 * Every route is `audience: "portal"` (the auth plugin verifies the portal token, rejects staff tokens with 401 INVALID_AUDIENCE and
 * blocks everything but change-password / logout / me while must_change_password is set). A booking is visible only when the customer
 * is its primary applicant or a co-applicant — everything else, PDF and document links included, is 404 NOT_FOUND. Every file link the
 * portal hands out is signed for the requesting customer and refused for anybody else (files.ts). No staff user id and no storage key
 * ever leaves this module. Portal auth (/portal/auth/*) and the customer bell (/portal/notifications/*) live in the core auth and
 * notifications modules; this module adds the unread counts the home screen shows.
 *
 * Service surface other modules may call:
 *   loadOwnedBooking(db, customer, bookingId) · listOwnedBookings(db, customer) · portalHome(db, customer, bookingId) · unreadNotificationCount(db, customerId)
 *   unreadNoticeCount(db, customer) · storeTempFile(redis, customerId, {bytes, filename, mime}) · portalDocumentUrl(customerId, documentId, variant)
 *   verifyPortalFileToken(token) · openPortalFile(db, redis, token, viewer) · cleanupExpiredTempFiles(redis)
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { portalUsers } from "@kkt/db";
import { ApiError } from "../../lib/errors.js";
import { verifyAccessToken } from "../../lib/jwt.js";
import { route } from "../../lib/routes.js";
import { registerBookingRoutes } from "./bookings.js";
import { PORTAL_FILE_TTL_SECONDS, openPortalFile, registerPortalJobs, verifyPortalFileToken, type PortalViewer } from "./files.js";
import { registerNoticeRoutes } from "./notices.js";
import { registerProfileRoutes } from "./profile.js";
import { registerRequestRoutes } from "./requests.js";

export { loadOwnedBooking, listOwnedBookings, toSwitcherItem, scopedReader, memberCondition, type OwnedBooking } from "./common.js";
export { portalHome, portalFlat, portalLedger, portalReceipts, portalDemands, portalSchedule, portalConstruction, portalDocuments, portalBankDetails, unreadNotificationCount, unreadNoticeCount } from "./bookings.js";
export {
  storeTempFile, openPortalFile, cleanupExpiredTempFiles, verifyTempToken, verifyPortalFileToken, signPortalFile, portalDocumentUrl, PORTAL_FILE_TTL_SECONDS, PORTAL_FILE_CLEANUP_JOB,
  type PortalFileToken, type PortalFileKind, type PortalViewer,
} from "./files.js";
export { portalProfile, updatePortalProfile } from "./profile.js";
export { toPortalRequestRow, toPortalRequestDetail, requestCategories, assertPortalAttachments } from "./requests.js";

/** ASCII-only fallback filename for Content-Disposition. */
function asciiName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return ascii || "file";
}

/**
 * Who is opening a portal file link, when the request says. No bearer → null (the signed link is the credential). A bearer that is not a
 * live portal access token of an existing portal account — a staff token, a forged or expired one — is "somebody else": the link is refused.
 */
async function viewerOf(app: FastifyInstance, req: FastifyRequest): Promise<PortalViewer | "FOREIGN"> {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "FOREIGN";
  const result = await verifyAccessToken(token.trim(), "portal");
  if (!result.ok) return "FOREIGN";
  const [pu] = await app.dbReplica.select({ customerId: portalUsers.customerId }).from(portalUsers).where(eq(portalUsers.id, result.claims.sub)).limit(1);
  return pu ? { customerId: pu.customerId } : "FOREIGN";
}

/** Fastify plugin: portal routes + the temp-file cleanup job. */
export default async function portalModule(app: FastifyInstance): Promise<void> {
  registerBookingRoutes(app);
  registerRequestRoutes(app);
  registerNoticeRoutes(app);
  registerProfileRoutes(app);

  route(app, {
    method: "GET", url: "/portal/files/:token", public: true,
    schema: {
      params: z.object({ token: z.string().min(1).max(100) }), response: { 200: z.any() },
      summary: "Stream a portal file through its signed, short-lived, customer-bound link (generated PDFs, shared documents, photos)",
      description: "Malformed, forged or expired tokens are 404. The link is bound to the customer it was issued to: a request carrying any bearer token other than that customer's own portal token is 404 too. Without a bearer the signed link itself is the credential (PDF viewers and share sheets).",
    },
    handler: async (req, reply) => {
      const token = verifyPortalFileToken(req.params.token);
      if (!token) throw ApiError.notFound("File");
      const viewer = await viewerOf(app, req as unknown as FastifyRequest);
      if (viewer === "FOREIGN") throw ApiError.notFound("File");
      const file = await openPortalFile(app.dbReplica, app.redis, token, viewer);
      if (!file) throw ApiError.notFound("File");
      const inline = file.mime.startsWith("image/") || file.mime === "application/pdf";
      reply.header("Content-Type", file.mime);
      reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${asciiName(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
      reply.header("Cache-Control", `private, max-age=${PORTAL_FILE_TTL_SECONDS}`);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cross-Origin-Resource-Policy", "cross-origin"); // <img>/PDF viewers on the portal origin (see web/shared.ts crossOriginFile)
      if (file.size !== null) reply.header("Content-Length", String(file.size));
      return reply.send(file.stream);
    },
  });

  registerPortalJobs(app.redis);
}
