import { z } from "zod";
import {
  BlockStatusSchema,
  FlatStatusSchema,
  FloorKindSchema,
  GridColourModeSchema,
  NumberingPatternSchema,
  FLAT_STATUSES,
} from "../enums.js";
import {
  CodeSchema,
  IdSchema,
  ListQuerySchema,
  MasterRowSchema,
  NameSchema,
  PaiseSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";
import { UnitCountsSchema } from "./projects.js";

/** A floor range that uses one floor-plan template. */
export const FloorPlanRangeSchema = z
  .strictObject({
    from_floor: z.int().min(-5).max(200),
    to_floor: z.int().min(-5).max(200),
    floor_plan_template_id: IdSchema,
  })
  .refine((r) => r.from_floor <= r.to_floor, { message: "from_floor must be ≤ to_floor", path: ["to_floor"] });
export type FloorPlanRange = z.infer<typeof FloorPlanRangeSchema>;

/** Returns true when no two ranges overlap. */
export function rangesDisjoint(ranges: readonly { from_floor: number; to_floor: number }[]): boolean {
  const sorted = [...ranges].sort((a, b) => a.from_floor - b.from_floor);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined && cur.from_floor <= prev.to_floor) return false;
  }
  return true;
}

const BlockBase = z.strictObject({
  project_id: IdSchema,
  block_type_id: IdSchema,
  name: NameSchema,
  code: CodeSchema,
  floors: z.int().min(0).max(200),
  floor_start: z.int().min(-5).max(200).default(1),
  ground_floor_label: z.string().trim().max(10).default("G"),
  skip_floors: z.array(z.int().min(-5).max(200)).max(50).default([]),
  refuge_floors: z.array(z.int().min(-5).max(200)).max(50).default([]),
  podium_floors: z.array(z.int().min(-5).max(200)).max(50).default([]),
  floor_plans: z.array(FloorPlanRangeSchema).min(1).max(50),
  numbering_pattern: NumberingPatternSchema.default("{block}-{floor}{pos2}"),
  stage_sequence: z.array(IdSchema).max(100).optional(),
  status: BlockStatusSchema.default("PLANNING"),
  sort_order: z.int().min(0).max(10_000).default(0),
  generate_flats: z.boolean().default(true),
});

function addBlockIssues(b: z.infer<typeof BlockBase>, ctx: z.RefinementCtx): void {
  if (b.floor_start > b.floors) {
    ctx.addIssue({ code: "custom", message: "floor_start must be ≤ floors", path: ["floor_start"] });
  }
  if (!rangesDisjoint(b.floor_plans)) {
    ctx.addIssue({ code: "custom", message: "Floor-plan ranges must not overlap", path: ["floor_plans"] });
  }
  const outside = b.floor_plans.some((r) => r.from_floor < b.floor_start || r.to_floor > b.floors);
  if (outside) {
    ctx.addIssue({ code: "custom", message: "Floor-plan ranges must lie within floor_start..floors", path: ["floor_plans"] });
  }
  const noUnits = new Set([...b.refuge_floors, ...b.podium_floors]);
  const unitFloors: number[] = [];
  for (let f = b.floor_start; f <= b.floors; f += 1) {
    if (!b.skip_floors.includes(f) && !noUnits.has(f)) unitFloors.push(f);
  }
  const uncovered = unitFloors.filter((f) => !b.floor_plans.some((r) => f >= r.from_floor && f <= r.to_floor));
  if (uncovered.length > 0) {
    ctx.addIssue({ code: "custom", message: `Floors without a floor plan: ${uncovered.join(", ")}`, path: ["floor_plans"] });
  }
}

/** Create a block (tower/villa block); flats are generated atomically unless generate_flats=false. */
export const BlockCreateSchema = BlockBase.superRefine(addBlockIssues);
export type BlockCreate = z.infer<typeof BlockCreateSchema>;

/** Update a block (partial + version); structural fields only while no flat is beyond AVAILABLE. */
export const BlockUpdateSchema = updateOf(BlockBase.omit({ project_id: true, generate_flats: true }));
export type BlockUpdate = z.infer<typeof BlockUpdateSchema>;

/** Block row. */
export const BlockRowSchema = MasterRowSchema.extend({
  project_id: IdSchema,
  project_name: z.string(),
  block_type_id: IdSchema,
  block_type_name: z.string(),
  has_floors: z.boolean(),
  name: z.string(),
  code: z.string(),
  floors: z.int(),
  floor_start: z.int(),
  ground_floor_label: z.string(),
  skip_floors: z.array(z.int()),
  refuge_floors: z.array(z.int()),
  podium_floors: z.array(z.int()),
  floor_plans: z.array(
    z.object({ from_floor: z.int(), to_floor: z.int(), floor_plan_template_id: IdSchema, template_name: z.string() }),
  ),
  numbering_pattern: NumberingPatternSchema,
  stage_sequence: z.array(IdSchema),
  construction_percent: z.number().min(0).max(100),
  current_stage_name: z.string().nullable(),
  unit_counts: UnitCountsSchema,
  status: BlockStatusSchema,
  sort_order: z.int(),
  has_flats: z.boolean(),
});
export type BlockRow = z.infer<typeof BlockRowSchema>;

/** List filter for blocks. */
export const BlockFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  block_type_id: IdSchema.optional(),
  status: BlockStatusSchema.optional(),
});
export type BlockFilter = z.infer<typeof BlockFilterSchema>;

export const BlockListResponseSchema = listEnvelope(BlockRowSchema);
export type BlockListResponse = z.infer<typeof BlockListResponseSchema>;

/** Regenerate / generate flats for a block without flats (blocked once any flat is not AVAILABLE). */
export const BlockGenerateFlatsSchema = z.strictObject({ ...VersionedSchema.shape, regenerate: z.boolean().default(false) });
export type BlockGenerateFlats = z.infer<typeof BlockGenerateFlatsSchema>;

/** Append floors to an existing block. */
export const BlockAppendFloorsSchema = z
  .strictObject({
    ...VersionedSchema.shape,
    new_floors: z.int().min(1).max(200),
    floor_plans: z.array(FloorPlanRangeSchema).min(1).max(20),
    skip_floors: z.array(z.int()).max(20).default([]),
    refuge_floors: z.array(z.int()).max(20).default([]),
  })
  .refine((a) => rangesDisjoint(a.floor_plans), { message: "Floor-plan ranges must not overlap", path: ["floor_plans"] });
export type BlockAppendFloors = z.infer<typeof BlockAppendFloorsSchema>;

/** Result of generation. */
export const BlockGenerateFlatsResponseSchema = z.object({
  block_id: IdSchema,
  flats_created: z.int().min(0),
  floors_with_units: z.int().min(0),
  version: z.int(),
});
export type BlockGenerateFlatsResponse = z.infer<typeof BlockGenerateFlatsResponseSchema>;

/** Replace a block's stage sequence (ordered stage ids); allowed while no stage is completed. */
export const BlockStageSequenceUpdateSchema = z.strictObject({ ...VersionedSchema.shape, stage_sequence: z.array(IdSchema).min(1).max(100) });
export type BlockStageSequenceUpdate = z.infer<typeof BlockStageSequenceUpdateSchema>;

/** Grid query. */
export const BlockGridQuerySchema = z.object({ colour_by: GridColourModeSchema.default("STATUS") });
export type BlockGridQuery = z.infer<typeof BlockGridQuerySchema>;

/** One cell (flat) in the stacked grid. */
export const BlockGridCellSchema = z.object({
  flat_id: IdSchema,
  flat_number: z.string(),
  position: z.int().min(1),
  status: FlatStatusSchema,
  flat_type_id: IdSchema,
  flat_type_code: z.string(),
  facing: z.string().nullable(),
  is_corner: z.boolean(),
  super_builtup_sqft: z.number(),
  price_paise: PaiseSchema,
  price_band: z.int().min(0),
  booking_id: IdSchema.nullable(),
  customer_name: z.string().nullable(),
  hold_until: z.string().nullable(),
});
export type BlockGridCell = z.infer<typeof BlockGridCellSchema>;

/** One row of the grid (a floor). Refuge/podium floors have no cells. */
export const BlockGridFloorSchema = z.object({
  floor: z.int(),
  floor_label: z.string(),
  kind: FloorKindSchema,
  cells: z.array(BlockGridCellSchema),
});
export type BlockGridFloor = z.infer<typeof BlockGridFloorSchema>;

/** Legend counts by status. */
export const StatusCountsSchema = z.object({
  AVAILABLE: z.int().min(0),
  HOLD: z.int().min(0),
  BLOCKED: z.int().min(0),
  BOOKED: z.int().min(0),
  SOLD: z.int().min(0),
} satisfies Record<(typeof FLAT_STATUSES)[number], z.ZodType>);
export type StatusCounts = z.infer<typeof StatusCountsSchema>;

/** Price band for the colour-by-price legend. */
export const PriceBandSchema = z.object({
  band: z.int().min(0),
  label: z.string(),
  min_paise: PaiseSchema,
  max_paise: PaiseSchema,
  count: z.int().min(0),
});
export type PriceBand = z.infer<typeof PriceBandSchema>;

/** The stacked tower grid: floors descending, positions across, refuge rows shown, legend counts. */
export const BlockGridResponseSchema = z.object({
  block_id: IdSchema,
  block_name: z.string(),
  project_id: IdSchema,
  project_name: z.string(),
  positions: z.int().min(0),
  colour_by: GridColourModeSchema,
  floors: z.array(BlockGridFloorSchema),
  legend: z.object({
    by_status: StatusCountsSchema,
    by_flat_type: z.array(z.object({ flat_type_id: IdSchema, code: z.string(), name: z.string(), count: z.int().min(0) })),
    price_bands: z.array(PriceBandSchema),
  }),
  unit_counts: UnitCountsSchema,
  generated_at: z.string(),
});
export type BlockGridResponse = z.infer<typeof BlockGridResponseSchema>;

/** Preview grid for the block wizard before generation (no ids yet). */
export const BlockPreviewRequestSchema = BlockBase.omit({ generate_flats: true }).superRefine((b, ctx) =>
  addBlockIssues({ ...b, generate_flats: false }, ctx),
);
export type BlockPreviewRequest = z.infer<typeof BlockPreviewRequestSchema>;

export const BlockPreviewCellSchema = z.object({
  flat_number: z.string(),
  position: z.int(),
  flat_type_id: IdSchema,
  flat_type_code: z.string(),
  facing: z.string().nullable(),
  is_corner: z.boolean(),
  super_builtup_sqft: z.number(),
  price_paise: PaiseSchema,
});
export type BlockPreviewCell = z.infer<typeof BlockPreviewCellSchema>;

export const BlockPreviewResponseSchema = z.object({
  total_flats: z.int().min(0),
  floors: z.array(z.object({ floor: z.int(), floor_label: z.string(), kind: FloorKindSchema, cells: z.array(BlockPreviewCellSchema) })),
  total_value_paise: PaiseSchema,
});
export type BlockPreviewResponse = z.infer<typeof BlockPreviewResponseSchema>;
