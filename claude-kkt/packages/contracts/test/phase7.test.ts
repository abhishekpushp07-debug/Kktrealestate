// Phase 7 foundation contract changes: exact BUCKET_CAP_EXCEEDED details, bounded offset paging, PLC precision, the business-rule
// registry, new error codes (VERSION_REQUIRED is 428 per contract C6) and versions on demand / other-charge / draft / preset rows.
import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";

const ID = "00000000-0000-4000-8000-000000000001";

describe("BUCKET_CAP_EXCEEDED details", () => {
  it("are exactly what the API sends: bucket, agreed, paid, amount, headroom", () => {
    const details = { bucket: "ACCOUNT", agreed_paise: 4e8, paid_paise: 4e7, amount_paise: 37e7, headroom_paise: 36e7 };
    expect(contracts.BucketCapDetailsSchema.strict().parse(details)).toEqual(details);
    // the old (never sent) shape no longer parses
    expect(
      contracts.BucketCapDetailsSchema.safeParse({
        bucket: "CASH",
        agreed_paise: 1,
        received_paise: 1,
        attempted_paise: 1,
        headroom_paise: 0,
      }).success,
    ).toBe(false);
    expect(contracts.BucketCapDetailsSchema.safeParse({ ...details, bucket: "OTHER_CHARGE" }).success).toBe(false);
  });
});

describe("list paging", () => {
  it("page is 1 … 1000; deeper paging names cursor mode", () => {
    expect(contracts.ListQuerySchema.parse({ page: "1000" }).page).toBe(1000);
    const r = contracts.ListQuerySchema.safeParse({ page: "1001" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/cursor/);
    expect(contracts.MAX_PAGE).toBe(1000);
    expect(contracts.PublicListQuerySchema.safeParse({ page: "5000" }).success).toBe(false);
  });
});

describe("PLC rule precision", () => {
  const rule = (calc_mode: string, value: number) => ({ plc_type_id: ID, calc_mode, value, applies_to: "ALL" });
  it("PERCENT allows at most 2 decimals", () => {
    expect(contracts.PlcRuleSchema.safeParse(rule("PERCENT", 2.25)).success).toBe(true);
    expect(contracts.PlcRuleSchema.safeParse(rule("PERCENT", 0.1)).success).toBe(true);
    const bad = contracts.PlcRuleSchema.safeParse(rule("PERCENT", 2.125));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["value"]);
  });
  it("FIXED, PER_SQFT and FLOOR_RISE are whole paise", () => {
    for (const mode of ["FIXED", "PER_SQFT", "FLOOR_RISE"]) {
      expect(contracts.PlcRuleSchema.safeParse(rule(mode, 250000)).success, mode).toBe(true);
      expect(contracts.PlcRuleSchema.safeParse(rule(mode, 2500.5)).success, mode).toBe(false);
    }
  });
});

describe("business-rule registry", () => {
  it("holds unique UPPER_SNAKE ids, typed by RuleIdSchema", () => {
    expect(new Set(contracts.BUSINESS_RULES).size).toBe(contracts.BUSINESS_RULES.length);
    for (const id of contracts.BUSINESS_RULES) expect(id).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(contracts.RuleIdSchema.safeParse("PRICE_DEVIATION_NOT_ALLOWED").success).toBe(true);
    expect(contracts.isKnownRuleId("SOME_FUTURE_RULE")).toBe(false);
  });
  it("no rule id doubles as a top-level error code with another meaning, except the flat-availability rule", () => {
    const overlap = contracts.BUSINESS_RULES.filter((r) => (contracts.ERROR_CODES as readonly string[]).includes(r));
    expect(overlap).toEqual(["FLAT_NOT_AVAILABLE"]);
  });
});

describe("error registry additions", () => {
  it.each([
    ["VERSION_REQUIRED", 428],
    ["CONSTRAINT_VIOLATION", 422],
    ["INVALID_AMOUNT", 422],
    ["COMPANY_REQUIRED", 400],
  ] as const)("%s → %i", (code, status) => {
    expect(contracts.statusForError(code)).toBe(status);
  });
  it("VERSION_CONFLICT details carry current_version; IN_USE may name the constraint and referencing table", () => {
    expect(
      contracts.VersionConflictDetailsSchema.parse({ current: 3, current_version: 3, changed_by: null })
        .current_version,
    ).toBe(3);
    expect(
      contracts.InUseDetailsSchema.parse({ usage_count: 2, constraint: "c", referenced_by: "bookings" }).referenced_by,
    ).toBe("bookings");
    expect(
      contracts.ConstraintViolationDetailsSchema.safeParse({ kind: "check", constraint: "x_chk", table: "x" }).success,
    ).toBe(true);
  });
});

describe("versions on rows (contract C6)", () => {
  it("demand, other-charge, draft and preset rows require a version", () => {
    for (const schema of [
      contracts.DemandRowSchema,
      contracts.OtherChargeRowSchema,
      contracts.BookingDraftRowSchema,
      contracts.ReportPresetRowSchema,
    ]) {
      expect(Object.keys(schema.shape)).toContain("version");
    }
    expect(contracts.OtherChargeDemandLineSchema.safeParse({ version: 3, line_version: 1 }).success).toBe(true);
  });
  it("the ledger knows DEMAND_VOIDED and LEDGER_RESTATED", () => {
    expect(contracts.LEDGER_EVENTS).toEqual(expect.arrayContaining(["DEMAND_VOIDED", "LEDGER_RESTATED"]));
    expect(contracts.LEDGER_EVENT_LABELS.LEDGER_RESTATED).toBe("Ledger restated");
  });
});
