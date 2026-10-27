import { z } from "zod";
import { TimestampSchema } from "../common.js";

// ---------------------------------------------------------------------------
// Health (docs/OBSERVABILITY.md "Health endpoints")
// ---------------------------------------------------------------------------

/** `GET /health/live`: the process answers (no dependency is touched) — the liveness probe. */
export const LivenessResponseSchema = z.object({
  status: z.literal("ok"),
  uptime_seconds: z.number().min(0),
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

/** `GET /health/ready` (and the older `/ready`): database and Redis reachable and the process not draining; 503 otherwise. */
export const ReadinessResponseSchema = z.object({ ready: z.literal(true) });
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

/** One dependency check of the full health report. */
export const HealthCheckSchema = z.object({
  ok: z.boolean(),
  /** Round trip in ms (null when the dependency did not answer). */
  latency_ms: z.number().min(0).nullable(),
  /** Why the check failed (never a secret or a connection string). */
  error: z.string().nullable(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

/**
 * `GET /health` (and `/api/v1/health`): the full report. 503 with `status: "down"` when the database, Redis or the object store fails;
 * 200 with `status: "degraded"` when only the job worker's heartbeat is stale (or missing); 200 `ok` otherwise. `checks` keeps the
 * boolean summary older clients read; `details` carries the measured values.
 */
export const SystemHealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  version: z.string(),
  uptime_seconds: z.number().min(0),
  checks: z.object({
    database: z.boolean(),
    redis: z.boolean(),
    storage: z.boolean(),
    worker: z.boolean(),
    migrations: z.boolean(),
  }),
  db_ping_ms: z.number().nullable(),
  redis_ping_ms: z.number().nullable(),
  details: z.object({
    database: HealthCheckSchema,
    redis: HealthCheckSchema,
    /** A real put + head of a small health object (cached for a few seconds per process). */
    storage: HealthCheckSchema.extend({ checked_at: TimestampSchema.nullable() }),
    /** Heartbeat the job worker writes to Redis every 15 s (contract C8). */
    worker: z.object({
      ok: z.boolean(),
      last_heartbeat_at: TimestampSchema.nullable(),
      age_seconds: z.number().min(0).nullable(),
      stale_after_seconds: z.int().min(1),
    }),
    /** Drizzle migrations applied vs shipped with this build (a newer database is fine; an older one is not). */
    migrations: z.object({
      ok: z.boolean(),
      applied: z.int().min(0).nullable(),
      expected: z.int().min(0),
      latest_applied_at: TimestampSchema.nullable(),
      latest_expected_at: TimestampSchema.nullable(),
    }),
  }),
});
export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;

/** Worker health listener (contract C8): `GET /health` on WORKER_HEALTH_PORT; 200 `ok`, 503 `down`. */
export const WorkerHealthResponseSchema = z.object({
  status: z.enum(["ok", "down"]),
  redis: z.boolean(),
  queues: z.record(
    z.string(),
    z.object({
      /** Jobs waiting / delayed / running on the queue (null when Redis could not be read). */
      waiting: z.int().min(0).nullable(),
      delayed: z.int().min(0).nullable(),
      active: z.int().min(0).nullable(),
      /** True while this worker consumes the queue (false once it stopped fetching for a shutdown). */
      consuming: z.boolean(),
    }),
  ),
  last_heartbeat_at: TimestampSchema.nullable(),
});
export type WorkerHealthResponse = z.infer<typeof WorkerHealthResponseSchema>;

// ---------------------------------------------------------------------------
// Client error reports (contract C2)
// ---------------------------------------------------------------------------

/** Apps that report front-end errors. */
export const CLIENT_ERROR_APPS = ["erp", "portal", "web"] as const;
export const ClientErrorAppSchema = z.enum(CLIENT_ERROR_APPS);
export type ClientErrorApp = z.infer<typeof ClientErrorAppSchema>;

/** Byte limits of a client error report (the route also caps the whole body at 16 KB). */
export const CLIENT_ERROR_LIMITS = { message: 2048, stack: 8192, body: 16 * 1024 } as const;

/**
 * `POST /api/v1/client-errors` body: an uncaught error, a rejected promise or an error boundary hit in a front end. No authentication; a
 * bearer token, when present, attributes the report to its user. Send only what is needed to fix the bug (no form contents, no tokens):
 * the server logs exactly what arrives, minus the URL's query string.
 */
export const ClientErrorReportSchema = z.strictObject({
  app: ClientErrorAppSchema,
  message: z.string().min(1).max(CLIENT_ERROR_LIMITS.message),
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
  /** Page where it happened (the query string and fragment are dropped before logging). */
  url: z.string().max(2048).optional(),
  /** Build / release identifier of the app (e.g. the git sha). */
  release: z.string().max(100).optional(),
  user_agent: z.string().max(512).optional(),
  /** Small structured context (component stack, route name, http status of a failed call…). */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

/** `202` answer of `POST /api/v1/client-errors`. */
export const ClientErrorAcceptedSchema = z.object({ accepted: z.literal(true) });
export type ClientErrorAccepted = z.infer<typeof ClientErrorAcceptedSchema>;
