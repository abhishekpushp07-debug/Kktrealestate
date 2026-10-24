import { describe, expect, it } from "vitest";
import {
  MoneyError,
  amountInWords,
  basisPointsToPercentString,
  bpOfPaise,
  formatINR,
  formatINRShort,
  groupIndian,
  integerToIndianWords,
  mulPaiseBySqft,
  paiseToRupeeString,
  pctOfPaise,
  sumPaise,
  toBasisPoints,
  toPaise,
} from "../src/index.js";

describe("toPaise", () => {
  it("converts rupee strings and numbers to integer paise", () => {
    expect(toPaise("100")).toBe(10000);
    expect(toPaise("1,00,00,000")).toBe(1_000_000_000);
    expect(toPaise("₹ 12,500.50")).toBe(1_250_050);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(1e7)).toBe(1_000_000_000);
    expect(toPaise(".5")).toBe(50);
    expect(toPaise("-250.75")).toBe(-25075);
  });
  it("rounds half-up without float accumulation", () => {
    expect(toPaise("1.005")).toBe(101);
    expect(toPaise("1.004999")).toBe(100);
    expect(toPaise("2.675")).toBe(268);
    expect(toPaise(2.675)).toBe(268);
    expect(toPaise("-1.005")).toBe(-101);
    expect(toPaise("99999999999.995")).toBe(10_000_000_000_000);
  });
  it("rejects garbage", () => {
    expect(() => toPaise("abc")).toThrow(MoneyError);
    expect(() => toPaise("")).toThrow(MoneyError);
    expect(() => toPaise(Number.NaN)).toThrow(MoneyError);
    expect(() => toPaise(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => toPaise("1.2.3")).toThrow(MoneyError);
  });
  it("round-trips through paiseToRupeeString", () => {
    expect(paiseToRupeeString(1_250_050)).toBe("12500.50");
    expect(paiseToRupeeString(-5)).toBe("-0.05");
    expect(toPaise(paiseToRupeeString(123456789))).toBe(123456789);
  });
});

describe("formatINR", () => {
  it("uses Indian grouping", () => {
    expect(formatINR(1_000_000_000)).toBe("₹1,00,00,000");
    expect(formatINR(100)).toBe("₹1");
    expect(formatINR(0)).toBe("₹0");
    expect(formatINR(99_900)).toBe("₹999");
    expect(formatINR(100_000)).toBe("₹1,000");
    expect(formatINR(1_250_000)).toBe("₹12,500");
    expect(formatINR(10_000_000)).toBe("₹1,00,000");
    expect(formatINR(123_456_789_012)).toBe("₹1,23,45,67,890.12");
    expect(groupIndian("1234567")).toBe("12,34,567");
    expect(groupIndian("0001234")).toBe("1,234");
  });
  it("handles negatives and paise modes", () => {
    expect(formatINR(-1_000_000)).toBe("-₹10,000");
    expect(formatINR(-50)).toBe("-₹0.50");
    expect(formatINR(1_250_050)).toBe("₹12,500.50");
    expect(formatINR(1_250_000, { paise: "always" })).toBe("₹12,500.00");
    expect(formatINR(1_250_050, { paise: "never" })).toBe("₹12,501");
    expect(formatINR(1_250_049, { paise: "never" })).toBe("₹12,500");
    expect(formatINR(1_250_050, { symbol: false })).toBe("12,500.50");
  });
  it("rejects non-integer paise", () => {
    expect(() => formatINR(1.5)).toThrow(MoneyError);
  });
});

describe("formatINRShort", () => {
  it("renders crore, lakh and plain forms", () => {
    expect(formatINRShort(1_200_000_000)).toBe("₹1.2 Cr");
    expect(formatINRShort(1_000_000_000)).toBe("₹1 Cr");
    expect(formatINRShort(450_000_000)).toBe("₹45 L");
    expect(formatINRShort(455_000_000)).toBe("₹45.5 L");
    expect(formatINRShort(1_250_000)).toBe("₹12,500");
    expect(formatINRShort(1_250_050)).toBe("₹12,501");
    expect(formatINRShort(0)).toBe("₹0");
    expect(formatINRShort(12_345_678_900)).toBe("₹12.3 Cr");
    expect(formatINRShort(123_456_789_000)).toBe("₹123.5 Cr");
  });
  it("handles boundaries and negatives", () => {
    expect(formatINRShort(999_950_000)).toBe("₹1 Cr");
    expect(formatINRShort(999_449_999)).toBe("₹99.9 L");
    expect(formatINRShort(9_999_999_999)).toBe("₹10 Cr");
    expect(formatINRShort(9_999_950)).toBe("₹1 L");
    expect(formatINRShort(9_999_949)).toBe("₹99,999");
    expect(formatINRShort(-450_000_000)).toBe("-₹45 L");
    expect(formatINRShort(-1_250_000)).toBe("-₹12,500");
  });
});

describe("percent helpers", () => {
  it("converts percents to basis points exactly", () => {
    expect(toBasisPoints(12.5)).toBe(1250);
    expect(toBasisPoints("12.50")).toBe(1250);
    expect(toBasisPoints("0.01")).toBe(1);
    expect(toBasisPoints(100)).toBe(10000);
    expect(toBasisPoints(33.33)).toBe(3333);
    expect(() => toBasisPoints("12.345")).toThrow(MoneyError);
    expect(basisPointsToPercentString(1250)).toBe("12.50");
    expect(basisPointsToPercentString(5)).toBe("0.05");
  });
  it("pctOfPaise rounds half-up", () => {
    expect(pctOfPaise(6_000_000_00, 10)).toBe(60_000_000);
    expect(pctOfPaise(1001, 50)).toBe(501);
    expect(pctOfPaise(1001, "33.33")).toBe(334);
    expect(pctOfPaise(999, 0.01)).toBe(0);
    expect(pctOfPaise(5000, 0.01)).toBe(1);
    expect(pctOfPaise(-1001, 50)).toBe(-501);
    expect(bpOfPaise(1000, 1250)).toBe(125);
  });
});

describe("amountInWords", () => {
  it("renders Indian system words", () => {
    expect(amountInWords(toPaise("12,50,000"))).toBe("Rupees Twelve Lakh Fifty Thousand Only");
    expect(amountInWords(toPaise("1,00,00,000"))).toBe("Rupees One Crore Only");
    expect(amountInWords(toPaise("1,23,45,678.50"))).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only",
    );
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(50)).toBe("Fifty Paise Only");
    expect(amountInWords(toPaise("101"))).toBe("Rupees One Hundred One Only");
    expect(amountInWords(toPaise("1,000"))).toBe("Rupees One Thousand Only");
    expect(amountInWords(toPaise("19"))).toBe("Rupees Nineteen Only");
    expect(amountInWords(toPaise("20"))).toBe("Rupees Twenty Only");
    expect(amountInWords(toPaise("99,99,99,999.99"))).toBe(
      "Rupees Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only",
    );
    expect(amountInWords(toPaise("1,00,00,00,000"))).toBe("Rupees One Hundred Crore Only");
    expect(amountInWords(123_456_789_123 * 100)).toBe(
      "Rupees Twelve Thousand Three Hundred Forty Five Crore Sixty Seven Lakh Eighty Nine Thousand One Hundred Twenty Three Only",
    );
    expect(amountInWords(-toPaise("500"))).toBe("Minus Rupees Five Hundred Only");
    expect(integerToIndianWords(0)).toBe("Zero");
  });
});

describe("misc", () => {
  it("sums and multiplies by area with half-up rounding", () => {
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(mulPaiseBySqft(550_000, 1250)).toBe(687_500_000);
    expect(mulPaiseBySqft(550_000, 1250.5)).toBe(687_775_000);
    expect(mulPaiseBySqft(333, 0.5)).toBe(167);
    expect(mulPaiseBySqft(333, 0.33)).toBe(110);
  });
});
