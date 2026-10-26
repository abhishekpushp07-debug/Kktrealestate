import fp from "fastify-plugin";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";

/** Probe routes that are never shed (load balancers must always reach them). */
const PROBES = new Set(["/health", "/ready", "/api/v1/health", "/api/v1/ready", "/metrics", "/api/v1/metrics"]);

/**
 * Concurrency-based load shedding (ARCHITECTURE §6: "503 + Retry-After instead of collapsing"). @fastify/under-pressure watches the event
 * loop, which stays healthy while thousands of requests queue on the database pool; this hook caps the number of requests in flight per
 * process (API_MAX_INFLIGHT, 0 = off) and answers the excess immediately with 503 SERVICE_UNAVAILABLE so the admitted requests keep their
 * latency. Health, readiness and metrics probes are never shed. The in-flight count is always tracked (graceful shutdown logs it).
 */
export default fp(async (app) => {
  const limit = config.API_MAX_INFLIGHT;
  let inflight = 0;
  app.addHook("onRequest", async (req, reply) => {
    const url = req.routeOptions.url;
    if (url === undefined || PROBES.has(url)) return;
    if (limit > 0 && inflight >= limit) {
      req.log.warn({ inflight, limit }, "load shed");
      throw ApiError.unavailable("Server is busy, retry shortly", 2);
    }
    inflight += 1;
    // `close` fires whether the response completed or the client aborted mid-flight (onResponse does not run for aborted requests),
    // so the slot is always released exactly once.
    reply.raw.once("close", () => { inflight -= 1; });
  });
  app.decorate("inflightRequests", () => inflight);
}, { name: "load-shed" });

declare module "fastify" {
  interface FastifyInstance {
    /** Requests currently in flight in this process (probes excluded). */
    inflightRequests?: () => number;
  }
}
