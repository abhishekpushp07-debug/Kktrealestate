/**
 * The one INR formatter every surface uses (ERP, customer portal, website); the API's receipts and PDFs use
 * packages/domain money.ts, which runs the same algorithm (a cross-surface golden test pins all of them together).
 *
 * SPEC: "INR with Indian grouping (₹1,00,00,000) and short forms (₹1.2 Cr, ₹45 L). All money stored as integer paise."
 *
 * - Input is integer paise as a number or a bigint. Arithmetic is BigInt, so amounts beyond 2^53 paise never lose digits.
 *   A non-integer number (a computed average, say) is rounded half away from zero to whole paise first.
 * - Short forms have exactly two units, Cr and L, with at most one decimal (half-up). Rounding happens first and the unit is
 *   promoted afterwards, so ₹99,96,000 (99.96 L → "100 L") is "₹1 Cr" and ₹99,999.50 is "₹1 L". Below one lakh the short form
 *   is the full rupee amount ("₹12,500"); there is no "K" unit.
 * - Negatives print a hyphen-minus before the symbol: "-₹4 L", "-₹1,000".
 */

export type PaiseInput = number | bigint;

const CRORE_PAISE = 1_00_00_000n * 100n;
const LAKH_PAISE = 1_00_000n * 100n;

/** Whole paise as a bigint; rounds a fractional number half away from zero. Throws RangeError on NaN / ±Infinity. */
export function paiseToBigInt(paise: PaiseInput): bigint {
  if (typeof paise === "bigint") return paise;
  if (!Number.isFinite(paise)) throw new RangeError(`Amount must be a finite number of paise, got ${String(paise)}`);
  if (Number.isInteger(paise)) return BigInt(paise);
  const rounded = paise < 0 ? -Math.round(-paise) : Math.round(paise);
  return BigInt(rounded);
}

/** Divides by a positive bigint rounding half away from zero (commercial half-up, like packages/domain divRoundHalfUp). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** Groups an integer digit string the Indian way (3, then 2s): "10000000" → "1,00,00,000". Non-digits are dropped. */
export function groupIndian(digits: string): string {
  const clean = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (clean.length <= 3) return clean;
  const last3 = clean.slice(-3);
  const rest = clean.slice(0, -3);
  const groups: string[] = [];
  for (let i = rest.length; i > 0; i -= 2) groups.unshift(rest.slice(Math.max(0, i - 2), i));
  return `${groups.join(",")},${last3}`;
}

export interface InrFormatOptions {
  /** "auto" shows paise only when non-zero (default), "always" shows two decimals, "never" rounds half-up to rupees. */
  paise?: "auto" | "always" | "never";
  /** Include the ₹ symbol (default true). */
  symbol?: boolean;
  /** Prefix "+" on positive amounts (deltas). Zero and negatives are unaffected. */
  signed?: boolean;
}

function signOf(value: bigint, signed: boolean | undefined): string {
  if (value < 0n) return "-";
  return signed && value > 0n ? "+" : "";
}

/** Full Indian form: 1,00,00,000_00 paise → "₹1,00,00,000"; 12,50,000_50 → "₹12,50,000.50"; -1,000_00 → "-₹1,000". */
export function formatInr(paise: PaiseInput, options: InrFormatOptions = {}): string {
  const value = paiseToBigInt(paise);
  const mode = options.paise ?? "auto";
  const symbol = options.symbol === false ? "" : "₹";
  let abs = value < 0n ? -value : value;
  if (mode === "never") abs = divRoundHalfUp(abs, 100n) * 100n;
  const rupees = abs / 100n;
  const p = abs % 100n;
  const showPaise = mode === "always" || (mode === "auto" && p !== 0n);
  const body = groupIndian(rupees.toString()) + (showPaise ? `.${p.toString().padStart(2, "0")}` : "");
  // An amount shown as zero carries no sign ("₹0", never "-₹0").
  return `${abs === 0n ? "" : signOf(value, options.signed)}${symbol}${body}`;
}

/** Scales to a unit and renders with at most one decimal (half-up), trimming ".0". */
function shortUnit(absPaise: bigint, unitPaise: bigint): string {
  const tenths = divRoundHalfUp(absPaise * 10n, unitPaise);
  const whole = tenths / 10n;
  const tenth = tenths % 10n;
  return tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
}

export interface InrShortOptions {
  /** Include the ₹ symbol (default true). */
  symbol?: boolean;
  /** Prefix "+" on positive amounts. */
  signed?: boolean;
}

/** Short Indian form: "₹1.2 Cr", "₹45 L", "₹1 Cr" for ₹99,96,000, "₹12,500" below a lakh (rounded to rupees). */
export function formatInrShort(paise: PaiseInput, options: InrShortOptions = {}): string {
  const value = paiseToBigInt(paise);
  const abs = value < 0n ? -value : value;
  const symbol = options.symbol === false ? "" : "₹";
  let body: string;
  if (abs >= CRORE_PAISE) {
    body = `${shortUnit(abs, CRORE_PAISE)} Cr`;
  } else if (abs >= LAKH_PAISE) {
    const text = shortUnit(abs, LAKH_PAISE);
    body = text === "100" ? "1 Cr" : `${text} L`;
  } else {
    const rupees = divRoundHalfUp(abs, 100n);
    body = rupees === 1_00_000n ? "1 L" : groupIndian(rupees.toString());
  }
  // A value that rounds to ₹0 prints without a sign ("₹0", never "-₹0").
  const zero = body === "0";
  return `${zero ? "" : signOf(value, options.signed)}${symbol}${body}`;
}

/** One row of the cross-surface golden table: paise → the full and short forms every surface must print. */
export interface InrGoldenCase {
  paise: number;
  full: string;
  short: string;
}

/**
 * Golden table: the ERP, the portal, the website and packages/domain are all tested against these rows
 * (apps/erp/src/lib/__tests__/money-golden.test.ts). Change a row only together with the SPEC.
 */
export const INR_GOLDEN_CASES: readonly InrGoldenCase[] = [
  { paise: 0, full: "₹0", short: "₹0" },
  { paise: 1, full: "₹0.01", short: "₹0" },
  { paise: 49, full: "₹0.49", short: "₹0" },
  { paise: 50, full: "₹0.50", short: "₹1" },
  { paise: 99_999, full: "₹999.99", short: "₹1,000" },
  { paise: 1_000_00, full: "₹1,000", short: "₹1,000" },
  { paise: 12_500_00, full: "₹12,500", short: "₹12,500" },
  { paise: 85_000_00, full: "₹85,000", short: "₹85,000" },
  { paise: 99_999_49, full: "₹99,999.49", short: "₹99,999" },
  { paise: 99_999_50, full: "₹99,999.50", short: "₹1 L" },
  { paise: 1_00_000_00, full: "₹1,00,000", short: "₹1 L" },
  { paise: 1_04_999_00, full: "₹1,04,999", short: "₹1 L" },
  { paise: 1_05_000_00, full: "₹1,05,000", short: "₹1.1 L" },
  { paise: 45_00_000_00, full: "₹45,00,000", short: "₹45 L" },
  { paise: 45_50_000_00, full: "₹45,50,000", short: "₹45.5 L" },
  { paise: 12_50_000_50, full: "₹12,50,000.50", short: "₹12.5 L" },
  { paise: 99_94_999_00, full: "₹99,94,999", short: "₹99.9 L" },
  { paise: 99_95_000_00, full: "₹99,95,000", short: "₹1 Cr" },
  { paise: 99_96_000_00, full: "₹99,96,000", short: "₹1 Cr" },
  { paise: 99_99_999_99, full: "₹99,99,999.99", short: "₹1 Cr" },
  { paise: 1_00_00_000_00, full: "₹1,00,00,000", short: "₹1 Cr" },
  { paise: 1_04_99_999_00, full: "₹1,04,99,999", short: "₹1 Cr" },
  { paise: 1_05_00_000_00, full: "₹1,05,00,000", short: "₹1.1 Cr" },
  { paise: 1_20_00_000_00, full: "₹1,20,00,000", short: "₹1.2 Cr" },
  { paise: 1_25_00_000_00, full: "₹1,25,00,000", short: "₹1.3 Cr" },
  { paise: 1_00_00_00_000_00, full: "₹1,00,00,00,000", short: "₹100 Cr" },
  { paise: 12_34_56_78_901_23, full: "₹12,34,56,78,901.23", short: "₹1234.6 Cr" },
  { paise: -1_000_00, full: "-₹1,000", short: "-₹1,000" },
  { paise: -4_00_000_00, full: "-₹4,00,000", short: "-₹4 L" },
  { paise: -99_96_000_00, full: "-₹99,96,000", short: "-₹1 Cr" },
  { paise: -1_20_00_000_00, full: "-₹1,20,00,000", short: "-₹1.2 Cr" },
  { paise: -49, full: "-₹0.49", short: "₹0" },
  { paise: Number.MAX_SAFE_INTEGER, full: "₹9,00,71,99,25,47,409.91", short: "₹9007199.3 Cr" },
];
