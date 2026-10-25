import type { Redis } from "ioredis";
import { ApiError } from "./errors.js";

/**
 * Sliding-window rate limit in Redis (two fixed windows weighted), multi-instance safe.
 * Throws 429 with Retry-After when `limit` requests per `windowSeconds` is exceeded for `bucket`.
 */
export async function enforceRateLimit(redis: Redis, bucket: string, limit: number, windowSeconds: number): Promise<{ remaining: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const current = Math.floor(now / windowMs);
  const keyNow = `rl:${bucket}:${current}`;
  const keyPrev = `rl:${bucket}:${current - 1}`;
  const [[, countNowRaw], , [, countPrevRaw]] = (await redis.multi().incr(keyNow).expire(keyNow, windowSeconds * 2).get(keyPrev).exec()) as [[null, number], [null, number], [null, string | null]];
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
 * Client IP for rate limits, lockouts and audit rows: Fastify's proxy-aware `req.ip`. X-Forwarded-For is honoured only for hops that
 * TRUST_PROXY trusts (default `loopback`), and the client is the right-most untrusted hop, so a caller cannot choose its own IP by
 * prepending addresses to the header. `_headers` is kept for call-site compatibility.
 */
export function clientIp(_headers: Record<string, string | string[] | undefined>, fallback: string | undefined): string {
  return (fallback ?? "unknown").slice(0, 64);
}
