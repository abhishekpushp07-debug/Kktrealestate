import type { FastifyRequest } from "fastify";
import type { ActorType } from "@kkt/contracts";
import { auditLogs, type Executor } from "@kkt/db";
import { keyedHash } from "./crypto.js";

/** Who performed an audited action. */
export interface AuditActor {
  type: ActorType;
  id: string | null;
  name: string | null;
}

/** One audit entry. */
export interface AuditEntry {
  companyId: string;
  actor: AuditActor;
  /** `entity.verb`, e.g. `user.create`, `auth.login`. */
  action: string;
  entityType: string;
  entityId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  requestId?: string | null;
}

const SENSITIVE_KEY =
  /(^|_)(password_hash|passwordhash|password|secret)$|_enc$|enc$|^mfa|^token|token$|refresh_token|access_token|otp/i;

/** Returns true for keys whose values must never reach the audit log (hashes, encrypted fields, MFA material, tokens). */
export function isSensitiveKey(key: string): boolean {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_KEY.test(snake) || SENSITIVE_KEY.test(key);
}

/** Deep-copies a snapshot with sensitive keys removed and Dates rendered as ISO strings. */
export function stripSensitive<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripSensitive(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) continue;
      out[k] = stripSensitive(v);
    }
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// PII masking (DPDP): audit rows are immutable, so they must not hold more personal data than an investigation needs
// ---------------------------------------------------------------------------

/** Phone as `******3210` (last 4 digits); null for empty input. */
export function maskPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 4 ? `******${digits.slice(-4)}` : "******";
}

/** E-mail as `r***@g***.com` (first letter of the local part and of the domain, plus the top-level domain). */
export function maskEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const at = v.lastIndexOf("@");
  if (at <= 0) return "***";
  const domain = v.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${v[0]}***@${domain[0] ?? ""}***${tld}`;
}

/** PAN as `ABCDE****F` (the 5 letters and the final letter; the 4 digits hidden). */
export function maskPanForAudit(v: string | null | undefined): string | null {
  if (!v) return null;
  const clean = v.replace(/\s/g, "").toUpperCase();
  return clean.length === 10 ? `${clean.slice(0, 5)}****${clean.slice(9)}` : "**********";
}

/** Aadhaar / account numbers: only the last 4 digits. */
function maskLast4(v: string | null | undefined, prefix: string): string | null {
  if (!v) return null;
  const clean = v.replace(/\s/g, "");
  return `${prefix}${clean.slice(-4)}`;
}

type PiiKind = "phone" | "email" | "pan" | "aadhaar" | "account" | "redact";

/** PII fields of audit snapshots by (snake_case) key; `*_masked` keys are already masked and pass through. */
function piiKind(snakeKey: string): PiiKind | null {
  if (/(^|_)(phone|mobile|alt_phone|whatsapp)$/.test(snakeKey)) return "phone";
  if (/(^|_)email$/.test(snakeKey)) return "email";
  if (/(^|_)pan$/.test(snakeKey)) return "pan";
  if (/(^|_)aadhaar$/.test(snakeKey)) return "aadhaar";
  if (/(^|_)(account_number|bank_account_number|account_no)$/.test(snakeKey)) return "account";
  if (/(^|_)(address|address_current|address_permanent|dob|date_of_birth)$/.test(snakeKey)) return "redact";
  return null;
}

function maskPii(kind: PiiKind, value: unknown): unknown {
  if (kind === "redact") return "[redacted]";
  if (typeof value !== "string") return "[redacted]";
  switch (kind) {
    case "phone":
      return maskPhone(value);
    case "email":
      return maskEmail(value);
    case "pan":
      return maskPanForAudit(value);
    case "aadhaar":
      return maskLast4(value, "XXXX XXXX ");
    case "account":
      return maskLast4(value, "XXXXXXXX");
  }
}

/**
 * Keyed fingerprint of a PII value (HMAC under the HASH_KEYS ring, 16 hex): the same value always gives the same fingerprint, so an
 * investigator can still see THAT a phone or PAN changed between two snapshots without the log storing it.
 */
export function piiFingerprint(key: string, value: unknown): string {
  return keyedHash(`audit-pii:${key}:${JSON.stringify(value)}`).slice(0, 16);
}

/**
 * The audit form of a snapshot: sensitive keys removed (stripSensitive) and PII masked — phone `******3210`, e-mail `r***@g***.com`, PAN
 * `ABCDE****F`, Aadhaar / account numbers last 4, addresses and dates of birth `[redacted]` — each masked field with a sibling
 * `<key>_fp` keyed fingerprint so changes stay detectable.
 */
export function redactForAudit<T>(value: T): T {
  const stripped = stripSensitive(value);
  return maskTree(stripped) as T;
}

function maskTree(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskTree);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const kind = piiKind(k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
    if (kind && v !== null && v !== undefined && v !== "") {
      out[k] = maskPii(kind, v);
      out[`${k}_fp`] = piiFingerprint(k, v);
    } else out[k] = kind ? v : maskTree(v);
  }
  return out;
}

/** Appends one immutable audit row inside the caller's transaction (sensitive keys stripped, PII masked in before/after). */
export async function writeAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    companyId: entry.companyId,
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    actorName: entry.actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ? redactForAudit(entry.before) : null,
    after: entry.after ? redactForAudit(entry.after) : null,
    ip: entry.ip ?? null,
    requestId: entry.requestId ?? null,
  });
}

/** The actor behind a request: staff user, portal customer, or SYSTEM when unauthenticated (login attempts, jobs). */
export function actorFromRequest(req: FastifyRequest): AuditActor {
  if (req.user) return { type: "STAFF", id: req.user.id, name: req.user.name };
  if (req.customer) return { type: "CUSTOMER", id: req.customer.customerId, name: req.customer.name };
  return { type: "SYSTEM", id: null, name: null };
}

/** Request metadata (ip, request id) for audit rows. */
export function auditMeta(req: FastifyRequest): { ip: string; requestId: string } {
  return { ip: req.clientIp, requestId: req.id };
}

/** The SYSTEM actor used by jobs and the seed. */
export const SYSTEM_ACTOR: AuditActor = { type: "SYSTEM", id: null, name: "system" };
