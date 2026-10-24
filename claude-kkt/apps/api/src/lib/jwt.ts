import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { SignJWT, jwtVerify, exportJWK, type JWTPayload } from "jose";
import { config } from "../config.js";

export type TokenAudience = "erp" | "portal";

/** Claims we put in every access token. */
export interface AccessClaimsInput {
  sub: string;           // user id (staff) or portal user id (customer)
  aud: TokenAudience;
  cid: string;           // company id
  sid: string;           // refresh-token family id (session)
  mfa?: boolean;         // MFA satisfied for this session
  pwd?: boolean;         // must change password
}
export type AccessClaims = AccessClaimsInput & JWTPayload & { typ: "access" };

/** Deterministically derive an Ed25519 key pair from JWT_SECRET so every API instance verifies the same tokens without shared files. */
function deriveKeyPair(secret: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const seed = createHash("sha256").update("kkt-jwt-ed25519-v1:").update(secret).digest();
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

const { privateKey, publicKey } = deriveKeyPair(config.JWT_SECRET);
const ISSUER = "kkt";

/** Sign a 15-minute (configurable) access token for the given audience. */
export async function signAccessToken(claims: AccessClaimsInput, minutes = config.ACCESS_TOKEN_MINUTES): Promise<string> {
  return new SignJWT({ ...claims, typ: "access" })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(privateKey);
}

export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; reason: "EXPIRED" | "INVALID" | "WRONG_AUDIENCE" };

/** Verify an access token for a specific audience; wrong audience is reported distinctly so staff tokens can never open portal data. */
export async function verifyAccessToken(token: string, audience: TokenAudience): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER, clockTolerance: 30 });
    if (payload.aud !== audience) return { ok: false, reason: "WRONG_AUDIENCE" };
    if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.cid !== "string" || typeof payload.sid !== "string") return { ok: false, reason: "INVALID" };
    return { ok: true, claims: payload as unknown as AccessClaims };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "EXPIRED" : "INVALID" };
  }
}

/** Public JWK set for external verifiers (e.g. an edge proxy). */
export async function publicJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const jwk = await exportJWK(publicKey);
  return { keys: [{ ...jwk, kid: "k1", use: "sig", alg: "EdDSA" }] };
}
