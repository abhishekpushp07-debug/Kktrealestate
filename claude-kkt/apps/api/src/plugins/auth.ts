import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { config } from "../config.js";
import { PERM_VERSION_KEY } from "../lib/cache.js";
import { loadCompany } from "../lib/company.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { verifyAccessToken, type AccessClaims, type TokenAudience } from "../lib/jwt.js";
import { clientIp, enforceRateLimit } from "../lib/rateLimit.js";
import { isPublicPrefix, permissionAlternatives } from "../lib/routes.js";
import type { PortalContext, StaffContext } from "../lib/scope.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Authenticated staff member (staff routes only). */
    user?: StaffContext;
    /** Authenticated portal customer (portal routes only). */
    customer?: PortalContext;
    /** Access-token claims of the current request (set on authenticated routes). */
    authClaims?: AccessClaims;
  }
}

/** The only routes a user who must change their password may still call (staff and portal): change-password, logout, me. */
const PASSWORD_CHANGE_EXEMPT = ["/auth/change-password", "/auth/logout", "/auth/me"];
/** Routes an admin without MFA may still call while MFA is being forced (self-service + enrolment). */
const MFA_EXEMPT = [...PASSWORD_CHANGE_EXEMPT, "/auth/sessions", "/auth/mfa/enroll", "/auth/mfa/verify", "/auth/mfa/disable"];
const ADMIN_ROLES = new Set(["Super Admin", "Project Admin"]);
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const USER_CACHE_TTL = 30;

type StaffRow = {
  id: string; company_id: string; name: string; email: string; role_id: string; is_active: boolean; must_change_password: boolean; mfa_enabled: boolean;
  all_projects: boolean; role_name: string; is_system: boolean; permissions: string[]; role_active: boolean; project_ids: string[];
};
type PortalRow = {
  id: string; customer_id: string; company_id: string; phone: string; is_enabled: boolean; locked_until: string | null; must_change_password: boolean; full_name: string; customer_active: boolean;
};

/** Key of the revoked-session marker set when a refresh family is revoked (logout, reuse, admin). */
export function revokedSessionKey(sid: string): string {
  return `revoked:sid:${sid}`;
}

/**
 * The Redis that holds security state (revocation markers, rate limits): `app.redisSecurity` when the platform plugin provides one
 * (REDIS_SECURITY_URL, a `noeviction` instance), otherwise the shared `app.redis`.
 */
export function securityRedis(app: FastifyInstance): Redis {
  return (app as unknown as { redisSecurity?: Redis }).redisSecurity ?? app.redis;
}

/** Budget for one Redis round trip on the authentication path before the database answers instead. */
const REDIS_AUTH_BUDGET_MS = 250;

/** Runs a Redis command with a short budget; `undefined` when Redis is down, slow or errors (the caller falls back to the database). */
async function redisTry<T>(what: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`redis ${what} exceeded ${REDIS_AUTH_BUDGET_MS} ms`)), REDIS_AUTH_BUDGET_MS); }),
    ]);
    return { ok: true, value };
  } catch (err) {
    logger.warn({ err: (err as Error).message, what }, "redis unavailable on the auth path; using the database");
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Marks session families revoked so their (still unexpired) access tokens are rejected immediately. Best effort: the database
 * (refresh_tokens.revoked_at) is the source of truth and the auth plugin consults it whenever the marker store cannot be read.
 */
export async function markSessionsRevoked(redis: Redis, sids: readonly string[]): Promise<void> {
  if (sids.length === 0) return;
  const ttl = (config.ACCESS_TOKEN_MINUTES + 2) * 60;
  if (await writeMarkers(redis, sids, ttl)) return;
  logger.error({ sessions: sids.length }, "could not write revocation markers; enforced from the database and this process, retried in the background");
  const until = Date.now() + ttl * 1000;
  for (const sid of sids) pendingRevocations.set(sid, until);
  scheduleMarkerRetry(redis);
}

async function writeMarkers(redis: Redis, sids: readonly string[], ttlSeconds: number): Promise<boolean> {
  const pipe = redis.multi();
  for (const sid of sids) pipe.set(revokedSessionKey(sid), "1", "EX", ttlSeconds);
  const r = await redisTry("revocation marker write", () => pipe.exec());
  return r.ok && (r.value ?? []).every(([err]) => !err);
}

/**
 * Revocations whose marker could not be written (Redis down): this process rejects them at once, and a background retry writes the
 * markers as soon as Redis answers again so every other instance (whose cached rows would otherwise still pass) learns about them too.
 */
const pendingRevocations = new Map<string, number>();
let markerRetry: NodeJS.Timeout | null = null;

function scheduleMarkerRetry(redis: Redis): void {
  if (markerRetry) return;
  markerRetry = setInterval(() => {
    const now = Date.now();
    for (const [sid, until] of pendingRevocations) if (until <= now) pendingRevocations.delete(sid);
    if (pendingRevocations.size === 0) {
      if (markerRetry) clearInterval(markerRetry);
      markerRetry = null;
      return;
    }
    const sids = [...pendingRevocations.keys()];
    const ttl = Math.max(1, Math.ceil((Math.max(...sids.map((sid) => pendingRevocations.get(sid) ?? now)) - now) / 1000));
    void writeMarkers(redis, sids, ttl).then((ok) => {
      if (!ok) return;
      for (const sid of sids) pendingRevocations.delete(sid);
      logger.info({ sessions: sids.length }, "revocation markers written after Redis recovered");
    });
  }, 2_000);
  markerRetry.unref();
}

/** True while this process knows a session is revoked but could not yet publish the marker. */
function pendingRevoked(sid: string): boolean {
  const until = pendingRevocations.get(sid);
  return until !== undefined && until > Date.now();
}

/** Marks one session family revoked (see markSessionsRevoked). */
export async function markSessionRevoked(redis: Redis, sid: string): Promise<void> {
  await markSessionsRevoked(redis, [sid]);
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [scheme, token] = h.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

/** True when the route url (minus `:param` segments) is one of the auth self-service suffixes, under `/api/v1` or `/api/v1/portal`. */
function endsWithAny(url: string, suffixes: readonly string[]): boolean {
  const clean = url.replace(/\/:[^/]+/g, "");
  return suffixes.some((s) => clean === `/api/v1${s}` || clean === `/api/v1/portal${s}`);
}

/** Auth plugin: client IP, public rate limits, bearer verification per audience, staff RBAC + scope, portal identity, write rate limits. */
export default fp(async (app) => {
  app.decorateRequest("user", undefined);
  app.decorateRequest("customer", undefined);
  app.decorateRequest("authClaims", undefined);

  /**
   * Cached row + revocation marker from Redis. Revocation lives in the security Redis, the row cache in the shared one; when either
   * cannot be read the database answers (user/role/permissions from the tables, revocation from refresh_tokens), so a Redis outage
   * degrades to slower requests instead of 500s and never un-revokes a session.
   */
  async function cachedState<Row>(cacheKey: string, sid: string): Promise<{ row: Row | null; version: string | null; revoked: boolean | null }> {
    const sec = securityRedis(app);
    if (sec === app.redis) {
      const r = await redisTry("auth mget", () => app.redis.mget(PERM_VERSION_KEY, cacheKey, revokedSessionKey(sid)));
      if (!r.ok) return { row: null, version: null, revoked: null };
      const [version, raw, revoked] = r.value;
      return { row: fromCache<Row>(raw ?? null, version ?? "0"), version: version ?? "0", revoked: Boolean(revoked) };
    }
    const [cache, marker] = await Promise.all([
      redisTry("auth cache mget", () => app.redis.mget(PERM_VERSION_KEY, cacheKey)),
      redisTry("revocation marker read", () => sec.get(revokedSessionKey(sid))),
    ]);
    const version = cache.ok ? (cache.value[0] ?? "0") : null;
    return { row: cache.ok ? fromCache<Row>(cache.value[1] ?? null, version ?? "0") : null, version, revoked: marker.ok ? Boolean(marker.value) : null };
  }

  function fromCache<Row>(raw: string | null, version: string): Row | null {
    if (!raw) return null;
    try {
      const cached = JSON.parse(raw) as { v: string; row: Row };
      return cached.v === version ? cached.row : null;
    } catch { return null; }
  }

  async function storeCache(key: string, version: string | null, row: unknown): Promise<void> {
    if (version === null) return; // Redis was unreadable a moment ago: do not wait on it again
    await redisTry("auth cache write", () => app.redis.set(key, JSON.stringify({ v: version, row }), "EX", USER_CACHE_TTL));
  }

  /** Session revocation from the database: a family is revoked once any of its refresh tokens carries revoked_at. */
  const revokedSql = (sid: string) => sql`exists (select 1 from refresh_tokens rt where rt.family_id = ${sid}::uuid and rt.revoked_at is not null)`;

  async function loadStaff(userId: string, sid: string): Promise<StaffRow> {
    if (pendingRevoked(sid)) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    const userKey = `perm:user:${userId}`;
    const state = await cachedState<StaffRow>(userKey, sid);
    if (state.revoked === true) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    if (state.row && state.revoked === false) return state.row;
    const rows = await app.db.execute<StaffRow & { session_revoked: boolean }>(sql`
      select u.id, u.company_id, u.name, u.email, u.role_id, u.is_active, u.must_change_password, u.mfa_enabled, u.all_projects,
             r.name as role_name, r.is_system, r.permissions, r.is_active as role_active,
             coalesce((select array_agg(s.project_id) from user_project_scopes s where s.user_id = u.id), '{}'::uuid[]) as project_ids,
             ${revokedSql(sid)} as session_revoked
      from users u join roles r on r.id = u.role_id where u.id = ${userId}`);
    const found = rows[0];
    if (!found) throw ApiError.unauthenticated("User no longer exists", "INVALID_TOKEN");
    if (found.session_revoked) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    const { session_revoked: _r, ...row } = found;
    if (!state.row) await storeCache(userKey, state.version, row);
    return row;
  }

  async function loadPortal(portalUserId: string, sid: string): Promise<PortalRow> {
    if (pendingRevoked(sid)) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    const key = `perm:portal:${portalUserId}`;
    const state = await cachedState<PortalRow>(key, sid);
    if (state.revoked === true) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    if (state.row && state.revoked === false) return state.row;
    const rows = await app.db.execute<PortalRow & { session_revoked: boolean }>(sql`
      select pu.id, pu.customer_id, pu.company_id, pu.phone, pu.is_enabled, pu.locked_until, pu.must_change_password, c.full_name, c.is_active as customer_active,
             ${revokedSql(sid)} as session_revoked
      from portal_users pu join customers c on c.id = pu.customer_id where pu.id = ${portalUserId}`);
    const found = rows[0];
    if (!found) throw ApiError.unauthenticated("Account no longer exists", "INVALID_TOKEN");
    if (found.session_revoked) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    const { session_revoked: _r, ...row } = found;
    if (!state.row) await storeCache(key, state.version, row);
    return row;
  }

  /** Rate limits live in the security Redis; when it cannot be reached they fail open (logged) — the DB-backed lockout still applies. */
  async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // Same budget as the other Redis reads on this path: a down Redis (client retrying with an offline queue) must not add seconds to
      // every request before failing open.
      await Promise.race([
        enforceRateLimit(securityRedis(app), bucket, limit, windowSeconds),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`rate limit exceeded ${REDIS_AUTH_BUDGET_MS} ms`)), REDIS_AUTH_BUDGET_MS); }),
      ]);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.warn({ err: (err as Error).message, bucket }, "rate limit store unavailable; request allowed");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  app.addHook("onRequest", async (req) => {
    req.clientIp = clientIp(req);
    const url = req.routeOptions.url;
    if (!url) return; // unknown route: let the 404 handler answer
    const cfg = req.routeOptions.config;
    if (cfg.public || isPublicPrefix(url)) {
      const rl = cfg.rateLimit ?? { limit: config.PUBLIC_RATE_LIMIT_PER_MIN, windowSeconds: 60 };
      await rateLimit(`pub:${cfg.rateLimit ? url : "all"}:${req.clientIp}`, rl.limit, rl.windowSeconds);
      return;
    }
    const audience: TokenAudience = cfg.audience ?? "erp";
    const token = bearer(req);
    if (!token) throw ApiError.unauthenticated("Missing bearer token");
    const result = await verifyAccessToken(token, audience);
    if (!result.ok) {
      if (result.reason === "WRONG_AUDIENCE") throw ApiError.unauthenticated("Token is not valid for this surface", "INVALID_AUDIENCE");
      if (result.reason === "EXPIRED") throw ApiError.unauthenticated("Access token expired", "TOKEN_EXPIRED");
      throw ApiError.unauthenticated("Invalid access token", "INVALID_TOKEN");
    }
    const claims = result.claims;
    req.authClaims = claims;
    req.subjectId = claims.sub;

    if (audience === "erp") {
      const row = await loadStaff(claims.sub, claims.sid);
      if (!row.is_active || !row.role_active) throw ApiError.unauthenticated("User is inactive", "USER_INACTIVE");
      const user: StaffContext = {
        id: row.id, companyId: row.company_id, name: row.name, email: row.email, roleId: row.role_id, roleName: row.role_name, isSystemRole: row.is_system,
        permissions: new Set(row.permissions), allProjects: row.all_projects, projectIds: row.project_ids ?? [], mustChangePassword: row.must_change_password,
        mfaEnabled: row.mfa_enabled, sessionId: claims.sid,
      };
      req.user = user;
      if (user.mustChangePassword && !endsWithAny(url, PASSWORD_CHANGE_EXEMPT)) throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing");
      if (!claims.mfa && ADMIN_ROLES.has(user.roleName) && !endsWithAny(url, MFA_EXEMPT)) {
        const company = await loadCompany(app.db, app.redis, user.companyId);
        if (company.settings.force_mfa_for_admins) throw new ApiError(403, "MFA_REQUIRED", "Multi-factor authentication is required for administrators");
      }
      if (cfg.permission) {
        const alternatives = permissionAlternatives(cfg.permission);
        if (!alternatives.some((p) => user.permissions.has(p))) throw ApiError.forbidden(`Missing permission ${alternatives.join(" or ")}`, { permission: alternatives[0], alternatives });
      }
      if (WRITE_METHODS.has(req.method)) await rateLimit(`w:${user.id}`, config.WRITE_RATE_LIMIT_PER_MIN, 60);
      return;
    }

    const row = await loadPortal(claims.sub, claims.sid);
    if (!row.is_enabled || !row.customer_active) throw ApiError.unauthenticated("Portal access is disabled", "USER_INACTIVE");
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) throw ApiError.locked("Account is temporarily locked", { locked_until: new Date(row.locked_until).toISOString() });
    const customer: PortalContext = { portalUserId: row.id, customerId: row.customer_id, companyId: row.company_id, phone: row.phone, name: row.full_name, mustChangePassword: row.must_change_password, sessionId: claims.sid };
    req.customer = customer;
    if (customer.mustChangePassword && !endsWithAny(url, PASSWORD_CHANGE_EXEMPT)) throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing");
    if (WRITE_METHODS.has(req.method)) await rateLimit(`w:${customer.portalUserId}`, config.WRITE_RATE_LIMIT_PER_MIN, 60);
  });
}, { name: "auth", dependencies: ["db", "redis"] });
