import { z } from "zod";
import { BookingStatusSchema, GenderSchema, KycStatusSchema, LeadSourceSchema, PortalAccessActionSchema } from "../enums.js";
import {
  AadhaarSchema,
  AddressSchema,
  BankAccountNumberSchema,
  BoolQuerySchema,
  DateStringSchema,
  EmailSchema,
  IFSCSchema,
  IdSchema,
  ListQuerySchema,
  MasterRowSchema,
  NameSchema,
  NoteSchema,
  PANSchema,
  PhoneSchema,
  ReasonSchema,
  TextSchema,
  TimestampSchema,
  UrlSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

/** Co-applicant input (KYC fields optional; stored encrypted). */
export const CoApplicantInputSchema = z.strictObject({
  id: IdSchema.optional(),
  full_name: NameSchema,
  relation: z.string().trim().min(1).max(40),
  phone: PhoneSchema.optional().nullable(),
  email: EmailSchema.optional().nullable(),
  pan: PANSchema.optional().nullable(),
  aadhaar: AadhaarSchema.optional().nullable(),
});
export type CoApplicantInput = z.infer<typeof CoApplicantInputSchema>;

/** Co-applicant row (masked). */
export const CoApplicantRowSchema = z.object({
  id: IdSchema,
  customer_id: IdSchema,
  full_name: z.string(),
  relation: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  pan_masked: z.string().nullable(),
  aadhaar_masked: z.string().nullable(),
  sort_order: z.int(),
});
export type CoApplicantRow = z.infer<typeof CoApplicantRowSchema>;

/** Bank details input. */
export const BankDetailsInputSchema = z.strictObject({
  bank_name: NameSchema,
  ifsc: IFSCSchema,
  holder_name: NameSchema,
  account_number: BankAccountNumberSchema,
});
export type BankDetailsInput = z.infer<typeof BankDetailsInputSchema>;

/** Bank details as returned (masked). */
export const BankDetailsMaskedSchema = z.object({
  bank_name: z.string(),
  ifsc: z.string(),
  holder_name: z.string(),
  bank_account_masked: z.string(),
});
export type BankDetailsMasked = z.infer<typeof BankDetailsMaskedSchema>;

/** Nominee. */
export const NomineeSchema = z.strictObject({
  name: NameSchema,
  relation: z.string().trim().min(1).max(40),
  phone: PhoneSchema.optional().nullable(),
  dob: DateStringSchema.optional().nullable(),
});
export type Nominee = z.infer<typeof NomineeSchema>;

const CustomerBase = z.strictObject({
  salutation: z.string().trim().max(10).optional().nullable(),
  full_name: NameSchema,
  father_or_spouse_name: NameSchema.optional().nullable(),
  dob: DateStringSchema.optional().nullable(),
  gender: GenderSchema.optional().nullable(),
  phone: PhoneSchema,
  alt_phone: PhoneSchema.optional().nullable(),
  email: EmailSchema.optional().nullable(),
  address_current: AddressSchema.optional().nullable(),
  address_permanent: AddressSchema.optional().nullable(),
  same_as_current: z.boolean().default(true),
  occupation: z.string().trim().max(80).optional().nullable(),
  company_name: z.string().trim().max(120).optional().nullable(),
  income_band: z.string().trim().max(40).optional().nullable(),
  source: LeadSourceSchema.optional().nullable(),
  relationship_manager_id: IdSchema.optional().nullable(),
  pan: PANSchema.optional().nullable(),
  aadhaar: AadhaarSchema.optional().nullable(),
  bank: BankDetailsInputSchema.optional().nullable(),
  nominee: NomineeSchema.optional().nullable(),
  co_applicants: z.array(CoApplicantInputSchema).max(10).default([]),
  notes: TextSchema.optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
});

/** Create a customer with KYC fields (PAN/Aadhaar/bank are encrypted at rest). */
export const CustomerCreateSchema = CustomerBase.refine((c) => c.same_as_current || c.address_permanent != null, {
  message: "Permanent address required when not same as current",
  path: ["address_permanent"],
});
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>;

/** Update a customer (partial + version). */
export const CustomerUpdateSchema = updateOf(CustomerBase);
export type CustomerUpdate = z.infer<typeof CustomerUpdateSchema>;

/** Customer row with MASKED KYC values. */
export const CustomerRowSchema = MasterRowSchema.extend({
  customer_code: z.string(),
  salutation: z.string().nullable(),
  full_name: z.string(),
  father_or_spouse_name: z.string().nullable(),
  dob: DateStringSchema.nullable(),
  gender: GenderSchema.nullable(),
  phone: z.string(),
  alt_phone: z.string().nullable(),
  email: z.string().nullable(),
  address_current: AddressSchema.nullable(),
  address_permanent: AddressSchema.nullable(),
  same_as_current: z.boolean(),
  occupation: z.string().nullable(),
  company_name: z.string().nullable(),
  income_band: z.string().nullable(),
  source: LeadSourceSchema.nullable(),
  relationship_manager_id: IdSchema.nullable(),
  relationship_manager_name: z.string().nullable(),
  pan_masked: z.string().nullable(),
  aadhaar_masked: z.string().nullable(),
  bank: BankDetailsMaskedSchema.nullable(),
  bank_account_masked: z.string().nullable(),
  nominee: z
    .object({ name: z.string(), relation: z.string(), phone: z.string().nullable(), dob: DateStringSchema.nullable() })
    .nullable(),
  co_applicants: z.array(CoApplicantRowSchema),
  kyc_status: KycStatusSchema,
  kyc_verified_by: IdSchema.nullable(),
  kyc_verified_by_name: z.string().nullable(),
  kyc_verified_at: TimestampSchema.nullable(),
  kyc_remarks: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  active_booking_count: z.int().min(0),
  portal_enabled: z.boolean(),
  erased_at: TimestampSchema.nullable(),
});
export type CustomerRow = z.infer<typeof CustomerRowSchema>;

/** Customer row with REVEALED KYC (requires customer.kyc_view + ?reveal=true; audited). */
export const CustomerRevealedSchema = CustomerRowSchema.extend({
  pan: z.string().nullable(),
  aadhaar: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  co_applicants_revealed: z.array(
    CoApplicantRowSchema.extend({ pan: z.string().nullable(), aadhaar: z.string().nullable() }),
  ),
  revealed_at: TimestampSchema,
});
export type CustomerRevealed = z.infer<typeof CustomerRevealedSchema>;

/** `GET /customers/:id?reveal=true`. */
export const CustomerGetQuerySchema = z.object({ reveal: BoolQuerySchema.default(false) });
export type CustomerGetQuery = z.infer<typeof CustomerGetQuerySchema>;

/** List filter for customers. */
export const CustomerFilterSchema = ListQuerySchema.extend({
  kyc_status: KycStatusSchema.optional(),
  relationship_manager_id: IdSchema.optional(),
  source: LeadSourceSchema.optional(),
  tag: z.string().trim().max(30).optional(),
  project_id: IdSchema.optional(),
  has_active_booking: BoolQuerySchema.optional(),
  portal_enabled: BoolQuerySchema.optional(),
  phone: PhoneSchema.optional(),
});
export type CustomerFilter = z.infer<typeof CustomerFilterSchema>;

export const CustomerListResponseSchema = listEnvelope(CustomerRowSchema);
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;

/** Update KYC status (verifier recorded by the server). */
export const CustomerKycUpdateSchema = z
  .strictObject({ ...VersionedSchema.shape, kyc_status: KycStatusSchema, kyc_remarks: NoteSchema.optional().nullable() })
  .refine((k) => k.kyc_status !== "REJECTED" || (k.kyc_remarks ?? "").length >= 3, {
    message: "Remarks are required when rejecting KYC",
    path: ["kyc_remarks"],
  });
export type CustomerKycUpdate = z.infer<typeof CustomerKycUpdateSchema>;

/** Duplicate check by phone and/or PAN. */
export const CustomerDuplicateCheckSchema = z
  .strictObject({ phone: PhoneSchema.optional(), pan: PANSchema.optional(), exclude_customer_id: IdSchema.optional() })
  .refine((d) => d.phone !== undefined || d.pan !== undefined, { message: "Give phone or pan", path: ["phone"] });
export type CustomerDuplicateCheck = z.infer<typeof CustomerDuplicateCheckSchema>;

export const CustomerDuplicateMatchSchema = z.object({
  customer_id: IdSchema,
  customer_code: z.string(),
  full_name: z.string(),
  phone: z.string(),
  matched_on: z.enum(["PHONE", "PAN"]),
});
export type CustomerDuplicateMatch = z.infer<typeof CustomerDuplicateMatchSchema>;

export const CustomerDuplicateCheckResponseSchema = z.object({ matches: z.array(CustomerDuplicateMatchSchema) });
export type CustomerDuplicateCheckResponse = z.infer<typeof CustomerDuplicateCheckResponseSchema>;

// ---------------------------------------------------------------------------
// Portal access card
// ---------------------------------------------------------------------------

/** Portal access action on one customer. */
export const PortalAccessRequestSchema = z.strictObject({ action: PortalAccessActionSchema });
export type PortalAccessRequest = z.infer<typeof PortalAccessRequestSchema>;

/** Portal access card state (temp password present only right after ENABLE / RESET_PASSWORD). */
export const PortalAccessResponseSchema = z.object({
  customer_id: IdSchema,
  phone: z.string(),
  is_enabled: z.boolean(),
  must_change_password: z.boolean(),
  temp_password: z.string().nullable(),
  login_url: UrlSchema.nullable(),
  last_login_at: TimestampSchema.nullable(),
  enabled_at: TimestampSchema.nullable(),
  disabled_at: TimestampSchema.nullable(),
  locked_until: TimestampSchema.nullable(),
  active_sessions: z.int().min(0),
});
export type PortalAccessResponse = z.infer<typeof PortalAccessResponseSchema>;

/** Bulk-enable portal access for all customers with active bookings. */
export const PortalBulkEnableSchema = z.strictObject({ project_id: IdSchema.optional(), dry_run: z.boolean().default(false) });
export type PortalBulkEnable = z.infer<typeof PortalBulkEnableSchema>;

export const PortalBulkEnableResponseSchema = z.object({
  dry_run: z.boolean(),
  enabled: z.int().min(0),
  already_enabled: z.int().min(0),
  credentials: z.array(z.object({ customer_id: IdSchema, customer_code: z.string(), phone: z.string(), temp_password: z.string() })),
});
export type PortalBulkEnableResponse = z.infer<typeof PortalBulkEnableResponseSchema>;

/** Right-to-erasure: anonymise PII when the customer has no active booking. */
export const CustomerEraseSchema = z.strictObject({ confirm: z.literal("ERASE"), reason: ReasonSchema });
export type CustomerErase = z.infer<typeof CustomerEraseSchema>;

/** Customer 360 summary cards. */
export const Customer360ResponseSchema = z.object({
  customer: CustomerRowSchema,
  bookings: z.array(
    z.object({
      booking_id: IdSchema,
      booking_number: z.string(),
      project_name: z.string(),
      block_name: z.string(),
      flat_number: z.string(),
      status: BookingStatusSchema,
      plan_name: z.string(),
      agreement_value_paise: z.int(),
      total_paid_paise: z.int(),
      total_due_paise: z.int(),
      role: z.enum(["PRIMARY", "CO_APPLICANT"]),
    }),
  ),
  payments_count: z.int().min(0),
  documents_count: z.int().min(0),
  leads_count: z.int().min(0),
  tickets_open: z.int().min(0),
  portal: PortalAccessResponseSchema.nullable(),
});
export type Customer360Response = z.infer<typeof Customer360ResponseSchema>;
