import { z } from "zod";
import {
  ContraTypeSchema,
  MoneyCategorySchema,
  PaymentAgainstSchema,
  PaymentBucketSchema,
  PaymentModeCodeSchema,
  PaymentStatusSchema,
} from "../enums.js";
import {
  BoolQuerySchema,
  DateRangeSchema,
  DateStringSchema,
  IdSchema,
  ListQuerySchema,
  NoteSchema,
  PaiseSchema,
  PositivePaiseSchema,
  ReasonSchema,
  SignedPaiseSchema,
  TimestampSchema,
  VersionSchema,
  VersionedSchema,
  listEnvelope,
} from "../common.js";

/** Instrument details (cheque/DD/NEFT reference). */
export const InstrumentSchema = z.strictObject({
  number: z.string().trim().min(1).max(40),
  date: DateStringSchema.optional().nullable(),
  bank_name: z.string().trim().max(120).optional().nullable(),
  branch: z.string().trim().max(120).optional().nullable(),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

/** Post a payment (Idempotency-Key REQUIRED). Mode-dependent instrument/bank rules are enforced by the service. */
export const PaymentCreateSchema = z
  .strictObject({
    booking_id: IdSchema,
    against: PaymentAgainstSchema,
    bucket: PaymentBucketSchema.optional().nullable(),
    other_charge_id: IdSchema.optional().nullable(),
    amount_paise: PositivePaiseSchema,
    payment_date: DateStringSchema,
    payment_mode_id: IdSchema,
    instrument: InstrumentSchema.optional().nullable(),
    bank_account_id: IdSchema.optional().nullable(),
    remarks: NoteSchema.optional().nullable(),
  })
  .superRefine((p, ctx) => {
    switch (p.against) {
      case "FLAT_VALUE":
        if (p.bucket == null) ctx.addIssue({ code: "custom", message: "Pick Cash or Account for a flat-value payment", path: ["bucket"] });
        if (p.other_charge_id != null) {
          ctx.addIssue({ code: "custom", message: "other_charge_id is only for other-charge payments", path: ["other_charge_id"] });
        }
        break;
      case "OTHER_CHARGE":
        if (p.other_charge_id == null) ctx.addIssue({ code: "custom", message: "Pick the charge line", path: ["other_charge_id"] });
        if (p.bucket != null) ctx.addIssue({ code: "custom", message: "bucket does not apply to other-charge payments", path: ["bucket"] });
        break;
    }
  });
export type PaymentCreate = z.infer<typeof PaymentCreateSchema>;

/** Payment row. */
export const PaymentRowSchema = z.object({
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
  receipt_number: z.string(),
  against: PaymentAgainstSchema,
  bucket: PaymentBucketSchema.nullable(),
  other_charge_id: IdSchema.nullable(),
  other_charge_name: z.string().nullable(),
  amount_paise: PositivePaiseSchema,
  payment_date: DateStringSchema,
  payment_mode_id: IdSchema,
  mode_code: PaymentModeCodeSchema,
  mode_name: z.string(),
  instrument: z
    .object({ number: z.string(), date: DateStringSchema.nullable(), bank_name: z.string().nullable(), branch: z.string().nullable() })
    .nullable(),
  bank_account_id: IdSchema.nullable(),
  bank_account_label: z.string().nullable(),
  remarks: z.string().nullable(),
  received_by: IdSchema.nullable(),
  received_by_name: z.string().nullable(),
  status: PaymentStatusSchema,
  cleared_at: TimestampSchema.nullable(),
  bounced_at: TimestampSchema.nullable(),
  bounce_reason: z.string().nullable(),
  reversed_at: TimestampSchema.nullable(),
  reversal_reason: z.string().nullable(),
  receipt_cancelled: z.boolean(),
  posted_at: TimestampSchema,
  created_at: TimestampSchema,
  version: VersionSchema,
});
export type PaymentRow = z.infer<typeof PaymentRowSchema>;

/** List filter for payments. */
export const PaymentFilterSchema = ListQuerySchema.extend({
  booking_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  customer_id: IdSchema.optional(),
  status: PaymentStatusSchema.optional(),
  against: PaymentAgainstSchema.optional(),
  bucket: PaymentBucketSchema.optional(),
  mode_code: PaymentModeCodeSchema.optional(),
  bank_account_id: IdSchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  pending_only: BoolQuerySchema.optional(),
});
export type PaymentFilter = z.infer<typeof PaymentFilterSchema>;
export const PaymentListResponseSchema = listEnvelope(PaymentRowSchema);
export type PaymentListResponse = z.infer<typeof PaymentListResponseSchema>;

/** Clear a pending cheque/DD (bucket cap re-checked). */
export const PaymentClearSchema = z.strictObject({ ...VersionedSchema.shape, cleared_on: DateStringSchema.optional(), remarks: NoteSchema.optional().nullable() });
export type PaymentClear = z.infer<typeof PaymentClearSchema>;

/** Bounce a pending cheque/DD with reason. */
export const PaymentBounceSchema = z.strictObject({ ...VersionedSchema.shape, reason: ReasonSchema, bounced_on: DateStringSchema.optional() });
export type PaymentBounce = z.infer<typeof PaymentBounceSchema>;

/** Reverse a cleared payment with reason (receipt is cancelled, never deleted). */
export const PaymentReverseSchema = z.strictObject({ ...VersionedSchema.shape, reason: ReasonSchema, reversal_date: DateStringSchema.optional() });
export type PaymentReverse = z.infer<typeof PaymentReverseSchema>;

/** Response of posting: the payment plus the ledger row it produced. */
export const PaymentPostResponseSchema = z.object({
  payment: PaymentRowSchema,
  ledger_seq: z.int().nullable(),
  receipt_url: z.string().nullable(),
  summary: z.object({
    cash_due_paise: SignedPaiseSchema,
    account_due_paise: SignedPaiseSchema,
    total_due_paise: SignedPaiseSchema,
    other_charges_due_paise: SignedPaiseSchema,
  }),
});
export type PaymentPostResponse = z.infer<typeof PaymentPostResponseSchema>;

/** Data behind a printable receipt. */
export const ReceiptDataSchema = z.object({
  receipt_number: z.string(),
  payment_id: IdSchema,
  status: PaymentStatusSchema,
  is_cancelled: z.boolean(),
  subject_to_realisation: z.boolean(),
  payment_date: DateStringSchema,
  customer_name: z.string(),
  customer_address: z.string().nullable(),
  booking_number: z.string(),
  project_name: z.string(),
  block_name: z.string(),
  flat_number: z.string(),
  against: PaymentAgainstSchema,
  bucket: PaymentBucketSchema.nullable(),
  other_charge_name: z.string().nullable(),
  amount_paise: PaiseSchema,
  amount_words: z.string(),
  mode_name: z.string(),
  instrument: z.object({ number: z.string(), date: DateStringSchema.nullable(), bank_name: z.string().nullable() }).nullable(),
  bank_account_label: z.string().nullable(),
  received_by_name: z.string().nullable(),
  remarks: z.string().nullable(),
  company: z.object({
    name: z.string(),
    legal_name: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    gstin: z.string().nullable(),
    signatory_name: z.string().nullable(),
    signatory_title: z.string().nullable(),
  }),
});
export type ReceiptData = z.infer<typeof ReceiptDataSchema>;

/** Data behind a demand letter. */
export const DemandLetterDataSchema = z.object({
  demand_number: z.string(),
  demand_date: DateStringSchema,
  due_date: DateStringSchema,
  customer_name: z.string(),
  customer_address: z.string().nullable(),
  booking_number: z.string(),
  project_name: z.string(),
  block_name: z.string(),
  flat_number: z.string(),
  installment_name: z.string(),
  trigger_label: z.string(),
  percent: z.number(),
  cash_demand_paise: PaiseSchema,
  account_demand_paise: PaiseSchema,
  total_demand_paise: PaiseSchema,
  total_words: z.string(),
  cash_due_paise: SignedPaiseSchema,
  account_due_paise: SignedPaiseSchema,
  bank: z.object({ bank_name: z.string(), branch: z.string().nullable(), account_name: z.string(), account_number: z.string(), ifsc: z.string() }).nullable(),
});
export type DemandLetterData = z.infer<typeof DemandLetterDataSchema>;

// ---------------------------------------------------------------------------
// Contra entries & Roznamcha
// ---------------------------------------------------------------------------

/** Cash deposited to / withdrawn from bank. */
export const ContraEntryCreateSchema = z.strictObject({
  entry_date: DateStringSchema,
  type: ContraTypeSchema,
  amount_paise: PositivePaiseSchema,
  bank_account_id: IdSchema,
  remarks: NoteSchema.optional().nullable(),
});
export type ContraEntryCreate = z.infer<typeof ContraEntryCreateSchema>;

export const ContraEntryRowSchema = z.object({
  id: IdSchema,
  entry_date: DateStringSchema,
  type: ContraTypeSchema,
  amount_paise: PositivePaiseSchema,
  bank_account_id: IdSchema,
  bank_account_label: z.string(),
  remarks: z.string().nullable(),
  by_user_id: IdSchema.nullable(),
  by_user_name: z.string().nullable(),
  created_at: TimestampSchema,
});
export type ContraEntryRow = z.infer<typeof ContraEntryRowSchema>;

export const ContraEntryFilterSchema = ListQuerySchema.extend({
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  type: ContraTypeSchema.optional(),
  bank_account_id: IdSchema.optional(),
});
export type ContraEntryFilter = z.infer<typeof ContraEntryFilterSchema>;
export const ContraEntryListResponseSchema = listEnvelope(ContraEntryRowSchema);
export type ContraEntryListResponse = z.infer<typeof ContraEntryListResponseSchema>;

/** Roznamcha (day book) query: a date or range, optionally one project. */
export const RoznamchaQuerySchema = DateRangeSchema.safeExtend({ project_id: IdSchema.optional() });
export type RoznamchaQuery = z.infer<typeof RoznamchaQuerySchema>;

export const RoznamchaReceiptRowSchema = z.object({
  payment_id: IdSchema,
  receipt_number: z.string(),
  payment_date: DateStringSchema,
  customer_name: z.string(),
  booking_number: z.string(),
  project_name: z.string(),
  flat_number: z.string(),
  mode_code: PaymentModeCodeSchema,
  mode_name: z.string(),
  category: MoneyCategorySchema,
  instrument_number: z.string().nullable(),
  bank_account_label: z.string().nullable(),
  amount_paise: PaiseSchema,
});
export type RoznamchaReceiptRow = z.infer<typeof RoznamchaReceiptRowSchema>;

/** Roznamcha response: opening cash, receipts by mode/category, contra, closing cash, totals by project. */
export const RoznamchaResponseSchema = z.object({
  from: DateStringSchema,
  to: DateStringSchema,
  project_id: IdSchema.nullable(),
  opening_cash_paise: SignedPaiseSchema,
  cash_received_paise: PaiseSchema,
  cash_deposited_paise: PaiseSchema,
  cash_withdrawn_paise: PaiseSchema,
  closing_cash_paise: SignedPaiseSchema,
  receipts: z.array(RoznamchaReceiptRowSchema),
  by_mode: z.array(z.object({ mode_code: PaymentModeCodeSchema, mode_name: z.string(), count: z.int().min(0), amount_paise: PaiseSchema })),
  by_category: z.array(z.object({ category: MoneyCategorySchema, count: z.int().min(0), amount_paise: PaiseSchema })),
  by_project: z.array(z.object({ project_id: IdSchema, project_name: z.string(), count: z.int().min(0), amount_paise: PaiseSchema })),
  contra_entries: z.array(ContraEntryRowSchema),
  totals: z.object({ receipts_count: z.int().min(0), receipts_paise: PaiseSchema, pending_cheques_paise: PaiseSchema }),
});
export type RoznamchaResponse = z.infer<typeof RoznamchaResponseSchema>;

/** Cheques in hand (pending) / bounced listing row. */
export const ChequeRowSchema = PaymentRowSchema.pick({
  id: true,
  receipt_number: true,
  booking_number: true,
  customer_name: true,
  project_name: true,
  flat_number: true,
  amount_paise: true,
  payment_date: true,
  mode_code: true,
  instrument: true,
  bank_account_label: true,
  status: true,
  bounce_reason: true,
  version: true,
}).extend({ instrument_date: DateStringSchema.nullable(), days_in_hand: z.int().min(0) });
export type ChequeRow = z.infer<typeof ChequeRowSchema>;
export const ChequeListResponseSchema = listEnvelope(ChequeRowSchema);
export type ChequeListResponse = z.infer<typeof ChequeListResponseSchema>;

/** Roznamcha for one day (default today IST), optionally one project. */
export const RoznamchaDayQuerySchema = z.object({ date: DateStringSchema.optional(), project_id: IdSchema.optional() });
export type RoznamchaDayQuery = z.infer<typeof RoznamchaDayQuerySchema>;
