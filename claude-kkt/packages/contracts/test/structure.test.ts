import { describe, expect, it } from "vitest";
import {
  BlockCreateSchema,
  ConstructionStatusUpdateSchema,
  CustomerCreateSchema,
  FlatStatusChangeSchema,
  FloorPlanTemplateCreateSchema,
  PlcRuleSchema,
  ServiceMessageCreateSchema,
  PortalRequestMessageCreateSchema,
  VisitSettingsSchema,
  AdminReseedRequestSchema,
  IntegrityRepairRequestSchema,
} from "../src/index.js";

const U = (n: number) => `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("BlockCreateSchema", () => {
  const block = {
    project_id: U(1),
    block_type_id: U(2),
    name: "Tower C",
    code: "C",
    floors: 15,
    floor_start: 1,
    skip_floors: [13],
    refuge_floors: [7],
    floor_plans: [
      { from_floor: 1, to_floor: 5, floor_plan_template_id: U(3) },
      { from_floor: 6, to_floor: 15, floor_plan_template_id: U(4) },
    ],
  };
  it("accepts a 15-floor tower with skip 13 and refuge 7", () => {
    const r = BlockCreateSchema.safeParse(block);
    expect(r.success).toBe(true);
    expect(r.data?.numbering_pattern).toBe("{block}-{floor}{pos2}");
  });
  it("rejects overlapping ranges, uncovered floors and bad patterns", () => {
    expect(
      BlockCreateSchema.safeParse({
        ...block,
        floor_plans: [
          { from_floor: 1, to_floor: 6, floor_plan_template_id: U(3) },
          { from_floor: 6, to_floor: 15, floor_plan_template_id: U(4) },
        ],
      }).success,
    ).toBe(false);
    const r = BlockCreateSchema.safeParse({
      ...block,
      floor_plans: [{ from_floor: 1, to_floor: 10, floor_plan_template_id: U(3) }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message.includes("11, 12, 14, 15"))).toBe(true);
    expect(BlockCreateSchema.safeParse({ ...block, numbering_pattern: "{tower}{seq}" }).success).toBe(false);
    expect(BlockCreateSchema.safeParse({ ...block, floor_start: 20 }).success).toBe(false);
  });
  it("does not require plans for refuge/podium floors", () => {
    expect(
      BlockCreateSchema.safeParse({
        ...block,
        podium_floors: [1, 2],
        floor_plans: [{ from_floor: 3, to_floor: 15, floor_plan_template_id: U(3) }],
      }).success,
    ).toBe(true);
  });
});

describe("FloorPlanTemplateCreateSchema", () => {
  it("requires positions 1..n", () => {
    const ok = {
      name: "Plan A",
      code: "A",
      positions: [
        { position: 1, flat_type_id: U(1) },
        { position: 2, flat_type_id: U(1), is_corner: true },
      ],
    };
    expect(FloorPlanTemplateCreateSchema.safeParse(ok).success).toBe(true);
    expect(
      FloorPlanTemplateCreateSchema.safeParse({
        ...ok,
        positions: [
          { position: 1, flat_type_id: U(1) },
          { position: 3, flat_type_id: U(1) },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("FlatStatusChangeSchema", () => {
  it("allows only AVAILABLE / HOLD / BLOCKED", () => {
    expect(FlatStatusChangeSchema.safeParse({ version: 1, status: "HOLD" }).success).toBe(true);
    expect(FlatStatusChangeSchema.safeParse({ version: 1, status: "BOOKED" }).success).toBe(false);
    expect(FlatStatusChangeSchema.safeParse({ version: 1, status: "SOLD" }).success).toBe(false);
  });
});

describe("PlcRuleSchema", () => {
  it("requires condition details per applies_to", () => {
    const base = { plc_type_id: U(1), calc_mode: "FIXED" as const, value: 100000, applies_to: "ALL" as const };
    expect(PlcRuleSchema.safeParse(base).success).toBe(true);
    expect(PlcRuleSchema.safeParse({ ...base, applies_to: "FLOORS_GTE" }).success).toBe(false);
    expect(PlcRuleSchema.safeParse({ ...base, applies_to: "FLOORS_GTE", floors_gte: 10 }).success).toBe(true);
    expect(PlcRuleSchema.safeParse({ ...base, applies_to: "FACING_IN", facings: [] }).success).toBe(false);
    expect(PlcRuleSchema.safeParse({ ...base, calc_mode: "PERCENT", value: 150 }).success).toBe(false);
    expect(PlcRuleSchema.safeParse({ ...base, value: 10.5 }).success).toBe(false);
  });
});

describe("CustomerCreateSchema", () => {
  it("normalises KYC inputs", () => {
    const r = CustomerCreateSchema.safeParse({
      full_name: "Rohit Sharma",
      phone: "+91 98765 43210",
      pan: "abcde1234f",
      aadhaar: "2345 6789 0123",
      email: "R@X.com",
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      phone: "9876543210",
      pan: "ABCDE1234F",
      aadhaar: "234567890123",
      email: "r@x.com",
      same_as_current: true,
    });
  });
  it("needs a permanent address when not same as current", () => {
    expect(
      CustomerCreateSchema.safeParse({ full_name: "A B", phone: "9876543210", same_as_current: false }).success,
    ).toBe(false);
  });
});

describe("ConstructionStatusUpdateSchema", () => {
  it("validates intermediate dates", () => {
    const ok = { version: 1, stage_id: U(1), completed_on: "2026-06-30", intermediate_dates: { [U(2)]: "2026-05-31" } };
    expect(ConstructionStatusUpdateSchema.safeParse(ok).success).toBe(true);
    expect(
      ConstructionStatusUpdateSchema.safeParse({ ...ok, intermediate_dates: { [U(2)]: "2026-07-01" } }).success,
    ).toBe(false);
    expect(
      ConstructionStatusUpdateSchema.safeParse({ ...ok, intermediate_dates: { nope: "2026-05-31" } }).success,
    ).toBe(false);
  });
});

describe("service messages", () => {
  it("staff may mark internal; portal schema has no such field", () => {
    expect(ServiceMessageCreateSchema.safeParse({ body: "note", is_internal: true }).success).toBe(true);
    expect(PortalRequestMessageCreateSchema.safeParse({ body: "hi", is_internal: true }).success).toBe(false);
    expect(PortalRequestMessageCreateSchema.safeParse({ body: "hi" }).success).toBe(true);
  });
});

describe("visit settings", () => {
  it("validates slot length and time order", () => {
    expect(VisitSettingsSchema.safeParse({ enabled: true, slot_minutes: 30 }).success).toBe(true);
    expect(VisitSettingsSchema.safeParse({ enabled: true, slot_minutes: 45 }).success).toBe(false);
    expect(VisitSettingsSchema.safeParse({ start_time: "18:00", end_time: "10:00" }).success).toBe(false);
  });
});

describe("admin guards", () => {
  it("require literal confirmations", () => {
    expect(AdminReseedRequestSchema.safeParse({ confirm: "RESEED" }).success).toBe(true);
    expect(AdminReseedRequestSchema.safeParse({ confirm: "reseed" }).success).toBe(false);
    expect(IntegrityRepairRequestSchema.safeParse({ confirm: "REPAIR" }).success).toBe(true);
    expect(IntegrityRepairRequestSchema.safeParse({}).success).toBe(false);
  });
});
