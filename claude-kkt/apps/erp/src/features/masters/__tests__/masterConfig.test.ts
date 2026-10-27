import { describe, expect, it } from "vitest";
import { MASTER_KINDS, MASTER_KIND_LABELS } from "@kkt/contracts";
import { kindToSlug } from "../api";
import { MASTER_CONFIGS, MASTER_CONFIG_LIST, getMasterConfig } from "../masterConfig";

describe("masterConfig registry", () => {
  it("has exactly one config for every MASTER_KIND", () => {
    expect(Object.keys(MASTER_CONFIGS).sort()).toEqual([...MASTER_KINDS].sort());
    expect(MASTER_CONFIG_LIST).toHaveLength(MASTER_KINDS.length);
    for (const kind of MASTER_KINDS) {
      const config = MASTER_CONFIGS[kind];
      expect(config.kind).toBe(kind);
      expect(config.label).toBe(MASTER_KIND_LABELS[kind]);
    }
  });

  it("uses the hyphenated lower-case slug the API routes on", () => {
    for (const kind of MASTER_KINDS) {
      const config = MASTER_CONFIGS[kind];
      expect(config.slug).toBe(kindToSlug(kind));
      expect(config.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(getMasterConfig(config.slug)).toBe(config);
    }
    expect(kindToSlug("FLOOR_PLAN_TEMPLATES")).toBe("floor-plan-templates");
    expect(getMasterConfig("nope")).toBeUndefined();
    expect(getMasterConfig(undefined)).toBeUndefined();
  });

  it("gives every kind columns, a form, defaults and a sort (CSV templates come from the API)", () => {
    for (const config of MASTER_CONFIG_LIST) {
      expect(config.columns.length, config.kind).toBeGreaterThan(0);
      expect(config.defaultSort, config.kind).toMatch(/^-?[a-z_]+$/);
      // audit v3 G1: no hand-kept import columns (they drifted: default_amount vs default_amount_paise)
      expect("csv" in config, config.kind).toBe(false);
      expect(Boolean(config.Form) || Boolean(config.fields?.length), `${config.kind} needs a Form or fields`).toBe(
        true,
      );
      expect(typeof config.defaults(), config.kind).toBe("object");
      expect(config.singular.length, config.kind).toBeGreaterThan(0);
    }
  });

  it("rejects empty defaults and accepts a complete record through the contract schema", async () => {
    const roomTypes = MASTER_CONFIGS.ROOM_TYPES;
    const empty = await roomTypes.createSchema.safeParseAsync(roomTypes.defaults());
    expect(empty.success).toBe(false);
    const filled = await roomTypes.createSchema.safeParseAsync({ name: "Bedroom", code: "bed", sort_order: 2 });
    expect(filled.success).toBe(true);
    if (filled.success) expect(filled.data).toEqual({ name: "Bedroom", code: "BED", sort_order: 2 });
  });

  it("strips UI-only keys before validating flat types and bank accounts", async () => {
    const flatTypes = MASTER_CONFIGS.FLAT_TYPES;
    const roomTypeId = "11111111-1111-4111-8111-111111111111";
    const areaTypeId = "22222222-2222-4222-8222-222222222222";
    const result = await flatTypes.createSchema.safeParseAsync({
      ...flatTypes.defaults(),
      name: "3BHK-A",
      code: "3bhk_a",
      bhk: 3,
      rooms: [{ room_type_id: roomTypeId, label: "Master Bedroom", length_ft: 12, width_ft: 10, sqft: null }],
      areas: [{ area_type_id: areaTypeId, sqft: 1200 }],
      pricing_mode: "RATE",
      base_rate_per_sqft_paise: 4500_00,
      base_price_paise: 99,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect("pricing_mode" in data).toBe(false);
      expect(data.base_price_paise).toBeNull();
      expect(data.base_rate_per_sqft_paise).toBe(4500_00);
      expect(data.code).toBe("3BHK_A");
    }

    const banks = MASTER_CONFIGS.BANK_ACCOUNTS;
    const mismatch = await banks.createSchema.safeParseAsync({
      ...banks.defaults(),
      bank_name: "HDFC",
      account_name: "KKT",
      ifsc: "hdfc0001234",
      account_number: "501001234567",
      account_number_confirm: "501001234568",
    });
    expect(mismatch.success).toBe(false);
    const ok = await banks.createSchema.safeParseAsync({
      ...banks.defaults(),
      bank_name: "HDFC",
      account_name: "KKT",
      ifsc: "hdfc0001234",
      account_number: "5010 0123 4567",
      account_number_confirm: "501001234567",
    });
    expect(ok.success).toBe(true);
    if (ok.success)
      expect(ok.data).toEqual({
        bank_name: "HDFC",
        branch: null,
        account_name: "KKT",
        account_number: "501001234567",
        ifsc: "HDFC0001234",
        is_default: false,
        is_escrow: false,
      });
  });
});
