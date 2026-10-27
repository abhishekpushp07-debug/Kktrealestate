// The single INR formatter (SPEC: Indian grouping, short forms ₹1.2 Cr / ₹45 L, integer paise). The cross-surface run of the same
// golden table (ERP, portal, website, packages/domain) lives in apps/erp/src/lib/__tests__/money-golden.test.ts.
import { describe, expect, it } from "vitest";
import { INR_GOLDEN_CASES, formatInr, formatInrShort, groupIndian, paiseToBigInt } from "../src/index.js";

describe("golden table", () => {
  it.each(INR_GOLDEN_CASES.map((c) => [c.paise, c.full, c.short] as const))(
    "%s paise → %s / %s",
    (paise, full, short) => {
      expect(formatInr(paise)).toBe(full);
      expect(formatInrShort(paise)).toBe(short);
      // bigint input gives the same text
      expect(formatInr(BigInt(paise))).toBe(full);
      expect(formatInrShort(BigInt(paise))).toBe(short);
    },
  );

  it("covers the SPEC and audit edge cases", () => {
    const byPaise = new Map(INR_GOLDEN_CASES.map((c) => [c.paise, c]));
    for (const paise of [0, -1_000_00, 99_96_000_00, 1_00_00_000_00, 1_20_00_000_00, 45_00_000_00, 99_999]) {
      expect(byPaise.has(paise)).toBe(true);
    }
    expect(byPaise.get(99_96_000_00)?.short).toBe("₹1 Cr");
  });
});

describe("formatInr", () => {
  it("groups the Indian way and shows paise only when non-zero by default", () => {
    expect(groupIndian("10000000")).toBe("1,00,00,000");
    expect(groupIndian("000123")).toBe("123");
    expect(formatInr(12_50_000_50)).toBe("₹12,50,000.50");
    expect(formatInr(12_50_000_00, { paise: "always" })).toBe("₹12,50,000.00");
  });

  it("'never' rounds half-up to rupees (never truncates)", () => {
    expect(formatInr(12_50_000_49, { paise: "never" })).toBe("₹12,50,000");
    expect(formatInr(12_50_000_50, { paise: "never" })).toBe("₹12,50,001");
    expect(formatInr(-12_50_000_50, { paise: "never" })).toBe("-₹12,50,001");
    expect(formatInr(-49, { paise: "never" })).toBe("₹0");
  });

  it("symbol and signed options", () => {
    expect(formatInr(6_00_000_00, { signed: true })).toBe("+₹6,00,000");
    expect(formatInr(-6_00_000_00, { signed: true })).toBe("-₹6,00,000");
    expect(formatInr(0, { signed: true })).toBe("₹0");
    expect(formatInr(1_000_00, { symbol: false })).toBe("1,000");
    expect(formatInrShort(45_00_000_00, { symbol: false })).toBe("45 L");
    expect(formatInrShort(45_00_000_00, { signed: true })).toBe("+₹45 L");
  });

  it("is exact beyond 2^53 paise with bigint input", () => {
    expect(formatInr(123_456_789_012_345_678_901n)).toBe("₹12,34,56,78,90,12,34,56,789.01");
    expect(formatInrShort(123_456_789_012_345_678_901n)).toBe("₹123456789012.3 Cr");
  });

  it("rounds fractional paise half away from zero and refuses non-finite input", () => {
    expect(paiseToBigInt(10.5)).toBe(11n);
    expect(paiseToBigInt(-10.5)).toBe(-11n);
    expect(formatInr(99.6)).toBe("₹1");
    expect(() => formatInr(Number.NaN)).toThrow(RangeError);
    expect(() => formatInrShort(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatInrShort", () => {
  it("has only the Cr and L units (no K) and at most one decimal", () => {
    for (let paise = 0; paise < 5_00_00_000_00; paise += 7_777_777) {
      const text = formatInrShort(paise);
      expect(text).toMatch(/^₹(\d{1,3}(,\d{2})*(,\d{3})?|\d+(\.\d)? (L|Cr))$/);
      expect(text).not.toMatch(/K/);
    }
  });

  it("rounds first, then promotes the unit", () => {
    expect(formatInrShort(99_95_000_00)).toBe("₹1 Cr");
    expect(formatInrShort(99_94_999_99)).toBe("₹99.9 L");
    expect(formatInrShort(99_999_50)).toBe("₹1 L");
    expect(formatInrShort(99_999_49)).toBe("₹99,999");
  });
});
