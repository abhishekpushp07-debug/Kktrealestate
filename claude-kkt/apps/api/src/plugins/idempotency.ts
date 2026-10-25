import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { createHash } from "node:crypto";
import { ApiError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyInstance { sql: Sql }
  interface FastifyContextConfig { idempotent?: boolean | "required"; permission?: string; audience?: "erp" | "portal"; public?: boolean; rateLimit?: { limit: number; windowSeconds: number; by?: "ip" | "subject" } }
}

const TTL_SECONDS = 24 * 3600;
/** How long a concurrent duplicate waits for the in-flight request to finish before giving up with 409. */
const WAIT_MS = 10_000;
const POLL_MS = 40;
const LOCK_SECONDS = 30;

interface StoredResponse { request_hash: string; status_code: number; response_body: unknown; path: string }

/**
 * Route-provided request fingerprints (docs/TODO-integration.md item 2). Multipart bodies are streamed, so `req.body` is empty and
 * every upload would hash alike; routes that parse a multipart body before preHandler register a digest of the fields and file bytes
 * here and the Idempotency-Key fingerprint covers the actual upload (same key + different file → 422 IDEMPOTENCY_MISMATCH).
 */
const fingerprints = new WeakMap<FastifyRequest, unknown>();

/** Sets the value the idempotency plugin hashes for this request instead of `req.body` (call from a preValidation hook). */
export function setIdempotencyFingerprint(req: FastifyRequest, value: unknown): void {
  fingerprints.set(req, value);
}

/** The value the idempotency plugin hashes for this request (route fingerprint when set, else the JSON body). */
export function idempotencyFingerprint(req: FastifyRequest): unknown {
  return fingerprints.has(req) ? fingerprints.get(req) : (req.body ?? null);
}

function requestHash(req: FastifyRequest): string {
  return createHash("sha256").update(req.method).update(req.url).update(JSON.stringify(idempotencyFingerprint(req) ?? null)).digest("hex");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Idempotency for creates. Routes opt in with `config.idempotent: true | "required"`.
 * Scope = authenticated subject id (or client IP for public routes) + key. Replays return the stored response with `Idempotent-Replayed: true`;
 * the same key with a different body is 422 IDEMPOTENCY_MISMATCH. Only successful (2xx) responses are stored, in Redis (fast path) and Postgres (durable),
 * so a failed attempt can be retried with the same key. Concurrent identical requests wait for the first one and replay its response.
 */
export default fp(async (app) => {
  const sql = app.sql as Sql;

  async function loadStored(scopeKey: string, key: string, redisKey: string): Promise<StoredResponse | null> {
    const cached = await app.redis.get(redisKey);
    if (cached) return JSON.parse(cached) as StoredResponse;
    const rows = await sql<StoredResponse[]>`select request_hash, status_code, response_body, path from idempotency_keys where scope_key = ${scopeKey} and key = ${key} and expires_at > now()`;
    return rows[0] ?? null;
  }

  function replay(reply: FastifyReply, stored: StoredResponse, hash: string): FastifyReply {
    if (stored.request_hash !== hash) throw new ApiError(422, "IDEMPOTENCY_MISMATCH", "Idempotency-Key was already used with a different request");
    reply.header("Idempotent-Replayed", "true");
    return reply.status(stored.status_code).send(stored.response_body);
  }

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const mode = req.routeOptions.config.idempotent;
    if (!mode || req.method !== "POST") return;
    const key = req.headers["idempotency-key"];
    const keyStr = Array.isArray(key) ? key[0] : key;
    if (!keyStr) {
      if (mode === "required") throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required for this operation");
      return;
    }
    if (keyStr.length > 128) throw ApiError.badRequest("Idempotency-Key too long");
    const scopeKey = req.subjectId ?? req.clientIp;
    const hash = requestHash(req);
    const redisKey = `idem:${scopeKey}:${keyStr}`;
    const lockKey = `${redisKey}:lock`;
    const stored = await loadStored(scopeKey, keyStr, redisKey);
    if (stored) return replay(reply, stored, hash);
    // Lock so two concurrent identical requests do not both execute; losers wait for the winner's stored response and replay it.
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const lock = await app.redis.set(lockKey, "1", "EX", LOCK_SECONDS, "NX");
      if (lock) break;
      if (Date.now() > deadline) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "An identical request is already being processed");
      await sleep(POLL_MS);
      const done = await loadStored(scopeKey, keyStr, redisKey);
      if (done) return replay(reply, done, hash);
    }
    // The winner may have finished between our last poll and acquiring the lock.
    const late = await loadStored(scopeKey, keyStr, redisKey);
    if (late) {
      await app.redis.del(lockKey).catch(() => undefined);
      return replay(reply, late, hash);
    }
    req.idempotency = { scopeKey, key: keyStr, hash, redisKey };
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const ctx = req.idempotency;
    if (!ctx) return payload;
    try {
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        const body: unknown = typeof payload === "string" && payload.length > 0 ? JSON.parse(payload) : null;
        const record: StoredResponse = { request_hash: ctx.hash, status_code: reply.statusCode, response_body: body, path: req.url };
        await app.redis.set(ctx.redisKey, JSON.stringify(record), "EX", TTL_SECONDS);
        await sql`insert into idempotency_keys (scope_key, key, method, path, request_hash, status_code, response_body, expires_at)
                  values (${ctx.scopeKey}, ${ctx.key}, ${req.method}, ${req.url}, ${ctx.hash}, ${reply.statusCode}, ${JSON.stringify(body)}::jsonb, now() + interval '24 hours')
                  on conflict (scope_key, key) do nothing`;
      }
    } catch (err) {
      req.log.error({ err }, "idempotency: failed to store response");
    } finally {
      await app.redis.del(`${ctx.redisKey}:lock`).catch(() => undefined);
    }
    return payload;
  });
}, { name: "idempotency", dependencies: ["redis", "db"] });

declare module "fastify" {
  interface FastifyRequest {
    idempotency?: { scopeKey: string; key: string; hash: string; redisKey: string };
    subjectId?: string;
    clientIp: string;
  }
}
