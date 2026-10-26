import { z } from "zod";
import { ManualParkingStatusSchema, ParkingStatusSchema, ParkingTypeSchema } from "../enums.js";
import {
  AuditedRowSchema,
  IdListSchema,
  IdSchema,
  ListQuerySchema,
  NoteSchema,
  PaiseSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

const ParkingSlotBase = z.strictObject({
  project_id: IdSchema,
  number: z.string().trim().min(1).max(20),
  slot_type: ParkingTypeSchema,
  level: z.string().trim().max(20).optional().nullable(),
  price_paise: PaiseSchema.default(0),
});

/** Create one parking slot. */
export const ParkingSlotCreateSchema = ParkingSlotBase;
export type ParkingSlotCreate = z.infer<typeof ParkingSlotCreateSchema>;

/** Update a parking slot. */
export const ParkingSlotUpdateSchema = updateOf(ParkingSlotBase.omit({ project_id: true }));
export type ParkingSlotUpdate = z.infer<typeof ParkingSlotUpdateSchema>;

/** Parking slot row. */
export const ParkingSlotRowSchema = AuditedRowSchema.extend({
  project_id: IdSchema,
  number: z.string(),
  slot_type: ParkingTypeSchema,
  level: z.string().nullable(),
  price_paise: PaiseSchema,
  status: ParkingStatusSchema,
  booking_id: IdSchema.nullable(),
  booking_number: z.string().nullable(),
  flat_number: z.string().nullable(),
});
export type ParkingSlotRow = z.infer<typeof ParkingSlotRowSchema>;

/** List filter for parking slots. */
export const ParkingSlotFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  slot_type: ParkingTypeSchema.optional(),
  status: ParkingStatusSchema.optional(),
  level: z.string().trim().max(20).optional(),
});
export type ParkingSlotFilter = z.infer<typeof ParkingSlotFilterSchema>;

export const ParkingSlotListResponseSchema = listEnvelope(ParkingSlotRowSchema);
export type ParkingSlotListResponse = z.infer<typeof ParkingSlotListResponseSchema>;

/** Bulk-generate slots: prefix + from..to numbering. */
export const ParkingBulkGenerateSchema = z
  .strictObject({
    project_id: IdSchema,
    prefix: z.string().trim().max(10).default(""),
    from_number: z.int().min(1).max(9999),
    to_number: z.int().min(1).max(9999),
    pad: z.int().min(0).max(4).default(0),
    slot_type: ParkingTypeSchema,
    level: z.string().trim().max(20).optional().nullable(),
    price_paise: PaiseSchema.default(0),
  })
  .refine((g) => g.from_number <= g.to_number, { message: "from_number must be ≤ to_number", path: ["to_number"] })
  .refine((g) => g.to_number - g.from_number < 1000, { message: "At most 1000 slots per batch", path: ["to_number"] });
export type ParkingBulkGenerate = z.infer<typeof ParkingBulkGenerateSchema>;

export const ParkingBulkGenerateResponseSchema = z.object({
  created: z.int().min(0),
  skipped_existing: z.array(z.string()),
});
export type ParkingBulkGenerateResponse = z.infer<typeof ParkingBulkGenerateResponseSchema>;

/** Manual status change (AVAILABLE/BLOCKED); ALLOTTED is set by the booking engine. */
export const ParkingStatusChangeSchema = z.strictObject({
  ...VersionedSchema.shape,
  status: ManualParkingStatusSchema,
  reason: NoteSchema.optional().nullable(),
});
export type ParkingStatusChange = z.infer<typeof ParkingStatusChangeSchema>;

/** Bulk manual status change. */
export const ParkingBulkStatusChangeSchema = z.strictObject({
  slot_ids: IdListSchema,
  status: ManualParkingStatusSchema,
  reason: NoteSchema.optional().nullable(),
});
export type ParkingBulkStatusChange = z.infer<typeof ParkingBulkStatusChangeSchema>;
