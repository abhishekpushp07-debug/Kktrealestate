import type { FastifyRequest } from "fastify";
import type { ActorType } from "@kkt/contracts";
import { auditLogs, type Executor } from "@kkt/db";

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

const SENSITIVE_KEY = /(^|_)(password_hash|passwordhash|password|secret)$|_enc$|enc$|^mfa|^token|token$|refresh_token|access_token|otp/i;

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

/** Appends one immutable audit row inside the caller's transaction (sensitive keys stripped from before/after). */
export async function writeAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    companyId: entry.companyId,
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    actorName: entry.actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ? stripSensitive(entry.before) : null,
    after: entry.after ? stripSensitive(entry.after) : null,
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
