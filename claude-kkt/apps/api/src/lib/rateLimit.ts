import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { ApiError } from "./errors.js";

/**
 * One round trip for the two-window counter: INCR the current window (and refresh its expiry), read the previous one. Atomic like the
 * MULTI/EXEC it replaces (MULTI, INCR, EXPIRE, GET, EXEC = five commands and five replies per request); both keys belong to one bucket.
 */
const SLIDING_WINDOW_SCRIPT = `local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
local prev = redis.call('GET', KEYS[2])
return {n, prev}`;
const SLIDING_WINDOW_SHA = createHash("sha1").update(SLIDING_WINDOW_SCRIPT).digest("hex");

type ScriptRunner = Pick<Redis, "evalsha" | "eval">;

/** EVALSHA, loading the script with EVAL when the server does not have it cached yet (first call, restart, SCRIPT FLUSH). */
async function slidingWindowCounts(
  redis: ScriptRunner,
  keyNow: string,
  keyPrev: string,
  ttlSeconds: number,
): Promise<[number, string | null]> {
  try {
    return (await redis.evalsha(SLIDING_WINDOW_SHA, 2, keyNow, keyPrev, ttlSeconds)) as [number, string | null];
  } catch (err) {
    if (!String((err as Error).message).startsWith("NOSCRIPT")) throw err;
    return (await redis.eval(SLIDING_WINDOW_SCRIPT, 2, keyNow, keyPrev, ttlSeconds)) as [number, string | null];
  }
}

/**
 * Sliding-window rate limit in Redis (two fixed windows weighted), multi-instance safe.
 * Throws 429 with Retry-After when `limit` requests per `windowSeconds` is exceeded for `bucket`.
 */
export async function enforceRateLimit(
  redis: ScriptRunner,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<{ remaining: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const current = Math.floor(now / windowMs);
  const keyNow = `rl:${bucket}:${current}`;
  const keyPrev = `rl:${bucket}:${current - 1}`;
  const [countNowRaw, countPrevRaw] = await slidingWindowCounts(redis, keyNow, keyPrev, windowSeconds * 2);
  const countNow = Number(countNowRaw);
  const countPrev = Number(countPrevRaw ?? 0);
  const elapsedFraction = (now % windowMs) / windowMs;
  const weighted = countPrev * (1 - elapsedFraction) + countNow;
  if (weighted > limit) {
    const retry = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
    throw ApiError.rateLimited(retry);
  }
  return { remaining: Math.max(0, Math.floor(limit - weighted)) };
}

/**
 * Client IP for rate limits, lockouts, the public idempotency scope, audit rows and login events: Fastify's proxy-aware `req.ip`.
 * X-Forwarded-For is honoured only for hops that TRUST_PROXY trusts (default `loopback`), and the client is the right-most untrusted
 * hop, so a caller cannot choose its own IP by sending or prepending X-Forwarded-For. Nothing else in the API reads that header.
 */
export function clientIp(req: { ip?: string | undefined }): string {
  return (req.ip || "unknown").slice(0, 64);
}
