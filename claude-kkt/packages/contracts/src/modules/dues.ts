import { z } from "zod";
import { IntegrityFindingTypeSchema } from "../enums.js";
import {
  BoolQuerySchema,
  DateStringSchema,
  IdSchema,
  ListQuerySchema,
  SignedPaiseSchema,
  TimestampSchema,
  listEnvelope,
} from "../common.js";

/** Run the auto-dues engine now (whole company, a project, a tower or one booking). */
export const RunDuesRequestSchema = z.strictObject({
  booking_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  as_of: DateStringSchema.optional(),
});
export type RunDuesRequest = z.infer<typeof RunDuesRequestSchema>;

export const RunDuesResponseSchema = z.object({
  bookings_processed: z.int().min(0),
  /** Alias of bookings_processed (SPEC §10 wording). */
  bookings_checked: z.int().min(0).optional(),
  demands_raised: z.int().min(0),
  demand_numbers: z.array(z.string()),
  notifications_sent: z.int().min(0),
  started_at: TimestampSchema,
  finished_at: TimestampSchema,
});
export type RunDuesResponse = z.infer<typeof RunDuesResponseSchema>;

/** One integrity finding. */
export const IntegrityFindingSchema = z.object({
  type: IntegrityFindingTypeSchema,
  booking_id: IdSchema,
  booking_number: z.string(),
  installment_seq: z.int().nullable(),
  installment_name: z.string().nullable(),
  demand_id: IdSchema.nullable(),
  demand_number: z.string().nullable(),
  detail: z.string(),
  stored: z.record(z.string(), SignedPaiseSchema).nullable(),
  recomputed: z.record(z.string(), SignedPaiseSchema).nullable(),
  repairable: z.boolean(),
});
export type IntegrityFinding = z.infer<typeof IntegrityFindingSchema>;

/** Integrity counts by finding type. */
export const IntegrityCountsSchema = z.object({
  UNSATISFIED_DEMAND: z.int().min(0),
  MISSING_DEMAND: z.int().min(0),
  DUPLICATE_DEMAND: z.int().min(0),
  UNMAPPED_DEMAND: z.int().min(0),
  SUMMARY_MISMATCH: z.int().min(0),
  /** Bookings whose plan snapshot has an ON_STAGE installment on a stage missing from their tower (never raised; not auto-repairable). Absent on runs stored before it existed. */
  PLAN_STAGE_MISSING: z.int().min(0).default(0),
});
export type IntegrityCounts = z.infer<typeof IntegrityCountsSchema>;

/** Integrity report. */
export const IntegrityReportResponseSchema = z.object({
  run_id: IdSchema.nullable(),
  ran_at: TimestampSchema,
  triggered_by: z.string(),
  ok: z.boolean(),
  bookings_checked: z.int().min(0),
  counts: IntegrityCountsSchema,
  findings: z.array(IntegrityFindingSchema),
});
export type IntegrityReportResponse = z.infer<typeof IntegrityReportResponseSchema>;

/** Scope for an on-demand integrity run. */
export const IntegrityRunRequestSchema = z.strictObject({
  project_id: IdSchema.optional(),
  booking_id: IdSchema.optional(),
});
export type IntegrityRunRequest = z.infer<typeof IntegrityRunRequestSchema>;

/** Admin-confirmed repair: void unsatisfied/duplicate demands without payments, raise missing ones, rebuild ledgers. */
export const IntegrityRepairRequestSchema = z.strictObject({
  confirm: z.literal("REPAIR"),
  run_id: IdSchema.optional(),
  booking_ids: z.array(IdSchema).max(500).optional(),
});
export type IntegrityRepairRequest = z.infer<typeof IntegrityRepairRequestSchema>;

export const IntegrityRepairResponseSchema = z.object({
  demands_voided: z.int().min(0),
  demands_raised: z.int().min(0),
  ledgers_rebuilt: z.int().min(0),
  summaries_fixed: z.int().min(0),
  skipped_with_payments: z.array(z.string()),
  report_after: IntegrityReportResponseSchema,
});
export type IntegrityRepairResponse = z.infer<typeof IntegrityRepairResponseSchema>;

/** Stored integrity run. */
export const IntegrityRunRowSchema = z.object({
  id: IdSchema,
  ran_at: TimestampSchema,
  triggered_by: z.string(),
  ok: z.boolean(),
  counts: IntegrityCountsSchema,
  findings_count: z.int().min(0),
});
export type IntegrityRunRow = z.infer<typeof IntegrityRunRowSchema>;
export const IntegrityRunFilterSchema = ListQuerySchema.extend({ ok: BoolQuerySchema.optional() });
export type IntegrityRunFilter = z.infer<typeof IntegrityRunFilterSchema>;
export const IntegrityRunListResponseSchema = listEnvelope(IntegrityRunRowSchema);
export type IntegrityRunListResponse = z.infer<typeof IntegrityRunListResponseSchema>;
