import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  AmenityCreateSchema,
  AmenityListResponseSchema,
  AmenityRowSchema,
  AmenityUpdateSchema,
  AreaTypeCreateSchema,
  AreaTypeListResponseSchema,
  AreaTypeRowSchema,
  AreaTypeUpdateSchema,
  BankAccountCreateSchema,
  BankAccountListResponseSchema,
  BankAccountRowSchema,
  BankAccountUpdateSchema,
  BlockTypeCreateSchema,
  BlockTypeListResponseSchema,
  BlockTypeRowSchema,
  BlockTypeUpdateSchema,
  ChargeTypeCreateSchema,
  ChargeTypeListResponseSchema,
  ChargeTypeRowSchema,
  ChargeTypeUpdateSchema,
  ConstructionStageCreateSchema,
  ConstructionStageListResponseSchema,
  ConstructionStageReorderSchema,
  ConstructionStageRowSchema,
  ConstructionStageUpdateSchema,
  DocumentTypeCreateSchema,
  DocumentTypeListResponseSchema,
  DocumentTypeRowSchema,
  DocumentTypeUpdateSchema,
  FlatTypeCreateSchema,
  FlatTypeFilterSchema,
  FlatTypeListResponseSchema,
  FlatTypeRowSchema,
  FlatTypeUpdateSchema,
  FloorPlanTemplateCreateSchema,
  FloorPlanTemplateListResponseSchema,
  FloorPlanTemplateRowSchema,
  FloorPlanTemplateUpdateSchema,
  PAYMENT_MODE_DEFAULTS,
  PaymentModeCreateSchema,
  PaymentModeListResponseSchema,
  PaymentModeRowSchema,
  PaymentModeUpdateSchema,
  PaymentPlanCreateSchema,
  PaymentPlanFilterSchema,
  PaymentPlanListResponseSchema,
  PaymentPlanRowSchema,
  PaymentPlanUpdateSchema,
  PlcTypeCreateSchema,
  PlcTypeListResponseSchema,
  PlcTypeRowSchema,
  PlcTypeUpdateSchema,
  RoomTypeCreateSchema,
  RoomTypeListResponseSchema,
  RoomTypeRowSchema,
  RoomTypeUpdateSchema,
  ServiceCategoryCreateSchema,
  ServiceCategoryListResponseSchema,
  ServiceCategoryRowSchema,
  ServiceCategoryUpdateSchema,
  SpecCategoryCreateSchema,
  SpecCategoryListResponseSchema,
  SpecCategoryRowSchema,
  SpecCategoryUpdateSchema,
  SpecItemCreateSchema,
  SpecItemFilterSchema,
  SpecItemListResponseSchema,
  SpecItemRowSchema,
  SpecItemUpdateSchema,
  type InstallmentInput,
  type PaymentModeCode,
  type TriggerType,
} from "@kkt/contracts";
import {
  amenities,
  areaTypes,
  bankAccounts,
  blockTypes,
  chargeTypes,
  constructionStages,
  documentTypes,
  flatTypes,
  floorPlanTemplates,
  paymentModes,
  paymentPlanInstallments,
  paymentPlans,
  plcTypes,
  roomTypes,
  serviceCategories,
  specCategories,
  specItems,
  type Executor,
} from "@kkt/db";
import { maskAccount, validateFlatType, validatePlan } from "@kkt/domain";
import { actorFromRequest, writeAudit } from "../../lib/audit.js";
import { decryptField, encryptField } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { camelRow, snakeRow } from "../../lib/rows.js";
import { assertPlanFitsActiveAssignments } from "../money/index.js";
import { countWhere } from "./factory.js";
import type { DbRow, MasterKindDef, MasterTable, UsageLine } from "./types.js";

const BASE_CSV = ["id", "is_active", "version"];

/** Default batch mapper: camelCase → snake_case, Dates → ISO. */
async function plainRows(_db: Executor, rows: DbRow[]): Promise<Record<string, unknown>[]> {
  return rows.map((r) => snakeRow(r));
}

/** Default input mapper: snake_case wire keys → camelCase column properties. */
async function plainPrepare(_tx: Executor, input: Record<string, unknown>): Promise<DbRow> {
  return camelRow(input);
}

interface SimpleKindOptions {
  kind: MasterKindDef["kind"];
  path: string;
  entity: string;
  table: MasterTable;
  schemas: { create: z.ZodType; update: z.ZodType; row: z.ZodType; list: z.ZodType; filter?: z.ZodType };
  search: AnyPgColumn[];
  sortable: Record<string, AnyPgColumn>;
  defaultSort: string;
  keyField: string;
  keyColumn: AnyPgColumn;
  csv: string[];
  usage: MasterKindDef["usage"];
  prepare?: MasterKindDef["prepare"];
  toRows?: MasterKindDef["toRows"];
  afterWrite?: MasterKindDef["afterWrite"];
  extraWhere?: MasterKindDef["extraWhere"];
  extraRoutes?: MasterKindDef["extraRoutes"];
}

function kind(o: SimpleKindOptions): MasterKindDef {
  return {
    kind: o.kind,
    path: o.path,
    entity: o.entity,
    table: o.table,
    createSchema: o.schemas.create,
    updateSchema: o.schemas.update,
    rowSchema: o.schemas.row,
    listSchema: o.schemas.list,
    filterSchema: o.schemas.filter,
    searchColumns: o.search,
    sortable: o.sortable,
    defaultSort: o.defaultSort,
    keyField: o.keyField,
    keyColumn: o.keyColumn,
    csvColumns: [...o.csv, ...BASE_CSV],
    usage: o.usage,
    prepare: o.prepare ?? plainPrepare,
    toRows: o.toRows ?? plainRows,
    afterWrite: o.afterWrite,
    extraWhere: o.extraWhere,
    extraRoutes: o.extraRoutes,
  };
}

const usage =
  (entity: string, table: string, where: SQL) =>
  async (db: Executor): Promise<UsageLine> => ({ entity_type: entity, count: await countWhere(db, table, where) });

async function usages(db: Executor, lines: ReturnType<typeof usage>[]): Promise<UsageLine[]> {
  return Promise.all(lines.map((l) => l(db)));
}

const idLit = (id: string) => sql`${id}::uuid`;

// ---------------------------------------------------------------------------
// Simple kinds
// ---------------------------------------------------------------------------

export const roomTypesKind = kind({
  kind: "ROOM_TYPES",
  path: "room-types",
  entity: "room_type",
  table: roomTypes,
  schemas: {
    create: RoomTypeCreateSchema,
    update: RoomTypeUpdateSchema,
    row: RoomTypeRowSchema,
    list: RoomTypeListResponseSchema,
  },
  search: [roomTypes.name, roomTypes.code],
  sortable: {
    name: roomTypes.name,
    code: roomTypes.code,
    sort_order: roomTypes.sortOrder,
    created_at: roomTypes.createdAt,
  },
  defaultSort: "sort_order",
  keyField: "code",
  keyColumn: roomTypes.code,
  csv: ["name", "code", "sort_order"],
  usage: (db, _c, id) =>
    usages(db, [usage("flat_types", "flat_types", sql`rooms @> ${JSON.stringify([{ room_type_id: id }])}::jsonb`)]),
});

export const areaTypesKind = kind({
  kind: "AREA_TYPES",
  path: "area-types",
  entity: "area_type",
  table: areaTypes,
  schemas: {
    create: AreaTypeCreateSchema,
    update: AreaTypeUpdateSchema,
    row: AreaTypeRowSchema,
    list: AreaTypeListResponseSchema,
  },
  search: [areaTypes.name, areaTypes.code],
  sortable: {
    name: areaTypes.name,
    code: areaTypes.code,
    sort_order: areaTypes.sortOrder,
    created_at: areaTypes.createdAt,
  },
  defaultSort: "sort_order",
  keyField: "code",
  keyColumn: areaTypes.code,
  csv: ["name", "code", "sort_order"],
  usage: (db, _c, id) =>
    usages(db, [usage("flat_types", "flat_types", sql`areas @> ${JSON.stringify([{ area_type_id: id }])}::jsonb`)]),
});

export const blockTypesKind = kind({
  kind: "BLOCK_TYPES",
  path: "block-types",
  entity: "block_type",
  table: blockTypes,
  schemas: {
    create: BlockTypeCreateSchema,
    update: BlockTypeUpdateSchema,
    row: BlockTypeRowSchema,
    list: BlockTypeListResponseSchema,
  },
  search: [blockTypes.name, blockTypes.code],
  sortable: { name: blockTypes.name, code: blockTypes.code, created_at: blockTypes.createdAt },
  defaultSort: "name",
  keyField: "code",
  keyColumn: blockTypes.code,
  csv: ["name", "code", "has_floors"],
  usage: (db, _c, id) => usages(db, [usage("blocks", "blocks", sql`block_type_id = ${idLit(id)}`)]),
});

export const amenitiesKind = kind({
  kind: "AMENITIES",
  path: "amenities",
  entity: "amenity",
  table: amenities,
  schemas: {
    create: AmenityCreateSchema,
    update: AmenityUpdateSchema,
    row: AmenityRowSchema,
    list: AmenityListResponseSchema,
  },
  search: [amenities.name, amenities.category],
  sortable: { name: amenities.name, category: amenities.category, created_at: amenities.createdAt },
  defaultSort: "name",
  keyField: "name",
  keyColumn: amenities.name,
  csv: ["name", "category", "icon"],
  usage: (db, _c, id) => usages(db, [usage("projects", "project_amenities", sql`amenity_id = ${idLit(id)}`)]),
});

export const chargeTypesKind = kind({
  kind: "CHARGE_TYPES",
  path: "charge-types",
  entity: "charge_type",
  table: chargeTypes,
  schemas: {
    create: ChargeTypeCreateSchema,
    update: ChargeTypeUpdateSchema,
    row: ChargeTypeRowSchema,
    list: ChargeTypeListResponseSchema,
  },
  search: [chargeTypes.name, chargeTypes.code],
  sortable: {
    name: chargeTypes.name,
    code: chargeTypes.code,
    default_amount_paise: chargeTypes.defaultAmountPaise,
    created_at: chargeTypes.createdAt,
  },
  defaultSort: "name",
  keyField: "code",
  keyColumn: chargeTypes.code,
  csv: ["name", "code", "default_amount_paise", "is_taxable", "default_gst_percent", "demand_at"],
  usage: (db, _c, id) =>
    usages(db, [usage("booking_other_charges", "booking_other_charges", sql`charge_type_id = ${idLit(id)}`)]),
});

export const documentTypesKind = kind({
  kind: "DOCUMENT_TYPES",
  path: "document-types",
  entity: "document_type",
  table: documentTypes,
  schemas: {
    create: DocumentTypeCreateSchema,
    update: DocumentTypeUpdateSchema,
    row: DocumentTypeRowSchema,
    list: DocumentTypeListResponseSchema,
  },
  search: [documentTypes.name, documentTypes.code],
  sortable: { name: documentTypes.name, code: documentTypes.code, created_at: documentTypes.createdAt },
  defaultSort: "name",
  keyField: "code",
  keyColumn: documentTypes.code,
  csv: ["name", "code", "applies_to", "is_kyc"],
  usage: (db, _c, id) => usages(db, [usage("documents", "documents", sql`document_type_id = ${idLit(id)}`)]),
});

export const plcTypesKind = kind({
  kind: "PLC_TYPES",
  path: "plc-types",
  entity: "plc_type",
  table: plcTypes,
  schemas: {
    create: PlcTypeCreateSchema,
    update: PlcTypeUpdateSchema,
    row: PlcTypeRowSchema,
    list: PlcTypeListResponseSchema,
  },
  search: [plcTypes.name, plcTypes.code],
  sortable: { name: plcTypes.name, code: plcTypes.code, created_at: plcTypes.createdAt },
  defaultSort: "name",
  keyField: "code",
  keyColumn: plcTypes.code,
  csv: ["name", "code", "calc_mode"],
  usage: (db, _c, id) =>
    usages(db, [usage("rate_card_plc_rules", "rate_card_plc_rules", sql`plc_type_id = ${idLit(id)}`)]),
});

export const specCategoriesKind = kind({
  kind: "SPEC_CATEGORIES",
  path: "spec-categories",
  entity: "spec_category",
  table: specCategories,
  schemas: {
    create: SpecCategoryCreateSchema,
    update: SpecCategoryUpdateSchema,
    row: SpecCategoryRowSchema,
    list: SpecCategoryListResponseSchema,
  },
  search: [specCategories.name],
  sortable: { name: specCategories.name, sort_order: specCategories.sortOrder, created_at: specCategories.createdAt },
  defaultSort: "sort_order",
  keyField: "name",
  keyColumn: specCategories.name,
  csv: ["name", "sort_order"],
  usage: (db, _c, id) => usages(db, [usage("spec_items", "spec_items", sql`category_id = ${idLit(id)}`)]),
});

export const serviceCategoriesKind = kind({
  kind: "SERVICE_CATEGORIES",
  path: "service-categories",
  entity: "service_category",
  table: serviceCategories,
  schemas: {
    create: ServiceCategoryCreateSchema,
    update: ServiceCategoryUpdateSchema,
    row: ServiceCategoryRowSchema,
    list: ServiceCategoryListResponseSchema,
  },
  search: [serviceCategories.name],
  sortable: {
    name: serviceCategories.name,
    sort_order: serviceCategories.sortOrder,
    created_at: serviceCategories.createdAt,
  },
  defaultSort: "sort_order",
  keyField: "name",
  keyColumn: serviceCategories.name,
  csv: ["name", "sort_order", "default_priority"],
  usage: (db, _c, id) => usages(db, [usage("service_requests", "service_requests", sql`category_id = ${idLit(id)}`)]),
});

// ---------------------------------------------------------------------------
// Spec items (category lookup)
// ---------------------------------------------------------------------------

export const specItemsKind = kind({
  kind: "SPEC_ITEMS",
  path: "spec-items",
  entity: "spec_item",
  table: specItems,
  schemas: {
    create: SpecItemCreateSchema,
    update: SpecItemUpdateSchema,
    row: SpecItemRowSchema,
    list: SpecItemListResponseSchema,
    filter: SpecItemFilterSchema,
  },
  search: [specItems.name, specItems.description],
  sortable: { name: specItems.name, sort_order: specItems.sortOrder, created_at: specItems.createdAt },
  defaultSort: "sort_order",
  keyField: "name",
  keyColumn: specItems.name,
  csv: ["name", "category_name", "description", "sort_order"],
  extraWhere: (q) => (typeof q["category_id"] === "string" ? eq(specItems.categoryId, q["category_id"]) : undefined),
  prepare: async (tx, input, ctx) => {
    if (typeof input["category_id"] === "string") {
      const [cat] = await tx
        .select({ id: specCategories.id, isActive: specCategories.isActive })
        .from(specCategories)
        .where(and(eq(specCategories.id, input["category_id"]), eq(specCategories.companyId, ctx.companyId)))
        .limit(1);
      if (!cat) throw ApiError.badRequest("category_id does not exist", { field: "category_id" });
      if (!cat.isActive) throw ApiError.rule("Specification category is inactive", "CATEGORY_INACTIVE");
    }
    return camelRow(input);
  },
  toRows: async (db, rows) => {
    const ids = [...new Set(rows.map((r) => String(r["categoryId"])))];
    const cats = ids.length
      ? await db
          .select({ id: specCategories.id, name: specCategories.name })
          .from(specCategories)
          .where(inArray(specCategories.id, ids))
      : [];
    const names = new Map(cats.map((c) => [c.id, c.name]));
    return rows.map((r) => ({ ...snakeRow(r), category_name: names.get(String(r["categoryId"])) ?? "" }));
  },
  usage: (db, _c, id) => usages(db, [usage("flat_types", "flat_types", sql`spec_item_ids @> array[${idLit(id)}]`)]),
});

// ---------------------------------------------------------------------------
// Flat types (room/area snapshots, denormalised areas, domain validation)
// ---------------------------------------------------------------------------

interface RoomIn {
  room_type_id: string;
  label: string;
  length_ft: number;
  width_ft: number;
  sqft?: number | null;
}
interface AreaIn {
  area_type_id: string;
  sqft: number;
}

export const flatTypesKind = kind({
  kind: "FLAT_TYPES",
  path: "flat-types",
  entity: "flat_type",
  table: flatTypes,
  schemas: {
    create: FlatTypeCreateSchema,
    update: FlatTypeUpdateSchema,
    row: FlatTypeRowSchema,
    list: FlatTypeListResponseSchema,
    filter: FlatTypeFilterSchema,
  },
  search: [flatTypes.name, flatTypes.code],
  sortable: {
    name: flatTypes.name,
    code: flatTypes.code,
    bhk: flatTypes.bhk,
    super_builtup_sqft: flatTypes.superBuiltupSqft,
    created_at: flatTypes.createdAt,
  },
  defaultSort: "name",
  keyField: "code",
  keyColumn: flatTypes.code,
  csv: [
    "name",
    "code",
    "bhk",
    "facing",
    "carpet_sqft",
    "builtup_sqft",
    "super_builtup_sqft",
    "base_rate_per_sqft_paise",
    "base_price_paise",
  ],
  extraWhere: (q) =>
    and(
      typeof q["bhk"] === "number" ? eq(flatTypes.bhk, q["bhk"]) : undefined,
      typeof q["facing"] === "string" && q["facing"] ? eq(flatTypes.facing, q["facing"]) : undefined,
    ),
  prepare: async (tx, input, ctx, existing) => {
    const values = camelRow(input);
    const merged = { ...(existing ?? {}), ...values } as Record<string, unknown>;
    const rooms = (merged["rooms"] as RoomIn[] | undefined) ?? [];
    const areas = (merged["areas"] as AreaIn[] | undefined) ?? [];
    if ("rooms" in values || !existing) {
      const ids = [...new Set(rooms.map((r) => r.room_type_id))];
      const found = ids.length
        ? await tx
            .select({ id: roomTypes.id, name: roomTypes.name, isActive: roomTypes.isActive })
            .from(roomTypes)
            .where(and(eq(roomTypes.companyId, ctx.companyId), inArray(roomTypes.id, ids)))
        : [];
      const byId = new Map(found.map((f) => [f.id, f]));
      values["rooms"] = rooms.map((r) => {
        const rt = byId.get(r.room_type_id);
        if (!rt) throw ApiError.badRequest(`Unknown room type ${r.room_type_id}`, { field: "rooms" });
        if (!rt.isActive) throw ApiError.rule(`Room type ${rt.name} is inactive`, "ROOM_TYPE_INACTIVE");
        const sqft = r.sqft ?? Math.round(r.length_ft * r.width_ft * 100) / 100;
        return {
          room_type_id: r.room_type_id,
          room_type_name: rt.name,
          label: r.label,
          length_ft: r.length_ft,
          width_ft: r.width_ft,
          sqft,
        };
      });
    }
    if ("areas" in values || !existing) {
      const ids = [...new Set(areas.map((a) => a.area_type_id))];
      if (ids.length !== areas.length) throw ApiError.badRequest("Each area type once", { field: "areas" });
      const found = ids.length
        ? await tx
            .select({ id: areaTypes.id, name: areaTypes.name, code: areaTypes.code, isActive: areaTypes.isActive })
            .from(areaTypes)
            .where(and(eq(areaTypes.companyId, ctx.companyId), inArray(areaTypes.id, ids)))
        : [];
      const byId = new Map(found.map((f) => [f.id, f]));
      const snap = areas.map((a) => {
        const at = byId.get(a.area_type_id);
        if (!at) throw ApiError.badRequest(`Unknown area type ${a.area_type_id}`, { field: "areas" });
        if (!at.isActive) throw ApiError.rule(`Area type ${at.name} is inactive`, "AREA_TYPE_INACTIVE");
        return { area_type_id: a.area_type_id, area_type_code: at.code, area_type_name: at.name, sqft: a.sqft };
      });
      values["areas"] = snap;
      const byCode = (code: string) => snap.find((s) => s.area_type_code === code)?.sqft ?? 0;
      values["carpetSqft"] = byCode("CARPET");
      values["builtupSqft"] = byCode("BUILT_UP");
      values["superBuiltupSqft"] = byCode("SUPER_BUILT_UP");
    }
    const finalRooms = (values["rooms"] ?? merged["rooms"] ?? []) as unknown[];
    const finalAreas = (values["areas"] ?? merged["areas"] ?? []) as unknown[];
    const carpet = Number(values["carpetSqft"] ?? merged["carpetSqft"] ?? 0);
    const builtup = Number(values["builtupSqft"] ?? merged["builtupSqft"] ?? 0);
    const superB = Number(values["superBuiltupSqft"] ?? merged["superBuiltupSqft"] ?? 0);
    const problems = validateFlatType({
      rooms: finalRooms as never,
      areas: finalAreas as never,
      carpetSqft: carpet,
      builtupSqft: builtup,
      superBuiltupSqft: superB,
    });
    const rate =
      values["baseRatePerSqftPaise"] !== undefined ? values["baseRatePerSqftPaise"] : merged["baseRatePerSqftPaise"];
    const lump = values["basePricePaise"] !== undefined ? values["basePricePaise"] : merged["basePricePaise"];
    if (rate != null && lump != null)
      problems.push({ code: "AREA_ORDER", message: "Give a base rate per sq ft or a lump-sum price, not both" });
    if (problems.length > 0)
      throw ApiError.rule(problems.map((p) => p.message).join("; "), "FLAT_TYPE_INVALID", { errors: problems });
    if (Array.isArray(values["specItemIds"]) && (values["specItemIds"] as string[]).length > 0) {
      const ids = [...new Set(values["specItemIds"] as string[])];
      const found = await tx
        .select({ id: specItems.id })
        .from(specItems)
        .where(and(eq(specItems.companyId, ctx.companyId), inArray(specItems.id, ids)));
      if (found.length !== ids.length)
        throw ApiError.badRequest("Unknown specification item id", { field: "spec_item_ids" });
      values["specItemIds"] = ids;
    }
    return values;
  },
  usage: (db, _c, id) =>
    usages(db, [
      usage(
        "floor_plan_templates",
        "floor_plan_templates",
        sql`positions @> ${JSON.stringify([{ flat_type_id: id }])}::jsonb`,
      ),
      usage("flats", "flats", sql`flat_type_id = ${idLit(id)}`),
    ]),
});

// ---------------------------------------------------------------------------
// Floor plan templates (flat type lookups)
// ---------------------------------------------------------------------------

export const floorPlanTemplatesKind = kind({
  kind: "FLOOR_PLAN_TEMPLATES",
  path: "floor-plan-templates",
  entity: "floor_plan_template",
  table: floorPlanTemplates,
  schemas: {
    create: FloorPlanTemplateCreateSchema,
    update: FloorPlanTemplateUpdateSchema,
    row: FloorPlanTemplateRowSchema,
    list: FloorPlanTemplateListResponseSchema,
  },
  search: [floorPlanTemplates.name, floorPlanTemplates.code],
  sortable: {
    name: floorPlanTemplates.name,
    code: floorPlanTemplates.code,
    flats_per_floor: floorPlanTemplates.flatsPerFloor,
    created_at: floorPlanTemplates.createdAt,
  },
  defaultSort: "name",
  keyField: "code",
  keyColumn: floorPlanTemplates.code,
  csv: ["name", "code", "flats_per_floor"],
  prepare: async (tx, input, ctx) => {
    const values = camelRow(input);
    const positions = input["positions"] as
      { position: number; flat_type_id: string; facing?: string | null; is_corner?: boolean }[] | undefined;
    if (positions) {
      const sorted = [...positions].map((p) => p.position).sort((a, b) => a - b);
      if (!sorted.every((p, i) => p === i + 1))
        throw ApiError.badRequest("Positions must be 1..n without gaps or duplicates", { field: "positions" });
      const ids = [...new Set(positions.map((p) => p.flat_type_id))];
      const found = await tx
        .select({ id: flatTypes.id, isActive: flatTypes.isActive, name: flatTypes.name })
        .from(flatTypes)
        .where(and(eq(flatTypes.companyId, ctx.companyId), inArray(flatTypes.id, ids)));
      const byId = new Map(found.map((f) => [f.id, f]));
      for (const p of positions) {
        const ft = byId.get(p.flat_type_id);
        if (!ft) throw ApiError.badRequest(`Unknown flat type ${p.flat_type_id}`, { field: "positions" });
        if (!ft.isActive) throw ApiError.rule(`Flat type ${ft.name} is inactive`, "FLAT_TYPE_INACTIVE");
      }
      values["positions"] = positions.map((p) => ({
        position: p.position,
        flat_type_id: p.flat_type_id,
        facing: p.facing ?? null,
        is_corner: p.is_corner ?? false,
      }));
      values["flatsPerFloor"] = positions.length;
    }
    return values;
  },
  toRows: async (db, rows) => {
    const ids = [
      ...new Set(
        rows.flatMap((r) => ((r["positions"] as { flat_type_id: string }[]) ?? []).map((p) => p.flat_type_id)),
      ),
    ];
    const fts = ids.length
      ? await db.select({ id: flatTypes.id, code: flatTypes.code }).from(flatTypes).where(inArray(flatTypes.id, ids))
      : [];
    const codes = new Map(fts.map((f) => [f.id, f.code]));
    return rows.map((r) => ({
      ...snakeRow(r),
      positions: (
        (r["positions"] as { position: number; flat_type_id: string; facing?: string | null; is_corner: boolean }[]) ??
        []
      ).map((p) => ({
        position: p.position,
        flat_type_id: p.flat_type_id,
        flat_type_code: codes.get(p.flat_type_id) ?? "",
        facing: p.facing ?? null,
        is_corner: p.is_corner,
      })),
    }));
  },
  usage: (db, _c, id) =>
    usages(db, [
      usage("blocks", "blocks", sql`floor_plans @> ${JSON.stringify([{ floor_plan_template_id: id }])}::jsonb`),
    ]),
});

// ---------------------------------------------------------------------------
// Construction stages (single possession flag, reorder)
// ---------------------------------------------------------------------------

export const constructionStagesKind = kind({
  kind: "CONSTRUCTION_STAGES",
  path: "construction-stages",
  entity: "construction_stage",
  table: constructionStages,
  schemas: {
    create: ConstructionStageCreateSchema,
    update: ConstructionStageUpdateSchema,
    row: ConstructionStageRowSchema,
    list: ConstructionStageListResponseSchema,
  },
  search: [constructionStages.name, constructionStages.code],
  sortable: {
    name: constructionStages.name,
    code: constructionStages.code,
    sort_order: constructionStages.sortOrder,
    created_at: constructionStages.createdAt,
  },
  defaultSort: "sort_order",
  keyField: "code",
  keyColumn: constructionStages.code,
  csv: ["name", "code", "sort_order", "is_possession"],
  prepare: async (tx, input, ctx, existing) => {
    const values = camelRow(input);
    if (values["isPossession"] === true) {
      await tx
        .update(constructionStages)
        .set({ isPossession: false })
        .where(
          and(
            eq(constructionStages.companyId, ctx.companyId),
            eq(constructionStages.isPossession, true),
            existing ? ne(constructionStages.id, String(existing["id"])) : sql`true`,
          ),
        );
    }
    return values;
  },
  usage: (db, _c, id) =>
    usages(db, [
      usage("payment_plan_installments", "payment_plan_installments", sql`trigger_stage_id = ${idLit(id)}`),
      usage("projects", "projects", sql`stage_sequence @> array[${idLit(id)}]`),
      usage("block_stages", "block_stages", sql`stage_id = ${idLit(id)}`),
    ]),
  extraRoutes: (app, def) => {
    route(app, {
      method: "POST",
      url: `/masters/${def.path}/reorder`,
      permission: "master.write",
      schema: {
        body: ConstructionStageReorderSchema,
        response: { 200: def.listSchema },
        summary: "Reorder construction stages",
        tags: ["masters"],
      },
      handler: async (req) => {
        const user = req.user!;
        const ids = req.body.stage_ids;
        if (new Set(ids).size !== ids.length) throw ApiError.badRequest("Duplicate stage ids", { field: "stage_ids" });
        return app.db.transaction(async (tx) => {
          const found = await tx
            .select({ id: constructionStages.id })
            .from(constructionStages)
            .where(and(eq(constructionStages.companyId, user.companyId), inArray(constructionStages.id, ids)));
          if (found.length !== ids.length) throw ApiError.badRequest("Unknown stage id", { field: "stage_ids" });
          for (const [i, id] of ids.entries())
            await tx
              .update(constructionStages)
              .set({ sortOrder: (i + 1) * 10, version: sql`${constructionStages.version} + 1` })
              .where(eq(constructionStages.id, id));
          await writeAudit(tx, {
            companyId: user.companyId,
            actor: actorFromRequest(req),
            action: "construction_stage.reorder",
            entityType: "construction_stage",
            entityId: null,
            after: { stage_ids: ids },
            ip: req.clientIp,
            requestId: req.id,
          });
          const rows = (await tx
            .select()
            .from(constructionStages)
            .where(and(eq(constructionStages.companyId, user.companyId), eq(constructionStages.isActive, true)))
            .orderBy(constructionStages.sortOrder)) as DbRow[];
          const items = await def.toRows(tx, rows, user.companyId);
          return { items, total: items.length, page: 1, page_size: Math.max(1, items.length), next_cursor: null };
        });
      },
    });
  },
});

// ---------------------------------------------------------------------------
// Payment plans (installments child rows, domain validation)
// ---------------------------------------------------------------------------

function installmentLabel(i: {
  trigger_type: TriggerType;
  trigger_days: number | null;
  trigger_stage_name: string | null;
  trigger_date: string | null;
}): string {
  switch (i.trigger_type) {
    case "ON_BOOKING":
      return "On booking";
    case "DAYS_AFTER_BOOKING":
      return `${i.trigger_days ?? 0} days after booking`;
    case "ON_STAGE":
      return `On ${i.trigger_stage_name ?? "stage"}`;
    case "ON_POSSESSION":
      return "On possession";
    case "ON_DATE":
      return `On ${i.trigger_date ?? "date"}`;
  }
}

/**
 * Plan-level rules (sum = 100.00, unique seq/name, ≤1 ON_BOOKING/ON_POSSESSION, stage exists) are enforced by @kkt/domain validatePlan
 * so they surface as 422 BUSINESS_RULE with structured errors; the wire shape (fields, per-installment trigger details) stays the contract's.
 */
const PaymentPlanCreateBody = z.strictObject(PaymentPlanCreateSchema.shape);
const PaymentPlanUpdateBody = z.strictObject(PaymentPlanUpdateSchema.shape);

export const paymentPlansKind = kind({
  kind: "PAYMENT_PLANS",
  path: "payment-plans",
  entity: "payment_plan",
  table: paymentPlans,
  schemas: {
    create: PaymentPlanCreateBody,
    update: PaymentPlanUpdateBody,
    row: PaymentPlanRowSchema,
    list: PaymentPlanListResponseSchema,
    filter: PaymentPlanFilterSchema,
  },
  search: [paymentPlans.name, paymentPlans.code],
  sortable: {
    name: paymentPlans.name,
    code: paymentPlans.code,
    plan_type: paymentPlans.planType,
    created_at: paymentPlans.createdAt,
  },
  defaultSort: "name",
  keyField: "code",
  keyColumn: paymentPlans.code,
  csv: ["name", "code", "plan_type", "grace_days", "assignment_count", "booking_count"],
  extraWhere: (q) =>
    and(
      typeof q["plan_type"] === "string" ? eq(paymentPlans.planType, q["plan_type"] as never) : undefined,
      typeof q["project_id"] === "string"
        ? sql`exists (select 1 from payment_plan_assignments a where a.plan_id = ${paymentPlans.id} and a.project_id = ${q["project_id"]}::uuid and a.is_active)`
        : undefined,
    ),
  prepare: async (tx, input, ctx) => {
    const { installments, ...rest } = input as { installments?: InstallmentInput[] } & Record<string, unknown>;
    if (installments) {
      const stages = await tx
        .select({ id: constructionStages.id })
        .from(constructionStages)
        .where(and(eq(constructionStages.companyId, ctx.companyId), eq(constructionStages.isActive, true)));
      const result = validatePlan(
        installments.map((i) => ({
          seq: i.seq,
          name: i.name,
          percent: i.percent,
          triggerType: i.trigger_type,
          triggerDays: i.trigger_days ?? null,
          triggerStageId: i.trigger_stage_id ?? null,
          triggerDate: i.trigger_date ?? null,
          dueDays: i.due_days ?? null,
        })),
        { knownStageIds: stages.map((s) => s.id) },
      );
      if (!result.ok)
        throw ApiError.rule(result.errors.map((e) => e.message).join("; "), "PAYMENT_PLAN_INVALID", {
          errors: result.errors,
          total_percent: result.totalBasisPoints / 100,
        });
    }
    return camelRow(rest);
  },
  afterWrite: async (tx, row, input, ctx, mode) => {
    const installments = input["installments"] as InstallmentInput[] | undefined;
    if (!installments) return;
    const planId = String(row["id"]);
    await tx.delete(paymentPlanInstallments).where(eq(paymentPlanInstallments.planId, planId));
    await tx.insert(paymentPlanInstallments).values(
      installments.map((i) => ({
        planId,
        seq: i.seq,
        name: i.name,
        percent: i.percent,
        triggerType: i.trigger_type,
        triggerDays: i.trigger_days ?? null,
        triggerStageId: i.trigger_stage_id ?? null,
        triggerDate: i.trigger_date ?? null,
        dueDays: i.due_days ?? null,
        notes: i.notes ?? null,
      })),
    );
    // SPEC §8 at every change point (audit E3): the edited installments must still fit every tower the plan is actively assigned to;
    // a stage the tower lacks → 409 PLAN_STAGES_MISSING and the whole edit rolls back (bookings keep their own plan snapshots)
    if (mode === "update")
      await assertPlanFitsActiveAssignments(tx, ctx.companyId, planId, `Editing plan "${String(row["name"] ?? "")}"`);
  },
  toRows: async (db, rows) => {
    const ids = rows.map((r) => String(r["id"]));
    if (ids.length === 0) return [];
    const [insts, counts] = await Promise.all([
      db
        .select({ i: paymentPlanInstallments, stageName: constructionStages.name })
        .from(paymentPlanInstallments)
        .leftJoin(constructionStages, eq(constructionStages.id, paymentPlanInstallments.triggerStageId))
        .where(inArray(paymentPlanInstallments.planId, ids))
        .orderBy(paymentPlanInstallments.seq),
      db.execute<{ plan_id: string; assignment_count: number; booking_count: number }>(sql`
        select p.id as plan_id,
               (select count(*)::int from payment_plan_assignments a where a.plan_id = p.id) as assignment_count,
               (select count(*)::int from bookings b where b.payment_plan_id = p.id) as booking_count
        from payment_plans p where p.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`),
    ]);
    const byPlan = new Map<string, typeof insts>();
    for (const x of insts) {
      const list = byPlan.get(x.i.planId) ?? [];
      list.push(x);
      byPlan.set(x.i.planId, list);
    }
    const countMap = new Map(counts.map((c) => [c.plan_id, c]));
    return rows.map((r) => {
      const id = String(r["id"]);
      let cumulative = 0;
      const installments = (byPlan.get(id) ?? []).map(({ i, stageName }) => {
        cumulative = Math.round((cumulative + Number(i.percent)) * 100) / 100;
        const base = {
          trigger_type: i.triggerType,
          trigger_days: i.triggerDays,
          trigger_stage_name: stageName ?? null,
          trigger_date: i.triggerDate,
        };
        return {
          id: i.id,
          seq: i.seq,
          name: i.name,
          percent: Number(i.percent),
          cumulative_percent: cumulative,
          ...base,
          trigger_stage_id: i.triggerStageId,
          due_days: i.dueDays,
          trigger_label: installmentLabel(base),
          notes: i.notes,
        };
      });
      const c = countMap.get(id);
      return {
        ...snakeRow(r),
        installments,
        assignment_count: Number(c?.assignment_count ?? 0),
        booking_count: Number(c?.booking_count ?? 0),
      };
    });
  },
  usage: (db, _c, id) =>
    usages(db, [
      usage("payment_plan_assignments", "payment_plan_assignments", sql`plan_id = ${idLit(id)}`),
      usage("bookings", "bookings", sql`payment_plan_id = ${idLit(id)}`),
    ]),
});

// ---------------------------------------------------------------------------
// Payment modes (code set + defaults)
// ---------------------------------------------------------------------------

export const paymentModesKind = kind({
  kind: "PAYMENT_MODES",
  path: "payment-modes",
  entity: "payment_mode",
  table: paymentModes,
  schemas: {
    create: PaymentModeCreateSchema,
    update: PaymentModeUpdateSchema,
    row: PaymentModeRowSchema,
    list: PaymentModeListResponseSchema,
  },
  search: [paymentModes.name, paymentModes.code],
  sortable: {
    name: paymentModes.name,
    code: paymentModes.code,
    sort_order: paymentModes.sortOrder,
    created_at: paymentModes.createdAt,
  },
  defaultSort: "sort_order",
  keyField: "code",
  keyColumn: paymentModes.code,
  csv: ["name", "code", "requires_instrument", "clears_immediately", "is_cash", "sort_order"],
  prepare: async (_tx, input, _ctx, existing) => {
    const values = camelRow(input);
    const code = (input["code"] ?? existing?.["code"]) as PaymentModeCode | undefined;
    // Flags left at the schema defaults (false/true/false) take the mode's canonical behaviour from PAYMENT_MODE_DEFAULTS.
    if (!existing && code && code in PAYMENT_MODE_DEFAULTS) {
      const d = PAYMENT_MODE_DEFAULTS[code];
      const atSchemaDefaults =
        input["requires_instrument"] === false && input["clears_immediately"] === true && input["is_cash"] === false;
      if (atSchemaDefaults) {
        values["requiresInstrument"] = d.requires_instrument;
        values["clearsImmediately"] = d.clears_immediately;
        values["isCash"] = d.is_cash;
      }
    }
    return values;
  },
  usage: (db, _c, id) => usages(db, [usage("payments", "payments", sql`payment_mode_id = ${idLit(id)}`)]),
});

// ---------------------------------------------------------------------------
// Bank accounts (encrypted account number, single default)
// ---------------------------------------------------------------------------

export const bankAccountsKind = kind({
  kind: "BANK_ACCOUNTS",
  path: "bank-accounts",
  entity: "bank_account",
  table: bankAccounts,
  schemas: {
    create: BankAccountCreateSchema,
    update: BankAccountUpdateSchema,
    row: BankAccountRowSchema,
    list: BankAccountListResponseSchema,
  },
  search: [bankAccounts.bankName, bankAccounts.accountName, bankAccounts.ifsc, bankAccounts.branch],
  sortable: {
    bank_name: bankAccounts.bankName,
    account_name: bankAccounts.accountName,
    is_default: bankAccounts.isDefault,
    created_at: bankAccounts.createdAt,
  },
  defaultSort: "bank_name",
  keyField: "account_name",
  keyColumn: bankAccounts.accountName,
  csv: ["bank_name", "branch", "account_name", "account_number_masked", "ifsc", "is_default", "is_escrow"],
  prepare: async (tx, input, ctx, existing) => {
    const { account_number, ...rest } = input as { account_number?: string } & Record<string, unknown>;
    const values = camelRow(rest);
    if (account_number) {
      values["accountNumberEnc"] = encryptField(account_number);
      values["accountNumberLast4"] = account_number.slice(-4);
    }
    if (values["isDefault"] === true) {
      await tx
        .update(bankAccounts)
        .set({ isDefault: false })
        .where(
          and(
            eq(bankAccounts.companyId, ctx.companyId),
            eq(bankAccounts.isDefault, true),
            existing ? ne(bankAccounts.id, String(existing["id"])) : sql`true`,
          ),
        );
    }
    return values;
  },
  toRows: async (_db, rows) =>
    rows.map((r) => {
      const { accountNumberEnc, accountNumberLast4, ...rest } = r;
      let masked: string;
      try {
        masked = maskAccount(decryptField(String(accountNumberEnc)) ?? "");
      } catch {
        masked = `XXXXXXXX${String(accountNumberLast4)}`;
      }
      return { ...snakeRow(rest), account_number_masked: masked };
    }),
  usage: (db, _c, id) =>
    usages(db, [
      usage("payments", "payments", sql`bank_account_id = ${idLit(id)}`),
      usage("projects", "projects", sql`escrow_bank_account_id = ${idLit(id)}`),
    ]),
});

/** All 16 master kinds in MASTER_KINDS order. */
export const MASTER_KIND_DEFS: readonly MasterKindDef[] = [
  roomTypesKind,
  areaTypesKind,
  flatTypesKind,
  blockTypesKind,
  floorPlanTemplatesKind,
  amenitiesKind,
  constructionStagesKind,
  paymentPlansKind,
  chargeTypesKind,
  paymentModesKind,
  bankAccountsKind,
  documentTypesKind,
  plcTypesKind,
  specCategoriesKind,
  specItemsKind,
  serviceCategoriesKind,
];

/** Looks up a kind definition by MASTER_KINDS value. */
export function kindDef(kind: MasterKindDef["kind"]): MasterKindDef {
  const def = MASTER_KIND_DEFS.find((d) => d.kind === kind);
  if (!def) throw new Error(`Unknown master kind ${kind}`);
  return def;
}
