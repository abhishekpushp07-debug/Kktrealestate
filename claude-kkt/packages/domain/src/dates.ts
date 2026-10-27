/**
 * Pure calendar-date helpers for business dates in "YYYY-MM-DD" form.
 * No time zones are involved here: a date string is treated as a plain calendar day.
 */

/** Error thrown for malformed business dates. */
export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateError";
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns true when the string is a real calendar date in YYYY-MM-DD form. */
export function isValidDateString(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) {
    return false;
  }
  return d <= daysInMonth(y, m);
}

/** Throws unless the value is a valid YYYY-MM-DD date; returns it unchanged. */
export function assertDateString(value: string, what = "date"): string {
  if (!isValidDateString(value)) {
    throw new DateError(`${what} "${value}" is not a valid YYYY-MM-DD date`);
  }
  return value;
}

/** Number of days in a month (1-12) of a given year. */
export function daysInMonth(year: number, month: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 31;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** Splits a YYYY-MM-DD string into numeric parts. */
export function dateParts(value: string): DateParts {
  assertDateString(value);
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
}

/** Builds a YYYY-MM-DD string from numeric parts. */
export function makeDateString(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days since 1970-01-01 for a calendar date (proleptic Gregorian). */
export function dateToEpochDays(value: string): number {
  const { year, month, day } = dateParts(value);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Calendar date for a number of days since 1970-01-01. */
export function epochDaysToDate(days: number): string {
  const d = new Date(days * 86_400_000);
  return makeDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD date. */
export function addDays(value: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new DateError(`days must be an integer, got ${String(days)}`);
  }
  return epochDaysToDate(dateToEpochDays(value) + days);
}

/** Signed difference in days: diffDays(a, b) = a − b. */
export function diffDays(a: string, b: string): number {
  return dateToEpochDays(a) - dateToEpochDays(b);
}

/** Compares two YYYY-MM-DD dates: negative, zero or positive. */
export function compareDates(a: string, b: string): number {
  assertDateString(a);
  assertDateString(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day of week for a YYYY-MM-DD date: 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: string): number {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Yields every date from `from` to `to` inclusive (empty when from > to). */
export function eachDate(from: string, to: string): string[] {
  const start = dateToEpochDays(from);
  const end = dateToEpochDays(to);
  const out: string[] = [];
  for (let d = start; d <= end; d += 1) {
    out.push(epochDaysToDate(d));
  }
  return out;
}

/** Formats a YYYY-MM-DD date as "24 Oct 2026" for labels. */
export function formatDateLabel(value: string): string {
  const { year, month, day } = dateParts(value);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1] ?? ""} ${year}`;
}
