import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { SessionRow, UserType } from "@kkt/contracts";
import { PASSWORD_POLICY } from "@kkt/contracts";
import { loginEvents, passwordHistory, portalUsers, refreshTokens, users, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import { writeAudit, type AuditActor } from "../../lib/audit.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { signAccessToken, type TokenAudience } from "../../lib/jwt.js";
import { hashPassword, matchesHistory, passwordPolicyProblems } from "../../lib/password.js";
import { markSessionRevoked } from "../../plugins/auth.js";

/** The subject a session belongs to. */
export interface SessionSubject {
  type: UserType;
  id: string;
  companyId: string;
  aud: TokenAudience;
}

/** Tokens issued by login/refresh. */
export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  audience: TokenAudience;
  family_id: string;
}

/** Lockout window in milliseconds (PASSWORD_POLICY.lockout_minutes). */
export const LOCKOUT_MS = PASSWORD_POLICY.lockout_minutes * 60_000;

function requestMeta(req: FastifyRequest): { ip: string; userAgent: string | null } {
  const ua = req.headers["user-agent"];
  return { ip: req.clientIp, userAgent: ua ? String(ua).slice(0, 300) : null };
}

/** Starts a new refresh-token family and signs the matching access token (sid = family id). */
export async function createSession(tx: Executor, subject: SessionSubject, req: FastifyRequest, flags: { mfa: boolean; mustChangePassword: boolean }): Promise<IssuedTokens> {
  const familyId = randomUUID();
  return issueTokens(tx, subject, familyId, req, flags);
}

async function issueTokens(tx: Executor, subject: SessionSubject, familyId: string, req: FastifyRequest, flags: { mfa: boolean; mustChangePassword: boolean }, replaces?: { id: string }): Promise<IssuedTokens> {
  const raw = `rt_${randomToken(32)}`;
  const meta = requestMeta(req);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 86_400_000);
  const [inserted] = await tx
    .insert(refreshTokens)
    .values({ companyId: subject.companyId, subjectType: subject.type, subjectId: subject.id, familyId, tokenHash: sha256(raw), expiresAt, userAgent: meta.userAgent, ip: meta.ip })
    .returning({ id: refreshTokens.id });
  if (replaces && inserted) {
    await tx.update(refreshTokens).set({ replacedById: inserted.id, lastUsedAt: new Date() }).where(eq(refreshTokens.id, replaces.id));
  }
  const access = await signAccessToken({ sub: subject.id, aud: subject.aud, cid: subject.companyId, sid: familyId, mfa: flags.mfa, pwd: flags.mustChangePassword });
  return { access_token: access, refresh_token: raw, token_type: "Bearer", expires_in: config.ACCESS_TOKEN_MINUTES * 60, audience: subject.aud, family_id: familyId };
}

/** Revokes every live token of a family and flags the session so outstanding access tokens die immediately. */
export async function revokeFamily(tx: Executor, redis: Redis, familyId: string, reason: string): Promise<number> {
  const rows = await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  await markSessionRevoked(redis, familyId);
  return rows.length;
}

/** Revokes every family of a subject except `keepFamilyId` (logout everywhere / password change / deactivation). */
export async function revokeAllFamilies(tx: Executor, redis: Redis, subjectType: UserType, subjectId: string, reason: string, keepFamilyId?: string): Promise<number> {
  const live = await tx
    .selectDistinct({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.subjectType, subjectType), eq(refreshTokens.subjectId, subjectId), isNull(refreshTokens.revokedAt)));
  let n = 0;
  for (const f of live) {
    if (keepFamilyId && f.familyId === keepFamilyId) continue;
    n += await revokeFamily(tx, redis, f.familyId, reason);
  }
  return n;
}

/** Lists live sessions (one per family: the current, unreplaced token) for a subject. */
export async function listSessions(db: Executor, subjectType: UserType, subjectId: string, currentFamilyId: string): Promise<SessionRow[]> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.subjectType, subjectType), eq(refreshTokens.subjectId, subjectId), isNull(refreshTokens.revokedAt), isNull(refreshTokens.replacedById), gt(refreshTokens.expiresAt, new Date())))
    .orderBy(desc(refreshTokens.createdAt));
  return rows.map((r) => ({
    id: r.id,
    family_id: r.familyId,
    user_agent: r.userAgent,
    ip: r.ip,
    created_at: r.createdAt.toISOString(),
    last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expires_at: r.expiresAt.toISOString(),
    is_current: r.familyId === currentFamilyId,
  }));
}

/** Resolves a session row id (as listed) to its family, scoped to the subject; 404 when unknown. */
export async function familyOfSession(db: Executor, subjectType: UserType, subjectId: string, sessionId: string): Promise<string> {
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.id, sessionId), eq(refreshTokens.subjectType, subjectType), eq(refreshTokens.subjectId, subjectId)))
    .limit(1);
  if (!row) throw ApiError.notFound("Session");
  return row.familyId;
}

/**
 * Rotates a refresh token: a revoked or already-replaced token means reuse → the whole family is revoked and audited (401 TOKEN_REUSED).
 * `loadSubject` lets each audience check its user is still allowed to sign in and returns the flags for the new access token.
 * Failure bookkeeping (family revocation, audit) is committed in its own transaction before the error is thrown.
 */
export async function rotateRefresh(
  app: FastifyInstance,
  req: FastifyRequest,
  rawToken: string,
  aud: TokenAudience,
  loadSubject: (tx: Executor, subjectId: string) => Promise<{ companyId: string; mfa: boolean; mustChangePassword: boolean; actor: AuditActor } | null>,
): Promise<IssuedTokens> {
  const expectedType: UserType = aud === "erp" ? "STAFF" : "CUSTOMER";
  const [row] = await app.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(rawToken))).limit(1);
  if (!row || row.subjectType !== expectedType) throw ApiError.unauthenticated("Invalid refresh token", "INVALID_TOKEN");
  const reuse = async (): Promise<never> => {
    await app.db.transaction(async (tx) => {
      await revokeFamily(tx, app.redis, row.familyId, "REUSE_DETECTED");
      await writeAudit(tx, {
        companyId: row.companyId,
        actor: { type: row.subjectType, id: row.subjectId, name: null },
        action: "auth.refresh_reuse",
        entityType: "refresh_token_family",
        entityId: row.familyId,
        after: { reason: "REUSE_DETECTED", token_id: row.id },
        ip: req.clientIp,
        requestId: req.id,
      });
    });
    throw ApiError.unauthenticated("Refresh token reuse detected; all sessions of this device family were revoked", "TOKEN_REUSED");
  };
  if (row.revokedAt || row.replacedById) return reuse();
  if (row.expiresAt.getTime() <= Date.now()) throw ApiError.unauthenticated("Refresh token expired", "TOKEN_EXPIRED");
  const outcome = await app.db.transaction(async (tx) => {
    const subject = await loadSubject(tx, row.subjectId);
    if (!subject) return { kind: "inactive" as const };
    // Atomic claim: only one concurrent refresh may rotate this token.
    const claimed = await tx
      .update(refreshTokens)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.replacedById), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (claimed.length === 0) return { kind: "raced" as const };
    const tokens = await issueTokens(tx, { type: row.subjectType, id: row.subjectId, companyId: row.companyId, aud }, row.familyId, req, { mfa: subject.mfa, mustChangePassword: subject.mustChangePassword }, { id: row.id });
    return { kind: "ok" as const, tokens };
  });
  if (outcome.kind === "inactive") throw ApiError.unauthenticated("Account is inactive", "USER_INACTIVE");
  if (outcome.kind === "raced") return reuse();
  return outcome.tokens;
}

/** Records a login attempt (success or failure) in login_events. */
export async function recordLoginEvent(tx: Executor, e: { companyId: string | null; subjectType: UserType; identifier: string; success: boolean; reason: string | null; req: FastifyRequest }): Promise<void> {
  const meta = requestMeta(e.req);
  await tx.insert(loginEvents).values({ companyId: e.companyId, subjectType: e.subjectType, identifier: e.identifier, success: e.success, reason: e.reason, ip: meta.ip, userAgent: meta.userAgent });
}

/** Lockout state of an account row. */
export function isLocked(row: { lockedUntil: Date | null }): boolean {
  return !!row.lockedUntil && row.lockedUntil.getTime() > Date.now();
}

/** Throws 423 LOCKED with `details.locked_until` when the account is inside its lockout window. */
export function assertNotLocked(row: { lockedUntil: Date | null }): void {
  if (isLocked(row)) throw ApiError.locked(`Account locked until ${row.lockedUntil!.toISOString()} after too many failed attempts`, { locked_until: row.lockedUntil!.toISOString() });
}

/** Computes the next failed_attempts/locked_until after a failed login (5 failures → 15 min lock). */
export function nextFailureState(row: { failedAttempts: number; lockedUntil: Date | null }): { failedAttempts: number; lockedUntil: Date | null; justLocked: boolean } {
  const resetWindow = row.lockedUntil !== null && row.lockedUntil.getTime() <= Date.now();
  const failed = (resetWindow ? 0 : row.failedAttempts) + 1;
  if (failed >= PASSWORD_POLICY.lockout_attempts) return { failedAttempts: failed, lockedUntil: new Date(Date.now() + LOCKOUT_MS), justLocked: true };
  return { failedAttempts: failed, lockedUntil: resetWindow ? null : row.lockedUntil, justLocked: false };
}

/** Applies a failed attempt to a staff user row and returns the new state. */
export async function applyStaffFailure(tx: Executor, row: typeof users.$inferSelect): Promise<ReturnType<typeof nextFailureState>> {
  const next = nextFailureState(row);
  await tx.update(users).set({ failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil }).where(eq(users.id, row.id));
  return next;
}

/** Applies a failed attempt to a portal user row and returns the new state. */
export async function applyPortalFailure(tx: Executor, row: typeof portalUsers.$inferSelect): Promise<ReturnType<typeof nextFailureState>> {
  const next = nextFailureState(row);
  await tx.update(portalUsers).set({ failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil }).where(eq(portalUsers.id, row.id));
  return next;
}

/** Validates a new password against the policy and the last 5 hashes; returns the new hash. 422 PASSWORD_POLICY on violation. */
export async function newPasswordHash(tx: Executor, subjectType: UserType, subjectId: string, currentHash: string, plain: string): Promise<string> {
  const problems = passwordPolicyProblems(plain);
  if (problems.length > 0) throw new ApiError(422, "PASSWORD_POLICY", `Password must have ${problems.join(", ")}`, { problems });
  const history = await tx
    .select({ hash: passwordHistory.passwordHash })
    .from(passwordHistory)
    .where(and(eq(passwordHistory.userType, subjectType), eq(passwordHistory.subjectId, subjectId)))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(PASSWORD_POLICY.history_count);
  if (await matchesHistory(plain, [currentHash, ...history.map((h) => h.hash)])) {
    throw new ApiError(422, "PASSWORD_POLICY", `Choose a password you have not used in your last ${PASSWORD_POLICY.history_count} passwords`, { problems: ["not one of the last 5 passwords"] });
  }
  const hash = await hashPassword(plain);
  await tx.insert(passwordHistory).values({ userType: subjectType, subjectId, passwordHash: currentHash });
  await tx.execute(sql`
    delete from password_history where id in (
      select id from password_history where user_type = ${subjectType} and subject_id = ${subjectId}
      order by created_at desc offset ${PASSWORD_POLICY.history_count}
    )`);
  return hash;
}
