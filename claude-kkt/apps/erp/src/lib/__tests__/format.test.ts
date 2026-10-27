import { describe, expect, it } from "vitest";
import {
  amountInWords,
  formatDate,
  formatINR,
  formatINRShort,
  formatPercent,
  groupIndian,
  paiseToRupeesInput,
  rupeesInputToPaise,
} from "@/lib/format";

describe("formatINR", () => {
  it("groups rupees in the Indian 3-2-2 pattern", () => {
    expect(groupIndian("12500000")).toBe("1,25,00,000");
    expect(formatINR(1_00_00_000_00)).toBe("₹1,00,00,000");
    expect(formatINR(8_50_000_00)).toBe("₹8,50,000");
    expect(formatINR(999_00)).toBe("₹999");
    expect(formatINR(0)).toBe("₹0");
  });

  it("shows paise only when present (or forced) and handles negatives", () => {
    expect(formatINR(12_50_000_50)).toBe("₹12,50,000.50");
    expect(formatINR(12_50_000_00, { decimals: "always" })).toBe("₹12,50,000.00");
    // "never" rounds half-up like the receipts (packages/domain), it does not truncate
    expect(formatINR(12_50_000_50, { decimals: "never" })).toBe("₹12,50,001");
    expect(formatINR(12_50_000_49, { decimals: "never" })).toBe("₹12,50,000");
    expect(formatINR(-6_00_000_00)).toBe("-₹6,00,000");
    expect(formatINR(6_00_000_00, { signed: true })).toBe("+₹6,00,000");
    expect(formatINR(null)).toBe("—");
  });
});

describe("formatINRShort", () => {
  it("uses Cr and L with trimmed decimals", () => {
    expect(formatINRShort(1_20_00_000_00)).toBe("₹1.2 Cr");
    expect(formatINRShort(1_00_00_000_00)).toBe("₹1 Cr");
    expect(formatINRShort(1_50_00_000_00)).toBe("₹1.5 Cr");
    expect(formatINRShort(45_00_000_00)).toBe("₹45 L");
    expect(formatINRShort(45_50_000_00)).toBe("₹45.5 L");
    expect(formatINRShort(99_99_000_00)).toBe("₹1 Cr");
    expect(formatINRShort(85_000_00)).toBe("₹85,000");
    expect(formatINRShort(-4_00_000_00)).toBe("-₹4 L");
  });
});

describe("paise <-> rupee input", () => {
  it("converts paise to a grouped input string and back", () => {
    expect(paiseToRupeesInput(12_50_000_50)).toBe("12,50,000.50");
    expect(paiseToRupeesInput(12_50_000_00)).toBe("12,50,000");
    expect(paiseToRupeesInput(null)).toBe("");
    expect(rupeesInputToPaise("12,50,000.50")).toBe(12_50_000_50);
    expect(rupeesInputToPaise("₹ 1,00,00,000")).toBe(1_00_00_000_00);
    expect(rupeesInputToPaise("0.5")).toBe(50);
    expect(rupeesInputToPaise("12.345")).toBe(12_34);
  });

  it("accepts Indian shorthand suffixes and rejects garbage", () => {
    expect(rupeesInputToPaise("45L")).toBe(45_00_000_00);
    expect(rupeesInputToPaise("1.2 Cr")).toBe(1_20_00_000_00);
    expect(rupeesInputToPaise("50k")).toBe(50_000_00);
    expect(rupeesInputToPaise("")).toBe(null);
    expect(rupeesInputToPaise("abc")).toBe(null);
    expect(rupeesInputToPaise("1..2")).toBe(null);
  });
});

describe("amountInWords", () => {
  it("spells amounts in the Indian system", () => {
    expect(amountInWords(12_50_000_00)).toBe("Rupees Twelve Lakh Fifty Thousand Only");
    expect(amountInWords(1_00_00_000_00)).toBe("Rupees One Crore Only");
    expect(amountInWords(1_23_45_678_90)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only",
    );
    expect(amountInWords(150_00_00_000_00)).toBe("Rupees One Hundred Fifty Crore Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});

describe("dates and percents", () => {
  it("formats business dates and percents", () => {
    expect(formatDate("2026-10-24")).toBe("24 Oct 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatPercent(12.5)).toBe("12.5%");
    expect(formatPercent(10)).toBe("10%");
    expect(formatPercent(33.333)).toBe("33.33%");
  });
});
