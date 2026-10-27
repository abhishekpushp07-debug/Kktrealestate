import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Derive a 32-byte key from a configured secret (accepts raw text or base64) with a context label, so one secret can serve several purposes. */
function deriveKey(secret: string, context: string): Buffer {
  return createHash("sha256").update(context).update(":").update(secret).digest();
}

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

// ---------------------------------------------------------------------------
// Keyed-hash ring (HASH_KEYS `kid:secret,…`, first = active; HASH_KEY is kid `h1`) — contract C9
// ---------------------------------------------------------------------------

interface HashKey {
  kid: string;
  key: Buffer;
}
let hashSource: unknown = null;
let hashKeys: HashKey[] = [];

/** The derived hash keys, active first; rebuilt when `config.HASH_KEY_RING` is replaced (tests swap it to simulate a rotation). */
function hashRing(): HashKey[] {
  const source = config.HASH_KEY_RING;
  if (hashSource === source && hashKeys.length > 0) return hashKeys;
  hashKeys = source.map((k) => ({ kid: k.kid, key: deriveKey(k.secret, "kkt-hash-v1") }));
  if (hashKeys.length === 0) throw new Error("keyed-hash key ring is empty");
  hashSource = source;
  return hashKeys;
}

/** Key id new keyed hashes are written with (the first entry of the ring). */
export function activeHashKeyId(): string {
  return hashRing()[0]!.kid;
}

/**
 * Keyed hash (HMAC-SHA256, active key) for duplicate detection on encrypted identifiers (PAN, Aadhaar). Input is canonicalised by the
 * caller. Every new write stores this value; lookups use keyedHashes() so rows hashed under an older key are still found.
 */
export function keyedHash(value: string): string {
  return createHmac("sha256", hashRing()[0]!.key).update(value).digest("hex");
}

/** The keyed hash of `value` under every configured key, active first (lookups and duplicate checks during a HASH_KEYS rotation). */
export function keyedHashes(value: string): string[] {
  return [...new Set(hashRing().map((k) => createHmac("sha256", k.key).update(value).digest("hex")))];
}

/** True when `candidate` is the keyed hash (or its first `prefixLength` hex chars) of `value` under any configured key (constant time). */
export function keyedHashMatches(value: string, candidate: string, prefixLength?: number): boolean {
  let ok = false;
  for (const h of keyedHashes(value)) if (safeEqual(prefixLength ? h.slice(0, prefixLength) : h, candidate)) ok = true;
  return ok;
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

// ---------------------------------------------------------------------------
// Link-signing ring (LINK_SIGNING_KEYS `kid:secret,…`, first = active) — contract C9
// ---------------------------------------------------------------------------

/** One derived link key: HMAC-SHA256 key for one token family (`label`) under one ring entry. */
export interface LinkKey {
  kid: string;
  key: Buffer;
}

let linkSource: string | null = null;
const linkKeyCache = new Map<string, LinkKey[]>();

/**
 * The link-signing ring, active first (contract C9): LINK_SIGNING_KEYS, else — outside production only, where config allows it to be
 * unset — JWT_SECRET followed by JWT_PREVIOUS_SECRETS (kid `j<fingerprint>`): the very HMAC keys links were signed with before the ring.
 */
export function linkKeyRing(): readonly { kid: string; secret: string }[] {
  if (config.LINK_SIGNING_KEYS.length > 0) return config.LINK_SIGNING_KEYS;
  // kid = a fingerprint of the secret, so a link keeps naming its key when JWT_SECRET rotates into JWT_PREVIOUS_SECRETS
  return [config.JWT_SECRET, ...config.JWT_PREVIOUS_SECRETS].map((secret) => ({
    kid: `j${createHash("sha256").update("kkt-link-kid:").update(secret).digest("hex").slice(0, 8)}`,
    secret,
  }));
}

/**
 * The HMAC keys of one link family (`label`, e.g. `kkt-files-v1`, `kkt-export-link-v1`), active first. Each key is
 * SHA-256(`<label>:<secret>`) — the derivation the file, export and backup links have always used, so with the derived non-production
 * ring (JWT_SECRET first) existing links keep verifying.
 */
export function linkKeys(label: string): LinkKey[] {
  const ring = linkKeyRing();
  const source = ring.map((k) => `${k.kid}\u0000${k.secret}`).join("\u0001");
  if (linkSource !== source) {
    linkKeyCache.clear();
    linkSource = source;
  }
  let keys = linkKeyCache.get(label);
  if (!keys) {
    keys = ring.map((k) => ({ kid: k.kid, key: deriveKey(k.secret, label) }));
    if (keys.length === 0) throw new Error("link-signing key ring is empty");
    linkKeyCache.set(label, keys);
  }
  return keys;
}

/** The active link key of a family. */
export function activeLinkKey(label: string): LinkKey {
  return linkKeys(label)[0]!;
}

const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Signs a compact binary link body: `<kid>.<base64url body>.<base64url HMAC(kid "." body) truncated to sigBytes>`. The kid names the
 * ring key, so a rotation keeps older links verifiable for as long as their key stays configured.
 */
export function signLinkBody(label: string, body: Buffer, sigBytes = 16): string {
  const { kid, key } = activeLinkKey(label);
  const b = body.toString("base64url");
  const sig = createHmac("sha256", key).update(`${kid}.${b}`).digest().subarray(0, sigBytes).toString("base64url");
  return `${kid}.${b}.${sig}`;
}

/**
 * Verifies a token from signLinkBody (or a legacy kid-less `<body>.<sig>` compact token — MAC over the raw body bytes, as the file,
 * export and backup links were signed before the ring — tried against every ring key)
 * and returns its body; null when malformed or forged. Compared in constant time over the canonical re-encoding.
 */
export function verifyLinkBody(label: string, token: string, sigBytes = 16): Buffer | null {
  const parts = token.split(".");
  if (parts.length === 3) {
    const [kid, b, sig] = parts as [string, string, string];
    if (!KID_RE.test(kid) || !/^[A-Za-z0-9_-]+$/.test(b) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
    const key = linkKeys(label).find((k) => k.kid === kid);
    if (!key) return null;
    const body = Buffer.from(b, "base64url");
    if (body.toString("base64url") !== b) return null;
    const expected = createHmac("sha256", key.key)
      .update(`${kid}.${b}`)
      .digest()
      .subarray(0, sigBytes)
      .toString("base64url");
    return safeEqual(expected, sig) ? body : null;
  }
  if (parts.length === 2) {
    const [b, sig] = parts as [string, string];
    if (!/^[A-Za-z0-9_-]+$/.test(b) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
    const body = Buffer.from(b, "base64url");
    if (body.toString("base64url") !== b) return null;
    let ok = false;
    for (const k of linkKeys(label)) {
      const expected = createHmac("sha256", k.key).update(body).digest().subarray(0, sigBytes).toString("base64url");
      if (safeEqual(expected, sig)) ok = true;
    }
    return ok ? body : null;
  }
  return null;
}

/** Link family of the generic signed payloads below (MFA step tokens, visitor tokens, manage links). */
const PAYLOAD_LABEL = "kkt-sign-v1";
/** Payload key carrying the link-signing kid (inside the signed JSON, so the token keeps its `<payload>.<sig>` shape). */
const PAYLOAD_KID = "_k";

/**
 * Sign a short-lived JSON payload (MFA step tokens, visitor tokens): `<payload>.<sig>` in base64url, HMAC-SHA256 under the active
 * LINK_SIGNING_KEYS key over the payload text. The kid travels inside the signed payload (`_k`), so the token format is the one clients
 * and the website honeypot have always seen.
 */
export function signPayload(payload: Record<string, string | number>, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const { kid, key } = activeLinkKey(PAYLOAD_LABEL);
  const body = Buffer.from(JSON.stringify({ ...payload, exp, [PAYLOAD_KID]: kid })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

/**
 * Verify a signed payload with the ring key its `_k` names (a payload without one — signed before the ring — is tried against every
 * configured key). Returns the payload without `_k`, or null when forged, expired or signed by a key that is no longer configured.
 */
export function verifyPayload<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let data: (T & { exp: number; [PAYLOAD_KID]?: unknown }) | null;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const named = data[PAYLOAD_KID];
  const keys = linkKeys(PAYLOAD_LABEL).filter((k) => (typeof named === "string" ? k.kid === named : true));
  let valid = false;
  for (const k of keys) if (safeEqual(createHmac("sha256", k.key).update(body).digest("base64url"), sig)) valid = true;
  if (!valid) return null;
  if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
  const { [PAYLOAD_KID]: _kid, ...rest } = data;
  return rest as T & { exp: number };
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a),
    bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
