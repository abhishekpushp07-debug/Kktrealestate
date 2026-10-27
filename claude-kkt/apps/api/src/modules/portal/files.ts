/**
 * Portal file links (SPEC §16 "no internal ids or storage paths leak", §18 scenario 10 "a buyer cannot access another buyer's booking or
 * PDFs"). Every file the portal links to — generated PDFs (receipt, demand letter, statement, allotment letter), shared documents, floor
 * plans, construction photos, request attachments — is served by `GET /api/v1/portal/files/:token` through a signed, 15-minute token that
 * is BOUND TO THE CUSTOMER it was issued to: the token carries the customer id under the HMAC, and the stream endpoint refuses the link
 * (404, like every other ownership failure) when the request carries a portal bearer token of anybody else, a staff token, or a token that
 * does not verify. A request without a bearer is served, because PDF viewers and native share sheets open links without headers; the
 * 15-minute HMAC link is the credential there. Documents-module `/files/:token` links are NOT accepted here (they carry no customer).
 *
 * Generated PDFs have no document row: they are rendered when the customer asks for the link, written to object storage under a temporary
 * key, indexed in Redis for 15 minutes and swept when expired (opportunistically on every new link and as the PORTAL_FILE_CLEANUP job).
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import type { DocumentVariant, JobName, PortalPdfLinkResponse } from "@kkt/contracts";
import { documents, type Executor } from "@kkt/db";
import type { Redis } from "ioredis";
import { config } from "../../config.js";
import { registerJob } from "../../jobs/index.js";
import { signLinkBody, verifyLinkBody } from "../../lib/crypto.js";
import {
  SIGNED_LINK_TTL_SECONDS,
  documentStorage as storage,
  streamDocument,
  type DocumentStream,
} from "../documents/index.js";

/** Lifetime of a portal file link (SPEC §2/§13: short-lived, 15 minutes). */
export const PORTAL_FILE_TTL_SECONDS = SIGNED_LINK_TTL_SECONDS;
/** Job that removes expired temporary portal files. Not yet part of the contracts JOB_NAMES enum — see the module report. */
export const PORTAL_FILE_CLEANUP_JOB = "PORTAL_FILE_CLEANUP" as JobName;

const META_KEY = (id: string) => `portal:file:${id}`;
/** Sorted set of temporary file ids scored by their expiry (ms); the cleanup sweep pops everything below "now". */
const EXPIRY_ZSET = "portal:files:expiry";

/** What a portal token points at: a generated temp file or a stored document rendition. */
export type PortalFileKind = "TEMP" | "DOCUMENT";
const KIND_CODES: readonly PortalFileKind[] = ["TEMP", "DOCUMENT"];
const VARIANT_CODES: readonly DocumentVariant[] = ["original", "thumb", "medium"];
/** kind (1) ‖ customer id (16) ‖ ref id (16) ‖ variant (1) ‖ expiry seconds (48-bit). */
const TOKEN_BODY_BYTES = 1 + 16 + 16 + 1 + 6;
const TOKEN_SIG_BYTES = 16; // HMAC-SHA256 truncated to 128 bits
/**
 * Key family of portal file tokens on the LINK_SIGNING_KEYS ring (contract C9): `<kid>.<body>.<sig>`, signed by the active key and
 * verified by kid, so a key rotation keeps issued links valid while their key stays configured (tokens live 15 minutes). The label
 * separates them from every other signed link (a token can never pass as another signed payload).
 */
export const PORTAL_FILE_LINK_LABEL = "kkt-portal-files-v3";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decoded, verified portal file token. */
export interface PortalFileToken {
  kind: PortalFileKind;
  /** The customer the link was issued to; the stream endpoint refuses any other authenticated viewer. */
  customerId: string;
  /** Temp file id (TEMP) or document id (DOCUMENT). */
  refId: string;
  variant: DocumentVariant;
  exp: number;
}

/** Metadata of a temporary file (the bytes live in object storage). */
export interface TempFileMeta {
  key: string;
  name: string;
  mime: string;
  size: number;
}

/** Storage key of a temporary portal file (uuid-based, never user supplied). */
export function tempKey(id: string, ext = "pdf"): string {
  return `portal-tmp/${id}.${ext}`;
}

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replace(/-/g, ""), "hex");
}

function uuidFromBytes(b: Buffer): string {
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeToken(t: PortalFileToken): string {
  const body = Buffer.alloc(TOKEN_BODY_BYTES);
  body[0] = KIND_CODES.indexOf(t.kind);
  uuidBytes(t.customerId).copy(body, 1);
  uuidBytes(t.refId).copy(body, 17);
  body[33] = VARIANT_CODES.indexOf(t.variant);
  body.writeUIntBE(Math.max(0, Math.min(t.exp, 2 ** 48 - 1)), 34, 6);
  return signLinkBody(PORTAL_FILE_LINK_LABEL, body, TOKEN_SIG_BYTES);
}

/** Signs a portal file token for a customer (exported for tests and the other portal screens). */
export function signPortalFile(
  customerId: string,
  kind: PortalFileKind,
  refId: string,
  variant: DocumentVariant = "original",
  ttlSeconds = PORTAL_FILE_TTL_SECONDS,
): { token: string; exp: number } {
  if (!UUID_RE.test(customerId) || !UUID_RE.test(refId)) throw new Error("portal file tokens need uuid ids");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { token: encodeToken({ kind, customerId, refId, variant, exp }), exp };
}

/**
 * Verifies a portal file token (ring key by kid, canonical encoding, constant-time comparison: lib/crypto.ts verifyLinkBody); null when
 * malformed, forged, signed by a key no longer in the ring, or expired.
 */
export function verifyPortalFileToken(token: string): PortalFileToken | null {
  if (token.split(".").length !== 3) return null; // ring tokens only (the pre-ring compact form expired with its 15 minutes)
  const body = verifyLinkBody(PORTAL_FILE_LINK_LABEL, token, TOKEN_SIG_BYTES);
  if (!body || body.length !== TOKEN_BODY_BYTES) return null;
  const kind = KIND_CODES[body[0]!];
  const variant = VARIANT_CODES[body[33]!];
  if (!kind || !variant) return null;
  const decoded: PortalFileToken = {
    kind,
    customerId: uuidFromBytes(body.subarray(1, 17)),
    refId: uuidFromBytes(body.subarray(17, 33)),
    variant,
    exp: body.readUIntBE(34, 6),
  };
  if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
}

/** Verifies a temp-file token (kept for callers that only deal with generated PDFs); null for anything else. */
export function verifyTempToken(token: string): { id: string; exp: number; customerId: string } | null {
  const t = verifyPortalFileToken(token);
  return t && t.kind === "TEMP" ? { id: t.refId, exp: t.exp, customerId: t.customerId } : null;
}

/** URL of the portal stream endpoint for a token. */
export function portalFileUrl(token: string): string {
  return `${config.API_PUBLIC_URL}/api/v1/portal/files/${token}`;
}

/** Signed, customer-bound, 15-minute link to a stored document rendition (shared documents, floor plans, construction photos, attachments). */
export function portalDocumentUrl(
  customerId: string,
  documentId: string,
  variant: DocumentVariant = "original",
  ttlSeconds = PORTAL_FILE_TTL_SECONDS,
): { url: string; expires_at: string } {
  const { token, exp } = signPortalFile(customerId, "DOCUMENT", documentId, variant, ttlSeconds);
  return { url: portalFileUrl(token), expires_at: new Date(exp * 1000).toISOString() };
}

/**
 * Stores generated bytes under a temporary key, indexes them in Redis for the link lifetime and returns the signed link bound to the
 * customer. Expired objects from earlier links are swept in the same call (best effort), so storage never grows without a worker.
 */
export async function storeTempFile(
  redis: Redis,
  customerId: string,
  file: { bytes: Buffer; filename: string; mime?: string },
  ttlSeconds = PORTAL_FILE_TTL_SECONDS,
): Promise<PortalPdfLinkResponse> {
  const id = randomUUID();
  const mime = file.mime ?? "application/pdf";
  const key = tempKey(id, mime === "application/pdf" ? "pdf" : "bin");
  await storage().put(key, file.bytes, mime);
  const { token, exp } = signPortalFile(customerId, "TEMP", id, "original", ttlSeconds);
  const meta: TempFileMeta = { key, name: file.filename, mime, size: file.bytes.length };
  try {
    await redis.set(META_KEY(id), JSON.stringify(meta), "EX", ttlSeconds + 60);
    await redis.zadd(EXPIRY_ZSET, exp * 1000, id);
  } catch (err) {
    await storage()
      .remove(key)
      .catch(() => undefined);
    throw err;
  }
  void cleanupExpiredTempFiles(redis).catch(() => undefined);
  return {
    download_url: portalFileUrl(token),
    expires_at: new Date(exp * 1000).toISOString(),
    file_name: file.filename,
  };
}

/** Opens a temporary file by its verified token id; null when the link has expired or the object is gone. */
export async function openTempFile(redis: Redis, id: string): Promise<DocumentStream | null> {
  const raw = await redis.get(META_KEY(id));
  if (!raw) return null;
  const meta = JSON.parse(raw) as TempFileMeta;
  const store = storage();
  if (!(await store.exists(meta.key))) return null;
  const bytes = await store.get(meta.key);
  return { stream: Readable.from([bytes]), mime: meta.mime, size: bytes.length, fileName: meta.name };
}

/** The viewer of a stream request, as far as the (optional) bearer token proves it. */
export type PortalViewer = { customerId: string } | null;

/**
 * Resolves a verified portal file token to a stream. Null — the route answers 404 — when the link is for another customer than the
 * authenticated viewer, when a stored document has since been deleted or flagged sensitive, or when a temp file has been swept.
 */
export async function openPortalFile(
  db: Executor,
  redis: Redis,
  token: PortalFileToken,
  viewer: PortalViewer,
): Promise<DocumentStream | null> {
  if (viewer && viewer.customerId !== token.customerId) return null;
  if (token.kind === "TEMP") return openTempFile(redis, token.refId);
  const [doc] = await db
    .select({ sensitive: documents.isSensitive })
    .from(documents)
    .where(and(eq(documents.id, token.refId), eq(documents.isDeleted, false)))
    .limit(1);
  if (!doc || doc.sensitive) return null;
  return streamDocument(db, token.refId, token.variant);
}

/** Removes every temporary object whose link has expired (sorted-set sweep); returns how many were removed. */
export async function cleanupExpiredTempFiles(redis: Redis, now = Date.now()): Promise<number> {
  const ids = await redis.zrangebyscore(EXPIRY_ZSET, "-inf", now);
  if (ids.length === 0) return 0;
  const store = storage();
  let removed = 0;
  for (const id of ids) {
    const raw = await redis.get(META_KEY(id));
    const key = raw ? (JSON.parse(raw) as TempFileMeta).key : tempKey(id);
    await store.remove(key).catch(() => undefined);
    await redis.del(META_KEY(id)).catch(() => undefined);
    await redis.zrem(EXPIRY_ZSET, id);
    removed += 1;
  }
  return removed;
}

/** Registers the cleanup job with the core job registry (the handler needs Redis, which the job context does not carry; the app passes it). */
export function registerPortalJobs(redis: Redis): void {
  registerJob(PORTAL_FILE_CLEANUP_JOB, async () => ({ removed: await cleanupExpiredTempFiles(redis) }));
}
