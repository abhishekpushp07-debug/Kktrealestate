/**
 * Construction module (SPEC §9): tower construction status, jump-ahead completion, the UNDO RULE, stage photos with buyer/website flags,
 * derived construction % and the related notifications. Auto-registered under /api/v1 by the module loader.
 *
 * Service surface other modules may call (portal, public/web, seed, reports):
 *   blockStageTimeline(executor, blockId, { visibleToBuyersOnly, websiteOnly, linkTtlSeconds }) · blockConstruction(db, block) · projectConstruction(db, user, projectId)
 *   updateConstructionStatus(tx, user, actor, blockId, input) · undoStage(tx, user, actor, blockId, input) · patchStage(...) · addPhoto(...) · updatePhoto(...) · deletePhoto(...)
 *   constructionPercent(stages) · deriveProgress(stages) · recomputeBlockPercent(tx, blockId, expectedVersion) · loadBlockScoped · loadStages · findStage
 */
import type { FastifyInstance } from "fastify";
import { registerConstructionRoutes } from "./routes.js";

export {
  blockStageTimeline,
  blockConstruction,
  projectConstruction,
  updateConstructionStatus,
  undoStage,
  patchStage,
  addPhoto,
  updatePhoto,
  deletePhoto,
  constructionPercent,
  deriveProgress,
  recomputeBlockPercent,
  loadBlockScoped,
  loadStages,
  findStage,
  requireStage,
  toPhotoRows,
  parseBlockingReasons,
  STAGE_ENTITY_TYPE,
  STAGE_STAFF_ROLES,
  type ConstructionActor,
  type StatusUpdateInput,
  type StagePatchInput,
  type TimelineOptions,
  type BlockRecord,
  type BlockStageRecord,
  type StagePhotoRecord,
  type ScopedUser,
} from "./service.js";

/** Fastify plugin: construction routes. */
export default async function constructionModule(app: FastifyInstance): Promise<void> {
  registerConstructionRoutes(app);
}
