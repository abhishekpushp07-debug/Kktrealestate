import { trace } from "@opentelemetry/api";
import pino from "pino";
import { config } from "../config.js";

/**
 * Trace context of the active OpenTelemetry span (src/telemetry.ts), or nothing when tracing is off or no span is active. Without a
 * registered SDK `trace.getActiveSpan()` is a cheap no-op, so the default path costs one function call per log line.
 */
export function traceContext(): { trace_id: string; span_id: string } | Record<string, never> {
  const ctx = trace.getActiveSpan()?.spanContext();
  if (!ctx || !ctx.traceId || /^0+$/.test(ctx.traceId)) return {};
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

/**
 * Structured JSON logger (pretty in dev). Secrets are redacted by path. The mixin adds `trace_id`/`span_id` of the active span to EVERY
 * line — request logs, module-level loggers (jobs, services) and their children alike — so a log line can be joined to its trace.
 */
export const loggerOptions: pino.LoggerOptions = {
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.password_hash",
      "*.token",
      "*.refresh_token",
    ],
    censor: "[redacted]",
  },
  base: { service: "kkt-api" },
  mixin: traceContext,
};

export const logger = pino({
  ...loggerOptions,
  ...(config.LOG_PRETTY
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
    : {}),
});
