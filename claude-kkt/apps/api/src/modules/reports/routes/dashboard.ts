/** Route: GET /dashboard → the caller's role dashboard (SPEC §14), cached 15 s per role + user scope. */
import type { FastifyInstance } from "fastify";
import { DashboardQuerySchema, DashboardResponseSchema } from "@kkt/contracts";
import { route } from "../../../lib/routes.js";
import { dashboardFor } from "../services/dashboards.js";

export function registerDashboardRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/dashboard",
    permission: "dashboard.view",
    schema: {
      querystring: DashboardQuerySchema,
      response: { 200: DashboardResponseSchema },
      summary:
        "Role dashboard (Owner / Accounts / Sales / Project Admin / Employee widgets), project-scoped, cached 15 s",
    },
    handler: async (req) => dashboardFor(app.dbReplica, app.redis, req.user!, req.query),
  });
}
