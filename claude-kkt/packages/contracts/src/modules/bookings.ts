import { z } from "zod";
import {
  BookingStatusSchema,
  ChargeDemandAtSchema,
  DemandStatusSchema,
  FlatStatusSchema,
  LedgerEventSchema,
  ParkingTypeSchema,
  PaymentBucketSchema,
  PlanAcceptanceModeSchema,
  ScheduleStatusSchema,
  TriggerTypeSchema,
} from "../enums.js";
import {
  AuditedRowSchema,
  BoolQuerySchema,
  DateStringSchema,
  IdSchema,
  ListQuerySchema,
  MoneyBreakupLineSchema,
  NoteSchema,
  PaiseSchema,
  PercentSchema,
  ReasonSchema,
  SignedPaiseSchema,
  TextSchema,
  TimestampSchema,
  VersionedSchema,
  listEnvelope,
} from "../common.js";
import { AreaSnapshotSchema, RoomSnapshotSchema } from "./masters.js";
import { PlanSnapshotSchema } from "./paymentPlans.js";

/** An other-charge line chosen in the wizard. */
export const OtherChargeInputSchema = z.strictObject({
  charge_type_id: IdSchema,
  amount_paise: PaiseSchema,
  gst_percent: PercentSchema.default(0),
  demand_at: ChargeDemandAtSchema,
});
export type OtherChargeInput = z.infer<typeof OtherChargeInputSchema>;

const BookingBase = z.strictObject({
  flat_id: IdSchema,
  customer_id: IdSchema,
  co_applicant_ids: z.array(IdSchema).max(10).default([]),
  booking_date: DateStringSchema,
  agreement_value_paise: PaiseSchema,
  cash_agreed_paise: PaiseSchema,
  account_agreed_paise: PaiseSchema,
  payment_plan_id: IdSchema,
  plan_acceptance_mode: PlanAcceptanceModeSchema,
  plan_accepted_on: DateStringSchema,
  plan_acceptance_document_id: IdSchema.optional().nullable(),
  other_charges: z.array(OtherChargeInputSchema).max(30).default([]),
  parking_slot_ids: z.array(IdSchema).max(10).default([]),
  lead_id: IdSchema.optional().nullable(),
  sales_user_id: IdSchema.optional().nullable(),
  broker_name: z.string().trim().max(120).optional().nullable(),
  remarks: TextSchema.optional().nullable(),
});

/** Create a booking (atomic flat lock; Idempotency-Key accepted). */
export const BookingCreateSchema = BookingBase.superRefine((b, ctx) => {
  if (b.cash_agreed_paise + b.account_agreed_paise !== b.agreement_value_paise) {
    ctx.addIssue({
      code: "custom",
      message: "Cash agreed + Account agreed must equal the agreement value exactly",
      path: ["account_agreed_paise"],
    });
  }
  if (b.agreement_value_paise <= 0) {
    ctx.addIssue({ code: "custom", message: "Agreement value must be greater than 0", path: ["agreement_value_paise"] });
  }
  if (b.co_applicant_ids.includes(b.customer_id)) {
    ctx.addIssue({ code: "custom", message: "Primary applicant cannot also be a co-applicant", path: ["co_applicant_ids"] });
  }
  if (new Set(b.co_applicant_ids).size !== b.co_applicant_ids.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate co-applicants", path: ["co_applicant_ids"] });
  }
  if (new Set(b.parking_slot_ids).size !== b.parking_slot_ids.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate parking slots", path: ["parking_slot_ids"] });
  }
  if (b.plan_accepted_on < b.booking_date) {
    ctx.addIssue({ code: "custom", message: "Plan acceptance date cannot be before the booking date", path: ["plan_accepted_on"] });
  }
  if (b.plan_acceptance_mode === "SIGNED_COPY" && b.plan_acceptance_document_id == null) {
    ctx.addIssue({ code: "custom", message: "Upload the signed copy", path: ["plan_acceptance_document_id"] });
  }
});
export type BookingCreate = z.infer<typeof BookingCreateSchema>;

/** Wizard draft autosave: a partial, unvalidated payload plus the current step. */
export const BookingDraftUpsertSchema = z.strictObject({
  id: IdSchema.optional(),
  step: z.int().min(1).max(6),
  payload: BookingBase.partial().extend({ project_id: IdSchema.optional(), block_id: IdSchema.optional() }),
});
export type BookingDraftUpsert = z.infer<typeof BookingDraftUpsertSchema>;

export const BookingDraftRowSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  step: z.int(),
  payload: z.record(z.string(), z.unknown()),
  flat_number: z.string().nullable(),
  project_name: z.string().nullable(),
  customer_name: z.string().nullable(),
  updated_at: TimestampSchema,
});
export type BookingDraftRow = z.infer<typeof BookingDraftRowSchema>;

/** Snapshot of the flat as at booking. */
export const FlatSnapshotSchema = z.object({
  flat_number: z.string(),
  floor: z.int(),
  floor_label: z.string(),
  flat_type_id: IdSchema,
  flat_type_code: z.string(),
  flat_type_name: z.string(),
  facing: z.string().nullable(),
  carpet_sqft: z.number().nullable(),
  builtup_sqft: z.number().nullable(),
  super_builtup_sqft: z.number(),
  price_paise: PaiseSchema,
  price_breakup: z.array(MoneyBreakupLineSchema),
  rooms: z.array(RoomSnapshotSchema),
  areas: z.array(AreaSnapshotSchema),
});
export type FlatSnapshot = z.infer<typeof FlatSnapshotSchema>;

/** Per-bucket money summary (derived figures included). */
export const BucketSummarySchema = z.object({
  agreed_paise: PaiseSchema,
  order_raised_paise: PaiseSchema,
  paid_paise: PaiseSchema,
  due_paise: SignedPaiseSchema,
  advance_paise: PaiseSchema,
  pending_paise: PaiseSchema,
});
export type BucketSummary = z.infer<typeof BucketSummarySchema>;

/** Materialised + derived booking summary. */
export const BookingSummarySchema = z.object({
  raised_percent: z.number(),
  cash: BucketSummarySchema,
  account: BucketSummarySchema,
  total_order_raised_paise: PaiseSchema,
  total_paid_paise: PaiseSchema,
  total_due_paise: SignedPaiseSchema,
  other_charges_total_paise: PaiseSchema,
  other_charges_demanded_paise: PaiseSchema,
  other_charges_paid_paise: PaiseSchema,
  other_charges_due_paise: SignedPaiseSchema,
  pending_cheques_paise: PaiseSchema,
  last_payment_at: TimestampSchema.nullable(),
  next_installment: z
    .object({ seq: z.int(), name: z.string(), trigger_label: z.string(), expected_date: DateStringSchema.nullable(), cash_paise: PaiseSchema, account_paise: PaiseSchema })
    .nullable(),
});
export type BookingSummary = z.infer<typeof BookingSummarySchema>;

/** Cancellation details on a booking. */
export const CancellationInfoSchema = z.object({
  at: TimestampSchema,
  by: IdSchema.nullable(),
  by_name: z.string().nullable(),
  reason: z.string(),
  deduction_paise: PaiseSchema,
  refund_paise: PaiseSchema,
});
export type CancellationInfo = z.infer<typeof CancellationInfoSchema>;

/** Booking row with summary. */
export const BookingRowSchema = AuditedRowSchema.extend({
  booking_number: z.string(),
  project_id: IdSchema,
  project_name: z.string(),
  block_id: IdSchema,
  block_name: z.string(),
  flat_id: IdSchema,
  flat_number: z.string(),
  customer_id: IdSchema,
  customer_code: z.string(),
  customer_name: z.string(),
  customer_phone: z.string(),
  co_applicants: z.array(z.object({ customer_id: IdSchema, full_name: z.string(), phone: z.string() })),
  booking_date: DateStringSchema,
  status: BookingStatusSchema,
  agreement_value_paise: PaiseSchema,
  cash_agreed_paise: PaiseSchema,
  account_agreed_paise: PaiseSchema,
  flat_snapshot: FlatSnapshotSchema,
  rate_per_sqft_paise: PaiseSchema.nullable(),
  payment_plan_id: IdSchema,
  plan_snapshot: PlanSnapshotSchema,
  plan_accepted_on: DateStringSchema.nullable(),
  plan_acceptance_mode: PlanAcceptanceModeSchema.nullable(),
  plan_acceptance_document_id: IdSchema.nullable(),
  sales_user_id: IdSchema.nullable(),
  sales_user_name: z.string().nullable(),
  lead_id: IdSchema.nullable(),
  broker_name: z.string().nullable(),
  remarks: z.string().nullable(),
  parking_slots: z.array(z.object({ id: IdSchema, number: z.string(), slot_type: ParkingTypeSchema })),
  summary: BookingSummarySchema,
  cancellation: CancellationInfoSchema.nullable(),
  completed_at: TimestampSchema.nullable(),
  completed_by_name: z.string().nullable(),
  completion_notes: z.string().nullable(),
  revision_count: z.int().min(0),
});
export type BookingRow = z.infer<typeof BookingRowSchema>;

/** List filter for bookings. */
export const BookingFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  customer_id: IdSchema.optional(),
  status: BookingStatusSchema.optional(),
  payment_plan_id: IdSchema.optional(),
  sales_user_id: IdSchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  has_due: BoolQuerySchema.optional(),
  has_advance: BoolQuerySchema.optional(),
});
export type BookingFilter = z.infer<typeof BookingFilterSchema>;
export const BookingListResponseSchema = listEnvelope(BookingRowSchema);
export type BookingListResponse = z.infer<typeof BookingListResponseSchema>;

/** Agreement revision (permission agreement.edit): new split with a mandatory reason. */
export const AgreementRevisionCreateSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    agreement_value_paise: PaiseSchema,
    cash_agreed_paise: PaiseSchema,
    account_agreed_paise: PaiseSchema,
    reason: ReasonSchema,
  })
  .refine((r) => r.cash_agreed_paise + r.account_agreed_paise === r.agreement_value_paise, {
    message: "Cash agreed + Account agreed must equal the agreement value exactly",
    path: ["account_agreed_paise"],
  })
  .refine((r) => r.agreement_value_paise > 0, { message: "Agreement value must be greater than 0", path: ["agreement_value_paise"] });
export type AgreementRevisionCreate = z.infer<typeof AgreementRevisionCreateSchema>;

const AgreementValuesSchema = z.object({
  agreement_value_paise: PaiseSchema,
  cash_agreed_paise: PaiseSchema,
  account_agreed_paise: PaiseSchema,
});

export const AgreementRevisionRowSchema = z.object({
  id: IdSchema,
  booking_id: IdSchema,
  revised_at: TimestampSchema,
  revised_by: IdSchema.nullable(),
  revised_by_name: z.string().nullable(),
  reason: z.string(),
  before: AgreementValuesSchema,
  after: AgreementValuesSchema,
});
export type AgreementRevisionRow = z.infer<typeof AgreementRevisionRowSchema>;

/** Cancel a booking: reason, deduction, refund ≤ paid (checked by the service). */
export const BookingCancelSchema = z.strictObject({
  ...VersionedSchema.shape,
  reason: ReasonSchema,
  deduction_paise: PaiseSchema.default(0),
  refund_paise: PaiseSchema.default(0),
  cancel_date: DateStringSchema.optional(),
});
export type BookingCancel = z.infer<typeof BookingCancelSchema>;

/** Complete / hand over a booking (possession complete, dues ≤ 0). */
export const BookingCompleteSchema = z.strictObject({
  ...VersionedSchema.shape,
  completion_notes: NoteSchema.optional().nullable(),
  completed_on: DateStringSchema.optional(),
});
export type BookingComplete = z.infer<typeof BookingCompleteSchema>;

/** Change the plan after booking (only if no installment demand has been paid). */
export const BookingPlanChangeSchema = z.strictObject({
  ...VersionedSchema.shape,
  payment_plan_id: IdSchema,
  reason: ReasonSchema,
  plan_acceptance_mode: PlanAcceptanceModeSchema.optional(),
  plan_accepted_on: DateStringSchema.optional(),
  plan_acceptance_document_id: IdSchema.optional().nullable(),
});
export type BookingPlanChange = z.infer<typeof BookingPlanChangeSchema>;

export const PlanRevisionRowSchema = z.object({
  id: IdSchema,
  booking_id: IdSchema,
  at: TimestampSchema,
  by: IdSchema.nullable(),
  by_name: z.string().nullable(),
  reason: z.string(),
  before_plan_snapshot: PlanSnapshotSchema,
  after_plan_snapshot: PlanSnapshotSchema,
});
export type PlanRevisionRow = z.infer<typeof PlanRevisionRowSchema>;

/** Update remarks / sales user / broker on a booking. */
export const BookingUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  remarks: TextSchema.optional().nullable(),
  sales_user_id: IdSchema.optional().nullable(),
  broker_name: z.string().trim().max(120).optional().nullable(),
  co_applicant_ids: z.array(IdSchema).max(10).optional(),
});
export type BookingUpdate = z.infer<typeof BookingUpdateSchema>;

/** One ledger row (the table customers and accountants read). */
export const LedgerRowSchema = z.object({
  id: IdSchema,
  booking_id: IdSchema,
  seq: z.int().min(1),
  at: TimestampSchema,
  entry_date: DateStringSchema,
  event: LedgerEventSchema,
  label: z.string().nullable(),
  bucket: PaymentBucketSchema.nullable(),
  amount_paise: SignedPaiseSchema,
  cash_paid_cum_paise: PaiseSchema,
  account_paid_cum_paise: PaiseSchema,
  cash_order_raised_paise: PaiseSchema,
  account_order_raised_paise: PaiseSchema,
  cash_due_paise: SignedPaiseSchema,
  account_due_paise: SignedPaiseSchema,
  total_due_paise: SignedPaiseSchema,
  other_charges_due_paise: SignedPaiseSchema,
  ref_number: z.string().nullable(),
  ref_id: IdSchema.nullable(),
  note: z.string().nullable(),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;
export const LedgerListResponseSchema = listEnvelope(LedgerRowSchema);
export type LedgerListResponse = z.infer<typeof LedgerListResponseSchema>;

/** One installment on the booking's schedule tab. */
export const ScheduleRowSchema = z.object({
  seq: z.int(),
  name: z.string(),
  percent: z.number(),
  cumulative_percent: z.number(),
  trigger_type: TriggerTypeSchema,
  trigger_label: z.string(),
  expected_date: DateStringSchema.nullable(),
  status: ScheduleStatusSchema,
  demand_id: IdSchema.nullable(),
  demand_number: z.string().nullable(),
  demand_date: DateStringSchema.nullable(),
  due_date: DateStringSchema.nullable(),
  cash_paise: PaiseSchema,
  account_paise: PaiseSchema,
  total_paise: PaiseSchema,
  paid_paise: PaiseSchema,
});
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;
export const ScheduleResponseSchema = z.object({ booking_id: IdSchema, rows: z.array(ScheduleRowSchema) });
export type ScheduleResponse = z.infer<typeof ScheduleResponseSchema>;

/** Demand row. */
export const DemandRowSchema = z.object({
  id: IdSchema,
  company_id: IdSchema,
  booking_id: IdSchema,
  booking_number: z.string(),
  project_id: IdSchema,
  project_name: z.string(),
  block_id: IdSchema,
  block_name: z.string(),
  flat_number: z.string(),
  customer_id: IdSchema,
  customer_name: z.string(),
  demand_number: z.string(),
  installment_seq: z.int().nullable(),
  installment_name: z.string(),
  trigger_type: TriggerTypeSchema.nullable(),
  trigger_label: z.string(),
  trigger_stage_id: IdSchema.nullable(),
  percent: z.number(),
  cumulative_percent: z.number(),
  cash_demand_paise: PaiseSchema,
  account_demand_paise: PaiseSchema,
  total_demand_paise: PaiseSchema,
  demand_date: DateStringSchema,
  due_date: DateStringSchema,
  status: DemandStatusSchema,
  paid_paise: PaiseSchema,
  days_overdue: z.int().min(0),
  voided_at: TimestampSchema.nullable(),
  void_reason: z.string().nullable(),
  posted_at: TimestampSchema,
  created_at: TimestampSchema,
});
export type DemandRow = z.infer<typeof DemandRowSchema>;

export const DemandFilterSchema = ListQuerySchema.extend({
  booking_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  customer_id: IdSchema.optional(),
  status: DemandStatusSchema.optional(),
  overdue_only: BoolQuerySchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
});
export type DemandFilter = z.infer<typeof DemandFilterSchema>;
export const DemandListResponseSchema = listEnvelope(DemandRowSchema);
export type DemandListResponse = z.infer<typeof DemandListResponseSchema>;

/** Other charge line on a booking. */
export const OtherChargeRowSchema = z.object({
  id: IdSchema,
  booking_id: IdSchema,
  charge_type_id: IdSchema,
  name: z.string(),
  code: z.string(),
  amount_paise: PaiseSchema,
  gst_percent: z.number(),
  gst_paise: PaiseSchema,
  total_paise: PaiseSchema,
  demand_at: ChargeDemandAtSchema,
  demanded_at: TimestampSchema.nullable(),
  demand_number: z.string().nullable(),
  due_date: DateStringSchema.nullable(),
  paid_paise: PaiseSchema,
  due_paise: SignedPaiseSchema,
  sort_order: z.int(),
});
export type OtherChargeRow = z.infer<typeof OtherChargeRowSchema>;

/** Add an other-charge line to an existing booking. */
export const OtherChargeAddSchema = z.strictObject({ ...VersionedSchema.shape, ...OtherChargeInputSchema.shape });
export type OtherChargeAdd = z.infer<typeof OtherChargeAddSchema>;

/** Raise a MANUAL other-charge demand now. */
export const OtherChargeDemandNowSchema = z.strictObject({ ...VersionedSchema.shape, other_charge_id: IdSchema, due_date: DateStringSchema.optional() });
export type OtherChargeDemandNow = z.infer<typeof OtherChargeDemandNowSchema>;

/** Booking detail: row + tabs' first pages. */
export const BookingDetailResponseSchema = BookingRowSchema.extend({
  other_charges: z.array(OtherChargeRowSchema),
  schedule: z.array(ScheduleRowSchema),
  agreement_revisions: z.array(AgreementRevisionRowSchema),
  plan_revisions: z.array(PlanRevisionRowSchema),
});
export type BookingDetailResponse = z.infer<typeof BookingDetailResponseSchema>;

/** Response when the flat lock fails (FLAT_NOT_AVAILABLE details). */
export const FlatNotAvailableDetailsSchema = z.object({
  flat_id: IdSchema,
  current_status: FlatStatusSchema,
  booking_number: z.string().nullable(),
});
export type FlatNotAvailableDetails = z.infer<typeof FlatNotAvailableDetailsSchema>;
