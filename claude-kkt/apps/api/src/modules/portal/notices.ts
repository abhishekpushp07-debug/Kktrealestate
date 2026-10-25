/**
 * Portal notices (SPEC §13/§15 notices for buyers, §16; Appendix C): live notices that are company-wide or belong to a project of the
 * customer's bookings, with `is_read` derived from the bell. The customer bell itself (`GET /portal/notifications`, `…/unread-count`,
 * `POST …/mark-read`) is served by the core notifications module; this module only adds the unread counts the home screen shows.
 */
import type { FastifyInstance } from "fastify";
import { PortalNoticeListResponseSchema } from "@kkt/contracts";
import { route } from "../../lib/routes.js";
import { noticesForCustomer } from "../service/index.js";
import { PortalListQuerySchema, customerOf } from "./common.js";

/** Registers /portal/notices. */
export function registerNoticeRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/portal/notices", audience: "portal",
    schema: { querystring: PortalListQuerySchema, response: { 200: PortalNoticeListResponseSchema }, summary: "Live notices: company-wide plus the projects of the customer's bookings" },
    handler: async (req) => noticesForCustomer(app.dbReplica, customerOf(req).customerId, { page: req.query.page, page_size: req.query.page_size, cursor: req.query.cursor, limit: req.query.limit }),
  });
}
