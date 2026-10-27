import { createHash, timingSafeEqual } from "node:crypto";
import { trace, type Span } from "@opentelemetry/api";
import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  loginsFailed,
  METRICS_CONTENT_TYPE,
  paymentsPosted,
  recordRequest,
  scrapeMetrics,
  trackInFlight,
} from "../lib/metrics.js";

/** Trace id of `span`, or undefined for a missing span or the all-zero id of a non-recording span. */
function traceIdOf(span: Span | undefined): string | undefined {
  const id = span?.spanContext().traceId;
  return id && !/^0+$/.test(id) ? id : undefined;
}

/** Trace id of the active span (OpenTelemetry), or undefined when tracing is off or no span is active. */
export function currentTraceId(): string | undefined {
  return traceIdOf(trace.getActiveSpan());
}

/** Routes that serve Prometheus metrics (staff admin.tools, or the METRICS_TOKEN bearer). */
export const METRICS_ROUTES = new Set(["/metrics", "/api/v1/metrics"]);

const LOGIN_ROUTES: Record<string, "erp" | "portal"> = {
  "/api/v1/auth/login": "erp",
  "/api/v1/portal/auth/login": "portal",
};

function digest(v: string): Buffer {
  return createHash("sha256").update(v).digest();
}

/** Constant-time comparison of a presented bearer token with METRICS_TOKEN. */
export function isMetricsToken(header: string | undefined, token: string | undefined = config.METRICS_TOKEN): boolean {
  if (!token || !header) return false;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return false;
  return timingSafeEqual(digest(value.trim()), digest(token));
}

/**
 * Request telemetry: HTTP RED metrics (route pattern / method / status), in-flight gauge, business counters derived from route
 * outcomes (payments posted, failed logins), the METRICS_TOKEN scrape path, and trace correlation (X-Trace-Id header, `trace_id` in error
 * bodies, http.route on the server span) when OpenTelemetry is active. Must be registered BEFORE the auth plugin so a METRICS_TOKEN scrape
 * is answered here and never reaches staff authentication.
 */
export default fp(
  async (app) => {
    app.addHook("onRequest", async (req, reply) => {
      trackInFlight(reply.raw);
      const url = req.routeOptions.url;
      // one context lookup per request; without a registered OpenTelemetry SDK there is never an active span and nothing else runs
      const span = trace.getActiveSpan();
      if (span) {
        if (url) {
          span.setAttribute("http.route", url);
          span.updateName(`${req.method} ${url}`);
        }
        const traceId = traceIdOf(span);
        if (traceId) reply.header("X-Trace-Id", traceId);
      }
      if (url && METRICS_ROUTES.has(url) && req.method === "GET" && isMetricsToken(req.headers.authorization)) {
        const body = await scrapeMetrics();
        reply.header("Content-Type", METRICS_CONTENT_TYPE).header("Cache-Control", "no-store");
        return reply.send(body);
      }
      return undefined;
    });

    app.addHook("onSend", async (req, reply, payload) => {
      if (reply.statusCode < 400 || typeof payload !== "string") return payload;
      const traceId = currentTraceId();
      if (!traceId || !payload.startsWith('{"error":')) return payload;
      try {
        const body = JSON.parse(payload) as { error?: Record<string, unknown> };
        if (!body.error || typeof body.error !== "object") return payload;
        body.error["trace_id"] = traceId;
        return JSON.stringify(body);
      } catch {
        return payload;
      }
    });

    app.addHook("onResponse", async (req: FastifyRequest, reply) => {
      const url = req.routeOptions.url ?? "unmatched";
      const status = reply.statusCode;
      recordRequest(url, req.method, status, reply.elapsedTime / 1000);
      if (req.method !== "POST") return;
      if (url === "/api/v1/payments" && status === 201 && reply.getHeader("idempotent-replayed") !== "true")
        paymentsPosted.inc();
      const audience = LOGIN_ROUTES[url];
      if (audience && (status === 401 || status === 423)) loginsFailed.inc({ audience });
    });
  },
  { name: "telemetry" },
);
