/**
 * Login lockout (SPEC §2 "lockout after 5 failed attempts for 15 minutes", staff and buyers alike), counted so that it is neither an
 * account-existence oracle nor a remote denial-of-service lever:
 *
 *   - PAIR lock: 5 failures for one (identifier, client IP) inside 15 minutes lock that pair for 15 minutes after the 5th failure.
 *     Other IPs — the real owner on their own network — can still sign in. A successful sign-in from the IP resets the pair.
 *   - ACCOUNT lock: 20 failures for one identifier across all IPs inside 15 minutes lock the account itself (`locked_until`) for
 *     15 minutes and notify the Super Admins (a distributed guessing attack).
 *
 * Counters are derived from `login_events` (the same rows the audit screens show), so they survive restarts and need no Redis. The reset
 * point of both counters is the account's `locked_until` once it lies in the past: a lock that expired, an admin unlock or a password
 * reset (both write `locked_until = now()`) starts a clean slate. Unknown identifiers are counted exactly like real ones, so the wire
 * answers (401 → 423 after the 5th attempt from an IP) are the same whether or not the account exists.
 */
import { sql } from "drizzle-orm";
import { PASSWORD_POLICY, type UserType } from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import { ApiError } from "../../lib/errors.js";

/** Failures from one IP that lock the (identifier, IP) pair. */
export const PAIR_LOCK_ATTEMPTS = PASSWORD_POLICY.lockout_attempts;
/** Failures across all IPs that lock the account itself. */
export const ACCOUNT_LOCK_ATTEMPTS = 20;
/** Counting window and lock duration (15 minutes). */
export const LOCK_WINDOW_MS = PASSWORD_POLICY.lockout_minutes * 60_000;
/** login_events reasons that count as a failed guess (LOCKED / INACTIVE / DISABLED rows do not). */
export const COUNTED_FAILURE_REASONS = ["BAD_PASSWORD", "BAD_MFA", "UNKNOWN_USER"] as const;

/** Whose attempts are counted. */
export interface LockTarget {
  subjectType: UserType;
  /** Canonical identifier as written to login_events (lower-cased e-mail, normalised phone). */
  identifier: string;
  ip: string;
  /** The account's `locked_until` when it lies in the past (expired lock, admin unlock, password reset); null otherwise. */
  resetAt: Date | null;
}

/** Current counters and the lock they imply. */
export interface LockState {
  pairFailures: number;
  accountFailures: number;
  /** Set when the pair or the account is locked right now. */
  lockedUntil: Date | null;
  scope: "PAIR" | "ACCOUNT" | null;
  /** End of the account-wide lock implied by the counters (set once ACCOUNT_LOCK_ATTEMPTS is reached). */
  accountLockUntil: Date | null;
}

/** The reset point of an account row: `locked_until` once it has passed. */
export function resetPointOf(row: { lockedUntil: Date | null } | null | undefined, now = new Date()): Date | null {
  return row?.lockedUntil && row.lockedUntil.getTime() <= now.getTime() ? row.lockedUntil : null;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Reads the counters of a target from login_events (one statement; uses login_events_identifier_idx). */
export async function loginLockState(db: Executor, t: LockTarget, now = new Date()): Promise<LockState> {
  const windowStart = new Date(now.getTime() - LOCK_WINDOW_MS);
  const reasons = `{${COUNTED_FAILURE_REASONS.join(",")}}`;
  const rows = await db.execute<{
    pair_n: number | string;
    pair_last: Date | string | null;
    acct_n: number | string;
    acct_last: Date | string | null;
  }>(sql`
    with since as (
      select greatest(${windowStart.toISOString()}::timestamptz, coalesce(${t.resetAt ? t.resetAt.toISOString() : null}::timestamptz, '-infinity'::timestamptz)) as acct_since
    ), pair_ok as (
      select max(created_at) as t from login_events
      where subject_type = ${t.subjectType} and identifier = ${t.identifier} and ip = ${t.ip} and success
    )
    select
      count(*) filter (where e.ip = ${t.ip} and e.created_at > greatest(s.acct_since, p.t))::int as pair_n,
      max(e.created_at) filter (where e.ip = ${t.ip} and e.created_at > greatest(s.acct_since, p.t)) as pair_last,
      count(*)::int as acct_n,
      max(e.created_at) as acct_last
    from login_events e cross join since s cross join pair_ok p
    where e.subject_type = ${t.subjectType} and e.identifier = ${t.identifier} and not e.success
      and e.reason = any(${reasons}::text[]) and e.created_at > s.acct_since`);
  const r = rows[0];
  const pairFailures = Number(r?.pair_n ?? 0);
  const accountFailures = Number(r?.acct_n ?? 0);
  const pairLast = toDate(r?.pair_last);
  const acctLast = toDate(r?.acct_last);
  const accountLockUntil =
    accountFailures >= ACCOUNT_LOCK_ATTEMPTS && acctLast ? new Date(acctLast.getTime() + LOCK_WINDOW_MS) : null;
  const pairLockUntil =
    pairFailures >= PAIR_LOCK_ATTEMPTS && pairLast ? new Date(pairLast.getTime() + LOCK_WINDOW_MS) : null;
  const live = (d: Date | null) => (d && d.getTime() > now.getTime() ? d : null);
  const acct = live(accountLockUntil),
    pair = live(pairLockUntil);
  const lockedUntil = acct && pair ? (acct > pair ? acct : pair) : (acct ?? pair);
  return {
    pairFailures,
    accountFailures,
    lockedUntil,
    scope: acct ? "ACCOUNT" : pair ? "PAIR" : null,
    accountLockUntil: acct,
  };
}

/** The one 423 every locked sign-in gets (pair or account, known or unknown identifier): same code, message and detail keys. */
export function lockedError(until: Date): ApiError {
  return ApiError.locked(
    `Too many failed sign-in attempts. Try again after ${PASSWORD_POLICY.lockout_minutes} minutes.`,
    { locked_until: until.toISOString() },
  );
}

/**
 * In-flight sign-in attempts of this process per (identifier, IP) pair and per identifier. The counters above only see attempts that have
 * finished, so a burst of parallel guesses would all pass the lock check before the first failure is written (and with the Redis rate limit
 * failing open, the burst is unbounded). An attempt therefore reserves a slot first: when the attempts in flight plus the failures already
 * counted reach a threshold, the extra attempt is refused at once with 429 RATE_LIMITED — never queued (queued attempts would hold
 * database connections). Same answer for known and unknown identifiers.
 */
const inflightPair = new Map<string, number>();
const inflightAccount = new Map<string, number>();

function bump(map: Map<string, number>, key: string, by: number): void {
  const n = (map.get(key) ?? 0) + by;
  if (n <= 0) map.delete(key);
  else map.set(key, n);
}

/** Reserves an attempt slot for a target (see above); returns the release function (idempotent). Throws 429 when the budget is used up. */
export function reserveLoginAttempt(
  t: LockTarget,
  state: Pick<LockState, "pairFailures" | "accountFailures">,
): () => void {
  const acctKey = `${t.subjectType}:${t.identifier}`;
  const pairKey = `${acctKey}:${t.ip}`;
  if (
    (inflightPair.get(pairKey) ?? 0) + state.pairFailures >= PAIR_LOCK_ATTEMPTS ||
    (inflightAccount.get(acctKey) ?? 0) + state.accountFailures >= ACCOUNT_LOCK_ATTEMPTS
  ) {
    throw ApiError.rateLimited(1);
  }
  bump(inflightPair, pairKey, 1);
  bump(inflightAccount, acctKey, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bump(inflightPair, pairKey, -1);
    bump(inflightAccount, acctKey, -1);
  };
}
