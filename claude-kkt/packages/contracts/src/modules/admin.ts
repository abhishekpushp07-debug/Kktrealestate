import { z } from "zod";
import { ActorTypeSchema, JobNameSchema, JobRunStatusSchema } from "../enums.js";
import {
  AddressSchema,
  DateStringSchema,
  EmailSchema,
  GSTINSchema,
  IdSchema,
  ListQuerySchema,
  NameSchema,
  PhoneSchema,
  ReasonSchema,
  SignedLinkSchema,
  SignedPaiseSchema,
  TimestampSchema,
  UrlSchema,
  VersionSchema,
  listEnvelope,
  updateOf,
} from "../common.js";
import { IntegrityReportResponseSchema } from "./dues.js";

/** Full backup export (Super Admin). */
export const AdminBackupResponseSchema = SignedLinkSchema.extend({
  file_name: z.string(),
  size_bytes: z.int().min(0).nullable(),
  generated_at: TimestampSchema,
});
export type AdminBackupResponse = z.infer<typeof AdminBackupResponseSchema>;

/** Guarded reseed: restores the demo state. */
export const AdminReseedRequestSchema = z.strictObject({ confirm: z.literal("RESEED") });
export type AdminReseedRequest = z.infer<typeof AdminReseedRequestSchema>;

export const AdminReseedResponseSchema = z.object({
  started_at: TimestampSchema,
  finished_at: TimestampSchema,
  counts: z.record(z.string(), z.int().min(0)),
  integrity: IntegrityReportResponseSchema,
});
export type AdminReseedResponse = z.infer<typeof AdminReseedResponseSchema>;

/** Recompute booking summaries and ledgers from source records. */
export const AdminRecomputeRequestSchema = z
  .strictObject({
    booking_id: IdSchema.optional(),
    project_id: IdSchema.optional(),
    all: z.boolean().default(false),
  })
  .refine((r) => r.all || r.booking_id !== undefined || r.project_id !== undefined, {
    message: "Give booking_id, project_id or all=true",
    path: ["all"],
  });
export type AdminRecomputeRequest = z.infer<typeof AdminRecomputeRequestSchema>;

export const AdminRecomputeMismatchSchema = z.object({
  booking_id: IdSchema,
  booking_number: z.string(),
  field: z.string(),
  stored: SignedPaiseSchema,
  recomputed: SignedPaiseSchema,
});
export type AdminRecomputeMismatch = z.infer<typeof AdminRecomputeMismatchSchema>;

export const AdminRecomputeResponseSchema = z.object({
  bookings_rebuilt: z.int().min(0),
  ledger_rows_rewritten: z.int().min(0),
  mismatches_found: z.array(AdminRecomputeMismatchSchema),
});
export type AdminRecomputeResponse = z.infer<typeof AdminRecomputeResponseSchema>;

/** Trigger a background job now. */
export const AdminJobTriggerSchema = z.strictObject({ job_name: JobNameSchema });
export type AdminJobTrigger = z.infer<typeof AdminJobTriggerSchema>;

export const AdminJobRunRowSchema = z.object({
  id: IdSchema,
  job_name: z.string(),
  started_at: TimestampSchema,
  finished_at: TimestampSchema.nullable(),
  status: JobRunStatusSchema,
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
});
export type AdminJobRunRow = z.infer<typeof AdminJobRunRowSchema>;
export const AdminJobRunFilterSchema = ListQuerySchema.extend({ job_name: JobNameSchema.optional(), status: JobRunStatusSchema.optional() });
export type AdminJobRunFilter = z.infer<typeof AdminJobRunFilterSchema>;
export const AdminJobRunListResponseSchema = listEnvelope(AdminJobRunRowSchema);
export type AdminJobRunListResponse = z.infer<typeof AdminJobRunListResponseSchema>;

/** Right to erasure (admin side). */
export const AdminErasureRequestSchema = z.strictObject({ customer_id: IdSchema, confirm: z.literal("ERASE"), reason: ReasonSchema });
export type AdminErasureRequest = z.infer<typeof AdminErasureRequestSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const AuditLogRowSchema = z.object({
  id: IdSchema,
  actor_type: ActorTypeSchema,
  actor_id: IdSchema.nullable(),
  actor_name: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: IdSchema.nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  request_id: z.string().nullable(),
  created_at: TimestampSchema,
});
export type AuditLogRow = z.infer<typeof AuditLogRowSchema>;

export const AuditLogFilterSchema = ListQuerySchema.extend({
  actor_type: ActorTypeSchema.optional(),
  actor_id: IdSchema.optional(),
  action: z.string().max(80).optional(),
  entity_type: z.string().max(60).optional(),
  entity_id: IdSchema.optional(),
  from: DateStringSchema.optional(),
  to: DateStringSchema.optional(),
});
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
export const AuditLogListResponseSchema = listEnvelope(AuditLogRowSchema);
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

/** Characters allowed in a document-number prefix (SPEC §2: CUST-, BK-, SGB/ …): letters, digits, slash, dash, underscore, dot. */
export const NUMBER_PREFIX_RE = /^[A-Za-z0-9/_.-]*$/;
export const NumberPrefixSchema = z.string().trim().max(10).regex(NUMBER_PREFIX_RE, "Prefix may only contain letters, digits, / - _ .");
export type NumberPrefix = z.infer<typeof NumberPrefixSchema>;

const NUMBER_FORMAT_TOKEN_RE = /\{(prefix|fy|seq(?::\d{1,2})?)\}/g;
/**
 * Number pattern (default `{prefix}{fy}/{seq:4}`): must contain exactly one `{seq}`/`{seq:N}` token; only `{prefix}`, `{fy}` and `{seq}`
 * tokens plus letters, digits, / - _ . are allowed, so a saved pattern can never make the numbering engine throw.
 */
export const NumberFormatSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((f) => (f.match(/\{seq(?::\d{1,2})?\}/g) ?? []).length === 1, "Pattern needs exactly one {seq} or {seq:N} token")
  .refine((f) => NUMBER_PREFIX_RE.test(f.replace(NUMBER_FORMAT_TOKEN_RE, "")), "Pattern may only contain {prefix}, {fy}, {seq:N} and letters, digits, / - _ .");
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

const NumberingScopeSchema = z.strictObject({ prefix: NumberPrefixSchema, format: NumberFormatSchema.optional() });

const CompanySettingsBase = z.strictObject({
  name: NameSchema,
  legal_name: NameSchema.optional().nullable(),
  gstin: GSTINSchema.optional().nullable(),
  phone: PhoneSchema.optional().nullable(),
  email: EmailSchema.optional().nullable(),
  address: AddressSchema.optional().nullable(),
  logo_document_id: IdSchema.optional().nullable(),
  letterhead: z.strictObject({
    tagline: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    email: EmailSchema.optional().nullable(),
    website: UrlSchema.optional().nullable(),
    signatory_name: z.string().trim().max(120).optional().nullable(),
    signatory_title: z.string().trim().max(120).optional().nullable(),
  }),
  fy_start_month: z.int().min(1).max(12).default(4),
  numbering: z.strictObject({
    customer: NumberingScopeSchema,
    booking: NumberingScopeSchema,
    demand: NumberingScopeSchema,
    receipt: NumberingScopeSchema,
    ticket: NumberingScopeSchema,
    visit: NumberingScopeSchema,
  }),
  settings: z.strictObject({
    demand_due_days: z.int().min(0).max(365).default(15),
    default_gst_percent: z.number().min(0).max(28, "GST cannot exceed 28 %").default(5),
    round_robin_enabled: z.boolean().default(true),
    force_mfa_for_admins: z.boolean().default(false),
    sla_hours: z.strictObject({
      LOW: z.int().min(1).max(720).default(72),
      MEDIUM: z.int().min(1).max(720).default(48),
      HIGH: z.int().min(1).max(720).default(24),
      URGENT: z.int().min(1).max(720).default(8),
    }),
    booking_hold_hours: z.int().min(1).max(720).default(48),
  }),
});

/** Update company settings (partial + version). */
export const CompanySettingsUpdateSchema = updateOf(CompanySettingsBase);
export type CompanySettingsUpdate = z.infer<typeof CompanySettingsUpdateSchema>;

/** SLA hours per priority, every key optional (no defaults) — for merge-style patches. */
const SlaHoursPatchSchema = z.strictObject({
  LOW: z.int().min(1).max(720).optional(),
  MEDIUM: z.int().min(1).max(720).optional(),
  HIGH: z.int().min(1).max(720).optional(),
  URGENT: z.int().min(1).max(720).optional(),
});

/**
 * Merge-style PATCH /settings/company body: like CompanySettingsUpdateSchema but `numbering` scopes and `settings` keys are optional with NO
 * defaults, so `{ settings: { sla_hours: { HIGH: 12 } } }` changes one value and leaves every other stored setting untouched (the API
 * merges onto the current row and validates the result against CompanySettingsRowSchema).
 */
export const CompanySettingsPatchSchema = updateOf(
  CompanySettingsBase.extend({
    numbering: z.strictObject({
      customer: NumberingScopeSchema.optional(),
      booking: NumberingScopeSchema.optional(),
      demand: NumberingScopeSchema.optional(),
      receipt: NumberingScopeSchema.optional(),
      ticket: NumberingScopeSchema.optional(),
      visit: NumberingScopeSchema.optional(),
    }),
    settings: z.strictObject({
      demand_due_days: z.int().min(0).max(365).optional(),
      default_gst_percent: z.number().min(0).max(28, "GST cannot exceed 28 %").optional(),
      round_robin_enabled: z.boolean().optional(),
      force_mfa_for_admins: z.boolean().optional(),
      sla_hours: SlaHoursPatchSchema.optional(),
      booking_hold_hours: z.int().min(1).max(720).optional(),
    }),
  }),
);
export type CompanySettingsPatch = z.infer<typeof CompanySettingsPatchSchema>;

/** The complete, strict numbering + settings objects as stored on the company row (what a merged patch must satisfy). */
export const CompanyNumberingSchema = CompanySettingsBase.shape.numbering;
export type CompanyNumbering = z.infer<typeof CompanyNumberingSchema>;
export const CompanySettingsValuesSchema = CompanySettingsBase.shape.settings;
export type CompanySettingsValues = z.infer<typeof CompanySettingsValuesSchema>;

export const CompanySettingsRowSchema = CompanySettingsBase.extend({
  id: IdSchema,
  logo_url: z.string().nullable(),
  updated_at: TimestampSchema,
  version: VersionSchema,
});
export type CompanySettingsRow = z.infer<typeof CompanySettingsRowSchema>;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptime_seconds: z.number().min(0),
  checks: z.object({ database: z.boolean(), redis: z.boolean(), storage: z.boolean() }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------------------------------------------------------------------------
// Admin tools (module `admin`): settings preview, backup, reconcile, jobs, erasure, system — additive to the schemas above.
// ---------------------------------------------------------------------------

/** Preview of the next document number per numbering scope for the current financial year. */
export const AdminNumberingPreviewSchema = z.object({
  scope: z.enum(["customer", "booking", "demand", "receipt", "ticket", "visit"]),
  fy: z.string(),
  last_sequence: z.int().min(0),
  next_number: z.string(),
});
export type AdminNumberingPreview = z.infer<typeof AdminNumberingPreviewSchema>;

/** GET/PATCH /settings/company response: the company row plus the numbering preview. */
export const CompanySettingsResponseSchema = CompanySettingsRowSchema.extend({ numbering_preview: z.array(AdminNumberingPreviewSchema) });
export type CompanySettingsResponse = z.infer<typeof CompanySettingsResponseSchema>;

/** POST /admin/backup body. */
export const AdminBackupRequestSchema = z.strictObject({ include_sensitive: z.boolean().default(false) });
export type AdminBackupRequest = z.infer<typeof AdminBackupRequestSchema>;

/** One stored backup (kept 24 h). */
export const AdminBackupRowSchema = z.object({
  id: IdSchema,
  file_name: z.string(),
  size_bytes: z.int().min(0),
  generated_at: TimestampSchema,
  storage_expires_at: TimestampSchema,
  include_sensitive: z.boolean(),
  table_count: z.int().min(0),
  row_count: z.int().min(0),
  generated_by: z.string().nullable(),
});
export type AdminBackupRow = z.infer<typeof AdminBackupRowSchema>;

/** POST /admin/backup response: the signed 15-minute link plus the stored entry. */
export const AdminBackupCreatedResponseSchema = AdminBackupResponseSchema.extend({
  id: IdSchema,
  storage_expires_at: TimestampSchema,
  include_sensitive: z.boolean(),
  table_count: z.int().min(0),
  row_count: z.int().min(0),
});
export type AdminBackupCreatedResponse = z.infer<typeof AdminBackupCreatedResponseSchema>;

export const AdminBackupListResponseSchema = z.object({ items: z.array(AdminBackupRowSchema) });
export type AdminBackupListResponse = z.infer<typeof AdminBackupListResponseSchema>;

/** POST /admin/reconcile body (dry run of recompute; defaults to every booking in scope). */
export const AdminReconcileRequestSchema = z.strictObject({
  booking_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  all: z.boolean().default(true),
});
export type AdminReconcileRequest = z.infer<typeof AdminReconcileRequestSchema>;

export const AdminReconcileResponseSchema = z.object({
  bookings_checked: z.int().min(0),
  bookings_with_mismatches: z.int().min(0),
  mismatches: z.array(AdminRecomputeMismatchSchema),
});
export type AdminReconcileResponse = z.infer<typeof AdminReconcileResponseSchema>;

/** One job as known to the registry (schedule + handler presence + last run). */
export const AdminJobInfoSchema = z.object({
  name: JobNameSchema,
  registered: z.boolean(),
  cron: z.string().nullable(),
  tz: z.string().nullable(),
  last_run: AdminJobRunRowSchema.nullable(),
});
export type AdminJobInfo = z.infer<typeof AdminJobInfoSchema>;

export const AdminJobsResponseSchema = z.object({
  jobs: z.array(AdminJobInfoSchema),
  recent_runs: z.array(AdminJobRunRowSchema),
  /** Related admin actions that live in other modules (e.g. the money module's "run dues now"). */
  links: z.record(z.string(), z.string()),
});
export type AdminJobsResponse = z.infer<typeof AdminJobsResponseSchema>;

export const AdminJobNameParamsSchema = z.object({ name: JobNameSchema });
export type AdminJobNameParams = z.infer<typeof AdminJobNameParamsSchema>;

/** POST /admin/jobs/:name/run body (optional payload handed to the handler). */
export const AdminJobRunNowRequestSchema = z.strictObject({ data: z.record(z.string(), z.unknown()).optional() });
export type AdminJobRunNowRequest = z.infer<typeof AdminJobRunNowRequestSchema>;

/** POST /admin/customers/:id/erase body. */
export const AdminCustomerEraseRequestSchema = z.strictObject({ confirm: z.literal("ERASE"), reason: ReasonSchema.optional() });
export type AdminCustomerEraseRequest = z.infer<typeof AdminCustomerEraseRequestSchema>;

export const AdminCustomerEraseResponseSchema = z.object({
  id: IdSchema,
  customer_code: z.string(),
  full_name: z.string(),
  erased_at: TimestampSchema,
  version: VersionSchema,
  anonymised: z.object({
    co_applicants: z.int().min(0),
    documents: z.int().min(0),
    leads: z.int().min(0),
    site_visits: z.int().min(0).default(0),
    enquiries: z.int().min(0).default(0),
    testimonials: z.int().min(0).default(0),
    portal_disabled: z.boolean(),
    sessions_revoked: z.int().min(0),
  }),
  financial_rows_kept: z.object({ bookings: z.int().min(0), payments: z.int().min(0), demands: z.int().min(0).default(0), ledger_entries: z.int().min(0).default(0) }),
});
export type AdminCustomerEraseResponse = z.infer<typeof AdminCustomerEraseResponseSchema>;

/** GET /admin/system. */
export const AdminSystemResponseSchema = z.object({
  app_version: z.string(),
  node_version: z.string(),
  postgres_version: z.string().nullable(),
  redis_version: z.string().nullable(),
  uptime_seconds: z.number().min(0),
  started_at: TimestampSchema,
  modules: z.array(z.string()),
  database: z.object({
    name: z.string().nullable(),
    size_bytes: z.int().min(0).nullable(),
    size_pretty: z.string().nullable(),
    table_count: z.int().min(0),
    /** Planner estimates (pg_stat_user_tables.n_live_tup), not exact counts. */
    table_rows_estimated: z.record(z.string(), z.int().min(0)),
  }),
  redis: z.object({ used_memory_bytes: z.int().min(0).nullable(), connected_clients: z.int().min(0).nullable() }),
  jobs: z.object({
    registered: z.array(z.string()),
    runs_last_24h: z.int().min(0),
    failed_last_24h: z.int().min(0),
    last_runs: z.array(AdminJobRunRowSchema),
  }),
});
export type AdminSystemResponse = z.infer<typeof AdminSystemResponseSchema>;
