import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { authenticator } from "otplib";
import { z } from "zod";
import {
  AuthMeResponseSchema,
  ChangePasswordSchema,
  IdSchema,
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
import { bumpPermVersion } from "../../lib/cache.js";
import { loadCompany } from "../../lib/company.js";
import { decryptField, encryptField, signPayload, verifyPayload } from "../../lib/crypto.js";
import { writeAudit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { route } from "../../lib/routes.js";
import { applyStaffFailure, assertNotLocked, createSession, familyOfSession, listSessions, newPasswordHash, recordLoginEvent, revokeAllFamilies, revokeFamily, rotateRefresh, type IssuedTokens } from "./service.js";
import { authCompanyView, authUserView } from "./views.js";

authenticator.options = { window: 1 };

const MFA_TOKEN_TTL_SECONDS = 300;
type UserRow = typeof users.$inferSelect;

let dummyHash: Promise<string> | null = null;
/** Verifies against a throw-away hash so an unknown e-mail costs the same argon2 work as a wrong password (no user-enumeration timing oracle). */
async function burnVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  await verifyPassword(await dummyHash, password);
}

function tokenPair(t: IssuedTokens) {
  return { access_token: t.access_token, refresh_token: t.refresh_token, token_type: t.token_type, expires_in: t.expires_in, audience: t.audience };
}

/** Verifies a TOTP code against an encrypted secret (±1 step). */
export function checkTotp(secretEnc: string | null, code: string): boolean {
  const secret = decryptField(secretEnc);
  if (!secret) return false;
  try { return authenticator.check(code, secret); } catch { return false; }
}

/** Staff auth endpoints per docs/API-CONVENTIONS.md Appendix A. */
export async function staffAuthRoutes(app: FastifyInstance): Promise<void> {
  async function completeLogin(tx: Executor, req: FastifyRequest, user: UserRow, mfa: boolean) {
    const tokens = await createSession(tx, { type: "STAFF", id: user.id, companyId: user.companyId, aud: "erp" }, req, { mfa, mustChangePassword: user.mustChangePassword });
    await tx.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await recordLoginEvent(tx, { companyId: user.companyId, subjectType: "STAFF", identifier: user.email, success: true, reason: null, req });
    await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: "auth.login", entityType: "user", entityId: user.id, after: { mfa, session_id: tokens.family_id }, ip: req.clientIp, requestId: req.id });
    const view = await authUserView(tx, user.id);
    return { ...tokenPair(tokens), mfa_required: false as const, user: view, must_change_password: user.mustChangePassword };
  }

  /** Commits failure bookkeeping (attempt counter, login_events, lockout audit) in its own transaction, then throws. */
  async function failStaffLogin(req: FastifyRequest, user: UserRow, reason: string): Promise<never> {
    const next = await app.db.transaction(async (tx) => {
      const n = await applyStaffFailure(tx, user);
      await recordLoginEvent(tx, { companyId: user.companyId, subjectType: "STAFF", identifier: user.email, success: false, reason: n.justLocked ? "LOCKED" : reason, req });
      if (n.justLocked) await writeAudit(tx, { companyId: user.companyId, actor: { type: "SYSTEM", id: null, name: "lockout" }, action: "auth.locked", entityType: "user", entityId: user.id, after: { locked_until: n.lockedUntil, failed_attempts: n.failedAttempts }, ip: req.clientIp, requestId: req.id });
      return n;
    });
    if (next.justLocked) throw ApiError.locked(`Account locked for ${PASSWORD_POLICY.lockout_minutes} minutes after ${PASSWORD_POLICY.lockout_attempts} failed attempts`, { locked_until: next.lockedUntil!.toISOString() });
    throw new ApiError(401, "INVALID_CREDENTIALS", reason === "BAD_MFA" ? "Invalid authentication code" : "Invalid email or password", { attempts_left: PASSWORD_POLICY.lockout_attempts - next.failedAttempts });
  }

  route(app, {
    method: "POST", url: "/auth/login", public: true, rateLimit: { limit: 10, windowSeconds: 60 },
    schema: { body: StaffLoginSchema, response: { 200: StaffLoginResponseSchema }, summary: "Staff login (email + password)" },
    handler: async (req) => {
      const { email, password, mfa_code } = req.body;
      const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        await burnVerify(password);
        await recordLoginEvent(app.db, { companyId: null, subjectType: "STAFF", identifier: email, success: false, reason: "UNKNOWN_USER", req });
        throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
      }
      assertNotLocked(user);
      if (!(await verifyPassword(user.passwordHash, password))) return failStaffLogin(req, user, "BAD_PASSWORD");
      if (!user.isActive) {
        await recordLoginEvent(app.db, { companyId: user.companyId, subjectType: "STAFF", identifier: email, success: false, reason: "INACTIVE", req });
        throw ApiError.unauthenticated("User is inactive", "USER_INACTIVE");
      }
      if (user.mfaEnabled) {
        if (!mfa_code) return { mfa_required: true as const, mfa_token: signPayload({ uid: user.id, cid: user.companyId, ip: req.clientIp }, MFA_TOKEN_TTL_SECONDS) };
        if (!checkTotp(user.mfaSecretEnc, mfa_code)) return failStaffLogin(req, user, "BAD_MFA");
      }
      return app.db.transaction((tx) => completeLogin(tx, req, user, user.mfaEnabled));
    },
  });

  route(app, {
    method: "POST", url: "/auth/login/mfa", public: true, rateLimit: { limit: 10, windowSeconds: 60 },
    schema: { body: StaffMfaLoginSchema, response: { 200: StaffLoginSuccessSchema }, summary: "Complete an MFA login" },
    handler: async (req) => {
      const payload = verifyPayload<{ uid: string; cid: string }>(req.body.mfa_token);
      if (!payload) throw ApiError.unauthenticated("MFA token is invalid or expired", "INVALID_TOKEN");
      const [user] = await app.db.select().from(users).where(eq(users.id, payload.uid)).limit(1);
      if (!user || !user.isActive || !user.mfaEnabled) throw ApiError.unauthenticated("MFA token is invalid", "INVALID_TOKEN");
      assertNotLocked(user);
      if (!checkTotp(user.mfaSecretEnc, req.body.code)) return failStaffLogin(req, user, "BAD_MFA");
      return app.db.transaction((tx) => completeLogin(tx, req, user, true));
    },
  });

  route(app, {
    method: "POST", url: "/auth/refresh", public: true, rateLimit: { limit: 60, windowSeconds: 60 },
    schema: { body: RefreshTokenSchema, response: { 200: TokenPairSchema }, summary: "Rotate a refresh token" },
    handler: async (req) => {
      const tokens = await rotateRefresh(app, req, req.body.refresh_token, "erp", async (tx, subjectId) => {
        const [u] = await tx.select().from(users).where(eq(users.id, subjectId)).limit(1);
        if (!u || !u.isActive) return null;
        return { companyId: u.companyId, mfa: u.mfaEnabled, mustChangePassword: u.mustChangePassword, actor: { type: "STAFF", id: u.id, name: u.name } };
      });
      return tokenPair(tokens);
    },
  });

  route(app, {
    method: "POST", url: "/auth/logout", permission: "dashboard.view",
    schema: { body: LogoutSchema.optional(), response: { 204: z.null() }, summary: "Log out (this session, or all devices)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const all = req.body?.all_devices === true;
      await app.db.transaction(async (tx) => {
        const n = all ? await revokeAllFamilies(tx, app.redis, "STAFF", user.id, "LOGOUT_ALL") : await revokeFamily(tx, app.redis, user.sessionId, "LOGOUT");
        await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: all ? "auth.logout_all" : "auth.logout", entityType: "user", entityId: user.id, after: { sessions_revoked: n, session_id: user.sessionId }, ip: req.clientIp, requestId: req.id });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "GET", url: "/auth/me", permission: "dashboard.view",
    schema: { response: { 200: AuthMeResponseSchema }, summary: "Current staff user and company" },
    handler: async (req) => {
      const [user, company] = await Promise.all([authUserView(app.db, req.user!.id), loadCompany(app.db, app.redis, req.user!.companyId)]);
      return { user, company: authCompanyView(company) };
    },
  });

  route(app, {
    method: "POST", url: "/auth/change-password", permission: "dashboard.view",
    schema: { body: ChangePasswordSchema, response: { 200: OkResponseSchema }, summary: "Change own password" },
    handler: async (req) => {
      const ctx = req.user!;
      await app.db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, ctx.id)).limit(1);
        if (!user) throw ApiError.notFound("User");
        if (!(await verifyPassword(user.passwordHash, req.body.current_password))) throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
        const hash = await newPasswordHash(tx, "STAFF", user.id, user.passwordHash, req.body.new_password);
        await tx.update(users).set({ passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date() }).where(eq(users.id, user.id));
        await revokeAllFamilies(tx, app.redis, "STAFF", user.id, "PASSWORD_CHANGED", ctx.sessionId);
        await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: "auth.password_changed", entityType: "user", entityId: user.id, ip: req.clientIp, requestId: req.id });
      });
      await bumpPermVersion(app.redis);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "GET", url: "/auth/sessions", permission: "dashboard.view",
    schema: { response: { 200: z.object({ items: z.array(SessionRowSchema) }) }, summary: "Live sessions of the current user" },
    handler: async (req) => ({ items: await listSessions(app.db, "STAFF", req.user!.id, req.user!.sessionId) }),
  });

  route(app, {
    method: "DELETE", url: "/auth/sessions/:id", permission: "dashboard.view",
    schema: { params: z.object({ id: IdSchema }), response: { 204: z.null() }, summary: "Revoke one session" },
    handler: async (req, reply) => {
      const user = req.user!;
      await app.db.transaction(async (tx) => {
        const family = await familyOfSession(tx, "STAFF", user.id, req.params.id);
        await revokeFamily(tx, app.redis, family, "REVOKED_BY_USER");
        await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: "auth.session_revoked", entityType: "user", entityId: user.id, after: { family_id: family }, ip: req.clientIp, requestId: req.id });
      });
      return reply.code(204).send();
    },
  });

  route(app, {
    method: "DELETE", url: "/auth/sessions", permission: "dashboard.view",
    schema: { response: { 200: z.object({ revoked: z.int() }) }, summary: "Revoke every other session" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        const revoked = await revokeAllFamilies(tx, app.redis, "STAFF", user.id, "REVOKED_OTHERS", user.sessionId);
        await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: "auth.sessions_revoked_others", entityType: "user", entityId: user.id, after: { revoked }, ip: req.clientIp, requestId: req.id });
        return { revoked };
      });
    },
  });

  route(app, {
    method: "POST", url: "/auth/mfa/enroll", permission: "dashboard.view",
    schema: { response: { 200: MfaSetupResponseSchema }, summary: "Start TOTP enrolment (secret shown once)" },
    handler: async (req) => {
      const ctx = req.user!;
      const secret = authenticator.generateSecret();
      await app.db.transaction(async (tx) => {
        await tx.update(users).set({ mfaPendingSecretEnc: encryptField(secret) }).where(eq(users.id, ctx.id));
        await writeAudit(tx, { companyId: ctx.companyId, actor: { type: "STAFF", id: ctx.id, name: ctx.name }, action: "auth.mfa_enroll_started", entityType: "user", entityId: ctx.id, ip: req.clientIp, requestId: req.id });
      });
      return { secret, otpauth_url: authenticator.keyuri(ctx.email, "KKT ERP", secret) };
    },
  });

  route(app, {
    method: "POST", url: "/auth/mfa/verify", permission: "dashboard.view",
    schema: { body: MfaEnableSchema, response: { 200: OkResponseSchema }, summary: "Confirm TOTP enrolment" },
    handler: async (req) => {
      const ctx = req.user!;
      await app.db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, ctx.id)).limit(1);
        if (!user?.mfaPendingSecretEnc) throw ApiError.rule("Start MFA enrolment first", "MFA_NOT_PENDING");
        if (!checkTotp(user.mfaPendingSecretEnc, req.body.code)) throw ApiError.rule("Invalid authentication code", "MFA_CODE_INVALID");
        await tx.update(users).set({ mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null }).where(eq(users.id, user.id));
        await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: "auth.mfa_enabled", entityType: "user", entityId: user.id, ip: req.clientIp, requestId: req.id });
      });
      await bumpPermVersion(app.redis);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "POST", url: "/auth/mfa/disable", permission: "dashboard.view",
    schema: { body: MfaDisableSchema, response: { 200: OkResponseSchema }, summary: "Disable TOTP (password + code)" },
    handler: async (req) => {
      const ctx = req.user!;
      await app.db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, ctx.id)).limit(1);
        if (!user) throw ApiError.notFound("User");
        if (!user.mfaEnabled) throw ApiError.rule("MFA is not enabled", "MFA_NOT_ENABLED");
        if (!(await verifyPassword(user.passwordHash, req.body.password))) throw new ApiError(401, "INVALID_CREDENTIALS", "Password is incorrect");
        if (!checkTotp(user.mfaSecretEnc, req.body.code)) throw ApiError.rule("Invalid authentication code", "MFA_CODE_INVALID");
        await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null }).where(eq(users.id, user.id));
        await writeAudit(tx, { companyId: user.companyId, actor: { type: "STAFF", id: user.id, name: user.name }, action: "auth.mfa_disabled", entityType: "user", entityId: user.id, ip: req.clientIp, requestId: req.id });
      });
      await bumpPermVersion(app.redis);
      return { ok: true as const };
    },
  });

  route(app, {
    method: "GET", url: "/auth/password-policy", public: true,
    schema: { response: { 200: PasswordPolicySchema }, summary: "Password policy" },
    handler: async () => PASSWORD_POLICY,
  });
}
