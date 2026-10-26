import { describe, expect, it } from "vitest";
import {
  FlatGenerationError,
  flatNumber,
  floorLabel,
  generateFlats,
  physicalFloors,
  planForFloor,
  unitFloors,
  validateFlatType,
  validateFloorPlanRanges,
  type BlockDefinition,
  type FlatTypeDefinition,
  type FloorPlanTemplate,
  type PricingFn,
} from "../src/index.js";

const towerC: BlockDefinition = {
  code: "C",
  floors: 15,
  floorStart: 1,
  skipFloors: [13],
  refugeFloors: [7],
  podiumFloors: [],
  floorPlans: [
    { fromFloor: 1, toFloor: 5, floorPlanTemplateId: "planA" },
    { fromFloor: 6, toFloor: 15, floorPlanTemplateId: "planB" },
  ],
  numberingPattern: "{block}-{floor}{pos2}",
};

const flatTypes: FlatTypeDefinition[] = [
  {
    id: "ft3",
    code: "3BHK-A",
    name: "3BHK-A",
    facing: "EAST",
    rooms: [
      { roomTypeId: "r1", roomTypeName: "Bedroom", label: "Master Bedroom", lengthFt: 14, widthFt: 12, sqft: 168 },
    ],
    areas: [
      { areaTypeId: "a1", areaTypeCode: "CARPET", areaTypeName: "Carpet", sqft: 1000 },
      { areaTypeId: "a3", areaTypeCode: "SUPER_BUILT_UP", areaTypeName: "Super Built-up", sqft: 1250 },
    ],
    carpetSqft: 1000,
    builtupSqft: 1100,
    superBuiltupSqft: 1250,
    baseRatePerSqftPaise: 550_000,
    basePricePaise: null,
  },
  {
    id: "ft2",
    code: "2BHK",
    name: "2BHK",
    facing: null,
    rooms: [{ roomTypeId: "r1", roomTypeName: "Bedroom", label: "Bedroom", lengthFt: 12, widthFt: 10, sqft: 120 }],
    areas: [{ areaTypeId: "a3", areaTypeCode: "SUPER_BUILT_UP", areaTypeName: "Super Built-up", sqft: 900 }],
    carpetSqft: 700,
    builtupSqft: 800,
    superBuiltupSqft: 900,
    baseRatePerSqftPaise: null,
    basePricePaise: 4_500_000_00,
  },
];

const templates: FloorPlanTemplate[] = [
  {
    id: "planA",
    flatsPerFloor: 4,
    positions: [
      { position: 1, flatTypeId: "ft3", facing: "NORTH", isCorner: true },
      { position: 2, flatTypeId: "ft2" },
      { position: 3, flatTypeId: "ft2" },
      { position: 4, flatTypeId: "ft3", isCorner: true },
    ],
  },
  {
    id: "planB",
    flatsPerFloor: 2,
    positions: [
      { position: 1, flatTypeId: "ft3", isCorner: true },
      { position: 2, flatTypeId: "ft2", facing: "WEST" },
    ],
  },
];

const pricing: PricingFn = (ctx) => ({
  breakup: [{ label: "Base", amountPaise: ctx.flatType.superBuiltupSqft * 100 + ctx.floor }],
  totalPaise: ctx.flatType.superBuiltupSqft * 100 + ctx.floor,
  ratePerSqftPaise: 100,
});

describe("floors", () => {
  it("builds floorStart..floors inclusive, excluding the skip list (SPEC §4 step 1)", () => {
    const floors = physicalFloors(towerC);
    expect(floors).toHaveLength(14);
    expect(floors).not.toContain(13);
    expect(floors[0]).toBe(1);
    expect(floors.at(-1)).toBe(15);
    expect(physicalFloors({ floors: 2, floorStart: 0, skipFloors: [] })).toEqual([0, 1, 2]);
    expect(physicalFloors({ floors: 5, floorStart: 1, skipFloors: [1, 2] })).toEqual([3, 4, 5]);
    expect(physicalFloors({ floors: 0, floorStart: 0, skipFloors: [] })).toEqual([0]);
    expect(physicalFloors({ floors: 3, floorStart: 1, skipFloors: [99] })).toEqual([1, 2, 3]);
  });
  it("unit floors exclude refuge and podium", () => {
    const floors = unitFloors(towerC);
    expect(floors).toHaveLength(13);
    expect(floors).not.toContain(7);
    expect(floors).not.toContain(13);
    expect(unitFloors({ ...towerC, podiumFloors: [1, 2] })).toHaveLength(11);
  });
  it("rejects bad floor counts", () => {
    expect(() => physicalFloors({ floors: 0, floorStart: 1, skipFloors: [] })).toThrow(FlatGenerationError);
    expect(() => physicalFloors({ floors: 1.5, floorStart: 1, skipFloors: [] })).toThrow(FlatGenerationError);
    expect(() => physicalFloors({ floors: 3, floorStart: 1.5, skipFloors: [] })).toThrow(FlatGenerationError);
    expect(() => physicalFloors({ floors: 2, floorStart: 1, skipFloors: [1, 2] })).toThrow(/skip list/);
  });
  it("labels the ground floor", () => {
    expect(floorLabel(0)).toBe("G");
    expect(floorLabel(0, "GF")).toBe("GF");
    expect(floorLabel(12)).toBe("12");
  });
});

describe("planForFloor", () => {
  it("finds the covering range and reports gaps/overlaps", () => {
    expect(planForFloor(towerC.floorPlans, 5).floorPlanTemplateId).toBe("planA");
    expect(planForFloor(towerC.floorPlans, 6).floorPlanTemplateId).toBe("planB");
    expect(() => planForFloor(towerC.floorPlans, 16)).toThrow(FlatGenerationError);
    try {
      planForFloor([{ fromFloor: 1, toFloor: 3, floorPlanTemplateId: "x" }], 4);
    } catch (error) {
      expect((error as FlatGenerationError).code).toBe("FLOOR_PLAN_GAP");
      expect((error as FlatGenerationError).details).toEqual({ floor: 4 });
    }
    expect(() =>
      planForFloor(
        [
          { fromFloor: 1, toFloor: 5, floorPlanTemplateId: "x" },
          { fromFloor: 5, toFloor: 9, floorPlanTemplateId: "y" },
        ],
        5,
      ),
    ).toThrow(/overlap|covered by 2/i);
    expect(
      validateFloorPlanRanges({ ...towerC, floorPlans: [{ fromFloor: 1, toFloor: 10, floorPlanTemplateId: "planA" }] }),
    ).toEqual({
      gaps: [11, 12, 14, 15],
      overlaps: [],
    });
    expect(validateFloorPlanRanges(towerC)).toEqual({ gaps: [], overlaps: [] });
  });
});

describe("flatNumber", () => {
  it("supports the documented patterns and generic tokens", () => {
    const ctx = { blockCode: "A", floorLabel: "1", position: 1, seq: 1 };
    expect(flatNumber("{block}-{floor}{pos2}", ctx)).toBe("A-101");
    expect(flatNumber("{floor}{pos2}", ctx)).toBe("101");
    expect(flatNumber("{block}{seq}", ctx)).toBe("A1");
    expect(flatNumber("{block}-{floor}{pos2}", { ...ctx, floorLabel: "12", position: 4 })).toBe("A-1204");
    expect(flatNumber("{block}/{floor:2}/{pos:3}", ctx)).toBe("A/01/001");
    expect(flatNumber("{block}-{floor}{pos2}", { ...ctx, floorLabel: "G" })).toBe("A-G01");
    expect(flatNumber("V-{seq3}", { ...ctx, seq: 12 })).toBe("V-012");
    expect(() => flatNumber("{block}", ctx)).toThrow(FlatGenerationError);
  });
});

describe("validateFlatType", () => {
  it("enforces rooms, areas and area order", () => {
    expect(validateFlatType(flatTypes[0] as FlatTypeDefinition)).toEqual([]);
    const errors = validateFlatType({
      rooms: [],
      areas: [],
      carpetSqft: 1000,
      builtupSqft: 900,
      superBuiltupSqft: 1200,
    });
    expect(errors.map((e) => e.code)).toEqual(["NO_ROOMS", "NO_AREAS", "AREA_ORDER"]);
    expect(
      validateFlatType({ ...(flatTypes[0] as FlatTypeDefinition), superBuiltupSqft: 1000 }).map((e) => e.code),
    ).toEqual(["AREA_ORDER"]);
    expect(validateFlatType({ ...(flatTypes[0] as FlatTypeDefinition), carpetSqft: -1 }).map((e) => e.code)).toContain(
      "NEGATIVE_AREA",
    );
  });
});

describe("generateFlats", () => {
  it("creates the right count, numbering, snapshots and prices for Tower C", () => {
    const flats = generateFlats(towerC, templates, flatTypes, pricing);
    // floors 1-5 → 4 flats each (20); floors 6,8..12,14,15 → 8 floors × 2 = 16
    expect(flats).toHaveLength(36);
    expect(flats[0]?.flatNumber).toBe("C-101");
    expect(flats[3]?.flatNumber).toBe("C-104");
    expect(flats.map((f) => f.flatNumber)).not.toContain("C-1301");
    expect(flats.map((f) => f.flatNumber)).not.toContain("C-701");
    expect(flats.at(-1)?.flatNumber).toBe("C-1502");
    expect(flats.map((f) => f.flatNumber)).not.toContain("C-1601");
    expect(flats.map((f) => f.seq)).toEqual(flats.map((_, i) => i + 1));
    const first = flats[0];
    expect(first?.facing).toBe("NORTH");
    expect(first?.isCorner).toBe(true);
    expect(first?.roomsSnapshot).toEqual(flatTypes[0]?.rooms);
    expect(first?.roomsSnapshot).not.toBe(flatTypes[0]?.rooms);
    expect(first?.areasSnapshot).toHaveLength(2);
    expect(first?.carpetSqft).toBe(1000);
    expect(first?.builtupSqft).toBe(1100);
    expect(first?.superBuiltupSqft).toBe(1250);
    expect(first?.pricePaise).toBe(125_001);
    expect(first?.priceBreakup).toEqual([{ label: "Base", amountPaise: 125_001 }]);
    expect(first?.ratePerSqftPaise).toBe(100);
    const second = flats[1];
    expect(second?.facing).toBe(null);
    expect(second?.isCorner).toBe(false);
    expect(second?.flatTypeCode).toBe("2BHK");
    const fourth = flats[3];
    expect(fourth?.facing).toBe("EAST");
    const floor6 = flats.filter((f) => f.floor === 6);
    expect(floor6.map((f) => f.flatNumber)).toEqual(["C-601", "C-602"]);
    expect(floor6[1]?.facing).toBe("WEST");
  });
  it("villa numbering with seq", () => {
    const villas: BlockDefinition = {
      code: "V",
      floors: 0,
      floorStart: 0,
      skipFloors: [],
      refugeFloors: [],
      podiumFloors: [],
      floorPlans: [{ fromFloor: 0, toFloor: 0, floorPlanTemplateId: "planA" }],
      numberingPattern: "{block}{seq}",
    };
    expect(generateFlats(villas, templates, flatTypes, pricing).map((f) => f.flatNumber)).toEqual([
      "V1",
      "V2",
      "V3",
      "V4",
    ]);
  });
  it("fails atomically on gaps, missing templates, missing flat types and duplicate numbers", () => {
    expect(() =>
      generateFlats({ ...towerC, floorPlans: towerC.floorPlans.slice(0, 1) }, templates, flatTypes, pricing),
    ).toThrow(/floor 6/);
    expect(() => generateFlats(towerC, templates.slice(0, 1), flatTypes, pricing)).toThrow(FlatGenerationError);
    expect(() => generateFlats(towerC, templates, flatTypes.slice(0, 1), pricing)).toThrow(/Flat type ft2/);
    expect(() =>
      generateFlats({ ...towerC, numberingPattern: "{block}-{floor}" }, templates, flatTypes, pricing),
    ).toThrow(/duplicate/i);
    const badTypes = flatTypes.map((f) => (f.id === "ft2" ? { ...f, rooms: [] } : f));
    expect(() => generateFlats(towerC, templates, badTypes, pricing)).toThrow(/invalid/);
  });
});
