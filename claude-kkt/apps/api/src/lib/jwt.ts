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
}
export type AccessClaims = AccessClaimsInput & JWTPayload & { typ: "access" };

/** One Ed25519 signing/verification key derived from a secret; `kid` is a fingerprint of the public key (stable across instances). */
export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** The current JWT_SECRET (signs new tokens); previous secrets only verify. */
  current: boolean;
}

/** Deterministically derive an Ed25519 key pair from a secret so every API instance signs/verifies the same tokens without shared files. */
function deriveKeyPair(secret: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const seed = createHash("sha256").update("kkt-jwt-ed25519-v1:").update(secret).digest();
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Key id: first 16 base64url characters of the SHA-256 of the public key (SPKI DER). Reveals nothing about the secret. */
function keyId(publicKey: KeyObject): string {
  return createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("base64url")
    .slice(0, 16);
}

let ringSource: string | null = null;
let ring: SigningKey[] = [];

/**
 * Signing key ring: JWT_SECRET (current, signs) followed by JWT_PREVIOUS_SECRETS (verify only), so a rotation keeps every token issued in
 * the last ACCESS_TOKEN_MINUTES valid. Rebuilt when the configuration changes (tests rotate in-process).
 */
export function signingKeys(): SigningKey[] {
  const secrets = [config.JWT_SECRET, ...config.JWT_PREVIOUS_SECRETS];
  const source = secrets.join("\u0000");
  if (ringSource === source) return ring;
  ring = secrets.map((secret, i) => {
    const pair = deriveKeyPair(secret);
    return { kid: keyId(pair.publicKey), ...pair, current: i === 0 };
  });
  ringSource = source;
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

/** Candidate keys for a token: the one its kid names, else (tokens minted before kids were fingerprints, e.g. `k1`) every key. */
function candidates(token: string): SigningKey[] {
  const keys = signingKeys();
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    return [];
  }
  const named = keys.filter((k) => k.kid === kid);
  return named.length > 0 ? named : keys;
}

/** Verify an access token for a specific audience (current or previous key); wrong audience is reported distinctly so staff tokens can never open portal data. */
export async function verifyAccessToken(token: string, audience: TokenAudience): Promise<VerifyResult> {
  let lastCode: string | undefined;
  for (const key of candidates(token)) {
    try {
      const { payload } = await jwtVerify(token, key.publicKey, {
        issuer: ISSUER,
        clockTolerance: 30,
        algorithms: ["EdDSA"],
      });
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

/** Public JWK set for external verifiers (e.g. an edge proxy): every key that can still verify a live token, current first. */
export async function publicJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const keys = await Promise.all(
    signingKeys().map(async (k) => ({ ...(await exportJWK(k.publicKey)), kid: k.kid, use: "sig", alg: "EdDSA" })),
  );
  return { keys };
}
