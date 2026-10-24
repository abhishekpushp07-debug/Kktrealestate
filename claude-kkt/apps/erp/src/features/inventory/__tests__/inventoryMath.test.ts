import { describe, expect, it } from "vitest";
import { computeFlatPrice, expectedFlatCount, floorLabel, listFloors, parseFloorList, unitFloors, validateFloorRanges } from "../inventoryMath";

const spec = { floor_start: 1, floors: 15, skip_floors: [13], refuge_floors: [7], podium_floors: [] };

describe("floors", () => {
  it("lists physical floors with their kind", () => {
    const floors = listFloors(spec);
    expect(floors).toHaveLength(15);
    expect(floors.find((entry) => entry.floor === 13)?.kind).toBe("SKIP");
    expect(floors.find((entry) => entry.floor === 7)?.kind).toBe("REFUGE");
    expect(unitFloors(spec)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15]);
  });

  it("labels ground and basements", () => {
    expect(floorLabel(0)).toBe("G");
    expect(floorLabel(0, "GF")).toBe("GF");
    expect(floorLabel(-1)).toBe("B1");
    expect(floorLabel(12)).toBe("12");
  });

  it("parses loose floor lists", () => {
    expect(parseFloorList("3, 13 17,3")).toEqual([3, 13, 17]);
    expect(parseFloorList("")).toEqual([]);
  });
});

describe("validateFloorRanges", () => {
  it("accepts full disjoint coverage of unit floors", () => {
    const result = validateFloorRanges(
      [
        { from_floor: 1, to_floor: 7, floor_plan_template_id: "a" },
        { from_floor: 8, to_floor: 15, floor_plan_template_id: "b" },
      ],
      spec,
    );
    expect(result.ok).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(result.overlaps).toEqual([]);
  });

  it("reports uncovered unit floors, overlaps, bounds and missing templates", () => {
    const result = validateFloorRanges(
      [
        { from_floor: 1, to_floor: 6, floor_plan_template_id: "a" },
        { from_floor: 5, to_floor: 10, floor_plan_template_id: null },
        { from_floor: 14, to_floor: 20, floor_plan_template_id: "c" },
        { from_floor: 9, to_floor: 8, floor_plan_template_id: "d" },
      ],
      spec,
    );
    expect(result.ok).toBe(false);
    expect(result.uncovered).toEqual([11, 12]);
    expect(result.overlaps).toEqual([[0, 1]]);
    expect(result.outside).toEqual([2]);
    expect(result.missingTemplate).toEqual([1]);
    expect(result.invalid).toEqual([3]);
  });

  it("does not count refuge, podium or skipped floors as uncovered", () => {
    const result = validateFloorRanges([{ from_floor: 1, to_floor: 6, floor_plan_template_id: "a" }, { from_floor: 8, to_floor: 15, floor_plan_template_id: "a" }], spec);
    expect(result.uncovered).toEqual([]);
  });
});

describe("expectedFlatCount", () => {
  it("sums flats per floor from the covering template and skips no-unit floors", () => {
    const result = expectedFlatCount(
      [
        { from_floor: 1, to_floor: 7, floor_plan_template_id: "a" },
        { from_floor: 8, to_floor: 15, floor_plan_template_id: "b" },
      ],
      spec,
      { a: 4, b: 2 },
    );
    // floors 1-6 → 4 each (7 is refuge) = 24; floors 8-12,14,15 → 2 each = 14
    expect(result.total).toBe(38);
    expect(result.byTemplate).toEqual({ a: 24, b: 14 });
    expect(result.perFloor.find((entry) => entry.floor === 13)).toBeUndefined();
  });

  it("counts zero for floors without a template", () => {
    const result = expectedFlatCount([{ from_floor: 1, to_floor: 3, floor_plan_template_id: "a" }], { ...spec, floors: 5 }, { a: 3 });
    expect(result.total).toBe(9);
    expect(result.perFloor.filter((entry) => entry.count === 0).map((entry) => entry.floor)).toEqual([4, 5]);
  });
});

describe("computeFlatPrice", () => {
  const flat = { super_builtup_sqft: 1000, floor: 5, facing: "EAST", is_corner: true };
  it("uses rate × sqft as base and applies matching PLC rules", () => {
    const result = computeFlatPrice(
      flat,
      { rate_per_sqft_paise: 5_000_00, lump_sum_paise: null },
      [
        { label: "Corner", calc_mode: "FIXED", value: 1_00_000_00, applies_to: "CORNER", floors_gte: null, facings: null },
        { label: "Floor rise", calc_mode: "FLOOR_RISE", value: 10_00, applies_to: "ALL", floors_gte: null, facings: null },
        { label: "High floor", calc_mode: "PERCENT", value: 2, applies_to: "FLOORS_GTE", floors_gte: 10, facings: null },
        { label: "East", calc_mode: "PER_SQFT", value: 50_00, applies_to: "FACING_IN", floors_gte: null, facings: ["east"] },
      ],
    );
    expect(result.base_paise).toBe(5_000_00 * 1000);
    expect(result.breakup.map((line) => line.label)).toEqual(["Base (1000 sq ft × rate)", "Corner", "Floor rise", "East"]);
    // floor rise = 1000 paise × (5-1) × 1000 sqft = 40,00,000 paise
    expect(result.breakup[2]?.amount_paise).toBe(40_00_000);
    expect(result.total_paise).toBe(result.breakup.reduce((sum, line) => sum + line.amount_paise, 0));
  });

  it("prefers the lump sum and falls back to flat-type pricing when no rate", () => {
    expect(computeFlatPrice(flat, { rate_per_sqft_paise: null, lump_sum_paise: 75_00_000_00 }, []).total_paise).toBe(75_00_000_00);
    expect(computeFlatPrice(flat, null, [], { rate_per_sqft_paise: 4_000_00, lump_sum_paise: null }).total_paise).toBe(4_000_00 * 1000);
    expect(computeFlatPrice(flat, null, []).total_paise).toBe(0);
  });
});
