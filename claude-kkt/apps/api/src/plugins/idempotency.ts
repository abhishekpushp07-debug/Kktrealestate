import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { createHash } from "node:crypto";
import { registerJob } from "../jobs/index.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { installVersionPolicy } from "../lib/version.js";

declare module "fastify" {
  interface FastifyInstance { sql: Sql }
  interface FastifyContextConfig { idempotent?: boolean | "required"; permission?: string; audience?: "erp" | "portal"; public?: boolean; rateLimit?: { limit: number; windowSeconds: number; by?: "ip" | "subject" } }
}

const TTL_SECONDS = 24 * 3600;
/** How long a concurrent duplicate waits for the in-flight request to finish before giving up with 409. */
const WAIT_MS = 10_000;
/** An IN_PROGRESS record older than this is considered abandoned (crashed instance); a retry with the same key and body takes it over. */
export const IDEMPOTENCY_ABANDON_SECONDS = 60;
/** Budget of one Redis round trip on the idempotency fast path (Redis is only a cache; Postgres decides). */
const REDIS_BUDGET_MS = 200;
/** Rows deleted per statement by IDEMPOTENCY_PURGE. */
export const IDEMPOTENCY_PURGE_BATCH = 5_000;

interface StoredResponse { request_hash: string; status_code: number; response_body: unknown; path: string }
interface Row { request_hash: string; status_code: number | null; response_body: unknown; path: string }

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

/** Runs a Redis call within REDIS_BUDGET_MS; undefined when Redis is down, slow or errors. */
async function redisTry<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([fn(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), REDIS_BUDGET_MS); })]);
  } catch (err) {
    logger.warn({ err: (err as Error).message, what }, "idempotency: Redis unavailable; Postgres answers");
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Deletes expired idempotency records in batches of IDEMPOTENCY_PURGE_BATCH (job IDEMPOTENCY_PURGE, hourly). */
export async function purgeExpiredIdempotencyKeys(sql: Sql, batch = IDEMPOTENCY_PURGE_BATCH): Promise<{ deleted: number; batches: number }> {
  let deleted = 0;
  let batches = 0;
  for (;;) {
    const rows = await sql`delete from idempotency_keys where id in (select id from idempotency_keys where expires_at <= now() limit ${batch}) returning 1`;
    batches += 1;
    deleted += rows.length;
    if (rows.length < batch) break;
  }
  return { deleted, batches };
}

/**
 * Idempotency for creates. Routes opt in with `config.idempotent: true | "required"`. Scope = authenticated subject id (or client IP for
 * public routes) + key. Postgres is the source of truth and Redis only a cache:
 *  - preHandler claims the key with an IN_PROGRESS row (`status_code IS NULL`, insert … on conflict), so concurrent duplicates on any
 *    instance wait for the winner and replay its response, with or without Redis;
 *  - onSend stores a 2xx response in the same row (and in Redis); a non-2xx response releases the claim so the client may retry;
 *  - a claim still IN_PROGRESS after IDEMPOTENCY_ABANDON_SECONDS is abandoned (the instance died between COMMIT and storing): a retry
 *    with the same body takes it over and runs again — resource-level uniqueness (e.g. `payments` unique idempotency key) makes that
 *    retry return the original resource instead of a duplicate.
 * Replays carry `Idempotent-Replayed: true`; the same key with a different body is 422 IDEMPOTENCY_MISMATCH.
 */
export default fp(async (app) => {
  const sql = app.sql as Sql;
  installVersionPolicy(app);
  registerJob("IDEMPOTENCY_PURGE", async () => purgeExpiredIdempotencyKeys(sql));

  async function cachedResponse(redisKey: string): Promise<StoredResponse | null> {
    const raw = await redisTry("get", () => app.redis.get(redisKey));
    return raw ? (JSON.parse(raw) as StoredResponse) : null;
  }

  /** Claims the key: inserts the IN_PROGRESS row, or takes over an expired one or an abandoned one with the same request hash. */
  async function claim(scopeKey: string, key: string, req: FastifyRequest, hash: string): Promise<boolean> {
    const rows = await sql`
      insert into idempotency_keys (scope_key, key, method, path, request_hash, status_code, response_body, expires_at)
      values (${scopeKey}, ${key}, ${req.method}, ${req.url}, ${hash}, null, null, now() + make_interval(secs => ${TTL_SECONDS}))
      on conflict (scope_key, key) do update
        set method = excluded.method, path = excluded.path, request_hash = excluded.request_hash, status_code = null, response_body = null,
            created_at = now(), expires_at = excluded.expires_at
        where idempotency_keys.expires_at <= now()
           or (idempotency_keys.status_code is null and idempotency_keys.request_hash = excluded.request_hash
               and idempotency_keys.created_at < now() - make_interval(secs => ${IDEMPOTENCY_ABANDON_SECONDS}))
      returning id`;
    return rows.length === 1;
  }

  async function current(scopeKey: string, key: string): Promise<Row | null> {
    const rows = await sql<Row[]>`select request_hash, status_code, response_body, path from idempotency_keys where scope_key = ${scopeKey} and key = ${key} and expires_at > now()`;
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
    const cached = await cachedResponse(redisKey);
    if (cached) return replay(reply, cached, hash);
    const deadline = Date.now() + WAIT_MS;
    let pause = 25;
    for (;;) {
      if (await claim(scopeKey, keyStr, req, hash)) {
        req.idempotency = { scopeKey, key: keyStr, hash, redisKey };
        return;
      }
      const row = await current(scopeKey, keyStr);
      if (row && row.request_hash !== hash) throw new ApiError(422, "IDEMPOTENCY_MISMATCH", "Idempotency-Key was already used with a different request");
      if (row && row.status_code !== null) return replay(reply, { request_hash: row.request_hash, status_code: row.status_code, response_body: row.response_body, path: row.path }, hash);
      // IN_PROGRESS on this or another instance (or released a moment ago): wait and look again
      if (Date.now() > deadline) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "An identical request is already being processed");
      await sleep(pause);
      pause = Math.min(pause * 2, 250);
      const late = await cachedResponse(redisKey);
      if (late) return replay(reply, late, hash);
    }
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const ctx = req.idempotency;
    if (!ctx) return payload;
    req.idempotency = undefined;
    try {
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        const body: unknown = typeof payload === "string" && payload.length > 0 ? JSON.parse(payload) : null;
        await sql`update idempotency_keys set status_code = ${reply.statusCode}, response_body = ${JSON.stringify(body)}::jsonb, path = ${req.url}
                  where scope_key = ${ctx.scopeKey} and key = ${ctx.key} and request_hash = ${ctx.hash}`;
        const record: StoredResponse = { request_hash: ctx.hash, status_code: reply.statusCode, response_body: body, path: req.url };
        await redisTry("set", () => app.redis.set(ctx.redisKey, JSON.stringify(record), "EX", TTL_SECONDS));
      } else {
        // only successes are remembered: release the claim so the client may retry with the same key
        await sql`delete from idempotency_keys where scope_key = ${ctx.scopeKey} and key = ${ctx.key} and status_code is null`;
      }
    } catch (err) {
      // the claim stays IN_PROGRESS and is taken over after IDEMPOTENCY_ABANDON_SECONDS; resource-level keys prevent duplicates
      req.log.error({ err }, "idempotency: failed to store the response");
    }
    return payload;
  });
}, { name: "idempotency", dependencies: ["redis", "db"] });

declare module "fastify" {
  interface FastifyRequest {
    idempotency?: { scopeKey: string; key: string; hash: string; redisKey: string } | undefined;
    subjectId?: string;
    clientIp: string;
  }
}
