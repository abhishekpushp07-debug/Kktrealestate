/**
 * OpenTelemetry tracing bootstrap, loaded BEFORE the application with `node --import ./dist/telemetry.js dist/server.js` (the Docker image
 * does this). It is a no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set, so the default deployment pays nothing.
 *
 * When enabled it traces:
 *  - every inbound HTTP request (server span, renamed to `METHOD /route/:pattern` by plugins/telemetry.ts) and outbound HTTP calls;
 *  - every Redis command (ioredis);
 *  - one child span per route handler (lib/routes.ts) carrying the route, permission and audience as attributes.
 * The trace and span ids are added to every log line (lib/logger.ts mixin), the trace id to the `X-Trace-Id` response header and to error bodies
 * (`error.trace_id`). Health, readiness and metrics probes are not traced.
 *
 * Standard OTEL_* variables apply (OTEL_EXPORTER_OTLP_HEADERS, OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG — parentbased_traceidratio
 * with 0.1 is a sane production choice — OTEL_RESOURCE_ATTRIBUTES). Docs: docs/OBSERVABILITY.md.
 *
 * This file must stay free of application imports (config, logger): it runs before them. It imports only src/preload.ts (UV_THREADPOOL_SIZE).
 */
// first: size the libuv thread pool before anything can use it (src/preload.ts)
import "./preload.js";
import { register } from "node:module";

const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];

/** Shutdown hook published for server.ts (modules/system/shutdown.ts shutdownTelemetry flushes pending spans on graceful exit). */
export const TELEMETRY_SHUTDOWN = Symbol.for("kkt.telemetry.shutdown");

const IGNORED_PATHS = /^\/(api\/v1\/)?(health|ready|metrics)(\/(live|ready))?(\?|$)/;

async function start(): Promise<void> {
  if (!endpoint) return;
  // ESM modules are patched through import-in-the-middle; CommonJS dependencies (fastify, ioredis) through require-in-the-middle.
  try {
    register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  } catch {
    // older runtimes without module.register: CommonJS instrumentation still works
  }
  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { IORedisInstrumentation },
    { resourceFromAttributes },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-ioredis"),
    import("@opentelemetry/resources"),
  ]);
  const serviceName = process.env["OTEL_SERVICE_NAME"] ?? "kkt-api";
  const sdk = new NodeSDK({
    serviceName,
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "service.version": process.env["APP_VERSION"] ?? "2.0.0",
      "deployment.environment": process.env["NODE_ENV"] ?? "development",
    }),
    // The exporter reads OTEL_EXPORTER_OTLP_ENDPOINT (+ /v1/traces) and OTEL_EXPORTER_OTLP_HEADERS itself.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => IGNORED_PATHS.test(req.url ?? ""),
        // never export the query string (search terms, phone numbers, signed-link tokens)
        requestHook: (span, req) => {
          const url = (req as { url?: unknown }).url;
          if (typeof url === "string" && url.includes("?")) {
            span.setAttribute("http.target", url.slice(0, url.indexOf("?")));
            span.setAttribute("url.query", "[redacted]");
          }
        },
      }),
      new IORedisInstrumentation({ requireParentSpan: true }),
    ],
  });
  sdk.start();
  (globalThis as Record<symbol, unknown>)[TELEMETRY_SHUTDOWN] = () => sdk.shutdown();
  process.stderr.write(
    `${JSON.stringify({ level: 30, time: Date.now(), msg: "opentelemetry tracing enabled", endpoint: endpoint.replace(/\/\/[^@/]*@/, "//<credentials>@"), service: serviceName })}\n`,
  );
}

await start().catch((err: unknown) => {
  // Tracing must never stop the API from booting.
  process.stderr.write(
    `${JSON.stringify({ level: 40, time: Date.now(), msg: "opentelemetry failed to start; continuing without tracing", err: (err as Error).message })}\n`,
  );
});
