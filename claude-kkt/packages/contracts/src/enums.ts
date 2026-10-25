import { z } from "zod";

/** A UI label for every value of a string enum. */
export type LabelMap<T extends string> = Readonly<Record<T, string>>;

/** Builds a Zod enum from an as-const tuple of UPPER_SNAKE values. */
export function enumSchema<const T extends readonly [string, ...string[]]>(values: T): z.ZodEnum<{ [K in T[number]]: K }> {
  return z.enum(values);
}

/** Returns the UI label for an enum value, falling back to the raw value. */
export function labelOf<T extends string>(labels: LabelMap<T>, value: T): string {
  return labels[value] ?? value;
}

// ---------------------------------------------------------------------------
// Identity / platform
// ---------------------------------------------------------------------------

export const USER_TYPES = ["STAFF", "CUSTOMER"] as const;
export const UserTypeSchema = enumSchema(USER_TYPES);
export type UserType = z.infer<typeof UserTypeSchema>;
export const USER_TYPE_LABELS: LabelMap<UserType> = { STAFF: "Staff", CUSTOMER: "Customer" };

export const ACTOR_TYPES = ["STAFF", "CUSTOMER", "SYSTEM"] as const;
export const ActorTypeSchema = enumSchema(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorTypeSchema>;
export const ACTOR_TYPE_LABELS: LabelMap<ActorType> = { STAFF: "Staff", CUSTOMER: "Customer", SYSTEM: "System" };

export const TOKEN_AUDIENCES = ["erp", "portal"] as const;
export const TokenAudienceSchema = enumSchema(TOKEN_AUDIENCES);
export type TokenAudience = z.infer<typeof TokenAudienceSchema>;

export const JOB_RUN_STATUSES = ["RUNNING", "OK", "FAILED"] as const;
export const JobRunStatusSchema = enumSchema(JOB_RUN_STATUSES);
export type JobRunStatus = z.infer<typeof JobRunStatusSchema>;
export const JOB_RUN_STATUS_LABELS: LabelMap<JobRunStatus> = { RUNNING: "Running", OK: "OK", FAILED: "Failed" };

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export const GenderSchema = enumSchema(GENDERS);
export type Gender = z.infer<typeof GenderSchema>;
export const GENDER_LABELS: LabelMap<Gender> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

export const PLAN_TYPES = ["CONSTRUCTION_LINKED", "DOWN_PAYMENT", "TIME_LINKED", "FLEXI", "CUSTOM"] as const;
export const PlanTypeSchema = enumSchema(PLAN_TYPES);
export type PlanType = z.infer<typeof PlanTypeSchema>;
export const PLAN_TYPE_LABELS: LabelMap<PlanType> = {
  CONSTRUCTION_LINKED: "Construction Linked",
  DOWN_PAYMENT: "Down Payment",
  TIME_LINKED: "Time Linked",
  FLEXI: "Flexi",
  CUSTOM: "Custom",
};

export const TRIGGER_TYPES = ["ON_BOOKING", "DAYS_AFTER_BOOKING", "ON_STAGE", "ON_POSSESSION", "ON_DATE"] as const;
export const TriggerTypeSchema = enumSchema(TRIGGER_TYPES);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export const TRIGGER_TYPE_LABELS: LabelMap<TriggerType> = {
  ON_BOOKING: "On booking",
  DAYS_AFTER_BOOKING: "Days after booking",
  ON_STAGE: "On construction stage",
  ON_POSSESSION: "On possession",
  ON_DATE: "On fixed date",
};

export const CHARGE_DEMAND_ATS = ["ON_BOOKING", "ON_POSSESSION", "MANUAL"] as const;
export const ChargeDemandAtSchema = enumSchema(CHARGE_DEMAND_ATS);
export type ChargeDemandAt = z.infer<typeof ChargeDemandAtSchema>;
export const CHARGE_DEMAND_AT_LABELS: LabelMap<ChargeDemandAt> = {
  ON_BOOKING: "On booking",
  ON_POSSESSION: "On possession",
  MANUAL: "Manual",
};

export const PAYMENT_MODE_CODES = ["CASH", "CHEQUE", "NEFT_RTGS", "UPI", "DD", "LOAN_DISBURSEMENT"] as const;
export const PaymentModeCodeSchema = enumSchema(PAYMENT_MODE_CODES);
export type PaymentModeCode = z.infer<typeof PaymentModeCodeSchema>;
export const PAYMENT_MODE_CODE_LABELS: LabelMap<PaymentModeCode> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  NEFT_RTGS: "NEFT / RTGS",
  UPI: "UPI",
  DD: "Demand Draft",
  LOAN_DISBURSEMENT: "Bank Loan Disbursement",
};

/** Behaviour flags of a payment mode (SPEC §3 and §11 clearing rule). */
export interface PaymentModeRules {
  readonly requires_instrument: boolean;
  readonly clears_immediately: boolean;
  readonly is_cash: boolean;
}

/** Default rules per mode code: Cash/UPI/NEFT/Loan clear immediately; Cheque/DD stay Pending until cleared or bounced. */
export const PAYMENT_MODE_DEFAULTS: Readonly<Record<PaymentModeCode, PaymentModeRules>> = {
  CASH: { requires_instrument: false, clears_immediately: true, is_cash: true },
  CHEQUE: { requires_instrument: true, clears_immediately: false, is_cash: false },
  NEFT_RTGS: { requires_instrument: true, clears_immediately: true, is_cash: false },
  UPI: { requires_instrument: true, clears_immediately: true, is_cash: false },
  DD: { requires_instrument: true, clears_immediately: false, is_cash: false },
  LOAN_DISBURSEMENT: { requires_instrument: true, clears_immediately: true, is_cash: false },
};

/** Returns true when payments in this mode are Cleared the moment they are posted. */
export function clearsImmediately(code: PaymentModeCode): boolean {
  switch (code) {
    case "CASH":
    case "UPI":
    case "NEFT_RTGS":
    case "LOAN_DISBURSEMENT":
      return true;
    case "CHEQUE":
    case "DD":
      return false;
  }
}

export const AREA_TYPE_CODES = ["CARPET", "BUILT_UP", "SUPER_BUILT_UP", "BALCONY", "TERRACE", "PARKING"] as const;
export const AreaTypeCodeSchema = enumSchema(AREA_TYPE_CODES);
export type AreaTypeCode = z.infer<typeof AreaTypeCodeSchema>;
export const AREA_TYPE_CODE_LABELS: LabelMap<AreaTypeCode> = {
  CARPET: "Carpet",
  BUILT_UP: "Built-up",
  SUPER_BUILT_UP: "Super Built-up",
  BALCONY: "Balcony",
  TERRACE: "Terrace",
  PARKING: "Parking",
};

export const DOCUMENT_APPLIES_TOS = ["CUSTOMER", "BOOKING", "PROJECT", "BLOCK", "FLAT", "PAYMENT"] as const;
export const DocumentAppliesToSchema = enumSchema(DOCUMENT_APPLIES_TOS);
export type DocumentAppliesTo = z.infer<typeof DocumentAppliesToSchema>;
export const DOCUMENT_APPLIES_TO_LABELS: LabelMap<DocumentAppliesTo> = {
  CUSTOMER: "Customer",
  BOOKING: "Booking",
  PROJECT: "Project",
  BLOCK: "Block",
  FLAT: "Flat",
  PAYMENT: "Payment",
};

export const PLC_CALC_MODES = ["PER_SQFT", "FIXED", "PERCENT", "FLOOR_RISE"] as const;
export const PlcCalcModeSchema = enumSchema(PLC_CALC_MODES);
export type PlcCalcMode = z.infer<typeof PlcCalcModeSchema>;
export const PLC_CALC_MODE_LABELS: LabelMap<PlcCalcMode> = {
  PER_SQFT: "Per sq ft",
  FIXED: "Fixed amount",
  PERCENT: "Percent of base",
  FLOOR_RISE: "Floor rise (per floor per sq ft)",
};

export const PLC_APPLIES_TOS = ["ALL", "FLOORS_GTE", "CORNER", "FACING_IN"] as const;
export const PlcAppliesToSchema = enumSchema(PLC_APPLIES_TOS);
export type PlcAppliesTo = z.infer<typeof PlcAppliesToSchema>;
export const PLC_APPLIES_TO_LABELS: LabelMap<PlcAppliesTo> = {
  ALL: "All flats",
  FLOORS_GTE: "Floors at or above",
  CORNER: "Corner flats",
  FACING_IN: "Facing in list",
};

export const SERVICE_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const ServicePrioritySchema = enumSchema(SERVICE_PRIORITIES);
export type ServicePriority = z.infer<typeof ServicePrioritySchema>;
export const SERVICE_PRIORITY_LABELS: LabelMap<ServicePriority> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const MASTER_KINDS = [
  "ROOM_TYPES",
  "AREA_TYPES",
  "FLAT_TYPES",
  "BLOCK_TYPES",
  "FLOOR_PLAN_TEMPLATES",
  "AMENITIES",
  "CONSTRUCTION_STAGES",
  "PAYMENT_PLANS",
  "CHARGE_TYPES",
  "PAYMENT_MODES",
  "BANK_ACCOUNTS",
  "DOCUMENT_TYPES",
  "PLC_TYPES",
  "SPEC_CATEGORIES",
  "SPEC_ITEMS",
  "SERVICE_CATEGORIES",
] as const;
export const MasterKindSchema = enumSchema(MASTER_KINDS);
export type MasterKind = z.infer<typeof MasterKindSchema>;
export const MASTER_KIND_LABELS: LabelMap<MasterKind> = {
  ROOM_TYPES: "Room Types",
  AREA_TYPES: "Area Types",
  FLAT_TYPES: "Flat Types",
  BLOCK_TYPES: "Block Types",
  FLOOR_PLAN_TEMPLATES: "Floor Plan Templates",
  AMENITIES: "Amenities",
  CONSTRUCTION_STAGES: "Construction Stages",
  PAYMENT_PLANS: "Payment Plans",
  CHARGE_TYPES: "Charge Types",
  PAYMENT_MODES: "Payment Modes",
  BANK_ACCOUNTS: "Company Bank Accounts",
  DOCUMENT_TYPES: "Document Types",
  PLC_TYPES: "PLC Types",
  SPEC_CATEGORIES: "Specification Categories",
  SPEC_ITEMS: "Specification Items",
  SERVICE_CATEGORIES: "Service Request Categories",
};

// ---------------------------------------------------------------------------
// Projects & inventory
// ---------------------------------------------------------------------------

export const PROJECT_TYPES = ["RESIDENTIAL", "COMMERCIAL", "MIXED"] as const;
export const ProjectTypeSchema = enumSchema(PROJECT_TYPES);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;
export const PROJECT_TYPE_LABELS: LabelMap<ProjectType> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  MIXED: "Mixed Use",
};

export const PROJECT_STATUSES = ["PLANNING", "UNDER_CONSTRUCTION", "READY", "COMPLETED"] as const;
export const ProjectStatusSchema = enumSchema(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export const PROJECT_STATUS_LABELS: LabelMap<ProjectStatus> = {
  PLANNING: "Planning",
  UNDER_CONSTRUCTION: "Under Construction",
  READY: "Ready to Move",
  COMPLETED: "Completed",
};

export const BLOCK_STATUSES = PROJECT_STATUSES;
export const BlockStatusSchema = enumSchema(BLOCK_STATUSES);
export type BlockStatus = z.infer<typeof BlockStatusSchema>;
export const BLOCK_STATUS_LABELS: LabelMap<BlockStatus> = PROJECT_STATUS_LABELS;

export const BLOCK_TYPE_CODES = ["TOWER", "VILLA", "ROW_HOUSE", "DUPLEX", "COMMERCIAL"] as const;
export const BlockTypeCodeSchema = enumSchema(BLOCK_TYPE_CODES);
export type BlockTypeCode = z.infer<typeof BlockTypeCodeSchema>;
export const BLOCK_TYPE_CODE_LABELS: LabelMap<BlockTypeCode> = {
  TOWER: "Tower",
  VILLA: "Villa",
  ROW_HOUSE: "Row House",
  DUPLEX: "Duplex",
  COMMERCIAL: "Commercial",
};

export const NUMBERING_PATTERNS = ["{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}"] as const;
export const NumberingPatternSchema = enumSchema(NUMBERING_PATTERNS);
export type NumberingPattern = z.infer<typeof NumberingPatternSchema>;
export const NUMBERING_PATTERN_LABELS: LabelMap<NumberingPattern> = {
  "{block}-{floor}{pos2}": "Block-FloorPosition (A-101)",
  "{floor}{pos2}": "FloorPosition (101)",
  "{block}{seq}": "BlockSequence (V1, V2)",
};

export const FLOOR_KINDS = ["UNITS", "REFUGE", "PODIUM"] as const;
export const FloorKindSchema = enumSchema(FLOOR_KINDS);
export type FloorKind = z.infer<typeof FloorKindSchema>;
export const FLOOR_KIND_LABELS: LabelMap<FloorKind> = { UNITS: "Units", REFUGE: "Refuge floor", PODIUM: "Podium" };

export const STAGE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export const StageStatusSchema = enumSchema(STAGE_STATUSES);
export type StageStatus = z.infer<typeof StageStatusSchema>;
export const STAGE_STATUS_LABELS: LabelMap<StageStatus> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
};

export const FLAT_STATUSES = ["AVAILABLE", "HOLD", "BLOCKED", "BOOKED", "SOLD"] as const;
export const FlatStatusSchema = enumSchema(FLAT_STATUSES);
export type FlatStatus = z.infer<typeof FlatStatusSchema>;
export const FLAT_STATUS_LABELS: LabelMap<FlatStatus> = {
  AVAILABLE: "Available",
  HOLD: "On Hold",
  BLOCKED: "Blocked",
  BOOKED: "Booked",
  SOLD: "Sold",
};

/** Flat statuses staff may set by hand; BOOKED and SOLD belong to the booking engine. */
export const MANUAL_FLAT_STATUSES = ["AVAILABLE", "HOLD", "BLOCKED"] as const;
export const ManualFlatStatusSchema = enumSchema(MANUAL_FLAT_STATUSES);
export type ManualFlatStatus = z.infer<typeof ManualFlatStatusSchema>;

export const GRID_COLOUR_MODES = ["STATUS", "FLAT_TYPE", "PRICE_BAND"] as const;
export const GridColourModeSchema = enumSchema(GRID_COLOUR_MODES);
export type GridColourMode = z.infer<typeof GridColourModeSchema>;
export const GRID_COLOUR_MODE_LABELS: LabelMap<GridColourMode> = {
  STATUS: "By status",
  FLAT_TYPE: "By flat type",
  PRICE_BAND: "By price band",
};

export const PARKING_TYPES = ["COVERED", "OPEN", "STILT", "BASEMENT"] as const;
export const ParkingTypeSchema = enumSchema(PARKING_TYPES);
export type ParkingType = z.infer<typeof ParkingTypeSchema>;
export const PARKING_TYPE_LABELS: LabelMap<ParkingType> = {
  COVERED: "Covered",
  OPEN: "Open",
  STILT: "Stilt",
  BASEMENT: "Basement",
};

export const PARKING_STATUSES = ["AVAILABLE", "ALLOTTED", "BLOCKED"] as const;
export const ParkingStatusSchema = enumSchema(PARKING_STATUSES);
export type ParkingStatus = z.infer<typeof ParkingStatusSchema>;
export const PARKING_STATUS_LABELS: LabelMap<ParkingStatus> = {
  AVAILABLE: "Available",
  ALLOTTED: "Allotted",
  BLOCKED: "Blocked",
};

export const MANUAL_PARKING_STATUSES = ["AVAILABLE", "BLOCKED"] as const;
export const ManualParkingStatusSchema = enumSchema(MANUAL_PARKING_STATUSES);
export type ManualParkingStatus = z.infer<typeof ManualParkingStatusSchema>;

export const RATE_CARD_STATUSES = ["DRAFT", "ACTIVE", "SUPERSEDED"] as const;
export const RateCardStatusSchema = enumSchema(RATE_CARD_STATUSES);
export type RateCardStatus = z.infer<typeof RateCardStatusSchema>;
export const RATE_CARD_STATUS_LABELS: LabelMap<RateCardStatus> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
};

// ---------------------------------------------------------------------------
// Customers, leads, visits
// ---------------------------------------------------------------------------

export const KYC_STATUSES = ["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"] as const;
export const KycStatusSchema = enumSchema(KYC_STATUSES);
export type KycStatus = z.infer<typeof KycStatusSchema>;
export const KYC_STATUS_LABELS: LabelMap<KycStatus> = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export const PORTAL_ACCESS_ACTIONS = ["ENABLE", "RESET_PASSWORD", "DISABLE", "REVOKE_SESSIONS"] as const;
export const PortalAccessActionSchema = enumSchema(PORTAL_ACCESS_ACTIONS);
export type PortalAccessAction = z.infer<typeof PortalAccessActionSchema>;
export const PORTAL_ACCESS_ACTION_LABELS: LabelMap<PortalAccessAction> = {
  ENABLE: "Enable portal access",
  RESET_PASSWORD: "Reset password",
  DISABLE: "Disable portal access",
  REVOKE_SESSIONS: "Revoke all sessions",
};

export const LEAD_SOURCES = ["WALK_IN", "WEBSITE", "BROCHURE", "SITE_VISIT", "REFERRAL", "BROKER", "CAMPAIGN"] as const;
export const LeadSourceSchema = enumSchema(LEAD_SOURCES);
export type LeadSource = z.infer<typeof LeadSourceSchema>;
export const LEAD_SOURCE_LABELS: LabelMap<LeadSource> = {
  WALK_IN: "Walk-in",
  WEBSITE: "Website",
  BROCHURE: "Brochure",
  SITE_VISIT: "Site Visit",
  REFERRAL: "Referral",
  BROKER: "Broker",
  CAMPAIGN: "Campaign",
};

export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "SITE_VISIT_SCHEDULED",
  "SITE_VISIT_DONE",
  "NEGOTIATION",
  "CONVERTED",
  "LOST",
] as const;
export const LeadStageSchema = enumSchema(LEAD_STAGES);
export type LeadStage = z.infer<typeof LeadStageSchema>;
export const LEAD_STAGE_LABELS: LabelMap<LeadStage> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_VISIT_SCHEDULED: "Site Visit Scheduled",
  SITE_VISIT_DONE: "Site Visit Done",
  NEGOTIATION: "Negotiation",
  CONVERTED: "Converted",
  LOST: "Lost",
};

/** Lead stages that count as "open" for the website dedupe rule. */
export const OPEN_LEAD_STAGES = ["NEW", "CONTACTED", "SITE_VISIT_SCHEDULED", "SITE_VISIT_DONE", "NEGOTIATION"] as const;

export const LEAD_ACTIVITY_TYPES = [
  "CREATED",
  "ENQUIRY",
  "BROCHURE_DOWNLOADED",
  "VISIT_BOOKED",
  "VISIT_RESCHEDULED",
  "VISIT_CANCELLED",
  "VISIT_COMPLETED",
  "VISIT_NO_SHOW",
  "STAGE_CHANGED",
  "FOLLOW_UP",
  "ASSIGNED",
  "NOTE",
  "CONVERTED",
] as const;
export const LeadActivityTypeSchema = enumSchema(LEAD_ACTIVITY_TYPES);
export type LeadActivityType = z.infer<typeof LeadActivityTypeSchema>;
export const LEAD_ACTIVITY_TYPE_LABELS: LabelMap<LeadActivityType> = {
  CREATED: "Lead created",
  ENQUIRY: "Enquiry received",
  BROCHURE_DOWNLOADED: "Brochure downloaded",
  VISIT_BOOKED: "Site visit booked",
  VISIT_RESCHEDULED: "Site visit rescheduled",
  VISIT_CANCELLED: "Site visit cancelled",
  VISIT_COMPLETED: "Site visit completed",
  VISIT_NO_SHOW: "Site visit no-show",
  STAGE_CHANGED: "Stage changed",
  FOLLOW_UP: "Follow-up",
  ASSIGNED: "Assigned",
  NOTE: "Note",
  CONVERTED: "Converted to customer",
};

export const VISIT_STATUSES = ["CONFIRMED", "RESCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
export const VisitStatusSchema = enumSchema(VISIT_STATUSES);
export type VisitStatus = z.infer<typeof VisitStatusSchema>;
export const VISIT_STATUS_LABELS: LabelMap<VisitStatus> = {
  CONFIRMED: "Confirmed",
  RESCHEDULED: "Rescheduled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

export const VISIT_OUTCOMES = ["COMPLETED", "NO_SHOW"] as const;
export const VisitOutcomeSchema = enumSchema(VISIT_OUTCOMES);
export type VisitOutcome = z.infer<typeof VisitOutcomeSchema>;

export const VISIT_SOURCES = ["WEBSITE", "ERP"] as const;
export const VisitSourceSchema = enumSchema(VISIT_SOURCES);
export type VisitSource = z.infer<typeof VisitSourceSchema>;
export const VISIT_SOURCE_LABELS: LabelMap<VisitSource> = { WEBSITE: "Website", ERP: "ERP" };

export const SLOT_MINUTES = [30, 60] as const;
export type SlotMinutes = (typeof SLOT_MINUTES)[number];
/** Site-visit slot length: 30 or 60 minutes. */
export const SlotMinutesSchema = z.union([z.literal(30), z.literal(60)]);

// ---------------------------------------------------------------------------
// Bookings & money
// ---------------------------------------------------------------------------

export const BOOKING_STATUSES = ["ACTIVE", "CANCELLED", "COMPLETED"] as const;
export const BookingStatusSchema = enumSchema(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;
export const BOOKING_STATUS_LABELS: LabelMap<BookingStatus> = {
  ACTIVE: "Active",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

export const PLAN_ACCEPTANCE_MODES = ["IN_PERSON", "SIGNED_COPY", "PORTAL"] as const;
export const PlanAcceptanceModeSchema = enumSchema(PLAN_ACCEPTANCE_MODES);
export type PlanAcceptanceMode = z.infer<typeof PlanAcceptanceModeSchema>;
export const PLAN_ACCEPTANCE_MODE_LABELS: LabelMap<PlanAcceptanceMode> = {
  IN_PERSON: "In person",
  SIGNED_COPY: "Signed copy uploaded",
  PORTAL: "Accepted on portal",
};

export const DEMAND_STATUSES = ["OPEN", "PARTIALLY_PAID", "PAID", "VOID", "CANCELLED"] as const;
export const DemandStatusSchema = enumSchema(DEMAND_STATUSES);
export type DemandStatus = z.infer<typeof DemandStatusSchema>;
export const DEMAND_STATUS_LABELS: LabelMap<DemandStatus> = {
  OPEN: "Open",
  PARTIALLY_PAID: "Partially Paid",
  PAID: "Paid",
  VOID: "Void",
  CANCELLED: "Cancelled",
};

export const SCHEDULE_STATUSES = ["NOT_YET_DUE", "RAISED", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
export const ScheduleStatusSchema = enumSchema(SCHEDULE_STATUSES);
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export const SCHEDULE_STATUS_LABELS: LabelMap<ScheduleStatus> = {
  NOT_YET_DUE: "Not yet due",
  RAISED: "Raised",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export const PAYMENT_AGAINSTS = ["FLAT_VALUE", "OTHER_CHARGE"] as const;
export const PaymentAgainstSchema = enumSchema(PAYMENT_AGAINSTS);
export type PaymentAgainst = z.infer<typeof PaymentAgainstSchema>;
export const PAYMENT_AGAINST_LABELS: LabelMap<PaymentAgainst> = {
  FLAT_VALUE: "Flat value",
  OTHER_CHARGE: "Other charge",
};

export const PAYMENT_BUCKETS = ["CASH", "ACCOUNT"] as const;
export const PaymentBucketSchema = enumSchema(PAYMENT_BUCKETS);
export type PaymentBucket = z.infer<typeof PaymentBucketSchema>;
export const PAYMENT_BUCKET_LABELS: LabelMap<PaymentBucket> = { CASH: "Cash", ACCOUNT: "Account" };

/** Money category used by roznamcha and collections grouping. */
export const MONEY_CATEGORIES = ["CASH", "ACCOUNT", "OTHER"] as const;
export const MoneyCategorySchema = enumSchema(MONEY_CATEGORIES);
export type MoneyCategory = z.infer<typeof MoneyCategorySchema>;
export const MONEY_CATEGORY_LABELS: LabelMap<MoneyCategory> = {
  CASH: "Cash",
  ACCOUNT: "Account",
  OTHER: "Other charges",
};

export const PAYMENT_STATUSES = ["PENDING", "CLEARED", "BOUNCED", "REVERSED"] as const;
export const PaymentStatusSchema = enumSchema(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export const PAYMENT_STATUS_LABELS: LabelMap<PaymentStatus> = {
  PENDING: "Pending",
  CLEARED: "Cleared",
  BOUNCED: "Bounced",
  REVERSED: "Reversed",
};

export const LEDGER_EVENTS = [
  "DEMAND",
  "PAYMENT",
  "REVERSAL",
  "AGREEMENT_CHANGE",
  "PLAN_CHANGE",
  "OTHER_CHARGE_DEMAND",
  "OTHER_CHARGE_PAYMENT",
  "OTHER_CHARGE_REVERSAL",
  "CANCELLATION",
] as const;
export const LedgerEventSchema = enumSchema(LEDGER_EVENTS);
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;
export const LEDGER_EVENT_LABELS: LabelMap<LedgerEvent> = {
  DEMAND: "Demand",
  PAYMENT: "Payment",
  REVERSAL: "Reversal",
  AGREEMENT_CHANGE: "Agreement change",
  PLAN_CHANGE: "Plan change",
  OTHER_CHARGE_DEMAND: "Other charge demand",
  OTHER_CHARGE_PAYMENT: "Other charge payment",
  OTHER_CHARGE_REVERSAL: "Other charge reversal",
  CANCELLATION: "Cancellation",
};

export const CONTRA_TYPES = ["DEPOSIT", "WITHDRAWAL"] as const;
export const ContraTypeSchema = enumSchema(CONTRA_TYPES);
export type ContraType = z.infer<typeof ContraTypeSchema>;
export const CONTRA_TYPE_LABELS: LabelMap<ContraType> = {
  DEPOSIT: "Cash deposited to bank",
  WITHDRAWAL: "Cash withdrawn from bank",
};

export const AGEING_BUCKETS = ["NOT_DUE", "D0_30", "D31_60", "D61_90", "D90_PLUS"] as const;
export const AgeingBucketSchema = enumSchema(AGEING_BUCKETS);
export type AgeingBucket = z.infer<typeof AgeingBucketSchema>;
export const AGEING_BUCKET_LABELS: LabelMap<AgeingBucket> = {
  NOT_DUE: "Not due",
  D0_30: "0–30 days",
  D31_60: "31–60 days",
  D61_90: "61–90 days",
  D90_PLUS: "90+ days",
};

export const INTEGRITY_FINDING_TYPES = [
  "UNSATISFIED_DEMAND",
  "MISSING_DEMAND",
  "DUPLICATE_DEMAND",
  "UNMAPPED_DEMAND",
  "SUMMARY_MISMATCH",
] as const;
export const IntegrityFindingTypeSchema = enumSchema(INTEGRITY_FINDING_TYPES);
export type IntegrityFindingType = z.infer<typeof IntegrityFindingTypeSchema>;
export const INTEGRITY_FINDING_TYPE_LABELS: LabelMap<IntegrityFindingType> = {
  UNSATISFIED_DEMAND: "Demand whose trigger is not satisfied",
  MISSING_DEMAND: "Satisfied trigger with no demand",
  DUPLICATE_DEMAND: "Duplicate installment demand",
  UNMAPPED_DEMAND: "Demand not mapped to an installment",
  SUMMARY_MISMATCH: "Stored summary differs from recomputation",
};

// ---------------------------------------------------------------------------
// Documents, service, notifications, CMS
// ---------------------------------------------------------------------------

export const DOCUMENT_ENTITY_TYPES = [
  "CUSTOMER",
  "BOOKING",
  "PROJECT",
  "BLOCK",
  "FLAT",
  "PAYMENT",
  "STAGE",
  "CMS",
  "SERVICE_REQUEST",
  "COMPANY",
] as const;
export const DocumentEntityTypeSchema = enumSchema(DOCUMENT_ENTITY_TYPES);
export type DocumentEntityType = z.infer<typeof DocumentEntityTypeSchema>;
export const DOCUMENT_ENTITY_TYPE_LABELS: LabelMap<DocumentEntityType> = {
  CUSTOMER: "Customer",
  BOOKING: "Booking",
  PROJECT: "Project",
  BLOCK: "Block",
  FLAT: "Flat",
  PAYMENT: "Payment",
  STAGE: "Construction stage",
  CMS: "Website content",
  SERVICE_REQUEST: "Service request",
  COMPANY: "Company",
};

export const SERVICE_STATUSES = ["NEW", "IN_PROGRESS", "AWAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;
export const ServiceStatusSchema = enumSchema(SERVICE_STATUSES);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;
export const SERVICE_STATUS_LABELS: LabelMap<ServiceStatus> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  AWAITING_CUSTOMER: "Awaiting Customer",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const NOTIFICATION_RECIPIENT_TYPES = ["STAFF", "CUSTOMER"] as const;
export const NotificationRecipientTypeSchema = enumSchema(NOTIFICATION_RECIPIENT_TYPES);
export type NotificationRecipientType = z.infer<typeof NotificationRecipientTypeSchema>;
export const NOTIFICATION_RECIPIENT_TYPE_LABELS: LabelMap<NotificationRecipientType> = {
  STAFF: "Staff",
  CUSTOMER: "Customer",
};

export const NOTIFICATION_TYPES = [
  "ENQUIRY_NEW",
  "BROCHURE_LEAD",
  "VISIT_BOOKED",
  "VISIT_OUTCOME_NUDGE",
  "CHEQUE_BOUNCED",
  "DEMAND_RAISED",
  "DEMAND_OVERDUE",
  "STAGE_COMPLETED",
  "AGREEMENT_REVISED",
  "BOOKING_CANCELLED",
  "TICKET_NEW",
  "TICKET_CUSTOMER_REPLY",
  "TICKET_STAFF_REPLY",
  "TICKET_SLA_BREACH",
  "INTEGRITY_FINDINGS",
  "NOTICE_PUBLISHED",
  "PAYMENT_RECEIVED",
  "BOOKING_CREATED",
] as const;
export const NotificationTypeSchema = enumSchema(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export const NOTIFICATION_TYPE_LABELS: LabelMap<NotificationType> = {
  ENQUIRY_NEW: "New website enquiry",
  BROCHURE_LEAD: "Brochure download lead",
  VISIT_BOOKED: "Site visit booked",
  VISIT_OUTCOME_NUDGE: "Mark site visit outcome",
  CHEQUE_BOUNCED: "Cheque bounced",
  DEMAND_RAISED: "Installment demand raised",
  DEMAND_OVERDUE: "Demand overdue",
  STAGE_COMPLETED: "Construction stage completed",
  AGREEMENT_REVISED: "Agreement revised",
  BOOKING_CANCELLED: "Booking cancelled",
  TICKET_NEW: "New service request",
  TICKET_CUSTOMER_REPLY: "Customer replied on ticket",
  TICKET_STAFF_REPLY: "Staff replied on your request",
  TICKET_SLA_BREACH: "Service request SLA breached",
  INTEGRITY_FINDINGS: "Integrity findings",
  NOTICE_PUBLISHED: "Notice published",
  PAYMENT_RECEIVED: "Payment received",
  BOOKING_CREATED: "Booking created",
};

export const POST_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export const PostStatusSchema = enumSchema(POST_STATUSES);
export type PostStatus = z.infer<typeof PostStatusSchema>;
export const POST_STATUS_LABELS: LabelMap<PostStatus> = { DRAFT: "Draft", PUBLISHED: "Published" };

/** Availability as the public website sees it: everything that is not AVAILABLE collapses to NOT_AVAILABLE. */
export const PUBLIC_AVAILABILITIES = ["AVAILABLE", "NOT_AVAILABLE"] as const;
export const PublicAvailabilitySchema = enumSchema(PUBLIC_AVAILABILITIES);
export type PublicAvailability = z.infer<typeof PublicAvailabilitySchema>;
export const PUBLIC_AVAILABILITY_LABELS: LabelMap<PublicAvailability> = {
  AVAILABLE: "Available",
  NOT_AVAILABLE: "Not available",
};

/** Maps an internal flat status to the public two-state availability. */
export function toPublicAvailability(status: FlatStatus): PublicAvailability {
  switch (status) {
    case "AVAILABLE":
      return "AVAILABLE";
    case "HOLD":
    case "BLOCKED":
    case "BOOKED":
    case "SOLD":
      return "NOT_AVAILABLE";
  }
}

// ---------------------------------------------------------------------------
// Reports & dashboards
// ---------------------------------------------------------------------------

export const DASHBOARD_ROLES = ["OWNER", "ACCOUNTS", "SALES", "PROJECT_ADMIN", "EMPLOYEE"] as const;
export const DashboardRoleSchema = enumSchema(DASHBOARD_ROLES);
export type DashboardRole = z.infer<typeof DashboardRoleSchema>;
export const DASHBOARD_ROLE_LABELS: LabelMap<DashboardRole> = {
  OWNER: "Owner",
  ACCOUNTS: "Accounts",
  SALES: "Sales",
  PROJECT_ADMIN: "Project Admin",
  EMPLOYEE: "Employee",
};

export const REPORT_KEYS = [
  "COLLECTIONS",
  "OUTSTANDING_AGEING",
  "ADVANCES",
  "DEMAND_VS_COLLECTION",
  "UPCOMING_DUES",
  "INVENTORY",
  "CUSTOMER_STATEMENT",
  "PAYMENT_SCHEDULE",
  "ALLOTMENT_LETTER",
  "CHEQUES",
  "CANCELLATIONS",
  "SALES_FUNNEL",
  "ROZNAMCHA",
  "BANKWISE_RECEIPTS",
  "ACTIVITY",
] as const;
export const ReportKeySchema = enumSchema(REPORT_KEYS);
export type ReportKey = z.infer<typeof ReportKeySchema>;
export const REPORT_KEY_LABELS: LabelMap<ReportKey> = {
  COLLECTIONS: "Collections",
  OUTSTANDING_AGEING: "Outstanding & Ageing",
  ADVANCES: "Advances",
  DEMAND_VS_COLLECTION: "Demand vs Collection",
  UPCOMING_DUES: "Upcoming Dues Forecast",
  INVENTORY: "Inventory",
  CUSTOMER_STATEMENT: "Customer Statement of Account",
  PAYMENT_SCHEDULE: "Payment Schedule",
  ALLOTMENT_LETTER: "Allotment Letter",
  CHEQUES: "Cheques in Hand / Bounced",
  CANCELLATIONS: "Cancellations & Refunds",
  SALES_FUNNEL: "Sales & Leads Funnel",
  ROZNAMCHA: "Roznamcha (Day Book)",
  BANKWISE_RECEIPTS: "Bank-wise Receipts",
  ACTIVITY: "Activity / Logins",
};

export const REPORT_PERIODS = ["DAY", "WEEK", "MONTH"] as const;
export const ReportPeriodSchema = enumSchema(REPORT_PERIODS);
export type ReportPeriod = z.infer<typeof ReportPeriodSchema>;
export const REPORT_PERIOD_LABELS: LabelMap<ReportPeriod> = { DAY: "Daily", WEEK: "Weekly", MONTH: "Monthly" };

export const EXPORT_FORMATS = ["CSV", "PDF"] as const;
export const ExportFormatSchema = enumSchema(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/** Lifecycle of an asynchronous CSV export (`exports` table). */
export const EXPORT_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;
export const ExportStatusSchema = enumSchema(EXPORT_STATUSES);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;
export const EXPORT_STATUS_LABELS: LabelMap<ExportStatus> = { QUEUED: "Queued", RUNNING: "Running", DONE: "Ready", FAILED: "Failed" };

export const SEARCH_ENTITY_TYPES = ["PROJECT", "BLOCK", "FLAT", "CUSTOMER", "BOOKING", "LEAD", "PAYMENT"] as const;
export const SearchEntityTypeSchema = enumSchema(SEARCH_ENTITY_TYPES);
export type SearchEntityType = z.infer<typeof SearchEntityTypeSchema>;
export const SEARCH_ENTITY_TYPE_LABELS: LabelMap<SearchEntityType> = {
  PROJECT: "Project",
  BLOCK: "Block",
  FLAT: "Flat",
  CUSTOMER: "Customer",
  BOOKING: "Booking",
  LEAD: "Lead",
  PAYMENT: "Payment",
};

export const JOB_NAMES = [
  "DAILY_DUES",
  "NIGHTLY_INTEGRITY",
  "OVERDUE_NOTIFICATIONS",
  "VISIT_OUTCOME_NUDGE",
  "NOTIFICATION_SWEEP",
  "STARTUP_RECONCILIATION",
  "SLA_BREACH_CHECK",
  "PORTAL_FILE_CLEANUP",
] as const;
export const JobNameSchema = enumSchema(JOB_NAMES);
export type JobName = z.infer<typeof JobNameSchema>;
export const JOB_NAME_LABELS: LabelMap<JobName> = {
  DAILY_DUES: "Daily dues (00:30 IST)",
  NIGHTLY_INTEGRITY: "Nightly integrity report",
  SLA_BREACH_CHECK: "Service SLA breach check (hourly)",
  PORTAL_FILE_CLEANUP: "Portal temporary file cleanup",
  OVERDUE_NOTIFICATIONS: "Overdue demand notifications",
  VISIT_OUTCOME_NUDGE: "Site visit outcome nudge",
  NOTIFICATION_SWEEP: "Notification sweep",
  STARTUP_RECONCILIATION: "Startup reconciliation",
};
