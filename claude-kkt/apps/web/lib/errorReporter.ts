/**
 * Front-end error reporting (contract C2): POST /api/v1/client-errors on the API with `{app: "web", message, stack?, url?, release?,
 * user_agent?, extra?}`. Best-effort and silent (keepalive fetch, never throws, never retried), at most MAX_REPORTS per page load,
 * duplicates dropped. Only what is needed to fix the bug is sent: no form contents, no tokens — the page URL loses its query string
 * and fragment, and the secret manage token of /visit/<token> is replaced by a placeholder.
 */

/** Byte limits of contract C2 (packages/contracts CLIENT_ERROR_LIMITS). */
const LIMITS = { message: 2048, stack: 8192, url: 2048, userAgent: 512 } as const;
const MAX_REPORTS = 5;

export interface ClientErrorReport {
  app: "web";
  message: string;
  stack?: string;
  url?: string;
  release?: string;
  user_agent?: string;
  extra?: Record<string, unknown>;
}

/** Page URL without query string or fragment, with secret path segments (visit manage tokens) redacted. */
export function safePageUrl(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/^\/visit\/[^/]+/, "/visit/[token]");
    return `${u.origin}${path}`.slice(0, LIMITS.url);
  } catch {
    return undefined;
  }
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** Builds the report body (pure; exported for tests). */
export function buildReport(
  error: unknown,
  context: { url?: string | null; release?: string | null; userAgent?: string | null; extra?: Record<string, unknown> },
): ClientErrorReport {
  const err = error instanceof Error ? error : null;
  const message =
    clip(err ? `${err.name}: ${err.message}` : typeof error === "string" ? error : safeString(error), LIMITS.message) ||
    "Unknown error";
  const stack = clip(err?.stack, LIMITS.stack);
  const url = safePageUrl(context.url);
  const userAgent = clip(context.userAgent ?? undefined, LIMITS.userAgent);
  const digest = (error as { digest?: unknown } | null)?.digest;
  const extra = { ...(context.extra ?? {}), ...(typeof digest === "string" ? { digest } : {}) };
  return {
    app: "web",
    message,
    ...(stack ? { stack } : {}),
    ...(url ? { url } : {}),
    ...(context.release ? { release: context.release.slice(0, 100) } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const sent = new Set<string>();

/** Sends one report from the browser (deduplicated, capped per page load). Resolves to whether a request was made. */
export async function reportClientError(
  apiUrl: string,
  error: unknown,
  context: { release?: string | null; extra?: Record<string, unknown> } = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const report = buildReport(error, {
      url: window.location.href,
      release: context.release ?? null,
      userAgent: navigator.userAgent,
      ...(context.extra ? { extra: context.extra } : {}),
    });
    const key = `${report.message}|${report.url ?? ""}`;
    if (sent.has(key) || sent.size >= MAX_REPORTS) return false;
    sent.add(key);
    await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v1/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
      cache: "no-store",
      credentials: "omit",
    });
    return true;
  } catch {
    return false;
  }
}

/** Test hook: forget what was sent. */
export function resetReporter(): void {
  sent.clear();
}
