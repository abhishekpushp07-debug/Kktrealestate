/**
 * Pricing engine (SPEC §5): base price from a rate card (rate × super built-up or lump sum) plus PLC rules,
 * with a line-item breakup. Also the flat-type fallback price and the bulk price-edit helper.
 */
import { assertPaise, bpOfPaise, divRoundHalfUp, formatINR, mulPaiseBySqft, toBasisPoints, bigIntToSafeNumber } from "./money.js";

/** Calculation mode of a PLC rule. */
export type PlcCalcMode = "PER_SQFT" | "FIXED" | "PERCENT" | "FLOOR_RISE";
/** Condition that decides whether a PLC rule applies to a flat. */
export type PlcAppliesTo = "ALL" | "FLOORS_GTE" | "CORNER" | "FACING_IN";

/** Error thrown when a flat cannot be priced. */
export class PricingError extends Error {
  readonly code: "NO_RATE_FOR_FLAT_TYPE" | "INVALID_RATE" | "INVALID_RULE";
  constructor(code: PricingError["code"], message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

export interface PricingFlat {
  floor: number;
  /** The block's first floor (0 for ground); floor rise counts floors above it. */
  floorStart: number;
  superBuiltupSqft: number;
  isCorner: boolean;
  facing: string | null;
  flatTypeId: string;
}

export interface RateCardRate {
  flatTypeId: string;
  ratePerSqftPaise: number | null;
  lumpSumPaise: number | null;
}

export interface PlcRule {
  plcTypeId: string;
  name: string;
  calcMode: PlcCalcMode;
  /** Paise for PER_SQFT / FIXED / FLOOR_RISE; percent (≤ 2 decimals) for PERCENT. */
  value: number;
  appliesTo: PlcAppliesTo;
  floorsGte?: number | null;
  facings?: readonly string[] | null;
}

export interface RateCard {
  rates: readonly RateCardRate[];
  plcRules: readonly PlcRule[];
}

export interface PriceLine {
  label: string;
  amountPaise: number;
}

export interface PriceResult {
  breakup: PriceLine[];
  totalPaise: number;
  /** Effective base rate per sq ft (lump sums are divided by area); null when the area is zero. */
  ratePerSqftPaise: number | null;
}

/** Formats an area for labels, trimming trailing zeros ("1250", "1250.5"). */
function sqftLabel(sqft: number): string {
  return `${Number(sqft.toFixed(2))} sq ft`;
}

/** Returns whether a PLC rule's condition is satisfied by the flat. */
export function plcApplies(rule: PlcRule, flat: PricingFlat): boolean {
  switch (rule.appliesTo) {
    case "ALL":
      return true;
    case "FLOORS_GTE":
      return typeof rule.floorsGte === "number" && flat.floor >= rule.floorsGte;
    case "CORNER":
      return flat.isCorner;
    case "FACING_IN":
      return flat.facing !== null && (rule.facings ?? []).map((f) => f.toUpperCase()).includes(flat.facing.toUpperCase());
    default: {
      const never: never = rule.appliesTo;
      throw new PricingError("INVALID_RULE", `Unknown appliesTo ${String(never)}`);
    }
  }
}

/** Amount of a PLC rule for a flat given its base price; FLOOR_RISE is never negative. */
export function plcAmount(rule: PlcRule, flat: PricingFlat, basePaise: number): number {
  switch (rule.calcMode) {
    case "PER_SQFT":
      return mulPaiseBySqft(assertPaise(rule.value, `PLC ${rule.name} value`), flat.superBuiltupSqft);
    case "FIXED":
      return assertPaise(rule.value, `PLC ${rule.name} value`);
    case "PERCENT":
      return bpOfPaise(basePaise, toBasisPoints(rule.value));
    case "FLOOR_RISE": {
      const floorsAbove = Math.max(0, flat.floor - flat.floorStart);
      const perSqft = assertPaise(rule.value, `PLC ${rule.name} value`) * floorsAbove;
      return Math.max(0, mulPaiseBySqft(perSqft, flat.superBuiltupSqft));
    }
    default: {
      const never: never = rule.calcMode;
      throw new PricingError("INVALID_RULE", `Unknown calcMode ${String(never)}`);
    }
  }
}

/** Effective rate per sq ft for a total and an area, half-up; null when the area is zero. */
export function effectiveRatePerSqft(totalPaise: number, sqft: number): number | null {
  if (sqft <= 0) {
    return null;
  }
  const hundredths = BigInt(Math.round(sqft * 100));
  return bigIntToSafeNumber(divRoundHalfUp(BigInt(totalPaise) * 100n, hundredths));
}

/** Base price line from a rate or lump sum. */
function baseLine(rate: { ratePerSqftPaise: number | null; lumpSumPaise: number | null }, sqft: number, what: string): { line: PriceLine; rate: number | null } {
  if (rate.lumpSumPaise !== null && rate.lumpSumPaise !== undefined) {
    const amount = assertPaise(rate.lumpSumPaise, `${what} lump sum`);
    return { line: { label: "Base price (lump sum)", amountPaise: amount }, rate: effectiveRatePerSqft(amount, sqft) };
  }
  if (rate.ratePerSqftPaise !== null && rate.ratePerSqftPaise !== undefined) {
    const perSqft = assertPaise(rate.ratePerSqftPaise, `${what} rate`);
    return {
      line: { label: `Base price (${sqftLabel(sqft)} × ${formatINR(perSqft)})`, amountPaise: mulPaiseBySqft(perSqft, sqft) },
      rate: perSqft,
    };
  }
  throw new PricingError("INVALID_RATE", `${what} has neither a rate per sq ft nor a lump sum`);
}

/** Prices a flat from a rate card: base + every applicable PLC rule, with a breakup and total. */
export function priceFlat(input: { flat: PricingFlat; rateCard: RateCard }): PriceResult {
  const { flat, rateCard } = input;
  const rate = rateCard.rates.find((r) => r.flatTypeId === flat.flatTypeId);
  if (!rate) {
    throw new PricingError("NO_RATE_FOR_FLAT_TYPE", `Rate card has no rate for flat type ${flat.flatTypeId}`);
  }
  const base = baseLine(rate, flat.superBuiltupSqft, "Rate card rate");
  const breakup: PriceLine[] = [base.line];
  for (const rule of rateCard.plcRules) {
    if (!plcApplies(rule, flat)) {
      continue;
    }
    const amount = plcAmount(rule, flat, base.line.amountPaise);
    if (amount !== 0) {
      breakup.push({ label: rule.name, amountPaise: amount });
    }
  }
  const totalPaise = breakup.reduce((sum, line) => sum + line.amountPaise, 0);
  return { breakup, totalPaise, ratePerSqftPaise: base.rate };
}

export interface FlatTypePricing {
  baseRatePerSqftPaise: number | null;
  basePricePaise: number | null;
  superBuiltupSqft: number;
}

/** Fallback price when no rate card is active: the flat type's lump sum, or its base rate × super built-up. */
export function priceFromFlatType(flatType: FlatTypePricing): PriceResult {
  const base = baseLine(
    { lumpSumPaise: flatType.basePricePaise, ratePerSqftPaise: flatType.baseRatePerSqftPaise },
    flatType.superBuiltupSqft,
    "Flat type",
  );
  return { breakup: [base.line], totalPaise: base.line.amountPaise, ratePerSqftPaise: base.rate };
}

/** Prices with the active rate card when one is given and it covers the flat type, else from the flat type. */
export function resolveFlatPrice(input: { flat: PricingFlat; flatType: FlatTypePricing; rateCard: RateCard | null }): PriceResult {
  if (input.rateCard && input.rateCard.rates.some((r) => r.flatTypeId === input.flat.flatTypeId)) {
    return priceFlat({ flat: input.flat, rateCard: input.rateCard });
  }
  return priceFromFlatType(input.flatType);
}

/** How a bulk price edit changes each flat. */
export type BulkPriceMode = "SET_RATE_PER_SQFT" | "SET_PRICE" | "ADJUST_PERCENT" | "ADJUST_AMOUNT";

export interface BulkPriceFlat {
  id: string;
  floor: number;
  superBuiltupSqft: number;
  pricePaise: number;
}

export interface BulkPriceEditInput {
  flats: readonly BulkPriceFlat[];
  mode: BulkPriceMode;
  /** Paise for SET_RATE_PER_SQFT / SET_PRICE / ADJUST_AMOUNT; percent (≤ 2 decimals, may be negative) for ADJUST_PERCENT. */
  value: number;
  /** Optional floor-rise step in paise per sq ft per floor above floorStart, added on top. */
  floorRiseStepPaisePerSqft?: number | null;
  floorStart?: number;
}

export interface BulkPriceEditResult {
  id: string;
  pricePaise: number;
  ratePerSqftPaise: number | null;
  breakup: PriceLine[];
}

/** Applies a bulk price edit to a set of flats with an optional floor-rise step; never produces negative prices. */
export function bulkPriceEdit(input: BulkPriceEditInput): BulkPriceEditResult[] {
  const floorStart = input.floorStart ?? 1;
  const step = input.floorRiseStepPaisePerSqft ?? 0;
  return input.flats.map((flat) => {
    let base: PriceLine;
    switch (input.mode) {
      case "SET_RATE_PER_SQFT":
        base = {
          label: `Base price (${sqftLabel(flat.superBuiltupSqft)} × ${formatINR(assertPaise(input.value))})`,
          amountPaise: mulPaiseBySqft(input.value, flat.superBuiltupSqft),
        };
        break;
      case "SET_PRICE":
        base = { label: "Base price", amountPaise: assertPaise(input.value) };
        break;
      case "ADJUST_PERCENT":
        base = { label: "Base price", amountPaise: flat.pricePaise + bpOfPaise(flat.pricePaise, toBasisPoints(input.value)) };
        break;
      case "ADJUST_AMOUNT":
        base = { label: "Base price", amountPaise: flat.pricePaise + assertPaise(input.value) };
        break;
      default: {
        const never: never = input.mode;
        throw new PricingError("INVALID_RULE", `Unknown bulk mode ${String(never)}`);
      }
    }
    base.amountPaise = Math.max(0, base.amountPaise);
    const breakup: PriceLine[] = [base];
    if (step !== 0) {
      const floorsAbove = Math.max(0, flat.floor - floorStart);
      const rise = Math.max(0, mulPaiseBySqft(assertPaise(step, "Floor rise step") * floorsAbove, flat.superBuiltupSqft));
      if (rise > 0) {
        breakup.push({ label: "Floor rise", amountPaise: rise });
      }
    }
    const pricePaise = breakup.reduce((sum, line) => sum + line.amountPaise, 0);
    return { id: flat.id, pricePaise, ratePerSqftPaise: effectiveRatePerSqft(pricePaise, flat.superBuiltupSqft), breakup };
  });
}
