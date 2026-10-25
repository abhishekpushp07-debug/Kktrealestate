/** Construction routes (SPEC §9): tower status, jump-ahead, undo, non-financial stage edits, photos, project summary. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BlockConstructionResponseSchema, BlockStageUpdateSchema, ConstructionStatusUpdateResponseSchema, ConstructionStatusUpdateSchema, ConstructionUndoResponseSchema, ConstructionUndoSchema,
  IdSchema, ProjectConstructionResponseSchema, StagePhotoCreateSchema, StagePhotoRowSchema, StagePhotoUpdateSchema,
} from "@kkt/contracts";
import { actorFromRequest } from "../../lib/audit.js";
import { route } from "../../lib/routes.js";
import { expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import { addPhoto, blockConstruction, deletePhoto, loadBlockScoped, patchStage, projectConstruction, undoStage, updateConstructionStatus, updatePhoto, type ConstructionActor } from "./service.js";

const blockParams = z.object({ id: IdSchema });
const stageParams = z.object({ id: IdSchema, stageId: IdSchema });
const photoParams = z.object({ photoId: IdSchema });

/** The contract body with `version` optional (If-Match alternative); the cross-field date rule is re-applied because withOptionalVersion rebuilds the object. */
const StatusBodySchema = withOptionalVersion(ConstructionStatusUpdateSchema).refine((u) => Object.values(u.intermediate_dates).every((d) => d <= u.completed_on), {
  message: "Intermediate stage dates cannot be after the reached stage's date",
  path: ["intermediate_dates"],
});
const UndoBodySchema = withOptionalVersion(ConstructionUndoSchema);
const StagePatchBodySchema = withOptionalVersion(BlockStageUpdateSchema);

function actorOf(req: FastifyRequest): ConstructionActor {
  return { ...actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

export function registerConstructionRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/blocks/:id/construction", permission: "project.read",
    schema: { params: blockParams, response: { 200: BlockConstructionResponseSchema }, summary: "Tower construction status: stages in order with dates, notes, photos, demand counts, derived % and the undo candidate" },
    handler: async (req) => {
      const block = await loadBlockScoped(app.dbReplica, req.user!, req.params.id);
      return blockConstruction(app.dbReplica, block);
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/construction/status", permission: "construction.update", idempotent: true,
    schema: { params: blockParams, body: StatusBodySchema, response: { 200: ConstructionStatusUpdateResponseSchema }, summary: "Mark the stage reached (intermediate stages are completed too), raise dues for every active booking and notify" },
    handler: async (req) => {
      const body = req.body;
      return app.db.transaction((tx) => updateConstructionStatus(tx, req.user!, actorOf(req), req.params.id, {
        stageRef: body.stage_id, completedOn: body.completed_on, intermediateDates: body.intermediate_dates, notes: body.notes, notifyBuyers: body.notify_buyers,
        markInProgressRef: body.mark_in_progress_stage_id, expectedVersion: expectedVersion(req, body),
      }));
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/construction/undo", permission: "construction.undo", idempotent: true,
    schema: { params: blockParams, body: UndoBodySchema, response: { 200: ConstructionUndoResponseSchema }, summary: "Undo the latest completed stage (UNDO RULE): void its demands, clear completion data, withdraw notifications" },
    handler: async (req) => {
      const body = req.body;
      return app.db.transaction((tx) => undoStage(tx, req.user!, actorOf(req), req.params.id, { stageRef: body.stage_id, reason: body.reason, expectedVersion: expectedVersion(req, body) }));
    },
  });

  route(app, {
    method: "PATCH", url: "/blocks/:id/construction/:stageId", permission: "construction.update",
    schema: { params: stageParams, body: StagePatchBodySchema, response: { 200: BlockConstructionResponseSchema }, summary: "Non-financial stage edits: notes, started_on, PENDING ↔ IN_PROGRESS (never COMPLETED)" },
    handler: async (req) => {
      const body = req.body;
      return app.db.transaction((tx) => patchStage(tx, req.user!, actorOf(req), req.params.id, req.params.stageId, { notes: body.notes, startedOn: body.started_on, status: body.status, expectedVersion: expectedVersion(req, body) }));
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/construction/:stageId/photos", permission: "construction.update", idempotent: true,
    schema: { params: stageParams, body: StagePhotoCreateSchema, response: { 201: StagePhotoRowSchema }, summary: "Attach an uploaded image (STAGE / BLOCK / PROJECT document) as a stage photo with buyer and website flags" },
    handler: async (req, reply) => {
      const row = await app.db.transaction((tx) => addPhoto(tx, req.user!, actorOf(req), req.params.id, req.params.stageId, req.body));
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "PATCH", url: "/construction/photos/:photoId", permission: "construction.update",
    schema: { params: photoParams, body: StagePhotoUpdateSchema, response: { 200: StagePhotoRowSchema }, summary: "Update a stage photo's caption, flags or order (If-Match optional)" },
    handler: async (req) => app.db.transaction((tx) => updatePhoto(tx, req.user!, actorOf(req), req.params.photoId, req.body, (current) => optionalExpectedVersion(req, null, current))),
  });

  route(app, {
    method: "DELETE", url: "/construction/photos/:photoId", permission: "construction.update",
    schema: { params: photoParams, response: { 204: z.null() }, summary: "Remove a stage photo (the document itself is kept)" },
    handler: async (req, reply) => {
      await app.db.transaction((tx) => deletePhoto(tx, req.user!, actorOf(req), req.params.photoId));
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "GET", url: "/projects/:id/construction", permission: "project.read",
    schema: { params: blockParams, response: { 200: ProjectConstructionResponseSchema }, summary: "Construction summary of every tower of a project (dashboards, website)" },
    handler: async (req) => projectConstruction(app.dbReplica, req.user!, req.params.id),
  });
}
