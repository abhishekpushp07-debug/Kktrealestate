import { count, eq, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdSchema, LogoutSchema, OkResponseSchema, PASSWORD_POLICY, PortalChangePasswordSchema, PortalLoginResponseSchema, PortalLoginSchema, PortalRefreshSchema, PortalSessionRowSchema, PortalUserSchema, type PortalUser } from "@kkt/contracts";
import { bookingCoApplicants, bookings, customers, portalUsers, type Executor } from "@kkt/db";
import { normalizeIndianPhone } from "@kkt/domain";
import { writeAudit } from "../../lib/audit.js";
import { bumpPermVersion } from "../../lib/cache.js";
import { ApiError } from "../../lib/errors.js";
import { verifyPassword } from "../../lib/password.js";
import { route } from "../../lib/routes.js";
import { applyPortalFailure, assertNotLocked, createSession, familyOfSession, listSessions, newPasswordHash, recordLoginEvent, revokeAllFamilies, revokeFamily, rotateRefresh } from "./service.js";

/** Builds the PortalUser view for a portal user id. */
export async function portalUserView(db: Executor, portalUserId: string): Promise<PortalUser> {
  const [row] = await db
    .select({ pu: portalUsers, c: customers })
    .from(portalUsers)
    .innerJoin(customers, eq(customers.id, portalUsers.customerId))
    .where(eq(portalUsers.id, portalUserId))
    .limit(1);
  if (!row) throw ApiError.notFound("Account");
  const [bc] = await db
    .select({ n: count() })
    .from(bookings)
    .where(or(eq(bookings.customerId, row.c.id), sql`${bookings.id} in (select ${bookingCoApplicants.bookingId} from ${bookingCoApplicants} where ${bookingCoApplicants.customerId} = ${row.c.id})`));
  return {
    customer_id: row.c.id,
    customer_code: row.c.customerCode,
    full_name: row.c.fullName,
    phone: row.pu.phone,
    email: row.c.email,
    must_change_password: row.pu.mustChangePassword,
    booking_count: Number(bc?.n ?? 0),
    last_login_at: row.pu.lastLoginAt ? row.pu.lastLoginAt.toISOString() : null,
  };
}

/** Portal (customer) auth endpoints mirroring the staff contract under /portal/auth/*. */
export async function portalAuthRoutes(app: FastifyInstance): Promise<void> {
  route(app, {
    method: "POST", url: "/portal/auth/login", public: true, rateLimit: { limit: 10, windowSeconds: 60 },
    schema: { body: PortalLoginSchema, response: { 200: PortalLoginResponseSchema }, summary: "Customer login (phone + password)" },
    handler: async (req) => {
      const phone = normalizeIndianPhone(req.body.phone) ?? req.body.phone;
      return app.db.transaction(async (tx) => {
        const [pu] = await tx.select().from(portalUsers).where(eq(portalUsers.phone, phone)).limit(1);
        if (!pu) {
          await recordLoginEvent(tx, { companyId: null, subjectType: "CUSTOMER", identifier: phone, success: false, reason: "UNKNOWN_USER", req });
          throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid phone number or password");
        }
        assertNotLocked(pu);
        if (!(await verifyPassword(pu.passwordHash, req.body.password))) {
          const next = await applyPortalFailure(tx, pu);
          await recordLoginEvent(tx, { companyId: pu.companyId, subjectType: "CUSTOMER", identifier: phone, success: false, reason: next.justLocked ? "LOCKED" : "BAD_PASSWORD", req });
          if (next.justLocked) {
            await writeAudit(tx, { companyId: pu.companyId, actor: { type: "SYSTEM", id: null, name: "lockout" }, action: "portal_auth.locked", entityType: "portal_user", entityId: pu.id, after: { locked_until: next.lockedUntil }, ip: req.clientIp, requestId: req.id });
            throw ApiError.locked(`Account locked for ${PASSWORD_POLICY.lockout_minutes} minutes after ${PASSWORD_POLICY.lockout_attempts} failed attempts`, { locked_until: next.lockedUntil!.toISOString() });
          }
          throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid phone number or password");
        }
        if (!pu.isEnabled) {
          await recordLoginEvent(tx, { companyId: pu.companyId, subjectType: "CUSTOMER", identifier: phone, success: false, reason: "DISABLED", req });
          throw ApiError.unauthenticated("Portal access is disabled", "USER_INACTIVE");
        }
        const tokens = await createSession(tx, { type: "CUSTOMER", id: pu.id, companyId: pu.companyId, aud: "portal" }, req, { mfa: false, mustChangePassword: pu.mustChangePassword });
        await tx.update(portalUsers).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(portalUsers.id, pu.id));
        await recordLoginEvent(tx, { companyId: pu.companyId, subjectType: "CUSTOMER", identifier: phone, success: true, reason: null, req });
        const user = await portalUserView(tx, pu.id);
        await writeAudit(tx, { companyId: pu.companyId, actor: { type: "CUSTOMER", id: pu.customerId, name: user.full_name }, action: "portal_auth.login", entityType: "portal_user", entityId: pu.id, after: { session_id: tokens.family_id }, ip: req.clientIp, requestId: req.id });
        return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, token_type: tokens.token_type, expires_in: tokens.expires_in, audience: tokens.audience, user };
      });
    },
  });

  route(app, {
    method: "POST", url: "/portal/auth/refresh", public: true, rateLimit: { limit: 60, windowSeconds: 60 },
    schema: { body: PortalRefreshSchema, response: { 200: PortalLoginResponseSchema.omit({ user: true }) }, summary: "Rotate a customer refresh token" },
    handler: async (req) => {
      const t = await rotateRefresh(app, req, req.body.refresh_token, "portal", async (tx, subjectId) => {
        const [pu] = await tx.select().from(portalUsers).where(eq(portalUsers.id, subjectId)).limit(1);
        if (!pu || !pu.isEnabled) return null;
        return { companyId: pu.companyId, mfa: false, mustChangePassword: pu.mustChangePassword, actor: { type: "CUSTOMER", id: pu.customerId, name: null } };
      });
      return { access_token: t.access_token, refresh_token: t.refresh_token, token_type: t.token_type, expires_in: t.expires_in, audience: t.audience };
    },
  });

  route(app, {
    method: "POST", url: "/portal/auth/logout", audience: "portal",
    schema: { body: LogoutSchema.optional(), response: { 204: z.null() }, summary: "Customer logout" },
    handler: async (req, reply) => {
      const c = req.customer!;
      const all = req.body?.all_devices === true;
      await app.db.transaction(async (tx) => {
        const n = all ? await revokeAllFamilies(tx, app.redis, "CUSTOMER", c.portalUserId, "LOGOUT_ALL") : await revokeFamily(tx, app.redis, c.sessionId, "LOGOUT");
        await writeAudit(tx, { companyId: c.companyId, actor: { type: "CUSTOMER", id: c.customerId, name: c.name }, action: all ? "portal_auth.logout_all" : "portal_auth.logout", entityType: "portal_user", entityId: c.portalUserId, after: { sessions_revoked: n }, ip: req.clientIp, requestId: req.id });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "GET", url: "/portal/auth/me", audience: "portal",
    schema: { response: { 200: PortalUserSchema }, summary: "Current customer" },
    handler: async (req) => portalUserView(app.db, req.customer!.portalUserId),
  });

  route(app, {
    method: "POST", url: "/portal/auth/change-password", audience: "portal",
    schema: { body: PortalChangePasswordSchema, response: { 200: OkResponseSchema }, summary: "Change own password (forced at first login)" },
    handler: async (req) => {
      const c = req.customer!;
      await app.db.transaction(async (tx) => {
        const [pu] = await tx.select().from(portalUsers).where(eq(portalUsers.id, c.portalUserId)).limit(1);
        if (!pu) throw ApiError.notFound("Account");
        if (!(await verifyPassword(pu.passwordHash, req.body.current_password))) throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
        const hash = await newPasswordHash(tx, "CUSTOMER", pu.id, pu.passwordHash, req.body.new_password);
        await tx.update(portalUsers).set({ passwordHash: hash, mustChangePassword: false }).where(eq(portalUsers.id, pu.id));
        await revokeAllFamilies(tx, app.redis, "CUSTOMER", pu.id, "PASSWORD_CHANGED", c.sessionId);
        await writeAudit(tx, { companyId: c.companyId, actor: { type: "CUSTOMER", id: c.customerId, name: c.name }, action: "portal_auth.password_changed", entityType: "portal_user", entityId: pu.id, ip: req.clientIp, requestId: req.id });
      });
      await bumpPermVersion(app.redis);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "GET", url: "/portal/auth/sessions", audience: "portal",
    schema: { response: { 200: z.object({ items: z.array(PortalSessionRowSchema) }) }, summary: "Customer sessions" },
    handler: async (req) => ({ items: await listSessions(app.db, "CUSTOMER", req.customer!.portalUserId, req.customer!.sessionId) }),
  });

  route(app, {
    method: "DELETE", url: "/portal/auth/sessions/:id", audience: "portal",
    schema: { params: z.object({ id: IdSchema }), response: { 204: z.null() }, summary: "Revoke one customer session" },
    handler: async (req, reply) => {
      const c = req.customer!;
      await app.db.transaction(async (tx) => {
        const family = await familyOfSession(tx, "CUSTOMER", c.portalUserId, req.params.id);
        await revokeFamily(tx, app.redis, family, "REVOKED_BY_USER");
        await writeAudit(tx, { companyId: c.companyId, actor: { type: "CUSTOMER", id: c.customerId, name: c.name }, action: "portal_auth.session_revoked", entityType: "portal_user", entityId: c.portalUserId, after: { family_id: family }, ip: req.clientIp, requestId: req.id });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "DELETE", url: "/portal/auth/sessions", audience: "portal",
    schema: { response: { 200: z.object({ revoked: z.int() }) }, summary: "Revoke every other customer session" },
    handler: async (req) => {
      const c = req.customer!;
      return app.db.transaction(async (tx) => {
        const revoked = await revokeAllFamilies(tx, app.redis, "CUSTOMER", c.portalUserId, "REVOKED_OTHERS", c.sessionId);
        await writeAudit(tx, { companyId: c.companyId, actor: { type: "CUSTOMER", id: c.customerId, name: c.name }, action: "portal_auth.sessions_revoked_others", entityType: "portal_user", entityId: c.portalUserId, after: { revoked }, ip: req.clientIp, requestId: req.id });
        return { revoked };
      });
    },
  });
}
