import { z } from "zod";
import { SlotMinutesSchema, VisitOutcomeSchema, VisitSourceSchema, VisitStatusSchema } from "../enums.js";
import {
  AuditedRowSchema,
  BoolQuerySchema,
  DateStringSchema,
  EmailSchema,
  IdSchema,
  ListQuerySchema,
  NameSchema,
  NoteSchema,
  PhoneSchema,
  ReasonSchema,
  TimeStringSchema,
  TimestampSchema,
  VersionSchema,
  VersionedSchema,
  listEnvelope,
} from "../common.js";

/** Per-project site-visit settings. */
export const VisitSettingsSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    visit_days: z.array(z.int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5, 6]),
    start_time: TimeStringSchema.default("10:00"),
    end_time: TimeStringSchema.default("18:00"),
    slot_minutes: SlotMinutesSchema.default(60),
    seats_per_slot: z.int().min(1).max(50).default(3),
    min_lead_hours: z.int().min(0).max(168).default(4),
    max_days_ahead: z.int().min(1).max(90).default(14),
    blackout_dates: z.array(DateStringSchema).max(100).default([]),
    site_office_address: z.string().trim().max(300).optional().nullable(),
    maps_link: z.string().trim().max(500).optional().nullable(),
    instructions: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((s) => s.start_time < s.end_time, { message: "end_time must be after start_time", path: ["end_time"] })
  .refine((s) => new Set(s.visit_days).size === s.visit_days.length, {
    message: "Duplicate visit days",
    path: ["visit_days"],
  });
export type VisitSettings = z.infer<typeof VisitSettingsSchema>;

/** Update visit settings (full object + version). */
export const VisitSettingsUpdateSchema = z.object({ ...VersionedSchema.shape, settings: VisitSettingsSchema });
export type VisitSettingsUpdate = z.infer<typeof VisitSettingsUpdateSchema>;

export const VisitSettingsRowSchema = z.object({
  project_id: IdSchema,
  settings: VisitSettingsSchema,
  updated_at: TimestampSchema,
  version: VersionSchema,
});
export type VisitSettingsRow = z.infer<typeof VisitSettingsRowSchema>;

/** Site visit row. */
export const VisitRowSchema = AuditedRowSchema.extend({
  visit_number: z.string(),
  project_id: IdSchema,
  project_name: z.string(),
  lead_id: IdSchema.nullable(),
  lead_number: z.string().nullable(),
  customer_id: IdSchema.nullable(),
  visit_date: DateStringSchema,
  slot_start: TimeStringSchema,
  slot_end: TimeStringSchema,
  visitors: z.int().min(1).max(6),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  message: z.string().nullable(),
  status: VisitStatusSchema,
  assignee_user_id: IdSchema.nullable(),
  assignee_name: z.string().nullable(),
  source: VisitSourceSchema,
  rescheduled_from: z.object({ visit_date: DateStringSchema, slot_start: TimeStringSchema }).nullable(),
  cancel_reason: z.string().nullable(),
  notes: z.string().nullable(),
  outcome_marked_at: TimestampSchema.nullable(),
  is_past: z.boolean(),
  /** True when the visit was rescheduled (rescheduled_from is set) — the calendar's "moved" tag. */
  is_moved: z.boolean().optional(),
  manage_url: z.string().nullable().optional(),
});
export type VisitRow = z.infer<typeof VisitRowSchema>;

/** `GET /site-visits/today`: today's visits (IST) in the caller's scope with quick-outcome counts. */
export const VisitTodayResponseSchema = z.object({
  date: DateStringSchema,
  items: z.array(VisitRowSchema),
  counts: z.object({
    total: z.int().min(0),
    pending: z.int().min(0),
    completed: z.int().min(0),
    no_show: z.int().min(0),
    cancelled: z.int().min(0),
  }),
});
export type VisitTodayResponse = z.infer<typeof VisitTodayResponseSchema>;

/** Body of POST /site-visits/:id/complete and /no-show (version optional: If-Match is accepted too). */
export const VisitOutcomeBodySchema = z.strictObject({
  version: VersionSchema.optional(),
  notes: NoteSchema.optional().nullable(),
});
export type VisitOutcomeBody = z.infer<typeof VisitOutcomeBodySchema>;

/** List filter for visits. */
export const VisitFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  status: VisitStatusSchema.optional(),
  assignee_user_id: IdSchema.optional(),
  lead_id: IdSchema.optional(),
  customer_id: IdSchema.optional(),
  source: VisitSourceSchema.optional(),
  needs_outcome: BoolQuerySchema.optional(),
});
export type VisitFilter = z.infer<typeof VisitFilterSchema>;
export const VisitListResponseSchema = listEnvelope(VisitRowSchema);
export type VisitListResponse = z.infer<typeof VisitListResponseSchema>;

/** ERP creates a visit for a lead or customer (capacity-checked). */
export const VisitCreateSchema = z
  .strictObject({
    project_id: IdSchema,
    lead_id: IdSchema.optional().nullable(),
    customer_id: IdSchema.optional().nullable(),
    visit_date: DateStringSchema,
    slot_start: TimeStringSchema,
    name: NameSchema,
    phone: PhoneSchema,
    email: EmailSchema.optional().nullable(),
    visitors: z.int().min(1).max(6).default(1),
    message: z.string().trim().max(500).optional().nullable(),
    assignee_user_id: IdSchema.optional().nullable(),
    notes: NoteSchema.optional().nullable(),
  })
  .refine((v) => v.lead_id != null || v.customer_id != null, {
    message: "Link a lead or a customer",
    path: ["lead_id"],
  });
export type VisitCreate = z.infer<typeof VisitCreateSchema>;

/** Reschedule (capacity-checked; "moved" tag shown). */
export const VisitRescheduleSchema = z.strictObject({
  ...VersionedSchema.shape,
  visit_date: DateStringSchema,
  slot_start: TimeStringSchema,
  notes: NoteSchema.optional().nullable(),
});
export type VisitReschedule = z.infer<typeof VisitRescheduleSchema>;

/** Cancel with reason (frees the seat; lead stage may revert). */
export const VisitCancelSchema = z.strictObject({ ...VersionedSchema.shape, reason: ReasonSchema });
export type VisitCancel = z.infer<typeof VisitCancelSchema>;

/** Mark outcome: COMPLETED (lead → Site Visit Done) or NO_SHOW. */
export const VisitOutcomeUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  outcome: VisitOutcomeSchema,
  notes: NoteSchema.optional().nullable(),
});
export type VisitOutcomeUpdate = z.infer<typeof VisitOutcomeUpdateSchema>;

/** Confirm / assign / notes. */
export const VisitUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  assignee_user_id: IdSchema.optional().nullable(),
  notes: NoteSchema.optional().nullable(),
  visitors: z.int().min(1).max(6).optional(),
});
export type VisitUpdate = z.infer<typeof VisitUpdateSchema>;

/** Calendar query: a day or a week for a project. */
export const VisitCalendarQuerySchema = z.object({
  project_id: IdSchema,
  from: DateStringSchema,
  to: DateStringSchema,
  assignee_user_id: IdSchema.optional(),
});
export type VisitCalendarQuery = z.infer<typeof VisitCalendarQuerySchema>;

export const VisitCalendarSlotSchema = z.object({
  start: TimeStringSchema,
  end: TimeStringSchema,
  seats: z.int().min(0),
  booked: z.int().min(0),
  available: z.int().min(0),
  is_past: z.boolean(),
  visits: z.array(VisitRowSchema),
});
export type VisitCalendarSlot = z.infer<typeof VisitCalendarSlotSchema>;

export const VisitCalendarResponseSchema = z.object({
  project_id: IdSchema,
  days: z.array(
    z.object({
      date: DateStringSchema,
      is_visit_day: z.boolean(),
      is_blackout: z.boolean(),
      slots: z.array(VisitCalendarSlotSchema),
    }),
  ),
});
export type VisitCalendarResponse = z.infer<typeof VisitCalendarResponseSchema>;

/** Internal availability query (for reschedule pickers; hides full slots). */
export const VisitAvailabilityQuerySchema = z.object({
  project_id: IdSchema,
  from: DateStringSchema,
  to: DateStringSchema,
  exclude_visit_id: IdSchema.optional(),
});
export type VisitAvailabilityQuery = z.infer<typeof VisitAvailabilityQuerySchema>;

export const VisitAvailabilityResponseSchema = z.object({
  days: z.array(
    z.object({
      date: DateStringSchema,
      slots: z.array(z.object({ start: TimeStringSchema, end: TimeStringSchema, available: z.int().min(1) })),
    }),
  ),
});
export type VisitAvailabilityResponse = z.infer<typeof VisitAvailabilityResponseSchema>;
