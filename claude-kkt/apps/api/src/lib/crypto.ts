import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Derive a 32-byte key from a configured secret (accepts raw text or base64) with a context label, so one secret can serve several purposes. */
function deriveKey(secret: string, context: string): Buffer {
  return createHash("sha256").update(context).update(":").update(secret).digest();
}

const FIELD_KEY_ID = "k1";
const fieldKey = deriveKey(config.FIELD_ENCRYPTION_KEY, "kkt-field-v1");
const hashKey = deriveKey(config.HASH_KEY, "kkt-hash-v1");
const signKey = deriveKey(config.JWT_SECRET, "kkt-sign-v1");

/** AES-256-GCM field encryption. Output format: `k1.<iv>.<tag>.<ciphertext>` (base64url), so keys can be rotated by key id. */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fieldKey, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FIELD_KEY_ID, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Decrypt a value produced by encryptField; returns null for empty input and throws on tampering. */
export function decryptField(token: string | null | undefined): string | null {
  if (!token) return null;
  const [kid, ivB, tagB, ctB] = token.split(".");
  if (kid !== FIELD_KEY_ID || !ivB || !tagB || !ctB) throw new Error("Unknown field encryption format");
  const decipher = createDecipheriv("aes-256-gcm", fieldKey, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/** Keyed hash (HMAC-SHA256) for duplicate detection on encrypted identifiers (PAN, Aadhaar). Input is canonicalised by the caller. */
export function keyedHash(value: string): string {
  return createHmac("sha256", hashKey).update(value).digest("hex");
}

/** SHA-256 hex of a token (refresh tokens, manage tokens, brochure links are stored hashed). */
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Cryptographically random URL-safe token (default 32 bytes = 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Strong temporary password for portal access: 12 chars, mixed classes, unambiguous alphabet. */
export function temporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghjkmnpqrstuvwxyz", digits = "23456789", symbols = "@#$%&*";
  const all = upper + lower + digits + symbols;
  const pick = (s: string) => s[randomBytes(1)[0]! % s.length]!;
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = randomBytes(1)[0]! % (i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
}

/** Sign a short-lived payload (download links, visit manage links, backup links): returns `payload.exp.sig` in base64url. */
export function signPayload(payload: Record<string, string | number>, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = createHmac("sha256", signKey).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verify a signed payload; returns the payload or null when forged/expired. */
export function verifyPayload<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = createHmac("sha256", signKey).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
