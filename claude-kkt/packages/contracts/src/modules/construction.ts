import { z } from "zod";
import { StageStatusSchema } from "../enums.js";
import {
  DateStringSchema,
  IdSchema,
  NoteSchema,
  ReasonSchema,
  TimestampSchema,
  VersionSchema,
  VersionedSchema,
  listEnvelope,
} from "../common.js";

/** A construction photo on a stage. */
export const StagePhotoRowSchema = z.object({
  id: IdSchema,
  block_stage_id: IdSchema,
  document_id: IdSchema,
  caption: z.string().nullable(),
  visible_to_buyers: z.boolean(),
  show_on_website: z.boolean(),
  sort_order: z.int(),
  thumb_url: z.string().nullable(),
  medium_url: z.string().nullable(),
  created_at: TimestampSchema,
  /** Optimistic-concurrency version of the photo row (send it as If-Match or body.version on PATCH). */
  version: VersionSchema,
});
export type StagePhotoRow = z.infer<typeof StagePhotoRowSchema>;

/** Attach an uploaded document as a stage photo. */
export const StagePhotoCreateSchema = z.strictObject({
  document_id: IdSchema,
  caption: z.string().trim().max(200).optional().nullable(),
  visible_to_buyers: z.boolean().default(true),
  show_on_website: z.boolean().default(false),
  sort_order: z.int().min(0).max(1000).default(0),
});
export type StagePhotoCreate = z.infer<typeof StagePhotoCreateSchema>;

/** Update a stage photo's flags/caption (plain optionals: a PATCH never re-applies the create defaults to fields it does not send). */
export const StagePhotoUpdateSchema = z.strictObject({
  caption: z.string().trim().max(200).optional().nullable(),
  visible_to_buyers: z.boolean().optional(),
  show_on_website: z.boolean().optional(),
  sort_order: z.int().min(0).max(1000).optional(),
  /** The version read (alternatively the If-Match header); one of the two is required (staff PATCH version policy). */
  version: VersionSchema.optional(),
});
export type StagePhotoUpdate = z.infer<typeof StagePhotoUpdateSchema>;

/** One stage record of a tower. */
export const BlockStageRowSchema = z.object({
  id: IdSchema,
  block_id: IdSchema,
  stage_id: IdSchema,
  sort_order: z.int(),
  name: z.string(),
  is_possession: z.boolean(),
  status: StageStatusSchema,
  started_on: DateStringSchema.nullable(),
  completed_on: DateStringSchema.nullable(),
  completed_by: IdSchema.nullable(),
  completed_by_name: z.string().nullable(),
  completed_at: TimestampSchema.nullable(),
  notes: z.string().nullable(),
  photos: z.array(StagePhotoRowSchema),
  demands_raised: z.int().min(0),
  can_undo: z.boolean(),
});
export type BlockStageRow = z.infer<typeof BlockStageRowSchema>;

/** Tower construction status response. */
export const BlockConstructionResponseSchema = z.object({
  block_id: IdSchema,
  block_name: z.string(),
  project_id: IdSchema,
  construction_percent: z.number().min(0).max(100),
  current_stage_id: IdSchema.nullable(),
  next_stage_id: IdSchema.nullable(),
  stages: z.array(BlockStageRowSchema),
  version: z.int(),
});
export type BlockConstructionResponse = z.infer<typeof BlockConstructionResponseSchema>;

/** Mark the stage reached; intermediate stages are completed too with the given dates. */
export const ConstructionStatusUpdateSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    stage_id: IdSchema,
    completed_on: DateStringSchema,
    intermediate_dates: z.record(IdSchema, DateStringSchema).default({}),
    notes: NoteSchema.optional().nullable(),
    notify_buyers: z.boolean().default(true),
    /** Optional stage after the reached one to mark IN_PROGRESS in the same call (non-financial). */
    mark_in_progress_stage_id: IdSchema.optional().nullable(),
  })
  .refine((u) => Object.values(u.intermediate_dates).every((d) => d <= u.completed_on), {
    message: "Intermediate stage dates cannot be after the reached stage's date",
    path: ["intermediate_dates"],
  });
export type ConstructionStatusUpdate = z.infer<typeof ConstructionStatusUpdateSchema>;

/** Preview of a jump-ahead: which intermediate stages will be completed. */
export const ConstructionJumpPreviewQuerySchema = z.object({ stage_id: IdSchema });
export type ConstructionJumpPreviewQuery = z.infer<typeof ConstructionJumpPreviewQuerySchema>;

export const ConstructionJumpPreviewResponseSchema = z.object({
  target_stage_id: IdSchema,
  intermediate_stages: z.array(z.object({ stage_id: IdSchema, name: z.string(), sort_order: z.int() })),
  affected_bookings: z.int().min(0),
  installments_to_raise: z.int().min(0),
});
export type ConstructionJumpPreviewResponse = z.infer<typeof ConstructionJumpPreviewResponseSchema>;

/** Mark a stage In Progress (non-financial marker). */
export const ConstructionInProgressSchema = z.strictObject({
  ...VersionedSchema.shape,
  stage_id: IdSchema,
  started_on: DateStringSchema,
  notes: NoteSchema.optional().nullable(),
});
export type ConstructionInProgress = z.infer<typeof ConstructionInProgressSchema>;

/** Result of a status update. */
export const ConstructionStatusUpdateResponseSchema = z.object({
  block_id: IdSchema,
  completed_stage_ids: z.array(IdSchema),
  demands_raised: z.int().min(0),
  demand_numbers: z.array(z.string()),
  buyers_notified: z.int().min(0),
  construction_percent: z.number(),
  version: z.int(),
});
export type ConstructionStatusUpdateResponse = z.infer<typeof ConstructionStatusUpdateResponseSchema>;

/** Undo the latest completed stage (blocked if a demand it raised was paid on/after its date). */
export const ConstructionUndoSchema = z.strictObject({
  ...VersionedSchema.shape,
  stage_id: IdSchema,
  reason: ReasonSchema,
});
export type ConstructionUndo = z.infer<typeof ConstructionUndoSchema>;

export const ConstructionUndoResponseSchema = z.object({
  block_id: IdSchema,
  stage_id: IdSchema,
  voided_demand_numbers: z.array(z.string()),
  /** Possession stage only: demand numbers of the on-possession other charges that went back to "not yet demanded". */
  undemanded_charge_numbers: z.array(z.string()).optional(),
  withdrawn_notifications: z.int().min(0),
  construction_percent: z.number(),
  version: z.int(),
});
export type ConstructionUndoResponse = z.infer<typeof ConstructionUndoResponseSchema>;

/** Details carried by UNDO_BLOCKED (`reasons` are the human sentences of the undo rule; `blocking_payments` the parsed receipts). */
export const UndoBlockedDetailsSchema = z.object({
  reasons: z.array(z.string()),
  blocking_payments: z.array(
    z.object({ receipt_number: z.string(), payment_date: DateStringSchema, demand_number: z.string() }),
  ),
});

/** Details carried by UNDO_NOT_LATEST. */
export const UndoNotLatestDetailsSchema = z.object({ latest_stage_id: IdSchema, latest_stage_name: z.string() });
export type UndoNotLatestDetails = z.infer<typeof UndoNotLatestDetailsSchema>;

/** Non-financial edit of one tower stage record (PATCH /blocks/:id/construction/:stageId); COMPLETED is never set here. */
export const BlockStageUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  notes: NoteSchema.optional().nullable(),
  started_on: DateStringSchema.optional().nullable(),
  status: z.enum(["PENDING", "IN_PROGRESS"]).optional(),
});
export type BlockStageUpdate = z.infer<typeof BlockStageUpdateSchema>;

/** One tower in the project construction summary (dashboards, website). */
export const ProjectConstructionBlockRowSchema = z.object({
  block_id: IdSchema,
  block_name: z.string(),
  block_code: z.string(),
  status: z.string(),
  construction_percent: z.number().min(0).max(100),
  total_stages: z.int().min(0),
  completed_stages: z.int().min(0),
  current_stage_id: IdSchema.nullable(),
  current_stage_name: z.string().nullable(),
  next_stage_id: IdSchema.nullable(),
  next_stage_name: z.string().nullable(),
  in_progress_stage_name: z.string().nullable(),
  last_completed_on: DateStringSchema.nullable(),
  active_bookings: z.int().min(0),
});
export type ProjectConstructionBlockRow = z.infer<typeof ProjectConstructionBlockRowSchema>;

export const ProjectConstructionResponseSchema = z.object({
  project_id: IdSchema,
  project_name: z.string(),
  construction_percent: z.number().min(0).max(100),
  blocks: z.array(ProjectConstructionBlockRowSchema),
});
export type ProjectConstructionResponse = z.infer<typeof ProjectConstructionResponseSchema>;

/** Photo of a stage as the portal / website timeline sees it (urls are signed; null when the image has no renditions). */
export const StageTimelinePhotoSchema = z.object({
  id: IdSchema,
  document_id: IdSchema,
  caption: z.string().nullable(),
  thumb_url: z.string().nullable(),
  medium_url: z.string().nullable(),
  taken_on: DateStringSchema.nullable(),
  visible_to_buyers: z.boolean(),
  show_on_website: z.boolean(),
  sort_order: z.int(),
});
export type StageTimelinePhoto = z.infer<typeof StageTimelinePhotoSchema>;

export const StageTimelineStageSchema = z.object({
  id: IdSchema,
  stage_id: IdSchema,
  name: z.string(),
  sort_order: z.int(),
  is_possession: z.boolean(),
  status: StageStatusSchema,
  started_on: DateStringSchema.nullable(),
  completed_on: DateStringSchema.nullable(),
  notes: z.string().nullable(),
  photos: z.array(StageTimelinePhotoSchema),
});
export type StageTimelineStage = z.infer<typeof StageTimelineStageSchema>;

/** `blockStageTimeline()` result consumed by the portal and public modules. */
export const BlockStageTimelineSchema = z.object({
  block_id: IdSchema,
  block_name: z.string(),
  project_id: IdSchema,
  construction_percent: z.number().min(0).max(100),
  current_stage_id: IdSchema.nullable(),
  current_stage_name: z.string().nullable(),
  next_stage_id: IdSchema.nullable(),
  next_stage_name: z.string().nullable(),
  stages: z.array(StageTimelineStageSchema),
});
export type BlockStageTimeline = z.infer<typeof BlockStageTimelineSchema>;
export type UndoBlockedDetails = z.infer<typeof UndoBlockedDetailsSchema>;

/** Upcoming stages across towers (dashboard / forecast). */
export const UpcomingStageRowSchema = z.object({
  block_id: IdSchema,
  block_name: z.string(),
  project_name: z.string(),
  stage_id: IdSchema,
  stage_name: z.string(),
  status: StageStatusSchema,
  started_on: DateStringSchema.nullable(),
  active_bookings: z.int().min(0),
  installment_total_paise: z.int().min(0),
});
export type UpcomingStageRow = z.infer<typeof UpcomingStageRowSchema>;
export const UpcomingStageListResponseSchema = listEnvelope(UpcomingStageRowSchema);
export type UpcomingStageListResponse = z.infer<typeof UpcomingStageListResponseSchema>;
