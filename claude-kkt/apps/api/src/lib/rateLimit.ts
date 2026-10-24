import type { Redis } from "ioredis";
import { config } from "../config.js";
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
 * Client IP for rate limits, lockouts and audit rows. X-Forwarded-For is honoured only when TRUST_PROXY is on (the reverse proxy
 * rewrites it for untrusted clients); otherwise the socket address is used so a direct client cannot spoof its way past per-IP limits.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback: string | undefined, trustProxy: boolean = config.TRUST_PROXY): string {
  if (trustProxy) {
    const fwd = headers["x-forwarded-for"];
    const first = Array.isArray(fwd) ? fwd[0] : fwd;
    const hop = first?.split(",")[0]?.trim();
    if (hop) return hop.slice(0, 64);
  }
  return fallback ?? "unknown";
}
