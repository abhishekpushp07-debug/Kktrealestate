import fp from "fastify-plugin";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";

/**
 * Concurrency-based load shedding (ARCHITECTURE §6: "503 + Retry-After instead of collapsing"). @fastify/under-pressure watches the event
 * loop, which stays healthy while thousands of requests queue on the database pool; this hook caps the number of requests in flight per
 * process (API_MAX_INFLIGHT, 0 = off) and answers the excess immediately with 503 SERVICE_UNAVAILABLE so the admitted requests keep their
 * latency. Health probes are never shed.
 */
export default fp(async (app) => {
  const limit = config.API_MAX_INFLIGHT;
  if (limit <= 0) return;
  let inflight = 0;
  app.addHook("onRequest", async (req, reply) => {
    const url = req.routeOptions.url;
    if (url === undefined || url === "/health" || url === "/ready" || url === "/api/v1/health" || url === "/api/v1/ready") return;
    if (inflight >= limit) {
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
    /** Requests currently in flight in this process (load-shed plugin; 0 when disabled). */
    inflightRequests?: () => number;
  }
}
