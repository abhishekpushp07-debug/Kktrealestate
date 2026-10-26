import { format as dfFormat, isValid, parseISO } from "date-fns";

/* ------------------------------------------------------------------ */
/* Indian number grouping                                               */
/* ------------------------------------------------------------------ */

/** "12500000" → "1,25,00,000" (Indian 3-2-2 grouping of an integer digit string). */
export function groupIndian(digits: string): string {
  const clean = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (clean.length <= 3) return clean;
  const last3 = clean.slice(-3);
  let rest = clean.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${groups.join(",")},${last3}`;
}

/** Indian-grouped plain number (counts, areas). */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toFixed(decimals);
  const [int = "0", frac] = fixed.split(".");
  return sign + groupIndian(int) + (frac ? `.${frac}` : "");
}

/** "1,450 sq.ft." */
export function formatSqft(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const dp = Number.isInteger(value) ? 0 : 2;
  return `${formatNumber(value, dp)} sq.ft.`;
}

/* ------------------------------------------------------------------ */
/* Money (integer paise on the wire)                                    */
/* ------------------------------------------------------------------ */

export interface FormatINROptions {
  /** auto = show paise only when non-zero (default); always / never force it. */
  decimals?: "auto" | "always" | "never";
  /** Prefix a "+" for positive amounts (deltas). */
  signed?: boolean;
  /** Omit the ₹ symbol. */
  bare?: boolean;
}

/** 1_00_00_000_00 paise → "₹1,00,00,000"; 12_50_000_50 → "₹12,50,000.50". */
export function formatINR(paise: number | null | undefined, options: FormatINROptions = {}): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "—";
  const { decimals = "auto", signed = false, bare = false } = options;
  const rounded = Math.round(paise);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  let text = groupIndian(String(rupees));
  if (decimals === "always" || (decimals === "auto" && p !== 0)) {
    text += `.${String(p).padStart(2, "0")}`;
  }
  const symbol = bare ? "" : "₹";
  const sign = negative ? "-" : signed && rounded > 0 ? "+" : "";
  return `${sign}${symbol}${text}`;
}

function trimZeros(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** 1_20_00_000_00 → "₹1.2 Cr"; 45_00_000_00 → "₹45 L"; 85_000_00 → "₹85,000". */
export function formatINRShort(paise: number | null | undefined, options: { bare?: boolean } = {}): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "—";
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const symbol = options.bare ? "" : "₹";
  const sign = negative ? "-" : "";
  const lakhs = Math.round((rupees / 1e5) * 10) / 10;
  if (rupees >= 1e7 || lakhs >= 100) {
    const crores = Math.round((rupees / 1e7) * 100) / 100;
    return `${sign}${symbol}${trimZeros(crores.toFixed(2))} Cr`;
  }
  if (rupees >= 1e5) {
    return `${sign}${symbol}${trimZeros(lakhs.toFixed(1))} L`;
  }
  return `${sign}${symbol}${groupIndian(String(Math.round(rupees)))}`;
}

/** Paise → text for a rupee input: "12,50,000.50" / "12,50,000" (empty for null). */
export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "";
  const rounded = Math.round(paise);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const text = groupIndian(String(rupees)) + (p ? `.${String(p).padStart(2, "0")}` : "");
  return (negative ? "-" : "") + text;
}

const SUFFIX_MULTIPLIERS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(cr|crore|crores)$/i, 1e7],
  [/^(l|lac|lacs|lakh|lakhs)$/i, 1e5],
  [/^(k|thousand)$/i, 1e3],
];

/**
 * Rupee text typed by a user → integer paise. Accepts Indian grouping, a ₹ prefix, up to two
 * decimals and shorthand suffixes ("45L", "1.2 Cr", "50k"). Returns null when not parseable.
 */
export function rupeesInputToPaise(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let text = input.replace(/[₹,\s]/g, "").trim();
  if (text === "" || text === "-" || text === ".") return null;
  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  const match = /^(\d*)(?:\.(\d*))?([a-zA-Z]*)$/.exec(text);
  if (!match) return null;
  const intPart = match[1] ?? "";
  const fracPart = match[2] ?? "";
  const suffix = match[3] ?? "";
  if (intPart === "" && fracPart === "") return null;
  let paise: number;
  if (suffix) {
    const multiplier = SUFFIX_MULTIPLIERS.find(([re]) => re.test(suffix))?.[1];
    if (multiplier === undefined) return null;
    const rupees = Number(`${intPart || "0"}.${fracPart || "0"}`);
    paise = Math.round(rupees * multiplier * 100);
  } else {
    const frac2 = (fracPart + "00").slice(0, 2);
    paise = Number(intPart || "0") * 100 + Number(frac2);
  }
  if (!Number.isSafeInteger(paise)) return null;
  return negative ? -paise : paise;
}

/* ------------------------------------------------------------------ */
/* Amount in words (Indian system)                                      */
/* ------------------------------------------------------------------ */

const ONES = [
  "",
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
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = TENS[Math.floor(n / 10)] ?? "";
  const o = ONES[n % 10] ?? "";
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h] ?? ""} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Whole number → Indian words ("Twelve Lakh Fifty Thousand"). */
export function numberToWordsIndian(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`);
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}

/** 12_50_000_00 → "Rupees Twelve Lakh Fifty Thousand Only". */
export function amountInWords(paise: number): string {
  if (!Number.isFinite(paise)) return "";
  const rounded = Math.round(paise);
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const prefix = rounded < 0 ? "Minus Rupees" : "Rupees";
  const rupeeWords = numberToWordsIndian(rupees);
  const paiseWords = p ? ` and ${twoDigits(p)} Paise` : "";
  return `${prefix} ${rupeeWords}${paiseWords} Only`;
}

/* ------------------------------------------------------------------ */
/* Percent                                                              */
/* ------------------------------------------------------------------ */

/** 12.5 → "12.5%"; 10 → "10%"; max two decimals. */
export function formatPercent(value: number | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${trimZeros(value.toFixed(maxDecimals))}%`;
}

/* ------------------------------------------------------------------ */
/* Dates (business dates are YYYY-MM-DD; events are RFC 3339 UTC)        */
/* ------------------------------------------------------------------ */

export const IST_TIME_ZONE = "Asia/Kolkata";

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const istParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Wall-clock fields of an instant in IST (independent of the browser's zone). */
export function istWallClock(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = istParts.formatToParts(date);
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(pick(parts, type));
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour") % 24,
    minute: n("minute"),
    second: n("second"),
  };
}

/**
 * A browser-local Date whose local fields equal the value's IST wall clock, for date-fns patterns (which format in the local zone).
 * Business dates (YYYY-MM-DD) keep their calendar day as-is; instants are converted to IST first.
 */
function istLocalDate(value: string | Date | null | undefined): Date | null {
  if (typeof value === "string") {
    const m = BUSINESS_DATE.exec(value);
    if (m) {
      const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
      return isValid(local) ? local : null;
    }
  }
  const date = toDate(value);
  if (!date) return null;
  const w = istWallClock(date);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * "2026-10-24" → "24 Oct 2026". Instants (RFC 3339 / Date) are shown on their IST calendar day whatever the browser's zone, so a
 * payment posted at 00:30 IST never shows as the previous day on a laptop set to UTC.
 * Use it for the calendar day; times of day go through formatDateTime / formatTime (Intl with timeZone, exact in every browser zone —
 * a time-of-day pattern here could land in the browser's own daylight-saving gap).
 */
export function formatDate(value: string | Date | null | undefined, pattern = "dd MMM yyyy"): string {
  const date = istLocalDate(value);
  return date ? dfFormat(date, pattern) : "—";
}

const istDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** RFC 3339 instant → "24 Oct 2026, 3:45 pm" in IST (append " IST" with `{ zone: true }`). */
export function formatDateTime(value: string | Date | null | undefined, options: { zone?: boolean } = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  const parts = istDateTime.formatToParts(date);
  const text = `${pick(parts, "day")} ${pick(parts, "month")} ${pick(parts, "year")}, ${pick(parts, "hour")}:${pick(parts, "minute")} ${pick(parts, "dayPeriod").toLowerCase()}`;
  return options.zone ? `${text} IST` : text;
}

/** RFC 3339 instant → "3:45 pm" in IST. */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  const parts = istTime.formatToParts(date);
  return `${pick(parts, "hour")}:${pick(parts, "minute")} ${pick(parts, "dayPeriod").toLowerCase()}`;
}

/** Today's business date (IST) as YYYY-MM-DD. */
export function todayIST(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${pick(parts, "year")}-${pick(parts, "month")}-${pick(parts, "day")}`;
}

/** Date → YYYY-MM-DD on its IST calendar day. */
export function toDateString(date: Date): string {
  const w = istWallClock(date);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Current hour (0–23) in IST. */
export function istHour(now: Date = new Date()): number {
  return istWallClock(now).hour;
}

/** RFC 3339 instant → `datetime-local` input value ("2026-10-25T15:30") on the IST wall clock. */
export function instantToIstInput(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const w = istWallClock(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** `datetime-local` input value read as IST wall-clock time → RFC 3339 instant (UTC), or null. */
export function istInputToInstant(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value ?? "");
  if (!m) return null;
  // IST is UTC+05:30 all year (no daylight saving)
  const utc =
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) -
    330 * 60_000;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Short relative time: "just now", "5 min ago", "3 h ago", "2 d ago", else "24 Oct 2026". */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "—";
  const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 45) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(date);
}

/** Masks a 10-digit phone for compact display: "98XXXXXX21". */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : phone;
}
