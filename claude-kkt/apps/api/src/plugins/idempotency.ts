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

function requestHash(req: FastifyRequest): string {
  return createHash("sha256").update(req.method).update(req.url).update(JSON.stringify(req.body ?? null)).digest("hex");
}

/**
 * Idempotency for creates. Routes opt in with `config.idempotent: true | "required"`.
 * Scope = authenticated subject id (or client IP for public routes) + key. Replays return the stored response with `Idempotent-Replayed: true`;
 * the same key with a different body is 422 IDEMPOTENCY_MISMATCH. Stored in Redis (fast path) and Postgres (durable).
 */
export default fp(async (app) => {
  const sql = app.sql as Sql;
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
    const scope = req.subjectId ?? req.clientIp;
    const scopeKey = `${scope}`;
    const hash = requestHash(req);
    const redisKey = `idem:${scopeKey}:${keyStr}`;
    let stored: { request_hash: string; status_code: number; response_body: unknown; path: string } | null = null;
    const cached = await app.redis.get(redisKey);
    if (cached) stored = JSON.parse(cached);
    else {
      const rows = await sql<{ request_hash: string; status_code: number; response_body: unknown; path: string }[]>`select request_hash, status_code, response_body, path from idempotency_keys where scope_key = ${scopeKey} and key = ${keyStr} and expires_at > now()`;
      stored = rows[0] ?? null;
    }
    if (stored) {
      if (stored.request_hash !== hash) throw new ApiError(422, "IDEMPOTENCY_MISMATCH", "Idempotency-Key was already used with a different request");
      reply.header("Idempotent-Replayed", "true");
      reply.status(stored.status_code).send(stored.response_body);
      return reply;
    }
    // Lock to avoid two concurrent identical requests both executing.
    const lock = await app.redis.set(`${redisKey}:lock`, "1", "EX", 30, "NX");
    if (!lock) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "An identical request is already being processed");
    req.idempotency = { scopeKey, key: keyStr, hash, redisKey };
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const ctx = req.idempotency;
    if (!ctx) return payload;
    try {
      if (reply.statusCode < 500 && typeof payload === "string") {
        const body = JSON.parse(payload);
        const record = { request_hash: ctx.hash, status_code: reply.statusCode, response_body: body, path: req.url };
        await app.redis.set(ctx.redisKey, JSON.stringify(record), "EX", TTL_SECONDS);
        await sql`insert into idempotency_keys (scope_key, key, method, path, request_hash, status_code, response_body, expires_at)
                  values (${ctx.scopeKey}, ${ctx.key}, ${req.method}, ${req.url}, ${ctx.hash}, ${reply.statusCode}, ${sql.json(body as never)}, now() + interval '24 hours')
                  on conflict (scope_key, key) do nothing`;
      }
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
