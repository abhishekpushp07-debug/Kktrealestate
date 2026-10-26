import { hostname } from "node:os";
import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { currentTraceId } from "./telemetry.js";

/**
 * Error reporter: every 5xx answer (except 503 load shedding / not-ready, which alerts cover) is posted to ERROR_WEBHOOK_URL as a
 * Slack-compatible JSON message carrying the request id, route pattern, error class and a sanitised message — never the request body,
 * query string, headers, user identity or any value that looks like personal data. Posting is fire-and-forget with a 3 s timeout, rate
 * limited per process (token bucket) and de-duplicated per (route, error class) inside a window; suppressed repeats are counted and
 * reported with the next message. Docs: docs/OBSERVABILITY.md.
 */

/** One error event as posted (also usable by the job runner for failed jobs). */
export interface ErrorEvent {
  kind: "http" | "job";
  /** Request id or job run id. */
  id: string;
  /** Route pattern (`POST /api/v1/payments`) or job name. */
  where: string;
  status?: number;
  errorClass: string;
  message: string;
  traceId?: string | undefined;
}

const PATTERNS: [RegExp, string][] = [
  [/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/g, "<url-with-credentials>://"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<jwt>"],
  [/\b(?:bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]+/gi, "<secret>"],
  [
    /(?<!<)\b(?:authorization|token|password|passwd|pwd|secret\w*|api[-_]?key|cookie|set-cookie|otp|pin)\b\s*[:=]?\s*\S+/gi,
    "<secret>",
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, "<pan>"],
  // Aadhaar (12 digits, optionally grouped 4-4-4 by spaces or hyphens)
  [/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, "<aadhaar>"],
  // Indian mobile numbers: +91 / 0 prefix optional, written whole, 5-5 or with separators ("98765 43210", "98765-43210")
  [/(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, "<phone>"],
  [/\b\d{9,}\b/g, "<number>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // Postgres "Key (phone)=(9876543210) already exists" style details
  [/\)=\([^)]*\)/g, ")=(<value>)"],
];

/** Strips personal data, credentials and identifiers from an error message and caps its length. */
export function sanitizeMessage(raw: string, max = 300): string {
  let s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Options of {@link ErrorReporter}. */
export interface ErrorReporterOptions {
  url: string;
  /** Messages per minute per process (default 10). */
  perMinute?: number;
  /** Window in which a repeat of the same (where, errorClass) is suppressed (default 60 s). */
  dedupeSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  service?: string;
  version?: string;
}

/** Rate-limited, de-duplicating webhook poster. */
export class ErrorReporter {
  private tokens: number;
  private lastRefill: number;
  private readonly seen = new Map<string, { until: number; suppressed: number }>();
  private suppressedByLimit = 0;
  private readonly perMinute: number;
  private readonly dedupeMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  /** Posts in flight (tests await them). */
  readonly pending = new Set<Promise<void>>();

  constructor(private readonly opts: ErrorReporterOptions) {
    this.perMinute = Math.max(1, opts.perMinute ?? 10);
    this.dedupeMs = (opts.dedupeSeconds ?? 60) * 1000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.tokens = this.perMinute;
    this.lastRefill = this.now();
  }

  private takeToken(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.lastRefill) / 60_000) * this.perMinute);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Queues one event; returns false when it was suppressed (duplicate or over the rate limit). Never throws. */
  report(event: ErrorEvent): boolean {
    const now = this.now();
    const key = `${event.kind}|${event.where}|${event.errorClass}`;
    const prev = this.seen.get(key);
    if (prev && prev.until > now) {
      prev.suppressed += 1;
      return false;
    }
    if (!this.takeToken()) {
      this.suppressedByLimit += 1;
      return false;
    }
    const repeats = prev?.suppressed ?? 0;
    this.seen.set(key, { until: now + this.dedupeMs, suppressed: 0 });
    if (this.seen.size > 500) for (const [k, v] of this.seen) if (v.until <= now) this.seen.delete(k);
    const limited = this.suppressedByLimit;
    this.suppressedByLimit = 0;
    const p = this.post(event, repeats, limited).finally(() => this.pending.delete(p));
    this.pending.add(p);
    return true;
  }

  private async post(e: ErrorEvent, repeats: number, limited: number): Promise<void> {
    const service = this.opts.service ?? "kkt-api";
    const head = e.kind === "http" ? `${e.status ?? 500} ${e.where}` : `job ${e.where} failed`;
    const extra = [
      repeats ? `${repeats} similar suppressed` : "",
      limited ? `${limited} other errors dropped by the rate limit` : "",
    ]
      .filter(Boolean)
      .join("; ");
    const text = `:rotating_light: [${service}${this.opts.version ? ` ${this.opts.version}` : ""}] ${head} — ${e.errorClass}: ${e.message} (id ${e.id}${e.traceId ? `, trace ${e.traceId}` : ""})${extra ? ` — ${extra}` : ""}`;
    const body = {
      text,
      kkt: {
        service,
        version: this.opts.version,
        host: hostname(),
        kind: e.kind,
        id: e.id,
        where: e.where,
        status: e.status,
        error_class: e.errorClass,
        message: e.message,
        trace_id: e.traceId,
        suppressed_repeats: repeats,
        dropped_by_rate_limit: limited,
        at: new Date(this.now()).toISOString(),
      },
    };
    try {
      const res = await this.fetchImpl(this.opts.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) logger.warn({ status: res.status }, "error webhook answered non-2xx");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "error webhook post failed");
    }
  }
}

let shared: ErrorReporter | null | undefined;

/** The process-wide reporter for ERROR_WEBHOOK_URL (null when unset). The job runner may call `reportJobFailure` with it. */
export function errorReporter(): ErrorReporter | null {
  if (shared === undefined)
    shared = config.ERROR_WEBHOOK_URL
      ? new ErrorReporter({
          url: config.ERROR_WEBHOOK_URL,
          version: config.APP_VERSION,
          service: config.OTEL_SERVICE_NAME,
        })
      : null;
  return shared;
}

/** Hook for the job runner: posts a failed job (sanitised) when a webhook is configured. */
export function reportJobFailure(job: string, runId: string, err: unknown): void {
  const r = errorReporter();
  if (!r) return;
  const e = err instanceof Error ? err : new Error(String(err));
  r.report({
    kind: "job",
    id: runId,
    where: job,
    errorClass: e.constructor?.name ?? "Error",
    message: sanitizeMessage(e.message),
  });
}

declare module "fastify" {
  interface FastifyRequest {
    /** Error raised while handling the request (error reporter). */
    kktError?: Error;
  }
}

/** Builds the http event for a finished request. */
export function httpEvent(req: FastifyRequest, status: number, err: Error | undefined): ErrorEvent {
  const e = err ?? new Error("5xx without an error object");
  return {
    kind: "http",
    id: req.id,
    where: `${req.method} ${req.routeOptions.url ?? "unmatched"}`,
    status,
    errorClass:
      (e as { code?: string }).code && /^[A-Z0-9_]+$/.test(String((e as { code?: string }).code))
        ? `${e.constructor?.name ?? "Error"}(${String((e as { code?: string }).code)})`
        : (e.constructor?.name ?? "Error"),
    message: sanitizeMessage(e.message),
    traceId: currentTraceId(),
  };
}

/** Fastify plugin: posts 5xx answers (except 503) to ERROR_WEBHOOK_URL. No-op when the variable is unset. */
export default fp(
  async (app, opts: { reporter?: ErrorReporter | null }) => {
    const reporter = opts.reporter === undefined ? errorReporter() : opts.reporter;
    if (!reporter) return;
    app.addHook("onError", async (req, _reply, error) => {
      req.kktError = error;
    });
    app.addHook("onResponse", async (req, reply) => {
      const status = reply.statusCode;
      if (status < 500 || status === 503) return;
      reporter.report(httpEvent(req, status, req.kktError));
    });
  },
  { name: "error-reporter" },
);
