import { and, count, eq, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  LogoutSchema,
  OkResponseSchema,
  PortalAuthLoginSchema,
  PortalAuthRefreshSchema,
  PortalChangePasswordSchema,
  PortalLoginResponseSchema,
  PortalSessionRowSchema,
  PortalUserSchema,
  type PortalUser,
} from "@kkt/contracts";
import { bookingCoApplicants, bookings, customers, portalUsers, type Executor } from "@kkt/db";
import { normalizeIndianPhone } from "@kkt/domain";
import { writeAudit } from "../../lib/audit.js";
import { bumpAuthVersions } from "../../lib/cache.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { route } from "../../lib/routes.js";
import {
  assertLoginAllowed,
  createSession,
  failLogin,
  familyOfSession,
  listSessions,
  loginCompanyId,
  newPasswordHash,
  pickLoginAccount,
  recordLoginEvent,
  revokeAllFamilies,
  revokeFamily,
  rotateRefresh,
} from "./service.js";
import { resetPointOf } from "./lockout.js";
import { clearRefreshCookie, refreshTokenOf, tokenPair, wantsCookie } from "./cookies.js";
import { securityRedis } from "../../plugins/auth.js";

/** The one message of a failed customer sign-in (unknown phone and wrong password alike). */
const INVALID_PORTAL_LOGIN = "Invalid phone number or password";

let dummy: Promise<string> | null = null;
/** A throw-away argon2 hash used to equalise the timing of unknown-phone and wrong-password failures. */
function dummyHash(): Promise<string> {
  dummy ??= hashPassword(`dummy-${Math.random()}`);
  return dummy;
}

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
    .where(
      or(
        eq(bookings.customerId, row.c.id),
        sql`${bookings.id} in (select ${bookingCoApplicants.bookingId} from ${bookingCoApplicants} where ${bookingCoApplicants.customerId} = ${row.c.id})`,
      ),
    );
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
    method: "POST",
    url: "/portal/auth/login",
    public: true,
    rateLimit: { limit: 10, windowSeconds: 60 },
    schema: {
      body: PortalAuthLoginSchema,
      response: { 200: PortalLoginResponseSchema },
      summary:
        "Customer login (phone + password; optional company slug, contract C4). With X-KKT-Session: cookie the refresh token is set as the kkt_prt cookie",
    },
    handler: async (req, reply) => {
      const phone = normalizeIndianPhone(req.body.phone) ?? req.body.phone;
      // Contract C4: resolve the company first; a phone is unique per company only.
      const companyId = await loginCompanyId(app, req, req.body.company);
      const matches = await app.db
        .select()
        .from(portalUsers)
        .where(
          companyId
            ? and(eq(portalUsers.phone, phone), eq(portalUsers.companyId, companyId))
            : eq(portalUsers.phone, phone),
        )
        .limit(2);
      const pu = pickLoginAccount(matches, companyId);
      const target = {
        subjectType: "CUSTOMER" as const,
        identifier: phone,
        ip: req.clientIp,
        resetAt: resetPointOf(pu),
        companyId: pu?.companyId ?? companyId,
      };
      const account = pu
        ? {
            type: "CUSTOMER" as const,
            id: pu.id,
            companyId: pu.companyId,
            lockedUntil: pu.lockedUntil,
            label: pu.phone,
            link: `/customers/${pu.customerId}`,
          }
        : null;
      // Same lock checks, same argon2 cost and same answers whether or not the phone has a portal login (no enumeration oracle).
      const release = await assertLoginAllowed(app.db, req, target, account);
      try {
        if (!pu || !account) {
          await verifyPassword(await dummyHash(), req.body.password);
          return await failLogin(app, req, target, null, "BAD_PASSWORD", INVALID_PORTAL_LOGIN);
        }
        if (!(await verifyPassword(pu.passwordHash, req.body.password)))
          return await failLogin(app, req, target, account, "BAD_PASSWORD", INVALID_PORTAL_LOGIN);
        if (!pu.isEnabled) {
          await recordLoginEvent(app.db, {
            companyId: pu.companyId,
            subjectType: "CUSTOMER",
            identifier: phone,
            success: false,
            reason: "DISABLED",
            req,
          });
          throw ApiError.unauthenticated("Portal access is disabled", "USER_INACTIVE");
        }
        return await app.db.transaction(async (tx) => {
          const tokens = await createSession(
            tx,
            { type: "CUSTOMER", id: pu.id, companyId: pu.companyId, aud: "portal" },
            req,
            { mfa: false, mustChangePassword: pu.mustChangePassword },
          );
          await tx
            .update(portalUsers)
            .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
            .where(eq(portalUsers.id, pu.id));
          await recordLoginEvent(tx, {
            companyId: pu.companyId,
            subjectType: "CUSTOMER",
            identifier: phone,
            success: true,
            reason: null,
            req,
          });
          const user = await portalUserView(tx, pu.id);
          await writeAudit(tx, {
            companyId: pu.companyId,
            actor: { type: "CUSTOMER", id: pu.customerId, name: user.full_name },
            action: "portal_auth.login",
            entityType: "portal_user",
            entityId: pu.id,
            after: { session_id: tokens.family_id },
            ip: req.clientIp,
            requestId: req.id,
          });
          return { ...tokenPair(req, reply, tokens), user };
        });
      } finally {
        release();
      }
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/auth/refresh",
    public: true,
    rateLimit: { limit: 60, windowSeconds: 60 },
    schema: {
      body: PortalAuthRefreshSchema.nullish(),
      response: { 200: PortalLoginResponseSchema.omit({ user: true }) },
      summary:
        "Rotate a customer refresh token (body refresh_token, or the kkt_prt cookie with X-KKT-Session: cookie); 401 SESSION_EXPIRED past the absolute lifetime",
    },
    handler: async (req, reply) => {
      const raw = refreshTokenOf(req, "portal", req.body?.refresh_token);
      try {
        const t = await rotateRefresh(app, req, raw, "portal", async (tx, subjectId) => {
          const [pu] = await tx.select().from(portalUsers).where(eq(portalUsers.id, subjectId)).limit(1);
          if (!pu || !pu.isEnabled) return null;
          return {
            companyId: pu.companyId,
            mfa: false,
            mustChangePassword: pu.mustChangePassword,
            actor: { type: "CUSTOMER", id: pu.customerId, name: null },
          };
        });
        return tokenPair(req, reply, t);
      } catch (err) {
        if (wantsCookie(req)) clearRefreshCookie(reply, "portal");
        throw err;
      }
    },
  });

  route(app, {
    method: "POST",
    url: "/portal/auth/logout",
    audience: "portal",
    schema: { body: LogoutSchema.nullish(), response: { 204: z.null() }, summary: "Customer logout" },
    handler: async (req, reply) => {
      const c = req.customer!;
      const all = req.body?.all_devices === true;
      await app.db.transaction(async (tx) => {
        const n = all
          ? await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", c.portalUserId, "LOGOUT_ALL")
          : await revokeFamily(tx, securityRedis(app), c.sessionId, "LOGOUT");
        await writeAudit(tx, {
          companyId: c.companyId,
          actor: { type: "CUSTOMER", id: c.customerId, name: c.name },
          action: all ? "portal_auth.logout_all" : "portal_auth.logout",
          entityType: "portal_user",
          entityId: c.portalUserId,
          after: { sessions_revoked: n },
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      if (wantsCookie(req)) clearRefreshCookie(reply, "portal");
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "GET",
    url: "/portal/auth/me",
    audience: "portal",
    schema: { response: { 200: PortalUserSchema }, summary: "Current customer" },
    handler: async (req) => portalUserView(app.db, req.customer!.portalUserId),
  });

  route(app, {
    method: "POST",
    url: "/portal/auth/change-password",
    audience: "portal",
    schema: {
      body: PortalChangePasswordSchema,
      response: { 200: OkResponseSchema },
      summary: "Change own password (forced at first login)",
    },
    handler: async (req) => {
      const c = req.customer!;
      await app.db.transaction(async (tx) => {
        const [pu] = await tx.select().from(portalUsers).where(eq(portalUsers.id, c.portalUserId)).limit(1);
        if (!pu) throw ApiError.notFound("Account");
        if (!(await verifyPassword(pu.passwordHash, req.body.current_password)))
          throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
        const hash = await newPasswordHash(tx, "CUSTOMER", pu.id, pu.passwordHash, req.body.new_password);
        await tx
          .update(portalUsers)
          .set({ passwordHash: hash, mustChangePassword: false })
          .where(eq(portalUsers.id, pu.id));
        await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "PASSWORD_CHANGED", c.sessionId);
        await writeAudit(tx, {
          companyId: c.companyId,
          actor: { type: "CUSTOMER", id: c.customerId, name: c.name },
          action: "portal_auth.password_changed",
          entityType: "portal_user",
          entityId: pu.id,
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      // only this customer's cached identity is re-read (audit C: this used to invalidate every cached principal)
      await bumpAuthVersions(app.redis, { portalUsers: [c.portalUserId] }, req.log);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "GET",
    url: "/portal/auth/sessions",
    audience: "portal",
    schema: {
      response: { 200: z.array(PortalSessionRowSchema) },
      summary: "Customer sessions (bare array, Appendix C additions)",
    },
    handler: async (req) => listSessions(app.db, "CUSTOMER", req.customer!.portalUserId, req.customer!.sessionId),
  });

  route(app, {
    method: "DELETE",
    url: "/portal/auth/sessions/:id",
    audience: "portal",
    schema: { params: z.object({ id: IdSchema }), response: { 204: z.null() }, summary: "Revoke one customer session" },
    handler: async (req, reply) => {
      const c = req.customer!;
      await app.db.transaction(async (tx) => {
        const family = await familyOfSession(tx, "CUSTOMER", c.portalUserId, req.params.id);
        await revokeFamily(tx, securityRedis(app), family, "REVOKED_BY_USER");
        await writeAudit(tx, {
          companyId: c.companyId,
          actor: { type: "CUSTOMER", id: c.customerId, name: c.name },
          action: "portal_auth.session_revoked",
          entityType: "portal_user",
          entityId: c.portalUserId,
          after: { family_id: family },
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "DELETE",
    url: "/portal/auth/sessions",
    audience: "portal",
    schema: { response: { 200: z.object({ revoked: z.int() }) }, summary: "Revoke every other customer session" },
    handler: async (req) => {
      const c = req.customer!;
      return app.db.transaction(async (tx) => {
        const revoked = await revokeAllFamilies(
          tx,
          securityRedis(app),
          "CUSTOMER",
          c.portalUserId,
          "REVOKED_OTHERS",
          c.sessionId,
        );
        await writeAudit(tx, {
          companyId: c.companyId,
          actor: { type: "CUSTOMER", id: c.customerId, name: c.name },
          action: "portal_auth.sessions_revoked_others",
          entityType: "portal_user",
          entityId: c.portalUserId,
          after: { revoked },
          ip: req.clientIp,
          requestId: req.id,
        });
        return { revoked };
      });
    },
  });
}
