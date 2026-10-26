import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  FlatDetailResponseSchema, FlatFilterSchema, FlatListResponseSchema, FlatPriceUpdateSchema, FlatReleaseSchema, FlatReserveSchema, FlatRowSchema, FlatStatusChangeSchema, FlatStatusSchema, FlatTypeChangeSchema, FlatUpdateSchema, IdSchema, VersionSchema,
  type FlatRow, type FlatStatus,
} from "@kkt/contracts";
import { isHoldExpired } from "@kkt/domain";
import { auditLogs, blocks, bookings, customers, flatTypes, flats, parkingSlots, specCategories, specItems, users, type Executor } from "@kkt/db";
import { writeAudit, type AuditEntry } from "../../lib/audit.js";
import { loadCompany } from "../../lib/company.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { route } from "../../lib/routes.js";
import { scopeFilter, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, withOptionalVersion } from "../../lib/version.js";
import { releaseFlat, reserveFlat } from "./holds.js";
import { assertFilterScope } from "./projects.js";
import {
  ENGINE_STATUSES, areasToDb, areasToDomain, breakupToDb, flatTypeToDomain, loadActiveRateCard, loadFlat, meta, priceWith, refreshUnitCounts, roomsToDb, roomsToDomain, type DbFlat,
} from "./service.js";

const idParams = z.object({ id: IdSchema });

/** Join shape used by every flat read. */
export interface FlatSelect { flat: DbFlat; blockName: string; flatTypeName: string; bhk: number | null; bookingNumber: string | null; customerName: string | null; holdByName: string | null }

export const FLAT_SELECT = { flat: flats, blockName: blocks.name, flatTypeName: flatTypes.name, bhk: flatTypes.bhk, bookingNumber: bookings.bookingNumber, customerName: customers.fullName, holdByName: users.name };

/** Joins for FLAT_SELECT (blocks, flat types, booking + customer, hold user). */
export function flatJoins(q: PgSelect): PgSelect {
  return q.innerJoin(blocks, eq(blocks.id, flats.blockId)).innerJoin(flatTypes, eq(flatTypes.id, flats.flatTypeId)).leftJoin(bookings, eq(bookings.id, flats.bookingId)).leftJoin(customers, eq(customers.id, bookings.customerId)).leftJoin(users, eq(users.id, flats.holdByUserId));
}

/** Hydrates joined flat rows into the wire shape; parking numbers are fetched in one batch. */
export async function toFlatRows(db: Executor, rows: readonly FlatSelect[]): Promise<FlatRow[]> {
  const bookingIds = [...new Set(rows.map((r) => r.flat.bookingId).filter((b): b is string => b !== null))];
  const parking = bookingIds.length ? await db.select({ bookingId: parkingSlots.bookingId, number: parkingSlots.number }).from(parkingSlots).where(inArray(parkingSlots.bookingId, bookingIds)).orderBy(asc(parkingSlots.number)) : [];
  const byBooking = new Map<string, string[]>();
  for (const p of parking) if (p.bookingId) byBooking.set(p.bookingId, [...(byBooking.get(p.bookingId) ?? []), p.number]);
  return rows.map(({ flat: f, blockName, flatTypeName, bhk, bookingNumber, customerName, holdByName }) => ({
    id: f.id, company_id: f.companyId, created_at: f.createdAt.toISOString(), updated_at: f.updatedAt.toISOString(), created_by: f.createdBy, version: f.version,
    project_id: f.projectId, block_id: f.blockId, block_name: blockName, flat_number: f.flatNumber, floor: f.floor, floor_label: f.floorLabel ?? String(f.floor), position: f.position,
    flat_type_id: f.flatTypeId, flat_type_code: f.flatTypeCode, flat_type_name: flatTypeName, bhk: Number(bhk ?? 0), facing: f.facing, is_corner: f.isCorner, status: f.status,
    rooms_snapshot: f.roomsSnapshot.map((r) => ({ room_type_id: r.room_type_id, room_type_name: r.room_type_name, label: r.label, length_ft: Number(r.length_ft), width_ft: Number(r.width_ft), sqft: Number(r.sqft) })),
    areas_snapshot: f.areasSnapshot.map((a) => ({ area_type_id: a.area_type_id, area_type_code: a.area_type_code, area_type_name: a.area_type_name, sqft: Number(a.sqft) })),
    carpet_sqft: Number(f.carpetSqft), builtup_sqft: Number(f.builtupSqft), super_builtup_sqft: Number(f.superBuiltupSqft),
    rate_per_sqft_paise: f.ratePerSqftPaise, price_paise: f.pricePaise, price_breakup: f.priceBreakup.map((l) => ({ label: l.label, amount_paise: Number(l.amount_paise) })),
    rate_card_id: f.rateCardId, booking_id: f.bookingId, booking_number: bookingNumber, customer_name: customerName, parking_slot_numbers: f.bookingId ? (byBooking.get(f.bookingId) ?? []) : [],
    hold_by_user_id: f.holdByUserId, hold_by_name: holdByName, hold_until: f.holdUntil ? f.holdUntil.toISOString() : null,
    status_changed_at: f.statusChangedAt ? f.statusChangedAt.toISOString() : null, status_changed_by: f.statusChangedBy, notes: f.notes,
  }));
}

/** One flat in wire shape (scoped 404). */
export async function getFlatRow(db: Executor, user: StaffContext, id: string): Promise<FlatRow> {
  await loadFlat(db, user, id);
  const rows = (await flatJoins(db.select(FLAT_SELECT).from(flats).$dynamic()).where(eq(flats.id, id)).limit(1)) as unknown as FlatSelect[];
  const [row] = await toFlatRows(db, rows);
  if (!row) throw ApiError.notFound("Flat");
  return row;
}

/** Specifications of the flat's type (category + item), ordered. */
async function specificationsOf(db: Executor, flatTypeId: string): Promise<{ category: string; name: string; description: string | null }[]> {
  const [ft] = await db.select({ ids: flatTypes.specItemIds }).from(flatTypes).where(eq(flatTypes.id, flatTypeId)).limit(1);
  const ids = ft?.ids ?? [];
  if (ids.length === 0) return [];
  const rows = await db.select({ category: specCategories.name, catOrder: specCategories.sortOrder, name: specItems.name, description: specItems.description, order: specItems.sortOrder })
    .from(specItems).innerJoin(specCategories, eq(specCategories.id, specItems.categoryId)).where(inArray(specItems.id, ids)).orderBy(asc(specCategories.sortOrder), asc(specItems.sortOrder), asc(specItems.name));
  return rows.map((r) => ({ category: r.category, name: r.name, description: r.description }));
}

/** Last 100 audit entries of a flat. */
async function historyOf(db: Executor, flatId: string) {
  const rows = await db.select({ at: auditLogs.createdAt, actorName: auditLogs.actorName, action: auditLogs.action, before: auditLogs.before, after: auditLogs.after })
    .from(auditLogs).where(and(eq(auditLogs.entityType, "flat"), eq(auditLogs.entityId, flatId))).orderBy(desc(auditLogs.createdAt)).limit(100);
  return rows.map((r) => ({ at: r.at.toISOString(), actor_name: r.actorName, action: r.action, before: (r.before as Record<string, unknown> | null) ?? null, after: (r.after as Record<string, unknown> | null) ?? null }));
}

/** Default hold length from company settings (booking_hold_hours). */
export async function defaultHoldUntil(app: FastifyInstance, companyId: string): Promise<Date> {
  const company = await loadCompany(app.db, app.redis, companyId);
  const hours = Number(company.settings.booking_hold_hours ?? 48);
  return new Date(Date.now() + hours * 3600_000);
}

export interface StatusChangeInput { status: FlatStatus; reason?: string | null; holdUntil: Date | null }

/** 400 when an explicit hold_until is not a future instant (a hold that has already expired makes no sense). */
export function assertHoldUntil(holdUntil: Date | null): void {
  if (holdUntil === null) return;
  if (Number.isNaN(holdUntil.getTime()) || holdUntil.getTime() <= Date.now()) throw ApiError.badRequest("hold_until must be in the future", { field: "hold_until" });
}

/**
 * Validates a manual status change (AVAILABLE ↔ HOLD ↔ BLOCKED). BOOKED/SOLD are owned by the booking engine (422 whether as target or as current state).
 * Releasing another user's HOLD needs settings.manage (403). Returns the column changes to apply.
 */
export function manualStatusChanges(user: StaffContext, flat: DbFlat, input: StatusChangeInput): Record<string, unknown> {
  if (ENGINE_STATUSES.has(input.status)) throw ApiError.rule(`Status ${input.status} is set only by the booking engine`, "ENGINE_STATUS", { status: input.status });
  if (ENGINE_STATUSES.has(flat.status)) throw ApiError.rule(`Flat ${flat.flatNumber} is ${flat.status}; its status is set only by the booking engine`, "ENGINE_STATUS", { status: flat.status });
  // a lapsed hold (hold_until passed) no longer belongs to anybody: any flat.status holder may change it
  if (flat.status === "HOLD" && flat.holdByUserId && flat.holdByUserId !== user.id && !user.permissions.has("settings.manage") && !isHoldExpired(flat)) {
    throw ApiError.forbidden("This flat is on hold by another user; releasing it needs settings.manage", { permission: "settings.manage", hold_by_user_id: flat.holdByUserId });
  }
  if (flat.status === input.status && input.status !== "HOLD") throw ApiError.rule(`Flat ${flat.flatNumber} is already ${input.status}`, "NO_CHANGE");
  const now = new Date();
  return {
    status: input.status, statusChangedAt: now, statusChangedBy: user.id,
    holdByUserId: input.status === "HOLD" ? user.id : null,
    holdUntil: input.status === "HOLD" ? input.holdUntil : null,
    ...(input.reason ? { notes: input.reason } : {}),
  };
}

/** Audit entry for a status change. */
export function statusAudit(req: FastifyRequest, flat: DbFlat, after: { status: string; holdUntil: Date | null; holdByUserId: string | null }, reason: string | null | undefined): AuditEntry {
  return {
    companyId: flat.companyId, ...meta(req), action: "flat.status", entityType: "flat", entityId: flat.id,
    before: { status: flat.status, hold_by_user_id: flat.holdByUserId, hold_until: flat.holdUntil },
    after: { status: after.status, hold_by_user_id: after.holdByUserId, hold_until: after.holdUntil, reason: reason ?? null, flat_number: flat.flatNumber },
  };
}

/** Status change body: FlatStatusChangeSchema but accepting any FlatStatus so BOOKED/SOLD attempts answer 422 (SPEC §4), version optional (If-Match). */
const StatusBody = z.strictObject({ ...FlatStatusChangeSchema.shape, status: FlatStatusSchema, version: VersionSchema.optional() });
const PriceBody = withOptionalVersion(FlatPriceUpdateSchema);

const CSV = ["flat_number", "block_name", "floor", "position", "flat_type_code", "flat_type_name", "facing", "is_corner", "status", "carpet_sqft", "builtup_sqft", "super_builtup_sqft", "rate_per_sqft_paise", "price_paise", "booking_number", "customer_name", "hold_until", "notes", "version"];

/** Flat routes: list, detail, notes/price, status, flat-type change. */
export function registerFlatRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/flats", permission: "project.read",
    schema: { querystring: FlatFilterSchema, response: { 200: FlatListResponseSchema }, summary: "List flats (filters, search by number, CSV)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      assertFilterScope(user, q.project_id);
      const where: (SQL | undefined)[] = [eq(flats.companyId, user.companyId), scopeFilter(user, flats.projectId)];
      if (q.project_id) where.push(eq(flats.projectId, q.project_id));
      if (q.block_id) where.push(eq(flats.blockId, q.block_id));
      if (q.status) where.push(eq(flats.status, q.status));
      if (q.flat_type_id) where.push(eq(flats.flatTypeId, q.flat_type_id));
      if (q.floor !== undefined) where.push(eq(flats.floor, q.floor));
      if (q.min_price_paise !== undefined) where.push(gte(flats.pricePaise, q.min_price_paise));
      if (q.max_price_paise !== undefined) where.push(lte(flats.pricePaise, q.max_price_paise));
      if (q.facing) where.push(sql`lower(${flats.facing}) = lower(${q.facing})`);
      if (q.is_corner !== undefined) where.push(eq(flats.isCorner, q.is_corner));
      const result = await paginate<FlatSelect>(app.dbReplica, {
        table: flats, select: FLAT_SELECT, join: (qb) => flatJoins(qb),
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [flats.flatNumber], term: q.search },
        sort: { allowed: { flat_number: flats.flatNumber, floor: flats.floor, position: flats.position, price_paise: flats.pricePaise, status: flats.status, flat_type_code: flats.flatTypeCode, created_at: flats.createdAt, block_name: blocks.name }, default: "flat_number", requested: q.sort },
        ...listPaging(q),
      });
      const items = await toFlatRows(app.dbReplica, result.items);
      if (q.format === "csv") return sendCsv(reply, "flats.csv", CSV.map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      return { ...result, items };
    },
  });

  route(app, {
    method: "GET", url: "/flats/:id", permission: "project.read",
    schema: { params: idParams, response: { 200: FlatDetailResponseSchema }, summary: "Flat drawer: snapshots, specifications, price breakup, parking, booking, history" },
    handler: async (req) => {
      const row = await getFlatRow(app.dbReplica, req.user!, req.params.id);
      const [specifications, history] = await Promise.all([specificationsOf(app.dbReplica, row.flat_type_id), historyOf(app.dbReplica, row.id)]);
      return { ...row, specifications, history };
    },
  });

  route(app, {
    method: "PATCH", url: "/flats/:id", permission: "flat.write",
    schema: { params: idParams, body: withOptionalVersion(FlatUpdateSchema), response: { 200: FlatRowSchema }, summary: "Update flat notes / facing / corner flag" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; notes?: string | null; facing?: string | null; is_corner?: boolean };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const flat = await loadFlat(tx, user, req.params.id, true);
        const changes: Record<string, unknown> = {};
        if (body.notes !== undefined) changes["notes"] = body.notes;
        if (body.facing !== undefined) changes["facing"] = body.facing;
        if (body.is_corner !== undefined) changes["isCorner"] = body.is_corner;
        await applyUpdate(tx, flats, flat.id, version, changes, "flat");
        const after = await getFlatRow(tx, user, flat.id);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "flat.update", entityType: "flat", entityId: flat.id, before: { notes: flat.notes, facing: flat.facing, is_corner: flat.isCorner }, after: { notes: after.notes, facing: after.facing, is_corner: after.is_corner } });
        return after;
      });
    },
  });

  route(app, {
    method: "POST", url: "/flats/:id/price", permission: "flat.write",
    schema: { params: idParams, body: PriceBody, response: { 200: FlatRowSchema }, summary: "Set a flat's price (with optional breakup); not for Booked/Sold flats" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; price_paise: number; rate_per_sqft_paise?: number | null; price_breakup?: { label: string; amount_paise: number }[]; reason?: string };
      const version = expectedVersion(req, body);
      if (body.price_breakup && body.price_breakup.reduce((s, l) => s + l.amount_paise, 0) !== body.price_paise) throw ApiError.badRequest("Breakup lines must add up to price_paise", { field: "price_breakup" });
      return app.db.transaction(async (tx) => {
        const flat = await loadFlat(tx, user, req.params.id, true);
        if (ENGINE_STATUSES.has(flat.status)) throw ApiError.rule(`Flat ${flat.flatNumber} is ${flat.status}; its price is frozen by the booking`, "PRICE_FROZEN", { status: flat.status });
        const breakup = body.price_breakup ?? [{ label: "Base price", amount_paise: body.price_paise }];
        const rate = body.rate_per_sqft_paise !== undefined ? body.rate_per_sqft_paise : (Number(flat.superBuiltupSqft) > 0 ? Math.round(body.price_paise / Number(flat.superBuiltupSqft)) : null);
        await applyUpdate(tx, flats, flat.id, version, { pricePaise: body.price_paise, ratePerSqftPaise: rate, priceBreakup: breakup, rateCardId: null }, "flat");
        const after = await getFlatRow(tx, user, flat.id);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "flat.price", entityType: "flat", entityId: flat.id, before: { price_paise: flat.pricePaise, price_breakup: flat.priceBreakup }, after: { price_paise: after.price_paise, price_breakup: after.price_breakup, reason: body.reason ?? null } });
        return after;
      });
    },
  });

  route(app, {
    method: "POST", url: "/flats/:id/status", permission: "flat.status",
    schema: { params: idParams, body: StatusBody, response: { 200: FlatRowSchema }, summary: "Available ↔ Hold ↔ Blocked (Booked/Sold are set by the booking engine)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const version = expectedVersion(req, body);
      const holdUntil = body.status === "HOLD" ? (body.hold_until ? new Date(body.hold_until) : await defaultHoldUntil(app, user.companyId)) : null;
      assertHoldUntil(holdUntil);
      return app.db.transaction(async (tx) => {
        const flat = await loadFlat(tx, user, req.params.id, true);
        const changes = manualStatusChanges(user, flat, { status: body.status, reason: body.reason, holdUntil });
        const updated = await applyUpdate(tx, flats, flat.id, version, changes, "flat");
        await writeAudit(tx, statusAudit(req, flat, updated, body.reason));
        await refreshUnitCounts(tx, flat.blockId);
        return getFlatRow(tx, user, flat.id);
      });
    },
  });

  route(app, {
    method: "POST", url: "/flats/:id/reserve", permission: "booking.create",
    schema: { params: idParams, body: FlatReserveSchema, response: { 200: FlatRowSchema }, summary: "Booking wizard: hold an Available flat for 1–30 minutes (repeat to extend; 409 when someone else holds it)" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        await reserveFlat(tx, user, req.params.id, req.body.minutes, meta(req));
        return getFlatRow(tx, user, req.params.id);
      });
    },
  });

  route(app, {
    method: "POST", url: "/flats/:id/release", permission: "booking.create",
    schema: { params: idParams, body: FlatReleaseSchema, response: { 200: FlatRowSchema }, summary: "Release a hold: the holder, or settings.manage (a lapsed hold by anyone)" },
    handler: async (req) => {
      const user = req.user!;
      return app.db.transaction(async (tx) => {
        await releaseFlat(tx, user, req.params.id, req.body.reason, meta(req));
        return getFlatRow(tx, user, req.params.id);
      });
    },
  });

  route(app, {
    method: "POST", url: "/flats/:id/flat-type", permission: "flat.write",
    schema: { params: idParams, body: withOptionalVersion(FlatTypeChangeSchema), response: { 200: FlatRowSchema }, summary: "Change the flat type (re-snapshots rooms/areas and price); only while Available" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; flat_type_id: string; reprice: boolean };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const flat = await loadFlat(tx, user, req.params.id, true);
        if (flat.status !== "AVAILABLE") throw ApiError.rule(`Flat ${flat.flatNumber} is ${flat.status}; the type can only change while it is Available`, "FLAT_NOT_AVAILABLE", { status: flat.status });
        const [ft] = await tx.select().from(flatTypes).where(and(eq(flatTypes.id, body.flat_type_id), eq(flatTypes.companyId, user.companyId))).limit(1);
        if (!ft) throw ApiError.badRequest("flat_type_id does not exist", { field: "flat_type_id" });
        if (!ft.isActive) throw ApiError.rule(`Flat type ${ft.name} is inactive`, "FLAT_TYPE_INACTIVE");
        const domain = flatTypeToDomain(ft);
        const changes: Record<string, unknown> = {
          flatTypeId: ft.id, flatTypeCode: ft.code, roomsSnapshot: roomsToDb(roomsToDomain(ft.rooms)), areasSnapshot: areasToDb(areasToDomain(ft.areas)),
          carpetSqft: domain.carpetSqft, builtupSqft: domain.builtupSqft, superBuiltupSqft: domain.superBuiltupSqft,
        };
        if (body.reprice) {
          const [block] = await tx.select({ floorStart: blocks.floorStart }).from(blocks).where(eq(blocks.id, flat.blockId)).limit(1);
          const card = await loadActiveRateCard(tx, flat.projectId);
          const { price, rateCardId } = priceWith(card, { floor: flat.floor, floorStart: block?.floorStart ?? 1, superBuiltupSqft: domain.superBuiltupSqft, isCorner: flat.isCorner, facing: flat.facing ?? domain.facing ?? null, flatTypeId: ft.id }, domain);
          changes["pricePaise"] = price.totalPaise; changes["ratePerSqftPaise"] = price.ratePerSqftPaise; changes["priceBreakup"] = breakupToDb(price.breakup); changes["rateCardId"] = rateCardId;
        }
        await applyUpdate(tx, flats, flat.id, version, changes, "flat");
        const after = await getFlatRow(tx, user, flat.id);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "flat.type", entityType: "flat", entityId: flat.id, before: { flat_type_id: flat.flatTypeId, flat_type_code: flat.flatTypeCode, price_paise: flat.pricePaise }, after: { flat_type_id: after.flat_type_id, flat_type_code: after.flat_type_code, price_paise: after.price_paise } });
        return after;
      });
    },
  });
}
