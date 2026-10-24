/**
 * Flat generation (SPEC §4): physical floors, floor-plan ranges, numbering patterns and the full flat draft list
 * with rooms/areas snapshots and prices.
 */
import type { PriceResult } from "./pricing.js";

/** Error thrown when a block definition cannot produce flats. */
export class FlatGenerationError extends Error {
  readonly code:
    | "INVALID_FLOORS"
    | "FLOOR_PLAN_GAP"
    | "FLOOR_PLAN_OVERLAP"
    | "TEMPLATE_NOT_FOUND"
    | "FLAT_TYPE_NOT_FOUND"
    | "DUPLICATE_FLAT_NUMBER"
    | "INVALID_FLAT_TYPE"
    | "INVALID_PATTERN";
  readonly details: Record<string, unknown>;
  constructor(code: FlatGenerationError["code"], message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FlatGenerationError";
    this.code = code;
    this.details = details;
  }
}

export interface FloorPlanRange {
  fromFloor: number;
  toFloor: number;
  floorPlanTemplateId: string;
}

export interface BlockDefinition {
  code: string;
  /** Number of physical floors to produce. */
  floors: number;
  /** First floor number (0 for ground). */
  floorStart: number;
  groundFloorLabel?: string | null;
  skipFloors: readonly number[];
  refugeFloors: readonly number[];
  podiumFloors: readonly number[];
  floorPlans: readonly FloorPlanRange[];
  /** e.g. "{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}". */
  numberingPattern: string;
}

export interface TemplatePosition {
  position: number;
  flatTypeId: string;
  facing?: string | null;
  isCorner?: boolean;
}

export interface FloorPlanTemplate {
  id: string;
  flatsPerFloor: number;
  positions: readonly TemplatePosition[];
}

export interface RoomSnapshot {
  roomTypeId: string;
  roomTypeName: string;
  label: string;
  lengthFt: number;
  widthFt: number;
  sqft: number;
}

export interface AreaSnapshot {
  areaTypeId: string;
  areaTypeCode: string;
  areaTypeName: string;
  sqft: number;
}

export interface FlatTypeDefinition {
  id: string;
  code: string;
  name: string;
  facing?: string | null;
  rooms: readonly RoomSnapshot[];
  areas: readonly AreaSnapshot[];
  carpetSqft: number;
  builtupSqft: number;
  superBuiltupSqft: number;
  baseRatePerSqftPaise: number | null;
  basePricePaise: number | null;
}

export interface FlatDraft {
  flatNumber: string;
  floor: number;
  floorLabel: string;
  position: number;
  seq: number;
  flatTypeId: string;
  flatTypeCode: string;
  facing: string | null;
  isCorner: boolean;
  roomsSnapshot: RoomSnapshot[];
  areasSnapshot: AreaSnapshot[];
  carpetSqft: number;
  builtupSqft: number;
  superBuiltupSqft: number;
  ratePerSqftPaise: number | null;
  pricePaise: number;
  priceBreakup: PriceResult["breakup"];
}

export interface PricingContext {
  flatType: FlatTypeDefinition;
  floor: number;
  floorStart: number;
  position: number;
  isCorner: boolean;
  facing: string | null;
}

/** Function that prices a flat being generated (usually wraps resolveFlatPrice with the active rate card). */
export type PricingFn = (ctx: PricingContext) => PriceResult;

/**
 * Physical floors of a block (SPEC §4 step 1): every floor number from floorStart to `floors` inclusive,
 * excluding the skip list. `floors` is the top floor number (a 15-floor tower skipping 13 has 14 physical floors).
 */
export function physicalFloors(block: Pick<BlockDefinition, "floors" | "floorStart" | "skipFloors">): number[] {
  if (!Number.isInteger(block.floors)) {
    throw new FlatGenerationError("INVALID_FLOORS", `floors must be an integer, got ${String(block.floors)}`);
  }
  if (!Number.isInteger(block.floorStart)) {
    throw new FlatGenerationError("INVALID_FLOORS", `floorStart must be an integer, got ${String(block.floorStart)}`);
  }
  if (block.floorStart > block.floors) {
    throw new FlatGenerationError("INVALID_FLOORS", `floorStart ${block.floorStart} must be ≤ floors ${block.floors}`, {
      floors: block.floors,
      floorStart: block.floorStart,
    });
  }
  const skip = new Set(block.skipFloors);
  const out: number[] = [];
  for (let floor = block.floorStart; floor <= block.floors; floor += 1) {
    if (!skip.has(floor)) {
      out.push(floor);
    }
  }
  if (out.length === 0) {
    throw new FlatGenerationError("INVALID_FLOORS", "Every floor is in the skip list", { floors: block.floors, floorStart: block.floorStart });
  }
  return out;
}

/** Floors that carry units: physical floors minus refuge and podium floors. */
export function unitFloors(block: Pick<BlockDefinition, "floors" | "floorStart" | "skipFloors" | "refugeFloors" | "podiumFloors">): number[] {
  const noUnits = new Set([...block.refugeFloors, ...block.podiumFloors]);
  return physicalFloors(block).filter((floor) => !noUnits.has(floor));
}

/** Human label of a floor: the ground-floor label (default "G") for floor 0, otherwise the number. */
export function floorLabel(floor: number, groundFloorLabel?: string | null): string {
  if (floor === 0) {
    return groundFloorLabel && groundFloorLabel.trim() !== "" ? groundFloorLabel.trim() : "G";
  }
  return String(floor);
}

/** Finds the floor-plan range covering a floor; throws FLOOR_PLAN_GAP when none does. */
export function planForFloor(ranges: readonly FloorPlanRange[], floor: number): FloorPlanRange {
  const matches = ranges.filter((range) => range.fromFloor <= floor && floor <= range.toFloor);
  const first = matches[0];
  if (!first) {
    throw new FlatGenerationError("FLOOR_PLAN_GAP", `No floor-plan range covers floor ${floor}`, { floor });
  }
  if (matches.length > 1) {
    throw new FlatGenerationError("FLOOR_PLAN_OVERLAP", `Floor ${floor} is covered by ${matches.length} floor-plan ranges`, {
      floor,
      templateIds: matches.map((m) => m.floorPlanTemplateId),
    });
  }
  return first;
}

/** Validates that every unit floor is covered by exactly one floor-plan range; returns the problems found. */
export function validateFloorPlanRanges(block: BlockDefinition): { gaps: number[]; overlaps: number[] } {
  const gaps: number[] = [];
  const overlaps: number[] = [];
  for (const floor of unitFloors(block)) {
    const matches = block.floorPlans.filter((range) => range.fromFloor <= floor && floor <= range.toFloor);
    if (matches.length === 0) {
      gaps.push(floor);
    } else if (matches.length > 1) {
      overlaps.push(floor);
    }
  }
  return { gaps, overlaps };
}

export interface FlatNumberContext {
  blockCode: string;
  floorLabel: string;
  position: number;
  seq: number;
}

const NUMBER_TOKEN = /\{(block|floor|pos|seq)(\d*)(?::(\d+))?\}/g;

/** Renders a flat number from a pattern: "{block}-{floor}{pos2}" → "A-101"; "{block}{seq}" → "V1"; "{pos:3}" pads to 3. */
export function flatNumber(pattern: string, ctx: FlatNumberContext): string {
  if (!/\{(floor|pos|seq)/.test(pattern)) {
    throw new FlatGenerationError("INVALID_PATTERN", `Pattern "${pattern}" must contain {floor}, {pos} or {seq}`, { pattern });
  }
  return pattern.replace(NUMBER_TOKEN, (_whole, name: string, inlineWidth: string, colonWidth?: string) => {
    const width = colonWidth ? Number(colonWidth) : inlineWidth ? Number(inlineWidth) : 0;
    const pad = (value: string): string => (width > 0 ? value.padStart(width, "0") : value);
    switch (name) {
      case "block":
        return pad(ctx.blockCode);
      case "floor":
        return pad(ctx.floorLabel);
      case "pos":
        return pad(String(ctx.position));
      case "seq":
        return pad(String(ctx.seq));
      default:
        return "";
    }
  });
}

export interface FlatTypeValidationError {
  code: "NO_ROOMS" | "NO_AREAS" | "AREA_ORDER" | "NEGATIVE_AREA";
  message: string;
}

/** Validates a flat type: at least one room and one area, and super built-up ≥ built-up ≥ carpet. */
export function validateFlatType(
  flatType: Pick<FlatTypeDefinition, "rooms" | "areas" | "carpetSqft" | "builtupSqft" | "superBuiltupSqft">,
): FlatTypeValidationError[] {
  const errors: FlatTypeValidationError[] = [];
  if (flatType.rooms.length === 0) {
    errors.push({ code: "NO_ROOMS", message: "A flat type needs at least one room" });
  }
  if (flatType.areas.length === 0) {
    errors.push({ code: "NO_AREAS", message: "A flat type needs at least one area" });
  }
  if (flatType.carpetSqft < 0 || flatType.builtupSqft < 0 || flatType.superBuiltupSqft < 0) {
    errors.push({ code: "NEGATIVE_AREA", message: "Areas cannot be negative" });
  }
  if (!(flatType.superBuiltupSqft >= flatType.builtupSqft && flatType.builtupSqft >= flatType.carpetSqft)) {
    errors.push({ code: "AREA_ORDER", message: "Super built-up must be ≥ built-up, which must be ≥ carpet" });
  }
  return errors;
}

/** Facing of a generated flat: the template position's facing, else the flat type's. */
function resolveFacing(position: TemplatePosition, flatType: FlatTypeDefinition): string | null {
  const fromPosition = position.facing?.trim();
  if (fromPosition) {
    return fromPosition;
  }
  const fromType = flatType.facing?.trim();
  return fromType ? fromType : null;
}

/**
 * Generates every flat of a block from its floors, floor-plan ranges, templates and flat types,
 * snapshotting rooms/areas and pricing each flat through pricingFn. Throws instead of producing a partial list.
 */
export function generateFlats(
  block: BlockDefinition,
  templates: readonly FloorPlanTemplate[],
  flatTypes: readonly FlatTypeDefinition[],
  pricingFn: PricingFn,
): FlatDraft[] {
  const templateById = new Map(templates.map((t) => [t.id, t] as const));
  const flatTypeById = new Map(flatTypes.map((f) => [f.id, f] as const));
  const drafts: FlatDraft[] = [];
  const seen = new Set<string>();
  let seq = 0;
  for (const floor of unitFloors(block)) {
    const range = planForFloor(block.floorPlans, floor);
    const template = templateById.get(range.floorPlanTemplateId);
    if (!template) {
      throw new FlatGenerationError("TEMPLATE_NOT_FOUND", `Floor-plan template ${range.floorPlanTemplateId} not found`, {
        templateId: range.floorPlanTemplateId,
        floor,
      });
    }
    const positions = [...template.positions].sort((a, b) => a.position - b.position);
    for (const position of positions) {
      const flatType = flatTypeById.get(position.flatTypeId);
      if (!flatType) {
        throw new FlatGenerationError("FLAT_TYPE_NOT_FOUND", `Flat type ${position.flatTypeId} not found`, {
          flatTypeId: position.flatTypeId,
          floor,
          position: position.position,
        });
      }
      const typeErrors = validateFlatType(flatType);
      if (typeErrors.length > 0) {
        throw new FlatGenerationError("INVALID_FLAT_TYPE", `Flat type ${flatType.code} is invalid: ${typeErrors.map((e) => e.message).join("; ")}`, {
          flatTypeId: flatType.id,
          errors: typeErrors,
        });
      }
      seq += 1;
      const label = floorLabel(floor, block.groundFloorLabel);
      const number = flatNumber(block.numberingPattern, { blockCode: block.code, floorLabel: label, position: position.position, seq });
      if (seen.has(number)) {
        throw new FlatGenerationError("DUPLICATE_FLAT_NUMBER", `Numbering pattern produces duplicate flat number ${number}`, { flatNumber: number });
      }
      seen.add(number);
      const facing = resolveFacing(position, flatType);
      const isCorner = position.isCorner === true;
      const price = pricingFn({ flatType, floor, floorStart: block.floorStart, position: position.position, isCorner, facing });
      drafts.push({
        flatNumber: number,
        floor,
        floorLabel: label,
        position: position.position,
        seq,
        flatTypeId: flatType.id,
        flatTypeCode: flatType.code,
        facing,
        isCorner,
        roomsSnapshot: flatType.rooms.map((room) => ({ ...room })),
        areasSnapshot: flatType.areas.map((area) => ({ ...area })),
        carpetSqft: flatType.carpetSqft,
        builtupSqft: flatType.builtupSqft,
        superBuiltupSqft: flatType.superBuiltupSqft,
        ratePerSqftPaise: price.ratePerSqftPaise,
        pricePaise: price.totalPaise,
        priceBreakup: price.breakup.map((line) => ({ ...line })),
      });
    }
  }
  return drafts;
}
