import type { FastifyInstance } from "fastify";
import { registerMasterKind } from "./factory.js";
import { registerImportRoute } from "./importer.js";
import { MASTER_KIND_DEFS } from "./kinds.js";

export { MASTER_KIND_DEFS, kindDef } from "./kinds.js";

/** Masters module: 16 kinds through one CRUD factory plus CSV import. */
export async function mastersModule(app: FastifyInstance): Promise<void> {
  registerImportRoute(app);
  for (const def of MASTER_KIND_DEFS) registerMasterKind(app, def);
}
