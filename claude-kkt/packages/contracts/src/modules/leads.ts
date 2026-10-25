import { z } from "zod";
import { ActorTypeSchema, LeadActivityTypeSchema, LeadSourceSchema, LeadStageSchema } from "../enums.js";
import {
  AuditedRowSchema,
  BoolQuerySchema,
  DateStringSchema,
  EmailSchema,
  IdSchema,
  ListQuerySchema,
  NameSchema,
  NoteSchema,
  PaiseSchema,
  PhoneSchema,
  ReasonSchema,
  TextSchema,
  TimestampSchema,
  VersionSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";
import { CustomerCreateSchema } from "./customers.js";

/** UTM parameters captured from the website. */
export const UtmSchema = z.object({
  source: z.string().trim().max(100).optional().nullable(),
  medium: z.string().trim().max(100).optional().nullable(),
  campaign: z.string().trim().max(100).optional().nullable(),
  term: z.string().trim().max(100).optional().nullable(),
  content: z.string().trim().max(100).optional().nullable(),
});
export type Utm = z.infer<typeof UtmSchema>;

const LeadBase = z.strictObject({
  full_name: NameSchema,
  phone: PhoneSchema,
  email: EmailSchema.optional().nullable(),
  project_id: IdSchema.optional().nullable(),
  flat_type_id: IdSchema.optional().nullable(),
  budget_min_paise: PaiseSchema.optional().nullable(),
  budget_max_paise: PaiseSchema.optional().nullable(),
  source: LeadSourceSchema,
  assigned_user_id: IdSchema.optional().nullable(),
  message: TextSchema.optional().nullable(),
  utm: UtmSchema.optional().nullable(),
  next_follow_up_at: TimestampSchema.optional().nullable(),
  consent: z.boolean().default(false),
});

/** Create a lead (ERP). */
export const LeadCreateSchema = LeadBase.refine(
  (l) => l.budget_min_paise == null || l.budget_max_paise == null || l.budget_min_paise <= l.budget_max_paise,
  { message: "Minimum budget must be ≤ maximum", path: ["budget_max_paise"] },
);
export type LeadCreate = z.infer<typeof LeadCreateSchema>;

/** Update a lead (partial + version). */
export const LeadUpdateSchema = updateOf(LeadBase.omit({ source: true }));
export type LeadUpdate = z.infer<typeof LeadUpdateSchema>;

/** Wire body of `PATCH /leads/:id`: absent fields stay untouched (no default for `consent`); `version` may arrive through `If-Match`. */
export const LeadPatchSchema = z
  .strictObject({ ...LeadBase.omit({ source: true }).shape, consent: z.boolean() })
  .partial()
  .extend({ version: VersionSchema.optional() });
export type LeadPatch = z.infer<typeof LeadPatchSchema>;

/** Lead row. */
export const LeadRowSchema = AuditedRowSchema.extend({
  lead_number: z.string(),
  full_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  project_id: IdSchema.nullable(),
  project_name: z.string().nullable(),
  flat_type_id: IdSchema.nullable(),
  flat_type_name: z.string().nullable(),
  budget_min_paise: PaiseSchema.nullable(),
  budget_max_paise: PaiseSchema.nullable(),
  source: LeadSourceSchema,
  stage: LeadStageSchema,
  previous_stage: LeadStageSchema.nullable(),
  lost_reason: z.string().nullable(),
  assigned_user_id: IdSchema.nullable(),
  assigned_user_name: z.string().nullable(),
  customer_id: IdSchema.nullable(),
  booking_id: IdSchema.nullable(),
  utm: UtmSchema.nullable(),
  message: z.string().nullable(),
  next_follow_up_at: TimestampSchema.nullable(),
  is_read: z.boolean(),
  consent: z.boolean(),
  last_activity_at: TimestampSchema.nullable(),
  upcoming_visit_at: TimestampSchema.nullable(),
});
export type LeadRow = z.infer<typeof LeadRowSchema>;

/** List filter for leads. */
export const LeadFilterSchema = ListQuerySchema.extend({
  stage: LeadStageSchema.optional(),
  source: LeadSourceSchema.optional(),
  project_id: IdSchema.optional(),
  assigned_user_id: IdSchema.optional(),
  follow_up_due: BoolQuerySchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  is_read: BoolQuerySchema.optional(),
});
export type LeadFilter = z.infer<typeof LeadFilterSchema>;

export const LeadListResponseSchema = listEnvelope(LeadRowSchema);
export type LeadListResponse = z.infer<typeof LeadListResponseSchema>;

/** Move a lead to a stage; LOST requires a reason. */
export const LeadStageChangeSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    stage: LeadStageSchema.exclude(["CONVERTED"]),
    lost_reason: ReasonSchema.optional().nullable(),
    note: NoteSchema.optional().nullable(),
  })
  .refine((s) => s.stage !== "LOST" || (s.lost_reason != null && s.lost_reason.trim().length >= 3), {
    message: "A reason is required when marking a lead Lost",
    path: ["lost_reason"],
  });
export type LeadStageChange = z.infer<typeof LeadStageChangeSchema>;

/**
 * Wire body of `POST /leads/:id/stage`: the LOST-needs-a-reason rule is enforced by the API as 422 BUSINESS_RULE
 * (rule LOST_REASON_REQUIRED) and CONVERTED is refused with 422 (use /convert), so this schema carries no refinements.
 * `reason` is accepted as an alias of `lost_reason`.
 */
export const LeadStageChangeBodySchema = z.strictObject({
  ...VersionedSchema.shape,
  stage: LeadStageSchema,
  lost_reason: ReasonSchema.optional().nullable(),
  reason: ReasonSchema.optional().nullable(),
  note: NoteSchema.optional().nullable(),
});
export type LeadStageChangeBody = z.infer<typeof LeadStageChangeBodySchema>;

/** Add a follow-up. */
export const LeadFollowUpCreateSchema = z.strictObject({
  note: z.string().trim().min(1).max(1000),
  done_at: TimestampSchema.optional(),
  next_at: TimestampSchema.optional().nullable(),
});
export type LeadFollowUpCreate = z.infer<typeof LeadFollowUpCreateSchema>;

export const LeadFollowUpRowSchema = z.object({
  id: IdSchema,
  lead_id: IdSchema,
  note: z.string(),
  done_at: TimestampSchema.nullable(),
  next_at: TimestampSchema.nullable(),
  by_user_id: IdSchema.nullable(),
  by_user_name: z.string().nullable(),
  created_at: TimestampSchema,
});
export type LeadFollowUpRow = z.infer<typeof LeadFollowUpRowSchema>;

export const LeadActivityRowSchema = z.object({
  id: IdSchema,
  lead_id: IdSchema,
  type: LeadActivityTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  actor_type: ActorTypeSchema,
  actor_id: IdSchema.nullable(),
  actor_name: z.string().nullable(),
  at: TimestampSchema,
});
export type LeadActivityRow = z.infer<typeof LeadActivityRowSchema>;

export const LeadStageHistoryRowSchema = z.object({
  id: IdSchema,
  from_stage: LeadStageSchema.nullable(),
  to_stage: LeadStageSchema,
  by_user_id: IdSchema.nullable(),
  by_user_name: z.string().nullable(),
  reason: z.string().nullable(),
  at: TimestampSchema,
});
export type LeadStageHistoryRow = z.infer<typeof LeadStageHistoryRowSchema>;

/** Assign (or unassign) a lead. */
export const LeadAssignSchema = z.strictObject({ ...VersionedSchema.shape, assigned_user_id: IdSchema.nullable() });
export type LeadAssign = z.infer<typeof LeadAssignSchema>;

/** Convert a lead: link an existing customer or create one inline; optionally start a booking draft. */
export const LeadConvertSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    customer_id: IdSchema.optional(),
    customer: CustomerCreateSchema.optional(),
    start_booking: z.boolean().default(false),
  })
  .refine((c) => (c.customer_id !== undefined) !== (c.customer !== undefined), {
    message: "Give either customer_id or customer",
    path: ["customer_id"],
  });
export type LeadConvert = z.infer<typeof LeadConvertSchema>;

export const LeadConvertResponseSchema = z.object({
  lead: LeadRowSchema,
  customer_id: IdSchema,
  customer_code: z.string(),
  booking_draft_id: IdSchema.nullable(),
});
export type LeadConvertResponse = z.infer<typeof LeadConvertResponseSchema>;

/** Lead detail: row + follow-ups + activities + stage history. */
export const LeadDetailResponseSchema = LeadRowSchema.extend({
  follow_ups: z.array(LeadFollowUpRowSchema),
  activities: z.array(LeadActivityRowSchema),
  stage_history: z.array(LeadStageHistoryRowSchema),
});
export type LeadDetailResponse = z.infer<typeof LeadDetailResponseSchema>;

/** Kanban board grouped by stage. */
export const LeadKanbanResponseSchema = z.object({
  columns: z.array(z.object({ stage: LeadStageSchema, count: z.int().min(0), leads: z.array(LeadRowSchema) })),
});
export type LeadKanbanResponse = z.infer<typeof LeadKanbanResponseSchema>;

/** Kanban board filters (`GET /leads/board`). */
export const LeadBoardQuerySchema = z.object({
  project_id: IdSchema.optional(),
  assigned_user_id: IdSchema.optional(),
  source: LeadSourceSchema.optional(),
  search: z.string().trim().max(100).optional(),
  /** Cards per column (counts are always complete). */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type LeadBoardQuery = z.infer<typeof LeadBoardQuerySchema>;

/** `GET /leads/follow-ups/due`: my open leads whose next follow-up is due today or overdue (IST). */
export const LeadFollowUpsDueQuerySchema = z.object({
  /** Business date (IST), defaults to today. */
  date: DateStringSchema.optional(),
  /** Include every user's follow-ups (managers); default = mine only. */
  all: BoolQuerySchema.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type LeadFollowUpsDueQuery = z.infer<typeof LeadFollowUpsDueQuerySchema>;

export const LeadFollowUpsDueResponseSchema = z.object({
  date: DateStringSchema,
  items: z.array(LeadRowSchema),
  total: z.int().min(0),
  overdue: z.int().min(0),
});
export type LeadFollowUpsDueResponse = z.infer<typeof LeadFollowUpsDueResponseSchema>;

/** Website enquiry as seen in the ERP inbox. */
export const EnquiryRowSchema = z.object({
  id: IdSchema,
  lead_id: IdSchema.nullable(),
  lead_number: z.string().nullable(),
  project_id: IdSchema.nullable(),
  project_name: z.string().nullable(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  flat_type_name: z.string().nullable(),
  message: z.string().nullable(),
  source_page: z.string().nullable(),
  utm: UtmSchema.nullable(),
  reference_number: z.string(),
  is_read: z.boolean(),
  created_at: TimestampSchema,
});
export type EnquiryRow = z.infer<typeof EnquiryRowSchema>;

export const EnquiryFilterSchema = ListQuerySchema.extend({ is_read: BoolQuerySchema.optional(), project_id: IdSchema.optional() });
export type EnquiryFilter = z.infer<typeof EnquiryFilterSchema>;
export const EnquiryListResponseSchema = listEnvelope(EnquiryRowSchema);
export type EnquiryListResponse = z.infer<typeof EnquiryListResponseSchema>;

/** Mark enquiries read/unread. */
export const EnquiryMarkReadSchema = z.strictObject({ ids: z.array(IdSchema).min(1).max(200), is_read: z.boolean().default(true) });
export type EnquiryMarkRead = z.infer<typeof EnquiryMarkReadSchema>;

export const EnquiryUnreadCountSchema = z.object({ unread: z.int().min(0) });
export type EnquiryUnreadCount = z.infer<typeof EnquiryUnreadCountSchema>;
