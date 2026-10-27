import type { FastifyInstance } from "fastify";
import { portalAuthRoutes } from "./portal.js";
import { registerReencryptJob } from "./reencrypt.js";
import { staffAuthRoutes } from "./staff.js";

export { revokeAllFamilies } from "./service.js";
export { reencryptFields, countStaleCiphertexts, registerReencryptJob, ENCRYPTED_TARGETS } from "./reencrypt.js";

/** Registers staff (/auth/*) and customer (/portal/auth/*) authentication routes and the REENCRYPT_FIELDS key-rotation job. */
export async function authModule(app: FastifyInstance): Promise<void> {
  await staffAuthRoutes(app);
  await portalAuthRoutes(app);
  registerReencryptJob();
}
