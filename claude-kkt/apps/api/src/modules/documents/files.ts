/**
 * Large generated files (async CSV exports, backup archives) are written to a local temp file first and then handed to the object
 * storage. When the storage driver can take a stream or a file path (`putFile` / `putStream`, e.g. the S3 multipart adapter) the bytes are
 * never held in memory; the plain `put(Buffer)` interface is the fallback.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Storage } from "../../lib/storage.js";

/** Optional streaming capabilities a storage driver may offer on top of {@link Storage}. */
interface StreamingStorage {
  putFile?: (key: string, path: string, contentType: string) => Promise<void>;
  putStream?: (key: string, body: Readable, contentType: string) => Promise<void>;
}

/** Stores the file at `path` under `key`, streaming when the driver supports it. */
export async function storeFile(store: Storage, key: string, path: string, contentType: string): Promise<void> {
  const s = store as Storage & StreamingStorage;
  if (typeof s.putFile === "function") return s.putFile(key, path, contentType);
  if (typeof s.putStream === "function") return s.putStream(key, createReadStream(path), contentType);
  await store.put(key, await readFile(path), contentType);
}

/** Runs `fn` with a fresh private temp directory that is always removed afterwards. */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `kkt-${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Compact signed download token for a generated file (53 chars, fits Fastify's default 100-char param limit):
 * base64url(file id 16 B + exp 6 B) . base64url(HMAC-SHA256(label key)[0..16)). `label` separates token families (exports, backups).
 */
export function signFileToken(secret: Buffer, id: string, exp: number): string {
  const body = Buffer.alloc(22);
  Buffer.from(id.replace(/-/g, ""), "hex").copy(body, 0);
  body.writeUIntBE(Math.max(0, Math.min(exp, 2 ** 48 - 1)), 16, 6);
  const sig = createHmac("sha256", secret).update(body).digest().subarray(0, 16);
  return `${body.toString("base64url")}.${sig.toString("base64url")}`;
}

const FILE_TOKEN_RE = /^[A-Za-z0-9_-]{30}\.[A-Za-z0-9_-]{22}$/;

/** File id of a valid, unexpired token; null when malformed, forged or expired (compared whole in constant time). */
export function verifyFileToken(secret: Buffer, token: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  if (!FILE_TOKEN_RE.test(token)) return null;
  const body = Buffer.from(token.slice(0, token.indexOf(".")), "base64url");
  if (body.length !== 22) return null;
  const hex = body.subarray(0, 16).toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const exp = body.readUIntBE(16, 6);
  const expected = Buffer.from(signFileToken(secret, id, exp));
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (exp < nowSeconds) return null;
  return id;
}

/** HMAC key of one token family, derived from JWT_SECRET with its own context label. */
export function fileTokenKey(label: string, jwtSecret: string): Buffer {
  return createHash("sha256").update(`${label}:`).update(jwtSecret).digest();
}
