import { z } from "zod";
import {
  ActorTypeSchema,
  AgeingBucketSchema,
  BookingStatusSchema,
  DemandStatusSchema,
  ExportFormatSchema,
  LeadSourceSchema,
  LeadStageSchema,
  MoneyCategorySchema,
  PaymentBucketSchema,
  PaymentModeCodeSchema,
  PaymentStatusSchema,
  ReportKeySchema,
  ReportPeriodSchema,
  SearchEntityTypeSchema,
  TriggerTypeSchema,
  VisitStatusSchema,
} from "../enums.js";
import {
  DateRangeSchema,
  DateStringSchema,
  IdSchema,
  IntQuerySchema,
  ListQuerySchema,
  NameSchema,
  PaiseSchema,
  SignedPaiseSchema,
  TimestampSchema,
  listEnvelope,
} from "../common.js";
import { ChequeRowSchema } from "./payments.js";
import { DemandRowSchema, LedgerRowSchema, ScheduleRowSchema, AgreementRevisionRowSchema, OtherChargeRowSchema } from "./bookings.js";

/** Export selector accepted by every report. */
export const ReportExportQuerySchema = z.object({ export: ExportFormatSchema.optional() });
export type ReportExportQuery = z.infer<typeof ReportExportQuerySchema>;

/** Totals footer for money reports. */
export const MoneyTotalsSchema = z.object({
  cash_paise: PaiseSchema,
  account_paise: PaiseSchema,
  other_paise: PaiseSchema,
  gst_paise: PaiseSchema,
  total_paise: PaiseSchema,
  count: z.int().min(0),
});
export type MoneyTotals = z.infer<typeof MoneyTotalsSchema>;

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export const CollectionsReportQuerySchema = DateRangeSchema.safeExtend({
  group_by: ReportPeriodSchema.default("DAY"),
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  mode_code: PaymentModeCodeSchema.optional(),
  category: MoneyCategorySchema.optional(),
  status: PaymentStatusSchema.default("CLEARED"),
  export: ExportFormatSchema.optional(),
});
export type CollectionsReportQuery = z.infer<typeof CollectionsReportQuerySchema>;

export const CollectionsReportRowSchema = z.object({
  period: z.string(),
  period_start: DateStringSchema,
  cash_paise: PaiseSchema,
  account_paise: PaiseSchema,
  other_paise: PaiseSchema,
  gst_paise: PaiseSchema,
  total_paise: PaiseSchema,
  count: z.int().min(0),
  by_mode: z.array(z.object({ mode_code: PaymentModeCodeSchema, amount_paise: PaiseSchema, count: z.int().min(0) })),
});
export type CollectionsReportRow = z.infer<typeof CollectionsReportRowSchema>;

export const CollectionsReportResponseSchema = z.object({
  query: CollectionsReportQuerySchema,
  rows: z.array(CollectionsReportRowSchema),
  totals: MoneyTotalsSchema,
});
export type CollectionsReportResponse = z.infer<typeof CollectionsReportResponseSchema>;

// ---------------------------------------------------------------------------
// Outstanding & ageing
// ---------------------------------------------------------------------------

export const OutstandingReportQuerySchema = z.object({
  as_of: DateStringSchema.optional(),
  group_by: z.enum(["PROJECT", "BLOCK", "CUSTOMER"]).default("PROJECT"),
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  customer_id: IdSchema.optional(),
  top_n: IntQuerySchema.min(1).max(100).default(10),
  export: ExportFormatSchema.optional(),
});
export type OutstandingReportQuery = z.infer<typeof OutstandingReportQuerySchema>;

export const AgeingAmountsSchema = z.object({
  NOT_DUE: PaiseSchema,
  D0_30: PaiseSchema,
  D31_60: PaiseSchema,
  D61_90: PaiseSchema,
  D90_PLUS: PaiseSchema,
});
export type AgeingAmounts = z.infer<typeof AgeingAmountsSchema>;

export const OutstandingReportRowSchema = z.object({
  key_id: IdSchema,
  label: z.string(),
  bookings: z.int().min(0),
  cash_due_paise: SignedPaiseSchema,
  account_due_paise: SignedPaiseSchema,
  total_due_paise: SignedPaiseSchema,
  ageing: AgeingAmountsSchema,
});
export type OutstandingReportRow = z.infer<typeof OutstandingReportRowSchema>;

export const TopOverdueRowSchema = z.object({
  booking_id: IdSchema,
  booking_number: z.string(),
  customer_id: IdSchema,
  customer_name: z.string(),
  customer_phone: z.string(),
  project_name: z.string(),
  flat_number: z.string(),
  overdue_paise: PaiseSchema,
  oldest_due_date: DateStringSchema,
  days_overdue: z.int().min(0),
  bucket: AgeingBucketSchema,
});
export type TopOverdueRow = z.infer<typeof TopOverdueRowSchema>;

export const OutstandingReportResponseSchema = z.object({
  as_of: DateStringSchema,
  rows: z.array(OutstandingReportRowSchema),
  totals: OutstandingReportRowSchema.omit({ key_id: true, label: true }),
  top_overdue: z.array(TopOverdueRowSchema),
});
export type OutstandingReportResponse = z.infer<typeof OutstandingReportResponseSchema>;

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------

export const AdvancesReportQuerySchema = z.object({
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  bucket: PaymentBucketSchema.optional(),
  export: ExportFormatSchema.optional(),
});
export type AdvancesReportQuery = z.infer<typeof AdvancesReportQuerySchema>;

export const AdvancesReportRowSchema = z.object({
  booking_id: IdSchema,
  booking_number: z.string(),
  customer_name: z.string(),
  project_name: z.string(),
  block_name: z.string(),
  flat_number: z.string(),
  cash_advance_paise: PaiseSchema,
  account_advance_paise: PaiseSchema,
  total_advance_paise: PaiseSchema,
  next_installment_name: z.string().nullable(),
});
export type AdvancesReportRow = z.infer<typeof AdvancesReportRowSchema>;

export const AdvancesReportResponseSchema = z.object({
  rows: z.array(AdvancesReportRowSchema),
  totals: z.object({ cash_advance_paise: PaiseSchema, account_advance_paise: PaiseSchema, total_advance_paise: PaiseSchema, count: z.int().min(0) }),
});
export type AdvancesReportResponse = z.infer<typeof AdvancesReportResponseSchema>;

// ---------------------------------------------------------------------------
// Demand vs collection
// ---------------------------------------------------------------------------

export const DemandVsCollectionQuerySchema = z.object({
  project_id: IdSchema,
  block_id: IdSchema.optional(),
  group_by: z.enum(["INSTALLMENT", "STAGE"]).default("INSTALLMENT"),
  export: ExportFormatSchema.optional(),
});
export type DemandVsCollectionQuery = z.infer<typeof DemandVsCollectionQuerySchema>;

export const DemandVsCollectionRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  block_id: IdSchema.nullable(),
  block_name: z.string().nullable(),
  trigger_type: TriggerTypeSchema.nullable(),
  demands_count: z.int().min(0),
  demanded_paise: PaiseSchema,
  collected_paise: PaiseSchema,
  outstanding_paise: SignedPaiseSchema,
  collection_percent: z.number().min(0).max(100),
});
export type DemandVsCollectionRow = z.infer<typeof DemandVsCollectionRowSchema>;

export const DemandVsCollectionResponseSchema = z.object({
  rows: z.array(DemandVsCollectionRowSchema),
  totals: z.object({ demanded_paise: PaiseSchema, collected_paise: PaiseSchema, outstanding_paise: SignedPaiseSchema }),
});
export type DemandVsCollectionResponse = z.infer<typeof DemandVsCollectionResponseSchema>;

// ---------------------------------------------------------------------------
// Upcoming dues forecast
// ---------------------------------------------------------------------------

export const UpcomingDuesQuerySchema = DateRangeSchema.safeExtend({
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  export: ExportFormatSchema.optional(),
});
export type UpcomingDuesQuery = z.infer<typeof UpcomingDuesQuerySchema>;

export const UpcomingDuesRowSchema = z.object({
  expected_date: DateStringSchema,
  booking_id: IdSchema,
  booking_number: z.string(),
  customer_name: z.string(),
  project_name: z.string(),
  block_name: z.string(),
  flat_number: z.string(),
  installment_seq: z.int(),
  installment_name: z.string(),
  trigger_type: TriggerTypeSchema,
  trigger_label: z.string(),
  is_estimate: z.boolean(),
  cash_paise: PaiseSchema,
  account_paise: PaiseSchema,
  total_paise: PaiseSchema,
});
export type UpcomingDuesRow = z.infer<typeof UpcomingDuesRowSchema>;

export const UpcomingDuesResponseSchema = z.object({
  rows: z.array(UpcomingDuesRowSchema),
  by_month: z.array(z.object({ month: z.string(), total_paise: PaiseSchema, count: z.int().min(0) })),
  totals: z.object({ cash_paise: PaiseSchema, account_paise: PaiseSchema, total_paise: PaiseSchema, count: z.int().min(0) }),
});
export type UpcomingDuesResponse = z.infer<typeof UpcomingDuesResponseSchema>;

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const InventoryReportQuerySchema = z.object({
  project_id: IdSchema.optional(),
  block_id: IdSchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  export: ExportFormatSchema.optional(),
});
export type InventoryReportQuery = z.infer<typeof InventoryReportQuerySchema>;

const InventoryCountRow = z.object({
  label: z.string(),
  available: z.int().min(0),
  hold: z.int().min(0),
  blocked: z.int().min(0),
  booked: z.int().min(0),
  sold: z.int().min(0),
  total: z.int().min(0),
  available_value_paise: PaiseSchema,
  sold_value_paise: PaiseSchema,
});

export const InventoryReportResponseSchema = z.object({
  by_type: z.array(InventoryCountRow.extend({ flat_type_id: IdSchema })),
  by_floor: z.array(InventoryCountRow.extend({ block_id: IdSchema, floor: z.int() })),
  by_block: z.array(InventoryCountRow.extend({ block_id: IdSchema })),
  totals: InventoryCountRow,
  velocity: z.array(z.object({ month: z.string(), bookings: z.int().min(0), cancellations: z.int().min(0), value_paise: PaiseSchema })),
  realised_rate: z.array(
    z.object({
      flat_type_id: IdSchema,
      flat_type_name: z.string(),
      rate_card_rate_paise: PaiseSchema.nullable(),
      realised_rate_paise: PaiseSchema.nullable(),
      bookings: z.int().min(0),
    }),
  ),
});
export type InventoryReportResponse = z.infer<typeof InventoryReportResponseSchema>;

// ---------------------------------------------------------------------------
// Customer statement of account / schedule / allotment letter
// ---------------------------------------------------------------------------

export const BookingDocumentQuerySchema = z.object({ booking_id: IdSchema, export: ExportFormatSchema.optional() });
export type BookingDocumentQuery = z.infer<typeof BookingDocumentQuerySchema>;

export const CustomerStatementResponseSchema = z.object({
  generated_at: TimestampSchema,
  booking: z.object({
    booking_id: IdSchema,
    booking_number: z.string(),
    booking_date: DateStringSchema,
    status: BookingStatusSchema,
    customer_name: z.string(),
    customer_code: z.string(),
    customer_address: z.string().nullable(),
    co_applicant_names: z.array(z.string()),
    project_name: z.string(),
    block_name: z.string(),
    flat_number: z.string(),
    flat_type_name: z.string(),
    super_builtup_sqft: z.number(),
    plan_name: z.string(),
    agreement_value_paise: PaiseSchema,
    cash_agreed_paise: PaiseSchema,
    account_agreed_paise: PaiseSchema,
  }),
  revisions: z.array(AgreementRevisionRowSchema),
  schedule: z.array(ScheduleRowSchema),
  ledger: z.array(LedgerRowSchema),
  other_charges: z.array(OtherChargeRowSchema),
  pending_cheques: z.array(ChequeRowSchema),
  summary: z.object({
    cash_order_raised_paise: PaiseSchema,
    account_order_raised_paise: PaiseSchema,
    cash_paid_paise: PaiseSchema,
    account_paid_paise: PaiseSchema,
    cash_due_paise: SignedPaiseSchema,
    account_due_paise: SignedPaiseSchema,
    total_due_paise: SignedPaiseSchema,
    other_charges_due_paise: SignedPaiseSchema,
    pending_cheques_paise: PaiseSchema,
  }),
});
export type CustomerStatementResponse = z.infer<typeof CustomerStatementResponseSchema>;

export const AllotmentLetterDataSchema = z.object({
  booking_number: z.string(),
  booking_date: DateStringSchema,
  customer_name: z.string(),
  customer_address: z.string().nullable(),
  co_applicant_names: z.array(z.string()),
  project_name: z.string(),
  project_address: z.string(),
  rera_number: z.string().nullable(),
  block_name: z.string(),
  flat_number: z.string(),
  floor_label: z.string(),
  flat_type_name: z.string(),
  carpet_sqft: z.number().nullable(),
  builtup_sqft: z.number().nullable(),
  super_builtup_sqft: z.number(),
  parking_slot_numbers: z.array(z.string()),
  agreement_value_paise: PaiseSchema,
  agreement_value_words: z.string(),
  plan_name: z.string(),
  schedule: z.array(ScheduleRowSchema),
  signatory_name: z.string().nullable(),
  signatory_title: z.string().nullable(),
});
export type AllotmentLetterData = z.infer<typeof AllotmentLetterDataSchema>;

// ---------------------------------------------------------------------------
// Cheques, cancellations
// ---------------------------------------------------------------------------

export const ChequesReportQuerySchema = ListQuerySchema.extend({
  status: z.enum(["PENDING", "BOUNCED"]).default("PENDING"),
  project_id: IdSchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  export: ExportFormatSchema.optional(),
});
export type ChequesReportQuery = z.infer<typeof ChequesReportQuerySchema>;

export const ChequesReportResponseSchema = listEnvelope(ChequeRowSchema).extend({
  totals: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
});
export type ChequesReportResponse = z.infer<typeof ChequesReportResponseSchema>;

export const CancellationsReportQuerySchema = DateRangeSchema.safeExtend({ project_id: IdSchema.optional(), export: ExportFormatSchema.optional() });
export type CancellationsReportQuery = z.infer<typeof CancellationsReportQuerySchema>;

export const CancellationsReportRowSchema = z.object({
  booking_id: IdSchema,
  booking_number: z.string(),
  customer_name: z.string(),
  project_name: z.string(),
  flat_number: z.string(),
  booking_date: DateStringSchema,
  cancelled_at: TimestampSchema,
  cancelled_by_name: z.string().nullable(),
  reason: z.string(),
  paid_paise: PaiseSchema,
  deduction_paise: PaiseSchema,
  refund_paise: PaiseSchema,
});
export type CancellationsReportRow = z.infer<typeof CancellationsReportRowSchema>;

export const CancellationsReportResponseSchema = z.object({
  rows: z.array(CancellationsReportRowSchema),
  totals: z.object({ count: z.int().min(0), paid_paise: PaiseSchema, deduction_paise: PaiseSchema, refund_paise: PaiseSchema }),
});
export type CancellationsReportResponse = z.infer<typeof CancellationsReportResponseSchema>;

// ---------------------------------------------------------------------------
// Sales & leads funnel
// ---------------------------------------------------------------------------

export const SalesFunnelQuerySchema = DateRangeSchema.safeExtend({
  project_id: IdSchema.optional(),
  source: LeadSourceSchema.optional(),
  assigned_user_id: IdSchema.optional(),
  export: ExportFormatSchema.optional(),
});
export type SalesFunnelQuery = z.infer<typeof SalesFunnelQuerySchema>;

export const SalesFunnelResponseSchema = z.object({
  by_stage: z.array(z.object({ stage: LeadStageSchema, count: z.int().min(0) })),
  by_source: z.array(z.object({ source: LeadSourceSchema, leads: z.int().min(0), converted: z.int().min(0), conversion_percent: z.number() })),
  by_salesperson: z.array(
    z.object({
      user_id: IdSchema,
      user_name: z.string(),
      leads: z.int().min(0),
      visits: z.int().min(0),
      bookings: z.int().min(0),
      booking_value_paise: PaiseSchema,
      avg_first_response_hours: z.number().nullable(),
    }),
  ),
  website: z.object({
    enquiries: z.int().min(0),
    brochure_downloads: z.int().min(0),
    site_visits_booked: z.int().min(0),
    site_visits_by_status: z.array(z.object({ status: VisitStatusSchema, count: z.int().min(0) })),
  }),
  avg_response_hours: z.number().nullable(),
  totals: z.object({ leads: z.int().min(0), converted: z.int().min(0), lost: z.int().min(0), bookings: z.int().min(0) }),
});
export type SalesFunnelResponse = z.infer<typeof SalesFunnelResponseSchema>;

// ---------------------------------------------------------------------------
// Bank-wise receipts & activity
// ---------------------------------------------------------------------------

export const BankwiseReceiptsQuerySchema = DateRangeSchema.safeExtend({
  bank_account_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  export: ExportFormatSchema.optional(),
});
export type BankwiseReceiptsQuery = z.infer<typeof BankwiseReceiptsQuerySchema>;

export const BankwiseReceiptsResponseSchema = z.object({
  rows: z.array(
    z.object({
      bank_account_id: IdSchema.nullable(),
      bank_account_label: z.string(),
      count: z.int().min(0),
      amount_paise: PaiseSchema,
      by_mode: z.array(z.object({ mode_code: PaymentModeCodeSchema, amount_paise: PaiseSchema, count: z.int().min(0) })),
    }),
  ),
  totals: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
});
export type BankwiseReceiptsResponse = z.infer<typeof BankwiseReceiptsResponseSchema>;

export const ActivityReportQuerySchema = ListQuerySchema.extend({
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
  kind: z.enum(["LOGIN", "FAILED_LOGIN", "AUDIT"]).default("AUDIT"),
  user_id: IdSchema.optional(),
  entity_type: z.string().max(60).optional(),
  export: ExportFormatSchema.optional(),
});
export type ActivityReportQuery = z.infer<typeof ActivityReportQuerySchema>;

export const ActivityReportRowSchema = z.object({
  at: TimestampSchema,
  kind: z.enum(["LOGIN", "FAILED_LOGIN", "AUDIT"]),
  actor_type: ActorTypeSchema,
  actor_name: z.string().nullable(),
  identifier: z.string().nullable(),
  action: z.string(),
  entity_type: z.string().nullable(),
  entity_id: IdSchema.nullable(),
  ip: z.string().nullable(),
  reason: z.string().nullable(),
});
export type ActivityReportRow = z.infer<typeof ActivityReportRowSchema>;
export const ActivityReportResponseSchema = listEnvelope(ActivityReportRowSchema);
export type ActivityReportResponse = z.infer<typeof ActivityReportResponseSchema>;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const ReportPresetCreateSchema = z.strictObject({
  report_key: ReportKeySchema,
  name: NameSchema,
  params: z.record(z.string(), z.unknown()),
});
export type ReportPresetCreate = z.infer<typeof ReportPresetCreateSchema>;

export const ReportPresetRowSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  report_key: ReportKeySchema,
  name: z.string(),
  params: z.record(z.string(), z.unknown()),
  created_at: TimestampSchema,
});
export type ReportPresetRow = z.infer<typeof ReportPresetRowSchema>;

export const ReportPresetFilterSchema = z.object({ report_key: ReportKeySchema.optional() });
export type ReportPresetFilter = z.infer<typeof ReportPresetFilterSchema>;

// ---------------------------------------------------------------------------
// Dashboards per role
// ---------------------------------------------------------------------------

export const DashboardQuerySchema = z.object({ project_id: IdSchema.optional() });
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

const MonthBucketRow = z.object({ month: z.string(), cash_paise: PaiseSchema, account_paise: PaiseSchema, other_paise: PaiseSchema, total_paise: PaiseSchema });

const ProjectInventoryRow = z.object({
  project_id: IdSchema,
  project_name: z.string(),
  available: z.int().min(0),
  hold: z.int().min(0),
  blocked: z.int().min(0),
  booked: z.int().min(0),
  sold: z.int().min(0),
  total: z.int().min(0),
  construction_percent: z.number(),
});

const DashboardDemandRow = DemandRowSchema.pick({
  id: true,
  demand_number: true,
  booking_number: true,
  customer_name: true,
  project_name: true,
  flat_number: true,
  installment_name: true,
  total_demand_paise: true,
  paid_paise: true,
  due_date: true,
  status: true,
  days_overdue: true,
});

const DashboardVisitRow = z.object({
  visit_id: IdSchema,
  visit_number: z.string(),
  visit_date: DateStringSchema,
  slot_start: z.string(),
  slot_end: z.string(),
  name: z.string(),
  phone: z.string(),
  project_name: z.string(),
  status: VisitStatusSchema,
  visitors: z.int(),
  lead_id: IdSchema.nullable(),
  version: z.int(),
});

/** Owner dashboard. */
export const OwnerDashboardResponseSchema = z.object({
  collections_12m: z.array(MonthBucketRow),
  due_ageing: AgeingAmountsSchema,
  inventory_by_project: z.array(ProjectInventoryRow),
  sales_velocity: z.array(z.object({ month: z.string(), bookings: z.int().min(0), value_paise: PaiseSchema })),
  top_overdue: z.array(TopOverdueRowSchema),
  pending_cheques: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
  enquiries_this_week: z.int().min(0),
  construction_progress: z.array(z.object({ block_id: IdSchema, block_name: z.string(), project_name: z.string(), percent: z.number(), current_stage: z.string().nullable() })),
  dues_raised_this_month: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
  upcoming_installments_30d: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
  totals: z.object({ total_due_paise: SignedPaiseSchema, total_advance_paise: PaiseSchema, collected_this_month_paise: PaiseSchema, active_bookings: z.int().min(0) }),
});
export type OwnerDashboardResponse = z.infer<typeof OwnerDashboardResponseSchema>;

/** Accounts dashboard. */
export const AccountsDashboardResponseSchema = z.object({
  today: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
  this_month: z.object({ count: z.int().min(0), amount_paise: PaiseSchema, by_category: z.array(z.object({ category: MoneyCategorySchema, amount_paise: PaiseSchema })) }),
  cheques_to_clear: z.array(ChequeRowSchema),
  overdue_demands: z.array(DashboardDemandRow),
  bounced_recent: z.array(ChequeRowSchema),
  demand_status_counts: z.array(z.object({ status: DemandStatusSchema, count: z.int().min(0), amount_paise: PaiseSchema })),
});
export type AccountsDashboardResponse = z.infer<typeof AccountsDashboardResponseSchema>;

/** Sales dashboard. */
export const SalesDashboardResponseSchema = z.object({
  pipeline: z.array(z.object({ stage: LeadStageSchema, count: z.int().min(0) })),
  follow_ups_due: z.array(z.object({ lead_id: IdSchema, lead_number: z.string(), full_name: z.string(), phone: z.string(), next_follow_up_at: TimestampSchema, project_name: z.string().nullable() })),
  new_enquiries: z.int().min(0),
  brochure_leads_this_week: z.int().min(0),
  todays_visits: z.array(DashboardVisitRow),
  availability: z.array(ProjectInventoryRow),
  my_bookings: z.object({ this_month: z.int().min(0), value_paise: PaiseSchema, total: z.int().min(0) }),
});
export type SalesDashboardResponse = z.infer<typeof SalesDashboardResponseSchema>;

/** Project Admin dashboard (scoped). */
export const ProjectAdminDashboardResponseSchema = z.object({
  projects: z.array(ProjectInventoryRow),
  construction: z.array(z.object({ block_id: IdSchema, block_name: z.string(), project_name: z.string(), percent: z.number(), current_stage: z.string().nullable(), next_stage: z.string().nullable() })),
  upcoming_stages: z.array(z.object({ block_id: IdSchema, block_name: z.string(), stage_name: z.string(), active_bookings: z.int().min(0), installment_total_paise: PaiseSchema })),
  demands_raised_this_month: z.object({ count: z.int().min(0), amount_paise: PaiseSchema }),
  bookings_this_month: z.int().min(0),
  open_tickets: z.int().min(0),
});
export type ProjectAdminDashboardResponse = z.infer<typeof ProjectAdminDashboardResponseSchema>;

/** Employee dashboard (read-only inventory snapshot). */
export const EmployeeDashboardResponseSchema = z.object({
  projects: z.array(ProjectInventoryRow),
  notices: z.array(z.object({ id: IdSchema, title: z.string(), publish_at: TimestampSchema })),
});
export type EmployeeDashboardResponse = z.infer<typeof EmployeeDashboardResponseSchema>;

/** Dashboard response discriminated by role. */
export const DashboardResponseSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("OWNER"), data: OwnerDashboardResponseSchema }),
  z.object({ role: z.literal("ACCOUNTS"), data: AccountsDashboardResponseSchema }),
  z.object({ role: z.literal("SALES"), data: SalesDashboardResponseSchema }),
  z.object({ role: z.literal("PROJECT_ADMIN"), data: ProjectAdminDashboardResponseSchema }),
  z.object({ role: z.literal("EMPLOYEE"), data: EmployeeDashboardResponseSchema }),
]);
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

// ---------------------------------------------------------------------------
// Command palette search
// ---------------------------------------------------------------------------

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  types: z.array(SearchEntityTypeSchema).max(7).optional(),
  limit: IntQuerySchema.min(1).max(50).default(10),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  type: SearchEntityTypeSchema,
  id: IdSchema,
  label: z.string(),
  sublabel: z.string().nullable(),
  href: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({ results: z.array(SearchResultSchema), recent: z.array(SearchResultSchema) });
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
