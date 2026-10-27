import { z } from "zod";
import {
  BookingStatusSchema,
  DemandStatusSchema,
  KycStatusSchema,
  LedgerEventSchema,
  NotificationTypeSchema,
  PaymentBucketSchema,
  PaymentStatusSchema,
  PlanTypeSchema,
  ScheduleStatusSchema,
  ServicePrioritySchema,
  ServiceStatusSchema,
  StageStatusSchema,
  TriggerTypeSchema,
} from "../enums.js";
import {
  AddressSchema,
  DateStringSchema,
  EmailSchema,
  IdSchema,
  ListQuerySchema,
  MoneyBreakupLineSchema,
  PaiseSchema,
  PasswordSchema,
  PhoneSchema,
  ReasonSchema,
  SignedLinkSchema,
  SignedPaiseSchema,
  TimestampSchema,
  listEnvelope,
} from "../common.js";
import { LedgerTotalsSchema } from "./bookings.js";
import { PortalAuthLoginSchema, PortalAuthRefreshSchema, TokenPairSchema, SessionRowSchema } from "./auth.js";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Buyer login: phone + password (+ optional company slug, contract C4). The one schema the API validates (auth.ts). */
export const PortalLoginSchema = PortalAuthLoginSchema;
export type PortalLogin = z.infer<typeof PortalLoginSchema>;

/** The logged-in customer (masked KYC even to themselves). */
export const PortalUserSchema = z.object({
  customer_id: IdSchema,
  customer_code: z.string(),
  full_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  must_change_password: z.boolean(),
  booking_count: z.int().min(0),
  last_login_at: TimestampSchema.nullable(),
});
export type PortalUser = z.infer<typeof PortalUserSchema>;

export const PortalLoginResponseSchema = TokenPairSchema.extend({ user: PortalUserSchema });
export type PortalLoginResponse = z.infer<typeof PortalLoginResponseSchema>;

/** Change password (forced at first login). */
export const PortalChangePasswordSchema = z
  .strictObject({ current_password: z.string().min(1).max(128), new_password: PasswordSchema })
  .refine((v) => v.current_password !== v.new_password, {
    message: "New password must differ",
    path: ["new_password"],
  });
export type PortalChangePassword = z.infer<typeof PortalChangePasswordSchema>;

/** Refresh body: optional in cookie mode (contract C1). The one schema the API validates (auth.ts). */
export const PortalRefreshSchema = PortalAuthRefreshSchema;
export type PortalRefresh = z.infer<typeof PortalRefreshSchema>;

export const PortalSessionRowSchema = SessionRowSchema;
export type PortalSessionRow = z.infer<typeof PortalSessionRowSchema>;

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** A booking the buyer may switch to (primary or co-applicant). */
export const PortalBookingSwitcherItemSchema = z.object({
  booking_id: IdSchema,
  booking_number: z.string(),
  project_name: z.string(),
  block_name: z.string(),
  flat_number: z.string(),
  role: z.enum(["PRIMARY", "CO_APPLICANT"]),
  status: BookingStatusSchema,
});
export type PortalBookingSwitcherItem = z.infer<typeof PortalBookingSwitcherItemSchema>;

export const PortalBucketCardSchema = z.object({
  agreed_paise: PaiseSchema,
  raised_paise: PaiseSchema,
  paid_paise: PaiseSchema,
  due_paise: PaiseSchema,
  advance_paise: PaiseSchema,
});
export type PortalBucketCard = z.infer<typeof PortalBucketCardSchema>;

export const PortalRelationshipManagerSchema = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
});
export type PortalRelationshipManager = z.infer<typeof PortalRelationshipManagerSchema>;

/** Portal home for one booking. */
export const PortalHomeResponseSchema = z.object({
  greeting_name: z.string(),
  bookings: z.array(PortalBookingSwitcherItemSchema),
  booking: z.object({
    booking_id: IdSchema,
    booking_number: z.string(),
    booking_date: DateStringSchema,
    status: BookingStatusSchema,
    project_name: z.string(),
    project_image_url: z.string().nullable(),
    block_name: z.string(),
    flat_number: z.string(),
    floor_label: z.string(),
    flat_type_name: z.string(),
  }),
  construction: z.object({
    percent: z.number(),
    current_stage: z.string().nullable(),
    next_stage: z.string().nullable(),
  }),
  money: z.object({
    cash: PortalBucketCardSchema,
    account: PortalBucketCardSchema,
    total_due_paise: SignedPaiseSchema,
    other_charges_due_paise: SignedPaiseSchema,
  }),
  plan: z.object({ name: z.string(), plan_type: PlanTypeSchema, accepted_on: DateStringSchema.nullable() }),
  next_installment: z
    .object({
      name: z.string(),
      trigger_label: z.string(),
      expected_date: DateStringSchema.nullable(),
      cash_paise: PaiseSchema,
      account_paise: PaiseSchema,
      total_paise: PaiseSchema,
    })
    .nullable(),
  notices_unread: z.int().min(0),
  notifications_unread: z.int().min(0),
  pending_cheques_paise: PaiseSchema,
  relationship_manager: PortalRelationshipManagerSchema.nullable(),
});
export type PortalHomeResponse = z.infer<typeof PortalHomeResponseSchema>;

/** Bank details for Account-bucket transfers. */
export const PortalBankDetailsSchema = z.object({
  bank_name: z.string(),
  branch: z.string().nullable(),
  account_name: z.string(),
  account_number: z.string(),
  ifsc: z.string(),
  note: z.string().nullable(),
});
export type PortalBankDetails = z.infer<typeof PortalBankDetailsSchema>;

// ---------------------------------------------------------------------------
// My flat
// ---------------------------------------------------------------------------

export const PortalMyFlatResponseSchema = z.object({
  booking_id: IdSchema,
  flat_number: z.string(),
  floor_label: z.string(),
  block_name: z.string(),
  project_name: z.string(),
  flat_type_name: z.string(),
  bhk: z.number(),
  facing: z.string().nullable(),
  rooms: z.array(
    z.object({
      label: z.string(),
      room_type: z.string(),
      length_ft: z.number(),
      width_ft: z.number(),
      sqft: z.number(),
    }),
  ),
  areas: z.array(z.object({ name: z.string(), code: z.string(), sqft: z.number() })),
  specifications: z.array(z.object({ category: z.string(), items: z.array(z.string()) })),
  parking: z.array(z.object({ number: z.string(), slot_type: z.string(), level: z.string().nullable() })),
  floor_plan_url: z.string().nullable(),
  price_breakup: z.array(MoneyBreakupLineSchema),
  agreement: z.object({
    agreement_value_paise: PaiseSchema,
    cash_agreed_paise: PaiseSchema,
    account_agreed_paise: PaiseSchema,
    revisions: z.array(
      z.object({
        revised_at: TimestampSchema,
        reason: z.string(),
        before_value_paise: PaiseSchema,
        after_value_paise: PaiseSchema,
        before_cash_paise: PaiseSchema,
        after_cash_paise: PaiseSchema,
        before_account_paise: PaiseSchema,
        after_account_paise: PaiseSchema,
      }),
    ),
  }),
});
export type PortalMyFlatResponse = z.infer<typeof PortalMyFlatResponseSchema>;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** Customer-friendly ledger row. */
export const PortalLedgerRowSchema = z.object({
  seq: z.int(),
  entry_date: DateStringSchema,
  event: LedgerEventSchema,
  label: z.string(),
  bucket: PaymentBucketSchema.nullable(),
  amount_paise: SignedPaiseSchema,
  cash_paid_paise: PaiseSchema,
  account_paid_paise: PaiseSchema,
  cash_due_paise: SignedPaiseSchema,
  account_due_paise: SignedPaiseSchema,
  total_due_paise: SignedPaiseSchema,
  ref_number: z.string().nullable(),
});
export type PortalLedgerRow = z.infer<typeof PortalLedgerRowSchema>;
/**
 * The customer's ledger: rows of the booking's CURRENT epoch only (contract C7; a restated ledger never shows superseded rows) plus the
 * server-computed `summary` of the current book — clients show dues from it, never from the last row of a page.
 */
export const PortalLedgerResponseSchema = listEnvelope(PortalLedgerRowSchema).extend({
  summary: LedgerTotalsSchema.optional(),
});
export type PortalLedgerResponse = z.infer<typeof PortalLedgerResponseSchema>;

export const PortalReceiptRowSchema = z.object({
  payment_id: IdSchema,
  receipt_number: z.string(),
  payment_date: DateStringSchema,
  amount_paise: PaiseSchema,
  bucket: PaymentBucketSchema.nullable(),
  against_label: z.string(),
  mode_name: z.string(),
  instrument_number: z.string().nullable(),
  status: PaymentStatusSchema,
  is_cancelled: z.boolean(),
});
export type PortalReceiptRow = z.infer<typeof PortalReceiptRowSchema>;
export const PortalReceiptListResponseSchema = listEnvelope(PortalReceiptRowSchema);
export type PortalReceiptListResponse = z.infer<typeof PortalReceiptListResponseSchema>;

export const PortalDemandRowSchema = z.object({
  demand_id: IdSchema,
  demand_number: z.string(),
  installment_name: z.string(),
  trigger_label: z.string(),
  demand_date: DateStringSchema,
  due_date: DateStringSchema,
  cash_demand_paise: PaiseSchema,
  account_demand_paise: PaiseSchema,
  total_demand_paise: PaiseSchema,
  paid_paise: PaiseSchema,
  status: DemandStatusSchema,
  is_overdue: z.boolean(),
});
export type PortalDemandRow = z.infer<typeof PortalDemandRowSchema>;
export const PortalDemandListResponseSchema = listEnvelope(PortalDemandRowSchema);
export type PortalDemandListResponse = z.infer<typeof PortalDemandListResponseSchema>;

export const PortalScheduleRowSchema = z.object({
  seq: z.int(),
  name: z.string(),
  percent: z.number(),
  trigger_type: TriggerTypeSchema,
  trigger_label: z.string(),
  expected_date: DateStringSchema.nullable(),
  status: ScheduleStatusSchema,
  cash_paise: PaiseSchema,
  account_paise: PaiseSchema,
  total_paise: PaiseSchema,
  paid_paise: PaiseSchema,
  due_date: DateStringSchema.nullable(),
});
export type PortalScheduleRow = z.infer<typeof PortalScheduleRowSchema>;
export const PortalScheduleResponseSchema = z.object({
  rows: z.array(PortalScheduleRowSchema),
  progress_percent: z.number().min(0).max(100),
  pending_cheques: z.array(PortalReceiptRowSchema),
});
export type PortalScheduleResponse = z.infer<typeof PortalScheduleResponseSchema>;

/** Signed PDF link (receipt / demand letter / statement / allotment letter). */
export const PortalPdfLinkResponseSchema = SignedLinkSchema.extend({ file_name: z.string() });
export type PortalPdfLinkResponse = z.infer<typeof PortalPdfLinkResponseSchema>;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export const PortalStagePhotoSchema = z.object({
  thumb_url: z.string(),
  medium_url: z.string(),
  caption: z.string().nullable(),
  taken_on: DateStringSchema.nullable(),
});
export type PortalStagePhoto = z.infer<typeof PortalStagePhotoSchema>;

export const PortalConstructionStageSchema = z.object({
  name: z.string(),
  status: StageStatusSchema,
  started_on: DateStringSchema.nullable(),
  completed_on: DateStringSchema.nullable(),
  notes: z.string().nullable(),
  is_possession: z.boolean(),
  photos: z.array(PortalStagePhotoSchema),
});
export type PortalConstructionStage = z.infer<typeof PortalConstructionStageSchema>;

/** Only the buyer's own tower; only photos flagged visible to buyers. */
export const PortalConstructionTimelineResponseSchema = z.object({
  block_name: z.string(),
  percent: z.number(),
  current_stage: z.string().nullable(),
  stages: z.array(PortalConstructionStageSchema),
});
export type PortalConstructionTimelineResponse = z.infer<typeof PortalConstructionTimelineResponseSchema>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const PortalDocumentRowSchema = z.object({
  document_id: IdSchema,
  kind: z.enum(["STATEMENT", "ALLOTMENT_LETTER", "SHARED", "PLAN_ACCEPTANCE", "ATTACHMENT"]),
  title: z.string(),
  document_type_name: z.string().nullable(),
  file_name: z.string(),
  mime: z.string(),
  size_bytes: z.int().min(0),
  shared_at: TimestampSchema.nullable(),
});
export type PortalDocumentRow = z.infer<typeof PortalDocumentRowSchema>;
export const PortalDocumentListResponseSchema = z.object({ items: z.array(PortalDocumentRowSchema) });
export type PortalDocumentListResponse = z.infer<typeof PortalDocumentListResponseSchema>;

// ---------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------

/** Customer raises a request (attachments uploaded first). */
export const PortalRequestCreateSchema = z.strictObject({
  booking_id: IdSchema,
  category_id: IdSchema,
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(2000),
  attachment_ids: z.array(IdSchema).max(10).default([]),
});
export type PortalRequestCreate = z.infer<typeof PortalRequestCreateSchema>;

/** Customer reply (never internal). */
export const PortalRequestMessageCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(5000),
  attachment_ids: z.array(IdSchema).max(10).default([]),
});
export type PortalRequestMessageCreate = z.infer<typeof PortalRequestMessageCreateSchema>;

export const PortalRequestReopenSchema = z.strictObject({ reason: ReasonSchema });
export type PortalRequestReopen = z.infer<typeof PortalRequestReopenSchema>;

export const PortalRequestRateSchema = z.strictObject({
  rating: z.int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().nullable(),
});
export type PortalRequestRate = z.infer<typeof PortalRequestRateSchema>;

export const PortalRequestMessageSchema = z.object({
  id: IdSchema,
  author: z.enum(["YOU", "STAFF", "SYSTEM"]),
  author_name: z.string(),
  body: z.string(),
  /** `thumb_url` is the ≈480 px rendition for the thread; `url` is the signed full-size link the photo viewer opens (null only for files the customer may not open). */
  attachments: z.array(
    z.object({
      id: IdSchema,
      file_name: z.string(),
      mime: z.string(),
      thumb_url: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ),
  created_at: TimestampSchema,
});
export type PortalRequestMessage = z.infer<typeof PortalRequestMessageSchema>;

export const PortalRequestRowSchema = z.object({
  id: IdSchema,
  ticket_number: z.string(),
  /** Null when staff raised the request for the customer without a booking. */
  booking_id: IdSchema.nullable(),
  /** Empty when the request has no booking. */
  flat_number: z.string(),
  category_name: z.string(),
  priority: ServicePrioritySchema,
  subject: z.string(),
  description: z.string(),
  status: ServiceStatusSchema,
  can_reopen: z.boolean(),
  can_rate: z.boolean(),
  rating: z.int().min(1).max(5).nullable(),
  last_message_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type PortalRequestRow = z.infer<typeof PortalRequestRowSchema>;
export const PortalRequestDetailResponseSchema = PortalRequestRowSchema.extend({
  messages: z.array(PortalRequestMessageSchema),
});
export type PortalRequestDetailResponse = z.infer<typeof PortalRequestDetailResponseSchema>;
export const PortalRequestFilterSchema = ListQuerySchema.extend({
  booking_id: IdSchema.optional(),
  status: ServiceStatusSchema.optional(),
});
export type PortalRequestFilter = z.infer<typeof PortalRequestFilterSchema>;
export const PortalRequestListResponseSchema = listEnvelope(PortalRequestRowSchema);
export type PortalRequestListResponse = z.infer<typeof PortalRequestListResponseSchema>;

/** A service category the customer may pick when raising a request (`GET /portal/requests/categories`). */
export const PortalRequestCategorySchema = z.object({
  id: IdSchema,
  name: z.string(),
  default_priority: ServicePrioritySchema,
});
export type PortalRequestCategory = z.infer<typeof PortalRequestCategorySchema>;

// ---------------------------------------------------------------------------
// Notices & notifications
// ---------------------------------------------------------------------------

export const PortalNoticeRowSchema = z.object({
  id: IdSchema,
  title: z.string(),
  body_md: z.string(),
  project_name: z.string().nullable(),
  publish_at: TimestampSchema,
  expires_at: TimestampSchema.nullable(),
  is_read: z.boolean(),
});
export type PortalNoticeRow = z.infer<typeof PortalNoticeRowSchema>;
export const PortalNoticeListResponseSchema = listEnvelope(PortalNoticeRowSchema);
export type PortalNoticeListResponse = z.infer<typeof PortalNoticeListResponseSchema>;

export const PortalNotificationRowSchema = z.object({
  id: IdSchema,
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  screen: z.enum(["HOME", "LEDGER", "DEMANDS", "SCHEDULE", "CONSTRUCTION", "REQUEST", "NOTICE", "DOCUMENTS"]),
  entity_id: IdSchema.nullable(),
  /** The booking the bell belongs to (booking bells, and demand / other-charge / payment bells resolved to their booking), so the app
   * can switch the selected booking before opening `screen`; null for company-wide bells (notices, requests without a booking). */
  booking_id: IdSchema.nullable(),
  is_read: z.boolean(),
  created_at: TimestampSchema,
});
export type PortalNotificationRow = z.infer<typeof PortalNotificationRowSchema>;
export const PortalNotificationListResponseSchema = listEnvelope(PortalNotificationRowSchema);
export type PortalNotificationListResponse = z.infer<typeof PortalNotificationListResponseSchema>;

export const PortalMarkReadSchema = z
  .strictObject({ ids: z.array(IdSchema).max(200).optional(), all: z.boolean().default(false) })
  .refine((m) => m.all || (m.ids !== undefined && m.ids.length > 0), {
    message: "Give ids or all=true",
    path: ["ids"],
  });
export type PortalMarkRead = z.infer<typeof PortalMarkReadSchema>;

/** `GET /portal/notifications/unread-count` (Appendix C: `{count}`; excludes withdrawn). */
export const PortalNotificationCountResponseSchema = z.object({ count: z.int().min(0) });
export type PortalNotificationCountResponse = z.infer<typeof PortalNotificationCountResponseSchema>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const PortalProfileResponseSchema = z.object({
  customer_id: IdSchema,
  customer_code: z.string(),
  full_name: z.string(),
  phone: z.string(),
  alt_phone: z.string().nullable(),
  email: z.string().nullable(),
  address_current: AddressSchema.nullable(),
  address_permanent: AddressSchema.nullable(),
  pan_masked: z.string().nullable(),
  aadhaar_masked: z.string().nullable(),
  kyc_status: KycStatusSchema,
  co_applicants: z.array(z.object({ full_name: z.string(), relation: z.string(), phone: z.string().nullable() })),
  relationship_manager: PortalRelationshipManagerSchema.nullable(),
  must_change_password: z.boolean(),
  last_login_at: TimestampSchema.nullable(),
  /** The customer record's version (contract C6): send it back as If-Match "v<version>" on PATCH /portal/profile. */
  version: z.int().min(1),
});
export type PortalProfileResponse = z.infer<typeof PortalProfileResponseSchema>;

/** Buyer edits contact details only (audited). */
export const PortalProfileUpdateSchema = z.strictObject({
  alt_phone: PhoneSchema.optional().nullable(),
  email: EmailSchema.optional().nullable(),
  address_current: AddressSchema.optional().nullable(),
});
export type PortalProfileUpdate = z.infer<typeof PortalProfileUpdateSchema>;
