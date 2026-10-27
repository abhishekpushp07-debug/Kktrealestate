// The portal's money formatters against the shared golden table (packages/contracts moneyFormat). The cross-surface run with
// the ERP, the website and packages/domain is apps/erp/src/lib/__tests__/money-golden.test.ts.
import { INR_GOLDEN_CASES } from "@kkt/contracts";
import { describe, expect, it } from "vitest";
import { formatINR, formatINRShort } from "@/lib/format";

describe("portal INR formatting", () => {
  it.each(INR_GOLDEN_CASES.map((c) => [c.paise, c.full, c.short] as const))(
    "%s paise → %s / %s",
    (paise, full, short) => {
      expect(formatINR(paise)).toBe(full);
      expect(formatINRShort(paise)).toBe(short);
    },
  );

  it("prints ₹99,96,000 as ₹1 Cr (never ₹100 L), has no K unit and uses a hyphen-minus", () => {
    expect(formatINRShort(99_96_000_00)).toBe("₹1 Cr");
    expect(formatINRShort(12_500_00)).toBe("₹12,500");
    expect(formatINR(-1_000_00)).toBe("-₹1,000");
    expect(formatINR(1_000_00, { signed: true })).toBe("+₹1,000");
    expect(formatINR(1_000_00, { showPaise: true })).toBe("₹1,000.00");
    expect(formatINR(Number.NaN)).toBe("—");
  });
});
