/**
 * Customer portal module (SPEC §16, §2 buyer rules, §18 scenario 10 buyer-isolation parts; API-CONVENTIONS Appendix C and its additions).
 * Every route is `audience: "portal"` (the auth plugin verifies the portal token, rejects staff tokens with 401 INVALID_AUDIENCE and
 * blocks everything but change-password / logout / me while must_change_password is set). A booking is visible only when the customer
 * is its primary applicant or a co-applicant — everything else, PDF and document links included, is 404 NOT_FOUND. No staff user id
 * and no storage key ever leaves this module. Portal auth (/portal/auth/*) and the customer bell (/portal/notifications/*) live in the
 * core auth and notifications modules; this module adds the unread counts the home screen shows.
 *
 * Service surface other modules may call:
 *   loadOwnedBooking(db, customer, bookingId) · listOwnedBookings(db, customer) · portalHome(db, customer, bookingId) · unreadNotificationCount(db, customerId)
 *   unreadNoticeCount(db, customer) · storeTempFile(redis, {bytes, filename, mime}) · openPortalFile(db, redis, token) · cleanupExpiredTempFiles(redis)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { PORTAL_FILE_TTL_SECONDS } from "./files.js";
import { registerBookingRoutes } from "./bookings.js";
import { openPortalFile, registerPortalJobs } from "./files.js";
import { registerNoticeRoutes } from "./notices.js";
import { registerProfileRoutes } from "./profile.js";
import { registerRequestRoutes } from "./requests.js";

export { loadOwnedBooking, listOwnedBookings, toSwitcherItem, scopedReader, memberCondition, type OwnedBooking } from "./common.js";
export { portalHome, portalFlat, portalLedger, portalReceipts, portalDemands, portalSchedule, portalConstruction, portalDocuments, portalBankDetails, unreadNotificationCount, unreadNoticeCount } from "./bookings.js";
export { storeTempFile, openPortalFile, cleanupExpiredTempFiles, verifyTempToken, PORTAL_FILE_TTL_SECONDS, PORTAL_FILE_CLEANUP_JOB } from "./files.js";
export { portalProfile, updatePortalProfile } from "./profile.js";
export { toPortalRequestRow, toPortalRequestDetail, requestCategories } from "./requests.js";

/** ASCII-only fallback filename for Content-Disposition. */
function asciiName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return ascii || "file";
}

/** Fastify plugin: portal routes + the temp-file cleanup job. */
export default async function portalModule(app: FastifyInstance): Promise<void> {
  registerBookingRoutes(app);
  registerRequestRoutes(app);
  registerNoticeRoutes(app);
  registerProfileRoutes(app);

  route(app, {
    method: "GET", url: "/portal/files/:token", public: true,
    schema: { params: z.object({ token: z.string().min(1).max(100) }), response: { 200: z.any() }, summary: "Stream a portal file through its signed, short-lived link (generated PDFs and shared documents; malformed, forged or expired tokens are 404)" },
    handler: async (req, reply) => {
      const file = await openPortalFile(app.dbReplica, app.redis, req.params.token);
      if (!file) throw ApiError.notFound("File");
      const inline = file.mime.startsWith("image/") || file.mime === "application/pdf";
      reply.header("Content-Type", file.mime);
      reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${asciiName(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
      reply.header("Cache-Control", `private, max-age=${PORTAL_FILE_TTL_SECONDS}`);
      reply.header("X-Content-Type-Options", "nosniff");
      if (file.size !== null) reply.header("Content-Length", String(file.size));
      return reply.send(file.stream);
    },
  });

  registerPortalJobs(app.redis);
}
