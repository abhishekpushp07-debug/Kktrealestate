import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { SessionRow, UserType } from "@kkt/contracts";
import { PASSWORD_POLICY } from "@kkt/contracts";
import { companies, loginEvents, passwordHistory, portalUsers, refreshTokens, users, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import { writeAudit, type AuditActor } from "../../lib/audit.js";
import { SUPER_ADMIN_ROLE_NAME } from "../../lib/scope.js";
import { notifyRole } from "../notifications/index.js";
import { loginLockState, lockedError, PAIR_LOCK_ATTEMPTS, reserveLoginAttempt, type LockTarget } from "./lockout.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { COMPANY_HEADER, companyIdByHost, companyIdBySlug, normaliseHost } from "../../lib/tenant.js";
import { signAccessToken, type TokenAudience } from "../../lib/jwt.js";
import { hashPassword, matchesHistory, passwordPolicyProblems } from "../../lib/password.js";
import { markSessionRevoked, markSessionsRevoked, securityRedis } from "../../plugins/auth.js";

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
  /** End of the family's absolute lifetime (REFRESH_ABSOLUTE_TTL_DAYS after sign-in; rotation never extends it). */
  session_expires_at: Date;
}

/** Flags carried into a new access token. */
export interface SessionFlags {
  mfa: boolean;
  mustChangePassword: boolean;
  /** Staff: role id (access-token claim `rid`, keys the auth cache's role version). */
  roleId?: string | undefined;
}

/** End of the absolute lifetime of a family started at `startedAt` (contract C1). */
export function familyExpiresAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + config.REFRESH_ABSOLUTE_TTL_DAYS * 86_400_000);
}

function requestMeta(req: FastifyRequest): { ip: string; userAgent: string | null } {
  const ua = req.headers["user-agent"];
  return { ip: req.clientIp, userAgent: ua ? String(ua).slice(0, 300) : null };
}

/** Starts a new refresh-token family and signs the matching access token (sid = family id). */
export async function createSession(
  tx: Executor,
  subject: SessionSubject,
  req: FastifyRequest,
  flags: SessionFlags,
): Promise<IssuedTokens> {
  const familyId = randomUUID();
  return issueTokens(tx, subject, familyId, new Date(), req, flags);
}

/**
 * Inserts the family's next refresh token and signs its access token. A token lives REFRESH_TOKEN_DAYS but never past the family's
 * absolute end (`family_started_at` + REFRESH_ABSOLUTE_TTL_DAYS), which every rotation copies unchanged.
 */
async function issueTokens(
  tx: Executor,
  subject: SessionSubject,
  familyId: string,
  familyStartedAt: Date,
  req: FastifyRequest,
  flags: SessionFlags,
  replaces?: { id: string },
): Promise<IssuedTokens> {
  const raw = `rt_${randomToken(32)}`;
  const meta = requestMeta(req);
  const absoluteEnd = familyExpiresAt(familyStartedAt);
  const expiresAt = new Date(Math.min(Date.now() + config.REFRESH_TOKEN_DAYS * 86_400_000, absoluteEnd.getTime()));
  const [inserted] = await tx
    .insert(refreshTokens)
    .values({
      companyId: subject.companyId,
      subjectType: subject.type,
      subjectId: subject.id,
      familyId,
      familyStartedAt,
      tokenHash: sha256(raw),
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    })
    .returning({ id: refreshTokens.id });
  if (replaces && inserted) {
    await tx
      .update(refreshTokens)
      .set({ replacedById: inserted.id, lastUsedAt: new Date() })
      .where(eq(refreshTokens.id, replaces.id));
  }
  const access = await signAccessToken({
    sub: subject.id,
    aud: subject.aud,
    cid: subject.companyId,
    sid: familyId,
    mfa: flags.mfa,
    pwd: flags.mustChangePassword,
    ...(flags.roleId ? { rid: flags.roleId } : {}),
  });
  return {
    access_token: access,
    refresh_token: raw,
    token_type: "Bearer",
    expires_in: config.ACCESS_TOKEN_MINUTES * 60,
    audience: subject.aud,
    family_id: familyId,
    session_expires_at: absoluteEnd,
  };
}

/**
 * The company a sign-in names (contract C4), before any account is looked up: the body's `company` slug, else the `x-kkt-company` header
 * (an unknown slug → 400 COMPANY_REQUIRED), else the request Host in `companies.hosts`, else the only company. Null when several companies
 * exist and nothing names one — the caller then resolves the identifier across companies (loginCandidates).
 */
export async function loginCompanyId(
  app: Pick<FastifyInstance, "db">,
  req: Pick<FastifyRequest, "headers" | "hostname">,
  slug: string | undefined,
): Promise<string | null> {
  const header = req.headers[COMPANY_HEADER];
  const named = (slug ?? (Array.isArray(header) ? header[0] : header))?.trim();
  if (named) {
    const id = await companyIdBySlug(app.db, named);
    if (!id)
      throw new ApiError(400, "COMPANY_REQUIRED", `No company has the slug "${named.slice(0, 100)}"`, {
        company: named.slice(0, 100),
      });
    return id;
  }
  const host = normaliseHost(req.hostname);
  if (host) {
    const id = await companyIdByHost(app.db, host);
    if (id) return id;
  }
  // The single-company fallback is read fresh (not from the 30 s tenant cache): a sign-in must never attribute its login event to a
  // company that was replaced a moment ago (reseed, restore). One indexed query; argon2 dominates a sign-in anyway.
  const rows = await app.db.select({ id: companies.id }).from(companies).limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

/**
 * Picks the account of a sign-in among the rows matching the identifier: within the resolved company when there is one; without a
 * company, the single matching row (none → null, answered like a wrong password: no enumeration), and 400 COMPANY_REQUIRED when the
 * identifier exists in more than one company (the client must name the company).
 */
export function pickLoginAccount<T extends { companyId: string }>(
  rows: readonly T[],
  companyId: string | null,
): T | null {
  if (companyId) return rows.find((r) => r.companyId === companyId) ?? null;
  if (rows.length > 1)
    throw new ApiError(400, "COMPANY_REQUIRED", "This sign-in exists in several companies: name the company", {
      field: "company",
    });
  return rows[0] ?? null;
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

/** Revokes every family of a subject except `keepFamilyId` (logout everywhere / password change / deactivation): one UPDATE, one Redis pipeline. */
export async function revokeAllFamilies(
  tx: Executor,
  redis: Redis,
  subjectType: UserType,
  subjectId: string,
  reason: string,
  keepFamilyId?: string,
): Promise<number> {
  const rows = await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(refreshTokens.subjectType, subjectType),
        eq(refreshTokens.subjectId, subjectId),
        isNull(refreshTokens.revokedAt),
        keepFamilyId ? ne(refreshTokens.familyId, keepFamilyId) : undefined,
      ),
    )
    .returning({ familyId: refreshTokens.familyId });
  const families = [...new Set(rows.map((r) => r.familyId))];
  await markSessionsRevoked(redis, families);
  return families.length;
}

/** Lists live sessions (one per family: the current, unreplaced token) for a subject. */
export async function listSessions(
  db: Executor,
  subjectType: UserType,
  subjectId: string,
  currentFamilyId: string,
): Promise<SessionRow[]> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.subjectType, subjectType),
        eq(refreshTokens.subjectId, subjectId),
        isNull(refreshTokens.revokedAt),
        isNull(refreshTokens.replacedById),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
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
export async function familyOfSession(
  db: Executor,
  subjectType: UserType,
  subjectId: string,
  sessionId: string,
): Promise<string> {
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.id, sessionId),
        eq(refreshTokens.subjectType, subjectType),
        eq(refreshTokens.subjectId, subjectId),
      ),
    )
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
  loadSubject: (
    tx: Executor,
    subjectId: string,
  ) => Promise<{
    companyId: string;
    mfa: boolean;
    mustChangePassword: boolean;
    roleId?: string;
    actor: AuditActor;
  } | null>,
): Promise<IssuedTokens> {
  const expectedType: UserType = aud === "erp" ? "STAFF" : "CUSTOMER";
  const [row] = await app.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(rawToken)))
    .limit(1);
  if (!row || row.subjectType !== expectedType)
    throw ApiError.unauthenticated("Invalid refresh token", "INVALID_TOKEN");
  const reuse = async (): Promise<never> => {
    await app.db.transaction(async (tx) => {
      await revokeFamily(tx, securityRedis(app), row.familyId, "REUSE_DETECTED");
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
    throw ApiError.unauthenticated(
      "Refresh token reuse detected; all sessions of this device family were revoked",
      "TOKEN_REUSED",
    );
  };
  if (row.revokedAt || row.replacedById) return reuse();
  // Absolute lifetime (contract C1): past it the whole family ends, whatever the sliding expiry of its latest token says.
  if (familyExpiresAt(row.familyStartedAt).getTime() <= Date.now()) {
    await app.db.transaction(async (tx) => {
      await revokeFamily(tx, securityRedis(app), row.familyId, "SESSION_EXPIRED");
    });
    throw ApiError.unauthenticated("Session expired; sign in again", "SESSION_EXPIRED");
  }
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
    const tokens = await issueTokens(
      tx,
      { type: row.subjectType, id: row.subjectId, companyId: row.companyId, aud },
      row.familyId,
      row.familyStartedAt,
      req,
      { mfa: subject.mfa, mustChangePassword: subject.mustChangePassword, roleId: subject.roleId },
      { id: row.id },
    );
    return { kind: "ok" as const, tokens };
  });
  if (outcome.kind === "inactive") throw ApiError.unauthenticated("Account is inactive", "USER_INACTIVE");
  if (outcome.kind === "raced") return reuse();
  return outcome.tokens;
}

/** Records a login attempt (success or failure) in login_events. */
export async function recordLoginEvent(
  tx: Executor,
  e: {
    companyId: string | null;
    subjectType: UserType;
    identifier: string;
    success: boolean;
    reason: string | null;
    req: FastifyRequest;
  },
): Promise<void> {
  const meta = requestMeta(e.req);
  await tx.insert(loginEvents).values({
    companyId: e.companyId,
    subjectType: e.subjectType,
    identifier: e.identifier,
    success: e.success,
    reason: e.reason,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** Lockout state of an account row (the account-wide lock; per-IP pair locks live in login_events, see lockout.ts). */
export function isLocked(row: { lockedUntil: Date | null }): boolean {
  return !!row.lockedUntil && row.lockedUntil.getTime() > Date.now();
}

/** An account a sign-in attempt resolved to (null for an unknown identifier). */
export interface LoginAccount {
  type: UserType;
  id: string;
  companyId: string;
  lockedUntil: Date | null;
  /** For notifications/audit: e-mail or customer name. */
  label: string;
  /** ERP link of the account (Super Admin notification). */
  link: string;
}

/**
 * Refuses a sign-in attempt up front when the account (account-wide lock) or the (identifier, IP) pair is locked: 423 with the same body
 * for known and unknown identifiers. The blocked attempt is recorded as reason LOCKED (not counted as a guess). An allowed attempt reserves
 * an in-flight slot (lockout.ts reserveLoginAttempt; 429 when parallel attempts would exceed the lock budget): the caller must call the
 * returned release function once the attempt has been decided (try/finally).
 */
export async function assertLoginAllowed(
  db: Executor,
  req: FastifyRequest,
  target: LockTarget,
  account: LoginAccount | null,
): Promise<() => void> {
  let until: Date | null = account && isLocked(account) ? account.lockedUntil : null;
  const state = until ? null : await loginLockState(db, target);
  if (state) until = state.lockedUntil;
  if (until || !state) {
    await recordLoginEvent(db, {
      companyId: account?.companyId ?? target.companyId ?? null,
      subjectType: target.subjectType,
      identifier: target.identifier,
      success: false,
      reason: "LOCKED",
      req,
    });
    throw lockedError(until!);
  }
  return reserveLoginAttempt(target, state);
}

/**
 * Records a failed guess and answers it: 401 INVALID_CREDENTIALS with an identical body whether or not the account exists (no
 * attempts_left), or 423 LOCKED once this failure completed a pair lock (5 from this IP) or an account lock (20 across IPs). An account
 * lock is written to `locked_until`, audited and notified to the Super Admins; a pair lock is audited with the IP.
 */
export async function failLogin(
  app: FastifyInstance,
  req: FastifyRequest,
  target: LockTarget,
  account: LoginAccount | null,
  reason: "BAD_PASSWORD" | "BAD_MFA",
  message: string,
): Promise<never> {
  const state = await app.db.transaction(async (tx) => {
    await recordLoginEvent(tx, {
      companyId: account?.companyId ?? target.companyId ?? null,
      subjectType: target.subjectType,
      identifier: target.identifier,
      success: false,
      reason: account ? reason : "UNKNOWN_USER",
      req,
    });
    if (account?.type === "STAFF")
      await tx
        .update(users)
        .set({ failedAttempts: sql`${users.failedAttempts} + 1` })
        .where(eq(users.id, account.id));
    else if (account)
      await tx
        .update(portalUsers)
        .set({ failedAttempts: sql`${portalUsers.failedAttempts} + 1` })
        .where(eq(portalUsers.id, account.id));
    const st = await loginLockState(tx, target);
    if (!account) return st;
    const prefix = account.type === "STAFF" ? "auth" : "portal_auth";
    const entityType = account.type === "STAFF" ? "user" : "portal_user";
    const actor: AuditActor = { type: "SYSTEM", id: null, name: "lockout" };
    if (st.accountLockUntil && !isLocked(account)) {
      if (account.type === "STAFF")
        await tx.update(users).set({ lockedUntil: st.accountLockUntil }).where(eq(users.id, account.id));
      else await tx.update(portalUsers).set({ lockedUntil: st.accountLockUntil }).where(eq(portalUsers.id, account.id));
      await writeAudit(tx, {
        companyId: account.companyId,
        actor,
        action: `${prefix}.locked`,
        entityType,
        entityId: account.id,
        after: { scope: "ACCOUNT", locked_until: st.accountLockUntil.toISOString(), failures: st.accountFailures },
        ip: req.clientIp,
        requestId: req.id,
      });
      await notifyRole(tx, account.companyId, [SUPER_ADMIN_ROLE_NAME], {
        type: "SECURITY_ALERT",
        title: `Security: ${account.type === "STAFF" ? "staff" : "customer"} account ${account.label} locked after ${st.accountFailures} failed sign-ins`,
        body: `Failed sign-ins came from several IP addresses within ${PASSWORD_POLICY.lockout_minutes} minutes; the account is locked until ${st.accountLockUntil.toISOString()}.`,
        entityType,
        entityId: account.id,
        link: account.link,
      });
    } else if (st.scope === "PAIR" && st.pairFailures === PAIR_LOCK_ATTEMPTS) {
      await writeAudit(tx, {
        companyId: account.companyId,
        actor,
        action: `${prefix}.locked`,
        entityType,
        entityId: account.id,
        after: {
          scope: "PAIR",
          ip: target.ip,
          locked_until: st.lockedUntil?.toISOString() ?? null,
          failures: st.pairFailures,
        },
        ip: req.clientIp,
        requestId: req.id,
      });
    }
    return st;
  });
  if (state.lockedUntil) throw lockedError(state.lockedUntil);
  throw new ApiError(401, "INVALID_CREDENTIALS", message);
}

/** Validates a new password against the policy and the last 5 hashes; returns the new hash. 422 PASSWORD_POLICY on violation. */
export async function newPasswordHash(
  tx: Executor,
  subjectType: UserType,
  subjectId: string,
  currentHash: string,
  plain: string,
): Promise<string> {
  const problems = passwordPolicyProblems(plain);
  if (problems.length > 0)
    throw new ApiError(422, "PASSWORD_POLICY", `Password must have ${problems.join(", ")}`, { problems });
  const history = await tx
    .select({ hash: passwordHistory.passwordHash })
    .from(passwordHistory)
    .where(and(eq(passwordHistory.userType, subjectType), eq(passwordHistory.subjectId, subjectId)))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(PASSWORD_POLICY.history_count);
  if (await matchesHistory(plain, [currentHash, ...history.map((h) => h.hash)])) {
    throw new ApiError(
      422,
      "PASSWORD_POLICY",
      `Choose a password you have not used in your last ${PASSWORD_POLICY.history_count} passwords`,
      { problems: ["not one of the last 5 passwords"] },
    );
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
