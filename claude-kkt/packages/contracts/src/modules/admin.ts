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

const NumberingScopeSchema = z.strictObject({ prefix: z.string().trim().max(10), format: z.string().trim().max(40).optional() });

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
    default_gst_percent: z.number().min(0).max(100).default(5),
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
