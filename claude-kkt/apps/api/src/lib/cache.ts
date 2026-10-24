import type { Redis } from "ioredis";

/** Read-through JSON cache: returns the cached value for `key` or computes it with `fn` and stores it for `ttlSeconds`. */
export async function cached<T>(redis: Redis, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    /* cache unavailable: fall through to the source */
  }
  const value = await fn();
  try { await redis.set(key, JSON.stringify(value), "EX", ttlSeconds); } catch { /* best effort */ }
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
