import { z } from "zod";
import { FlatStatusSchema, ManualFlatStatusSchema } from "../enums.js";
import {
  AuditedRowSchema,
  BoolQuerySchema,
  IdListSchema,
  IdSchema,
  IntQuerySchema,
  ListQuerySchema,
  MoneyBreakupLineSchema,
  NoteSchema,
  PaiseSchema,
  ReasonSchema,
  TimestampSchema,
  VersionedSchema,
  listEnvelope,
} from "../common.js";
import { AreaSnapshotSchema, RoomSnapshotSchema } from "./masters.js";

/** Flat row with snapshots and price breakup. */
export const FlatRowSchema = AuditedRowSchema.extend({
  project_id: IdSchema,
  block_id: IdSchema,
  block_name: z.string(),
  flat_number: z.string(),
  floor: z.int(),
  floor_label: z.string(),
  position: z.int(),
  flat_type_id: IdSchema,
  flat_type_code: z.string(),
  flat_type_name: z.string(),
  bhk: z.number(),
  facing: z.string().nullable(),
  is_corner: z.boolean(),
  status: FlatStatusSchema,
  rooms_snapshot: z.array(RoomSnapshotSchema),
  areas_snapshot: z.array(AreaSnapshotSchema),
  carpet_sqft: z.number().nullable(),
  builtup_sqft: z.number().nullable(),
  super_builtup_sqft: z.number(),
  rate_per_sqft_paise: PaiseSchema.nullable(),
  price_paise: PaiseSchema,
  price_breakup: z.array(MoneyBreakupLineSchema),
  rate_card_id: IdSchema.nullable(),
  booking_id: IdSchema.nullable(),
  booking_number: z.string().nullable(),
  customer_name: z.string().nullable(),
  parking_slot_numbers: z.array(z.string()),
  hold_by_user_id: IdSchema.nullable(),
  hold_by_name: z.string().nullable(),
  hold_until: TimestampSchema.nullable(),
  status_changed_at: TimestampSchema.nullable(),
  status_changed_by: IdSchema.nullable(),
  notes: z.string().nullable(),
});
export type FlatRow = z.infer<typeof FlatRowSchema>;

/** List filter for flats. */
export const FlatFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  status: FlatStatusSchema.optional(),
  flat_type_id: IdSchema.optional(),
  floor: IntQuerySchema.optional(),
  min_price_paise: IntQuerySchema.min(0).optional(),
  max_price_paise: IntQuerySchema.min(0).optional(),
  facing: z.string().trim().max(40).optional(),
  is_corner: BoolQuerySchema.optional(),
});
export type FlatFilter = z.infer<typeof FlatFilterSchema>;

export const FlatListResponseSchema = listEnvelope(FlatRowSchema);
export type FlatListResponse = z.infer<typeof FlatListResponseSchema>;

/** Manual status change: only AVAILABLE / HOLD / BLOCKED (BOOKED and SOLD are set by the booking engine). */
export const FlatStatusChangeSchema = z.strictObject({
  ...VersionedSchema.shape,
  status: ManualFlatStatusSchema,
  reason: NoteSchema.optional().nullable(),
  hold_until: TimestampSchema.optional().nullable(),
});
export type FlatStatusChange = z.infer<typeof FlatStatusChangeSchema>;

/** Bulk status change for multi-selected flats. */
export const FlatBulkStatusChangeSchema = z.strictObject({
  flat_ids: IdListSchema,
  status: ManualFlatStatusSchema,
  reason: NoteSchema.optional().nullable(),
  hold_until: TimestampSchema.optional().nullable(),
});
export type FlatBulkStatusChange = z.infer<typeof FlatBulkStatusChangeSchema>;

/** Set a flat's price directly (with optional breakup). */
export const FlatPriceUpdateSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    price_paise: PaiseSchema,
    rate_per_sqft_paise: PaiseSchema.optional().nullable(),
    price_breakup: z.array(MoneyBreakupLineSchema).max(50).optional(),
    reason: ReasonSchema.optional(),
  })
  .refine((p) => !p.price_breakup || p.price_breakup.reduce((s, l) => s + l.amount_paise, 0) === p.price_paise, {
    message: "Breakup lines must add up to price_paise",
    path: ["price_breakup"],
  });
export type FlatPriceUpdate = z.infer<typeof FlatPriceUpdateSchema>;

/** Bulk price edit per block/floor with optional floor-rise step. */
export const FlatBulkPriceUpdateSchema = z
  .strictObject({
    block_id: IdSchema,
    floors: z.array(z.int()).max(200).optional(),
    flat_ids: z.array(IdSchema).max(500).optional(),
    flat_type_id: IdSchema.optional(),
    rate_per_sqft_paise: PaiseSchema.optional(),
    price_paise: PaiseSchema.optional(),
    floor_rise_step_paise: PaiseSchema.optional(),
    only_available: z.boolean().default(true),
  })
  .refine((b) => (b.rate_per_sqft_paise === undefined) !== (b.price_paise === undefined), {
    message: "Give either rate_per_sqft_paise or price_paise",
    path: ["price_paise"],
  });
export type FlatBulkPriceUpdate = z.infer<typeof FlatBulkPriceUpdateSchema>;

/** Response of a bulk operation. */
export const FlatBulkResponseSchema = z.object({ updated: z.int().min(0), skipped: z.int().min(0), skipped_ids: z.array(IdSchema) });
export type FlatBulkResponse = z.infer<typeof FlatBulkResponseSchema>;

/** Change a flat's type (re-snapshots rooms/areas; only while AVAILABLE). */
export const FlatTypeChangeSchema = z.strictObject({ ...VersionedSchema.shape, flat_type_id: IdSchema, reprice: z.boolean().default(true) });
export type FlatTypeChange = z.infer<typeof FlatTypeChangeSchema>;

/** Update flat notes / facing / corner flag. */
export const FlatUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  notes: NoteSchema.optional().nullable(),
  facing: z.string().trim().max(40).optional().nullable(),
  is_corner: z.boolean().optional(),
});
export type FlatUpdate = z.infer<typeof FlatUpdateSchema>;

/** One history entry of a flat (from the audit log). */
export const FlatHistoryRowSchema = z.object({
  at: TimestampSchema,
  actor_name: z.string().nullable(),
  action: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type FlatHistoryRow = z.infer<typeof FlatHistoryRowSchema>;

/** Specification item as shown in the flat drawer. */
export const FlatSpecItemSchema = z.object({ category: z.string(), name: z.string(), description: z.string().nullable() });
export type FlatSpecItem = z.infer<typeof FlatSpecItemSchema>;

/** Flat drawer: row + specifications + history. */
export const FlatDetailResponseSchema = FlatRowSchema.extend({
  specifications: z.array(FlatSpecItemSchema),
  history: z.array(FlatHistoryRowSchema),
});
export type FlatDetailResponse = z.infer<typeof FlatDetailResponseSchema>;

/** Availability chart for printing: block grid summary. */
export const AvailabilityChartQuerySchema = z.object({ project_id: IdSchema, block_id: IdSchema.optional() });
export type AvailabilityChartQuery = z.infer<typeof AvailabilityChartQuerySchema>;
