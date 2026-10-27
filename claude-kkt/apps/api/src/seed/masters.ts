/** Step 1 — master data (docs/SEED.md "Masters"), all through POST /masters/<kind>. */
import { LAKH, type SeedContext } from "./context.js";

export const ROOM_TYPES = [
  "Bedroom",
  "Master Bedroom",
  "Kitchen",
  "Living",
  "Dining",
  "Toilet",
  "Balcony",
  "Store",
  "Pooja",
  "Study",
  "Utility",
] as const;
export const AREA_TYPES = [
  ["CARPET", "Carpet"],
  ["BUILT_UP", "Built-up"],
  ["SUPER_BUILT_UP", "Super built-up"],
  ["BALCONY", "Balcony"],
  ["TERRACE", "Terrace"],
  ["PARKING", "Parking"],
] as const;
export const BLOCK_TYPES = [
  ["TOWER", "Tower", true],
  ["VILLA", "Villa", false],
  ["ROW_HOUSE", "Row House", true],
  ["DUPLEX", "Duplex", true],
  ["COMMERCIAL", "Commercial", true],
] as const;
export const AMENITIES = [
  ["Clubhouse", "Leisure", "building"],
  ["Swimming Pool", "Leisure", "waves"],
  ["Gym", "Wellness", "dumbbell"],
  ["Children's Play Area", "Family", "baby"],
  ["Landscaped Gardens", "Outdoors", "tree"],
  ["24×7 Security", "Safety", "shield"],
  ["Power Backup", "Utilities", "zap"],
  ["Rainwater Harvesting", "Sustainability", "droplet"],
  ["Indoor Games", "Leisure", "gamepad"],
  ["Jogging Track", "Wellness", "footprints"],
  ["EV Charging", "Utilities", "plug"],
  ["Temple", "Community", "landmark"],
] as const;
/** The 14 construction stages in master order; the last one is the possession stage. */
export const STAGES = [
  "Excavation",
  "Foundation",
  "Plinth",
  "1st Slab",
  "2nd Slab",
  "3rd Slab",
  "4th Slab",
  "Top Slab",
  "Brickwork",
  "Plastering",
  "Flooring",
  "Finishing",
  "External Development",
  "Possession/Handover",
] as const;
export type StageName = (typeof STAGES)[number];
export const SERVICE_CATEGORIES = [
  ["Payment query", "HIGH"],
  ["Document request", "MEDIUM"],
  ["Construction query", "MEDIUM"],
  ["Possession", "HIGH"],
  ["Defect/Snag", "HIGH"],
  ["Agreement", "MEDIUM"],
  ["Other", "LOW"],
] as const;

/** Flat types: carpet / built-up / super built-up sq ft and the rate used by the SGH rate card. */
export const FLAT_TYPES = {
  A2: { name: "2BHK-A", code: "2BHK-A", bhk: 2, carpet: 720, builtup: 860, superb: 1050, rate: 520_000, balcony: 60 },
  B2: { name: "2BHK-B", code: "2BHK-B", bhk: 2, carpet: 780, builtup: 930, superb: 1130, rate: 540_000, balcony: 70 },
  A3: { name: "3BHK-A", code: "3BHK-A", bhk: 3, carpet: 1050, builtup: 1250, superb: 1520, rate: 560_000, balcony: 90 },
  B3: {
    name: "3BHK-B",
    code: "3BHK-B",
    bhk: 3,
    carpet: 1180,
    builtup: 1400,
    superb: 1700,
    rate: 580_000,
    balcony: 110,
  },
  VILLA: {
    name: "4BHK Villa",
    code: "4BHK-VILLA",
    bhk: 4,
    carpet: 2100,
    builtup: 2500,
    superb: 3000,
    rate: null,
    balcony: 180,
  },
} as const;

function stageCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export async function seedMasters(ctx: SeedContext): Promise<void> {
  ctx.log(
    "masters: room/area/block types, amenities, stages, charges, modes, banks, document/PLC types, specifications, service categories, flat types, floor plans",
  );
  const post = <T = { id: string }>(kind: string, body: unknown) => ctx.post<T>(`/api/v1/masters/${kind}`, body);

  for (const [i, name] of ROOM_TYPES.entries())
    ctx.ids[`room:${name}`] = (await post("room-types", { name, code: stageCode(name), sort_order: i + 1 })).id;
  for (const [i, [code, name]] of AREA_TYPES.entries())
    ctx.ids[`area:${code}`] = (await post("area-types", { name, code, sort_order: i + 1 })).id;
  for (const [code, name, hasFloors] of BLOCK_TYPES)
    ctx.ids[`blockType:${code}`] = (await post("block-types", { name, code, has_floors: hasFloors })).id;
  for (const [name, category, icon] of AMENITIES)
    ctx.ids[`amenity:${name}`] = (await post("amenities", { name, category, icon })).id;

  for (const [i, name] of STAGES.entries()) {
    const id = (
      await post("construction-stages", {
        name,
        code: stageCode(name),
        sort_order: (i + 1) * 10,
        is_possession: i === STAGES.length - 1,
      })
    ).id;
    ctx.stages[name] = id;
    ctx.stageOrder.push(id);
  }

  const charges = [
    ["REGISTRY", "Registry & Stamp Duty", 250_000_00, false, 0, "ON_POSSESSION"],
    ["MAINTENANCE", "Maintenance Deposit", 60_000_00, true, 18, "ON_POSSESSION"],
    ["GST", "GST on flat", 0, false, 0, "MANUAL"],
    ["PARKING", "Car Parking", 3 * LAKH, true, 5, "ON_BOOKING"],
    ["CLUB", "Club Membership", 1 * LAKH, true, 18, "ON_BOOKING"],
    ["LEGAL", "Legal Charges", 25_000_00, true, 18, "ON_BOOKING"],
    ["ELECTRICITY", "Electricity & Water Connection", 75_000_00, false, 0, "MANUAL"],
  ] as const;
  for (const [code, name, amount, taxable, gst, demandAt] of charges) {
    ctx.ids[`charge:${code}`] = (
      await post("charge-types", {
        name,
        code,
        default_amount_paise: amount,
        is_taxable: taxable,
        default_gst_percent: gst,
        demand_at: demandAt,
      })
    ).id;
  }

  const modes = [
    ["CASH", "Cash", false, true, true],
    ["CHEQUE", "Cheque", true, false, false],
    ["NEFT_RTGS", "NEFT/RTGS", true, true, false],
    ["UPI", "UPI", true, true, false],
    ["DD", "DD", true, false, false],
    ["LOAN_DISBURSEMENT", "Bank Loan Disbursement", true, true, false],
  ] as const;
  for (const [i, [code, name, instrument, clears, cash]] of modes.entries()) {
    ctx.ids[`mode:${code}`] = (
      await post("payment-modes", {
        name,
        code,
        requires_instrument: instrument,
        clears_immediately: clears,
        is_cash: cash,
        sort_order: i + 1,
      })
    ).id;
  }

  ctx.ids["bank:HDFC"] = (
    await post("bank-accounts", {
      bank_name: "HDFC Bank",
      branch: "Boring Road",
      account_name: "Shree Ganesh Builders – Escrow SGH",
      account_number: "50100234567890",
      ifsc: "HDFC0000123",
      is_default: true,
      is_escrow: true,
    })
  ).id;
  ctx.ids["bank:SBI"] = (
    await post("bank-accounts", {
      bank_name: "State Bank of India",
      branch: "Patna Main",
      account_name: "Shree Ganesh Builders – Escrow GGV",
      account_number: "32109876543210",
      ifsc: "SBIN0000152",
      is_default: false,
      is_escrow: true,
    })
  ).id;

  const docTypes = [
    ["PAN", "PAN", ["CUSTOMER"], true],
    ["AADHAAR", "Aadhaar", ["CUSTOMER"], true],
    ["PHOTO", "Photograph", ["CUSTOMER"], true],
    ["AGREEMENT", "Agreement", ["BOOKING"], false],
    ["ALLOTMENT", "Allotment Letter", ["BOOKING"], false],
    ["PLAN_ACCEPTANCE", "Payment Plan Acceptance", ["BOOKING", "CUSTOMER"], false],
    ["RECEIPT", "Receipt", ["PAYMENT", "BOOKING"], false],
    ["BROCHURE", "Brochure", ["PROJECT"], false],
    ["FLOOR_PLAN", "Floor Plan", ["PROJECT", "FLAT", "BLOCK"], false],
    ["APPROVAL", "Approval", ["PROJECT"], false],
  ] as const;
  for (const [code, name, appliesTo, isKyc] of docTypes)
    ctx.ids[`docType:${code}`] = (
      await post("document-types", { name, code, applies_to: [...appliesTo], is_kyc: isKyc })
    ).id;

  const plcs = [
    ["FLOOR_RISE", "Floor Rise", "FLOOR_RISE"],
    ["CORNER", "Corner", "PER_SQFT"],
    ["PARK_FACING", "Park Facing", "PER_SQFT"],
    ["ROAD_FACING", "Road Facing", "PER_SQFT"],
    ["TOP_FLOOR", "Top Floor", "FIXED"],
    ["VASTU", "Vastu", "PERCENT"],
  ] as const;
  for (const [code, name, mode] of plcs)
    ctx.ids[`plc:${code}`] = (await post("plc-types", { name, code, calc_mode: mode })).id;

  const specs: [string, [string, string][]][] = [
    [
      "Flooring",
      [
        ["Vitrified tiles", "800×800 double-charged vitrified tiles in living, dining and bedrooms"],
        ["Wooden laminate in master bedroom", "8 mm laminated wooden flooring"],
      ],
    ],
    [
      "Kitchen",
      [
        ["Granite platform", "Polished granite counter with dado tiles up to 2 ft"],
        ["SS sink", "Stainless-steel single-bowl sink with drain board"],
      ],
    ],
    [
      "Doors & Windows",
      [
        ["Teak frame main door", "Seasoned teak frame with flush shutter"],
        ["UPVC windows", "Three-track UPVC sliding windows with mosquito mesh"],
      ],
    ],
    [
      "Electrical",
      [
        ["Modular switches", "Anchor/Legrand modular switches"],
        ["Copper wiring", "Concealed FRLS copper wiring with MCB distribution"],
      ],
    ],
    [
      "Bathroom",
      [
        ["CP fittings", "Jaquar/Cera chrome-plated fittings"],
        ["Anti-skid tiles", "Anti-skid ceramic flooring with tiles up to 7 ft"],
      ],
    ],
    ["Paint", [["Acrylic emulsion", "Premium acrylic emulsion on internal walls, weather-proof exterior"]]],
  ];
  const specItemIds: string[] = [];
  for (const [i, [cat, items]] of specs.entries()) {
    const catId = (await post("spec-categories", { name: cat, sort_order: i + 1 })).id;
    ctx.ids[`specCat:${cat}`] = catId;
    for (const [j, [name, description]] of items.entries()) {
      const id = (await post("spec-items", { category_id: catId, name, description, sort_order: j + 1 })).id;
      ctx.ids[`spec:${name}`] = id;
      specItemIds.push(id);
    }
  }

  for (const [i, [name, priority]] of SERVICE_CATEGORIES.entries()) {
    ctx.serviceCategories[name] = (
      await post("service-categories", { name, sort_order: i + 1, default_priority: priority })
    ).id;
  }

  // flat types with realistic rooms (L × W ft) and areas
  const room = (name: string) => ctx.ids[`room:${name}`]!;
  const area = (code: string) => ctx.ids[`area:${code}`]!;
  const rooms2 = (big: boolean) => [
    { room_type_id: room("Master Bedroom"), label: "Master Bedroom", length_ft: big ? 14 : 12, width_ft: 11 },
    { room_type_id: room("Bedroom"), label: "Bedroom 2", length_ft: 12, width_ft: 10 },
    { room_type_id: room("Living"), label: "Living", length_ft: big ? 18 : 16, width_ft: 12 },
    { room_type_id: room("Kitchen"), label: "Kitchen", length_ft: 10, width_ft: 8 },
    { room_type_id: room("Toilet"), label: "Toilet 1", length_ft: 7, width_ft: 5 },
    { room_type_id: room("Toilet"), label: "Toilet 2", length_ft: 6, width_ft: 4 },
    { room_type_id: room("Balcony"), label: "Balcony", length_ft: 8, width_ft: 4 },
  ];
  const rooms3 = (big: boolean) => [
    ...rooms2(big),
    { room_type_id: room("Bedroom"), label: "Bedroom 3", length_ft: 11, width_ft: 10 },
    { room_type_id: room("Dining"), label: "Dining", length_ft: 12, width_ft: 10 },
    { room_type_id: room("Pooja"), label: "Pooja", length_ft: 4, width_ft: 4 },
  ];
  const roomsVilla = [
    ...rooms3(true),
    { room_type_id: room("Bedroom"), label: "Bedroom 4", length_ft: 12, width_ft: 11 },
    { room_type_id: room("Study"), label: "Study", length_ft: 10, width_ft: 9 },
    { room_type_id: room("Store"), label: "Store", length_ft: 6, width_ft: 5 },
    { room_type_id: room("Utility"), label: "Utility", length_ft: 8, width_ft: 5 },
  ];
  const areas = (t: (typeof FLAT_TYPES)[keyof typeof FLAT_TYPES], terrace?: number) => [
    { area_type_id: area("CARPET"), sqft: t.carpet },
    { area_type_id: area("BUILT_UP"), sqft: t.builtup },
    { area_type_id: area("SUPER_BUILT_UP"), sqft: t.superb },
    { area_type_id: area("BALCONY"), sqft: t.balcony },
    ...(terrace ? [{ area_type_id: area("TERRACE"), sqft: terrace }] : []),
  ];
  const specFor = (names: string[]) => names.map((n) => ctx.ids[`spec:${n}`]!);
  const common = [
    "Vitrified tiles",
    "Granite platform",
    "SS sink",
    "UPVC windows",
    "Modular switches",
    "Copper wiring",
    "CP fittings",
    "Anti-skid tiles",
    "Acrylic emulsion",
  ];
  const defs: [keyof typeof FLAT_TYPES, string, unknown[], unknown[], string[], Record<string, unknown>][] = [
    [
      "A2",
      "North",
      rooms2(false),
      areas(FLAT_TYPES.A2),
      common,
      {
        base_rate_per_sqft_paise: FLAT_TYPES.A2.rate,
        description: "Compact 2 BHK with a sunlit living room and a private balcony.",
      },
    ],
    [
      "B2",
      "South",
      rooms2(true),
      areas(FLAT_TYPES.B2),
      common,
      {
        base_rate_per_sqft_paise: FLAT_TYPES.B2.rate,
        description: "Spacious 2 BHK with a larger master bedroom and a dining nook.",
      },
    ],
    [
      "A3",
      "East",
      rooms3(false),
      areas(FLAT_TYPES.A3),
      [...common, "Wooden laminate in master bedroom"],
      {
        base_rate_per_sqft_paise: FLAT_TYPES.A3.rate,
        description: "East-facing 3 BHK with pooja room and two balconies.",
      },
    ],
    [
      "B3",
      "West",
      rooms3(true),
      areas(FLAT_TYPES.B3),
      [...common, "Wooden laminate in master bedroom", "Teak frame main door"],
      {
        base_rate_per_sqft_paise: FLAT_TYPES.B3.rate,
        description: "Corner 3 BHK with a large living-dining and three toilets.",
      },
    ],
    [
      "VILLA",
      "East",
      roomsVilla,
      areas(FLAT_TYPES.VILLA, 400),
      [...common, "Wooden laminate in master bedroom", "Teak frame main door"],
      {
        base_price_paise: 100 * LAKH,
        description: "Independent 4 BHK villa on a 2,400 sq ft plot with a private terrace garden.",
      },
    ],
  ];
  for (const [key, facing, rooms, ar, specNames, extra] of defs) {
    const t = FLAT_TYPES[key];
    ctx.ids[`flatType:${key}`] = (
      await post("flat-types", {
        name: t.name,
        code: t.code,
        bhk: t.bhk,
        facing,
        rooms,
        areas: ar,
        spec_item_ids: specFor(specNames),
        ...extra,
      })
    ).id;
  }
  void specItemIds;

  const ft = (k: keyof typeof FLAT_TYPES) => ctx.ids[`flatType:${k}`]!;
  ctx.ids["template:FP4"] = (
    await post("floor-plan-templates", {
      name: "FP-4",
      code: "FP-4",
      positions: [
        { position: 1, flat_type_id: ft("A3"), facing: "E", is_corner: true },
        { position: 2, flat_type_id: ft("A2"), facing: "N" },
        { position: 3, flat_type_id: ft("B2"), facing: "S" },
        { position: 4, flat_type_id: ft("B3"), facing: "W", is_corner: true },
      ],
    })
  ).id;
  ctx.ids["template:FP4P"] = (
    await post("floor-plan-templates", {
      name: "FP-4-PREMIUM",
      code: "FP-4-PREMIUM",
      positions: [
        { position: 1, flat_type_id: ft("A3"), facing: "E", is_corner: true },
        { position: 2, flat_type_id: ft("A3"), facing: "N" },
        { position: 3, flat_type_id: ft("A3"), facing: "S" },
        { position: 4, flat_type_id: ft("A3"), facing: "W", is_corner: true },
      ],
    })
  ).id;
  ctx.ids["template:VILLA"] = (
    await post("floor-plan-templates", {
      name: "FP-VILLA",
      code: "FP-VILLA",
      positions: [{ position: 1, flat_type_id: ft("VILLA"), facing: "E" }],
    })
  ).id;
}
