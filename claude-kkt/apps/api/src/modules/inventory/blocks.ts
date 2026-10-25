import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActiveStateResponseSchema, BlockAppendFloorsSchema, BlockCreateSchema, BlockFilterSchema, BlockGenerateFlatsResponseSchema, BlockGenerateFlatsSchema, BlockGridQuerySchema, BlockGridResponseSchema,
  BlockListResponseSchema, BlockPreviewRequestSchema, BlockPreviewResponseSchema, BlockRowSchema, BlockStageSequenceUpdateSchema, BlockUpdateSchema, FlatBulkPriceUpdateSchema, FlatBulkResponseSchema,
  FlatBulkStatusChangeSchema, IdSchema, VersionedSchema, rangesDisjoint,
  type BlockCreate, type BlockGridCell, type BlockGridResponse, type BlockRow, type BlockUpdate, type FlatStatus, type PriceBand,
} from "@kkt/contracts";
import { blockStages, blockTypes, blocks, bookings, customers, flatTypes, flats, floorPlanTemplates, projects, type Executor, type FloorPlanRange } from "@kkt/db";
import { bulkPriceEdit, floorLabel, formatINRShort, physicalFloors, unitFloors, validateFloorPlanRanges, type FlatDraft } from "@kkt/domain";
import { writeAudit, type AuditEntry } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { scopeFilter, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, optionalExpectedVersion, withOptionalVersion } from "../../lib/version.js";
import { defaultHoldUntil, manualStatusChanges, statusAudit } from "./flats.js";
import { assertFilterScope } from "./projects.js";
import {
  allStagesPending, applyPriceUpdates, assertStageSequence, blockToDefinition, breakupToDb, draftFlats, ensureBlockStages, insertDrafts, loadBlock, loadProject, loadTemplates, masterStageOrder, maxPositions, meta,
  refreshProjectCounts, refreshUnitCounts, snapshotBlockStages, translateDomainError, writeAuditMany, type DbBlock, type LoadedRateCard,
} from "./service.js";

const idParams = z.object({ id: IdSchema });
const STATUS_KEYS: readonly FlatStatus[] = ["AVAILABLE", "HOLD", "BLOCKED", "BOOKED", "SOLD"];

/** Hydrates block rows (project name, block type, template names, current stage, has_flats) in a fixed number of queries. */
export async function toBlockRows(db: Executor, rows: readonly DbBlock[]): Promise<BlockRow[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const typeIds = [...new Set(rows.map((r) => r.blockTypeId))];
  const templateIds = [...new Set(rows.flatMap((r) => r.floorPlans.map((p) => p.floor_plan_template_id)))];
  const [projs, types, templates, stages, counts] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds)),
    db.select({ id: blockTypes.id, name: blockTypes.name, hasFloors: blockTypes.hasFloors }).from(blockTypes).where(inArray(blockTypes.id, typeIds)),
    templateIds.length ? db.select({ id: floorPlanTemplates.id, name: floorPlanTemplates.name }).from(floorPlanTemplates).where(inArray(floorPlanTemplates.id, templateIds)) : Promise.resolve([]),
    db.select({ blockId: blockStages.blockId, name: blockStages.name, sortOrder: blockStages.sortOrder }).from(blockStages).where(and(inArray(blockStages.blockId, ids), eq(blockStages.status, "COMPLETED"))).orderBy(asc(blockStages.blockId), desc(blockStages.sortOrder)),
    db.select({ blockId: flats.blockId, n: sql<number>`count(*)::int` }).from(flats).where(inArray(flats.blockId, ids)).groupBy(flats.blockId),
  ]);
  const projectName = new Map(projs.map((p) => [p.id, p.name]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const templateName = new Map(templates.map((t) => [t.id, t.name]));
  const currentStage = new Map<string, string>();
  for (const s of stages) if (!currentStage.has(s.blockId)) currentStage.set(s.blockId, s.name);
  const flatCount = new Map(counts.map((c) => [c.blockId, Number(c.n)]));
  return rows.map((b) => {
    const t = typeById.get(b.blockTypeId);
    return {
      id: b.id, company_id: b.companyId, created_at: b.createdAt.toISOString(), updated_at: b.updatedAt.toISOString(), created_by: b.createdBy, version: b.version,
      is_active: b.isActive, deactivated_at: b.deactivatedAt ? b.deactivatedAt.toISOString() : null,
      project_id: b.projectId, project_name: projectName.get(b.projectId) ?? "", block_type_id: b.blockTypeId, block_type_name: t?.name ?? "", has_floors: t?.hasFloors ?? true,
      name: b.name, code: b.code, floors: b.floors, floor_start: b.floorStart, ground_floor_label: b.groundFloorLabel ?? "G",
      skip_floors: b.skipFloors, refuge_floors: b.refugeFloors, podium_floors: b.podiumFloors,
      floor_plans: b.floorPlans.map((p) => ({ from_floor: p.from_floor, to_floor: p.to_floor, floor_plan_template_id: p.floor_plan_template_id, template_name: templateName.get(p.floor_plan_template_id) ?? "" })),
      numbering_pattern: b.numberingPattern as BlockRow["numbering_pattern"], stage_sequence: b.stageSequence, construction_percent: Number(b.constructionPercent),
      current_stage_name: currentStage.get(b.id) ?? null, unit_counts: b.unitCounts, status: b.status, sort_order: b.sortOrder, has_flats: (flatCount.get(b.id) ?? 0) > 0,
    };
  });
}

/** One block in wire shape (scoped 404). */
export async function getBlockRow(db: Executor, user: StaffContext, id: string): Promise<BlockRow> {
  const [row] = await toBlockRows(db, [await loadBlock(db, user, id)]);
  if (!row) throw ApiError.notFound("Block");
  return row;
}

/** 400 when the structure (floors/skips/ranges) leaves a unit floor uncovered or double-covered. */
function assertStructure(def: ReturnType<typeof blockToDefinition>): void {
  let problems: { gaps: number[]; overlaps: number[] };
  try { problems = validateFloorPlanRanges(def); } catch (e) { translateDomainError(e); }
  if (problems.gaps.length > 0) throw ApiError.badRequest(`Floors without a floor plan: ${problems.gaps.join(", ")}`, { field: "floor_plans", gaps: problems.gaps });
  if (problems.overlaps.length > 0) throw ApiError.badRequest(`Floors covered by more than one floor plan: ${problems.overlaps.join(", ")}`, { field: "floor_plans", overlaps: problems.overlaps });
}

async function assertBlockType(tx: Executor, companyId: string, id: string): Promise<void> {
  const [bt] = await tx.select({ id: blockTypes.id, isActive: blockTypes.isActive, name: blockTypes.name }).from(blockTypes).where(and(eq(blockTypes.companyId, companyId), eq(blockTypes.id, id))).limit(1);
  if (!bt) throw ApiError.badRequest("block_type_id does not exist", { field: "block_type_id" });
  if (!bt.isActive) throw ApiError.rule(`Block type ${bt.name} is inactive`, "BLOCK_TYPE_INACTIVE");
}

/** Count of flats of the block that are not AVAILABLE (regenerate / structural-edit guard). */
async function nonAvailableCount(tx: Executor, blockId: string): Promise<{ total: number; nonAvailable: number }> {
  const [r] = await tx.select({ total: sql<number>`count(*)::int`, nonAvailable: sql<number>`count(*) filter (where ${flats.status} <> 'AVAILABLE')::int` }).from(flats).where(eq(flats.blockId, blockId));
  return { total: Number(r?.total ?? 0), nonAvailable: Number(r?.nonAvailable ?? 0) };
}

/** Generation audit rows: one for the block, one per flat (so each flat's history starts with its creation). */
function generationAudits(req: Parameters<typeof meta>[0], block: DbBlock, inserted: readonly { id: string; flatNumber: string }[], drafts: readonly FlatDraft[], action: string): AuditEntry[] {
  const byNumber = new Map(drafts.map((d) => [d.flatNumber, d]));
  const perFlat: AuditEntry[] = inserted.map((f) => {
    const d = byNumber.get(f.flatNumber);
    return { companyId: block.companyId, ...meta(req), action: "flat.generate", entityType: "flat", entityId: f.id, after: { flat_number: f.flatNumber, floor: d?.floor, flat_type_code: d?.flatTypeCode, price_paise: d?.pricePaise, status: "AVAILABLE" } };
  });
  return [{ companyId: block.companyId, ...meta(req), action, entityType: "block", entityId: block.id, after: { flats_created: inserted.length, block_code: block.code } }, ...perFlat];
}

/** Generates and inserts every flat of a block (atomic within the caller's transaction). */
async function generateInto(tx: Executor, req: Parameters<typeof meta>[0], block: DbBlock, action: string): Promise<{ created: number; floorsWithUnits: number; rateCard: LoadedRateCard | null }> {
  const def = blockToDefinition(block);
  const { drafts, rateCard } = await draftFlats(tx, block.companyId, block.projectId, def);
  let inserted: { id: string; flatNumber: string }[] = [];
  try { inserted = await insertDrafts(tx, block, drafts, rateCard, req.user?.id ?? null); } catch (e) { translatePgError(e, "A flat with this number"); }
  await writeAuditMany(tx, generationAudits(req, block, inserted, drafts, action));
  await refreshUnitCounts(tx, block.id);
  return { created: inserted.length, floorsWithUnits: unitFloors(def).length, rateCard };
}

const BLOCK_CSV = ["name", "code", "project_name", "block_type_name", "floors", "floor_start", "numbering_pattern", "status", "construction_percent", "current_stage_name", "is_active", "version"];

/** Block routes. */
export function registerBlockRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/blocks", permission: "project.read",
    schema: { querystring: BlockFilterSchema, response: { 200: BlockListResponseSchema }, summary: "List blocks (by project)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      assertFilterScope(user, q.project_id);
      const where: (SQL | undefined)[] = [eq(blocks.companyId, user.companyId), scopeFilter(user, blocks.projectId)];
      if (!q.include_inactive) where.push(eq(blocks.isActive, true));
      if (q.project_id) where.push(eq(blocks.projectId, q.project_id));
      if (q.block_type_id) where.push(eq(blocks.blockTypeId, q.block_type_id));
      if (q.status) where.push(eq(blocks.status, q.status));
      const result = await paginate<DbBlock>(app.dbReplica, {
        table: blocks,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [blocks.name, blocks.code], term: q.search },
        sort: { allowed: { name: blocks.name, code: blocks.code, sort_order: blocks.sortOrder, floors: blocks.floors, status: blocks.status, created_at: blocks.createdAt }, default: "sort_order", requested: q.sort },
        ...listPaging(q),
      });
      const items = await toBlockRows(app.dbReplica, result.items);
      if (q.format === "csv") return sendCsv(reply, "blocks.csv", BLOCK_CSV.map((k) => ({ key: k, header: k })), items as unknown as Record<string, unknown>[]);
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST", url: "/blocks", permission: "block.write", idempotent: true,
    schema: { body: BlockCreateSchema, response: { 201: BlockRowSchema }, summary: "Create a block: snapshots block stages and generates its flats atomically" },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body as BlockCreate;
      const row = await app.db.transaction(async (tx) => {
        const project = await loadProject(tx, user, body.project_id, true);
        if (!project.isActive) throw ApiError.rule("Project is inactive", "PROJECT_INACTIVE");
        await assertBlockType(tx, user.companyId, body.block_type_id);
        const stageSequence = body.stage_sequence ?? (project.stageSequence.length > 0 ? project.stageSequence : await masterStageOrder(tx, user.companyId));
        await assertStageSequence(tx, user.companyId, stageSequence);
        const floorPlans: FloorPlanRange[] = body.floor_plans.map((r) => ({ from_floor: r.from_floor, to_floor: r.to_floor, floor_plan_template_id: r.floor_plan_template_id }));
        await loadTemplates(tx, user.companyId, floorPlans.map((r) => r.floor_plan_template_id));
        let created: DbBlock | undefined;
        try {
          [created] = await tx.insert(blocks).values({
            companyId: user.companyId, projectId: project.id, blockTypeId: body.block_type_id, name: body.name, code: body.code, floors: body.floors, floorStart: body.floor_start, groundFloorLabel: body.ground_floor_label,
            skipFloors: body.skip_floors, refugeFloors: body.refuge_floors, podiumFloors: body.podium_floors, floorPlans, numberingPattern: body.numbering_pattern, stageSequence, status: body.status, sortOrder: body.sort_order, createdBy: user.id,
          }).returning();
        } catch (e) { translatePgError(e, "A block with this code in the project"); }
        if (!created) throw new Error("insert returned no row");
        await ensureBlockStages(tx, created.id);
        if (body.generate_flats) await generateInto(tx, req, created, "block.generate_flats");
        else await refreshUnitCounts(tx, created.id);
        const [view] = await toBlockRows(tx, [created]);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "block.create", entityType: "block", entityId: created.id, after: view as unknown as Record<string, unknown> });
        return (await toBlockRows(tx, [(await loadBlock(tx, user, created.id))]))[0]!;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "POST", url: "/blocks/preview", permission: "project.read",
    schema: { body: BlockPreviewRequestSchema, response: { 200: BlockPreviewResponseSchema }, summary: "Preview the grid a block definition would generate (wizard; nothing is written)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      await loadProject(app.dbReplica, user, body.project_id);
      const def = blockToDefinition({ code: body.code, floors: body.floors, floorStart: body.floor_start, groundFloorLabel: body.ground_floor_label, skipFloors: body.skip_floors, refugeFloors: body.refuge_floors, podiumFloors: body.podium_floors, floorPlans: body.floor_plans.map((r) => ({ from_floor: r.from_floor, to_floor: r.to_floor, floor_plan_template_id: r.floor_plan_template_id })), numberingPattern: body.numbering_pattern });
      const { drafts } = await draftFlats(app.dbReplica, user.companyId, body.project_id, def);
      const byFloor = new Map<number, FlatDraft[]>();
      for (const d of drafts) byFloor.set(d.floor, [...(byFloor.get(d.floor) ?? []), d]);
      const refuge = new Set(def.refugeFloors);
      const podium = new Set(def.podiumFloors);
      let floorsOut: number[];
      try { floorsOut = physicalFloors(def).reverse(); } catch (e) { translateDomainError(e); }
      return {
        total_flats: drafts.length, total_value_paise: drafts.reduce((s, d) => s + d.pricePaise, 0),
        floors: floorsOut.map((f) => ({
          floor: f, floor_label: floorLabel(f, def.groundFloorLabel), kind: refuge.has(f) ? "REFUGE" as const : podium.has(f) ? "PODIUM" as const : "UNITS" as const,
          cells: (byFloor.get(f) ?? []).map((d) => ({ flat_number: d.flatNumber, position: d.position, flat_type_id: d.flatTypeId, flat_type_code: d.flatTypeCode, facing: d.facing, is_corner: d.isCorner, super_builtup_sqft: d.superBuiltupSqft, price_paise: d.pricePaise })),
        })),
      };
    },
  });

  route(app, {
    method: "GET", url: "/blocks/:id", permission: "project.read",
    schema: { params: idParams, response: { 200: BlockRowSchema }, summary: "Get a block" },
    handler: async (req) => getBlockRow(app.dbReplica, req.user!, req.params.id),
  });

  route(app, {
    method: "PATCH", url: "/blocks/:id", permission: "block.write",
    schema: { params: idParams, body: withOptionalVersion(BlockUpdateSchema), response: { 200: BlockRowSchema }, summary: "Update a block (structure only while every flat is Available; stage sequence only while every stage is pending)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as BlockUpdate & { version?: number };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const existing = await loadBlock(tx, user, req.params.id, true);
        const [before] = await toBlockRows(tx, [existing]);
        if (body.block_type_id) await assertBlockType(tx, user.companyId, body.block_type_id);
        const changes: Record<string, unknown> = {};
        if (body.name !== undefined) changes["name"] = body.name;
        if (body.block_type_id !== undefined) changes["blockTypeId"] = body.block_type_id;
        if (body.status !== undefined) changes["status"] = body.status;
        if (body.sort_order !== undefined) changes["sortOrder"] = body.sort_order;
        if (body.ground_floor_label !== undefined) changes["groundFloorLabel"] = body.ground_floor_label;
        const structural = ["code", "floors", "floor_start", "skip_floors", "refuge_floors", "podium_floors", "floor_plans", "numbering_pattern"] as const;
        const touched = structural.filter((k) => body[k] !== undefined);
        if (touched.length > 0) {
          const { nonAvailable } = await nonAvailableCount(tx, existing.id);
          if (nonAvailable > 0) throw ApiError.rule(`Structure cannot change while ${nonAvailable} flat(s) are not Available`, "FLATS_NOT_AVAILABLE", { non_available: nonAvailable, fields: touched });
          const merged = {
            code: body.code ?? existing.code, floors: body.floors ?? existing.floors, floorStart: body.floor_start ?? existing.floorStart, groundFloorLabel: body.ground_floor_label ?? existing.groundFloorLabel,
            skipFloors: body.skip_floors ?? existing.skipFloors, refugeFloors: body.refuge_floors ?? existing.refugeFloors, podiumFloors: body.podium_floors ?? existing.podiumFloors,
            floorPlans: body.floor_plans ? body.floor_plans.map((r) => ({ from_floor: r.from_floor, to_floor: r.to_floor, floor_plan_template_id: r.floor_plan_template_id })) : existing.floorPlans,
            numberingPattern: body.numbering_pattern ?? existing.numberingPattern,
          };
          if (merged.floorStart > merged.floors) throw ApiError.badRequest("floor_start must be ≤ floors", { field: "floor_start" });
          if (!rangesDisjoint(merged.floorPlans)) throw ApiError.badRequest("Floor-plan ranges must not overlap", { field: "floor_plans" });
          assertStructure(blockToDefinition(merged));
          if (body.floor_plans) await loadTemplates(tx, user.companyId, merged.floorPlans.map((r) => r.floor_plan_template_id));
          Object.assign(changes, { code: merged.code, floors: merged.floors, floorStart: merged.floorStart, skipFloors: merged.skipFloors, refugeFloors: merged.refugeFloors, podiumFloors: merged.podiumFloors, floorPlans: merged.floorPlans, numberingPattern: merged.numberingPattern });
        }
        if (body.stage_sequence) {
          await assertStageSequence(tx, user.companyId, body.stage_sequence);
          if (!(await allStagesPending(tx, [existing.id]))) throw ApiError.rule("Stage sequence can only change while every stage is pending", "STAGES_STARTED");
          changes["stageSequence"] = body.stage_sequence;
        }
        let updated: DbBlock;
        try { updated = await applyUpdate(tx, blocks, existing.id, version, changes, "block"); } catch (e) { translatePgError(e, "A block with this code in the project"); }
        if (body.stage_sequence) await snapshotBlockStages(tx, updated);
        const [after] = await toBlockRows(tx, [updated]);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "block.update", entityType: "block", entityId: existing.id, before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> });
        return after!;
      });
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/stage-sequence", permission: "block.write",
    schema: { params: idParams, body: withOptionalVersion(BlockStageSequenceUpdateSchema), response: { 200: BlockRowSchema }, summary: "Replace the block's stage sequence and re-snapshot its stages (while every stage is pending)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; stage_sequence: string[] };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const existing = await loadBlock(tx, user, req.params.id, true);
        await assertStageSequence(tx, user.companyId, body.stage_sequence);
        if (!(await allStagesPending(tx, [existing.id]))) throw ApiError.rule("Stage sequence can only change while every stage is pending", "STAGES_STARTED");
        const updated = await applyUpdate(tx, blocks, existing.id, version, { stageSequence: body.stage_sequence }, "block");
        await snapshotBlockStages(tx, updated);
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "block.stage_sequence", entityType: "block", entityId: existing.id, before: { stage_sequence: existing.stageSequence }, after: { stage_sequence: updated.stageSequence } });
        return (await toBlockRows(tx, [updated]))[0]!;
      });
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/generate-flats", permission: "block.write",
    schema: { params: idParams, body: withOptionalVersion(BlockGenerateFlatsSchema), response: { 200: BlockGenerateFlatsResponseSchema }, summary: "Generate flats (block without flats) or regenerate (only while every flat is Available)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; regenerate: boolean };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const block = await loadBlock(tx, user, req.params.id, true);
        const { total, nonAvailable } = await nonAvailableCount(tx, block.id);
        if (nonAvailable > 0) throw ApiError.conflict("REGENERATE_BLOCKED", `${nonAvailable} flat(s) of ${block.name} are not Available; flats cannot be regenerated`, { non_available: nonAvailable, total });
        if (total > 0 && !body.regenerate) throw ApiError.rule(`${block.name} already has ${total} flats; pass regenerate: true to replace them`, "REGENERATE_REQUIRED", { total });
        const updated = await applyUpdate(tx, blocks, block.id, version, {}, "block");
        if (total > 0) await tx.delete(flats).where(eq(flats.blockId, block.id));
        const result = await generateInto(tx, req, updated, total > 0 ? "block.regenerate_flats" : "block.generate_flats");
        return { block_id: block.id, flats_created: result.created, floors_with_units: result.floorsWithUnits, version: updated.version };
      });
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/floors", permission: "block.write",
    schema: { params: idParams, body: withOptionalVersion(BlockAppendFloorsSchema), response: { 200: BlockGenerateFlatsResponseSchema }, summary: "Append floors (with their floor-plan ranges) and generate only the new flats" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; new_floors: number; floor_plans: { from_floor: number; to_floor: number; floor_plan_template_id: string }[]; skip_floors: number[]; refuge_floors: number[] };
      const version = expectedVersion(req, body);
      if (!rangesDisjoint(body.floor_plans)) throw ApiError.badRequest("Floor-plan ranges must not overlap", { field: "floor_plans" });
      return app.db.transaction(async (tx) => {
        const block = await loadBlock(tx, user, req.params.id, true);
        const oldTop = block.floors;
        const newTop = oldTop + body.new_floors;
        const outside = body.floor_plans.some((r) => r.from_floor <= oldTop || r.to_floor > newTop);
        if (outside) throw ApiError.badRequest(`New floor-plan ranges must lie within floors ${oldTop + 1}..${newTop}`, { field: "floor_plans" });
        const extraNoUnit = [...body.skip_floors, ...body.refuge_floors].filter((f) => f <= oldTop || f > newTop);
        if (extraNoUnit.length > 0) throw ApiError.badRequest(`Skip/refuge floors must lie within floors ${oldTop + 1}..${newTop}`, { field: "skip_floors", floors: extraNoUnit });
        const merged = {
          ...block, floors: newTop, skipFloors: [...block.skipFloors, ...body.skip_floors], refugeFloors: [...block.refugeFloors, ...body.refuge_floors],
          floorPlans: [...block.floorPlans, ...body.floor_plans.map((r) => ({ from_floor: r.from_floor, to_floor: r.to_floor, floor_plan_template_id: r.floor_plan_template_id }))],
        };
        if (!rangesDisjoint(merged.floorPlans)) throw ApiError.badRequest("Floor-plan ranges must not overlap", { field: "floor_plans" });
        const def = blockToDefinition(merged);
        assertStructure(def);
        // Generate with the full definition so sequence-based numbering continues, then keep only the new floors.
        const { drafts, rateCard } = await draftFlats(tx, block.companyId, block.projectId, def);
        const fresh = drafts.filter((d) => d.floor > oldTop);
        const updated = await applyUpdate(tx, blocks, block.id, version, { floors: merged.floors, skipFloors: merged.skipFloors, refugeFloors: merged.refugeFloors, floorPlans: merged.floorPlans }, "block");
        let inserted: { id: string; flatNumber: string }[] = [];
        try { inserted = await insertDrafts(tx, updated, fresh, rateCard, user.id); } catch (e) { translatePgError(e, "A flat with this number"); }
        await writeAuditMany(tx, generationAudits(req, updated, inserted, fresh, "block.append_floors"));
        await refreshUnitCounts(tx, block.id);
        return { block_id: block.id, flats_created: inserted.length, floors_with_units: unitFloors(def).length, version: updated.version };
      });
    },
  });

  route(app, {
    method: "GET", url: "/blocks/:id/grid", permission: "project.read",
    schema: { params: idParams, querystring: BlockGridQuerySchema, response: { 200: BlockGridResponseSchema }, summary: "Stacked tower grid: floors descending, positions across, refuge/podium rows, legend" },
    handler: async (req) => {
      const user = req.user!;
      const db = app.dbReplica;
      const block = await loadBlock(db, user, req.params.id);
      const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, block.projectId)).limit(1);
      const cells = await db.select({ f: flats, typeName: flatTypes.name, customerName: customers.fullName })
        .from(flats).innerJoin(flatTypes, eq(flatTypes.id, flats.flatTypeId)).leftJoin(bookings, eq(bookings.id, flats.bookingId)).leftJoin(customers, eq(customers.id, bookings.customerId))
        .where(eq(flats.blockId, block.id)).orderBy(asc(flats.floor), asc(flats.position), asc(flats.flatNumber));
      const prices = cells.map((c) => c.f.pricePaise).filter((p) => p > 0);
      const minP = prices.length ? Math.min(...prices) : 0;
      const maxP = prices.length ? Math.max(...prices) : 0;
      const bandCount = prices.length === 0 ? 0 : minP === maxP ? 1 : 5;
      const width = bandCount > 1 ? (maxP - minP) / bandCount : 0;
      const bandOf = (p: number): number => (bandCount <= 1 || width === 0 ? 0 : Math.min(bandCount - 1, Math.floor((p - minP) / width)));
      const bands: PriceBand[] = Array.from({ length: bandCount }, (_, i) => {
        const lo = bandCount === 1 ? minP : Math.round(minP + i * width);
        const hi = bandCount === 1 || i === bandCount - 1 ? maxP : Math.round(minP + (i + 1) * width) - 1;
        return { band: i, label: bandCount === 1 ? formatINRShort(lo) : `${formatINRShort(lo)} – ${formatINRShort(hi)}`, min_paise: lo, max_paise: Math.max(lo, hi), count: 0 };
      });
      const byFloor = new Map<number, BlockGridCell[]>();
      const byStatus: Record<FlatStatus, number> = { AVAILABLE: 0, HOLD: 0, BLOCKED: 0, BOOKED: 0, SOLD: 0 };
      const byType = new Map<string, { flat_type_id: string; code: string; name: string; count: number }>();
      for (const { f, typeName, customerName } of cells) {
        const band = f.pricePaise > 0 ? bandOf(f.pricePaise) : 0;
        if (f.pricePaise > 0 && bands[band]) bands[band].count += 1;
        byStatus[f.status] += 1;
        const t = byType.get(f.flatTypeId) ?? { flat_type_id: f.flatTypeId, code: f.flatTypeCode, name: typeName, count: 0 };
        t.count += 1; byType.set(f.flatTypeId, t);
        byFloor.set(f.floor, [...(byFloor.get(f.floor) ?? []), {
          flat_id: f.id, flat_number: f.flatNumber, position: f.position, status: f.status, flat_type_id: f.flatTypeId, flat_type_code: f.flatTypeCode, facing: f.facing, is_corner: f.isCorner,
          super_builtup_sqft: Number(f.superBuiltupSqft), price_paise: f.pricePaise, price_band: band, booking_id: f.bookingId, customer_name: customerName, hold_until: f.holdUntil ? f.holdUntil.toISOString() : null,
        }]);
      }
      const def = blockToDefinition(block);
      let floorsDesc: number[];
      try { floorsDesc = physicalFloors(def).reverse(); } catch { floorsDesc = [...byFloor.keys()].sort((a, b) => b - a); }
      const refuge = new Set(block.refugeFloors);
      const podium = new Set(block.podiumFloors);
      const response: BlockGridResponse = {
        block_id: block.id, block_name: block.name, project_id: block.projectId, project_name: project?.name ?? "", positions: maxPositions([...byFloor.values()].map((c) => c.length)), colour_by: req.query.colour_by,
        floors: floorsDesc.map((f) => ({ floor: f, floor_label: floorLabel(f, block.groundFloorLabel), kind: refuge.has(f) ? "REFUGE" : podium.has(f) ? "PODIUM" : "UNITS", cells: byFloor.get(f) ?? [] })),
        legend: { by_status: byStatus, by_flat_type: [...byType.values()].sort((a, b) => a.code.localeCompare(b.code)), price_bands: bands },
        unit_counts: block.unitCounts, generated_at: new Date().toISOString(),
      };
      for (const k of STATUS_KEYS) response.legend.by_status[k] = byStatus[k];
      return response;
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/bulk-status", permission: "flat.status",
    schema: { params: idParams, body: FlatBulkStatusChangeSchema, response: { 200: FlatBulkResponseSchema }, summary: "Multi-select status change (Available/Hold/Blocked); Booked/Sold and foreign holds are skipped" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const holdUntil = body.status === "HOLD" ? (body.hold_until ? new Date(body.hold_until) : await defaultHoldUntil(app, user.companyId)) : null;
      return app.db.transaction(async (tx) => {
        const block = await loadBlock(tx, user, req.params.id, true);
        const rows = await tx.select().from(flats).where(and(eq(flats.blockId, block.id), inArray(flats.id, body.flat_ids))).for("update");
        if (rows.length !== new Set(body.flat_ids).size) throw ApiError.badRequest("Every flat_id must belong to this block", { field: "flat_ids" });
        const audits: AuditEntry[] = [];
        const skipped: string[] = [];
        for (const flat of rows) {
          let changes: Record<string, unknown>;
          try { changes = manualStatusChanges(user, flat, { status: body.status, reason: body.reason, holdUntil }); } catch (e) {
            if (e instanceof ApiError && (e.statusCode === 422 || e.statusCode === 403)) { skipped.push(flat.id); continue; }
            throw e;
          }
          const [updated] = await tx.update(flats).set({ ...changes, version: sql`${flats.version} + 1` }).where(eq(flats.id, flat.id)).returning();
          if (updated) audits.push(statusAudit(req, flat, updated, body.reason));
        }
        await writeAuditMany(tx, audits);
        await refreshUnitCounts(tx, block.id);
        return { updated: audits.length, skipped: skipped.length, skipped_ids: skipped };
      });
    },
  });

  route(app, {
    method: "POST", url: "/blocks/:id/bulk-price", permission: "flat.write",
    schema: { params: idParams, body: FlatBulkPriceUpdateSchema, response: { 200: FlatBulkResponseSchema }, summary: "Bulk price edit per block/floor/type with optional floor-rise step (Available flats; never Booked/Sold)" },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      if (body.block_id !== req.params.id) throw ApiError.badRequest("block_id must match the path", { field: "block_id" });
      return app.db.transaction(async (tx) => {
        const block = await loadBlock(tx, user, req.params.id, true);
        const where: (SQL | undefined)[] = [eq(flats.blockId, block.id)];
        if (body.floors && body.floors.length > 0) where.push(inArray(flats.floor, body.floors));
        if (body.flat_ids && body.flat_ids.length > 0) where.push(inArray(flats.id, body.flat_ids));
        if (body.flat_type_id) where.push(eq(flats.flatTypeId, body.flat_type_id));
        const rows = await tx.select({ id: flats.id, floor: flats.floor, superBuiltupSqft: flats.superBuiltupSqft, pricePaise: flats.pricePaise, status: flats.status, flatNumber: flats.flatNumber, breakup: flats.priceBreakup }).from(flats).where(and(...where.filter((w): w is SQL => w !== undefined))).for("update");
        const eligible = rows.filter((r) => (body.only_available ? r.status === "AVAILABLE" : !["BOOKED", "SOLD"].includes(r.status)));
        const skipped = rows.filter((r) => !eligible.includes(r)).map((r) => r.id);
        let results: ReturnType<typeof bulkPriceEdit>;
        try {
          results = bulkPriceEdit({
            flats: eligible.map((r) => ({ id: r.id, floor: r.floor, superBuiltupSqft: Number(r.superBuiltupSqft), pricePaise: r.pricePaise })),
            mode: body.rate_per_sqft_paise !== undefined ? "SET_RATE_PER_SQFT" : "SET_PRICE", value: body.rate_per_sqft_paise ?? body.price_paise ?? 0,
            floorRiseStepPaisePerSqft: body.floor_rise_step_paise ?? null, floorStart: block.floorStart,
          });
        } catch (e) { translateDomainError(e); }
        await applyPriceUpdates(tx, results.map((r) => ({ id: r.id, price: r.pricePaise, rate: r.ratePerSqftPaise, breakup: breakupToDb(r.breakup) })), null);
        const byId = new Map(rows.map((r) => [r.id, r]));
        await writeAuditMany(tx, results.map((r) => ({ companyId: user.companyId, ...meta(req), action: "flat.price", entityType: "flat", entityId: r.id, before: { price_paise: byId.get(r.id)?.pricePaise, price_breakup: byId.get(r.id)?.breakup }, after: { price_paise: r.pricePaise, price_breakup: breakupToDb(r.breakup), flat_number: byId.get(r.id)?.flatNumber, bulk: true } })));
        await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: "block.bulk_price", entityType: "block", entityId: block.id, after: { updated: results.length, skipped: skipped.length, mode: body.rate_per_sqft_paise !== undefined ? "rate" : "price", floor_rise_step_paise: body.floor_rise_step_paise ?? null } });
        return { updated: results.length, skipped: skipped.length, skipped_ids: skipped };
      });
    },
  });

  for (const action of ["deactivate", "activate"] as const) {
    route(app, {
      method: "POST", url: `/blocks/:id/${action}`, permission: "block.write",
      schema: { params: idParams, body: VersionedSchema.partial().optional(), response: { 200: ActiveStateResponseSchema }, summary: `${action === "deactivate" ? "Deactivate" : "Restore"} a block (deactivate only while every flat is Available)` },
      handler: async (req) => {
        const user = req.user!;
        return app.db.transaction(async (tx) => {
          const existing = await loadBlock(tx, user, req.params.id, true);
          if (action === "deactivate") {
            const { nonAvailable } = await nonAvailableCount(tx, existing.id);
            if (nonAvailable > 0) throw ApiError.conflict("IN_USE", `${nonAvailable} flat(s) of this block are not Available; it cannot be deactivated`, { usage_count: nonAvailable, used_by: [{ entity_type: "flats", count: nonAvailable }] });
          }
          const version = optionalExpectedVersion(req, req.body, existing.version);
          const updated = await applyUpdate(tx, blocks, existing.id, version, action === "deactivate" ? { isActive: false, deactivatedAt: new Date() } : { isActive: true, deactivatedAt: null }, "block");
          await writeAudit(tx, { companyId: user.companyId, ...meta(req), action: `block.${action}`, entityType: "block", entityId: existing.id, before: { is_active: existing.isActive }, after: { is_active: updated.isActive } });
          await refreshProjectCounts(tx, existing.projectId);
          return { id: updated.id, is_active: updated.isActive, version: updated.version };
        });
      },
    });
  }
}
