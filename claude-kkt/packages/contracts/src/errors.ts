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
  MFA_REQUIRED: 401,
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

/** The error envelope every failing response carries. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
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
