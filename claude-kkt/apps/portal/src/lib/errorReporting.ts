// Portal error reporting (audit v3 H4, contract C2; pure: test/resilience.test.ts). The root ErrorBoundary and, on web, window
// "error" / "unhandledrejection" send POST /api/v1/client-errors with {app: "portal", message, stack?, url?, release?, user_agent?,
// extra?}.
//  - Best-effort: never throws, never retried; the access token (memory) is attached for attribution when there is one.
//  - Dedupe: one report per distinct error (name + message + first stack frame) per app start; at most MAX_REPORTS per start.
//  - Sampling: EXPO_PUBLIC_CLIENT_ERROR_SAMPLE_RATE (0..1, default 1) decides per distinct error.
//  - Privacy: only the page path (no query string or fragment); no form contents, no phone numbers from the screen.
//  - Expected API answers (4xx, offline) are not reported; the API logs its own 5xx.
import { CLIENT_ERROR_LIMITS, type ClientErrorReport } from "@kkt/contracts";
import { ApiError } from "@/api/errors";

export const MAX_REPORTS = 10;

export interface ReportContext {
  /** Where the error was caught: "boundary" | "window" | "unhandledrejection". */
  source: string;
  componentStack?: string | null;
  extra?: Record<string, unknown>;
}

export interface ReporterEnv {
  endpoint: string;
  url: string | null;
  userAgent: string | null;
  release: string;
  platform: string;
  sampleRate: number;
  random: () => number;
  token: () => string | null;
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
    const r = value as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof r.name === "string" ? r.name : "Error",
      message: String(r.message),
      stack: typeof r.stack === "string" ? r.stack : undefined,
    };
  }
  try {
    return { name: "Error", message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { name: "Error", message: String(value) };
  }
}

export function isReportable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  const { name, message } = asError(error);
  if (name === "AbortError") return false;
  if (/ResizeObserver loop/i.test(message)) return false;
  return message.trim() !== "";
}

export function errorSignature(error: unknown): string {
  const { name, message, stack } = asError(error);
  const frame = stack?.split("\n").find((line) => /^\s*at\s|@/.test(line)) ?? "";
  return `${name}|${message}|${frame.trim()}`;
}

export function buildClientErrorReport(
  error: unknown,
  context: ReportContext,
  env: Pick<ReporterEnv, "url" | "userAgent" | "release" | "platform">,
): ClientErrorReport {
  const { name, message, stack } = asError(error);
  const extra: Record<string, unknown> = { source: context.source, platform: env.platform, ...(context.extra ?? {}) };
  if (context.componentStack) extra.component_stack = context.componentStack.slice(0, 2000);
  if (error instanceof ApiError) {
    extra.status = error.status;
    extra.code = error.code;
    if (error.requestId) extra.request_id = error.requestId;
  }
  const url = pagePath(env.url);
  const userAgent = clip(env.userAgent, 512);
  const clippedStack = clip(stack, CLIENT_ERROR_LIMITS.stack);
  return {
    app: "portal",
    message: clip(`${name}: ${message}`, CLIENT_ERROR_LIMITS.message) ?? "Error",
    ...(clippedStack ? { stack: clippedStack } : {}),
    ...(url ? { url } : {}),
    release: env.release.slice(0, 100),
    ...(userAgent ? { user_agent: userAgent } : {}),
    extra,
  };
}

export function createReporter(env: () => ReporterEnv) {
  const seen = new Set<string>();
  let sent = 0;
  return {
    report(error: unknown, context: ReportContext): boolean {
      try {
        if (!isReportable(error)) return false;
        const signature = errorSignature(error);
        if (seen.has(signature)) return false;
        seen.add(signature);
        if (sent >= MAX_REPORTS) return false;
        const current = env();
        if (current.random() >= current.sampleRate) return false;
        sent += 1;
        current.send(current.endpoint, buildClientErrorReport(error, context, current), current.token());
        return true;
      } catch {
        return false; // reporting must never break the app
      }
    },
    reset(): void {
      seen.clear();
      sent = 0;
    },
  };
}

export function sampleRateOf(raw: string | undefined): number {
  const n = Number(raw ?? "1");
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/** Sends one report with fetch (keepalive on web); swallows every failure. */
export function fetchSender(endpoint: string, body: ClientErrorReport, token: string | null): void {
  if (typeof fetch === "undefined") return;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    void fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), keepalive: true }).catch(
      () => undefined,
    );
  } catch {
    /* ignore */
  }
}

/** window "error" + "unhandledrejection" → report (web only). Returns the uninstaller. */
export function installGlobalErrorReporting(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  report: (error: unknown, context: ReportContext) => boolean,
): () => void {
  const onError = (event: ErrorEvent) => {
    report(event.error ?? event.message, { source: "window" });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    report(event.reason, { source: "unhandledrejection" });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
