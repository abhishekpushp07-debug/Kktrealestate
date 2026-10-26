/**
 * Inventory service: shared helpers for projects, blocks, flats, parking and rate cards.
 * Exports `refreshUnitCounts(tx, blockId)` and `ensureBlockStages(tx, blockId)` for the booking/construction engines.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { VersionSchema, type UnitCounts } from "@kkt/contracts";
import {
  auditLogs,
  blockStages,
  blocks,
  constructionStages,
  flatTypes,
  flats,
  floorPlanTemplates,
  plcTypes,
  projects,
  rateCardPlcRules,
  rateCardRates,
  rateCards,
  type Executor,
  type FlatTypeArea,
  type FlatTypeRoom,
  type PriceBreakupLine,
} from "@kkt/db";
import {
  FlatGenerationError,
  PricingError,
  generateFlats,
  resolveFlatPrice,
  type AreaSnapshot,
  type BlockDefinition,
  type FlatDraft,
  type FlatTypeDefinition,
  type FloorPlanTemplate,
  type PriceResult,
  type PricingFlat,
  type RateCard,
  type RoomSnapshot,
} from "@kkt/domain";
import { actorFromRequest, stripSensitive, type AuditEntry } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { ensureProjectAccess, type StaffContext } from "../../lib/scope.js";

export type DbProject = typeof projects.$inferSelect;
export type DbBlock = typeof blocks.$inferSelect;
export type DbFlat = typeof flats.$inferSelect;
export type DbFlatType = typeof flatTypes.$inferSelect;
export type DbRateCard = typeof rateCards.$inferSelect;

/** Statuses a staff member may set by hand; BOOKED/SOLD belong to the booking engine. */
export const MANUAL_STATUSES = new Set(["AVAILABLE", "HOLD", "BLOCKED"]);
/** Statuses owned by the booking engine. */
export const ENGINE_STATUSES = new Set(["BOOKED", "SOLD"]);

/** Unwraps optional/default wrappers of a Zod field (Zod 4 keeps `.default()` through `.partial()`, which would reset omitted PATCH fields). */
function stripDefaults(field: z.ZodType): z.ZodType {
  let s = field;
  for (;;) {
    const def = (s as unknown as { _zod?: { def?: { type?: string; innerType?: z.ZodType } } })._zod?.def;
    if (def && (def.type === "optional" || def.type === "default") && def.innerType) s = def.innerType;
    else return s;
  }
}

/**
 * PATCH body schema from an Update schema: every field plainly optional (no defaults, so an omitted key means "unchanged")
 * and `version` optional so it may also arrive via `If-Match` (expectedVersion() enforces one of them).
 */
export function patchBody<T extends z.ZodType>(schema: T): T {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  if (!shape) return schema;
  const out: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(shape))
    out[k] = k === "version" ? VersionSchema.optional() : stripDefaults(v).optional();
  return z.strictObject(out) as unknown as T;
}

/** Request metadata for audit rows. */
export function meta(req: FastifyRequest): Pick<AuditEntry, "actor" | "ip" | "requestId"> {
  return { actor: actorFromRequest(req), ip: req.clientIp, requestId: req.id };
}

/** Appends many audit rows in one insert (bulk flat changes, generation). */
export async function writeAuditMany(tx: Executor, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  for (let i = 0; i < entries.length; i += 500) {
    await tx.insert(auditLogs).values(
      entries.slice(i, i + 500).map((e) => ({
        companyId: e.companyId,
        actorType: e.actor.type,
        actorId: e.actor.id,
        actorName: e.actor.name,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        before: e.before ? stripSensitive(e.before) : null,
        after: e.after ? stripSensitive(e.after) : null,
        ip: e.ip ?? null,
        requestId: e.requestId ?? null,
      })),
    );
  }
}

// ---------------------------------------------------------------------------
// Loading with scope (404 outside the user's projects, never 403)
// ---------------------------------------------------------------------------

/** Loads a project of the company the user may see; 404 when missing or out of scope. */
export async function loadProject(
  db: Executor,
  user: StaffContext,
  projectId: string,
  forUpdate = false,
): Promise<DbProject> {
  ensureProjectAccess(user, projectId);
  const q = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, user.companyId)))
    .limit(1)
    .$dynamic();
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw ApiError.notFound("Project");
  return row;
}

/** Loads a block the user may see (scope through its project); 404 otherwise. */
export async function loadBlock(
  db: Executor,
  user: StaffContext,
  blockId: string,
  forUpdate = false,
): Promise<DbBlock> {
  const q = db
    .select()
    .from(blocks)
    .where(and(eq(blocks.id, blockId), eq(blocks.companyId, user.companyId)))
    .limit(1)
    .$dynamic();
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw ApiError.notFound("Block");
  ensureProjectAccess(user, row.projectId, "Block");
  return row;
}

/** Loads a flat the user may see (scope through its project); 404 otherwise. */
export async function loadFlat(db: Executor, user: StaffContext, flatId: string, forUpdate = false): Promise<DbFlat> {
  const q = db
    .select()
    .from(flats)
    .where(and(eq(flats.id, flatId), eq(flats.companyId, user.companyId)))
    .limit(1)
    .$dynamic();
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw ApiError.notFound("Flat");
  ensureProjectAccess(user, row.projectId, "Flat");
  return row;
}

// ---------------------------------------------------------------------------
// Unit counts
// ---------------------------------------------------------------------------

/**
 * Recomputes `unit_counts` of a block and of its project (plus the project's `block_count`) from the flats table in ONE statement.
 * Versions are not bumped (derived data). Call after generation, bulk changes and every flat status change (the booking engine too).
 */
export async function refreshUnitCounts(tx: Executor, blockId: string): Promise<UnitCounts> {
  const rows = await tx.execute<{ block_counts: UnitCounts | null }>(sql`
    with bc as (
      select count(*) filter (where status = 'AVAILABLE')::int as available,
             count(*) filter (where status = 'HOLD')::int as hold,
             count(*) filter (where status = 'BLOCKED')::int as blocked,
             count(*) filter (where status = 'BOOKED')::int as booked,
             count(*) filter (where status = 'SOLD')::int as sold,
             count(*)::int as total
      from flats where block_id = ${blockId}::uuid
    ), ub as (
      update blocks b
         set unit_counts = jsonb_build_object('available', bc.available, 'hold', bc.hold, 'blocked', bc.blocked, 'booked', bc.booked, 'sold', bc.sold, 'total', bc.total)
        from bc where b.id = ${blockId}::uuid
      returning b.project_id
    ), pc as (
      select count(*) filter (where f.status = 'AVAILABLE')::int as available,
             count(*) filter (where f.status = 'HOLD')::int as hold,
             count(*) filter (where f.status = 'BLOCKED')::int as blocked,
             count(*) filter (where f.status = 'BOOKED')::int as booked,
             count(*) filter (where f.status = 'SOLD')::int as sold,
             count(*)::int as total
      from flats f join blocks b on b.id = f.block_id where f.project_id = (select project_id from ub) and b.is_active
    ), bcnt as (
      select count(*)::int as n from blocks where project_id = (select project_id from ub) and is_active
    )
    update projects p
       set unit_counts = jsonb_build_object('available', pc.available, 'hold', pc.hold, 'blocked', pc.blocked, 'booked', pc.booked, 'sold', pc.sold, 'total', pc.total),
           block_count = bcnt.n
      from pc, bcnt where p.id = (select project_id from ub)
    returning (select to_jsonb(bc) from bc) as block_counts`);
  const counts = rows[0]?.block_counts;
  if (!counts) throw ApiError.notFound("Block");
  return counts;
}

/** Recomputes a project's block_count and unit_counts when a block is (de)activated without a flat change. */
export async function refreshProjectCounts(tx: Executor, projectId: string): Promise<void> {
  await tx.execute(sql`
    with pc as (
      select count(*) filter (where f.status = 'AVAILABLE')::int as available,
             count(*) filter (where f.status = 'HOLD')::int as hold,
             count(*) filter (where f.status = 'BLOCKED')::int as blocked,
             count(*) filter (where f.status = 'BOOKED')::int as booked,
             count(*) filter (where f.status = 'SOLD')::int as sold,
             count(*)::int as total
      from flats f join blocks b on b.id = f.block_id where f.project_id = ${projectId}::uuid and b.is_active
    ), bcnt as (select count(*)::int as n from blocks where project_id = ${projectId}::uuid and is_active)
    update projects p
       set unit_counts = jsonb_build_object('available', pc.available, 'hold', pc.hold, 'blocked', pc.blocked, 'booked', pc.booked, 'sold', pc.sold, 'total', pc.total),
           block_count = bcnt.n
      from pc, bcnt where p.id = ${projectId}::uuid`);
}

// ---------------------------------------------------------------------------
// Stage sequences and block_stages snapshots
// ---------------------------------------------------------------------------

/** Active construction stages of the company in master order. */
export async function masterStageOrder(db: Executor, companyId: string): Promise<string[]> {
  const rows = await db
    .select({ id: constructionStages.id })
    .from(constructionStages)
    .where(and(eq(constructionStages.companyId, companyId), eq(constructionStages.isActive, true)))
    .orderBy(asc(constructionStages.sortOrder), asc(constructionStages.name));
  return rows.map((r) => r.id);
}

/** 400 unless every id is a construction stage of the company and no id repeats. */
export async function assertStageSequence(db: Executor, companyId: string, ids: readonly string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) throw ApiError.invalid("stage_sequence", "stage_sequence repeats a stage");
  if (ids.length === 0) return;
  const found = await db
    .select({ id: constructionStages.id })
    .from(constructionStages)
    .where(and(eq(constructionStages.companyId, companyId), inArray(constructionStages.id, [...ids])));
  if (found.length !== ids.length)
    throw ApiError.invalid("stage_sequence", "stage_sequence references an unknown construction stage");
}

/**
 * Snapshots `block_stages` from the block's stage_sequence when the block has none yet (idempotent). Returns the number of stage rows now present.
 * The construction module owns stage status changes; this keeps snapshot creation in the inventory module.
 */
export async function ensureBlockStages(tx: Executor, blockId: string): Promise<number> {
  const [block] = await tx
    .select({ id: blocks.id, companyId: blocks.companyId, stageSequence: blocks.stageSequence })
    .from(blocks)
    .where(eq(blocks.id, blockId))
    .limit(1);
  if (!block) throw ApiError.notFound("Block");
  const [existing] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(blockStages)
    .where(eq(blockStages.blockId, blockId));
  if (existing && Number(existing.n) > 0) return Number(existing.n);
  return snapshotBlockStages(tx, block);
}

/** Replaces the block_stages snapshot from the block's stage_sequence (callers ensure every current stage is PENDING). */
export async function snapshotBlockStages(
  tx: Executor,
  block: { id: string; companyId: string; stageSequence: string[] },
): Promise<number> {
  await tx.delete(blockStages).where(eq(blockStages.blockId, block.id));
  if (block.stageSequence.length === 0) return 0;
  const stages = await tx
    .select({ id: constructionStages.id, name: constructionStages.name, isPossession: constructionStages.isPossession })
    .from(constructionStages)
    .where(inArray(constructionStages.id, block.stageSequence));
  const byId = new Map(stages.map((s) => [s.id, s]));
  const values = block.stageSequence.flatMap((stageId, i) => {
    const s = byId.get(stageId);
    return s
      ? [
          {
            companyId: block.companyId,
            blockId: block.id,
            stageId,
            sortOrder: (i + 1) * 10,
            name: s.name,
            isPossession: s.isPossession,
          },
        ]
      : [];
  });
  if (values.length > 0) await tx.insert(blockStages).values(values);
  return values.length;
}

/** True when every stage snapshot of the given blocks is still PENDING (nothing started). */
export async function allStagesPending(db: Executor, blockIds: readonly string[]): Promise<boolean> {
  if (blockIds.length === 0) return true;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blockStages)
    .where(and(inArray(blockStages.blockId, [...blockIds]), sql`${blockStages.status} <> 'PENDING'`));
  return Number(row?.n ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// Rate cards → domain
// ---------------------------------------------------------------------------

/** Rate card with its rates and PLC rules in the domain shape (rule label = PLC type name). */
export interface LoadedRateCard {
  id: string;
  card: RateCard;
}

/** Loads one rate card (any status) with rates and rules as a domain RateCard. */
export async function loadRateCardDomain(db: Executor, rateCardId: string): Promise<LoadedRateCard | null> {
  const [rates, rules] = await Promise.all([
    db
      .select({
        flatTypeId: rateCardRates.flatTypeId,
        ratePerSqftPaise: rateCardRates.ratePerSqftPaise,
        lumpSumPaise: rateCardRates.lumpSumPaise,
      })
      .from(rateCardRates)
      .where(eq(rateCardRates.rateCardId, rateCardId)),
    db
      .select({ r: rateCardPlcRules, name: plcTypes.name })
      .from(rateCardPlcRules)
      .innerJoin(plcTypes, eq(plcTypes.id, rateCardPlcRules.plcTypeId))
      .where(eq(rateCardPlcRules.rateCardId, rateCardId))
      .orderBy(asc(rateCardPlcRules.sortOrder), asc(rateCardPlcRules.createdAt)),
  ]);
  return {
    id: rateCardId,
    card: {
      rates: rates.map((r) => ({
        flatTypeId: r.flatTypeId,
        ratePerSqftPaise: r.ratePerSqftPaise,
        lumpSumPaise: r.lumpSumPaise,
      })),
      plcRules: rules.map(({ r, name }) => ({
        plcTypeId: r.plcTypeId,
        name,
        calcMode: r.calcMode,
        value: Number(r.value),
        appliesTo: r.appliesTo,
        floorsGte: r.floorsGte,
        facings: r.facings,
      })),
    },
  };
}

/** The project's ACTIVE rate card as a domain RateCard, or null. */
export async function loadActiveRateCard(db: Executor, projectId: string): Promise<LoadedRateCard | null> {
  const [card] = await db
    .select({ id: rateCards.id })
    .from(rateCards)
    .where(and(eq(rateCards.projectId, projectId), eq(rateCards.status, "ACTIVE")))
    .limit(1);
  return card ? loadRateCardDomain(db, card.id) : null;
}

// ---------------------------------------------------------------------------
// Flat types → domain, pricing
// ---------------------------------------------------------------------------

/** Snapshot rows stored on flats/flat types (snake_case) → domain (camelCase). */
export function roomsToDomain(rooms: readonly FlatTypeRoom[]): RoomSnapshot[] {
  return rooms.map((r) => ({
    roomTypeId: r.room_type_id,
    roomTypeName: r.room_type_name,
    label: r.label,
    lengthFt: Number(r.length_ft),
    widthFt: Number(r.width_ft),
    sqft: Number(r.sqft),
  }));
}
export function areasToDomain(areas: readonly FlatTypeArea[]): AreaSnapshot[] {
  return areas.map((a) => ({
    areaTypeId: a.area_type_id,
    areaTypeCode: a.area_type_code,
    areaTypeName: a.area_type_name,
    sqft: Number(a.sqft),
  }));
}
export function roomsToDb(rooms: readonly RoomSnapshot[]): FlatTypeRoom[] {
  return rooms.map((r) => ({
    room_type_id: r.roomTypeId,
    room_type_name: r.roomTypeName,
    label: r.label,
    length_ft: r.lengthFt,
    width_ft: r.widthFt,
    sqft: r.sqft,
  }));
}
export function areasToDb(areas: readonly AreaSnapshot[]): FlatTypeArea[] {
  return areas.map((a) => ({
    area_type_id: a.areaTypeId,
    area_type_code: a.areaTypeCode,
    area_type_name: a.areaTypeName,
    sqft: a.sqft,
  }));
}
export function breakupToDb(lines: readonly { label: string; amountPaise: number }[]): PriceBreakupLine[] {
  return lines.map((l) => ({ label: l.label, amount_paise: l.amountPaise }));
}

/** Flat type row → domain definition (with validation inputs). */
export function flatTypeToDomain(ft: DbFlatType): FlatTypeDefinition {
  return {
    id: ft.id,
    code: ft.code,
    name: ft.name,
    facing: ft.facing,
    rooms: roomsToDomain(ft.rooms),
    areas: areasToDomain(ft.areas),
    carpetSqft: Number(ft.carpetSqft),
    builtupSqft: Number(ft.builtupSqft),
    superBuiltupSqft: Number(ft.superBuiltupSqft),
    baseRatePerSqftPaise: ft.baseRatePerSqftPaise,
    basePricePaise: ft.basePricePaise,
  };
}

/** Loads flat types of the company by id (any state; generation refuses inactive ones). */
export async function loadFlatTypes(db: Executor, companyId: string, ids: readonly string[]): Promise<DbFlatType[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return db
    .select()
    .from(flatTypes)
    .where(and(eq(flatTypes.companyId, companyId), inArray(flatTypes.id, unique)));
}

/** Loads floor-plan templates of the company by id in the domain shape. */
export async function loadTemplates(
  db: Executor,
  companyId: string,
  ids: readonly string[],
): Promise<{ templates: FloorPlanTemplate[]; names: Map<string, string>; flatTypeIds: string[] }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { templates: [], names: new Map(), flatTypeIds: [] };
  const rows = await db
    .select()
    .from(floorPlanTemplates)
    .where(and(eq(floorPlanTemplates.companyId, companyId), inArray(floorPlanTemplates.id, unique)));
  if (rows.length !== unique.length) throw ApiError.invalid("floor_plans", "Unknown floor-plan template id");
  for (const t of rows)
    if (!t.isActive)
      throw ApiError.rule(`Floor-plan template ${t.name} is inactive`, "TEMPLATE_INACTIVE", { template_id: t.id });
  return {
    templates: rows.map((t) => ({
      id: t.id,
      flatsPerFloor: t.flatsPerFloor,
      positions: t.positions.map((p) => ({
        position: p.position,
        flatTypeId: p.flat_type_id,
        facing: p.facing ?? null,
        isCorner: p.is_corner,
      })),
    })),
    names: new Map(rows.map((t) => [t.id, t.name])),
    flatTypeIds: [...new Set(rows.flatMap((t) => t.positions.map((p) => p.flat_type_id)))],
  };
}

/** Converts domain engine failures into 422 BUSINESS_RULE errors. */
export function translateDomainError(err: unknown): never {
  if (err instanceof FlatGenerationError) throw ApiError.rule(err.message, err.code, err.details);
  if (err instanceof PricingError) throw ApiError.rule(err.message, err.code);
  throw err;
}

/** Prices one flat with the active rate card (when it covers the type) or the flat type's base; wraps domain errors. */
export function priceWith(
  rateCard: LoadedRateCard | null,
  flat: PricingFlat,
  ft: Pick<FlatTypeDefinition, "baseRatePerSqftPaise" | "basePricePaise" | "superBuiltupSqft">,
): { price: PriceResult; rateCardId: string | null } {
  try {
    const usesCard = rateCard !== null && rateCard.card.rates.some((r) => r.flatTypeId === flat.flatTypeId);
    const price = resolveFlatPrice({
      flat,
      flatType: {
        baseRatePerSqftPaise: ft.baseRatePerSqftPaise,
        basePricePaise: ft.basePricePaise,
        superBuiltupSqft: ft.superBuiltupSqft,
      },
      rateCard: rateCard?.card ?? null,
    });
    return { price, rateCardId: usesCard ? rateCard.id : null };
  } catch (e) {
    translateDomainError(e);
  }
}

/** Block row → domain block definition. */
export function blockToDefinition(
  b: Pick<
    DbBlock,
    | "code"
    | "floors"
    | "floorStart"
    | "groundFloorLabel"
    | "skipFloors"
    | "refugeFloors"
    | "podiumFloors"
    | "floorPlans"
    | "numberingPattern"
  >,
): BlockDefinition {
  return {
    code: b.code,
    floors: b.floors,
    floorStart: b.floorStart,
    groundFloorLabel: b.groundFloorLabel,
    skipFloors: b.skipFloors,
    refugeFloors: b.refugeFloors,
    podiumFloors: b.podiumFloors,
    floorPlans: b.floorPlans.map((r) => ({
      fromFloor: r.from_floor,
      toFloor: r.to_floor,
      floorPlanTemplateId: r.floor_plan_template_id,
    })),
    numberingPattern: b.numberingPattern,
  };
}

/** Runs the domain generator for a block definition against the company's templates, flat types and the project's active rate card. */
export async function draftFlats(
  tx: Executor,
  companyId: string,
  projectId: string,
  def: BlockDefinition,
): Promise<{ drafts: FlatDraft[]; rateCard: LoadedRateCard | null }> {
  const { templates, flatTypeIds } = await loadTemplates(
    tx,
    companyId,
    def.floorPlans.map((r) => r.floorPlanTemplateId),
  );
  const types = await loadFlatTypes(tx, companyId, flatTypeIds);
  for (const ft of types)
    if (!ft.isActive)
      throw ApiError.rule(`Flat type ${ft.name} is inactive`, "FLAT_TYPE_INACTIVE", { flat_type_id: ft.id });
  const rateCard = await loadActiveRateCard(tx, projectId);
  const domainTypes = types.map(flatTypeToDomain);
  try {
    const drafts = generateFlats(
      def,
      templates,
      domainTypes,
      (ctx) =>
        priceWith(
          rateCard,
          {
            floor: ctx.floor,
            floorStart: ctx.floorStart,
            superBuiltupSqft: ctx.flatType.superBuiltupSqft,
            isCorner: ctx.isCorner,
            facing: ctx.facing,
            flatTypeId: ctx.flatType.id,
          },
          ctx.flatType,
        ).price,
    );
    return { drafts, rateCard };
  } catch (e) {
    translateDomainError(e);
  }
}

/** Inserts drafts as flats of the block (chunked); returns the inserted ids. */
export async function insertDrafts(
  tx: Executor,
  block: Pick<DbBlock, "id" | "companyId" | "projectId">,
  drafts: readonly FlatDraft[],
  rateCard: LoadedRateCard | null,
  createdBy: string | null,
): Promise<{ id: string; flatNumber: string }[]> {
  const out: { id: string; flatNumber: string }[] = [];
  for (let i = 0; i < drafts.length; i += 400) {
    const rows = await tx
      .insert(flats)
      .values(
        drafts.slice(i, i + 400).map((d) => ({
          companyId: block.companyId,
          projectId: block.projectId,
          blockId: block.id,
          flatNumber: d.flatNumber,
          floor: d.floor,
          floorLabel: d.floorLabel,
          position: d.position,
          flatTypeId: d.flatTypeId,
          flatTypeCode: d.flatTypeCode,
          facing: d.facing,
          isCorner: d.isCorner,
          status: "AVAILABLE" as const,
          roomsSnapshot: roomsToDb(d.roomsSnapshot),
          areasSnapshot: areasToDb(d.areasSnapshot),
          carpetSqft: d.carpetSqft,
          builtupSqft: d.builtupSqft,
          superBuiltupSqft: d.superBuiltupSqft,
          ratePerSqftPaise: d.ratePerSqftPaise,
          pricePaise: d.pricePaise,
          priceBreakup: breakupToDb(d.priceBreakup),
          rateCardId: rateCard && rateCard.card.rates.some((r) => r.flatTypeId === d.flatTypeId) ? rateCard.id : null,
          createdBy,
        })),
      )
      .returning({ id: flats.id, flatNumber: flats.flatNumber });
    out.push(...rows);
  }
  return out;
}

/** One flat re-priced by repriceFlats (before/after for audit rows). */
export interface RepriceChange {
  id: string;
  flatNumber: string;
  before: {
    price_paise: number;
    rate_per_sqft_paise: number | null;
    price_breakup: PriceBreakupLine[];
    rate_card_id: string | null;
  };
  after: {
    price_paise: number;
    rate_per_sqft_paise: number | null;
    price_breakup: PriceBreakupLine[];
    rate_card_id: string;
  };
}

/** Result of repriceFlats. */
export interface RepriceResult {
  repriced: number;
  skipped_not_available: number;
  skipped_no_rate: number;
  changes: RepriceChange[];
}

/**
 * Re-prices ONLY the AVAILABLE flats of a project (optionally one block) with a rate card (SPEC §5): Hold/Booked/Sold keep their price,
 * types the card has no rate for are skipped. Writes nothing when `dryRun`; the caller writes the audit rows from `changes`.
 */
export async function repriceFlats(
  tx: Executor,
  companyId: string,
  card: LoadedRateCard,
  where: { projectId: string; blockId?: string | undefined },
  dryRun: boolean,
): Promise<RepriceResult> {
  const conditions = [
    eq(flats.companyId, companyId),
    eq(flats.projectId, where.projectId),
    where.blockId ? eq(flats.blockId, where.blockId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const rows = await tx
    .select({
      id: flats.id,
      flatNumber: flats.flatNumber,
      status: flats.status,
      floor: flats.floor,
      floorStart: blocks.floorStart,
      superBuiltupSqft: flats.superBuiltupSqft,
      isCorner: flats.isCorner,
      facing: flats.facing,
      flatTypeId: flats.flatTypeId,
      pricePaise: flats.pricePaise,
      ratePerSqftPaise: flats.ratePerSqftPaise,
      priceBreakup: flats.priceBreakup,
      rateCardId: flats.rateCardId,
    })
    .from(flats)
    .innerJoin(blocks, eq(blocks.id, flats.blockId))
    .where(and(...conditions))
    .orderBy(asc(flats.blockId), asc(flats.floor), asc(flats.position));
  const rated = new Set(card.card.rates.map((r) => r.flatTypeId));
  const updates: { id: string; price: number; rate: number | null; breakup: PriceBreakupLine[] }[] = [];
  const changes: RepriceChange[] = [];
  let skippedNotAvailable = 0;
  let skippedNoRate = 0;
  for (const f of rows) {
    if (f.status !== "AVAILABLE") {
      skippedNotAvailable += 1;
      continue;
    }
    if (!rated.has(f.flatTypeId)) {
      skippedNoRate += 1;
      continue;
    }
    const { price } = priceWith(
      card,
      {
        floor: f.floor,
        floorStart: f.floorStart,
        superBuiltupSqft: Number(f.superBuiltupSqft),
        isCorner: f.isCorner,
        facing: f.facing,
        flatTypeId: f.flatTypeId,
      },
      { baseRatePerSqftPaise: null, basePricePaise: null, superBuiltupSqft: Number(f.superBuiltupSqft) },
    );
    const breakup = breakupToDb(price.breakup);
    updates.push({ id: f.id, price: price.totalPaise, rate: price.ratePerSqftPaise, breakup });
    changes.push({
      id: f.id,
      flatNumber: f.flatNumber,
      before: {
        price_paise: f.pricePaise,
        rate_per_sqft_paise: f.ratePerSqftPaise,
        price_breakup: f.priceBreakup,
        rate_card_id: f.rateCardId,
      },
      after: {
        price_paise: price.totalPaise,
        rate_per_sqft_paise: price.ratePerSqftPaise,
        price_breakup: breakup,
        rate_card_id: card.id,
      },
    });
  }
  if (!dryRun && updates.length > 0) await applyPriceUpdates(tx, updates, card.id);
  return {
    repriced: updates.length,
    skipped_not_available: skippedNotAvailable,
    skipped_no_rate: skippedNoRate,
    changes,
  };
}

/** Applies many price updates in one statement (version bumped per flat). */
export async function applyPriceUpdates(
  tx: Executor,
  updates: readonly { id: string; price: number; rate: number | null; breakup: PriceBreakupLine[] }[],
  rateCardId: string | null,
): Promise<void> {
  if (updates.length === 0) return;
  const payload = JSON.stringify(updates.map((u) => ({ id: u.id, price: u.price, rate: u.rate, breakup: u.breakup })));
  await tx.execute(sql`
    update flats f
       set price_paise = x.price, rate_per_sqft_paise = x.rate, price_breakup = x.breakup, rate_card_id = ${rateCardId}::uuid, version = f.version + 1
      from jsonb_to_recordset(${payload}::jsonb) as x(id uuid, price bigint, rate bigint, breakup jsonb)
     where f.id = x.id`);
}

/** Positions across the widest floor of a block (for the grid). */
export function maxPositions(cellsByFloor: Iterable<number>): number {
  let max = 0;
  for (const n of cellsByFloor) if (n > max) max = n;
  return max;
}
