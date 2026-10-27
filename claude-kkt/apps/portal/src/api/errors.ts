// Error model of the portal API client (pure: no React Native imports, unit-tested in test/errors.test.ts).
//  - The server's error envelope { error: { code, message, details?, request_id? } } becomes an ApiError. Codes the app does not know
//    (a newer server, codes added after this build) keep the server's own message instead of a generic "Something went wrong".
//  - Bodies that are not the envelope (a proxy's 502 page, Fastify's default { statusCode, error, message }) still surface a message.
import { isApiError, type ErrorCode } from "@kkt/contracts";

/** Documented codes, the two client-side ones, and any code a newer server may send (shown with the server's message). */
export type ClientErrorCode = ErrorCode | "NETWORK" | "UNKNOWN" | (string & {});

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: Record<string, unknown>;
  readonly requestId: string | undefined;
  /** OpenTelemetry trace id (error.trace_id / X-Trace-Id) when the API runs with tracing on. */
  readonly traceId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: ClientErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
    traceId?: string;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId;
    this.traceId = init.traceId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isNetwork(): boolean {
    return this.code === "NETWORK";
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiErrorInstance(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** A human message for any thrown value. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ApiError && e.code === "GONE") {
    // a retired operation (410): this build is too old for the server
    return `${e.message || "This feature is no longer available."} Please update the app.`;
  }
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** "Ref <request id> · trace <trace id>" for support, or null. */
export function errorReference(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const parts = [e.requestId ? `Ref ${e.requestId}` : null, e.traceId ? `trace ${e.traceId}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Status-based copy used only when the server sent no usable message. */
export function fallbackMessage(status: number): string {
  if (status === 0) return "Can't reach KKT right now. Check your internet connection.";
  if (status === 404) return "We couldn't find that.";
  if (status === 413) return "That file is too large (max 15 MB).";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Our server had a hiccup. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Correlation ids from the response headers (used when the body does not carry them). */
export interface ResponseIds {
  requestId?: string;
  traceId?: string;
}

/** ApiError from a failed response's status and parsed body (any code: unknown codes keep the server's message). */
export function apiErrorFromBody(
  status: number,
  body: unknown,
  retryAfterSeconds?: number,
  ids: ResponseIds = {},
): ApiError {
  if (isApiError(body)) {
    const e = body.error;
    const traceId = nonEmpty((e as { trace_id?: unknown }).trace_id) ?? ids.traceId;
    return new ApiError({
      status,
      code: e.code,
      message: nonEmpty(e.message) ?? fallbackMessage(status),
      details: e.details,
      requestId: e.request_id ?? ids.requestId,
      ...(traceId ? { traceId } : {}),
      retryAfterSeconds,
    });
  }
  const top = record(body);
  const inner = record(top?.error);
  const message = nonEmpty(inner?.message) ?? nonEmpty(top?.message);
  const rawCode = nonEmpty(inner?.code) ?? nonEmpty(top?.code);
  const code = rawCode && /^[A-Za-z][A-Za-z0-9_]*$/.test(rawCode) ? rawCode.toUpperCase() : "UNKNOWN";
  const requestId = nonEmpty(inner?.request_id) ?? ids.requestId;
  const traceId = nonEmpty(inner?.trace_id) ?? ids.traceId;
  return new ApiError({
    status,
    code,
    message: message ?? fallbackMessage(status),
    details: record(inner?.details) ?? undefined,
    ...(requestId ? { requestId } : {}),
    ...(traceId ? { traceId } : {}),
    retryAfterSeconds,
  });
}
