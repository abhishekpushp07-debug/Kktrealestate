import type { MoneyBreakupLine, PlcAppliesTo, PlcCalcMode } from "@kkt/contracts";

/* ------------------------------------------------------------------ */
/* Floors                                                               */
/* ------------------------------------------------------------------ */

export type WizardFloorKind = "UNITS" | "SKIP" | "REFUGE" | "PODIUM";

export interface FloorSpec {
  floor_start: number;
  floors: number;
  skip_floors: readonly number[];
  refuge_floors: readonly number[];
  podium_floors: readonly number[];
}

export interface FloorEntry {
  floor: number;
  kind: WizardFloorKind;
}

/** Physical floors floor_start..floors (ascending) with their kind. Skip floors are listed so the strip can show them. */
export function listFloors(spec: FloorSpec): FloorEntry[] {
  const start = Math.min(spec.floor_start, spec.floors);
  const end = Math.max(spec.floor_start, spec.floors);
  const skip = new Set(spec.skip_floors);
  const refuge = new Set(spec.refuge_floors);
  const podium = new Set(spec.podium_floors);
  const result: FloorEntry[] = [];
  for (let floor = start; floor <= end; floor += 1) {
    let kind: WizardFloorKind = "UNITS";
    if (skip.has(floor)) kind = "SKIP";
    else if (refuge.has(floor)) kind = "REFUGE";
    else if (podium.has(floor)) kind = "PODIUM";
    result.push({ floor, kind });
  }
  return result;
}

/** Floors that carry units (not skipped, refuge or podium). */
export function unitFloors(spec: FloorSpec): number[] {
  return listFloors(spec)
    .filter((entry) => entry.kind === "UNITS")
    .map((entry) => entry.floor);
}

/** "G" for floor 0, "B1" for −1, otherwise the number. */
export function floorLabel(floor: number, groundLabel = "G"): string {
  if (floor === 0) return groundLabel || "G";
  if (floor < 0) return `B${Math.abs(floor)}`;
  return String(floor);
}

/* ------------------------------------------------------------------ */
/* Floor-plan ranges                                                    */
/* ------------------------------------------------------------------ */

export interface RangeInput {
  from_floor: number | null;
  to_floor: number | null;
  floor_plan_template_id: string | null;
}

export interface RangeValidation {
  /** Indexes of ranges whose from > to or missing a bound. */
  invalid: number[];
  /** Indexes of ranges without a template. */
  missingTemplate: number[];
  /** Indexes of ranges that reach outside floor_start..floors. */
  outside: number[];
  /** Pairs of range indexes that overlap. */
  overlaps: Array<[number, number]>;
  /** Unit floors not covered by any range. */
  uncovered: number[];
  ok: boolean;
}

function isComplete(
  range: RangeInput,
): range is { from_floor: number; to_floor: number; floor_plan_template_id: string | null } {
  return (
    range.from_floor !== null &&
    range.to_floor !== null &&
    Number.isInteger(range.from_floor) &&
    Number.isInteger(range.to_floor)
  );
}

/** Coverage / overlap / bounds validation of floor-plan ranges against a floor spec. */
export function validateFloorRanges(ranges: readonly RangeInput[], spec: FloorSpec): RangeValidation {
  const invalid: number[] = [];
  const missingTemplate: number[] = [];
  const outside: number[] = [];
  const overlaps: Array<[number, number]> = [];
  const low = Math.min(spec.floor_start, spec.floors);
  const high = Math.max(spec.floor_start, spec.floors);

  ranges.forEach((range, index) => {
    if (!range.floor_plan_template_id) missingTemplate.push(index);
    if (!isComplete(range) || range.from_floor > range.to_floor) {
      invalid.push(index);
      return;
    }
    if (range.from_floor < low || range.to_floor > high) outside.push(index);
  });

  const complete = ranges
    .map((range, index) => ({ range, index }))
    .filter(({ range, index }) => isComplete(range) && !invalid.includes(index));
  for (let i = 0; i < complete.length; i += 1) {
    for (let j = i + 1; j < complete.length; j += 1) {
      const a = complete[i];
      const b = complete[j];
      if (!a || !b || !isComplete(a.range) || !isComplete(b.range)) continue;
      if (a.range.from_floor <= b.range.to_floor && b.range.from_floor <= a.range.to_floor)
        overlaps.push([a.index, b.index]);
    }
  }

  const uncovered = unitFloors(spec).filter((floor) => rangeCovering(ranges, floor) === null);
  const ok =
    invalid.length === 0 &&
    missingTemplate.length === 0 &&
    outside.length === 0 &&
    overlaps.length === 0 &&
    uncovered.length === 0;
  return { invalid, missingTemplate, outside, overlaps, uncovered, ok };
}

/** The first complete range whose bounds include `floor` (its template may still be unset). */
export function rangeCovering(ranges: readonly RangeInput[], floor: number): RangeInput | null {
  for (const range of ranges) {
    if (!isComplete(range)) continue;
    if (floor >= range.from_floor && floor <= range.to_floor) return range;
  }
  return null;
}

/** Template id covering `floor`, or null when no range covers it or the covering range has no template yet. */
export function templateForFloor(ranges: readonly RangeInput[], floor: number): string | null {
  return rangeCovering(ranges, floor)?.floor_plan_template_id ?? null;
}

export interface ExpectedFlats {
  total: number;
  /** Unit floors with the number of flats each will receive (0 when its template is unknown). */
  perFloor: Array<{ floor: number; template_id: string | null; count: number }>;
  /** Flats per template id. */
  byTemplate: Record<string, number>;
}

/** Expected flat count = Σ over unit floors of flats-per-floor of the covering template (refuge/podium/skip excluded). */
export function expectedFlatCount(
  ranges: readonly RangeInput[],
  spec: FloorSpec,
  flatsPerTemplate: Readonly<Record<string, number>>,
): ExpectedFlats {
  const perFloor: ExpectedFlats["perFloor"] = [];
  const byTemplate: Record<string, number> = {};
  let total = 0;
  for (const floor of unitFloors(spec)) {
    const templateId = templateForFloor(ranges, floor);
    const count = templateId ? (flatsPerTemplate[templateId] ?? 0) : 0;
    perFloor.push({ floor, template_id: templateId, count });
    if (templateId) byTemplate[templateId] = (byTemplate[templateId] ?? 0) + count;
    total += count;
  }
  return { total, perFloor, byTemplate };
}

/* ------------------------------------------------------------------ */
/* Pricing engine (SPEC §5) — client-side preview                       */
/* ------------------------------------------------------------------ */

export interface PricingFlat {
  super_builtup_sqft: number;
  floor: number;
  facing: string | null;
  is_corner: boolean;
}

export interface PricingRate {
  rate_per_sqft_paise: number | null;
  lump_sum_paise: number | null;
}

export interface PricingRule {
  label: string;
  calc_mode: PlcCalcMode;
  value: number;
  applies_to: PlcAppliesTo;
  floors_gte: number | null | undefined;
  facings: readonly string[] | null | undefined;
}

export interface PricePreview {
  base_paise: number;
  breakup: MoneyBreakupLine[];
  total_paise: number;
}

export function ruleApplies(rule: PricingRule, flat: PricingFlat): boolean {
  switch (rule.applies_to) {
    case "ALL":
      return true;
    case "FLOORS_GTE":
      return rule.floors_gte !== null && rule.floors_gte !== undefined && flat.floor >= rule.floors_gte;
    case "CORNER":
      return flat.is_corner;
    case "FACING_IN":
      return (
        Boolean(flat.facing) &&
        (rule.facings ?? []).some((facing) => facing.toUpperCase() === (flat.facing ?? "").toUpperCase())
      );
  }
}

/** base = lump sum, else rate × super built-up; PLC lines per matching rule; floor rise = value × (floor − 1) × sq ft. */
export function computeFlatPrice(
  flat: PricingFlat,
  rate: PricingRate | null,
  rules: readonly PricingRule[],
  fallback: PricingRate | null = null,
): PricePreview {
  const effective = rate ?? fallback;
  let base = 0;
  let baseLabel = "Base price";
  if (effective?.lump_sum_paise !== null && effective?.lump_sum_paise !== undefined) {
    base = Math.round(effective.lump_sum_paise);
    baseLabel = "Base price (lump sum)";
  } else if (effective?.rate_per_sqft_paise !== null && effective?.rate_per_sqft_paise !== undefined) {
    base = Math.round(effective.rate_per_sqft_paise * flat.super_builtup_sqft);
    baseLabel = `Base (${flat.super_builtup_sqft} sq ft × rate)`;
  }
  const breakup: MoneyBreakupLine[] = [{ label: baseLabel, amount_paise: base }];
  for (const rule of rules) {
    if (!ruleApplies(rule, flat)) continue;
    let amount = 0;
    switch (rule.calc_mode) {
      case "PER_SQFT":
        amount = rule.value * flat.super_builtup_sqft;
        break;
      case "FIXED":
        amount = rule.value;
        break;
      case "PERCENT":
        amount = (base * rule.value) / 100;
        break;
      case "FLOOR_RISE":
        amount = rule.value * Math.max(0, flat.floor - 1) * flat.super_builtup_sqft;
        break;
    }
    breakup.push({ label: rule.label, amount_paise: Math.round(amount) });
  }
  const total = breakup.reduce((sum, line) => sum + line.amount_paise, 0);
  return { base_paise: base, breakup, total_paise: total };
}

/* ------------------------------------------------------------------ */
/* Misc                                                                 */
/* ------------------------------------------------------------------ */

/** Hours from now → RFC 3339 instant (used for Hold expiry). */
export function hoursFromNow(hours: number, now: Date = new Date()): string {
  return new Date(now.getTime() + Math.max(0, hours) * 3_600_000).toISOString();
}

/** Toggle an item in an array of ids (immutable). */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/** Parse a comma / space separated list of integers ("3, 13 17") into unique sorted numbers. */
export function parseFloorList(text: string): number[] {
  const values = text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isInteger(value));
  return [...new Set(values)].sort((a, b) => a - b);
}
