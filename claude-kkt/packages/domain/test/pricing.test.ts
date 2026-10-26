import { describe, expect, it } from "vitest";
import {
  PricingError,
  bulkPriceEdit,
  effectiveRatePerSqft,
  plcApplies,
  priceFlat,
  priceFromFlatType,
  resolveFlatPrice,
  type PlcRule,
  type PricingFlat,
  type RateCard,
} from "../src/index.js";

const rules: PlcRule[] = [
  { plcTypeId: "p1", name: "Floor rise", calcMode: "FLOOR_RISE", value: 2500, appliesTo: "ALL" },
  { plcTypeId: "p2", name: "Corner", calcMode: "FIXED", value: 10_000_000, appliesTo: "CORNER" },
  {
    plcTypeId: "p3",
    name: "Park facing",
    calcMode: "PER_SQFT",
    value: 20_000,
    appliesTo: "FACING_IN",
    facings: ["EAST", "NORTH"],
  },
  { plcTypeId: "p4", name: "Top floors", calcMode: "PERCENT", value: 2.5, appliesTo: "FLOORS_GTE", floorsGte: 10 },
];

const rateCard: RateCard = {
  rates: [
    { flatTypeId: "ft3", ratePerSqftPaise: 550_000, lumpSumPaise: null },
    { flatTypeId: "villa", ratePerSqftPaise: null, lumpSumPaise: 9_000_000_00 },
  ],
  plcRules: rules,
};

const flat: PricingFlat = {
  floor: 1,
  floorStart: 1,
  superBuiltupSqft: 1250,
  isCorner: false,
  facing: "SOUTH",
  flatTypeId: "ft3",
};

describe("priceFlat", () => {
  it("base only on the first floor, non-corner, non-matching facing", () => {
    const result = priceFlat({ flat, rateCard });
    expect(result.totalPaise).toBe(687_500_000);
    expect(result.ratePerSqftPaise).toBe(550_000);
    expect(result.breakup).toEqual([{ label: "Base price (1250 sq ft × ₹5,500)", amountPaise: 687_500_000 }]);
  });
  it("applies every matching PLC", () => {
    const result = priceFlat({ flat: { ...flat, floor: 12, isCorner: true, facing: "east" }, rateCard });
    const labels = result.breakup.map((l) => l.label);
    expect(labels).toEqual(["Base price (1250 sq ft × ₹5,500)", "Floor rise", "Corner", "Park facing", "Top floors"]);
    // floor rise: 2500 × 11 floors × 1250 sqft = 34,375,000 paise
    expect(result.breakup[1]?.amountPaise).toBe(34_375_000);
    expect(result.breakup[2]?.amountPaise).toBe(10_000_000);
    expect(result.breakup[3]?.amountPaise).toBe(25_000_000);
    // percent applies to base: 2.5% of 687,500,000 = 17,187,500
    expect(result.breakup[4]?.amountPaise).toBe(17_187_500);
    expect(result.totalPaise).toBe(687_500_000 + 34_375_000 + 10_000_000 + 25_000_000 + 17_187_500);
  });
  it("floor rise is never negative and counts from floorStart", () => {
    const below = priceFlat({
      flat: { ...flat, floor: 0, floorStart: 1 },
      rateCard: { rates: rateCard.rates, plcRules: [rules[0] as PlcRule] },
    });
    expect(below.breakup).toHaveLength(1);
    const ground = priceFlat({
      flat: { ...flat, floor: 3, floorStart: 0 },
      rateCard: { rates: rateCard.rates, plcRules: [rules[0] as PlcRule] },
    });
    expect(ground.breakup[1]?.amountPaise).toBe(2500 * 3 * 1250);
  });
  it("lump sum base with effective rate", () => {
    const villa = priceFlat({ flat: { ...flat, flatTypeId: "villa", superBuiltupSqft: 1800 }, rateCard });
    expect(villa.breakup[0]).toEqual({ label: "Base price (lump sum)", amountPaise: 900_000_000 });
    expect(villa.ratePerSqftPaise).toBe(500_000);
    expect(effectiveRatePerSqft(1000, 0)).toBe(null);
    expect(effectiveRatePerSqft(1001, 3)).toBe(334);
  });
  it("throws when the rate card lacks the flat type or the rate is empty", () => {
    expect(() => priceFlat({ flat: { ...flat, flatTypeId: "nope" }, rateCard })).toThrow(PricingError);
    expect(() =>
      priceFlat({
        flat,
        rateCard: { rates: [{ flatTypeId: "ft3", ratePerSqftPaise: null, lumpSumPaise: null }], plcRules: [] },
      }),
    ).toThrow(/neither/);
  });
  it("plcApplies evaluates each condition", () => {
    expect(plcApplies(rules[1] as PlcRule, { ...flat, isCorner: true })).toBe(true);
    expect(plcApplies(rules[1] as PlcRule, flat)).toBe(false);
    expect(plcApplies(rules[2] as PlcRule, { ...flat, facing: null })).toBe(false);
    expect(plcApplies(rules[3] as PlcRule, { ...flat, floor: 10 })).toBe(true);
    expect(plcApplies(rules[3] as PlcRule, { ...flat, floor: 9 })).toBe(false);
    expect(plcApplies({ ...(rules[3] as PlcRule), floorsGte: null }, { ...flat, floor: 99 })).toBe(false);
  });
});

describe("priceFromFlatType / resolveFlatPrice", () => {
  it("falls back to lump sum or rate × super built-up", () => {
    expect(
      priceFromFlatType({ baseRatePerSqftPaise: 500_000, basePricePaise: null, superBuiltupSqft: 900 }).totalPaise,
    ).toBe(450_000_000);
    expect(
      priceFromFlatType({ baseRatePerSqftPaise: 500_000, basePricePaise: 123, superBuiltupSqft: 900 }).totalPaise,
    ).toBe(123);
    expect(() =>
      priceFromFlatType({ baseRatePerSqftPaise: null, basePricePaise: null, superBuiltupSqft: 900 }),
    ).toThrow(PricingError);
    const flatType = { baseRatePerSqftPaise: 500_000, basePricePaise: null, superBuiltupSqft: 1250 };
    expect(resolveFlatPrice({ flat, flatType, rateCard }).totalPaise).toBe(687_500_000);
    expect(resolveFlatPrice({ flat, flatType, rateCard: null }).totalPaise).toBe(625_000_000);
    expect(resolveFlatPrice({ flat: { ...flat, flatTypeId: "other" }, flatType, rateCard }).totalPaise).toBe(
      625_000_000,
    );
  });
});

describe("bulkPriceEdit", () => {
  const flats = [
    { id: "a", floor: 1, superBuiltupSqft: 1000, pricePaise: 500_000_000 },
    { id: "b", floor: 4, superBuiltupSqft: 1000, pricePaise: 500_000_000 },
  ];
  it("sets rate with floor-rise step", () => {
    const result = bulkPriceEdit({
      flats,
      mode: "SET_RATE_PER_SQFT",
      value: 600_000,
      floorRiseStepPaisePerSqft: 2000,
      floorStart: 1,
    });
    expect(result[0]?.pricePaise).toBe(600_000_000);
    expect(result[0]?.breakup).toHaveLength(1);
    expect(result[1]?.pricePaise).toBe(600_000_000 + 2000 * 3 * 1000);
    expect(result[1]?.breakup[1]).toEqual({ label: "Floor rise", amountPaise: 6_000_000 });
    expect(result[1]?.ratePerSqftPaise).toBe(606_000);
  });
  it("adjusts by percent and amount, never below zero", () => {
    expect(bulkPriceEdit({ flats, mode: "ADJUST_PERCENT", value: 10 })[0]?.pricePaise).toBe(550_000_000);
    expect(bulkPriceEdit({ flats, mode: "ADJUST_PERCENT", value: -10 })[0]?.pricePaise).toBe(450_000_000);
    expect(bulkPriceEdit({ flats, mode: "ADJUST_AMOUNT", value: -600_000_000 })[0]?.pricePaise).toBe(0);
    expect(bulkPriceEdit({ flats, mode: "SET_PRICE", value: 1 })[1]?.pricePaise).toBe(1);
  });
});
