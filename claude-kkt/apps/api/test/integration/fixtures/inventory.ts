import type { TestContext } from "../helpers.js";

/** Master data the inventory tests build on (docs/SEED.md shapes: FP-4, FP-4-PREMIUM, SGH rate card PLCs). */
export interface InventoryBasics {
  roomTypeId: string;
  areaTypes: { CARPET: string; BUILT_UP: string; SUPER_BUILT_UP: string };
  /** 2BHK-A, 2BHK-B, 3BHK-A, 3BHK-B. */
  flatTypes: { A2: string; B2: string; A3: string; B3: string };
  towerBlockTypeId: string;
  villaBlockTypeId: string;
  /** FP-4 (mixed, corners at 1 and 4) and FP-4-PREMIUM (4 × 3BHK-A, corners at 1 and 4). */
  templates: { FP4: string; FP4P: string };
  stageIds: string[];
  possessionStageId: string;
  plc: { floorRise: string; corner: string; topFloor: string };
  amenityIds: string[];
  specItemId: string;
}

/** Flat type areas and base rates (paise per sq ft) used by the fixture. */
export const FLAT_TYPE_SPECS = {
  A2: { code: "2BHK-A", bhk: 2, carpet: 720, builtup: 860, superb: 1050, rate: 520_000 },
  B2: { code: "2BHK-B", bhk: 2, carpet: 780, builtup: 930, superb: 1130, rate: 540_000 },
  A3: { code: "3BHK-A", bhk: 3, carpet: 1050, builtup: 1250, superb: 1520, rate: 560_000 },
  B3: { code: "3BHK-B", bhk: 3, carpet: 1180, builtup: 1400, superb: 1700, rate: 580_000 },
} as const;

/** POST that must answer 201; throws with the body otherwise. */
export async function post<T = Record<string, unknown>>(
  t: TestContext,
  token: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const r = await t.request<T>("POST", url, { token, body, headers });
  if (r.status !== 201) throw new Error(`POST ${url} → ${r.status} ${r.text}`);
  return r.body;
}

/** Creates room/area types, four flat types, block types, two floor-plan templates, stages, PLC types, amenities and a spec item. */
export async function createInventoryBasics(t: TestContext, token: string): Promise<InventoryBasics> {
  const room = await post<{ id: string }>(t, token, "/api/v1/masters/room-types", {
    name: "Bedroom",
    code: "BED",
    sort_order: 1,
  });
  const carpet = await post<{ id: string }>(t, token, "/api/v1/masters/area-types", {
    name: "Carpet",
    code: "CARPET",
    sort_order: 1,
  });
  const builtup = await post<{ id: string }>(t, token, "/api/v1/masters/area-types", {
    name: "Built-up",
    code: "BUILT_UP",
    sort_order: 2,
  });
  const superB = await post<{ id: string }>(t, token, "/api/v1/masters/area-types", {
    name: "Super built-up",
    code: "SUPER_BUILT_UP",
    sort_order: 3,
  });
  const cat = await post<{ id: string }>(t, token, "/api/v1/masters/spec-categories", {
    name: "Flooring",
    sort_order: 1,
  });
  const item = await post<{ id: string }>(t, token, "/api/v1/masters/spec-items", {
    category_id: cat.id,
    name: "Vitrified tiles",
    description: "800x800 double charged",
    sort_order: 1,
  });

  const flatTypes = {} as InventoryBasics["flatTypes"];
  for (const key of ["A2", "B2", "A3", "B3"] as const) {
    const s = FLAT_TYPE_SPECS[key];
    const ft = await post<{ id: string }>(t, token, "/api/v1/masters/flat-types", {
      name: s.code,
      code: s.code,
      bhk: s.bhk,
      facing: "East",
      rooms: [
        { room_type_id: room.id, label: "Master Bedroom", length_ft: 12, width_ft: 14 },
        { room_type_id: room.id, label: "Bedroom 2", length_ft: 11, width_ft: 12 },
      ],
      areas: [
        { area_type_id: carpet.id, sqft: s.carpet },
        { area_type_id: builtup.id, sqft: s.builtup },
        { area_type_id: superB.id, sqft: s.superb },
      ],
      base_rate_per_sqft_paise: s.rate,
      ...(key === "A3" ? { spec_item_ids: [item.id] } : {}),
    });
    flatTypes[key] = ft.id;
  }

  const tower = await post<{ id: string }>(t, token, "/api/v1/masters/block-types", {
    name: "Tower",
    code: "TOWER",
    has_floors: true,
  });
  const villa = await post<{ id: string }>(t, token, "/api/v1/masters/block-types", {
    name: "Villa",
    code: "VILLA",
    has_floors: false,
  });
  const fp4 = await post<{ id: string }>(t, token, "/api/v1/masters/floor-plan-templates", {
    name: "FP-4",
    code: "FP-4",
    positions: [
      { position: 1, flat_type_id: flatTypes.A3, facing: "E", is_corner: true },
      { position: 2, flat_type_id: flatTypes.A2, facing: "N" },
      { position: 3, flat_type_id: flatTypes.B2, facing: "S" },
      { position: 4, flat_type_id: flatTypes.B3, facing: "W", is_corner: true },
    ],
  });
  const fp4p = await post<{ id: string }>(t, token, "/api/v1/masters/floor-plan-templates", {
    name: "FP-4-PREMIUM",
    code: "FP-4-PREMIUM",
    positions: [
      { position: 1, flat_type_id: flatTypes.A3, facing: "E", is_corner: true },
      { position: 2, flat_type_id: flatTypes.A3, facing: "N" },
      { position: 3, flat_type_id: flatTypes.A3, facing: "S" },
      { position: 4, flat_type_id: flatTypes.A3, facing: "W", is_corner: true },
    ],
  });

  const stageIds: string[] = [];
  for (const [i, name] of ["Excavation", "Foundation", "Plinth", "Top Slab"].entries()) {
    const s = await post<{ id: string }>(t, token, "/api/v1/masters/construction-stages", {
      name,
      code: name.toUpperCase().replace(/ /g, "_"),
      sort_order: (i + 1) * 10,
    });
    stageIds.push(s.id);
  }
  const possession = await post<{ id: string }>(t, token, "/api/v1/masters/construction-stages", {
    name: "Possession",
    code: "POSSESSION",
    sort_order: 140,
    is_possession: true,
  });
  stageIds.push(possession.id);

  const floorRise = await post<{ id: string }>(t, token, "/api/v1/masters/plc-types", {
    name: "Floor Rise",
    code: "FLOOR_RISE",
    calc_mode: "FLOOR_RISE",
  });
  const corner = await post<{ id: string }>(t, token, "/api/v1/masters/plc-types", {
    name: "Corner",
    code: "CORNER",
    calc_mode: "PER_SQFT",
  });
  const topFloor = await post<{ id: string }>(t, token, "/api/v1/masters/plc-types", {
    name: "Top Floor",
    code: "TOP_FLOOR",
    calc_mode: "FIXED",
  });

  const amenityIds: string[] = [];
  for (const name of ["Clubhouse", "Swimming Pool"])
    amenityIds.push(
      (await post<{ id: string }>(t, token, "/api/v1/masters/amenities", { name, category: "Leisure" })).id,
    );

  return {
    roomTypeId: room.id,
    areaTypes: { CARPET: carpet.id, BUILT_UP: builtup.id, SUPER_BUILT_UP: superB.id },
    flatTypes,
    towerBlockTypeId: tower.id,
    villaBlockTypeId: villa.id,
    templates: { FP4: fp4.id, FP4P: fp4p.id },
    stageIds,
    possessionStageId: possession.id,
    plc: { floorRise: floorRise.id, corner: corner.id, topFloor: topFloor.id },
    amenityIds,
    specItemId: item.id,
  };
}

/** Body for POST /projects. */
export function projectBody(name: string, code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    code,
    project_type: "RESIDENTIAL",
    status: "UNDER_CONSTRUCTION",
    address: { line1: "Bailey Road", locality: "Raja Bazar", city: "Patna", state: "Bihar", pincode: "800014" },
    rera_number: "BRERAP00123-1/23",
    launch_date: "2024-10-01",
    possession_date: "2027-12-31",
    landmarks: [{ name: "Patna Junction", distance_km: 6.5 }],
    approvals: [{ name: "RERA", number: "BRERAP00123-1/23", status: "RECEIVED" }],
    ...extra,
  };
}

/** Tower C (SPEC §18 scenario 2): 15 floors, skip 13, refuge 7, floors 1–5 FP-4, 6–15 FP-4-PREMIUM → 52 flats. */
export function towerCBody(
  projectId: string,
  b: InventoryBasics,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    project_id: projectId,
    block_type_id: b.towerBlockTypeId,
    name: "Tower C",
    code: "C",
    floors: 15,
    floor_start: 1,
    ground_floor_label: "G",
    skip_floors: [13],
    refuge_floors: [7],
    podium_floors: [],
    floor_plans: [
      { from_floor: 1, to_floor: 5, floor_plan_template_id: b.templates.FP4 },
      { from_floor: 6, to_floor: 15, floor_plan_template_id: b.templates.FP4P },
    ],
    numbering_pattern: "{block}-{floor}{pos2}",
    status: "UNDER_CONSTRUCTION",
    ...extra,
  };
}

/** Rate card body: per-sq-ft rates for the four flat types (× `factor`) with Floor Rise ₹25/sq ft/floor and Corner ₹100/sq ft. */
export function rateCardBody(projectId: string, b: InventoryBasics, name: string, factor = 1): Record<string, unknown> {
  return {
    project_id: projectId,
    name,
    effective_from: "2025-04-01",
    rates: (["A2", "B2", "A3", "B3"] as const).map((k) => ({
      flat_type_id: b.flatTypes[k],
      rate_per_sqft_paise: Math.round(FLAT_TYPE_SPECS[k].rate * factor),
    })),
    plc_rules: [
      { plc_type_id: b.plc.floorRise, calc_mode: "FLOOR_RISE", value: 2500, applies_to: "ALL", sort_order: 1 },
      { plc_type_id: b.plc.corner, calc_mode: "PER_SQFT", value: 10_000, applies_to: "CORNER", sort_order: 2 },
    ],
  };
}
