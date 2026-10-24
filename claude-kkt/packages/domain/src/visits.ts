/**
 * Site-visit scheduling (SPEC §15): slot availability in IST and the iCalendar file for a confirmed visit.
 */
import { addDays, assertDateString, compareDates, dayOfWeek, eachDate } from "./dates.js";
import { formatClock, istDateTimeMs, istParts, parseClock, toEpochMs, toISTDateString } from "./ist.js";

export interface VisitSettings {
  enabled: boolean;
  /** Days of week with visits: 0 = Sunday … 6 = Saturday. */
  visitDays: readonly number[];
  /** "HH:mm" in IST. */
  startTime: string;
  endTime: string;
  slotMinutes: number;
  seatsPerSlot: number;
  minLeadHours: number;
  maxDaysAhead: number;
  blackoutDates: readonly string[];
}

export interface AvailabilityInput {
  settings: VisitSettings;
  from: string;
  to: string;
  /** Current instant; an RFC 3339 string (any offset, e.g. "+05:30") or a Date. */
  nowIST: string | Date;
  /** Non-cancelled visit counts keyed "YYYY-MM-DD|HH:mm". */
  bookedCounts: ReadonlyMap<string, number>;
}

export interface Slot {
  start: string;
  end: string;
  available: number;
}

export interface DayAvailability {
  date: string;
  slots: Slot[];
}

/** Key used for bookedCounts: "YYYY-MM-DD|HH:mm". */
export function slotKey(date: string, start: string): string {
  return `${date}|${start}`;
}

/** All slot start/end pairs between start and end time for a slot length, in "HH:mm". */
export function slotTimes(startTime: string, endTime: string, slotMinutes: number): { start: string; end: string }[] {
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    return [];
  }
  const start = parseClock(startTime);
  const end = parseClock(endTime);
  const out: { start: string; end: string }[] = [];
  for (let t = start; t + slotMinutes <= end; t += slotMinutes) {
    out.push({ start: formatClock(t), end: formatClock(t + slotMinutes) });
  }
  return out;
}

/** Available slots per date: skips non-visit days, blackouts, past/lead-time slots, dates beyond maxDaysAhead, full slots. */
export function availability(input: AvailabilityInput): DayAvailability[] {
  const { settings, bookedCounts } = input;
  assertDateString(input.from, "from");
  assertDateString(input.to, "to");
  if (!settings.enabled || settings.seatsPerSlot <= 0) {
    return [];
  }
  const nowMs = toEpochMs(input.nowIST);
  const today = toISTDateString(nowMs);
  const lastDate = addDays(today, Math.max(0, settings.maxDaysAhead));
  const earliestMs = nowMs + Math.max(0, settings.minLeadHours) * 3_600_000;
  const visitDays = new Set(settings.visitDays);
  const blackout = new Set(settings.blackoutDates);
  const times = slotTimes(settings.startTime, settings.endTime, settings.slotMinutes);
  const out: DayAvailability[] = [];
  for (const date of eachDate(input.from, input.to)) {
    if (compareDates(date, today) < 0 || compareDates(date, lastDate) > 0) {
      continue;
    }
    if (!visitDays.has(dayOfWeek(date)) || blackout.has(date)) {
      continue;
    }
    const slots: Slot[] = [];
    for (const time of times) {
      if (istDateTimeMs(date, time.start) < earliestMs) {
        continue;
      }
      const booked = bookedCounts.get(slotKey(date, time.start)) ?? 0;
      const available = settings.seatsPerSlot - booked;
      if (available > 0) {
        slots.push({ start: time.start, end: time.end, available });
      }
    }
    if (slots.length > 0) {
      out.push({ date, slots });
    }
  }
  return out;
}

export interface VisitICSInput {
  uid: string;
  summary: string;
  description: string;
  location: string;
  date: string;
  /** "HH:mm" IST. */
  start: string;
  end: string;
  /** Creation instant for DTSTAMP; defaults to the start instant. */
  stamp?: string | Date;
  url?: string | null;
}

/** Escapes text for an iCalendar property value. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets per RFC 5545 (continuation lines start with a space). */
export function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) {
    return line;
  }
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

/** Formats an IST date + "HH:mm" as a floating iCalendar local time "YYYYMMDDTHHmm00". */
function icsLocal(date: string, time: string): string {
  parseClock(time);
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

/** Formats an instant as an iCalendar UTC timestamp "YYYYMMDDTHHmmssZ". */
function icsUtc(instant: string | Date | number): string {
  return new Date(toEpochMs(instant)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** VTIMEZONE block for Asia/Kolkata (+05:30, no DST). */
export const IST_VTIMEZONE: readonly string[] = [
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Kolkata",
  "X-LIC-LOCATION:Asia/Kolkata",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0530",
  "TZOFFSETTO:+0530",
  "TZNAME:IST",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** Builds a valid VCALENDAR text for a site visit in Asia/Kolkata with a 1-hour-before reminder. */
export function icsForVisit(input: VisitICSInput): string {
  assertDateString(input.date, "date");
  const startMs = istDateTimeMs(input.date, input.start);
  const stamp = input.stamp ?? new Date(startMs);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KKT//Site Visit//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...IST_VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${icsEscape(input.uid)}`,
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART;TZID=Asia/Kolkata:${icsLocal(input.date, input.start)}`,
    `DTEND;TZID=Asia/Kolkata:${icsLocal(input.date, input.end)}`,
    `SUMMARY:${icsEscape(input.summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `LOCATION:${icsEscape(input.location)}`,
  ];
  if (input.url) {
    lines.push(`URL:${input.url}`);
  }
  lines.push(
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(`Reminder: ${input.summary}`)}`,
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

/** Whether a visit's start instant is already in the past for the given now. */
export function isVisitPast(date: string, start: string, now: string | Date): boolean {
  return istDateTimeMs(date, start) < toEpochMs(now);
}

/** IST wall-clock parts of an instant, re-exported for callers building slot keys from timestamps. */
export function slotKeyForInstant(instant: string | Date | number): string {
  const parts = istParts(instant);
  return slotKey(parts.date, formatClock(parts.hour * 60 + parts.minute));
}
