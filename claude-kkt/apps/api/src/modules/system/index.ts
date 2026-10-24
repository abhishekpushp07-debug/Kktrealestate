import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HealthResponseSchema } from "@kkt/contracts";
import { config } from "../../config.js";
import { ApiError } from "../../lib/errors.js";
import { renderPrometheus } from "../../lib/metrics.js";
import { route } from "../../lib/routes.js";

const HealthSchema = HealthResponseSchema.extend({ db_ping_ms: z.number().nullable(), redis_ping_ms: z.number().nullable() });
const RegistrySchema = z.object({ items: z.array(z.object({ method: z.string(), url: z.string(), permission: z.string().nullable(), audience: z.enum(["erp", "portal"]).nullable(), public: z.boolean() })) });

/** System module: /health, /ready, /metrics, /api/v1/system/routes and the OpenAPI document. */
export async function systemModule(app: FastifyInstance): Promise<void> {
  async function probe(): Promise<{ db: number | null; redis: number | null }> {
    const t0 = performance.now();
    const db = await app.db.execute(sql`select 1`).then(() => Math.round((performance.now() - t0) * 100) / 100).catch(() => null);
    const t1 = performance.now();
    const redis = await app.redis.ping().then(() => Math.round((performance.now() - t1) * 100) / 100).catch(() => null);
    return { db, redis };
  }

  for (const url of ["/health", "/api/v1/health"]) {
    route(app, {
      method: "GET", url, public: true,
      schema: { response: { 200: HealthSchema }, summary: "Liveness + dependency pings", tags: ["system"] },
      handler: async (req, reply) => {
        const p = await probe();
        reply.header("Cache-Control", "no-store");
        return { status: p.db !== null && p.redis !== null ? "ok" : "degraded", version: config.APP_VERSION, uptime_seconds: Math.round(process.uptime()), checks: { database: p.db !== null, redis: p.redis !== null, storage: true }, db_ping_ms: p.db, redis_ping_ms: p.redis };
      },
    });
  }

  for (const url of ["/ready", "/api/v1/ready"]) {
    route(app, {
      method: "GET", url, public: true,
      schema: { response: { 200: z.object({ ready: z.literal(true) }) }, summary: "Readiness (503 when a dependency is down)", tags: ["system"] },
      handler: async () => {
        const p = await probe();
        if (p.db === null || p.redis === null) {
          throw ApiError.unavailable(`Not ready: ${[p.db === null ? "database" : null, p.redis === null ? "redis" : null].filter(Boolean).join(", ")} unreachable`, 5);
        }
        return { ready: true as const };
      },
    });
  }

  for (const url of ["/metrics", "/api/v1/metrics"]) {
    route(app, {
      method: "GET", url, permission: "admin.tools",
      schema: { response: { 200: z.string() }, summary: "Prometheus metrics", tags: ["system"] },
      handler: async (_req, reply) => {
        reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        return reply.send(renderPrometheus({ nodejs_heap_used_bytes: process.memoryUsage().heapUsed }));
      },
    });
  }

  route(app, {
    method: "GET", url: "/api/v1/system/routes", permission: "admin.tools",
    schema: { response: { 200: RegistrySchema }, summary: "Route registry (method, url, guard)", tags: ["system"] },
    handler: async () => ({ items: app.routeRegistry }),
  });

  route(app, {
    method: "GET", url: "/api/v1/openapi.json", public: true,
    schema: { response: { 200: z.record(z.string(), z.unknown()) }, summary: "OpenAPI document", tags: ["system"], hide: true },
    handler: async (_req, reply) => { reply.header("Cache-Control", "public, max-age=60"); return app.swagger() as Record<string, unknown>; },
  });
}
