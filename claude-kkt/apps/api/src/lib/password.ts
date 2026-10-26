import argon2 from "argon2";

const OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

/** Hash a password with argon2id (64 MiB, t=3). */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/** Verify a password against an argon2 hash; never throws on malformed hashes. */
export async function verifyPassword(hash: string | null | undefined, plain: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Password policy: ≥10 chars with upper, lower and digit; returns a list of human-readable problems (empty = ok). */
export function passwordPolicyProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < 10) problems.push("at least 10 characters");
  if (!/[A-Z]/.test(plain)) problems.push("an upper-case letter");
  if (!/[a-z]/.test(plain)) problems.push("a lower-case letter");
  if (!/[0-9]/.test(plain)) problems.push("a digit");
  if (/^(.)\1+$/.test(plain)) problems.push("not a single repeated character");
  return problems;
}

/** True when the password matches any of the previous hashes (history check). */
export async function matchesHistory(plain: string, hashes: string[]): Promise<boolean> {
  for (const h of hashes) if (await verifyPassword(h, plain)) return true;
  return false;
}
