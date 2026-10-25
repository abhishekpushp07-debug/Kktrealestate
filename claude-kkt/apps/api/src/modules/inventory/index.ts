import type { FastifyInstance } from "fastify";
import { registerBlockRoutes } from "./blocks.js";
import { registerFlatRoutes } from "./flats.js";
import { registerParkingRoutes } from "./parking.js";
import { registerProjectRoutes } from "./projects.js";
import { registerRateCardRoutes } from "./rateCards.js";

// Service functions other modules (booking engine, construction, web) may call.
export {
  refreshUnitCounts, refreshProjectCounts, ensureBlockStages, snapshotBlockStages, allStagesPending, loadProject, loadBlock, loadFlat,
  loadActiveRateCard, loadRateCardDomain, priceWith, repriceFlats, applyPriceUpdates, writeAuditMany, MANUAL_STATUSES, ENGINE_STATUSES,
  type DbProject, type DbBlock, type DbFlat, type LoadedRateCard,
} from "./service.js";
export { toProjectRows, getProjectRow } from "./projects.js";
export { toBlockRows, getBlockRow } from "./blocks.js";
export { toFlatRows, getFlatRow, manualStatusChanges, statusAudit, defaultHoldUntil, FLAT_SELECT, flatJoins, type FlatSelect } from "./flats.js";
export { toParkingRows, loadParkingSlot, manualParkingStatus } from "./parking.js";
export { toRateCardRows } from "./rateCards.js";

/** Inventory module (SPEC §4/§5): projects, parking, blocks (generation, grid, bulk ops), flats, rate cards. */
export default async function inventoryModule(app: FastifyInstance): Promise<void> {
  registerProjectRoutes(app);
  registerParkingRoutes(app);
  registerBlockRoutes(app);
  registerFlatRoutes(app);
  registerRateCardRoutes(app);
}
