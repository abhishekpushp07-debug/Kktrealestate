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
  "VERSION_REQUIRED", "LOCK_TIMEOUT", "CONFLICT_RETRY", "EXPORT_NOT_READY",
  "GONE",
  "IDEMPOTENT_SECRET_REPLAY",
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
  VERSION_REQUIRED: 400, LOCK_TIMEOUT: 409, CONFLICT_RETRY: 409, EXPORT_NOT_READY: 409,
  GONE: 410,
  IDEMPOTENT_SECRET_REPLAY: 409,
};

/** Returns the HTTP status for an error code. */
export function statusForError(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

/** Shape of `details` for VERSION_CONFLICT. */
export const VersionConflictDetailsSchema = z.object({
  current: z.int().min(1),
  changed_by: z.string().nullable(),
  changed_at: z.string().nullable().optional(),
});
export type VersionConflictDetails = z.infer<typeof VersionConflictDetailsSchema>;

/** Shape of `details` for IN_USE. */
export const InUseDetailsSchema = z.object({ usage_count: z.int().min(0), used_by: z.array(z.string()).optional() });
export type InUseDetails = z.infer<typeof InUseDetailsSchema>;

/** Shape of `details` for PLAN_STAGES_MISSING. */
export const PlanStagesMissingDetailsSchema = z.object({ missing_stages: z.array(z.string()) });
export type PlanStagesMissingDetails = z.infer<typeof PlanStagesMissingDetailsSchema>;

/** Shape of `details` for BUCKET_CAP_EXCEEDED. */
export const BucketCapDetailsSchema = z.object({
  bucket: z.enum(["CASH", "ACCOUNT", "OTHER_CHARGE"]),
  agreed_paise: z.int(),
  received_paise: z.int(),
  attempted_paise: z.int(),
  headroom_paise: z.int(),
});
export type BucketCapDetails = z.infer<typeof BucketCapDetailsSchema>;

/** Shape of `details` for BUSINESS_RULE. */
export const BusinessRuleDetailsSchema = z.object({ rule: z.string() }).catchall(z.unknown());
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
export const WireErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, "error codes are UPPER_SNAKE") as unknown as z.ZodType<ErrorCode | (string & {})>;

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
