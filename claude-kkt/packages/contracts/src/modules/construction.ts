import { z } from "zod";
import { StageStatusSchema } from "../enums.js";
import {
  DateStringSchema,
  IdSchema,
  NoteSchema,
  ReasonSchema,
  TimestampSchema,
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

/** Update a stage photo's flags/caption. */
export const StagePhotoUpdateSchema = StagePhotoCreateSchema.omit({ document_id: true }).partial();
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
export const ConstructionUndoSchema = z.strictObject({ ...VersionedSchema.shape, stage_id: IdSchema, reason: ReasonSchema });
export type ConstructionUndo = z.infer<typeof ConstructionUndoSchema>;

export const ConstructionUndoResponseSchema = z.object({
  block_id: IdSchema,
  stage_id: IdSchema,
  voided_demand_numbers: z.array(z.string()),
  withdrawn_notifications: z.int().min(0),
  construction_percent: z.number(),
  version: z.int(),
});
export type ConstructionUndoResponse = z.infer<typeof ConstructionUndoResponseSchema>;

/** Details carried by UNDO_BLOCKED. */
export const UndoBlockedDetailsSchema = z.object({
  blocking_payments: z.array(z.object({ receipt_number: z.string(), payment_date: DateStringSchema, demand_number: z.string() })),
});
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
