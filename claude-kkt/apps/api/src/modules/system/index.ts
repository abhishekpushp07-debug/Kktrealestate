import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ClientErrorAcceptedSchema,
  ClientErrorReportSchema,
  CLIENT_ERROR_LIMITS,
  LivenessResponseSchema,
  ReadinessResponseSchema,
  SystemHealthResponseSchema,
  type HealthCheck,
  type SystemHealthResponse,
} from "@kkt/contracts";
import { MIGRATIONS_FOLDER } from "@kkt/db";
import { config } from "../../config.js";
import { ApiError } from "../../lib/errors.js";
import { verifyAccessToken } from "../../lib/jwt.js";
import { logger } from "../../lib/logger.js";
import { clientErrorsTotal, METRICS_CONTENT_TYPE, scrapeMetrics } from "../../lib/metrics.js";
import { route } from "../../lib/routes.js";
import { createStorage, healthKey, probeStorage, type Storage } from "../../lib/storage.js";
import { lifecycle } from "./lifecycle.js";
import { enrichOpenApi } from "./openapiEnrich.js";

const RegistrySchema = z.object({
  items: z.array(
    z.object({
      method: z.string(),
      url: z.string(),
      permission: z.string().nullable(),
      audience: z.enum(["erp", "portal"]).nullable(),
      public: z.boolean(),
      sunset: z.string().optional(),
    }),
  ),
});

/** Redis key the job worker's heartbeat lives under (worker.ts WORKER_HEARTBEAT_KEY; spelled out so the API never imports the worker). */
export const WORKER_HEARTBEAT_KEY = "kkt:worker:heartbeat";
/** How long a storage probe result is reused (a real put + head per probe; the load balancer polls /health every few seconds). */
export const STORAGE_PROBE_TTL_MS = 15_000;
const round = (ms: number) => Math.round(ms * 100) / 100;

/** Times `fn` within `ms`; a failure or timeout becomes `{ok: false, error}` (the message only, never a connection string). */
async function check(fn: () => Promise<unknown>, ms: number): Promise<HealthCheck> {
  const t0 = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
      }),
    ]);
    return { ok: true, latency_ms: round(performance.now() - t0), error: null };
  } catch (err) {
    return { ok: false, latency_ms: null, error: redactError(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Error text safe for a public health body (URLs and credentials stripped, bounded). */
function redactError(err: unknown): string {
  const raw = (err as { code?: string; message?: string }).code ?? (err as Error)?.message ?? String(err);
  return String(raw)
    .replace(/[a-z]+:\/\/[^\s]+/gi, "<url>")
    .slice(0, 200);
}

/** Migrations shipped with this build (drizzle journal next to the bundle), read once. */
let journal: Promise<{ count: number; latest: number | null }> | null = null;
function shippedMigrations(): Promise<{ count: number; latest: number | null }> {
  journal ??= readFile(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")
    .then((text) => {
      const entries = (JSON.parse(text) as { entries?: { when?: number }[] }).entries ?? [];
      const latest = entries.reduce<number | null>(
        (m, e) => (typeof e.when === "number" && (m === null || e.when > m) ? e.when : m),
        null,
      );
      return { count: entries.length, latest };
    })
    .catch(() => ({ count: 0, latest: null }));
  return journal;
}

type StorageProbe = HealthCheck & { checked_at: string | null };
let storageProbe: { at: number; result: StorageProbe } | null = null;
let storageInFlight: Promise<StorageProbe> | null = null;

/** Forgets the cached storage probe (tests that break or repair the store). */
export function resetStorageProbe(): void {
  storageProbe = null;
}

/** System module: /health (+ /health/live, /health/ready, /ready), /metrics, /client-errors, the route registry and the OpenAPI document. */
export async function systemModule(app: FastifyInstance): Promise<void> {
  const storage: Storage = createStorage();
  const storageKey = healthKey(hostname());

  const pingDb = () => check(() => app.db.execute(sql`select 1`), 2_000);
  const pingRedis = () => check(() => app.redis.ping(), 1_000);

  /** Real put + head on the health object, cached for STORAGE_PROBE_TTL_MS (one probe in flight at a time). */
  async function probeStorageCached(): Promise<StorageProbe> {
    if (storageProbe && Date.now() - storageProbe.at < STORAGE_PROBE_TTL_MS) return storageProbe.result;
    storageInFlight ??= check(() => probeStorage(storage, storageKey), 3_000)
      .then((r) => {
        const result = { ...r, checked_at: new Date().toISOString() };
        storageProbe = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        storageInFlight = null;
      });
    return storageInFlight;
  }

  async function workerStatus(redisOk: boolean): Promise<SystemHealthResponse["details"]["worker"]> {
    const stale = config.HEALTH_WORKER_STALE_SECONDS;
    if (!redisOk) return { ok: false, last_heartbeat_at: null, age_seconds: null, stale_after_seconds: stale };
    const raw = await app.redis.get(WORKER_HEARTBEAT_KEY).catch(() => null);
    let at: Date | null;
    try {
      const parsed = raw ? (JSON.parse(raw) as { at?: string }) : null;
      at = parsed?.at ? new Date(parsed.at) : null;
    } catch {
      at = null;
    }
    if (!at || Number.isNaN(at.getTime()))
      return { ok: false, last_heartbeat_at: null, age_seconds: null, stale_after_seconds: stale };
    const age = Math.max(0, Math.round((Date.now() - at.getTime()) / 100) / 10);
    return { ok: age <= stale, last_heartbeat_at: at.toISOString(), age_seconds: age, stale_after_seconds: stale };
  }

  async function migrationStatus(dbOk: boolean): Promise<SystemHealthResponse["details"]["migrations"]> {
    const shipped = await shippedMigrations();
    const expected = {
      expected: shipped.count,
      latest_expected_at: shipped.latest !== null ? new Date(shipped.latest).toISOString() : null,
    };
    if (!dbOk) return { ok: false, applied: null, latest_applied_at: null, ...expected };
    try {
      const rows = (await app.db.execute(
        sql`select count(*)::int as n, max(created_at)::text as latest from drizzle.__drizzle_migrations`,
      )) as unknown as { n: number; latest: string | null }[];
      const applied = Number(rows[0]?.n ?? 0);
      const latest = rows[0]?.latest ? Number(rows[0].latest) : null;
      // the database may be NEWER than this build (rolling deploy after the migrate job); it must not be older
      const ok = shipped.latest === null || (latest !== null && latest >= shipped.latest);
      return {
        ok,
        applied,
        latest_applied_at: latest !== null && Number.isFinite(latest) ? new Date(latest).toISOString() : null,
        ...expected,
      };
    } catch {
      return { ok: false, applied: null, latest_applied_at: null, ...expected };
    }
  }

  /** The full report: 503 when the database, Redis or storage is down; `degraded` (200) when only the worker heartbeat is stale. */
  async function fullHealth(): Promise<{ code: 200 | 503; body: SystemHealthResponse }> {
    const [db, redis, store] = await Promise.all([pingDb(), pingRedis(), probeStorageCached()]);
    const [worker, migrations] = await Promise.all([workerStatus(redis.ok), migrationStatus(db.ok)]);
    const down = !db.ok || !redis.ok || !store.ok;
    const status = down ? "down" : worker.ok ? "ok" : "degraded";
    return {
      code: down ? 503 : 200,
      body: {
        status,
        version: config.APP_VERSION,
        uptime_seconds: Math.round(process.uptime()),
        checks: {
          database: db.ok,
          redis: redis.ok,
          storage: store.ok,
          worker: worker.ok,
          migrations: migrations.ok,
        },
        db_ping_ms: db.latency_ms,
        redis_ping_ms: redis.latency_ms,
        details: { database: db, redis, storage: store, worker, migrations },
      },
    };
  }

  for (const url of ["/health", "/api/v1/health"]) {
    route(app, {
      method: "GET",
      url,
      public: true,
      schema: {
        response: { 200: SystemHealthResponseSchema, 503: SystemHealthResponseSchema },
        summary: "Full health report: database, Redis, storage (real put/head), worker heartbeat, migrations",
        description:
          "503 with status `down` when the database, Redis or the object store fails; 200 with status `degraded` when only the job worker's heartbeat is stale; 200 `ok` otherwise. Use /health/live for liveness and /health/ready for readiness probes.",
        tags: ["system"],
      },
      handler: async (_req, reply) => {
        const r = await fullHealth();
        reply.header("Cache-Control", "no-store");
        return reply.code(r.code).send(r.body);
      },
    });
  }

  for (const url of ["/health/live", "/api/v1/health/live"]) {
    route(app, {
      method: "GET",
      url,
      public: true,
      schema: {
        response: { 200: LivenessResponseSchema },
        summary: "Liveness: the process answers (no dependency is checked)",
        tags: ["system"],
      },
      handler: async () => ({ status: "ok" as const, uptime_seconds: Math.round(process.uptime()) }),
    });
  }

  for (const url of ["/health/ready", "/api/v1/health/ready", "/ready", "/api/v1/ready"]) {
    route(app, {
      method: "GET",
      url,
      public: true,
      schema: {
        response: { 200: ReadinessResponseSchema },
        summary: "Readiness: database and Redis reachable and the process not draining (503 otherwise)",
        tags: ["system"],
      },
      handler: async () => {
        // a draining process (SIGTERM received) leaves the load balancer before it stops listening
        if (lifecycle.draining) throw ApiError.unavailable("Not ready: shutting down", 5);
        const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
        if (!db.ok || !redis.ok) {
          throw ApiError.unavailable(
            `Not ready: ${[db.ok ? null : "database", redis.ok ? null : "redis"].filter(Boolean).join(", ")} unreachable`,
            5,
          );
        }
        return { ready: true as const };
      },
    });
  }

  // Front-end error reports (contract C2): no authentication (a bearer token, when present, attributes the report), per-IP rate limit,
  // 16 KB body; logged at warn and counted. Nothing is stored beyond the log line, and the URL loses its query string and fragment.
  route(app, {
    method: "POST",
    url: "/api/v1/client-errors",
    public: true,
    bodyLimit: CLIENT_ERROR_LIMITS.body,
    rateLimit: { limit: config.CLIENT_ERROR_RATE_LIMIT_PER_MIN, windowSeconds: 60, by: "ip" },
    schema: {
      body: ClientErrorReportSchema,
      response: { 202: ClientErrorAcceptedSchema },
      summary: "Report a front-end error (ERP, portal, website); no authentication required",
      tags: ["system"],
    },
    handler: async (req, reply) => {
      const b = req.body;
      clientErrorsTotal.inc({ app: b.app });
      const subject = await attribution(req.headers.authorization);
      logger.warn(
        {
          client_error: {
            app: b.app,
            message: b.message,
            ...(b.stack ? { stack: b.stack } : {}),
            ...(b.url ? { url: stripQuery(b.url) } : {}),
            ...(b.release ? { release: b.release } : {}),
            ...(b.user_agent ? { user_agent: b.user_agent } : {}),
            ...(b.extra ? { extra: b.extra } : {}),
          },
          ...(subject ? { subject } : {}),
          request_id: req.id,
        },
        "client error reported",
      );
      return reply.code(202).send({ accepted: true as const });
    },
  });

  // Staff with admin.tools, or a scraper presenting `Authorization: Bearer <METRICS_TOKEN>` (answered by plugins/telemetry.ts before
  // authentication). Under node:cluster the text is the aggregate of every worker (lib/metrics.ts scrapeMetrics).
  for (const url of ["/metrics", "/api/v1/metrics"]) {
    route(app, {
      method: "GET",
      url,
      permission: "admin.tools",
      schema: {
        response: { 200: z.string() },
        summary: "Prometheus metrics (admin.tools, or the METRICS_TOKEN bearer)",
        tags: ["system"],
      },
      handler: async (_req, reply) => {
        reply.header("Content-Type", METRICS_CONTENT_TYPE);
        return reply.send(await scrapeMetrics());
      },
    });
  }

  route(app, {
    method: "GET",
    url: "/api/v1/system/routes",
    permission: "admin.tools",
    schema: { response: { 200: RegistrySchema }, summary: "Route registry (method, url, guard)", tags: ["system"] },
    handler: async () => ({ items: app.routeRegistry }),
  });

  let enriched: Record<string, unknown> | null = null;
  route(app, {
    method: "GET",
    url: "/api/v1/openapi.json",
    public: true,
    schema: {
      response: { 200: z.record(z.string(), z.unknown()) },
      summary: "OpenAPI document (public with DOCS_PUBLIC, else admin.tools)",
      tags: ["system"],
      hide: true,
    },
    // public only with DOCS_PUBLIC (default off in production); otherwise plugins/auth.ts requires a staff token with admin.tools
    handler: async (_req, reply) => {
      reply.header("Cache-Control", config.DOCS_PUBLIC ? "public, max-age=60" : "private, no-store");
      // the same enrichment as the committed snapshot (operationIds, components, error responses, headers, media types)
      enriched ??= enrichOpenApi(
        JSON.parse(JSON.stringify(app.swagger())) as Record<string, unknown>,
        app.routeRegistry,
      );
      return enriched;
    },
  });
}

/** `{type, id, company_id}` of a valid bearer token (staff or portal), or null: attribution only, never a requirement. */
async function attribution(
  header: string | undefined,
): Promise<{ type: "staff" | "customer"; id: string; company_id: string } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) return null;
  for (const audience of ["erp", "portal"] as const) {
    const r = await verifyAccessToken(m[1]!, audience).catch(() => null);
    if (r?.ok) return { type: audience === "erp" ? "staff" : "customer", id: r.claims.sub, company_id: r.claims.cid };
    if (r && r.reason !== "WRONG_AUDIENCE") return null;
  }
  return null;
}

/** The URL without its query string and fragment (they can carry search terms, phone numbers and signed-link tokens). */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return (cut === -1 ? url : url.slice(0, cut)).slice(0, 2048);
}
