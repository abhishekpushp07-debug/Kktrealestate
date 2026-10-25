import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  IdSchema, ParkingBulkGenerateResponseSchema, ParkingBulkGenerateSchema, ParkingBulkStatusChangeSchema, ParkingSlotCreateSchema, ParkingSlotFilterSchema, ParkingSlotListResponseSchema,
  ParkingSlotRowSchema, ParkingSlotUpdateSchema, ParkingStatusChangeSchema, ParkingStatusSchema, VersionSchema, FlatBulkResponseSchema,
  type ParkingSlotRow, type ParkingStatus,
} from "@kkt/contracts";
import { bookings, flats, parkingSlots, type Executor } from "@kkt/db";
import { writeAudit, type AuditEntry } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion } from "../../lib/version.js";
import { loadProject, meta, patchBody, writeAuditMany } from "./service.js";

export type DbParkingSlot = typeof parkingSlots.$inferSelect;

const projectParams = z.object({ id: IdSchema });
const slotParams = z.object({ id: IdSchema, slotId: IdSchema });

/** Hydrates slot rows with booking number and flat number (one batch query). */
export async function toParkingRows(db: Executor, rows: readonly DbParkingSlot[]): Promise<ParkingSlotRow[]> {
  const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((b): b is string => b !== null))];
  const refs = bookingIds.length
    ? await db.select({ id: bookings.id, number: bookings.bookingNumber, flatNumber: flats.flatNumber }).from(bookings).innerJoin(flats, eq(flats.id, bookings.flatId)).where(inArray(bookings.id, bookingIds))
    : [];
  const byBooking = new Map(refs.map((r) => [r.id, r]));
  return rows.map((s) => {
    const ref = s.bookingId ? byBooking.get(s.bookingId) : undefined;
    return {
      id: s.id, company_id: s.companyId, created_at: s.createdAt.toISOString(), updated_at: s.updatedAt.toISOString(), created_by: s.createdBy, version: s.version,
      project_id: s.projectId, number: s.number, slot_type: s.slotType, level: s.level, price_paise: s.pricePaise, status: s.status,
      booking_id: s.bookingId, booking_number: ref?.number ?? null, flat_number: ref?.flatNumber ?? null,
    };
  });
}

/** Loads a slot of a project the user may see; 404 otherwise. */
export async function loadParkingSlot(db: Executor, user: StaffContext, projectId: string, slotId: string, forUpdate = false): Promise<DbParkingSlot> {
  ensureProjectAccess(user, projectId);
  const q = db.select().from(parkingSlots).where(and(eq(parkingSlots.id, slotId), eq(parkingSlots.projectId, projectId), eq(parkingSlots.companyId, user.companyId))).limit(1).$dynamic();
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw ApiError.notFound("Parking slot");
  return row;
}

/** Validates a manual status change (AVAILABLE ↔ BLOCKED); ALLOTTED belongs to the booking engine (422 as target or current state). */
export function manualParkingStatus(slot: DbParkingSlot, status: ParkingStatus): { status: ParkingStatus } {
  if (status === "ALLOTTED") throw ApiError.rule("Status ALLOTTED is set only by the booking engine", "ENGINE_STATUS", { status });
  if (slot.status === "ALLOTTED") throw ApiError.rule(`Slot ${slot.number} is allotted to a booking; its status is set only by the booking engine`, "ENGINE_STATUS", { status: slot.status, booking_id: slot.bookingId });
  if (slot.status === status) throw ApiError.rule(`Slot ${slot.number} is already ${status}`, "NO_CHANGE");
  return { status };
}

function statusAudit(req: Parameters<typeof meta>[0], slot: DbParkingSlot, status: string, reason: string | null | undefined): AuditEntry {
  return { companyId: slot.companyId, ...meta(req), action: "parking_slot.status", entityType: "parking_slot", entityId: slot.id, before: { status: slot.status }, after: { status, number: slot.number, reason: reason ?? null } };
}

/** Pads a slot number: prefix + zero-padded counter ("B1-", 7, pad 2 → B1-07). */
export function slotNumber(prefix: string, n: number, pad: number): string {
  return `${prefix}${pad > 0 ? String(n).padStart(pad, "0") : String(n)}`;
}

/** Update body: slot fields plus an optional manual status (full enum so ALLOTTED answers 422, not 400). */
const UpdateBody = patchBody(ParkingSlotUpdateSchema.extend({ status: ParkingStatusSchema.optional(), reason: z.string().trim().max(1000).optional().nullable() }));
const StatusBody = z.strictObject({ ...ParkingStatusChangeSchema.shape, status: ParkingStatusSchema, version: VersionSchema.optional() });
const CSV = ["number", "slot_type", "level", "price_paise", "status", "booking_number", "flat_number", "version"];

/** Parking inventory per project: list, create, bulk-generate, update, manual status (single and bulk). */
export function registerParkingRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/projects/:id/parking", permission: "project.read",
    schema: { params: projectParams, querystring: ParkingSlotFilterSchema, response: { 200: ParkingSlotListResponseSchema }, summary: "List parking slots of a project" },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      if (q.project_id && q.project_id !== req.params.id) throw ApiError.badRequest("project_id must match the path", { field: "project_id" });
      const project = await loadProject(app.dbReplica, user, req.params.id);
      const where: (SQL | undefined)[] = [eq(parkingSlots.companyId, user.companyId), eq(parkingSlots.projectId, project.id)];
      if (q.slot_type) where.push(eq(parkingSlots.slotType, q.slot_type));
      if (q.status) where.push(eq(parkingSlots.status, q.status));
      if (q.level) where.push(sql`lower(${parkingSlots.level}) = lower(${q.level})`);
      const result = await paginate<DbParkingSlot>(app.dbReplica, {
        table: parkingSlots,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [parkingSlots.number, parkingSlots.level], term: q.search },
        sort: { allowed: { number: parkingSlots.number, slot_type: parkingSlots.slotType, level: parkingSlots.level, price_paise: parkingSlots.pricePaise, status: parkingSlots.status, created_at: parkingSlots.createdAt }, default: "number", requested: q.sort },
        ...listPaging(q),
      });
      const items = await toParkingRows(app.dbReplica, result.items);
      if (q.format === "csv") return sendCsv(reply, "parking.csv", CSV.map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST", url: "/projects/:id/parking", permission: "parking.write", idempotent: true,
    schema: { params: projectParams, body: ParkingSlotCreateSchema, response: { 201: ParkingSlotRowSchema }, summary: "Create one parking slot" },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body;
      if (body.project_id !== req.params.id) throw ApiError.badRequest("project_id must match the path", { field: "project_id" });
      const row = await app.db.transaction(async (tx) => {
        const project = await loadProject(tx, user, req.params.id, true);
        if (!project.isActive) throw ApiError.rule("Project is inactive", "PROJECT_INACTIVE");
        let created: DbParkingSlot | undefined;
        try {
          [created] = await tx.insert(parkingSlots).values({ companyId: user.companyId, projectId: project.id, number: body.number, slotType: body.slot_type, level: body.level ?? null, pricePaise: body.price_paise, createdBy: user.id }).returning();
        } catch (e) { translatePgError(e, "A parking slot with this number"); }
        if (!created) throw new Error("insert returned no row");
        const [view] = await toParkingRows(tx, [created]);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "parking_slot.create", entityType: "parking_slot", entityId: created.id, after: view as unknown as Record<string, unknown> });
        return view!;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "POST", url: "/projects/:id/parking/bulk-generate", permission: "parking.write", idempotent: true,
    schema: { params: projectParams, body: ParkingBulkGenerateSchema, response: { 201: ParkingBulkGenerateResponseSchema }, summary: "Bulk-generate slots prefix+from..to (existing numbers are skipped)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body;
      if (body.project_id !== req.params.id) throw ApiError.badRequest("project_id must match the path", { field: "project_id" });
      const result = await app.db.transaction(async (tx) => {
        const project = await loadProject(tx, user, req.params.id, true);
        if (!project.isActive) throw ApiError.rule("Project is inactive", "PROJECT_INACTIVE");
        const wanted: string[] = [];
        for (let n = body.from_number; n <= body.to_number; n += 1) wanted.push(slotNumber(body.prefix, n, body.pad));
        const existing = await tx.select({ number: parkingSlots.number }).from(parkingSlots).where(and(eq(parkingSlots.projectId, project.id), inArray(parkingSlots.number, wanted)));
        const taken = new Set(existing.map((e) => e.number));
        const fresh = wanted.filter((n) => !taken.has(n));
        const inserted = fresh.length
          ? await tx.insert(parkingSlots).values(fresh.map((number) => ({ companyId: user.companyId, projectId: project.id, number, slotType: body.slot_type, level: body.level ?? null, pricePaise: body.price_paise, createdBy: user.id }))).returning({ id: parkingSlots.id, number: parkingSlots.number })
          : [];
        await writeAuditMany(tx, [
          { companyId: user.companyId, ...meta(req), action: "parking_slot.bulk_generate", entityType: "project", entityId: project.id, after: { created: inserted.length, skipped_existing: [...taken], slot_type: body.slot_type, level: body.level ?? null, price_paise: body.price_paise } },
          ...inserted.map((s) => ({ companyId: user.companyId, ...meta(req), action: "parking_slot.create", entityType: "parking_slot", entityId: s.id, after: { number: s.number, slot_type: body.slot_type, level: body.level ?? null, price_paise: body.price_paise, status: "AVAILABLE", bulk: true } })),
        ]);
        return { created: inserted.length, skipped_existing: wanted.filter((n) => taken.has(n)) };
      });
      return reply.code(201).send(result);
    },
  });

  route(app, {
    method: "GET", url: "/projects/:id/parking/:slotId", permission: "project.read",
    schema: { params: slotParams, response: { 200: ParkingSlotRowSchema }, summary: "Get a parking slot" },
    handler: async (req) => {
      const slot = await loadParkingSlot(app.dbReplica, req.user!, req.params.id, req.params.slotId);
      return (await toParkingRows(app.dbReplica, [slot]))[0]!;
    },
  });

  route(app, {
    method: "PATCH", url: "/projects/:id/parking/:slotId", permission: "parking.write",
    schema: { params: slotParams, body: UpdateBody, response: { 200: ParkingSlotRowSchema }, summary: "Update a slot (number/type/level/price) and/or set status Available|Blocked (Allotted is set by the booking engine)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; number?: string; slot_type?: ParkingSlotRow["slot_type"]; level?: string | null; price_paise?: number; status?: ParkingStatus; reason?: string | null };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const slot = await loadParkingSlot(tx, user, req.params.id, req.params.slotId, true);
        const changes: Record<string, unknown> = {};
        if (body.number !== undefined) changes["number"] = body.number;
        if (body.slot_type !== undefined) changes["slotType"] = body.slot_type;
        if (body.level !== undefined) changes["level"] = body.level;
        if (body.price_paise !== undefined) changes["pricePaise"] = body.price_paise;
        if (slot.status === "ALLOTTED" && (body.number !== undefined || body.price_paise !== undefined)) throw ApiError.rule(`Slot ${slot.number} is allotted; number and price are frozen by the booking`, "PRICE_FROZEN", { booking_id: slot.bookingId });
        if (body.status !== undefined) Object.assign(changes, manualParkingStatus(slot, body.status));
        let updated: DbParkingSlot;
        try { updated = await applyUpdate(tx, parkingSlots, slot.id, version, changes, "parking_slot"); } catch (e) { translatePgError(e, "A parking slot with this number"); }
        const [before] = await toParkingRows(tx, [slot]);
        const [after] = await toParkingRows(tx, [updated]);
        if (body.status !== undefined) await writeAudit(tx, statusAudit(req, slot, updated.status, body.reason));
        if (Object.keys(changes).some((k) => k !== "status")) await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "parking_slot.update", entityType: "parking_slot", entityId: slot.id, before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> });
        return after!;
      });
    },
  });

  route(app, {
    method: "POST", url: "/projects/:id/parking/:slotId/status", permission: "parking.write",
    schema: { params: slotParams, body: StatusBody, response: { 200: ParkingSlotRowSchema }, summary: "Set a slot Available or Blocked (Allotted is set by the booking engine → 422)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const slot = await loadParkingSlot(tx, user, req.params.id, req.params.slotId, true);
        const updated = await applyUpdate(tx, parkingSlots, slot.id, version, manualParkingStatus(slot, body.status), "parking_slot");
        await writeAudit(tx, statusAudit(req, slot, updated.status, body.reason));
        return (await toParkingRows(tx, [updated]))[0]!;
      });
    },
  });

  route(app, {
    method: "POST", url: "/projects/:id/parking/bulk-status", permission: "parking.write",
    schema: { params: projectParams, body: ParkingBulkStatusChangeSchema, response: { 200: FlatBulkResponseSchema }, summary: "Multi-select Available/Blocked; allotted slots are skipped" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      return app.db.transaction(async (tx) => {
        const project = await loadProject(tx, user, req.params.id, true);
        const rows = await tx.select().from(parkingSlots).where(and(eq(parkingSlots.projectId, project.id), inArray(parkingSlots.id, body.slot_ids))).orderBy(asc(parkingSlots.number)).for("update");
        if (rows.length !== new Set(body.slot_ids).size) throw ApiError.badRequest("Every slot_id must belong to this project", { field: "slot_ids" });
        const audits: AuditEntry[] = [];
        const skipped: string[] = [];
        const toUpdate: string[] = [];
        for (const slot of rows) {
          try { manualParkingStatus(slot, body.status); } catch (e) {
            if (e instanceof ApiError && e.statusCode === 422) { skipped.push(slot.id); continue; }
            throw e;
          }
          toUpdate.push(slot.id);
          audits.push(statusAudit(req, slot, body.status, body.reason));
        }
        if (toUpdate.length > 0) await tx.update(parkingSlots).set({ status: body.status, version: sql`${parkingSlots.version} + 1` }).where(inArray(parkingSlots.id, toUpdate));
        await writeAuditMany(tx, audits);
        return { updated: toUpdate.length, skipped: skipped.length, skipped_ids: skipped };
      });
    },
  });
}
