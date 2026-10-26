import { monitorEventLoopDelay } from "node:perf_hooks";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { eventLoopPressure, httpRequestsShed, recordRequest } from "../lib/metrics.js";

/** Probe routes that are never shed (load balancers and scrapers must always reach them). */
const PROBES = new Set(["/health", "/ready", "/api/v1/health", "/api/v1/ready", "/metrics", "/api/v1/metrics"]);

/** Event-loop delay sampling window (ms) and histogram resolution (ms). */
const SAMPLE_MS = 500;
const RESOLUTION_MS = 10;
/** Under event-loop pressure the in-flight cap drops to a quarter of the normal cap, but never below this (work always continues). */
const PRESSURE_MIN_INFLIGHT = 8;
/** Base for the pressure cap when API_MAX_INFLIGHT is off. */
const PRESSURE_BASE_INFLIGHT = 256;
/** Retry-After of a shed response (seconds). */
const RETRY_AFTER = "2";
/** At most one "load shed" log line per this many ms (a per-request log line would cost more than the 503 itself). */
const LOG_EVERY_MS = 10_000;

/**
 * In-flight cap in force: API_MAX_INFLIGHT (0 = none), or under event-loop pressure a quarter of it (of 256 when it is off), never below
 * 8 and never above the normal cap.
 */
export function inflightCap(limit: number, pressure: boolean): number {
  if (!pressure) return limit;
  const lowered = Math.max(PRESSURE_MIN_INFLIGHT, Math.floor((limit > 0 ? limit : PRESSURE_BASE_INFLIGHT) / 4));
  return limit > 0 ? Math.min(limit, lowered) : lowered;
}

const SHED_BODY_HEAD = '{"error":{"code":"SERVICE_UNAVAILABLE","message":"Server is busy, retry shortly","request_id":';

/** Observable state of the shedder (tests, /metrics, shutdown logs). */
export interface LoadShedState {
  inflight: number;
  /** In-flight cap now in force (0 = no cap). */
  cap: number;
  /** True while the event-loop delay is over API_SHED_EVENT_LOOP_DELAY_MS (until it falls under half of it). */
  pressure: boolean;
  /** Mean event-loop delay of the last sampling window, ms. */
  eventLoopDelayMs: number;
  /** How many times this process entered event-loop pressure. */
  pressureEpisodes: number;
  shed: { inflight: number; eventLoop: number };
}

/**
 * Load shedding (ARCHITECTURE §6: "503 + Retry-After instead of collapsing"), bounded and self-recovering:
 *
 * - **In-flight cap** (API_MAX_INFLIGHT per process, 256 in production): requests beyond it are answered 503 at once, so admitted requests
 *   keep their latency while thousands of connections queue on the database pool (an event-loop monitor cannot see that queue).
 * - **Event-loop pressure** (API_SHED_EVENT_LOOP_DELAY_MS): the mean event-loop delay is sampled every 500 ms over that window only; above
 *   the threshold the cap drops to a quarter (at least 8), and it is restored once the delay is under half the threshold (hysteresis).
 *   Pressure only lowers the cap — a process never refuses everything — and a window without load ends it, so it cannot latch.
 *   (This replaces @fastify/under-pressure's `maxEventLoopUtilization`, which measured utilisation cumulatively since boot: once a
 *   saturated process crossed 0.98 it answered 503 to every request, probes included, until idle time made up 2 % of its uptime.)
 * - **Never shed:** /health, /ready, /metrics (with and without /api/v1).
 * - **Cheap:** the hook runs first of all onRequest hooks (app.ts registers this plugin before helmet, CORS and telemetry) and a shed
 *   request is written straight to the socket (no exception, error handler, serializer, onSend hooks or per-request log line);
 *   `http_requests_total{status="503"}` and `http_requests_shed_total{reason}` count them, and one summary line is logged per 10 s.
 */
export default fp(
  async (app) => {
    const limit = config.API_MAX_INFLIGHT;
    const delayThreshold = config.API_SHED_EVENT_LOOP_DELAY_MS;
    let inflight = 0;
    let cap = limit; // 0 = no cap
    let pressure = false;
    let eventLoopDelayMs = 0;
    let pressureEpisodes = 0;
    const shed = { inflight: 0, eventLoop: 0 };
    const shedInflight = httpRequestsShed.labels("inflight");
    const shedEventLoop = httpRequestsShed.labels("event_loop");
    const corsOrigins = new Set([config.ERP_ORIGIN, config.WEB_ORIGIN, config.PORTAL_ORIGIN]);
    let loggedAt = 0;
    let loggedTotal = 0;

    const release = () => {
      inflight -= 1;
    };

    function setPressure(on: boolean): void {
      pressure = on;
      if (on) pressureEpisodes += 1;
      cap = inflightCap(limit, on);
      eventLoopPressure.set(on ? 1 : 0);
      if (on)
        app.log.warn(
          { event_loop_delay_ms: eventLoopDelayMs, threshold_ms: delayThreshold, cap },
          "event-loop pressure: in-flight cap lowered",
        );
      else
        app.log.info(
          { event_loop_delay_ms: eventLoopDelayMs, cap },
          "event-loop pressure over: in-flight cap restored",
        );
    }

    const histogram = delayThreshold > 0 ? monitorEventLoopDelay({ resolution: RESOLUTION_MS }) : null;
    histogram?.enable();
    const sampler = setInterval(() => {
      if (histogram) {
        // the window's mean only (the histogram is reset every sample); no samples at all means the loop was blocked the whole window
        const mean = histogram.count > 0 ? histogram.mean / 1e6 - RESOLUTION_MS : Infinity;
        histogram.reset();
        eventLoopDelayMs = Math.max(0, Math.round(mean));
        if (!pressure && eventLoopDelayMs > delayThreshold) setPressure(true);
        else if (pressure && eventLoopDelayMs < delayThreshold / 2) setPressure(false);
      }
      const total = shed.inflight + shed.eventLoop;
      const now = Date.now();
      if (total !== loggedTotal && now - loggedAt >= LOG_EVERY_MS) {
        app.log.warn(
          { shed: total - loggedTotal, inflight, cap, event_loop_delay_ms: eventLoopDelayMs },
          "load shed (503) since last report",
        );
        loggedAt = now;
        loggedTotal = total;
      }
    }, SAMPLE_MS);
    sampler.unref();
    app.addHook("onClose", async () => {
      clearInterval(sampler);
      histogram?.disable();
      if (pressure) eventLoopPressure.set(0);
    });

    /**
     * Answers 503 straight on the socket (hijacked: no serializer, no onSend/onResponse hooks, no etag hashing), then records the request
     * metric that the skipped onResponse hook would have recorded, so `http_requests_total{status="503"}` still counts it.
     */
    function shedReply(req: FastifyRequest, reply: FastifyReply, url: string): void {
      if (pressure && (limit === 0 || inflight < limit)) {
        shed.eventLoop += 1;
        shedEventLoop.inc();
      } else {
        shed.inflight += 1;
        shedInflight.inc();
      }
      const body = `${SHED_BODY_HEAD}${JSON.stringify(req.id)}}}`;
      const headers: Record<string, string | number> = {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "retry-after": RETRY_AFTER,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": req.id,
      };
      // cross-origin callers (dev servers) must be able to read the 503 and its Retry-After, as @fastify/cors would have allowed
      const origin = req.headers.origin;
      if (origin !== undefined && corsOrigins.has(origin)) {
        headers["access-control-allow-origin"] = origin;
        headers["access-control-expose-headers"] = "Retry-After, X-Request-Id";
        headers["vary"] = "Origin";
      }
      reply.hijack();
      reply.raw.writeHead(503, headers);
      reply.raw.end(body);
      recordRequest(url, req.method, 503, reply.elapsedTime / 1000);
    }

    app.addHook("onRequest", async (req, reply) => {
      const url = req.routeOptions.url;
      if (url === undefined || PROBES.has(url)) return undefined;
      if (cap > 0 && inflight >= cap) {
        shedReply(req, reply, url);
        return undefined;
      }
      inflight += 1;
      // `close` fires whether the response completed or the client aborted mid-flight (onResponse does not run for aborted requests),
      // so the slot is always released exactly once.
      reply.raw.once("close", release);
      return undefined;
    });
    app.decorate("inflightRequests", () => inflight);
    app.decorate("loadShedState", (): LoadShedState => ({
      inflight,
      cap,
      pressure,
      eventLoopDelayMs,
      pressureEpisodes,
      shed: { ...shed },
    }));
  },
  { name: "load-shed" },
);

declare module "fastify" {
  interface FastifyInstance {
    /** Requests currently in flight in this process (probes excluded). */
    inflightRequests?: () => number;
    /** Load shedding state of this process (plugins/loadShed.ts). */
    loadShedState?: () => LoadShedState;
  }
}
