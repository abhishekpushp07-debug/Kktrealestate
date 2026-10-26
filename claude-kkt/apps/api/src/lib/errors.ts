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

/** SQLSTATE codes / driver error codes the error handler maps instead of answering 500. */
const PG_STATEMENT_TIMEOUT = "57014";
const PG_LOCK_TIMEOUT = "55P03";
const PG_RETRYABLE = new Set(["40001", "40P01"]);
/** Connection-level failures: Postgres refusing or dropping connections, the pool's connect timeout, sockets dying. */
const PG_UNAVAILABLE = new Set(["53300", "53400", "57P01", "57P02", "57P03", "58000", "58030"]);
const DRIVER_UNAVAILABLE = new Set(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);
/** Codes only the Postgres driver (postgres.js) raises: these are database failures for sure. */
const POSTGRES_DRIVER_UNAVAILABLE = new Set(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"]);

/** The SQLSTATE (5 chars) or driver/socket error code of a database failure, following Drizzle's `cause` wrappers. */
export function databaseErrorCode(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== "object" || depth > 5) return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || DRIVER_UNAVAILABLE.has(code))) return code;
  return databaseErrorCode((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * Maps database failures that are not bugs onto retryable envelopes (audit C7): statement timeout and connection/pool trouble → 503
 * SERVICE_UNAVAILABLE with Retry-After 5; lock timeout → 409 LOCK_TIMEOUT; a serialization failure or deadlock that escaped
 * withTransactionRetry → 409 CONFLICT_RETRY. `details.retryable` is true for all of them. Null for anything else.
 */
export function mapDatabaseError(err: unknown): ApiError | null {
  const code = databaseErrorCode(err);
  if (!code) return null;
  if (code === PG_STATEMENT_TIMEOUT) return new ApiError(503, "SERVICE_UNAVAILABLE", "The database took too long to answer; retry shortly", { retry_after: 5, retryable: true, reason: "statement_timeout" }, { "Retry-After": "5" });
  if (code === PG_LOCK_TIMEOUT) return new ApiError(409, "LOCK_TIMEOUT", "The record is being changed by another request; retry in a moment", { retryable: true, retry_after: 1 }, { "Retry-After": "1" });
  if (PG_RETRYABLE.has(code)) return new ApiError(409, "CONFLICT_RETRY", "A concurrent change conflicted with this one; retry the request", { retryable: true, sqlstate: code }, { "Retry-After": "1" });
  if (PG_UNAVAILABLE.has(code) || code.startsWith("08") || POSTGRES_DRIVER_UNAVAILABLE.has(code)) return new ApiError(503, "SERVICE_UNAVAILABLE", "The database is unavailable; retry shortly", { retry_after: 5, retryable: true, reason: "database_unavailable" }, { "Retry-After": "5" });
  // plain socket codes can come from any dependency (database, Redis, object store): do not blame the database
  if (DRIVER_UNAVAILABLE.has(code)) return new ApiError(503, "SERVICE_UNAVAILABLE", "A backing service is unavailable; retry shortly", { retry_after: 5, retryable: true, reason: "dependency_unavailable" }, { "Retry-After": "5" });
  return null;
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
  const mapped = mapDatabaseError(error);
  if (mapped) {
    request.log.warn({ err: error, code: mapped.code }, "database error mapped to a retryable response");
    errorHandler(mapped, request, reply);
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
