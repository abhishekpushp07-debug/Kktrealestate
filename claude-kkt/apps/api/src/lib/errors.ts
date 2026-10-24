import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";

/** Application error with a stable machine-readable code (see docs/API-CONVENTIONS.md). */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;
  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>, headers?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
  static badRequest(message: string, details?: Record<string, unknown>) { return new ApiError(400, "VALIDATION_ERROR", message, details); }
  static unauthenticated(message = "Not authenticated", code = "UNAUTHENTICATED") { return new ApiError(401, code, message); }
  static forbidden(message = "Forbidden", details?: Record<string, unknown>) { return new ApiError(403, "FORBIDDEN", message, details); }
  static notFound(entity = "Resource") { return new ApiError(404, "NOT_FOUND", `${entity} not found`); }
  static conflict(code: string, message: string, details?: Record<string, unknown>) { return new ApiError(409, code, message, details); }
  static rule(message: string, rule: string, details?: Record<string, unknown>) { return new ApiError(422, "BUSINESS_RULE", message, { rule, ...(details ?? {}) }); }
  static locked(message: string, details?: Record<string, unknown>) { return new ApiError(423, "LOCKED", message, details); }
  static unavailable(message: string, retryAfterSeconds = 5) {
    return new ApiError(503, "SERVICE_UNAVAILABLE", message, { retry_after: retryAfterSeconds }, { "Retry-After": String(retryAfterSeconds) });
  }
  static rateLimited(retryAfterSeconds: number) {
    return new ApiError(429, "RATE_LIMITED", `Too many requests. Retry in ${retryAfterSeconds}s.`, { retry_after: retryAfterSeconds }, { "Retry-After": String(retryAfterSeconds) });
  }
}

/** Shape of every error body. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown>; request_id?: string };
}

const STATUS_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 422: "BUSINESS_RULE", 423: "LOCKED", 429: "RATE_LIMITED", 503: "SERVICE_UNAVAILABLE",
};

/** One validation issue as carried in `details.issues` (contracts ValidationIssueSchema). */
interface ValidationIssue { path: string; message: string; code?: string }

/** Maps fastify-type-provider-zod validation failures onto the contract's `{ path, message, code }` issues. */
function validationIssues(validation: readonly { instancePath?: string; message?: string; params?: Record<string, unknown> }[]): ValidationIssue[] {
  return validation.map((v) => {
    const issue = v.params?.["issue"] as { path?: unknown[]; message?: string; code?: string } | undefined;
    const fromIssue = issue?.path?.map(String).join(".");
    const fromInstance = String(v.instancePath ?? "").replace(/^\//, "").replace(/\//g, ".");
    const out: ValidationIssue = { path: fromInstance || fromIssue || "", message: v.message ?? issue?.message ?? "Invalid value" };
    if (issue?.code) out.code = issue.code;
    return out;
  });
}

/** Fastify error handler: every failure becomes `{ error: { code, message, details, request_id } }`. */
export function errorHandler(error: FastifyError | ApiError | Error, request: FastifyRequest, reply: FastifyReply): void {
  const requestId = request.id;
  if (error instanceof ApiError) {
    if (error.headers) reply.headers(error.headers);
    reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details, request_id: requestId } } satisfies ApiErrorBody);
    return;
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const issues = validationIssues(error.validation as readonly { instancePath?: string; message?: string; params?: Record<string, unknown> }[]);
    reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).slice(0, 5).join("; ") || "Validation error", details: { issues }, request_id: requestId } } satisfies ApiErrorBody);
    return;
  }
  if (isResponseSerializationError(error)) {
    request.log.error({ err: error, issues: error.cause?.issues }, "response serialization failed");
    reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Response did not match its schema", request_id: requestId } });
    return;
  }
  const fe = error as FastifyError;
  const status = typeof fe.statusCode === "number" && fe.statusCode >= 400 ? fe.statusCode : 500;
  if (status === 503) {
    // Load shedding (@fastify/under-pressure) keeps its Retry-After header; the body gets the uniform envelope.
    if (!reply.hasHeader("Retry-After")) reply.header("Retry-After", "10");
    reply.status(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: fe.message || "Service unavailable, retry shortly", request_id: requestId } } satisfies ApiErrorBody);
    return;
  }
  if (status >= 500) {
    request.log.error({ err: error }, "unhandled error");
    reply.status(status).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", request_id: requestId } } satisfies ApiErrorBody);
    return;
  }
  const code = fe.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : fe.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ? "UNSUPPORTED_MEDIA_TYPE" : (STATUS_CODES[status] ?? "ERROR");
  reply.status(status).send({ error: { code, message: fe.message, request_id: requestId } } satisfies ApiErrorBody);
}

/** 404 for unknown routes (keeps the same envelope). */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  reply.status(404).send({ error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.url.split("?")[0]} not found`, request_id: request.id } });
}
