import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { config } from "../config.js";
import { PERM_VERSION_KEY } from "../lib/cache.js";
import { loadCompany } from "../lib/company.js";
import { ApiError } from "../lib/errors.js";
import { verifyAccessToken, type AccessClaims, type TokenAudience } from "../lib/jwt.js";
import { clientIp, enforceRateLimit } from "../lib/rateLimit.js";
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

/** Prefixes served by third-party plugins (Swagger UI) that cannot carry `config.public`. */
const PUBLIC_PREFIXES = ["/api/v1/docs"];
/** Routes a user who must change their password may still call. */
const PASSWORD_CHANGE_EXEMPT = ["/auth/change-password", "/auth/logout", "/auth/me", "/auth/sessions", "/auth/password-policy"];
/** Routes an admin without MFA may still call while MFA is being forced. */
const MFA_EXEMPT = [...PASSWORD_CHANGE_EXEMPT, "/auth/mfa/enroll", "/auth/mfa/verify", "/auth/mfa/disable"];
const ADMIN_ROLES = new Set(["Super Admin", "Project Admin"]);
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const USER_CACHE_TTL = 30;

interface StaffRow {
  id: string; company_id: string; name: string; email: string; role_id: string; is_active: boolean; must_change_password: boolean; mfa_enabled: boolean;
  all_projects: boolean; role_name: string; is_system: boolean; permissions: string[]; role_active: boolean; project_ids: string[];
}
interface PortalRow {
  id: string; customer_id: string; company_id: string; phone: string; is_enabled: boolean; locked_until: string | null; must_change_password: boolean; full_name: string; customer_active: boolean;
}

/** Key of the revoked-session marker set when a refresh family is revoked (logout, reuse, admin). */
export function revokedSessionKey(sid: string): string {
  return `revoked:sid:${sid}`;
}

/** Marks a session family revoked so its (still unexpired) access tokens are rejected immediately. */
export async function markSessionRevoked(redis: Redis, sid: string): Promise<void> {
  await redis.set(revokedSessionKey(sid), "1", "EX", (config.ACCESS_TOKEN_MINUTES + 2) * 60);
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [scheme, token] = h.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

function endsWithAny(url: string, suffixes: readonly string[]): boolean {
  const clean = url.replace(/\/:[^/]+/g, "");
  return suffixes.some((s) => clean.endsWith(s));
}

/** Auth plugin: client IP, public rate limits, bearer verification per audience, staff RBAC + scope, portal identity, write rate limits. */
export default fp(async (app) => {
  app.decorateRequest("user", undefined);
  app.decorateRequest("customer", undefined);
  app.decorateRequest("authClaims", undefined);

  async function loadStaff(userId: string, sid: string): Promise<StaffRow> {
    const userKey = `perm:user:${userId}`;
    const [version, cachedRaw, revoked] = await app.redis.mget(PERM_VERSION_KEY, userKey, revokedSessionKey(sid));
    if (revoked) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    const v = version ?? "0";
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as { v: string; row: StaffRow };
      if (cached.v === v) return cached.row;
    }
    const rows = await app.db.execute<StaffRow>(sql`
      select u.id, u.company_id, u.name, u.email, u.role_id, u.is_active, u.must_change_password, u.mfa_enabled, u.all_projects,
             r.name as role_name, r.is_system, r.permissions, r.is_active as role_active,
             coalesce((select array_agg(s.project_id) from user_project_scopes s where s.user_id = u.id), '{}'::uuid[]) as project_ids
      from users u join roles r on r.id = u.role_id where u.id = ${userId}`);
    const row = rows[0];
    if (!row) throw ApiError.unauthenticated("User no longer exists", "INVALID_TOKEN");
    await app.redis.set(userKey, JSON.stringify({ v, row }), "EX", USER_CACHE_TTL).catch(() => undefined);
    return row;
  }

  async function loadPortal(portalUserId: string, sid: string): Promise<PortalRow> {
    const key = `perm:portal:${portalUserId}`;
    const [version, cachedRaw, revoked] = await app.redis.mget(PERM_VERSION_KEY, key, revokedSessionKey(sid));
    if (revoked) throw ApiError.unauthenticated("Session has been revoked", "SESSION_REVOKED");
    const v = version ?? "0";
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as { v: string; row: PortalRow };
      if (cached.v === v) return cached.row;
    }
    const rows = await app.db.execute<PortalRow>(sql`
      select pu.id, pu.customer_id, pu.company_id, pu.phone, pu.is_enabled, pu.locked_until, pu.must_change_password, c.full_name, c.is_active as customer_active
      from portal_users pu join customers c on c.id = pu.customer_id where pu.id = ${portalUserId}`);
    const row = rows[0];
    if (!row) throw ApiError.unauthenticated("Account no longer exists", "INVALID_TOKEN");
    await app.redis.set(key, JSON.stringify({ v, row }), "EX", USER_CACHE_TTL).catch(() => undefined);
    return row;
  }

  app.addHook("onRequest", async (req) => {
    req.clientIp = clientIp(req.headers, req.ip);
    const url = req.routeOptions.url;
    if (!url) return; // unknown route: let the 404 handler answer
    const cfg = req.routeOptions.config;
    if (cfg.public || PUBLIC_PREFIXES.some((p) => url.startsWith(p))) {
      const rl = cfg.rateLimit ?? { limit: config.PUBLIC_RATE_LIMIT_PER_MIN, windowSeconds: 60 };
      await enforceRateLimit(app.redis, `pub:${cfg.rateLimit ? url : "all"}:${req.clientIp}`, rl.limit, rl.windowSeconds);
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
      if (cfg.permission && !user.permissions.has(cfg.permission)) throw ApiError.forbidden(`Missing permission ${cfg.permission}`, { permission: cfg.permission });
      if (WRITE_METHODS.has(req.method)) await enforceRateLimit(app.redis, `w:${user.id}`, config.WRITE_RATE_LIMIT_PER_MIN, 60);
      return;
    }

    const row = await loadPortal(claims.sub, claims.sid);
    if (!row.is_enabled || !row.customer_active) throw ApiError.unauthenticated("Portal access is disabled", "USER_INACTIVE");
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) throw ApiError.locked("Account is temporarily locked", { locked_until: new Date(row.locked_until).toISOString() });
    const customer: PortalContext = { portalUserId: row.id, customerId: row.customer_id, companyId: row.company_id, phone: row.phone, name: row.full_name, mustChangePassword: row.must_change_password, sessionId: claims.sid };
    req.customer = customer;
    if (customer.mustChangePassword && !endsWithAny(url, PASSWORD_CHANGE_EXEMPT)) throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing");
    if (WRITE_METHODS.has(req.method)) await enforceRateLimit(app.redis, `w:${customer.portalUserId}`, config.WRITE_RATE_LIMIT_PER_MIN, 60);
  });
}, { name: "auth", dependencies: ["db", "redis"] });
