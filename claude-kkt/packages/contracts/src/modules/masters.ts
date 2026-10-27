import { z } from "zod";
import {
  AreaTypeCodeSchema,
  BlockTypeCodeSchema,
  ChargeDemandAtSchema,
  DocumentAppliesToSchema,
  MasterKindSchema,
  PaymentModeCodeSchema,
  PlcCalcModeSchema,
  ServicePrioritySchema,
} from "../enums.js";
import {
  BankAccountNumberSchema,
  CodeSchema,
  IFSCSchema,
  IdSchema,
  ListQuerySchema,
  MasterRowSchema,
  NameSchema,
  PaiseSchema,
  PercentSchema,
  PositiveSqftSchema,
  TextSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

const SortOrderSchema = z.int().min(0).max(10_000).default(0);

// ---------------------------------------------------------------------------
// Room types
// ---------------------------------------------------------------------------

export const RoomTypeCreateSchema = z.strictObject({ name: NameSchema, code: CodeSchema, sort_order: SortOrderSchema });
export type RoomTypeCreate = z.infer<typeof RoomTypeCreateSchema>;
export const RoomTypeUpdateSchema = updateOf(RoomTypeCreateSchema);
export type RoomTypeUpdate = z.infer<typeof RoomTypeUpdateSchema>;
export const RoomTypeRowSchema = MasterRowSchema.extend({ name: z.string(), code: z.string(), sort_order: z.int() });
export type RoomTypeRow = z.infer<typeof RoomTypeRowSchema>;

// ---------------------------------------------------------------------------
// Area types
// ---------------------------------------------------------------------------

export const AreaTypeCreateSchema = z.strictObject({ name: NameSchema, code: CodeSchema, sort_order: SortOrderSchema });
export type AreaTypeCreate = z.infer<typeof AreaTypeCreateSchema>;
export const AreaTypeUpdateSchema = updateOf(AreaTypeCreateSchema);
export type AreaTypeUpdate = z.infer<typeof AreaTypeUpdateSchema>;
export const AreaTypeRowSchema = MasterRowSchema.extend({ name: z.string(), code: z.string(), sort_order: z.int() });
export type AreaTypeRow = z.infer<typeof AreaTypeRowSchema>;

// ---------------------------------------------------------------------------
// Flat types
// ---------------------------------------------------------------------------

/** One room of a flat type: sq ft defaults to length × width but is editable. */
export const FlatTypeRoomSchema = z.strictObject({
  room_type_id: IdSchema,
  label: NameSchema,
  length_ft: z.number().gt(0).max(999),
  width_ft: z.number().gt(0).max(999),
  sqft: PositiveSqftSchema.optional(),
});
export type FlatTypeRoom = z.infer<typeof FlatTypeRoomSchema>;

/** One area line of a flat type. */
export const FlatTypeAreaSchema = z.strictObject({ area_type_id: IdSchema, sqft: PositiveSqftSchema });
export type FlatTypeArea = z.infer<typeof FlatTypeAreaSchema>;

/** Snapshot of a room as stored on flat types and flats. */
export const RoomSnapshotSchema = z.object({
  room_type_id: IdSchema,
  room_type_name: z.string(),
  label: z.string(),
  length_ft: z.number(),
  width_ft: z.number(),
  sqft: z.number(),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

/** Snapshot of an area as stored on flat types and flats. */
export const AreaSnapshotSchema = z.object({
  area_type_id: IdSchema,
  area_type_code: z.string(),
  area_type_name: z.string(),
  sqft: z.number(),
});
export type AreaSnapshot = z.infer<typeof AreaSnapshotSchema>;

const FlatTypeBase = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  bhk: z
    .number()
    .min(0)
    .max(20)
    .refine((v) => Number.isInteger(v * 2), { message: "BHK in steps of 0.5" }),
  facing: z.string().trim().max(40).optional().nullable(),
  description: TextSchema.optional().nullable(),
  rooms: z.array(FlatTypeRoomSchema).min(1, "At least one room"),
  areas: z.array(FlatTypeAreaSchema).min(1, "At least one area"),
  base_rate_per_sqft_paise: PaiseSchema.optional().nullable(),
  base_price_paise: PaiseSchema.optional().nullable(),
  spec_item_ids: z.array(IdSchema).max(200).default([]),
});

/** Create a flat type; super ≥ built-up ≥ carpet is enforced by the service once area codes are resolved. */
export const FlatTypeCreateSchema = FlatTypeBase.refine(
  (f) => new Set(f.areas.map((a) => a.area_type_id)).size === f.areas.length,
  { message: "Each area type once", path: ["areas"] },
).refine((f) => f.base_rate_per_sqft_paise == null || f.base_price_paise == null, {
  message: "Give a base rate per sq ft or a lump-sum price, not both",
  path: ["base_price_paise"],
});
export type FlatTypeCreate = z.infer<typeof FlatTypeCreateSchema>;
export const FlatTypeUpdateSchema = updateOf(FlatTypeBase);
export type FlatTypeUpdate = z.infer<typeof FlatTypeUpdateSchema>;

export const FlatTypeRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  bhk: z.number(),
  facing: z.string().nullable(),
  description: z.string().nullable(),
  rooms: z.array(RoomSnapshotSchema),
  areas: z.array(AreaSnapshotSchema),
  carpet_sqft: z.number().nullable(),
  builtup_sqft: z.number().nullable(),
  super_builtup_sqft: z.number().nullable(),
  base_rate_per_sqft_paise: PaiseSchema.nullable(),
  base_price_paise: PaiseSchema.nullable(),
  spec_item_ids: z.array(IdSchema),
});
export type FlatTypeRow = z.infer<typeof FlatTypeRowSchema>;

export const FlatTypeFilterSchema = ListQuerySchema.extend({
  bhk: z.coerce.number().optional(),
  facing: z.string().optional(),
});
export type FlatTypeFilter = z.infer<typeof FlatTypeFilterSchema>;

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export const BlockTypeCreateSchema = z.strictObject({
  name: NameSchema,
  code: z.union([BlockTypeCodeSchema, CodeSchema]),
  has_floors: z.boolean().default(true),
});
export type BlockTypeCreate = z.infer<typeof BlockTypeCreateSchema>;
export const BlockTypeUpdateSchema = updateOf(BlockTypeCreateSchema);
export type BlockTypeUpdate = z.infer<typeof BlockTypeUpdateSchema>;
export const BlockTypeRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  has_floors: z.boolean(),
});
export type BlockTypeRow = z.infer<typeof BlockTypeRowSchema>;

// ---------------------------------------------------------------------------
// Floor plan templates
// ---------------------------------------------------------------------------

/** One position on a floor plan template. */
export const FloorPlanPositionSchema = z.strictObject({
  position: z.int().min(1).max(99),
  flat_type_id: IdSchema,
  facing: z.string().trim().max(40).optional().nullable(),
  is_corner: z.boolean().default(false),
});
export type FloorPlanPosition = z.infer<typeof FloorPlanPositionSchema>;

const FloorPlanTemplateBase = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  positions: z.array(FloorPlanPositionSchema).min(1).max(99),
});

/** Create a floor plan template; positions must be 1..n with no gaps. */
export const FloorPlanTemplateCreateSchema = FloorPlanTemplateBase.refine(
  (t) => {
    const sorted = [...t.positions].map((p) => p.position).sort((a, b) => a - b);
    return sorted.every((p, i) => p === i + 1);
  },
  { message: "Positions must be 1..n without gaps or duplicates", path: ["positions"] },
);
export type FloorPlanTemplateCreate = z.infer<typeof FloorPlanTemplateCreateSchema>;
export const FloorPlanTemplateUpdateSchema = updateOf(FloorPlanTemplateBase);
export type FloorPlanTemplateUpdate = z.infer<typeof FloorPlanTemplateUpdateSchema>;

export const FloorPlanTemplateRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  flats_per_floor: z.int().min(1),
  positions: z.array(
    z.object({
      position: z.int(),
      flat_type_id: IdSchema,
      flat_type_code: z.string(),
      facing: z.string().nullable(),
      is_corner: z.boolean(),
    }),
  ),
});
export type FloorPlanTemplateRow = z.infer<typeof FloorPlanTemplateRowSchema>;

// ---------------------------------------------------------------------------
// Amenities
// ---------------------------------------------------------------------------

export const AmenityCreateSchema = z.strictObject({
  name: NameSchema,
  category: z.string().trim().max(60).optional().nullable(),
  icon: z.string().trim().max(60).optional().nullable(),
});
export type AmenityCreate = z.infer<typeof AmenityCreateSchema>;
export const AmenityUpdateSchema = updateOf(AmenityCreateSchema);
export type AmenityUpdate = z.infer<typeof AmenityUpdateSchema>;
export const AmenityRowSchema = MasterRowSchema.extend({
  name: z.string(),
  category: z.string().nullable(),
  icon: z.string().nullable(),
});
export type AmenityRow = z.infer<typeof AmenityRowSchema>;

// ---------------------------------------------------------------------------
// Construction stages
// ---------------------------------------------------------------------------

export const ConstructionStageCreateSchema = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  sort_order: SortOrderSchema,
  is_possession: z.boolean().default(false),
});
export type ConstructionStageCreate = z.infer<typeof ConstructionStageCreateSchema>;
export const ConstructionStageUpdateSchema = updateOf(ConstructionStageCreateSchema);
export type ConstructionStageUpdate = z.infer<typeof ConstructionStageUpdateSchema>;
export const ConstructionStageRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  sort_order: z.int(),
  is_possession: z.boolean(),
});
export type ConstructionStageRow = z.infer<typeof ConstructionStageRowSchema>;

/** Reorder stages: full ordered list of stage ids. */
export const ConstructionStageReorderSchema = z.strictObject({ stage_ids: z.array(IdSchema).min(1) });
export type ConstructionStageReorder = z.infer<typeof ConstructionStageReorderSchema>;

// ---------------------------------------------------------------------------
// Charge types
// ---------------------------------------------------------------------------

export const ChargeTypeCreateSchema = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  default_amount_paise: PaiseSchema.default(0),
  is_taxable: z.boolean().default(false),
  default_gst_percent: PercentSchema.default(0),
  demand_at: ChargeDemandAtSchema.default("MANUAL"),
});
export type ChargeTypeCreate = z.infer<typeof ChargeTypeCreateSchema>;
export const ChargeTypeUpdateSchema = updateOf(ChargeTypeCreateSchema);
export type ChargeTypeUpdate = z.infer<typeof ChargeTypeUpdateSchema>;
export const ChargeTypeRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  default_amount_paise: PaiseSchema,
  is_taxable: z.boolean(),
  default_gst_percent: z.number(),
  demand_at: ChargeDemandAtSchema,
});
export type ChargeTypeRow = z.infer<typeof ChargeTypeRowSchema>;

// ---------------------------------------------------------------------------
// Payment modes
// ---------------------------------------------------------------------------

export const PaymentModeCreateSchema = z.strictObject({
  name: NameSchema,
  code: PaymentModeCodeSchema,
  requires_instrument: z.boolean().default(false),
  clears_immediately: z.boolean().default(true),
  is_cash: z.boolean().default(false),
  sort_order: SortOrderSchema,
});
export type PaymentModeCreate = z.infer<typeof PaymentModeCreateSchema>;
export const PaymentModeUpdateSchema = updateOf(PaymentModeCreateSchema);
export type PaymentModeUpdate = z.infer<typeof PaymentModeUpdateSchema>;
export const PaymentModeRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: PaymentModeCodeSchema,
  requires_instrument: z.boolean(),
  clears_immediately: z.boolean(),
  is_cash: z.boolean(),
  sort_order: z.int(),
});
export type PaymentModeRow = z.infer<typeof PaymentModeRowSchema>;

// ---------------------------------------------------------------------------
// Company bank accounts
// ---------------------------------------------------------------------------

export const BankAccountCreateSchema = z.strictObject({
  bank_name: NameSchema,
  branch: z.string().trim().max(120).optional().nullable(),
  account_name: NameSchema,
  account_number: BankAccountNumberSchema,
  ifsc: IFSCSchema,
  is_default: z.boolean().default(false),
  is_escrow: z.boolean().default(false),
});
export type BankAccountCreate = z.infer<typeof BankAccountCreateSchema>;
export const BankAccountUpdateSchema = updateOf(BankAccountCreateSchema);
export type BankAccountUpdate = z.infer<typeof BankAccountUpdateSchema>;
/** Bank account row: number is masked (XXXXXXXX1234). */
export const BankAccountRowSchema = MasterRowSchema.extend({
  bank_name: z.string(),
  branch: z.string().nullable(),
  account_name: z.string(),
  account_number_masked: z.string(),
  ifsc: z.string(),
  is_default: z.boolean(),
  is_escrow: z.boolean(),
});
export type BankAccountRow = z.infer<typeof BankAccountRowSchema>;

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export const DocumentTypeCreateSchema = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  applies_to: z.array(DocumentAppliesToSchema).min(1),
  is_kyc: z.boolean().default(false),
});
export type DocumentTypeCreate = z.infer<typeof DocumentTypeCreateSchema>;
export const DocumentTypeUpdateSchema = updateOf(DocumentTypeCreateSchema);
export type DocumentTypeUpdate = z.infer<typeof DocumentTypeUpdateSchema>;
export const DocumentTypeRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  applies_to: z.array(DocumentAppliesToSchema),
  is_kyc: z.boolean(),
});
export type DocumentTypeRow = z.infer<typeof DocumentTypeRowSchema>;

// ---------------------------------------------------------------------------
// PLC types
// ---------------------------------------------------------------------------

export const PlcTypeCreateSchema = z.strictObject({ name: NameSchema, code: CodeSchema, calc_mode: PlcCalcModeSchema });
export type PlcTypeCreate = z.infer<typeof PlcTypeCreateSchema>;
export const PlcTypeUpdateSchema = updateOf(PlcTypeCreateSchema);
export type PlcTypeUpdate = z.infer<typeof PlcTypeUpdateSchema>;
export const PlcTypeRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  calc_mode: PlcCalcModeSchema,
});
export type PlcTypeRow = z.infer<typeof PlcTypeRowSchema>;

// ---------------------------------------------------------------------------
// Specifications
// ---------------------------------------------------------------------------

export const SpecCategoryCreateSchema = z.strictObject({ name: NameSchema, sort_order: SortOrderSchema });
export type SpecCategoryCreate = z.infer<typeof SpecCategoryCreateSchema>;
export const SpecCategoryUpdateSchema = updateOf(SpecCategoryCreateSchema);
export type SpecCategoryUpdate = z.infer<typeof SpecCategoryUpdateSchema>;
export const SpecCategoryRowSchema = MasterRowSchema.extend({ name: z.string(), sort_order: z.int() });
export type SpecCategoryRow = z.infer<typeof SpecCategoryRowSchema>;

export const SpecItemCreateSchema = z.strictObject({
  category_id: IdSchema,
  name: NameSchema,
  description: TextSchema.optional().nullable(),
  sort_order: SortOrderSchema,
});
export type SpecItemCreate = z.infer<typeof SpecItemCreateSchema>;
export const SpecItemUpdateSchema = updateOf(SpecItemCreateSchema);
export type SpecItemUpdate = z.infer<typeof SpecItemUpdateSchema>;
export const SpecItemRowSchema = MasterRowSchema.extend({
  category_id: IdSchema,
  category_name: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sort_order: z.int(),
});
export type SpecItemRow = z.infer<typeof SpecItemRowSchema>;
export const SpecItemFilterSchema = ListQuerySchema.extend({ category_id: IdSchema.optional() });
export type SpecItemFilter = z.infer<typeof SpecItemFilterSchema>;

// ---------------------------------------------------------------------------
// Service categories
// ---------------------------------------------------------------------------

export const ServiceCategoryCreateSchema = z.strictObject({
  name: NameSchema,
  sort_order: SortOrderSchema,
  default_priority: ServicePrioritySchema.default("MEDIUM"),
});
export type ServiceCategoryCreate = z.infer<typeof ServiceCategoryCreateSchema>;
export const ServiceCategoryUpdateSchema = updateOf(ServiceCategoryCreateSchema);
export type ServiceCategoryUpdate = z.infer<typeof ServiceCategoryUpdateSchema>;
export const ServiceCategoryRowSchema = MasterRowSchema.extend({
  name: z.string(),
  sort_order: z.int(),
  default_priority: ServicePrioritySchema,
});
export type ServiceCategoryRow = z.infer<typeof ServiceCategoryRowSchema>;

// ---------------------------------------------------------------------------
// Generic master list / import
// ---------------------------------------------------------------------------

/** Generic master list filter (search, inactive, sort). */
export const MasterFilterSchema = ListQuerySchema;
export type MasterFilter = z.infer<typeof MasterFilterSchema>;

export const RoomTypeListResponseSchema = listEnvelope(RoomTypeRowSchema);
export const AreaTypeListResponseSchema = listEnvelope(AreaTypeRowSchema);
export const FlatTypeListResponseSchema = listEnvelope(FlatTypeRowSchema);
export const BlockTypeListResponseSchema = listEnvelope(BlockTypeRowSchema);
export const FloorPlanTemplateListResponseSchema = listEnvelope(FloorPlanTemplateRowSchema);
export const AmenityListResponseSchema = listEnvelope(AmenityRowSchema);
export const ConstructionStageListResponseSchema = listEnvelope(ConstructionStageRowSchema);
export const ChargeTypeListResponseSchema = listEnvelope(ChargeTypeRowSchema);
export const PaymentModeListResponseSchema = listEnvelope(PaymentModeRowSchema);
export const BankAccountListResponseSchema = listEnvelope(BankAccountRowSchema);
export const DocumentTypeListResponseSchema = listEnvelope(DocumentTypeRowSchema);
export const PlcTypeListResponseSchema = listEnvelope(PlcTypeRowSchema);
export const SpecCategoryListResponseSchema = listEnvelope(SpecCategoryRowSchema);
export const SpecItemListResponseSchema = listEnvelope(SpecItemRowSchema);
export const ServiceCategoryListResponseSchema = listEnvelope(ServiceCategoryRowSchema);

/** CSV import preview request: which master and the raw CSV text. */
export const MasterCsvImportRequestSchema = z.strictObject({
  kind: MasterKindSchema,
  csv: z.string().min(1).max(2_000_000),
  commit: z.boolean().default(false),
});
export type MasterCsvImportRequest = z.infer<typeof MasterCsvImportRequestSchema>;

/** One row of an import preview. */
export const MasterCsvImportRowSchema = z.object({
  line: z.int().min(1),
  action: z.enum(["CREATE", "UPDATE", "SKIP", "ERROR"]),
  data: z.record(z.string(), z.unknown()),
  errors: z.array(z.string()),
});
export type MasterCsvImportRow = z.infer<typeof MasterCsvImportRowSchema>;

/**
 * Import preview / result. UPDATE rows carry (in `data`) and apply ONLY the columns present in the CSV with a non-empty cell: an omitted
 * column or an empty cell leaves the stored value unchanged (no create-time defaults). `ignored_columns` lists export-only columns
 * (e.g. `id`, `version`, `is_active`, `category_name`) that the importer accepted but does not write.
 */
export const MasterCsvImportResponseSchema = z.object({
  kind: MasterKindSchema,
  committed: z.boolean(),
  rows: z.array(MasterCsvImportRowSchema),
  summary: z.object({ create: z.int(), update: z.int(), skip: z.int(), error: z.int() }),
  ignored_columns: z.array(z.string()).optional(),
});
export type MasterCsvImportResponse = z.infer<typeof MasterCsvImportResponseSchema>;

/** `details` of 422 IMPORT_UNKNOWN_COLUMNS: the header names the importer does not know, with the expected names. */
export const ImportUnknownColumnsDetailsSchema = z.object({
  kind: MasterKindSchema,
  unknown_columns: z.array(z.string()).min(1),
  /** Best guess per unknown column (e.g. `default_amount` → `default_amount_paise`), when one is close enough. */
  suggestions: z.record(z.string(), z.string()),
  expected_columns: z.array(z.string()),
  required_columns: z.array(z.string()),
});
export type ImportUnknownColumnsDetails = z.infer<typeof ImportUnknownColumnsDetailsSchema>;

/** How a template cell is written: plain text/number/boolean, a `|`-separated list, or JSON (arrays of objects). */
export const ImportColumnTypeSchema = z.enum(["string", "number", "boolean", "enum", "list", "json"]);
export type ImportColumnType = z.infer<typeof ImportColumnTypeSchema>;

/** One column of a master's canonical import template. */
export const ImportTemplateColumnSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  type: ImportColumnTypeSchema,
  /** Allowed values of an enum column (or of the items of an enum list). */
  values: z.array(z.string()).optional(),
  /** True for the business key that decides CREATE vs UPDATE. */
  key: z.boolean(),
});
export type ImportTemplateColumn = z.infer<typeof ImportTemplateColumnSchema>;

/**
 * GET /masters/{path}/import-template — the canonical CSV header for one master and an example row valid for the caller's company
 * (references such as room/area/flat type ids are filled from its active masters). `?format=csv` downloads `csv` as a file.
 */
export const MasterImportTemplateSchema = z.object({
  kind: MasterKindSchema,
  path: z.string(),
  key_field: z.string(),
  columns: z.array(ImportTemplateColumnSchema),
  header: z.array(z.string()),
  /** Example row (cell text, exactly as it appears in `csv`). */
  example: z.record(z.string(), z.string()),
  /** Header line + example line, RFC 4180 quoted. */
  csv: z.string(),
  /** Why the example could not reference real data (e.g. no active room type yet); the example then needs editing. */
  notes: z.array(z.string()),
});
export type MasterImportTemplate = z.infer<typeof MasterImportTemplateSchema>;
export const MasterImportTemplateQuerySchema = z.strictObject({ format: z.enum(["json", "csv"]).default("json") });
export type MasterImportTemplateQuery = z.infer<typeof MasterImportTemplateQuerySchema>;

/** Area type codes a flat type needs for the super ≥ built-up ≥ carpet check. */
export const STRUCTURAL_AREA_CODES = ["CARPET", "BUILT_UP", "SUPER_BUILT_UP"] as const satisfies readonly z.infer<
  typeof AreaTypeCodeSchema
>[];
