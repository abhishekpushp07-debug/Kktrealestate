/**
 * Flat holds (SPEC §4, §12; audit G "expired holds are never released"): the HOLD_EXPIRY job releases every HOLD whose hold_until has
 * passed (audit row, unit counts, a bell for the holder), and the booking wizard's short reservation (POST /flats/:id/reserve) /
 * release (POST /flats/:id/release). Until the job runs, a lapsed hold already reads as AVAILABLE (domain isHoldExpired) for the
 * booking engine, the manual status change and the reserve route.
 */
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { flats, users, type DB, type Tx } from "@kkt/db";
import { isHoldExpired, reserveUntil } from "@kkt/domain";
import { SYSTEM_ACTOR, writeAudit, type AuditActor } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import type { StaffContext } from "../../lib/scope.js";
import { notify } from "../notifications/index.js";
import { loadFlat, refreshUnitCounts, type DbFlat } from "./service.js";

/** Audit metadata of the caller (request) or the job. */
export interface HoldActor {
  actor: AuditActor;
  ip?: string | null;
  requestId?: string | null;
}

/** Releases one lapsed hold inside `tx` (the flat row is locked by the caller and re-checked here). Returns false when it is no longer a lapsed HOLD. */
async function releaseLapsed(tx: Tx, flat: DbFlat, now: Date, meta: HoldActor): Promise<boolean> {
  if (!isHoldExpired(flat, now)) return false;
  await tx
    .update(flats)
    .set({
      status: "AVAILABLE",
      holdByUserId: null,
      holdUntil: null,
      statusChangedAt: now,
      statusChangedBy: null,
      version: flat.version + 1,
    })
    .where(eq(flats.id, flat.id));
  await writeAudit(tx, {
    companyId: flat.companyId,
    actor: meta.actor,
    action: "flat.hold_expired",
    entityType: "flat",
    entityId: flat.id,
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
    before: { status: "HOLD", hold_by_user_id: flat.holdByUserId, hold_until: flat.holdUntil?.toISOString() ?? null },
    after: { status: "AVAILABLE", flat_number: flat.flatNumber, reason: "Hold lapsed" },
  });
  await refreshUnitCounts(tx, flat.blockId);
  if (flat.holdByUserId) {
    await notify(tx, {
      companyId: flat.companyId,
      recipients: [{ type: "STAFF", id: flat.holdByUserId }],
      type: "HOLD_EXPIRED",
      title: `Hold on flat ${flat.flatNumber} lapsed`,
      body: `Held until ${flat.holdUntil?.toISOString() ?? "—"}; the flat is available again.`,
      entityType: "flat",
      entityId: flat.id,
      link: `/inventory/flats/${flat.id}`,
    });
  }
  return true;
}

/**
 * HOLD_EXPIRY job body: every HOLD with hold_until ≤ now, one short transaction per flat (row lock, re-check, release). A flat that
 * was booked / re-held / released meanwhile is skipped. Lock order flat → block (refreshUnitCounts) like every flat status change.
 */
export async function releaseExpiredHolds(
  db: DB,
  now: Date = new Date(),
): Promise<{ released: number; flat_numbers: string[]; checked: number }> {
  const due = await db
    .select({ id: flats.id })
    .from(flats)
    .where(and(eq(flats.status, "HOLD"), isNotNull(flats.holdUntil), lte(flats.holdUntil, now)))
    .orderBy(asc(flats.holdUntil), asc(flats.id))
    .limit(5000);
  const released: string[] = [];
  for (const { id } of due) {
    const n = await db.transaction(async (tx) => {
      const [flat] = await tx.select().from(flats).where(eq(flats.id, id)).limit(1).for("update");
      if (!flat) return null;
      return (await releaseLapsed(tx, flat, now, { actor: SYSTEM_ACTOR })) ? flat.flatNumber : null;
    });
    if (n) released.push(n);
  }
  return { released: released.length, flat_numbers: released, checked: due.length };
}

/**
 * POST /flats/:id/reserve — the booking wizard's short hold (1–30 minutes, booking.create). AVAILABLE, or a lapsed HOLD → HOLD by the
 * caller until now + minutes. The caller's own live hold is extended (idempotent: repeating it never fails). A live hold by someone
 * else, or BLOCKED / BOOKED / SOLD → 409 FLAT_NOT_AVAILABLE.
 */
export async function reserveFlat(
  tx: Tx,
  user: StaffContext,
  flatId: string,
  minutes: number,
  meta: HoldActor,
  now: Date = new Date(),
): Promise<void> {
  const flat = await loadFlat(tx, user, flatId, true);
  const own = flat.status === "HOLD" && flat.holdByUserId === user.id;
  const free = flat.status === "AVAILABLE" || (flat.status === "HOLD" && isHoldExpired(flat, now));
  if (!own && !free) {
    const [holder] =
      flat.status === "HOLD" && flat.holdByUserId
        ? await tx.select({ name: users.name }).from(users).where(eq(users.id, flat.holdByUserId)).limit(1)
        : [];
    throw ApiError.conflict(
      "FLAT_NOT_AVAILABLE",
      `Flat ${flat.flatNumber} is ${flat.status.toLowerCase()}${holder ? ` (held by ${holder.name} until ${flat.holdUntil?.toISOString() ?? "—"})` : ""}; it cannot be reserved`,
      {
        flat_id: flat.id,
        current_status: flat.status,
        booking_number: null,
        hold_by_user_id: flat.status === "HOLD" ? flat.holdByUserId : null,
        hold_until: flat.status === "HOLD" ? (flat.holdUntil?.toISOString() ?? null) : null,
      },
    );
  }
  let until: Date;
  try {
    until = reserveUntil(minutes, now);
  } catch {
    throw ApiError.invalid("minutes", "minutes must be 1–30");
  }
  // an own longer hold (e.g. the 48 h manual hold) is never shortened by a wizard reservation
  if (own && flat.holdUntil && flat.holdUntil.getTime() > until.getTime()) until = flat.holdUntil;
  await tx
    .update(flats)
    .set({
      status: "HOLD",
      holdByUserId: user.id,
      holdUntil: until,
      statusChangedAt: now,
      statusChangedBy: user.id,
      version: flat.version + 1,
    })
    .where(eq(flats.id, flat.id));
  await writeAudit(tx, {
    companyId: flat.companyId,
    actor: meta.actor,
    action: own ? "flat.reserve_extend" : "flat.reserve",
    entityType: "flat",
    entityId: flat.id,
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
    before: {
      status: flat.status,
      hold_by_user_id: flat.holdByUserId,
      hold_until: flat.holdUntil?.toISOString() ?? null,
    },
    after: {
      status: "HOLD",
      hold_by_user_id: user.id,
      hold_until: until.toISOString(),
      minutes,
      flat_number: flat.flatNumber,
    },
  });
  if (!own) await refreshUnitCounts(tx, flat.blockId);
}

/** POST /flats/:id/release — the holder, or settings.manage (a lapsed hold may be released by anybody with booking.create). */
export async function releaseFlat(
  tx: Tx,
  user: StaffContext,
  flatId: string,
  reason: string | null | undefined,
  meta: HoldActor,
  now: Date = new Date(),
): Promise<void> {
  const flat = await loadFlat(tx, user, flatId, true);
  if (flat.status !== "HOLD")
    throw ApiError.rule(`Flat ${flat.flatNumber} is ${flat.status}, not on hold`, "NOT_ON_HOLD", {
      status: flat.status,
    });
  const mine = flat.holdByUserId === user.id;
  if (!mine && !user.permissions.has("settings.manage") && !isHoldExpired(flat, now)) {
    throw ApiError.forbidden("This flat is on hold by another user; releasing it needs settings.manage", {
      permission: "settings.manage",
      hold_by_user_id: flat.holdByUserId,
    });
  }
  await tx
    .update(flats)
    .set({
      status: "AVAILABLE",
      holdByUserId: null,
      holdUntil: null,
      statusChangedAt: now,
      statusChangedBy: user.id,
      version: flat.version + 1,
    })
    .where(eq(flats.id, flat.id));
  await writeAudit(tx, {
    companyId: flat.companyId,
    actor: meta.actor,
    action: "flat.release",
    entityType: "flat",
    entityId: flat.id,
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
    before: { status: "HOLD", hold_by_user_id: flat.holdByUserId, hold_until: flat.holdUntil?.toISOString() ?? null },
    after: { status: "AVAILABLE", reason: reason ?? null, flat_number: flat.flatNumber },
  });
  await refreshUnitCounts(tx, flat.blockId);
}
