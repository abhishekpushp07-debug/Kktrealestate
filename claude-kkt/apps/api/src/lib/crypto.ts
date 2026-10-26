import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Derive a 32-byte key from a configured secret (accepts raw text or base64) with a context label, so one secret can serve several purposes. */
function deriveKey(secret: string, context: string): Buffer {
  return createHash("sha256").update(context).update(":").update(secret).digest();
}

const hashKey = deriveKey(config.HASH_KEY, "kkt-hash-v1");

// ---------------------------------------------------------------------------
// Field-encryption key ring (FIELD_ENCRYPTION_KEYS `kid:secret,…`, first = active; FIELD_ENCRYPTION_KEY is always kid `k1`)
// ---------------------------------------------------------------------------

interface FieldKeyRing {
  activeKid: string;
  keys: Map<string, Buffer>;
}
let ringSource: unknown = null;
let ring: FieldKeyRing | null = null;

/** The derived key ring; rebuilt when `config.FIELD_KEY_RING` is replaced (tests swap it to simulate a rotation). */
function fieldKeyRing(): FieldKeyRing {
  const source = config.FIELD_KEY_RING;
  if (ring && ringSource === source) return ring;
  const keys = new Map<string, Buffer>();
  for (const k of source) keys.set(k.kid, deriveKey(k.secret, "kkt-field-v1"));
  const activeKid = source[0]?.kid;
  if (!activeKid) throw new Error("field encryption key ring is empty");
  ring = { activeKid, keys };
  ringSource = source;
  return ring;
}

/** Key id new ciphertexts are written with (the first entry of the ring). */
export function activeFieldKeyId(): string {
  return fieldKeyRing().activeKid;
}

/** Key id a ciphertext was written with (null for empty input or an unrecognised format). */
export function fieldKeyIdOf(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  return dot > 0 ? token.slice(0, dot) : null;
}

/** AES-256-GCM field encryption with the active key. Output format: `<kid>.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  const { activeKid, keys } = fieldKeyRing();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(activeKid)!, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [activeKid, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Decrypts a value produced by encryptField with whichever configured key its kid names; null for empty input; throws on tampering or an unknown kid. */
export function decryptField(token: string | null | undefined): string | null {
  if (!token) return null;
  const [kid, ivB, tagB, ctB] = token.split(".");
  const key = kid ? fieldKeyRing().keys.get(kid) : undefined;
  if (!key || !ivB || !tagB || !ctB)
    throw new Error(kid && !key ? `Field encryption key ${kid} is not configured` : "Unknown field encryption format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/** Re-encrypts a ciphertext under the active key; returns the input unchanged when it already uses it (or is empty). */
export function reencryptField(token: string | null | undefined): string | null {
  if (!token) return token ?? null;
  if (fieldKeyIdOf(token) === activeFieldKeyId()) return token;
  return encryptField(decryptField(token));
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
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ",
    lower = "abcdefghjkmnpqrstuvwxyz",
    digits = "23456789",
    symbols = "@#$%&*";
  const all = upper + lower + digits + symbols;
  const pick = (s: string) => s[randomBytes(1)[0]! % s.length]!;
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** HMAC keys for signed payloads: the current JWT_SECRET signs, previous secrets (JWT_PREVIOUS_SECRETS) still verify during a rotation. */
let signSource: unknown = null;
let signKeys: Buffer[] = [];
function signingKeys(): Buffer[] {
  const source = `${config.JWT_SECRET}\u0000${config.JWT_PREVIOUS_SECRETS.join("\u0000")}`;
  if (signSource !== source) {
    signKeys = [config.JWT_SECRET, ...config.JWT_PREVIOUS_SECRETS].map((s) => deriveKey(s, "kkt-sign-v1"));
    signSource = source;
  }
  return signKeys;
}

/** Sign a short-lived payload (download links, visit manage links, backup links): returns `payload.exp.sig` in base64url. */
export function signPayload(payload: Record<string, string | number>, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = createHmac("sha256", signingKeys()[0]!).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verify a signed payload (current or a previous secret); returns the payload or null when forged/expired. */
export function verifyPayload<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot),
    sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const valid = signingKeys().some((key) => {
    const b = Buffer.from(createHmac("sha256", key).update(body).digest("base64url"));
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!valid) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a),
    bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
