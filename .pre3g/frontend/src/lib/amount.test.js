import { cleanAmount, formatAmountInput, groupINR, toPaise } from "./amount";

test("Indian grouping while typing", () => {
  expect(formatAmountInput("123456")).toBe("1,23,456");
  expect(formatAmountInput("12345678")).toBe("1,23,45,678");
  expect(formatAmountInput("999")).toBe("999");
  expect(formatAmountInput("1000")).toBe("1,000");
  expect(groupINR("100000000")).toBe("10,00,00,000");
});

test("pasting a formatted value keeps the exact value", () => {
  expect(cleanAmount("1,23,456.50")).toBe("123456.50");
  expect(formatAmountInput("₹ 1,23,456.50")).toBe("1,23,456.50");
  expect(toPaise("1,23,456.50")).toBe(12345650);
  expect(toPaise("0.1")).toBe(10);
  expect(toPaise("19.99")).toBe(1999);
});

test("decimals: at most two, a lone dot is kept while typing", () => {
  expect(cleanAmount("12.")).toBe("12.");
  expect(cleanAmount("12.345")).toBe("12.34");
  expect(cleanAmount(".5")).toBe("0.5");
  expect(cleanAmount("1.2.3")).toBe("1.23");
  expect(cleanAmount("007")).toBe("7");
});

test("empty stays empty", () => {
  expect(cleanAmount("")).toBe("");
  expect(cleanAmount(null)).toBe("");
  expect(toPaise("")).toBeNull();
  expect(formatAmountInput(undefined)).toBe("");
});

test("negative refused unless the field allows it", () => {
  expect(cleanAmount("-500")).toBe("500");
  expect(toPaise("-500")).toBe(50000);
  expect(cleanAmount("-500", { allowNegative: true })).toBe("-500");
  expect(toPaise("-1,000.25", { allowNegative: true })).toBe(-100025);
  expect(cleanAmount("abc")).toBe("");
});
