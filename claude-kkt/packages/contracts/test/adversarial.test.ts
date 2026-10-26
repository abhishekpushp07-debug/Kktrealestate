import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "../src/index.js";
import * as pub from "../src/modules/public.js";
import * as portal from "../src/modules/portal.js";
import {
  ADMIN_RECOMPUTE_FIXTURE,
  U,
  inst,
  plan,
  booking,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// 1. Every enum in docs/DATA-MODEL.md exists with identical values
// ---------------------------------------------------------------------------

const DATA_MODEL_ENUMS: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
  ["password_history.user_type", contracts.USER_TYPES, ["STAFF", "CUSTOMER"]],
  ["audit_logs.actor_type", contracts.ACTOR_TYPES, ["STAFF", "CUSTOMER", "SYSTEM"]],
  ["job_runs.status", contracts.JOB_RUN_STATUSES, ["RUNNING", "OK", "FAILED"]],
  ["payment_plans.plan_type", contracts.PLAN_TYPES, ["CONSTRUCTION_LINKED", "DOWN_PAYMENT", "TIME_LINKED", "FLEXI", "CUSTOM"]],
  ["payment_plan_installments.trigger_type", contracts.TRIGGER_TYPES, ["ON_BOOKING", "DAYS_AFTER_BOOKING", "ON_STAGE", "ON_POSSESSION", "ON_DATE"]],
  ["charge_types.demand_at", contracts.CHARGE_DEMAND_ATS, ["ON_BOOKING", "ON_POSSESSION", "MANUAL"]],
  ["payment_modes.code", contracts.PAYMENT_MODE_CODES, ["CASH", "CHEQUE", "NEFT_RTGS", "UPI", "DD", "LOAN_DISBURSEMENT"]],
  ["document_types.applies_to", contracts.DOCUMENT_APPLIES_TOS, ["CUSTOMER", "BOOKING", "PROJECT", "BLOCK", "FLAT", "PAYMENT"]],
  ["plc_types.calc_mode", contracts.PLC_CALC_MODES, ["PER_SQFT", "FIXED", "PERCENT", "FLOOR_RISE"]],
  ["service_categories.default_priority", contracts.SERVICE_PRIORITIES, ["LOW", "MEDIUM", "HIGH", "URGENT"]],
  ["projects.project_type", contracts.PROJECT_TYPES, ["RESIDENTIAL", "COMMERCIAL", "MIXED"]],
  ["projects.status", contracts.PROJECT_STATUSES, ["PLANNING", "UNDER_CONSTRUCTION", "READY", "COMPLETED"]],
  ["blocks.status", contracts.BLOCK_STATUSES, ["PLANNING", "UNDER_CONSTRUCTION", "READY", "COMPLETED"]],
  ["block_stages.status", contracts.STAGE_STATUSES, ["PENDING", "IN_PROGRESS", "COMPLETED"]],
  ["flats.status", contracts.FLAT_STATUSES, ["AVAILABLE", "HOLD", "BLOCKED", "BOOKED", "SOLD"]],
  ["parking_slots.slot_type", contracts.PARKING_TYPES, ["COVERED", "OPEN", "STILT", "BASEMENT"]],
  ["parking_slots.status", contracts.PARKING_STATUSES, ["AVAILABLE", "ALLOTTED", "BLOCKED"]],
  ["rate_cards.status", contracts.RATE_CARD_STATUSES, ["DRAFT", "ACTIVE", "SUPERSEDED"]],
  ["rate_card_plc_rules.applies_to", contracts.PLC_APPLIES_TOS, ["ALL", "FLOORS_GTE", "CORNER", "FACING_IN"]],
  ["customers.kyc_status", contracts.KYC_STATUSES, ["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"]],
  ["leads.source", contracts.LEAD_SOURCES, ["WALK_IN", "WEBSITE", "BROCHURE", "SITE_VISIT", "REFERRAL", "BROKER", "CAMPAIGN"]],
  ["leads.stage", contracts.LEAD_STAGES, ["NEW", "CONTACTED", "SITE_VISIT_SCHEDULED", "SITE_VISIT_DONE", "NEGOTIATION", "CONVERTED", "LOST"]],
  ["site_visits.status", contracts.VISIT_STATUSES, ["CONFIRMED", "RESCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"]],
  ["site_visits.source", contracts.VISIT_SOURCES, ["WEBSITE", "ERP"]],
  ["bookings.status", contracts.BOOKING_STATUSES, ["ACTIVE", "CANCELLED", "COMPLETED"]],
  ["bookings.plan_acceptance_mode", contracts.PLAN_ACCEPTANCE_MODES, ["IN_PERSON", "SIGNED_COPY", "PORTAL"]],
  ["demands.status", contracts.DEMAND_STATUSES, ["OPEN", "PARTIALLY_PAID", "PAID", "VOID", "CANCELLED"]],
  ["payments.against", contracts.PAYMENT_AGAINSTS, ["FLAT_VALUE", "OTHER_CHARGE"]],
  ["payments.bucket", contracts.PAYMENT_BUCKETS, ["CASH", "ACCOUNT"]],
  ["payments.status", contracts.PAYMENT_STATUSES, ["PENDING", "CLEARED", "BOUNCED", "REVERSED"]],
  [
    "ledger_entries.event",
    contracts.LEDGER_EVENTS,
    ["DEMAND", "PAYMENT", "REVERSAL", "AGREEMENT_CHANGE", "PLAN_CHANGE", "OTHER_CHARGE_DEMAND", "OTHER_CHARGE_PAYMENT", "OTHER_CHARGE_REVERSAL", "CANCELLATION"],
  ],
  ["contra_entries.type", contracts.CONTRA_TYPES, ["DEPOSIT", "WITHDRAWAL"]],
  [
    "documents.entity_type",
    contracts.DOCUMENT_ENTITY_TYPES,
    ["CUSTOMER", "BOOKING", "PROJECT", "BLOCK", "FLAT", "PAYMENT", "STAGE", "CMS", "SERVICE_REQUEST", "COMPANY"],
  ],
  ["service_requests.status", contracts.SERVICE_STATUSES, ["NEW", "IN_PROGRESS", "AWAITING_CUSTOMER", "RESOLVED", "CLOSED"]],
  ["notifications.recipient_type", contracts.NOTIFICATION_RECIPIENT_TYPES, ["STAFF", "CUSTOMER"]],
  ["cms_posts.status", contracts.POST_STATUSES, ["DRAFT", "PUBLISHED"]],
  ["area_types.code examples", contracts.AREA_TYPE_CODES, ["CARPET", "BUILT_UP", "SUPER_BUILT_UP", "BALCONY", "TERRACE", "PARKING"]],
];

describe("DATA-MODEL enums", () => {
  it.each(DATA_MODEL_ENUMS)("%s has identical values", (_name, actual, expected) => {
    expect([...actual]).toEqual([...expected]);
  });
  it("every enum value is UPPER_SNAKE (numbering patterns are text, not an enum)", () => {
    for (const [, values] of DATA_MODEL_ENUMS) for (const v of values) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
    for (const v of contracts.NOTIFICATION_TYPES) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
    for (const v of contracts.LEAD_ACTIVITY_TYPES) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
    for (const v of contracts.INTEGRITY_FINDING_TYPES) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
    for (const v of contracts.REPORT_KEYS) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
  it("slot_minutes CHECK IN (30,60)", () => {
    expect([...contracts.SLOT_MINUTES]).toEqual([30, 60]);
    expect(contracts.SlotMinutesSchema.safeParse(45).success).toBe(false);
    expect(contracts.SlotMinutesSchema.safeParse(30).success).toBe(true);
  });
  it("OPEN_LEAD_STAGES = every stage except CONVERTED and LOST", () => {
    expect([...contracts.OPEN_LEAD_STAGES]).toEqual(contracts.LEAD_STAGES.filter((s) => s !== "CONVERTED" && s !== "LOST"));
  });
  it("sla_hours keys and integrity counts and ageing amounts mirror their enums", () => {
    const sla = contracts.CompanySettingsUpdateSchema.safeParse({
      version: 1,
      settings: { sla_hours: { LOW: 1, MEDIUM: 1, HIGH: 1, URGENT: 1 } },
    });
    expect(sla.success).toBe(true);
    expect(Object.keys(contracts.IntegrityCountsSchema.shape).sort()).toEqual([...contracts.INTEGRITY_FINDING_TYPES].sort());
    expect(Object.keys(contracts.AgeingAmountsSchema.shape).sort()).toEqual([...contracts.AGEING_BUCKETS].sort());
    expect(Object.keys(contracts.StatusCountsSchema.shape).sort()).toEqual([...contracts.FLAT_STATUSES].sort());
  });
  it("payment-mode defaults cover every mode and match the SPEC §11 clearing rule", () => {
    expect(Object.keys(contracts.PAYMENT_MODE_DEFAULTS).sort()).toEqual([...contracts.PAYMENT_MODE_CODES].sort());
    for (const code of contracts.PAYMENT_MODE_CODES) {
      expect(contracts.PAYMENT_MODE_DEFAULTS[code].clears_immediately).toBe(contracts.clearsImmediately(code));
    }
    expect(contracts.clearsImmediately("CHEQUE")).toBe(false);
    expect(contracts.clearsImmediately("DD")).toBe(false);
    expect(contracts.clearsImmediately("CASH")).toBe(true);
    expect(contracts.clearsImmediately("UPI")).toBe(true);
    expect(contracts.clearsImmediately("NEFT_RTGS")).toBe(true);
    expect(contracts.clearsImmediately("LOAN_DISBURSEMENT")).toBe(true);
    expect(contracts.PAYMENT_MODE_DEFAULTS.CASH.is_cash).toBe(true);
    expect(contracts.PAYMENT_MODE_DEFAULTS.CASH.requires_instrument).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. SYSTEM_ROLES match SPEC §1
// ---------------------------------------------------------------------------

describe("SYSTEM_ROLES per SPEC §1", () => {
  const roles = contracts.SYSTEM_ROLES;
  it("has exactly the six system roles in display order and typed names", () => {
    expect([...contracts.SYSTEM_ROLE_NAMES]).toEqual(["Super Admin", "Project Admin", "Accounts", "Sales", "Marketing", "Employee"]);
    expect(Object.keys(roles)).toEqual([...contracts.SYSTEM_ROLE_NAMES]);
    expect(contracts.isSystemRoleName("Sales")).toBe(true);
    expect(contracts.isSystemRoleName("Custom")).toBe(false);
    expect(contracts.SystemRoleNameSchema.safeParse("Accounts").success).toBe(true);
  });
  it("Super Admin has everything", () => {
    expect([...roles["Super Admin"].permissions].sort()).toEqual([...contracts.ALL_PERMISSIONS].sort());
  });
  it("Sales: customers, leads, enquiries, grid, create bookings, visits; no payment.post, no customer.kyc_view", () => {
    const sales = roles.Sales.permissions;
    for (const must of ["customer.read", "customer.write", "lead.read", "lead.write", "project.read", "booking.create", "visit.read", "visit.write"]) {
      expect(sales).toContain(must);
    }
    for (const never of ["payment.post", "payment.clear", "payment.reverse", "customer.kyc_view", "agreement.edit", "users.manage", "roles.manage", "cms.write", "audit.view", "admin.tools", "master.write"]) {
      expect(sales).not.toContain(never);
    }
  });
  it("Accounts: post/clear/reverse payments, receipts, roznamcha, demands, ledgers, reports, audit view", () => {
    const acc = roles.Accounts.permissions;
    for (const must of ["payment.read", "payment.post", "payment.clear", "payment.reverse", "receipt.print", "booking.read", "report.view", "audit.view"]) {
      expect(acc).toContain(must);
    }
    for (const never of ["booking.create", "cms.write", "users.manage", "roles.manage", "construction.update", "block.write", "customer.kyc_view"]) {
      expect(acc).not.toContain(never);
    }
  });
  it("Marketing: cms.* and the enquiries inbox only", () => {
    const mk = roles.Marketing.permissions;
    expect(mk).toContain("cms.read");
    expect(mk).toContain("cms.write");
    expect(mk).toContain("lead.read");
    for (const never of ["lead.write", "payment.read", "payment.post", "booking.read", "booking.create", "customer.read", "customer.kyc_view", "users.manage"]) {
      expect(mk).not.toContain(never);
    }
  });
  it("Project Admin: blocks, flats, construction, bookings view/create, customers, leads, reports; no money posting or admin", () => {
    const pa = roles["Project Admin"].permissions;
    for (const must of ["block.write", "flat.write", "flat.status", "construction.update", "booking.read", "booking.create", "customer.read", "customer.write", "lead.read", "lead.write", "report.view"]) {
      expect(pa).toContain(must);
    }
    for (const never of ["payment.post", "payment.reverse", "agreement.edit", "users.manage", "roles.manage", "cms.write", "customer.kyc_view", "admin.tools", "settings.manage"]) {
      expect(pa).not.toContain(never);
    }
  });
  it("Employee is read-only", () => {
    const emp = roles.Employee.permissions;
    expect(emp.length).toBeGreaterThan(0);
    for (const p of emp) expect(p).toMatch(/\.(read|view)$/);
    expect(emp).toContain("project.read");
    expect(emp).toContain("dashboard.view");
  });
  it("every role's permissions are valid and unique", () => {
    for (const name of contracts.SYSTEM_ROLE_NAMES) {
      const def = roles[name];
      expect(new Set(def.permissions).size).toBe(def.permissions.length);
      expect(contracts.PermissionListSchema.safeParse(def.permissions).success).toBe(true);
    }
  });
  it("hasPermission is exact and PermissionListSchema rejects duplicates and unknown codes", () => {
    expect(contracts.hasPermission(["payment.post"], "payment.post")).toBe(true);
    expect(contracts.hasPermission(["payment.post"], "payment.reverse")).toBe(false);
    expect(contracts.PermissionListSchema.safeParse(["payment.post", "payment.post"]).success).toBe(false);
    expect(contracts.PermissionListSchema.safeParse(["payment.*"]).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Every endpoint family in SPEC has request and response schemas
// ---------------------------------------------------------------------------

const REQUIRED_SCHEMAS: Record<string, readonly string[]> = {
  "auth (Appendix A)": [
    "StaffLoginSchema", "StaffLoginResponseSchema", "StaffLoginSuccessSchema", "StaffMfaLoginSchema", "RefreshTokenSchema", "TokenPairSchema",
    "LogoutSchema", "AuthMeResponseSchema", "AuthUserSchema", "AuthCompanySchema", "ChangePasswordSchema", "SessionRowSchema", "RevokeSessionSchema",
    "MfaSetupResponseSchema", "MfaEnableSchema", "MfaDisableSchema",
  ],
  "users & roles": [
    "UserCreateSchema", "UserUpdateSchema", "UserRowSchema", "UserFilterSchema", "UserListResponseSchema", "UserResetPasswordSchema",
    "UserResetPasswordResponseSchema", "UserUnlockSchema", "UserProjectScopeSchema", "RoleCreateSchema", "RoleUpdateSchema", "RoleRowSchema",
    "RoleListResponseSchema", "PermissionCatalogResponseSchema",
  ],
  "masters (SPEC §3)": [
    "RoomTypeCreateSchema", "RoomTypeRowSchema", "AreaTypeCreateSchema", "AreaTypeRowSchema", "FlatTypeCreateSchema", "FlatTypeUpdateSchema", "FlatTypeRowSchema",
    "BlockTypeCreateSchema", "BlockTypeRowSchema", "FloorPlanTemplateCreateSchema", "FloorPlanTemplateRowSchema", "AmenityCreateSchema", "AmenityRowSchema",
    "ConstructionStageCreateSchema", "ConstructionStageRowSchema", "ConstructionStageReorderSchema", "ChargeTypeCreateSchema", "ChargeTypeRowSchema",
    "PaymentModeCreateSchema", "PaymentModeRowSchema", "BankAccountCreateSchema", "BankAccountRowSchema", "DocumentTypeCreateSchema", "DocumentTypeRowSchema",
    "PlcTypeCreateSchema", "PlcTypeRowSchema", "SpecCategoryCreateSchema", "SpecCategoryRowSchema", "SpecItemCreateSchema", "SpecItemRowSchema",
    "ServiceCategoryCreateSchema", "ServiceCategoryRowSchema", "MasterCsvImportRequestSchema", "MasterCsvImportResponseSchema", "UsageResponseSchema",
    "ActiveStateResponseSchema",
  ],
  "inventory (SPEC §4)": [
    "ProjectCreateSchema", "ProjectUpdateSchema", "ProjectRowSchema", "ProjectFilterSchema", "ProjectListResponseSchema", "ProjectStageSequenceUpdateSchema",
    "BlockCreateSchema", "BlockUpdateSchema", "BlockRowSchema", "BlockListResponseSchema", "BlockGenerateFlatsSchema", "BlockGenerateFlatsResponseSchema",
    "BlockAppendFloorsSchema", "BlockGridQuerySchema", "BlockGridResponseSchema", "BlockPreviewRequestSchema", "BlockPreviewResponseSchema",
    "FlatRowSchema", "FlatFilterSchema", "FlatListResponseSchema", "FlatStatusChangeSchema", "FlatBulkStatusChangeSchema", "FlatPriceUpdateSchema",
    "FlatBulkPriceUpdateSchema", "FlatBulkResponseSchema", "FlatTypeChangeSchema", "FlatDetailResponseSchema",
    "ParkingSlotCreateSchema", "ParkingSlotRowSchema", "ParkingSlotListResponseSchema", "ParkingBulkGenerateSchema", "ParkingStatusChangeSchema",
  ],
  "pricing (SPEC §5)": [
    "RateCardCreateSchema", "RateCardUpdateSchema", "RateCardRowSchema", "RateCardListResponseSchema", "RateCardActivateSchema", "RateCardApplySchema",
    "RateCardApplyResponseSchema", "PricePreviewQuerySchema", "PricePreviewResponseSchema", "PlcRuleSchema",
  ],
  "customers (SPEC §6)": [
    "CustomerCreateSchema", "CustomerUpdateSchema", "CustomerRowSchema", "CustomerRevealedSchema", "CustomerGetQuerySchema", "CustomerFilterSchema",
    "CustomerListResponseSchema", "CustomerKycUpdateSchema", "CustomerDuplicateCheckSchema", "CustomerDuplicateCheckResponseSchema",
    "PortalAccessRequestSchema", "PortalAccessResponseSchema", "PortalBulkEnableSchema", "PortalBulkEnableResponseSchema", "CustomerEraseSchema",
    "Customer360ResponseSchema",
  ],
  "leads (SPEC §7)": [
    "LeadCreateSchema", "LeadUpdateSchema", "LeadRowSchema", "LeadFilterSchema", "LeadListResponseSchema", "LeadStageChangeSchema", "LeadFollowUpCreateSchema",
    "LeadAssignSchema", "LeadConvertSchema", "LeadConvertResponseSchema", "LeadDetailResponseSchema", "LeadKanbanResponseSchema", "EnquiryRowSchema",
    "EnquiryListResponseSchema", "EnquiryMarkReadSchema", "EnquiryUnreadCountSchema",
  ],
  "payment plans (SPEC §8)": [
    "PaymentPlanCreateSchema", "PaymentPlanUpdateSchema", "PaymentPlanRowSchema", "PaymentPlanListResponseSchema", "InstallmentInputSchema",
    "PlanAssignmentCreateSchema", "PlanAssignmentUpdateSchema", "PlanAssignmentRowSchema", "PlanAssignmentListResponseSchema",
    "ApplicablePlansQuerySchema", "ApplicablePlansResponseSchema", "SchedulePreviewRequestSchema", "SchedulePreviewResponseSchema", "PlanSnapshotSchema",
  ],
  "construction (SPEC §9)": [
    "BlockConstructionResponseSchema", "ConstructionStatusUpdateSchema", "ConstructionStatusUpdateResponseSchema", "ConstructionJumpPreviewQuerySchema",
    "ConstructionJumpPreviewResponseSchema", "ConstructionInProgressSchema", "ConstructionUndoSchema", "ConstructionUndoResponseSchema", "UndoBlockedDetailsSchema",
    "StagePhotoCreateSchema", "StagePhotoUpdateSchema", "StagePhotoRowSchema",
  ],
  "dues & integrity (SPEC §10)": [
    "RunDuesRequestSchema", "RunDuesResponseSchema", "IntegrityRunRequestSchema", "IntegrityReportResponseSchema", "IntegrityRepairRequestSchema",
    "IntegrityRepairResponseSchema", "IntegrityRunListResponseSchema",
  ],
  "payments & ledger (SPEC §11)": [
    "PaymentCreateSchema", "PaymentRowSchema", "PaymentFilterSchema", "PaymentListResponseSchema", "PaymentClearSchema", "PaymentBounceSchema",
    "PaymentReverseSchema", "PaymentPostResponseSchema", "ReceiptDataSchema", "DemandLetterDataSchema", "ContraEntryCreateSchema", "ContraEntryRowSchema",
    "ContraEntryListResponseSchema", "RoznamchaQuerySchema", "RoznamchaResponseSchema", "ChequeRowSchema", "ChequeListResponseSchema",
    "LedgerRowSchema", "LedgerListResponseSchema", "DemandRowSchema", "DemandFilterSchema", "DemandListResponseSchema", "BucketCapDetailsSchema",
  ],
  "bookings (SPEC §12)": [
    "BookingCreateSchema", "BookingDraftUpsertSchema", "BookingDraftRowSchema", "BookingRowSchema", "BookingFilterSchema", "BookingListResponseSchema",
    "BookingDetailResponseSchema", "AgreementRevisionCreateSchema", "AgreementRevisionRowSchema", "BookingCancelSchema", "BookingCompleteSchema",
    "BookingPlanChangeSchema", "PlanRevisionRowSchema", "BookingUpdateSchema", "ScheduleResponseSchema", "OtherChargeRowSchema", "OtherChargeAddSchema",
    "OtherChargeDemandNowSchema", "FlatNotAvailableDetailsSchema",
  ],
  "documents, service, notifications (SPEC §13)": [
    "DocumentUploadMetaSchema", "DocumentRowSchema", "DocumentUpdateSchema", "DocumentFilterSchema", "DocumentListResponseSchema",
    "DocumentDownloadLinkResponseSchema", "DocumentUploadResponseSchema", "ServiceRequestCreateSchema", "ServiceMessageCreateSchema", "ServiceAssignSchema",
    "ServiceStatusChangeSchema", "ServicePriorityChangeSchema", "ServiceRatingSchema", "ServiceReopenSchema", "ServiceRequestRowSchema",
    "ServiceRequestDetailResponseSchema", "ServiceFilterSchema", "ServiceListResponseSchema", "ServiceKanbanResponseSchema",
    "NotificationRowSchema", "NotificationFilterSchema", "NotificationListResponseSchema", "NotificationMarkReadSchema", "NotificationCountResponseSchema",
  ],
  "reports & dashboards (SPEC §14)": [
    "CollectionsReportQuerySchema", "CollectionsReportResponseSchema", "OutstandingReportQuerySchema", "OutstandingReportResponseSchema",
    "AdvancesReportQuerySchema", "AdvancesReportResponseSchema", "DemandVsCollectionQuerySchema", "DemandVsCollectionResponseSchema",
    "UpcomingDuesQuerySchema", "UpcomingDuesResponseSchema", "InventoryReportQuerySchema", "InventoryReportResponseSchema", "BookingDocumentQuerySchema",
    "CustomerStatementResponseSchema", "AllotmentLetterDataSchema", "ChequesReportQuerySchema", "ChequesReportResponseSchema",
    "CancellationsReportQuerySchema", "CancellationsReportResponseSchema", "SalesFunnelQuerySchema", "SalesFunnelResponseSchema",
    "BankwiseReceiptsQuerySchema", "BankwiseReceiptsResponseSchema", "ActivityReportQuerySchema", "ActivityReportResponseSchema",
    "ReportPresetCreateSchema", "ReportPresetRowSchema", "DashboardQuerySchema", "DashboardResponseSchema", "SearchQuerySchema", "SearchResponseSchema",
  ],
  "CMS (SPEC §15)": [
    "SiteSettingsUpdateSchema", "SiteSettingsRowSchema", "CmsBannerCreateSchema", "CmsBannerUpdateSchema", "CmsBannerRowSchema",
    "CmsHomeSectionCreateSchema", "CmsHomeSectionRowSchema", "CmsTestimonialCreateSchema", "CmsTestimonialRowSchema", "CmsGalleryCreateSchema",
    "CmsGalleryRowSchema", "CmsPostCreateSchema", "CmsPostUpdateSchema", "CmsPostRowSchema", "CmsPostListResponseSchema", "CmsPageCreateSchema",
    "CmsPageRowSchema", "CmsPersonCreateSchema", "CmsPersonRowSchema", "NoticeCreateSchema", "NoticeUpdateSchema", "NoticeRowSchema", "NoticeListResponseSchema",
    "ProjectWebsiteSettingsUpdateSchema", "ProjectWebsitePublishSchema", "ProjectWebsiteSettingsRowSchema",
  ],
  "public website API (Appendix B)": [
    "PublicSiteSettingsSchema", "PublicSiteResponseSchema", "PublicProjectsQuerySchema", "PublicProjectCardSchema", "PublicProjectDetailSchema",
    "PublicAvailabilityGridSchema", "PublicVisitAvailabilityQuerySchema", "PublicVisitAvailabilityResponseSchema", "PublicListQuerySchema",
    "PublicPostCardSchema", "PublicPostDetailSchema", "PublicPageSchema", "PublicGalleryItemSchema", "PublicPersonSchema", "PublicMediaQuerySchema",
    "PublicSitemapResponseSchema", "PublicEnquiryInputSchema", "PublicEnquiryResponseSchema", "PublicBrochureRequestSchema", "PublicBrochureResponseSchema",
    "PublicBrochureRepeatRequestSchema", "PublicVisitBookingInputSchema", "PublicVisitBookingResponseSchema", "PublicVisitManageResponseSchema",
    "PublicVisitCancelInputSchema", "PublicVisitCancelResponseSchema", "PublicHomeResponseSchema",
  ],
  "site visits ERP (SPEC §15)": [
    "VisitSettingsSchema", "VisitSettingsUpdateSchema", "VisitSettingsRowSchema", "VisitRowSchema", "VisitFilterSchema", "VisitListResponseSchema",
    "VisitCreateSchema", "VisitRescheduleSchema", "VisitCancelSchema", "VisitOutcomeUpdateSchema", "VisitUpdateSchema", "VisitCalendarQuerySchema",
    "VisitCalendarResponseSchema", "VisitAvailabilityQuerySchema", "VisitAvailabilityResponseSchema",
  ],
  "portal (SPEC §16)": [
    "PortalLoginSchema", "PortalLoginResponseSchema", "PortalChangePasswordSchema", "PortalRefreshSchema", "PortalSessionRowSchema", "PortalHomeResponseSchema",
    "PortalBankDetailsSchema", "PortalMyFlatResponseSchema", "PortalLedgerResponseSchema", "PortalReceiptListResponseSchema", "PortalDemandListResponseSchema",
    "PortalScheduleResponseSchema", "PortalPdfLinkResponseSchema", "PortalConstructionTimelineResponseSchema", "PortalDocumentListResponseSchema",
    "PortalRequestCreateSchema", "PortalRequestMessageCreateSchema", "PortalRequestReopenSchema", "PortalRequestRateSchema", "PortalRequestDetailResponseSchema",
    "PortalRequestListResponseSchema", "PortalNoticeListResponseSchema", "PortalNotificationListResponseSchema", "PortalMarkReadSchema",
    "PortalProfileResponseSchema", "PortalProfileUpdateSchema",
  ],
  "admin (SPEC §2, §10, §17)": [
    "AdminBackupResponseSchema", "AdminReseedRequestSchema", "AdminReseedResponseSchema", "AdminRecomputeRequestSchema", "AdminRecomputeResponseSchema",
    "AdminJobTriggerSchema", "AdminJobRunListResponseSchema", "AdminErasureRequestSchema", "AuditLogRowSchema", "AuditLogFilterSchema",
    "AuditLogListResponseSchema", "CompanySettingsUpdateSchema", "CompanySettingsRowSchema", "HealthResponseSchema", "ApiErrorSchema",
  ],
};

describe("endpoint families have schemas", () => {
  const exported = contracts as Record<string, unknown>;
  for (const [family, names] of Object.entries(REQUIRED_SCHEMAS)) {
    it(`${family}: ${names.length} schemas exported as Zod types`, () => {
      for (const name of names) {
        expect(exported[name], name).toBeInstanceOf(z.ZodType);
      }
    });
  }
  it("exports every documented scalar", () => {
    for (const name of ["IdSchema", "PaiseSchema", "PositivePaiseSchema", "SignedPaiseSchema", "PercentSchema", "DateStringSchema", "TimestampSchema", "PhoneSchema", "PANSchema", "AadhaarSchema", "IFSCSchema", "IdempotencyKeySchema", "ListQuerySchema"]) {
      expect(exported[name], name).toBeInstanceOf(z.ZodType);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Error codes vs API-CONVENTIONS status map
// ---------------------------------------------------------------------------

describe("error status map (API-CONVENTIONS)", () => {
  const expected: Record<string, number> = {
    VALIDATION_ERROR: 400,
    IDEMPOTENCY_KEY_REQUIRED: 400,
    UNAUTHENTICATED: 401,
    TOKEN_EXPIRED: 401,
    INVALID_AUDIENCE: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    VERSION_CONFLICT: 409,
    FLAT_NOT_AVAILABLE: 409,
    BUCKET_CAP_EXCEEDED: 409,
    IN_USE: 409,
    SLOT_FULL: 409,
    PLAN_STAGES_MISSING: 409,
    UNDO_BLOCKED: 409,
    PAYLOAD_TOO_LARGE: 413,
    BUSINESS_RULE: 422,
    IDEMPOTENCY_MISMATCH: 422,
    LOCKED: 423,
    RATE_LIMITED: 429,
  };
  it.each(Object.entries(expected))("%s → %i", (code, status) => {
    expect(contracts.ERROR_CODES).toContain(code);
    expect(contracts.statusForError(contracts.ErrorCodeSchema.parse(code))).toBe(status);
  });
  it("details schemas carry the documented keys", () => {
    expect(contracts.VersionConflictDetailsSchema.safeParse({ current: 3, changed_by: "Asha" }).success).toBe(true);
    expect(contracts.InUseDetailsSchema.safeParse({ usage_count: 4 }).success).toBe(true);
    expect(contracts.PlanStagesMissingDetailsSchema.safeParse({ missing_stages: ["Plinth"] }).success).toBe(true);
    expect(contracts.BusinessRuleDetailsSchema.safeParse({ rule: "handover" }).success).toBe(true);
    expect(contracts.BusinessRuleDetailsSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Percent refinements: 99.99 and 100.01 must be rejected
// ---------------------------------------------------------------------------

describe("installment percent refinements", () => {
  it("rejects 99.99 and 100.01 totals, accepts 100.00 in many shapes", () => {
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 10, "ON_BOOKING"), inst(2, 89.99)])).success).toBe(false);
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 10, "ON_BOOKING"), inst(2, 90.01)])).success).toBe(false);
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 10, "ON_BOOKING"), inst(2, 90)])).success).toBe(true);
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 0.01, "ON_BOOKING"), inst(2, 99.99)])).success).toBe(true);
    const hundred = Array.from({ length: 100 }, (_, i) => inst(i + 1, 1, i === 0 ? "ON_BOOKING" : "ON_STAGE"));
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan(hundred)).success).toBe(true);
    const r = contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 10, "ON_BOOKING"), inst(2, 89.99)]));
    expect(r.error?.issues.map((i) => i.message).join(" ")).toContain("99.99");
  });
  it("float-prone decimals do not drift (0.1 + 0.2 style)", () => {
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 0.1, "ON_BOOKING"), inst(2, 0.2), inst(3, 99.7)])).success).toBe(true);
    expect(contracts.PaymentPlanCreateSchema.safeParse(plan([inst(1, 33.33, "ON_BOOKING"), inst(2, 33.33), inst(3, 33.33)])).success).toBe(false);
    expect(contracts.sumPercentBasisPoints([{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.34 }])).toBe(10_000);
  });
  it("rejects an installment of 0 %, more than 100 % or three decimals", () => {
    expect(contracts.InstallmentInputSchema.safeParse(inst(1, 0, "ON_BOOKING")).success).toBe(false);
    expect(contracts.InstallmentInputSchema.safeParse(inst(1, 100.01, "ON_BOOKING")).success).toBe(false);
    expect(contracts.InstallmentInputSchema.safeParse(inst(1, 12.345, "ON_BOOKING")).success).toBe(false);
    expect(contracts.InstallmentInputSchema.safeParse(inst(1, 100, "ON_BOOKING")).success).toBe(true);
  });
  it("the Flexi 10:40:50 and Down Payment 10:85:5 seed plans validate", () => {
    const flexi = plan([inst(1, 10, "ON_BOOKING"), inst(2, 40, "DAYS_AFTER_BOOKING"), inst(3, 10), inst(4, 10), inst(5, 10), inst(6, 10), inst(7, 10, "ON_POSSESSION")]);
    expect(contracts.PaymentPlanCreateSchema.safeParse(flexi).success).toBe(true);
    const dp = plan([inst(1, 10, "ON_BOOKING"), inst(2, 85, "DAYS_AFTER_BOOKING"), inst(3, 5, "ON_POSSESSION")]);
    expect(contracts.PaymentPlanCreateSchema.safeParse(dp).success).toBe(true);
  });
  it("plan assignment effective dates must be ordered", () => {
    const a = { plan_id: U(1), project_id: U(2), block_id: U(3), effective_from: "2026-04-01", effective_to: "2026-03-31" };
    expect(contracts.PlanAssignmentCreateSchema.safeParse(a).success).toBe(false);
    expect(contracts.PlanAssignmentCreateSchema.safeParse({ ...a, effective_to: "2026-04-01" }).success).toBe(true);
    expect(contracts.PlanAssignmentCreateSchema.safeParse({ plan_id: U(1), project_id: U(2) }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Booking split refinements
// ---------------------------------------------------------------------------

describe("booking split", () => {
  it("rejects a split one paise short or one paise over, accepts single-bucket splits", () => {
    expect(contracts.BookingCreateSchema.safeParse(booking({ agreement_value_paise: 10_000, cash_agreed_paise: 6_000, account_agreed_paise: 3_999 })).success).toBe(false);
    expect(contracts.BookingCreateSchema.safeParse(booking({ agreement_value_paise: 10_000, cash_agreed_paise: 6_000, account_agreed_paise: 4_001 })).success).toBe(false);
    expect(contracts.BookingCreateSchema.safeParse(booking({ agreement_value_paise: 10_000, cash_agreed_paise: 10_000, account_agreed_paise: 0 })).success).toBe(true);
    expect(contracts.BookingCreateSchema.safeParse(booking({ agreement_value_paise: 10_000, cash_agreed_paise: 0, account_agreed_paise: 10_000 })).success).toBe(true);
  });
  it("rejects fractional paise, negative buckets and the worked example sums exactly", () => {
    expect(contracts.BookingCreateSchema.safeParse(booking({ agreement_value_paise: 100.5, cash_agreed_paise: 60.5, account_agreed_paise: 40 })).success).toBe(false);
    expect(contracts.BookingCreateSchema.safeParse(booking({ agreement_value_paise: 100, cash_agreed_paise: 120, account_agreed_paise: -20 })).success).toBe(false);
    const worked = booking({ agreement_value_paise: 1_00_00_000_00, cash_agreed_paise: 60_00_000_00, account_agreed_paise: 40_00_000_00 });
    expect(contracts.BookingCreateSchema.safeParse(worked).success).toBe(true);
  });
  it("plan acceptance date cannot precede the booking date; duplicate parking rejected", () => {
    expect(contracts.BookingCreateSchema.safeParse(booking({ plan_accepted_on: "2026-03-31" })).success).toBe(false);
    expect(contracts.BookingCreateSchema.safeParse(booking({ parking_slot_ids: [U(6), U(6)] })).success).toBe(false);
  });
  it("agreement revision applies the same split rule", () => {
    const base = { version: 1, agreement_value_paise: 10_000, cash_agreed_paise: 6_000, account_agreed_paise: 4_000, reason: "Loan sanctioned" };
    expect(contracts.AgreementRevisionCreateSchema.safeParse(base).success).toBe(true);
    expect(contracts.AgreementRevisionCreateSchema.safeParse({ ...base, account_agreed_paise: 3_999 }).success).toBe(false);
    expect(contracts.AgreementRevisionCreateSchema.safeParse({ ...base, account_agreed_paise: 4_001 }).success).toBe(false);
    expect(contracts.AgreementRevisionCreateSchema.safeParse({ ...base, agreement_value_paise: 0, cash_agreed_paise: 0, account_agreed_paise: 0 }).success).toBe(false);
  });
  it("other-charge lines accept 0..100 GST with two decimals", () => {
    expect(contracts.OtherChargeInputSchema.safeParse({ charge_type_id: U(1), amount_paise: 100, gst_percent: 18.5, demand_at: "ON_BOOKING" }).success).toBe(true);
    expect(contracts.OtherChargeInputSchema.safeParse({ charge_type_id: U(1), amount_paise: 100, gst_percent: 100.01, demand_at: "ON_BOOKING" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Public & portal schemas never expose internal ids, costs, storage keys
// ---------------------------------------------------------------------------

type Visit = (key: string, path: string, schema: z.ZodType) => void;

/** Walks a Zod schema tree and reports every object key with its path. */
function walk(schema: z.ZodType, path: string, visit: Visit): void {
  if (schema instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      visit(key, `${path}.${key}`, child);
      walk(child, `${path}.${key}`, visit);
    }
  } else if (schema instanceof z.ZodArray) {
    walk(schema.element as z.ZodType, `${path}[]`, visit);
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    walk(schema.unwrap() as z.ZodType, path, visit);
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options as readonly z.ZodType[]) walk(option, path, visit);
  } else if (schema instanceof z.ZodRecord) {
    walk(schema.valueType as z.ZodType, `${path}{}`, visit);
  } else if (schema instanceof z.ZodPipe) {
    walk(schema.in as z.ZodType, path, visit);
    walk(schema.out as z.ZodType, path, visit);
  }
}

function zodExports(mod: object): Array<[string, z.ZodType]> {
  return Object.entries(mod).filter((e): e is [string, z.ZodType] => e[1] instanceof z.ZodType);
}

describe("public API allow-list", () => {
  const forbiddenKey = /(^id$)|(_id$)|(_ids$)|storage|_key$|_keys$|cost|password|_hash$|_enc$|company_id|user_id|customer_id|actor|created_by/i;
  /** `analytics.ga_id` is the public Google Analytics measurement id, allow-listed by Appendix B. */
  const allowedPublicKeys = new Set(["analytics.ga_id"]);
  it("no public response schema carries internal ids of users/customers, costs or storage keys", () => {
    const offenders: string[] = [];
    for (const [name, schema] of zodExports(pub)) {
      walk(schema, name, (key, path) => {
        const relative = path.slice(name.length + 1);
        if (forbiddenKey.test(key) && !allowedPublicKeys.has(relative)) offenders.push(path);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("no public schema distinguishes Hold/Booked/Blocked — only AVAILABLE | NOT_AVAILABLE", () => {
    const offenders: string[] = [];
    for (const [name, schema] of zodExports(pub)) {
      walk(schema, name, (_key, path, child) => {
        if (child instanceof z.ZodEnum) {
          const options = Object.values(child.enum as Record<string, string>);
          if (options.includes("HOLD") || options.includes("BOOKED") || options.includes("BLOCKED")) offenders.push(path);
        }
      });
    }
    expect(offenders).toEqual([]);
    expect(contracts.PublicAvailabilitySchema.options).toEqual(["AVAILABLE", "NOT_AVAILABLE"]);
  });
  it("public card and detail follow Appendix B", () => {
    const card = Object.keys(contracts.PublicProjectCardSchema.shape);
    for (const k of ["slug", "name", "city", "status", "project_type", "starting_price_paise", "hero_image_url", "bhk_options", "possession_date", "rera_number"]) {
      expect(card).toContain(k);
    }
    const detail = Object.keys(contracts.PublicProjectDetailSchema.shape);
    for (const k of ["availability", "construction", "brochure_available", "visit_booking_enabled", "faqs", "seo", "video_urls", "tour_urls", "landmarks", "approvals", "amenities", "configurations"]) {
      expect(detail).toContain(k);
    }
    const site = Object.keys(contracts.PublicSiteResponseSchema.shape);
    for (const k of ["brand", "contacts", "offices", "social", "trust_stats", "value_props", "disclaimer", "seo_defaults", "analytics", "site_live", "coming_soon_message", "portal_url", "featured_projects", "walkthrough_video_url", "banners", "home_sections", "testimonials", "latest_posts"]) {
      expect(site).toContain(k);
    }
    const q = contracts.PublicProjectsQuerySchema.parse({ city: "Patna", status: "READY", bhk: "3", q: "heights" });
    expect(q).toEqual({ city: "Patna", status: "READY", bhk: 3, q: "heights" });
    expect(contracts.PublicMediaQuerySchema.safeParse({ variant: "thumb" }).success).toBe(true);
    expect(contracts.PublicMediaQuerySchema.safeParse({ variant: "original" }).success).toBe(false);
  });
  it("public form inputs are strict, honeypot-guarded and consent-gated", () => {
    for (const schema of [contracts.PublicEnquiryInputSchema, contracts.PublicBrochureRequestSchema, contracts.PublicVisitBookingInputSchema]) {
      expect(Object.keys(schema.shape)).toContain("website");
      expect(Object.keys(schema.shape)).toContain("consent");
    }
    expect(contracts.PublicVisitCancelInputSchema.safeParse({ website: "spam" }).success).toBe(false);
    expect(contracts.PublicBrochureRepeatRequestSchema.safeParse({ project_slug: "x", visitor_token: "short" }).success).toBe(false);
  });
  it("visit availability only returns slots with available ≥ 1 and IST timezone", () => {
    expect(contracts.PublicVisitSlotSchema.safeParse({ start: "10:00", end: "11:00", available: 0 }).success).toBe(false);
    expect(contracts.PublicVisitAvailabilityResponseSchema.shape.timezone.safeParse("Asia/Kolkata").success).toBe(true);
    expect(contracts.PublicVisitAvailabilityResponseSchema.shape.timezone.safeParse("UTC").success).toBe(false);
  });
});

describe("portal schemas", () => {
  const forbiddenKey = /user_id|actor_id|author_id|storage|_key$|_hash$|_enc$|^pan$|^aadhaar$|account_enc|company_id|created_by|received_by|assignee/i;
  it("never expose staff ids, storage keys or unmasked KYC", () => {
    const offenders: string[] = [];
    for (const [name, schema] of zodExports(portal)) {
      walk(schema, name, (key, path) => {
        if (forbiddenKey.test(key)) offenders.push(path);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("customer-facing messages carry no is_internal flag and author is a role, not an id", () => {
    expect(Object.keys(contracts.PortalRequestMessageSchema.shape)).not.toContain("is_internal");
    expect(Object.keys(contracts.PortalRequestMessageSchema.shape)).not.toContain("author_id");
    expect(contracts.PortalRequestMessageSchema.shape.author.options).toEqual(["YOU", "STAFF", "SYSTEM"]);
  });
  it("profile KYC is masked and typed; mark-read needs ids or all", () => {
    expect(Object.keys(contracts.PortalProfileResponseSchema.shape)).toEqual(expect.arrayContaining(["pan_masked", "aadhaar_masked", "kyc_status"]));
    expect(contracts.PortalProfileResponseSchema.shape.kyc_status.safeParse("VERIFIED").success).toBe(true);
    expect(contracts.PortalProfileResponseSchema.shape.kyc_status.safeParse("verified").success).toBe(false);
    expect(contracts.PortalMarkReadSchema.safeParse({}).success).toBe(false);
    expect(contracts.PortalMarkReadSchema.safeParse({ all: true }).success).toBe(true);
    expect(contracts.PortalMarkReadSchema.safeParse({ ids: [U(1)] }).success).toBe(true);
  });
  it("portal profile update only allows contact details", () => {
    expect(Object.keys(contracts.PortalProfileUpdateSchema.shape).sort()).toEqual(["address_current", "alt_phone", "email"]);
    expect(contracts.PortalProfileUpdateSchema.safeParse({ pan: "ABCDE1234F" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Query-string coercion on every list filter that takes booleans
// ---------------------------------------------------------------------------

describe("query-string boolean filters coerce", () => {
  it("roles / visits / integrity-run filters accept 'true' / '1' / 'false'", () => {
    expect(contracts.RoleFilterSchema.parse({ is_system: "true" }).is_system).toBe(true);
    expect(contracts.VisitFilterSchema.parse({ needs_outcome: "1" }).needs_outcome).toBe(true);
    expect(contracts.IntegrityRunFilterSchema.parse({ ok: "false" }).ok).toBe(false);
    expect(contracts.CustomerGetQuerySchema.parse({ reveal: "true" }).reveal).toBe(true);
    expect(contracts.CustomerGetQuerySchema.parse({}).reveal).toBe(false);
  });
  it("every exported *FilterSchema has no raw z.boolean() field (query strings are strings)", () => {
    const offenders: string[] = [];
    for (const [name, schema] of zodExports(contracts)) {
      if (!name.endsWith("FilterSchema") || !(schema instanceof z.ZodObject)) continue;
      for (const [key, child] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
        let inner: z.ZodType = child;
        while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault || inner instanceof z.ZodNullable) inner = inner.unwrap() as z.ZodType;
        if (inner instanceof z.ZodBoolean) offenders.push(`${name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Auth per API-CONVENTIONS Appendix A
// ---------------------------------------------------------------------------

describe("auth contracts (Appendix A)", () => {
  it("MFA step two takes mfa_token + 6-digit code", () => {
    expect(contracts.StaffMfaLoginSchema.safeParse({ mfa_token: "x".repeat(32), code: "123456" }).success).toBe(true);
    expect(contracts.StaffMfaLoginSchema.safeParse({ mfa_token: "x".repeat(32), code: "12345" }).success).toBe(false);
    expect(contracts.StaffMfaLoginSchema.safeParse({ mfa_token: "short", code: "123456" }).success).toBe(false);
  });
  it("login success mirrors must_change_password at top level and /auth/me returns user + company", () => {
    expect(Object.keys(contracts.StaffLoginSuccessSchema.shape)).toEqual(expect.arrayContaining(["access_token", "refresh_token", "expires_in", "user", "must_change_password"]));
    expect(Object.keys(contracts.AuthMeResponseSchema.shape)).toEqual(["user", "company"]);
    expect(Object.keys(contracts.AuthUserSchema.shape)).toEqual(expect.arrayContaining(["id", "name", "email", "permissions", "all_projects", "project_ids", "must_change_password", "mfa_enabled"]));
    expect(Object.keys(contracts.AuthCompanySchema.shape)).toEqual(expect.arrayContaining(["id", "name", "settings"]));
  });
  it("token audiences are exactly erp and portal; claims carry aud", () => {
    expect([...contracts.TOKEN_AUDIENCES]).toEqual(["erp", "portal"]);
    expect(contracts.AccessTokenClaimsSchema.safeParse({ sub: U(1), aud: "erp", company_id: U(2), subject_type: "STAFF", jti: "j", iat: 1, exp: 2 }).success).toBe(true);
    expect(contracts.AccessTokenClaimsSchema.safeParse({ sub: U(1), aud: "web", company_id: U(2), subject_type: "STAFF", jti: "j", iat: 1, exp: 2 }).success).toBe(false);
  });
  it("password policy constants match ARCHITECTURE §5", () => {
    expect(contracts.PASSWORD_POLICY).toMatchObject({ min_length: 10, history_count: 5, lockout_attempts: 5, lockout_minutes: 15 });
    expect(contracts.PasswordSchema.safeParse("Abcdefghi1").success).toBe(true);
    expect(contracts.PasswordSchema.safeParse("abcdefghi1").success).toBe(false);
    expect(contracts.PasswordSchema.safeParse("Abcdefgh1").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Fixed defects: typed statuses, null permanent address, recompute scope, rooms
// ---------------------------------------------------------------------------

describe("fixed defects", () => {
  it("customer with same_as_current=false and address_permanent=null is rejected", () => {
    expect(contracts.CustomerCreateSchema.safeParse({ full_name: "A B", phone: "9876543210", same_as_current: false, address_permanent: null }).success).toBe(false);
    const ok = contracts.CustomerCreateSchema.safeParse({
      full_name: "A B",
      phone: "9876543210",
      same_as_current: false,
      address_permanent: { line1: "1 MG Road", city: "Patna", state: "Bihar", pincode: "800001" },
    });
    expect(ok.success).toBe(true);
  });
  it("status fields are enums, not free strings", () => {
    expect(contracts.FlatNotAvailableDetailsSchema.shape.current_status.safeParse("BOOKED").success).toBe(true);
    expect(contracts.FlatNotAvailableDetailsSchema.shape.current_status.safeParse("taken").success).toBe(false);
    expect(contracts.ActivityReportRowSchema.shape.actor_type.safeParse("SYSTEM").success).toBe(true);
    expect(contracts.ActivityReportRowSchema.shape.actor_type.safeParse("robot").success).toBe(false);
    expect(contracts.ApprovalStatusSchema.options).toEqual(["APPLIED", "RECEIVED", "NA"]);
    expect(contracts.BookingFullRowSchema.shape.parking_slots.element.shape.slot_type.safeParse("COVERED").success).toBe(true);
    expect(contracts.BookingFullRowSchema.shape.parking_slots.element.shape.slot_type.safeParse("Garage").success).toBe(false);
  });
  it("admin recompute needs a scope", () => {
    expect(contracts.AdminRecomputeRequestSchema.safeParse({}).success).toBe(false);
    expect(contracts.AdminRecomputeRequestSchema.safeParse({ all: true }).success).toBe(true);
    expect(contracts.AdminRecomputeRequestSchema.safeParse(ADMIN_RECOMPUTE_FIXTURE).success).toBe(true);
  });
  it("flat-type rooms need positive dimensions and base rate XOR lump sum", () => {
    const room = { room_type_id: U(1), label: "Master Bedroom", length_ft: 0, width_ft: 12 };
    expect(contracts.FlatTypeRoomSchema.safeParse(room).success).toBe(false);
    expect(contracts.FlatTypeRoomSchema.safeParse({ ...room, length_ft: 14 }).success).toBe(true);
    const ft = {
      name: "3BHK-A",
      code: "3BHK_A",
      bhk: 3,
      rooms: [{ ...room, length_ft: 14 }],
      areas: [{ area_type_id: U(2), sqft: 1200 }],
      base_rate_per_sqft_paise: 4500_00,
      base_price_paise: 50_00_000_00,
    };
    expect(contracts.FlatTypeCreateSchema.safeParse(ft).success).toBe(false);
    expect(contracts.FlatTypeCreateSchema.safeParse({ ...ft, base_price_paise: null }).success).toBe(true);
    expect(contracts.FlatTypeCreateSchema.safeParse({ ...ft, bhk: 2.5, base_price_paise: null }).success).toBe(true);
    expect(contracts.FlatTypeCreateSchema.safeParse({ ...ft, bhk: 2.3, base_price_paise: null }).success).toBe(false);
  });
  it("RunDuesRequest as_of is a real business date", () => {
    expect(contracts.RunDuesRequestSchema.safeParse({ as_of: "2026-02-30" }).success).toBe(false);
    expect(contracts.RunDuesRequestSchema.safeParse({ as_of: "2026-02-28" }).success).toBe(true);
    expect(contracts.RunDuesRequestSchema.safeParse({}).success).toBe(true);
  });
  it("dashboard union roles equal DASHBOARD_ROLES", () => {
    const roles = contracts.DashboardResponseSchema.options.map((o) => o.shape.role.value);
    expect([...roles].sort()).toEqual([...contracts.DASHBOARD_ROLES].sort());
  });
  it("money scalars reject unsafe magnitudes and decimals everywhere", () => {
    expect(contracts.PositivePaiseSchema.safeParse(0).success).toBe(false);
    expect(contracts.PositivePaiseSchema.safeParse(1).success).toBe(true);
    expect(contracts.SignedPaiseSchema.safeParse(Number.MIN_SAFE_INTEGER - 2).success).toBe(false);
    expect(contracts.PaiseSchema.safeParse(2 ** 53).success).toBe(false);
    expect(contracts.PaiseSchema.safeParse(2 ** 53 - 1).success).toBe(true);
  });
});
