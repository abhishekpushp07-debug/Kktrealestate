import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticator } from "otplib";
import { z } from "zod";
import {
  AuthMeResponseSchema,
  ChangePasswordSchema,
  IdSchema,
  JwksResponseSchema,
  LogoutSchema,
  MfaDisableSchema,
  MfaEnableSchema,
  MfaSetupResponseSchema,
  OkResponseSchema,
  PASSWORD_POLICY,
  PasswordPolicySchema,
  RefreshTokenSchema,
  SessionRowSchema,
  StaffLoginResponseSchema,
  StaffLoginSchema,
  StaffLoginSuccessSchema,
  StaffMfaLoginSchema,
  TokenPairSchema,
} from "@kkt/contracts";
import { users, type Executor } from "@kkt/db";
import { bumpAuthVersions } from "../../lib/cache.js";
import { loadCompany } from "../../lib/company.js";
import { decryptField, encryptField, signPayload, verifyPayload } from "../../lib/crypto.js";
import { publicJwks } from "../../lib/jwt.js";
import { writeAudit } from "../../lib/audit.js";
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
  type LoginAccount,
} from "./service.js";
import { clearRefreshCookie, refreshTokenOf, tokenPair, wantsCookie } from "./cookies.js";
import { resetPointOf, type LockTarget } from "./lockout.js";
import { authCompanyView, authUserView } from "./views.js";
import { securityRedis } from "../../plugins/auth.js";

authenticator.options = { window: 1 };

const MFA_TOKEN_TTL_SECONDS = 300;
/** The one message of a failed staff sign-in (unknown e-mail and wrong password alike). */
const INVALID_LOGIN = "Invalid email or password";
type UserRow = typeof users.$inferSelect;

let dummyHash: Promise<string> | null = null;
/** Verifies against a throw-away hash so an unknown e-mail costs the same argon2 work as a wrong password (no user-enumeration timing oracle). */
async function burnVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  await verifyPassword(await dummyHash, password);
}

/** TOTP time step (30 s) of a moment. */
const totpStep = (ms: number) => Math.floor(ms / 1000 / 30);

/** The TOTP step a code matches (±1 step window), or null when it matches none (or the secret is missing/unreadable). */
export function totpStepOf(secretEnc: string | null, code: string, now = Date.now()): number | null {
  const secret = decryptField(secretEnc);
  if (!secret) return null;
  try {
    const delta = authenticator.checkDelta(code, secret);
    return typeof delta === "number" ? totpStep(now) + delta : null;
  } catch {
    return null;
  }
}

/** Verifies a TOTP code against an encrypted secret (±1 step) without consuming it (see consumeTotp). */
export function checkTotp(secretEnc: string | null, code: string): boolean {
  return totpStepOf(secretEnc, code) !== null;
}

/**
 * Verifies a TOTP code and consumes its time step (audit D: codes were replayable inside the ±1 window): the step is accepted only when
 * it is later than `users.totp_last_step`, recorded with a compare-and-set update, so the same code — or an older one — never works twice,
 * even for two requests racing. `secretEnc` defaults to the active MFA secret; enrolment passes the pending one.
 */
export async function consumeTotp(
  db: Executor,
  user: Pick<UserRow, "id" | "mfaSecretEnc">,
  code: string,
  secretEnc: string | null = user.mfaSecretEnc,
): Promise<boolean> {
  const step = totpStepOf(secretEnc, code);
  if (step === null) return false;
  const claimed = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return claimed.length > 0;
}

/** Staff auth endpoints per docs/API-CONVENTIONS.md Appendix A. */
export async function staffAuthRoutes(app: FastifyInstance): Promise<void> {
  async function completeLogin(tx: Executor, req: FastifyRequest, reply: FastifyReply, user: UserRow, mfa: boolean) {
    const tokens = await createSession(tx, { type: "STAFF", id: user.id, companyId: user.companyId, aud: "erp" }, req, {
      mfa,
      mustChangePassword: user.mustChangePassword,
      roleId: user.roleId,
    });
    await tx
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    await recordLoginEvent(tx, {
      companyId: user.companyId,
      subjectType: "STAFF",
      identifier: user.email,
      success: true,
      reason: null,
      req,
    });
    await writeAudit(tx, {
      companyId: user.companyId,
      actor: { type: "STAFF", id: user.id, name: user.name },
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      after: { mfa, session_id: tokens.family_id },
      ip: req.clientIp,
      requestId: req.id,
    });
    const view = await authUserView(tx, user.id);
    return {
      ...tokenPair(req, reply, tokens),
      mfa_required: false as const,
      user: view,
      must_change_password: user.mustChangePassword,
    };
  }

  function lockTarget(
    req: FastifyRequest,
    email: string,
    user: UserRow | null | undefined,
    companyId: string | null = user?.companyId ?? null,
  ): LockTarget {
    return { subjectType: "STAFF", identifier: email, ip: req.clientIp, resetAt: resetPointOf(user), companyId };
  }

  function account(user: UserRow): LoginAccount {
    return {
      type: "STAFF",
      id: user.id,
      companyId: user.companyId,
      lockedUntil: user.lockedUntil,
      label: user.email,
      link: `/admin/users?id=${user.id}`,
    };
  }

  route(app, {
    method: "POST",
    url: "/auth/login",
    public: true,
    rateLimit: { limit: 10, windowSeconds: 60 },
    schema: {
      body: StaffLoginSchema,
      response: { 200: StaffLoginResponseSchema },
      summary:
        "Staff login (email + password); 5 failures from one IP lock that IP for 15 min, 20 across IPs lock the account",
    },
    handler: async (req, reply) => {
      const { email, password, mfa_code } = req.body;
      // Contract C4: the company is resolved first (body `company`, x-kkt-company, Host, the only company); the e-mail is unique per
      // company only, so it is never looked up across tenants unless nothing names a company (then a second tenant's twin → 400).
      const companyId = await loginCompanyId(app, req, req.body.company);
      const matches = await app.db
        .select()
        .from(users)
        .where(companyId ? and(eq(users.email, email), eq(users.companyId, companyId)) : eq(users.email, email))
        .limit(2);
      const user = pickLoginAccount(matches, companyId);
      const target = lockTarget(req, email, user, user?.companyId ?? companyId);
      // Same checks, same argon2 cost and same answers whether or not the e-mail exists (no enumeration oracle).
      const release = await assertLoginAllowed(app.db, req, target, user ? account(user) : null);
      try {
        if (!user) {
          await burnVerify(password);
          return await failLogin(app, req, target, null, "BAD_PASSWORD", INVALID_LOGIN);
        }
        if (!(await verifyPassword(user.passwordHash, password)))
          return await failLogin(app, req, target, account(user), "BAD_PASSWORD", INVALID_LOGIN);
        if (!user.isActive) {
          await recordLoginEvent(app.db, {
            companyId: user.companyId,
            subjectType: "STAFF",
            identifier: email,
            success: false,
            reason: "INACTIVE",
            req,
          });
          throw ApiError.unauthenticated("User is inactive", "USER_INACTIVE");
        }
        if (user.mfaEnabled) {
          if (!mfa_code)
            return {
              mfa_required: true as const,
              mfa_token: signPayload({ uid: user.id, cid: user.companyId, ip: req.clientIp }, MFA_TOKEN_TTL_SECONDS),
            };
          if (!(await consumeTotp(app.db, user, mfa_code)))
            return await failLogin(app, req, target, account(user), "BAD_MFA", "Invalid authentication code");
        }
        return await app.db.transaction((tx) => completeLogin(tx, req, reply, user, user.mfaEnabled));
      } finally {
        release();
      }
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/login/mfa",
    public: true,
    rateLimit: { limit: 10, windowSeconds: 60 },
    schema: {
      body: StaffMfaLoginSchema,
      response: { 200: StaffLoginSuccessSchema },
      summary: "Complete an MFA login (same client IP as the password step)",
    },
    handler: async (req, reply) => {
      const payload = verifyPayload<{ uid: string; cid: string; ip?: string }>(req.body.mfa_token);
      if (!payload) throw ApiError.unauthenticated("MFA token is invalid or expired", "INVALID_TOKEN");
      // The token was minted for the client that passed the password step; another client presenting it is refused.
      if (payload.ip !== undefined && payload.ip !== req.clientIp)
        throw ApiError.unauthenticated("MFA token is invalid or expired", "INVALID_TOKEN");
      const [user] = await app.db.select().from(users).where(eq(users.id, payload.uid)).limit(1);
      if (!user || !user.isActive || !user.mfaEnabled)
        throw ApiError.unauthenticated("MFA token is invalid", "INVALID_TOKEN");
      const target = lockTarget(req, user.email, user);
      const release = await assertLoginAllowed(app.db, req, target, account(user));
      try {
        if (!(await consumeTotp(app.db, user, req.body.code)))
          return await failLogin(app, req, target, account(user), "BAD_MFA", "Invalid authentication code");
        return await app.db.transaction((tx) => completeLogin(tx, req, reply, user, true));
      } finally {
        release();
      }
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/refresh",
    public: true,
    rateLimit: { limit: 60, windowSeconds: 60 },
    schema: {
      body: RefreshTokenSchema.nullish(),
      response: { 200: TokenPairSchema },
      summary:
        "Rotate a refresh token (body refresh_token, or the kkt_rt cookie with X-KKT-Session: cookie); 401 SESSION_EXPIRED past the absolute lifetime",
    },
    handler: async (req, reply) => {
      const raw = refreshTokenOf(req, "erp", req.body?.refresh_token);
      try {
        const tokens = await rotateRefresh(app, req, raw, "erp", async (tx, subjectId) => {
          const [u] = await tx.select().from(users).where(eq(users.id, subjectId)).limit(1);
          if (!u || !u.isActive) return null;
          return {
            companyId: u.companyId,
            mfa: u.mfaEnabled,
            mustChangePassword: u.mustChangePassword,
            roleId: u.roleId,
            actor: { type: "STAFF", id: u.id, name: u.name },
          };
        });
        return tokenPair(req, reply, tokens);
      } catch (err) {
        // a dead cookie session clears its cookie so the browser stops presenting it
        if (wantsCookie(req)) clearRefreshCookie(reply, "erp");
        throw err;
      }
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/logout",
    permission: "dashboard.view",
    schema: {
      body: LogoutSchema.nullish(),
      response: { 204: z.null() },
      summary: "Log out (this session, or all devices)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const all = req.body?.all_devices === true;
      await app.db.transaction(async (tx) => {
        const n = all
          ? await revokeAllFamilies(tx, securityRedis(app), "STAFF", user.id, "LOGOUT_ALL")
          : await revokeFamily(tx, securityRedis(app), user.sessionId, "LOGOUT");
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: { type: "STAFF", id: user.id, name: user.name },
          action: all ? "auth.logout_all" : "auth.logout",
          entityType: "user",
          entityId: user.id,
          after: { sessions_revoked: n, session_id: user.sessionId },
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      if (wantsCookie(req)) clearRefreshCookie(reply, "erp");
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "GET",
    url: "/auth/me",
    permission: "dashboard.view",
    schema: { response: { 200: AuthMeResponseSchema }, summary: "Current staff user and company" },
    handler: async (req) => {
      const [user, company] = await Promise.all([
        authUserView(app.db, req.user!.id),
        loadCompany(app.db, app.redis, req.user!.companyId),
      ]);
      return { user, company: authCompanyView(company) };
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/change-password",
    permission: "dashboard.view",
    schema: { body: ChangePasswordSchema, response: { 200: OkResponseSchema }, summary: "Change own password" },
    handler: async (req) => {
      const ctx = req.user!;
      await app.db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, ctx.id)).limit(1);
        if (!user) throw ApiError.notFound("User");
        if (!(await verifyPassword(user.passwordHash, req.body.current_password)))
          throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
        const hash = await newPasswordHash(tx, "STAFF", user.id, user.passwordHash, req.body.new_password);
        await tx
          .update(users)
          .set({ passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date() })
          .where(eq(users.id, user.id));
        await revokeAllFamilies(tx, securityRedis(app), "STAFF", user.id, "PASSWORD_CHANGED", ctx.sessionId);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: { type: "STAFF", id: user.id, name: user.name },
          action: "auth.password_changed",
          entityType: "user",
          entityId: user.id,
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      await bumpAuthVersions(app.redis, { users: [ctx.id] }, req.log);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "GET",
    url: "/auth/sessions",
    permission: "dashboard.view",
    schema: {
      response: { 200: z.object({ items: z.array(SessionRowSchema) }) },
      summary: "Live sessions of the current user",
    },
    handler: async (req) => ({ items: await listSessions(app.db, "STAFF", req.user!.id, req.user!.sessionId) }),
  });

  route(app, {
    method: "DELETE",
    url: "/auth/sessions/:id",
    permission: "dashboard.view",
    schema: { params: z.object({ id: IdSchema }), response: { 204: z.null() }, summary: "Revoke one session" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const family = await familyOfSession(tx, "STAFF", user.id, req.params.id);
        await revokeFamily(tx, securityRedis(app), family, "REVOKED_BY_USER");
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: { type: "STAFF", id: user.id, name: user.name },
          action: "auth.session_revoked",
          entityType: "user",
          entityId: user.id,
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
    url: "/auth/sessions",
    permission: "dashboard.view",
    schema: { response: { 200: z.object({ revoked: z.int() }) }, summary: "Revoke every other session" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        const revoked = await revokeAllFamilies(
          tx,
          securityRedis(app),
          "STAFF",
          user.id,
          "REVOKED_OTHERS",
          user.sessionId,
        );
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: { type: "STAFF", id: user.id, name: user.name },
          action: "auth.sessions_revoked_others",
          entityType: "user",
          entityId: user.id,
          after: { revoked },
          ip: req.clientIp,
          requestId: req.id,
        });
        return { revoked };
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/mfa/enroll",
    permission: "dashboard.view",
    schema: { response: { 200: MfaSetupResponseSchema }, summary: "Start TOTP enrolment (secret shown once)" },
    handler: async (req) => {
      const ctx = req.user!;
      const secret = authenticator.generateSecret();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ mfaPendingSecretEnc: encryptField(secret) })
          .where(eq(users.id, ctx.id));
        await writeAudit(tx, {
          companyId: ctx.companyId,
          actor: { type: "STAFF", id: ctx.id, name: ctx.name },
          action: "auth.mfa_enroll_started",
          entityType: "user",
          entityId: ctx.id,
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      return { secret, otpauth_url: authenticator.keyuri(ctx.email, "KKT ERP", secret) };
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/mfa/verify",
    permission: "dashboard.view",
    schema: { body: MfaEnableSchema, response: { 200: OkResponseSchema }, summary: "Confirm TOTP enrolment" },
    handler: async (req) => {
      const ctx = req.user!;
      await app.db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, ctx.id)).limit(1);
        if (!user?.mfaPendingSecretEnc) throw ApiError.rule("Start MFA enrolment first", "MFA_NOT_PENDING");
        if (!(await consumeTotp(tx, user, req.body.code, user.mfaPendingSecretEnc)))
          throw ApiError.rule("Invalid authentication code", "MFA_CODE_INVALID");
        await tx
          .update(users)
          .set({ mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null })
          .where(eq(users.id, user.id));
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: { type: "STAFF", id: user.id, name: user.name },
          action: "auth.mfa_enabled",
          entityType: "user",
          entityId: user.id,
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      await bumpAuthVersions(app.redis, { users: [ctx.id] }, req.log);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "POST",
    url: "/auth/mfa/disable",
    permission: "dashboard.view",
    schema: { body: MfaDisableSchema, response: { 200: OkResponseSchema }, summary: "Disable TOTP (password + code)" },
    handler: async (req) => {
      const ctx = req.user!;
      await app.db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, ctx.id)).limit(1);
        if (!user) throw ApiError.notFound("User");
        if (!user.mfaEnabled) throw ApiError.rule("MFA is not enabled", "MFA_NOT_ENABLED");
        if (!(await verifyPassword(user.passwordHash, req.body.password)))
          throw new ApiError(401, "INVALID_CREDENTIALS", "Password is incorrect");
        if (!(await consumeTotp(tx, user, req.body.code)))
          throw ApiError.rule("Invalid authentication code", "MFA_CODE_INVALID");
        await tx
          .update(users)
          .set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null })
          .where(eq(users.id, user.id));
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: { type: "STAFF", id: user.id, name: user.name },
          action: "auth.mfa_disabled",
          entityType: "user",
          entityId: user.id,
          ip: req.clientIp,
          requestId: req.id,
        });
      });
      await bumpAuthVersions(app.redis, { users: [ctx.id] }, req.log);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "GET",
    url: "/auth/jwks",
    public: true,
    schema: {
      response: { 200: JwksResponseSchema },
      summary:
        "Public verification keys (JWKS): the current signing key and any previous one still inside its rotation window",
    },
    handler: async (_req, reply) => {
      reply.header("Cache-Control", "public, max-age=300");
      return publicJwks() as unknown as Promise<{ keys: { kty: string; kid: string; use: string; alg: string }[] }>;
    },
  });

  route(app, {
    method: "GET",
    url: "/auth/password-policy",
    public: true,
    schema: { response: { 200: PasswordPolicySchema }, summary: "Password policy" },
    handler: async () => PASSWORD_POLICY,
  });
}
