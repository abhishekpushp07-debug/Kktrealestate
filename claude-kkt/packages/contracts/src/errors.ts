import { z } from "zod";

/** Every error code the API may return (docs/API-CONVENTIONS.md status map). */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "IDEMPOTENCY_KEY_REQUIRED",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "TOKEN_EXPIRED",
  "INVALID_AUDIENCE",
  "MFA_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "FLAT_NOT_AVAILABLE",
  "BUCKET_CAP_EXCEEDED",
  "IN_USE",
  "SLOT_FULL",
  "PLAN_STAGES_MISSING",
  "UNDO_BLOCKED",
  "DUPLICATE",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "BUSINESS_RULE",
  "IDEMPOTENCY_MISMATCH",
  "PASSWORD_POLICY",
  "LOCKED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "INVALID_TOKEN",
  "SESSION_REVOKED",
  "USER_INACTIVE",
  "TOKEN_REUSED",
  "PASSWORD_CHANGE_REQUIRED",
  "IDEMPOTENCY_IN_PROGRESS",
  "SYSTEM_ROLE",
  // money module (bookings / payments / dues)
  "PLAN_NOT_APPLICABLE",
  "BELOW_PAID",
  "PLAN_CHANGE_BLOCKED",
  "REFUND_EXCEEDS_PAID",
  "PENDING_PAYMENTS",
  "HANDOVER_BLOCKED",
  "BOOKING_NOT_ACTIVE",
  "CHARGE_CAP_EXCEEDED",
  "CASH_INSUFFICIENT",
  "PAYMENT_STATE",
  // codes the API already raised but the registry lacked (audit F; apps/api/test/unit/error-registry.test.ts keeps this in sync)
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "NOT_IMPLEMENTED",
  "SUPER_ADMIN_ONLY",
  "PUBLISH_REQUIREMENTS",
  "DUPLICATE_CUSTOMER",
  "DUPLICATE_LEAD",
  "DUPLICATE_PRESET",
  "HAS_ACTIVE_BOOKING",
  "JOB_ALREADY_RUNNING",
  "ALREADY_DEMANDED",
  "PARKING_NOT_AVAILABLE",
  "PAYMENT_NOT_CLEARED",
  "PAYMENT_NOT_PENDING",
  "REGENERATE_BLOCKED",
  "UNDO_NOT_LATEST",
  "TICKET_CLOSED",
  "REOPEN_WINDOW_CLOSED",
  "ALREADY_RATED",
  "KYC_INCOMPLETE",
  "KYC_TRANSITION_INVALID",
  "LINK_EXPIRED",
  "BOOKING_COMPLETED",
  "VERSION_REQUIRED",
  "LOCK_TIMEOUT",
  "CONFLICT_RETRY",
  "EXPORT_NOT_READY",
  "GONE",
  "IDEMPOTENT_SECRET_REPLAY",
  // phase 7 foundation: database constraint mapping, domain money errors, tenant resolution (contract C4)
  "CONSTRAINT_VIOLATION",
  "INVALID_AMOUNT",
  "COMPANY_REQUIRED",
  // phase 7 security track: a refresh-token family past its absolute lifetime (contract C1)
  "SESSION_EXPIRED",
  // phase 7 money track: a stage undo would rewrite a cancelled / handed-over booking (details.bookings)
  "BOOKING_CLOSED",
  // phase 7 platform track: malformed / foreign keyset cursor; a retried write whose first attempt committed but whose answer was lost
  "INVALID_CURSOR",
  "IDEMPOTENT_OUTCOME_UNKNOWN",
  // phase 7 domain track: regenerate / structural block edit would delete flats that have bookings (details.flats)
  "FLAT_HAS_BOOKING_HISTORY",
  // phase 7 domain track: a master CSV import whose header names unknown / misnamed columns (details.unknown_columns, expected_columns)
  "IMPORT_UNKNOWN_COLUMNS",
] as const;

/** An error code literal. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Zod schema for a known error code. */
export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** HTTP status for every error code. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  INVALID_AUDIENCE: 401,
  MFA_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  FLAT_NOT_AVAILABLE: 409,
  BUCKET_CAP_EXCEEDED: 409,
  IN_USE: 409,
  SLOT_FULL: 409,
  PLAN_STAGES_MISSING: 409,
  UNDO_BLOCKED: 409,
  DUPLICATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BUSINESS_RULE: 422,
  IDEMPOTENCY_MISMATCH: 422,
  PASSWORD_POLICY: 422,
  LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  INVALID_TOKEN: 401,
  SESSION_REVOKED: 401,
  USER_INACTIVE: 401,
  TOKEN_REUSED: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  IDEMPOTENCY_IN_PROGRESS: 409,
  SYSTEM_ROLE: 409,
  PLAN_NOT_APPLICABLE: 409,
  BELOW_PAID: 409,
  PLAN_CHANGE_BLOCKED: 409,
  REFUND_EXCEEDS_PAID: 409,
  PENDING_PAYMENTS: 409,
  HANDOVER_BLOCKED: 409,
  BOOKING_NOT_ACTIVE: 409,
  CHARGE_CAP_EXCEEDED: 409,
  CASH_INSUFFICIENT: 409,
  PAYMENT_STATE: 409,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  NOT_IMPLEMENTED: 501,
  SUPER_ADMIN_ONLY: 403,
  PUBLISH_REQUIREMENTS: 422,
  DUPLICATE_CUSTOMER: 409,
  DUPLICATE_LEAD: 409,
  DUPLICATE_PRESET: 409,
  HAS_ACTIVE_BOOKING: 409,
  JOB_ALREADY_RUNNING: 409,
  ALREADY_DEMANDED: 409,
  PARKING_NOT_AVAILABLE: 409,
  PAYMENT_NOT_CLEARED: 409,
  PAYMENT_NOT_PENDING: 409,
  REGENERATE_BLOCKED: 409,
  UNDO_NOT_LATEST: 409,
  TICKET_CLOSED: 409,
  REOPEN_WINDOW_CLOSED: 409,
  ALREADY_RATED: 409,
  KYC_INCOMPLETE: 422,
  KYC_TRANSITION_INVALID: 409,
  LINK_EXPIRED: 410,
  BOOKING_COMPLETED: 409,
  // 428 Precondition Required (contract C6): a write of a versioned resource without If-Match / version / expected_version
  VERSION_REQUIRED: 428,
  LOCK_TIMEOUT: 409,
  CONFLICT_RETRY: 409,
  EXPORT_NOT_READY: 409,
  GONE: 410,
  IDEMPOTENT_SECRET_REPLAY: 409,
  CONSTRAINT_VIOLATION: 422,
  INVALID_AMOUNT: 422,
  COMPANY_REQUIRED: 400,
  SESSION_EXPIRED: 401,
  BOOKING_CLOSED: 409,
  INVALID_CURSOR: 400,
  IDEMPOTENT_OUTCOME_UNKNOWN: 409,
  FLAT_HAS_BOOKING_HISTORY: 409,
  IMPORT_UNKNOWN_COLUMNS: 422,
};

/** Returns the HTTP status for an error code. */
export function statusForError(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

/**
 * Shape of `details` for VERSION_CONFLICT. `current_version` (contract C6) and the older `current` carry the same number: the version
 * the record is at now (re-read it, or send this version to overwrite deliberately).
 */
export const VersionConflictDetailsSchema = z.object({
  current: z.int().min(1),
  current_version: z.int().min(1).optional(),
  changed_by: z.string().nullable(),
  changed_at: z.string().nullable().optional(),
});
export type VersionConflictDetails = z.infer<typeof VersionConflictDetailsSchema>;

/**
 * Shape of `details` for IN_USE. Masters' deactivation guard sends `usage_count` and `used_by` (kinds of usage); a row whose delete or
 * re-key a foreign key refused (database 23503) also names the `constraint` and the referencing table (`referenced_by`).
 */
export const InUseDetailsSchema = z.object({
  usage_count: z.int().min(0),
  used_by: z.array(z.string()).optional(),
  constraint: z.string().nullable().optional(),
  referenced_by: z.string().nullable().optional(),
});
export type InUseDetails = z.infer<typeof InUseDetailsSchema>;

/** Shape of `details` for PLAN_STAGES_MISSING. */
export const PlanStagesMissingDetailsSchema = z.object({ missing_stages: z.array(z.string()) });
export type PlanStagesMissingDetails = z.infer<typeof PlanStagesMissingDetailsSchema>;

/**
 * Shape of `details` for BUCKET_CAP_EXCEEDED, exactly what the API sends (apps/api/src/modules/money/services/payments.ts, at posting
 * and at cheque clearing): the bucket's agreed amount, what it has already received (CLEARED), the amount refused and the headroom
 * left (agreed − paid, never negative). Other-charge lines refuse with CHARGE_CAP_EXCEEDED instead.
 */
export const BucketCapDetailsSchema = z.object({
  bucket: z.enum(["CASH", "ACCOUNT"]),
  agreed_paise: z.int(),
  paid_paise: z.int(),
  amount_paise: z.int(),
  headroom_paise: z.int(),
});
export type BucketCapDetails = z.infer<typeof BucketCapDetailsSchema>;

/** Shape of `details` for BUSINESS_RULE: `rule` is one of BUSINESS_RULES (rules.ts); clients treat an unknown id like a generic 422. */
export const BusinessRuleDetailsSchema = z.object({ rule: z.string() }).catchall(z.unknown());

/**
 * Shape of `details` for CONSTRAINT_VIOLATION (422): the database refused a value. `kind` says which rule: a CHECK constraint, a
 * reference to a row that does not exist (`references` = its table), or a missing required column.
 */
export const ConstraintViolationDetailsSchema = z.object({
  kind: z.enum(["check", "foreign_key", "not_null"]),
  constraint: z.string().nullable(),
  table: z.string().nullable(),
  references: z.string().nullable().optional(),
  column: z.string().nullable().optional(),
});
export type ConstraintViolationDetails = z.infer<typeof ConstraintViolationDetailsSchema>;
export type BusinessRuleDetails = z.infer<typeof BusinessRuleDetailsSchema>;

/** Shape of `details` for VALIDATION_ERROR. */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export const ValidationErrorDetailsSchema = z.object({ issues: z.array(ValidationIssueSchema) });
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetailsSchema>;

/** True when `code` is one of the documented {@link ERROR_CODES}. */
export function isKnownErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Error code as it appears on the wire: any UPPER_SNAKE string. Clients must never fail to parse an error because a newer server sends a
 * code they do not know yet (they show the server's message and branch only on codes they know); {@link ErrorCode} stays the documented
 * union for exhaustive handling and autocompletion.
 */
export const WireErrorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "error codes are UPPER_SNAKE") as unknown as z.ZodType<ErrorCode | (string & {})>;

/** The error envelope every failing response carries. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: WireErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Returns true when an unknown JSON value is a well-formed API error envelope. */
export function isApiError(value: unknown): value is ApiError {
  return ApiErrorSchema.safeParse(value).success;
}
