/**
 * Money primitives. Every amount is an integer number of paise (1 rupee = 100 paise).
 * All rounding is done with BigInt arithmetic so no floating-point error accumulates.
 */

/** Error thrown when a money input cannot be interpreted. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Converts a BigInt to a number, refusing anything outside the safe-integer range. */
export function bigIntToSafeNumber(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new MoneyError(`Amount ${value.toString()} exceeds the safe integer range`);
  }
  return Number(value);
}

/** Asserts that a value is an integer paise amount (safe integer, may be negative). */
export function assertPaise(value: number, what = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${what} must be an integer number of paise, got ${String(value)}`);
  }
  return value;
}

/** Divides a BigInt by a positive BigInt rounding half away from zero (commercial half-up). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new MoneyError("Denominator must be positive");
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

interface DecimalParts {
  negative: boolean;
  integer: string;
  fraction: string;
}

/** Expands a JS number into a plain decimal string without exponent notation. */
function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Amount must be finite, got ${String(value)}`);
  }
  const raw = String(value);
  if (!/[eE]/.test(raw)) {
    return raw;
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (!match) {
    throw new MoneyError(`Cannot parse number ${raw}`);
  }
  const sign = match[1] ?? "";
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";
  const exponent = Number(match[4]);
  const digits = intPart + fracPart;
  const pointIndex = intPart.length + exponent;
  if (pointIndex <= 0) {
    return `${sign}0.${"0".repeat(-pointIndex)}${digits}`;
  }
  if (pointIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(pointIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

/** Splits a decimal string such as "-1,25,000.505" into sign, integer and fraction digits. */
function parseDecimal(input: string | number, what: string): DecimalParts {
  const text = (typeof input === "number" ? numberToDecimalString(input) : input).replace(/[₹,\s_]/g, "").trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new MoneyError(`${what} "${String(input)}" is not a decimal number`);
  }
  return {
    negative: match[1] === "-",
    integer: match[2] === "" ? "0" : (match[2] as string),
    fraction: match[3] ?? "",
  };
}

/**
 * Scales a decimal input by 10^scale and rounds half-up (away from zero) to an integer BigInt.
 * E.g. scaleDecimal("12.345", 2) === 1235n.
 */
export function scaleDecimal(input: string | number, scale: number, what = "value"): bigint {
  const parts = parseDecimal(input, what);
  const frac = parts.fraction.padEnd(scale, "0");
  const kept = frac.slice(0, scale);
  const rest = frac.slice(scale);
  let value = BigInt(parts.integer + kept);
  if (rest.length > 0 && rest.charCodeAt(0) >= 53 /* '5' */) {
    value += 1n;
  }
  return parts.negative ? -value : value;
}

/** Converts rupees (string like "1,25,000.50" or a number) to integer paise with half-up rounding. */
export function toPaise(rupees: string | number): number {
  return bigIntToSafeNumber(scaleDecimal(rupees, 2, "Rupee amount"));
}

/** Converts integer paise to a rupee decimal string, e.g. 1250050 → "12500.50". */
export function paiseToRupeeString(paise: number): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  return `${negative ? "-" : ""}${rupees}.${String(p).padStart(2, "0")}`;
}

/** Converts a percent (number or string with at most 2 decimals) to integer basis points. */
export function toBasisPoints(percent: string | number): number {
  const parts = parseDecimal(percent, "Percent");
  if (parts.fraction.replace(/0+$/, "").length > 2) {
    throw new MoneyError(`Percent "${String(percent)}" has more than 2 decimal places`);
  }
  return bigIntToSafeNumber(scaleDecimal(percent, 2, "Percent"));
}

/** Formats basis points as a percent string with two decimals, e.g. 1250 → "12.50". */
export function basisPointsToPercentString(bp: number): string {
  assertPaise(bp, "Basis points");
  const negative = bp < 0;
  const abs = Math.abs(bp);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Returns percent of a paise amount, half-up, using basis points (percent has at most 2 decimals). */
export function pctOfPaise(paise: number, percent: string | number): number {
  assertPaise(paise);
  const bp = BigInt(toBasisPoints(percent));
  return bigIntToSafeNumber(divRoundHalfUp(BigInt(paise) * bp, 10000n));
}

/** Returns basis-points share of a paise amount, half-up: bpOfPaise(1000, 1250) = 125. */
export function bpOfPaise(paise: number, bp: number): number {
  assertPaise(paise);
  assertPaise(bp, "Basis points");
  return bigIntToSafeNumber(divRoundHalfUp(BigInt(paise) * BigInt(bp), 10000n));
}

/** Groups a non-negative integer digit string the Indian way: "10000000" → "1,00,00,000". */
export function groupIndian(digits: string): string {
  const clean = digits.replace(/^0+(?=\d)/, "");
  if (clean.length <= 3) {
    return clean;
  }
  const last3 = clean.slice(-3);
  const rest = clean.slice(0, -3);
  const groups: string[] = [];
  for (let i = rest.length; i > 0; i -= 2) {
    groups.unshift(rest.slice(Math.max(0, i - 2), i));
  }
  return `${groups.join(",")},${last3}`;
}

export interface FormatINROptions {
  /** "auto" shows paise only when non-zero (default), "always" shows two decimals, "never" rounds to rupees. */
  paise?: "auto" | "always" | "never";
  /** Include the ₹ symbol (default true). */
  symbol?: boolean;
}

/** Formats paise as Indian-grouped rupees, e.g. 1000000000 → "₹1,00,00,000"; negatives as "-₹1,000". */
export function formatINR(paise: number, options: FormatINROptions = {}): string {
  assertPaise(paise);
  const mode = options.paise ?? "auto";
  const symbol = options.symbol === false ? "" : "₹";
  const negative = paise < 0;
  let abs = Math.abs(paise);
  if (mode === "never") {
    abs = Number(divRoundHalfUp(BigInt(abs), 100n)) * 100;
  }
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const showPaise = mode === "always" || (mode === "auto" && p !== 0);
  const body = groupIndian(String(rupees)) + (showPaise ? `.${String(p).padStart(2, "0")}` : "");
  // An amount shown as zero carries no sign ("₹0", never "-₹0"), like packages/contracts moneyFormat.
  return `${negative && abs !== 0 ? "-" : ""}${symbol}${body}`;
}

const CRORE_PAISE = 10_000_000n * 100n;
const LAKH_PAISE = 100_000n * 100n;

/** Scales paise to a unit and renders with at most one decimal (half-up), trimming ".0". */
function shortUnit(absPaise: bigint, unitPaise: bigint): string {
  const tenths = divRoundHalfUp(absPaise * 10n, unitPaise);
  const whole = tenths / 10n;
  const tenth = tenths % 10n;
  return tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
}

/** Formats paise in short Indian form: "₹1.2 Cr", "₹45 L", "₹12,500" (rounded to rupees). */
export function formatINRShort(paise: number): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = BigInt(Math.abs(paise));
  const sign = negative ? "-" : "";
  if (abs >= CRORE_PAISE) {
    return `${sign}₹${shortUnit(abs, CRORE_PAISE)} Cr`;
  }
  if (abs >= LAKH_PAISE) {
    const text = shortUnit(abs, LAKH_PAISE);
    if (text === "100") {
      return `${sign}₹1 Cr`;
    }
    return `${sign}₹${text} L`;
  }
  const rupees = divRoundHalfUp(abs, 100n);
  if (rupees === 100_000n) {
    return `${sign}₹1 L`;
  }
  return `${rupees === 0n ? "" : sign}₹${groupIndian(rupees.toString())}`;
}

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"] as const;

/** Words for 0..99. */
function twoDigitWords(n: number): string {
  if (n < 20) {
    return ONES[n] ?? "";
  }
  const tens = TENS[Math.floor(n / 10)] ?? "";
  const ones = n % 10;
  return ones === 0 ? tens : `${tens} ${ONES[ones] ?? ""}`;
}

/** Words for 0..999. */
function threeDigitWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    parts.push(`${ONES[hundreds] ?? ""} Hundred`);
  }
  if (rest > 0) {
    parts.push(twoDigitWords(rest));
  }
  return parts.join(" ");
}

/** Converts a non-negative integer to Indian-system words (crore / lakh / thousand / hundred). */
export function integerToIndianWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`Expected a non-negative safe integer, got ${String(value)}`);
  }
  if (value === 0) {
    return "Zero";
  }
  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const afterCrore = value % 10_000_000;
  const lakh = Math.floor(afterCrore / 100_000);
  const afterLakh = afterCrore % 100_000;
  const thousand = Math.floor(afterLakh / 1000);
  const rest = afterLakh % 1000;
  if (crore > 0) {
    parts.push(`${integerToIndianWords(crore)} Crore`);
  }
  if (lakh > 0) {
    parts.push(`${twoDigitWords(lakh)} Lakh`);
  }
  if (thousand > 0) {
    parts.push(`${twoDigitWords(thousand)} Thousand`);
  }
  if (rest > 0) {
    parts.push(threeDigitWords(rest));
  }
  return parts.join(" ");
}

/** Renders paise as receipt words: "Rupees Twelve Lakh Fifty Thousand and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  let text: string;
  if (rupees === 0 && p > 0) {
    text = `${twoDigitWords(p)} Paise`;
  } else {
    text = `Rupees ${integerToIndianWords(rupees)}`;
    if (p > 0) {
      text += ` and ${twoDigitWords(p)} Paise`;
    }
  }
  return `${negative ? "Minus " : ""}${text} Only`;
}

/** Sums paise amounts, asserting each is an integer. */
export function sumPaise(amounts: readonly number[]): number {
  let total = 0n;
  for (const amount of amounts) {
    assertPaise(amount);
    total += BigInt(amount);
  }
  return bigIntToSafeNumber(total);
}

/** Multiplies a paise rate by an area in sq ft (up to 2 decimals) and rounds half-up to paise. */
export function mulPaiseBySqft(ratePaise: number, sqft: number): number {
  assertPaise(ratePaise, "Rate");
  const sqftHundredths = scaleDecimal(sqft, 2, "Area");
  return bigIntToSafeNumber(divRoundHalfUp(BigInt(ratePaise) * sqftHundredths, 100n));
}
