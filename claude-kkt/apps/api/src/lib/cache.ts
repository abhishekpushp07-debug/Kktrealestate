import type { Redis } from "ioredis";

/**
 * Budget of one Redis round trip on a read-through cache path. Past it the source (Postgres) answers instead, so a slow or unreachable
 * Redis adds at most this much to a request (audit C: /auth/me took ~5 s during a Redis outage).
 */
export const CACHE_BUDGET_MS = 150;

/** ioredis connection states in which a command cannot be answered now (it would wait in the offline queue for a reconnect). */
const DOWN_STATES = new Set(["connecting", "reconnecting", "close", "end"]);

/**
 * True when a command on this client can be answered now. A client that lost its connection is skipped immediately (no budget spent):
 * during an outage ioredis keeps reconnecting and queues commands, which is right for writes that must survive a short blip but wrong
 * for cache reads, which have a source of truth to fall back to. Clients without a status (test doubles) count as usable.
 */
export function redisUsable(redis: Pick<Redis, "status"> | null | undefined): boolean {
  if (!redis) return false;
  const status = (redis as { status?: string }).status;
  return status === undefined || !DOWN_STATES.has(status);
}

/** Resolves with `p` or rejects once `ms` has passed (the command itself is not cancelled; its late result is ignored). */
export async function withinBudget<T>(p: Promise<T>, ms: number, what = "redis"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} exceeded ${ms} ms`)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Read-through JSON cache: returns the cached value for `key` or computes it with `fn` and stores it for `ttlSeconds`. Redis is optional
 * here: a disconnected client is skipped, and a read or write that takes longer than CACHE_BUDGET_MS is abandoned (the loader answers).
 */
export async function cached<T>(redis: Redis, key: string, ttlSeconds: number, fn: () => Promise<T>, budgetMs = CACHE_BUDGET_MS): Promise<T> {
  let healthy = redisUsable(redis);
  if (healthy) {
    try {
      const hit = await withinBudget(redis.get(key), budgetMs, "cache read");
      if (hit !== null && hit !== undefined) return JSON.parse(hit) as T;
    } catch {
      healthy = false; // unavailable or slow: the source answers, and the write is skipped (it would only spend a second budget)
    }
  }
  const value = await fn();
  if (healthy) {
    try { await withinBudget(redis.set(key, JSON.stringify(value), "EX", ttlSeconds), budgetMs, "cache write"); } catch { /* best effort */ }
  }
  return value;
}

/** Deletes every key starting with `prefix` (SCAN + DEL in batches; safe on large keyspaces). */
export async function invalidate(redis: Redis, prefix: string): Promise<number> {
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
    cursor = next;
    if (keys.length > 0) removed += await redis.del(...keys);
  } while (cursor !== "0");
  return removed;
}

/** Redis key under which the permission-cache generation lives; bumping it invalidates every cached user/role. */
export const PERM_VERSION_KEY = "perm:version";

/** Bumps the permission cache generation (call after any role/user/scope change). */
export async function bumpPermVersion(redis: Redis): Promise<number> {
  return redis.incr(PERM_VERSION_KEY);
}
