import { z } from "zod";
import {
  BookingStatusSchema,
  GenderSchema,
  KycStatusSchema,
  LeadSourceSchema,
  PortalAccessActionSchema,
} from "../enums.js";
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
  VersionSchema,
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
  /** Optimistic-concurrency version: PATCH /customers/:id/co-applicants/:caId requires it (body.version or If-Match). */
  version: VersionSchema,
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

/**
 * Wire body of `PATCH /customers/:id`: fields absent from the body stay untouched (no defaults are filled in for
 * `tags`, `co_applicants` or `same_as_current`); `version` may also arrive through `If-Match`.
 */
export const CustomerPatchSchema = z
  .strictObject({
    ...CustomerBase.shape,
    same_as_current: z.boolean(),
    co_applicants: z.array(CoApplicantInputSchema).max(10),
    tags: z.array(z.string().trim().min(1).max(30)).max(20),
  })
  .partial()
  .extend({ version: VersionSchema.optional() });
export type CustomerPatch = z.infer<typeof CustomerPatchSchema>;

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
  /** Maker of the KYC check (set when the status moves to SUBMITTED); the verifier must be someone else. */
  kyc_submitted_by: IdSchema.nullable().optional(),
  kyc_submitted_by_name: z.string().nullable().optional(),
  kyc_submitted_at: TimestampSchema.nullable().optional(),
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

/**
 * KYC workflow (maker-checker): PENDING/REJECTED → SUBMITTED needs PAN, Aadhaar and at least one KYC document (422 KYC_INCOMPLETE; a
 * rejected file must have been edited since the rejection); SUBMITTED → VERIFIED/REJECTED needs customer.kyc_view and a verifier who is
 * not the submitter (403 FORBIDDEN details.reason KYC_MAKER_CHECKER); any other move is 409 KYC_TRANSITION_INVALID. Changing a VERIFIED
 * status needs settings.manage and a `reason`.
 */
export const CustomerKycUpdateSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    kyc_status: KycStatusSchema,
    kyc_remarks: NoteSchema.optional().nullable(),
    reason: ReasonSchema.optional(),
  })
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
export const PortalBulkEnableSchema = z.strictObject({
  project_id: IdSchema.optional(),
  dry_run: z.boolean().default(false),
});
export type PortalBulkEnable = z.infer<typeof PortalBulkEnableSchema>;

/** `?format=csv` on the same call returns the credentials as a CSV attachment instead of JSON (still exactly once). */
export const PortalBulkEnableQuerySchema = z.object({ format: z.enum(["json", "csv"]).optional() });
export type PortalBulkEnableQuery = z.infer<typeof PortalBulkEnableQuerySchema>;

/** One login created by a bulk enable. The temporary password exists only in this response: it is never stored, logged or audited. */
export const PortalBulkCredentialSchema = z.object({
  customer_id: IdSchema,
  customer_code: z.string(),
  full_name: z.string(),
  phone: z.string(),
  temporary_password: z.string(),
  /** @deprecated same value as temporary_password (kept for older clients). */
  temp_password: z.string(),
});
export type PortalBulkCredential = z.infer<typeof PortalBulkCredentialSchema>;

export const PortalBulkEnableResponseSchema = z.object({
  dry_run: z.boolean(),
  enabled: z.int().min(0),
  already_enabled: z.int().min(0),
  /** Customers not enabled because the batch stopped on an unexpected error (absent when 0); re-run the bulk enable for them. */
  failed: z.int().min(0).optional(),
  credentials: z.array(PortalBulkCredentialSchema),
});
export type PortalBulkEnableResponse = z.infer<typeof PortalBulkEnableResponseSchema>;

/** Right-to-erasure: anonymise PII when the customer has no active booking. */
export const CustomerEraseSchema = z.strictObject({ confirm: z.literal("ERASE"), reason: ReasonSchema });
export type CustomerErase = z.infer<typeof CustomerEraseSchema>;

/** Co-applicant partial update: the row's `version` is required (here or as If-Match); a stale one → 409 VERSION_CONFLICT. */
export const CoApplicantUpdateSchema = CoApplicantInputSchema.omit({ id: true })
  .partial()
  .extend({ version: VersionSchema.optional() });
export type CoApplicantUpdate = z.infer<typeof CoApplicantUpdateSchema>;

export const CoApplicantListResponseSchema = z.object({ items: z.array(CoApplicantRowSchema) });
export type CoApplicantListResponse = z.infer<typeof CoApplicantListResponseSchema>;

/** Recent payment row on the Customer 360 page. */
export const Customer360PaymentSchema = z.object({
  payment_id: IdSchema,
  booking_id: IdSchema,
  booking_number: z.string(),
  receipt_number: z.string(),
  amount_paise: z.int(),
  payment_date: DateStringSchema,
  mode_code: z.string(),
  bucket: z.string().nullable(),
  against: z.string(),
  status: z.string(),
});
export type Customer360Payment = z.infer<typeof Customer360PaymentSchema>;

/** Document row on the Customer 360 page (no storage keys). */
export const Customer360DocumentSchema = z.object({
  document_id: IdSchema,
  title: z.string().nullable(),
  file_name: z.string(),
  mime: z.string(),
  document_type_name: z.string().nullable(),
  is_sensitive: z.boolean(),
  shared_with_customer: z.boolean(),
  created_at: TimestampSchema,
});
export type Customer360Document = z.infer<typeof Customer360DocumentSchema>;

/** Lead summary row on the Customer 360 page. */
export const Customer360LeadSchema = z.object({
  lead_id: IdSchema,
  lead_number: z.string(),
  stage: z.string(),
  source: LeadSourceSchema,
  project_name: z.string().nullable(),
  created_at: TimestampSchema,
});
export type Customer360Lead = z.infer<typeof Customer360LeadSchema>;

/** Service ticket summary row on the Customer 360 page. */
export const Customer360TicketSchema = z.object({
  ticket_id: IdSchema,
  ticket_number: z.string(),
  subject: z.string(),
  status: z.string(),
  priority: z.string(),
  created_at: TimestampSchema,
});
export type Customer360Ticket = z.infer<typeof Customer360TicketSchema>;

/** Customer 360 summary cards. */
export const Customer360ResponseSchema = z.object({
  customer: CustomerRowSchema,
  payments_recent: z.array(Customer360PaymentSchema),
  documents: z.array(Customer360DocumentSchema),
  leads: z.array(Customer360LeadSchema),
  tickets: z.array(Customer360TicketSchema),
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
