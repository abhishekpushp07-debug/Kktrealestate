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

/**
 * Resolves with `p` or rejects once `ms` has passed (the command itself is not cancelled; its late result is ignored). Hot path (every
 * cached read and every Redis call on the authentication path): one promise and one timer, no `Promise.race` and no async wrapper.
 *
 * The budget measures Redis, not the event loop: timers run before I/O in an event-loop iteration, so under heavy load the timer can
 * fire while the reply is already waiting in the socket. The rejection is therefore deferred by one `setImmediate` (after this
 * iteration's poll phase); a reply that was already there wins, and a busy process does not fall back to the (far more expensive)
 * database for answers Redis gave in time. A dead or slow Redis still costs at most the budget plus one loop iteration.
 */
export function withinBudget<T>(p: Promise<T>, ms: number, what = "redis"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      setImmediate(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`${what} exceeded ${ms} ms`));
      });
    }, ms);
    p.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}

/**
 * Read-through JSON cache: returns the cached value for `key` or computes it with `fn` and stores it for `ttlSeconds`. Redis is optional
 * here: a disconnected client is skipped, and a read or write that takes longer than CACHE_BUDGET_MS is abandoned (the loader answers).
 */
export async function cached<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  budgetMs = CACHE_BUDGET_MS,
): Promise<T> {
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
    try {
      await withinBudget(redis.set(key, JSON.stringify(value), "EX", ttlSeconds), budgetMs, "cache write");
    } catch {
      /* best effort */
    }
  }
  return value;
}

/**
 * Read-through cache of a ready-made TEXT value (e.g. a serialized response body): like {@link cached}, but the string is stored and
 * returned as is — no JSON.parse on a hit, so a large body costs one Redis GET and nothing else.
 */
export async function cachedText(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<string>,
  budgetMs = CACHE_BUDGET_MS,
): Promise<string> {
  let healthy = redisUsable(redis);
  if (healthy) {
    try {
      const hit = await withinBudget(redis.get(key), budgetMs, "cache read");
      if (hit !== null && hit !== undefined) return hit;
    } catch {
      healthy = false;
    }
  }
  const value = await fn();
  if (healthy) {
    try {
      await withinBudget(redis.set(key, value, "EX", ttlSeconds), budgetMs, "cache write");
    } catch {
      /* best effort */
    }
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

/**
 * Redis key of the GLOBAL auth-cache generation. Bumping it invalidates every cached staff and portal auth row at once, so it is kept for
 * whole-dataset events only (reseed, restore). Everything else bumps a scoped version (bumpAuthVersions).
 */
export const PERM_VERSION_KEY = "perm:version";

/** Bumps the global auth-cache generation (reseed / restore only; per-subject changes use bumpAuthVersions). */
export async function bumpPermVersion(redis: Redis): Promise<number> {
  return redis.incr(PERM_VERSION_KEY);
}

/** What an auth-cache version is kept for: a staff user, a portal user, a role (permission edits) or a company (auth settings). */
export type AuthVersionScope = "user" | "portal" | "role" | "company";

/** Redis key of one scoped auth-cache version. */
export function authVersionKey(scope: AuthVersionScope, id: string): string {
  return `authv:${scope}:${id}`;
}

/**
 * Version keys outlive every cached auth row (30 s) by far, so a key that expired after a day of silence can never make an old row match
 * again (a missing key reads as "0" and every row cached under a later value has expired long before).
 */
export const AUTH_VERSION_TTL_SECONDS = 86_400;

/** Subjects whose cached auth rows must be re-read (see bumpAuthVersions). */
export interface AuthVersionTargets {
  users?: readonly string[];
  portalUsers?: readonly string[];
  roles?: readonly string[];
  companies?: readonly string[];
}

/** Budget of a version bump: past it the bump is logged and abandoned (cached rows then expire within their 30 s TTL). */
const BUMP_BUDGET_MS = 1_000;

/**
 * Invalidates the cached auth rows of exactly these subjects (audit C: one portal password change used to invalidate every cached
 * principal): a staff user's password, sessions or state → `users`; a portal user's → `portalUsers`; a role's permissions or state →
 * `roles` (every holder re-reads); a company's auth settings → `companies`. One pipeline; never throws (a failure is logged and the rows
 * expire with their 30 s TTL — session revocation itself never depends on this, it has its own markers and the database).
 */
export async function bumpAuthVersions(
  redis: Redis,
  targets: AuthVersionTargets,
  log: { warn: (obj: object, msg: string) => void } = console,
): Promise<void> {
  const keys = [
    ...(targets.users ?? []).map((id) => authVersionKey("user", id)),
    ...(targets.portalUsers ?? []).map((id) => authVersionKey("portal", id)),
    ...(targets.roles ?? []).map((id) => authVersionKey("role", id)),
    ...(targets.companies ?? []).map((id) => authVersionKey("company", id)),
  ];
  if (keys.length === 0) return;
  if (!redisUsable(redis)) {
    log.warn(
      { keys: keys.length },
      "auth cache version bump skipped: Redis is disconnected (cached rows expire within 30 s)",
    );
    return;
  }
  try {
    const pipe = redis.multi();
    for (const k of keys) pipe.incr(k).expire(k, AUTH_VERSION_TTL_SECONDS);
    await withinBudget(pipe.exec(), BUMP_BUDGET_MS, "auth version bump");
  } catch (err) {
    log.warn(
      { err: (err as Error).message, keys: keys.length },
      "auth cache version bump failed (cached rows expire within 30 s)",
    );
  }
}
