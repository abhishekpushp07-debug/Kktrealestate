import { z } from "zod";
import { PlanTypeSchema, TriggerTypeSchema } from "../enums.js";
import {
  BoolQuerySchema,
  DateStringSchema,
  IdSchema,
  ListQuerySchema,
  MasterRowSchema,
  NameSchema,
  CodeSchema,
  NoteSchema,
  PaiseSchema,
  PercentSchema,
  SignedPaiseSchema,
  TextSchema,
  VersionSchema,
  listEnvelope,
} from "../common.js";

/** One installment of a payment plan. */
export const InstallmentInputSchema = z
  .strictObject({
    seq: z.int().min(1).max(100),
    name: NameSchema,
    percent: PercentSchema,
    trigger_type: TriggerTypeSchema,
    trigger_days: z.int().min(1).max(3650).optional().nullable(),
    trigger_stage_id: IdSchema.optional().nullable(),
    trigger_date: DateStringSchema.optional().nullable(),
    due_days: z.int().min(0).max(365).optional().nullable(),
    notes: NoteSchema.optional().nullable(),
  })
  .superRefine((i, ctx) => {
    switch (i.trigger_type) {
      case "DAYS_AFTER_BOOKING":
        if (i.trigger_days == null) ctx.addIssue({ code: "custom", message: "trigger_days required", path: ["trigger_days"] });
        break;
      case "ON_STAGE":
        if (i.trigger_stage_id == null) ctx.addIssue({ code: "custom", message: "trigger_stage_id required", path: ["trigger_stage_id"] });
        break;
      case "ON_DATE":
        if (i.trigger_date == null) ctx.addIssue({ code: "custom", message: "trigger_date required", path: ["trigger_date"] });
        break;
      case "ON_BOOKING":
      case "ON_POSSESSION":
        break;
    }
  });
export type InstallmentInput = z.infer<typeof InstallmentInputSchema>;

/** Sums percents in integer basis points to avoid float drift. */
export function sumPercentBasisPoints(installments: readonly { percent: number }[]): number {
  return installments.reduce((s, i) => s + Math.round(i.percent * 100), 0);
}

/** Adds plan-level issues: percents sum to 100.00, unique seq, ≤1 ON_BOOKING, ≤1 ON_POSSESSION. */
export function addInstallmentListIssues(installments: readonly InstallmentInput[], ctx: z.RefinementCtx, path: readonly PropertyKey[]): void {
  if (sumPercentBasisPoints(installments) !== 10_000) {
    const total = (sumPercentBasisPoints(installments) / 100).toFixed(2);
    ctx.addIssue({ code: "custom", message: `Installment percents must sum to exactly 100.00 (got ${total})`, path: [...path] });
  }
  if (new Set(installments.map((i) => i.seq)).size !== installments.length) {
    ctx.addIssue({ code: "custom", message: "Installment sequences must be unique", path: [...path] });
  }
  if (installments.filter((i) => i.trigger_type === "ON_BOOKING").length > 1) {
    ctx.addIssue({ code: "custom", message: "At most one ON_BOOKING installment", path: [...path] });
  }
  if (installments.filter((i) => i.trigger_type === "ON_POSSESSION").length > 1) {
    ctx.addIssue({ code: "custom", message: "At most one ON_POSSESSION installment", path: [...path] });
  }
}

const PaymentPlanBase = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  plan_type: PlanTypeSchema,
  description: TextSchema.optional().nullable(),
  grace_days: z.int().min(0).max(90).default(0),
  installments: z.array(InstallmentInputSchema).min(1).max(100),
});

/** Create a payment plan with installments (sum 100.00, unique seq, ≤1 ON_BOOKING, ≤1 ON_POSSESSION). */
export const PaymentPlanCreateSchema = PaymentPlanBase.superRefine((p, ctx) => addInstallmentListIssues(p.installments, ctx, ["installments"]));
export type PaymentPlanCreate = z.infer<typeof PaymentPlanCreateSchema>;

/** Update a payment plan (partial + version); installments, when given, are validated as a whole. */
export const PaymentPlanUpdateSchema = PaymentPlanBase.partial()
  .extend({ version: VersionSchema })
  .superRefine((p, ctx) => {
    if (p.installments) addInstallmentListIssues(p.installments, ctx, ["installments"]);
  });
export type PaymentPlanUpdate = z.infer<typeof PaymentPlanUpdateSchema>;

/** Installment row with resolved stage name. */
export const InstallmentRowSchema = z.object({
  id: IdSchema,
  seq: z.int(),
  name: z.string(),
  percent: z.number(),
  cumulative_percent: z.number(),
  trigger_type: TriggerTypeSchema,
  trigger_days: z.int().nullable(),
  trigger_stage_id: IdSchema.nullable(),
  trigger_stage_name: z.string().nullable(),
  trigger_date: DateStringSchema.nullable(),
  due_days: z.int().nullable(),
  trigger_label: z.string(),
  notes: z.string().nullable(),
});
export type InstallmentRow = z.infer<typeof InstallmentRowSchema>;

/** Payment plan row. */
export const PaymentPlanRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  plan_type: PlanTypeSchema,
  description: z.string().nullable(),
  grace_days: z.int(),
  installments: z.array(InstallmentRowSchema),
  assignment_count: z.int().min(0),
  booking_count: z.int().min(0),
});
export type PaymentPlanRow = z.infer<typeof PaymentPlanRowSchema>;

export const PaymentPlanFilterSchema = ListQuerySchema.extend({ plan_type: PlanTypeSchema.optional(), project_id: IdSchema.optional() });
export type PaymentPlanFilter = z.infer<typeof PaymentPlanFilterSchema>;
export const PaymentPlanListResponseSchema = listEnvelope(PaymentPlanRowSchema);
export type PaymentPlanListResponse = z.infer<typeof PaymentPlanListResponseSchema>;

/** Installment inside a booking's plan snapshot. */
export const PlanSnapshotInstallmentSchema = z.object({
  seq: z.int(),
  name: z.string(),
  percent: z.number(),
  trigger_type: TriggerTypeSchema,
  trigger_days: z.int().nullable(),
  trigger_stage_id: IdSchema.nullable(),
  trigger_stage_name: z.string().nullable(),
  trigger_date: DateStringSchema.nullable(),
  due_days: z.int(),
});
export type PlanSnapshotInstallment = z.infer<typeof PlanSnapshotInstallmentSchema>;

/** The plan snapshot stored on a booking. */
export const PlanSnapshotSchema = z.object({
  plan_id: IdSchema,
  name: z.string(),
  code: z.string(),
  plan_type: PlanTypeSchema,
  grace_days: z.int(),
  installments: z.array(PlanSnapshotInstallmentSchema),
});
export type PlanSnapshot = z.infer<typeof PlanSnapshotSchema>;

// ---------------------------------------------------------------------------
// Assignments to projects / towers
// ---------------------------------------------------------------------------

const PlanAssignmentBase = z.strictObject({
  plan_id: IdSchema,
  project_id: IdSchema,
  block_id: IdSchema.optional().nullable(),
  is_default: z.boolean().default(false),
  effective_from: DateStringSchema.optional().nullable(),
  effective_to: DateStringSchema.optional().nullable(),
  is_active: z.boolean().default(true),
});

/** Link a plan to a whole project (block_id null) or one tower. */
export const PlanAssignmentCreateSchema = PlanAssignmentBase.refine(
  (a) => a.effective_from == null || a.effective_to == null || a.effective_from <= a.effective_to,
  { message: "effective_from must be ≤ effective_to", path: ["effective_to"] },
);
export type PlanAssignmentCreate = z.infer<typeof PlanAssignmentCreateSchema>;

export const PlanAssignmentUpdateSchema = PlanAssignmentBase.omit({ plan_id: true, project_id: true, block_id: true })
  .partial()
  .extend({ version: VersionSchema });
export type PlanAssignmentUpdate = z.infer<typeof PlanAssignmentUpdateSchema>;

export const PlanAssignmentRowSchema = z.object({
  id: IdSchema,
  plan_id: IdSchema,
  plan_name: z.string(),
  plan_code: z.string(),
  plan_type: PlanTypeSchema,
  project_id: IdSchema,
  project_name: z.string(),
  block_id: IdSchema.nullable(),
  block_name: z.string().nullable(),
  is_default: z.boolean(),
  effective_from: DateStringSchema.nullable(),
  effective_to: DateStringSchema.nullable(),
  is_active: z.boolean(),
  version: VersionSchema,
});
export type PlanAssignmentRow = z.infer<typeof PlanAssignmentRowSchema>;

export const PlanAssignmentFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  plan_id: IdSchema.optional(),
  active_only: BoolQuerySchema.optional(),
});
export type PlanAssignmentFilter = z.infer<typeof PlanAssignmentFilterSchema>;
export const PlanAssignmentListResponseSchema = listEnvelope(PlanAssignmentRowSchema);
export type PlanAssignmentListResponse = z.infer<typeof PlanAssignmentListResponseSchema>;

/** Plans applicable to a tower on a date (default first). */
export const ApplicablePlansQuerySchema = z.object({ project_id: IdSchema, block_id: IdSchema, on_date: DateStringSchema.optional() });
export type ApplicablePlansQuery = z.infer<typeof ApplicablePlansQuerySchema>;

export const ApplicablePlanRowSchema = z.object({
  plan_id: IdSchema,
  name: z.string(),
  code: z.string(),
  plan_type: PlanTypeSchema,
  grace_days: z.int(),
  is_default: z.boolean(),
  installments: z.array(InstallmentRowSchema),
});
export type ApplicablePlanRow = z.infer<typeof ApplicablePlanRowSchema>;

export const ApplicablePlansResponseSchema = z.object({ plans: z.array(ApplicablePlanRowSchema) });
export type ApplicablePlansResponse = z.infer<typeof ApplicablePlansResponseSchema>;

/** Live schedule preview for the booking wizard. */
export const SchedulePreviewRequestSchema = z.strictObject({
  plan_id: IdSchema,
  block_id: IdSchema,
  booking_date: DateStringSchema,
  cash_agreed_paise: PaiseSchema,
  account_agreed_paise: PaiseSchema,
});
export type SchedulePreviewRequest = z.infer<typeof SchedulePreviewRequestSchema>;

export const SchedulePreviewRowSchema = z.object({
  seq: z.int(),
  name: z.string(),
  percent: z.number(),
  cumulative_percent: z.number(),
  trigger_type: TriggerTypeSchema,
  trigger_label: z.string(),
  expected_date: DateStringSchema.nullable(),
  already_satisfied: z.boolean(),
  cash_paise: PaiseSchema,
  account_paise: PaiseSchema,
  total_paise: PaiseSchema,
});
export type SchedulePreviewRow = z.infer<typeof SchedulePreviewRowSchema>;

export const SchedulePreviewResponseSchema = z.object({
  plan_id: IdSchema,
  rows: z.array(SchedulePreviewRowSchema),
  totals: z.object({ cash_paise: PaiseSchema, account_paise: PaiseSchema, total_paise: PaiseSchema }),
  catch_up_paise: SignedPaiseSchema,
});
export type SchedulePreviewResponse = z.infer<typeof SchedulePreviewResponseSchema>;
