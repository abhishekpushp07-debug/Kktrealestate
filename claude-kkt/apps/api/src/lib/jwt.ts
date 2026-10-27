import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { SignJWT, decodeProtectedHeader, jwtVerify, exportJWK, type JWTPayload } from "jose";
import { config } from "../config.js";

export type TokenAudience = "erp" | "portal";

/** Claims we put in every access token. */
export interface AccessClaimsInput {
  sub: string; // user id (staff) or portal user id (customer)
  aud: TokenAudience;
  cid: string; // company id
  sid: string; // refresh-token family id (session)
  mfa?: boolean; // MFA satisfied for this session
  pwd?: boolean; // must change password
  rid?: string; // staff: role id at issue time (keys the role version of the auth cache)
}
export type AccessClaims = AccessClaimsInput & JWTPayload & { typ: "access" };

/** One Ed25519 signing/verification key; `kid` goes into the token header and selects the key on verification. */
export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** The first key of the ring signs new tokens; the others only verify (rotation window). */
  current: boolean;
}

/** Deterministically derive an Ed25519 key pair from a secret (non-production fallback when JWT_SIGNING_KEYS is unset). */
function deriveKeyPair(secret: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const seed = createHash("sha256").update("kkt-jwt-ed25519-v1:").update(secret).digest();
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Fingerprint key id of a derived key: first 16 base64url characters of the SHA-256 of the public key (SPKI DER). */
function keyId(publicKey: KeyObject): string {
  return createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("base64url")
    .slice(0, 16);
}

/** What the cached ring was built from: the JWT_SIGNING_KEYS array, JWT_SECRET and a copy of JWT_PREVIOUS_SECRETS. */
let ringSource: { keys: unknown; secret: string; previous: string[] } | null = null;
let ring: SigningKey[] = [];

/** True when the configuration still matches the cached ring (no allocation: this runs on every request). */
function ringIsCurrent(): boolean {
  if (ringSource === null || ringSource.keys !== config.JWT_SIGNING_KEYS || ringSource.secret !== config.JWT_SECRET)
    return false;
  const previous = config.JWT_PREVIOUS_SECRETS;
  if (ringSource.previous.length !== previous.length) return false;
  for (let i = 0; i < previous.length; i++) if (ringSource.previous[i] !== previous[i]) return false;
  return true;
}

/**
 * Signing key ring (contract C9): JWT_SIGNING_KEYS (`<kid>:<base64 PKCS8 DER Ed25519 key>`, first signs, every key verifies the tokens
 * carrying its kid and is published in the JWKS). Outside production, when JWT_SIGNING_KEYS is unset, the ring is derived from JWT_SECRET
 * (signs) and JWT_PREVIOUS_SECRETS (verify only) with fingerprint kids, as before. Rebuilt when the configuration changes.
 */
export function signingKeys(): SigningKey[] {
  if (ringIsCurrent()) return ring;
  if (config.JWT_SIGNING_KEYS.length > 0) {
    ring = config.JWT_SIGNING_KEYS.map((k, i) => {
      const privateKey = createPrivateKey({ key: k.der, format: "der", type: "pkcs8" });
      return { kid: k.kid, privateKey, publicKey: createPublicKey(privateKey), current: i === 0 };
    });
  } else {
    ring = [config.JWT_SECRET, ...config.JWT_PREVIOUS_SECRETS].map((secret, i) => {
      const pair = deriveKeyPair(secret);
      return { kid: keyId(pair.publicKey), ...pair, current: i === 0 };
    });
  }
  ringSource = { keys: config.JWT_SIGNING_KEYS, secret: config.JWT_SECRET, previous: [...config.JWT_PREVIOUS_SECRETS] };
  return ring;
}

const ISSUER = "kkt";

/** Sign a 15-minute (configurable) access token for the given audience with the current key (its kid in the header). */
export async function signAccessToken(
  claims: AccessClaimsInput,
  minutes = config.ACCESS_TOKEN_MINUTES,
): Promise<string> {
  const key = signingKeys()[0]!;
  return new SignJWT({ ...claims, typ: "access" })
    .setProtectedHeader({ alg: "EdDSA", kid: key.kid })
    .setIssuer(ISSUER)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(key.privateKey);
}

export type VerifyResult =
  { ok: true; claims: AccessClaims } | { ok: false; reason: "EXPIRED" | "INVALID" | "WRONG_AUDIENCE" };

/**
 * Candidate keys for a token: the one its kid names, else (tokens minted before kids were fingerprints, e.g. `k1`) every key. With a
 * single key (no rotation in progress) that key is the only candidate either way, so the header is not decoded twice (jwtVerify parses it).
 */
function candidates(token: string): SigningKey[] {
  const keys = signingKeys();
  if (keys.length === 1 && config.JWT_SIGNING_KEYS.length === 0) return keys;
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    return [];
  }
  const named = keys.filter((k) => k.kid === kid);
  // An explicit ring verifies by kid only (a token naming no configured key is invalid); the derived ring also accepts kid-less tokens
  // minted before kids were fingerprints.
  if (named.length > 0 || config.JWT_SIGNING_KEYS.length > 0) return named;
  return keys;
}

const VERIFY_OPTIONS = { issuer: ISSUER, clockTolerance: 30, algorithms: ["EdDSA"] };

/** Verify an access token for a specific audience (current or previous key); wrong audience is reported distinctly so staff tokens can never open portal data. */
export async function verifyAccessToken(token: string, audience: TokenAudience): Promise<VerifyResult> {
  let lastCode: string | undefined;
  for (const key of candidates(token)) {
    try {
      const { payload } = await jwtVerify(token, key.publicKey, VERIFY_OPTIONS);
      if (payload.aud !== audience) return { ok: false, reason: "WRONG_AUDIENCE" };
      if (
        payload.typ !== "access" ||
        typeof payload.sub !== "string" ||
        typeof payload.cid !== "string" ||
        typeof payload.sid !== "string"
      )
        return { ok: false, reason: "INVALID" };
      return { ok: true, claims: payload as unknown as AccessClaims };
    } catch (e) {
      lastCode = (e as { code?: string }).code;
      // claims are checked after the signature: an expired token was signed by this key, so no other key can do better
      if (lastCode === "ERR_JWT_EXPIRED") return { ok: false, reason: "EXPIRED" };
    }
  }
  return { ok: false, reason: "INVALID" };
}

/** Public JWK set for external verifiers (e.g. an edge proxy): every key of the ring (each verifies tokens carrying its kid), current first. */
export async function publicJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const keys = await Promise.all(
    signingKeys().map(async (k) => ({ ...(await exportJWK(k.publicKey)), kid: k.kid, use: "sig", alg: "EdDSA" })),
  );
  return { keys };
}
