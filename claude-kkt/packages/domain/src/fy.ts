/**
 * Financial-year arithmetic and document numbering (CUST-2526/0001, SGB/2526/0001).
 */
import { assertDateString, daysInMonth, makeDateString } from "./dates.js";

/** Error thrown for invalid FY inputs or number patterns. */
export class NumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberingError";
  }
}

export interface FinancialYear {
  /** Two-digit start year + two-digit end year, e.g. "2526". */
  label: string;
  /** First day of the FY (YYYY-MM-DD). */
  start: string;
  /** Last day of the FY (YYYY-MM-DD). */
  end: string;
  startYear: number;
  endYear: number;
}

/** Validates a financial-year start month (1-12). */
function assertStartMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new NumberingError(`fyStartMonth must be 1-12, got ${String(month)}`);
  }
}

/** Two-digit year suffix, e.g. 2025 → "25". */
function yy(year: number): string {
  return String(((year % 100) + 100) % 100).padStart(2, "0");
}

/** Financial year containing a business date; Indian default starts in April ("2526" = Apr 2025–Mar 2026). */
export function financialYear(date: string, fyStartMonth = 4): FinancialYear {
  assertDateString(date);
  assertStartMonth(fyStartMonth);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= fyStartMonth ? year : year - 1;
  const endYear = fyStartMonth === 1 ? startYear : startYear + 1;
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
  return {
    label: `${yy(startYear)}${yy(endYear)}`,
    start: makeDateString(startYear, fyStartMonth, 1),
    end: makeDateString(endYear, endMonth, daysInMonth(endYear, endMonth)),
    startYear,
    endYear,
  };
}

/** Parses an FY label like "2526" into its start and end years (assumes the 2000s). */
export function parseFYLabel(label: string): { startYear: number; endYear: number } {
  if (!/^\d{4}$/.test(label)) {
    throw new NumberingError(`Invalid FY label "${label}"`);
  }
  const startYear = 2000 + Number(label.slice(0, 2));
  const endYear = 2000 + Number(label.slice(2, 4));
  if (endYear !== startYear && endYear !== startYear + 1) {
    throw new NumberingError(`FY label "${label}" is not consecutive`);
  }
  return { startYear, endYear };
}

/** Default numbering pattern: prefix, FY label, slash, 4-digit sequence. */
export const DEFAULT_NUMBER_PATTERN = "{prefix}{fy}/{seq:4}";

const TOKEN = /\{(prefix|fy|seq)(?::(\d+))?\}/g;

/** Formats a document number from a pattern: formatNumber("CUST-", "2526", 1) → "CUST-2526/0001". */
export function formatNumber(prefix: string, fyLabel: string, seq: number, pattern = DEFAULT_NUMBER_PATTERN): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new NumberingError(`seq must be a non-negative integer, got ${String(seq)}`);
  }
  if (!/\{seq(?::\d+)?\}/.test(pattern)) {
    throw new NumberingError(`Pattern "${pattern}" has no {seq} token`);
  }
  return pattern.replace(TOKEN, (_whole, name: string, width?: string) => {
    switch (name) {
      case "prefix":
        return prefix;
      case "fy":
        return fyLabel;
      case "seq":
        return width ? String(seq).padStart(Number(width), "0") : String(seq);
      default:
        return "";
    }
  });
}

export interface ParsedNumber {
  prefix: string;
  fy: string;
  seq: number;
}

/** Escapes a string for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parses a formatted number back into prefix, FY and sequence according to its pattern; null when it does not match. */
export function parseNumber(formatted: string, pattern = DEFAULT_NUMBER_PATTERN): ParsedNumber | null {
  const names: string[] = [];
  let regexSource = "^";
  let last = 0;
  for (const match of pattern.matchAll(TOKEN)) {
    regexSource += escapeRegExp(pattern.slice(last, match.index));
    const name = match[1] ?? "";
    const width = match[2];
    names.push(name);
    switch (name) {
      case "prefix":
        regexSource += "(.*?)";
        break;
      case "fy":
        regexSource += "(\\d{4})";
        break;
      case "seq":
        regexSource += width ? `(\\d{${width},})` : "(\\d+)";
        break;
      default:
        break;
    }
    last = match.index + match[0].length;
  }
  regexSource += `${escapeRegExp(pattern.slice(last))}$`;
  const result = new RegExp(regexSource).exec(formatted);
  if (!result) {
    return null;
  }
  const parsed: ParsedNumber = { prefix: "", fy: "", seq: 0 };
  names.forEach((name, index) => {
    const value = result[index + 1] ?? "";
    switch (name) {
      case "prefix":
        parsed.prefix = value;
        break;
      case "fy":
        parsed.fy = value;
        break;
      case "seq":
        parsed.seq = Number(value);
        break;
      default:
        break;
    }
  });
  return parsed;
}
