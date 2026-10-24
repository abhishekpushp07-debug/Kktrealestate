import type { FastifyInstance } from "fastify";
import { portalAuthRoutes } from "./portal.js";
import { staffAuthRoutes } from "./staff.js";

/** Registers staff (/auth/*) and customer (/portal/auth/*) authentication routes. */
export async function authModule(app: FastifyInstance): Promise<void> {
  await staffAuthRoutes(app);
  await portalAuthRoutes(app);
}
