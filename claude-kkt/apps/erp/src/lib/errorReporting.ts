/**
 * ERP error reporting (audit v3 H4, contract C2): the root ErrorBoundary, the route error page, window "error" and
 * "unhandledrejection" send `POST /api/v1/client-errors` with `{app: "erp", message, stack?, url?, release?, user_agent?, extra?}`.
 *
 * - Best-effort: keepalive fetch, never throws, never retried; a bearer token is attached for attribution when one is in memory.
 * - Dedupe: the same error signature (name + message + first stack frame) is sent once per page load.
 * - Sampling: VITE_CLIENT_ERROR_SAMPLE_RATE (0..1, default 1) decides per distinct error; at most MAX_REPORTS per page load.
 * - Privacy: only the page path is sent (no query string or fragment, which can carry search terms or tokens); no form contents.
 * - Expected API answers (4xx ApiClientError: validation, permission, conflict) are not reported; the API logs its own 5xx.
 */
import { CLIENT_ERROR_LIMITS, type ClientErrorReport } from "@kkt/contracts";
import { apiBaseUrl, isApiClientError, tokens } from "./api";

export const MAX_REPORTS = 10;

export interface ReportContext {
  /** Where the error was caught: "boundary" | "route" | "window" | "unhandledrejection" | … */
  source: string;
  componentStack?: string | null;
  extra?: Record<string, unknown>;
}

export interface ReporterEnv {
  url: string | null;
  userAgent: string | null;
  release: string;
  sampleRate: number;
  random: () => number;
  send: (endpoint: string, body: ClientErrorReport, token: string | null) => void;
}

function clip(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** Page URL without query string or fragment. */
export function pagePath(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`.slice(0, 2048);
  } catch {
    return undefined;
  }
}

function asError(value: unknown): { name: string; message: string; stack?: string } {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "string") return { name: "Error", message: value };
  if (typeof value === "object" && value !== null && "message" in value) {
    const record = value as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof record.name === "string" ? record.name : "Error",
      message: String(record.message),
      stack: typeof record.stack === "string" ? record.stack : undefined,
    };
  }
  try {
    return { name: "Error", message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { name: "Error", message: String(value) };
  }
}

/** Errors that are not bugs: expected API answers, aborted requests, a benign browser notice. */
export function isReportable(error: unknown): boolean {
  if (isApiClientError(error)) return error.status === 0 ? false : error.status >= 500;
  const { name, message } = asError(error);
  if (name === "AbortError") return false;
  if (/ResizeObserver loop/i.test(message)) return false;
  return message.trim() !== "";
}

/** Dedupe key: name, message and the first stack frame. */
export function errorSignature(error: unknown): string {
  const { name, message, stack } = asError(error);
  const frame = stack?.split("\n").find((line) => /^\s*at\s|@/.test(line)) ?? "";
  return `${name}|${message}|${frame.trim()}`;
}

/** Builds the C2 body (pure). */
export function buildClientErrorReport(
  error: unknown,
  context: ReportContext,
  env: Pick<ReporterEnv, "url" | "userAgent" | "release">,
): ClientErrorReport {
  const { name, message, stack } = asError(error);
  const extra: Record<string, unknown> = { source: context.source, ...(context.extra ?? {}) };
  if (context.componentStack) extra.component_stack = context.componentStack.slice(0, 2000);
  if (isApiClientError(error)) {
    extra.status = error.status;
    extra.code = error.code;
    if (error.requestId) extra.request_id = error.requestId;
  }
  const url = pagePath(env.url);
  const userAgent = clip(env.userAgent, 512);
  const clippedStack = clip(stack, CLIENT_ERROR_LIMITS.stack);
  return {
    app: "erp",
    message: clip(`${name}: ${message}`, CLIENT_ERROR_LIMITS.message) ?? "Error",
    ...(clippedStack ? { stack: clippedStack } : {}),
    ...(url ? { url } : {}),
    release: env.release.slice(0, 100),
    ...(userAgent ? { user_agent: userAgent } : {}),
    extra,
  };
}

/** A reporter with its own dedupe set and budget (one per page load; tests create their own). */
export function createReporter(env: () => ReporterEnv) {
  const seen = new Set<string>();
  let sent = 0;
  return {
    /** Returns true when a report was sent. */
    report(error: unknown, context: ReportContext): boolean {
      try {
        if (!isReportable(error)) return false;
        const signature = errorSignature(error);
        if (seen.has(signature)) return false;
        seen.add(signature);
        const current = env();
        if (sent >= MAX_REPORTS) return false;
        if (current.random() >= current.sampleRate) return false;
        sent += 1;
        current.send(
          `${apiBaseUrl()}/client-errors`,
          buildClientErrorReport(error, context, current),
          tokens.getAccess(),
        );
        return true;
      } catch {
        return false; // reporting must never break the app
      }
    },
    /** Test helper. */
    reset(): void {
      seen.clear();
      sent = 0;
    },
  };
}

function sampleRate(): number {
  const raw = Number(import.meta.env.VITE_CLIENT_ERROR_SAMPLE_RATE ?? "1");
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
}

function browserEnv(): ReporterEnv {
  return {
    url: typeof location === "undefined" ? null : location.href,
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    release: import.meta.env.VITE_RELEASE || "dev",
    sampleRate: sampleRate(),
    random: Math.random,
    send: (endpoint, body, token) => {
      if (typeof fetch === "undefined") return;
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      void fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), keepalive: true }).catch(
        () => undefined,
      );
    },
  };
}

const reporter = createReporter(browserEnv);

/** Reports one caught error (ErrorBoundary onError, route errors). */
export function reportClientError(error: unknown, context: ReportContext): boolean {
  return reporter.report(error, context);
}

/** window "error" + "unhandledrejection" → reports (main.tsx). Returns the uninstaller. */
export function installGlobalErrorReporting(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    reportClientError(event.error ?? event.message, {
      source: "window",
      extra: event.filename ? { file: pagePath(event.filename) ?? event.filename, line: event.lineno } : undefined,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, { source: "unhandledrejection" });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
