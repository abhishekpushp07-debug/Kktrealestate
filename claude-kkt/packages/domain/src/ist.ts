/**
 * India Standard Time helpers. IST is UTC+05:30 with no daylight saving, so all conversions
 * are fixed-offset arithmetic. Instants are RFC 3339 strings or Date objects; business dates are YYYY-MM-DD.
 */
import { assertDateString, makeDateString } from "./dates.js";
import { financialYear, type FinancialYear } from "./fy.js";

/** IST offset from UTC in minutes. */
export const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** Error thrown for invalid instants or clock strings. */
export class ISTError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ISTError";
  }
}

/** Converts a Date, epoch milliseconds or ISO string to epoch milliseconds, validating it. */
export function toEpochMs(instant: Date | string | number): number {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) {
    throw new ISTError(`Invalid instant: ${String(instant)}`);
  }
  return ms;
}

export interface ISTParts {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

/** Breaks an instant into its IST wall-clock parts. */
export function istParts(instant: Date | string | number): ISTParts {
  const shifted = new Date(toEpochMs(instant) + IST_OFFSET_MS);
  return {
    date: makeDateString(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export function toISTDateString(instant: Date | string | number): string {
  return istParts(instant).date;
}

/** Today's date in IST for a given "now" (defaults to the current time). */
export function todayIST(now: Date | string | number = new Date()): string {
  return toISTDateString(now);
}

/** The IST wall-clock time "HH:mm" of an instant. */
export function toISTTimeString(instant: Date | string | number): string {
  const { hour, minute } = istParts(instant);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Parses "HH:mm" (or "HH:mm:ss") into minutes since midnight. */
export function parseClock(time: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) {
    throw new ISTError(`Invalid clock time "${time}", expected HH:mm`);
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) {
    throw new ISTError(`Invalid clock time "${time}"`);
  }
  return h * 60 + m;
}

/** Formats minutes since midnight as "HH:mm". */
export function formatClock(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Epoch milliseconds of an IST date + "HH:mm" wall-clock time. */
export function istDateTimeMs(date: string, time: string): number {
  assertDateString(date);
  const minutes = parseClock(time);
  const dayMs = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return dayMs + minutes * 60_000 - IST_OFFSET_MS;
}

/** Converts an IST date + "HH:mm" to a UTC RFC 3339 string, e.g. ("2026-10-24","10:30") → "2026-10-24T05:00:00.000Z". */
export function istDateTime(date: string, time: string): string {
  return new Date(istDateTimeMs(date, time)).toISOString();
}

/** Formats an instant as an RFC 3339 string with the +05:30 offset, e.g. "2026-10-24T10:30:00+05:30". */
export function toISTISOString(instant: Date | string | number): string {
  const { date, hour, minute, second } = istParts(instant);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  return `${date}T${hh}:${mm}:${ss}+05:30`;
}

/** The financial year that contains an instant, evaluated on its IST calendar date. */
export function financialYearAt(instant: Date | string | number, fyStartMonth = 4): FinancialYear {
  return financialYear(toISTDateString(instant), fyStartMonth);
}
