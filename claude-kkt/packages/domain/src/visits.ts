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
  /** DTSTAMP: the instant the file is generated (RFC 5545); defaults to now. */
  stamp?: string | Date;
  url?: string | null;
  /**
   * SEQUENCE (RFC 5545 §3.8.7.4): the revision of the event. A calendar client replaces the event it holds under the same UID only when
   * the sequence is higher, so it must grow with every reschedule / cancellation (site_visits.ics_sequence). Defaults to 0.
   */
  sequence?: number;
  /** "REQUEST" (default: new or updated visit) or "CANCEL" (METHOD:CANCEL + STATUS:CANCELLED, no reminder). */
  method?: "REQUEST" | "CANCEL";
  /** ORGANIZER (iTIP REQUEST/CANCEL carry one): the builder's address. */
  organizer?: { name: string; email: string } | null;
  /** ATTENDEE: the visitor, when an e-mail address is known. */
  attendee?: { name: string; email: string } | null;
}

/** Escapes text for an iCalendar property value. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
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
  return new Date(toEpochMs(instant))
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
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

/** Quotes a CN parameter value (RFC 5545 §3.2: DQUOTE-delimited, no DQUOTE / control characters inside). */
function icsParam(text: string): string {
  return `"${text.replace(/["\r\n\\]/g, " ").trim()}"`;
}

/**
 * Builds a VCALENDAR text for a site visit in Asia/Kolkata. The UID is stable per visit, SEQUENCE is the visit's revision and DTSTAMP the
 * generation time, so a calendar client updates (METHOD:REQUEST) or removes (METHOD:CANCEL, STATUS:CANCELLED) the event it imported
 * earlier instead of adding a duplicate. A REQUEST carries a 1-hour-before reminder.
 */
export function icsForVisit(input: VisitICSInput): string {
  assertDateString(input.date, "date");
  istDateTimeMs(input.date, input.start);
  const sequence = input.sequence ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) throw new RangeError(`Invalid SEQUENCE ${String(sequence)}`);
  const cancel = input.method === "CANCEL";
  const stamp = input.stamp ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KKT//Site Visit//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "REQUEST"}`,
    ...IST_VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${icsEscape(input.uid)}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART;TZID=Asia/Kolkata:${icsLocal(input.date, input.start)}`,
    `DTEND;TZID=Asia/Kolkata:${icsLocal(input.date, input.end)}`,
    `SUMMARY:${icsEscape(input.summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `LOCATION:${icsEscape(input.location)}`,
  ];
  if (input.organizer) lines.push(`ORGANIZER;CN=${icsParam(input.organizer.name)}:mailto:${input.organizer.email}`);
  if (input.attendee)
    lines.push(
      `ATTENDEE;CN=${icsParam(input.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=${cancel ? "DECLINED" : "ACCEPTED"}:mailto:${input.attendee.email}`,
    );
  if (input.url) {
    lines.push(`URL:${input.url}`);
  }
  lines.push(`STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`);
  if (!cancel)
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(`Reminder: ${input.summary}`)}`,
      "TRIGGER:-PT1H",
      "END:VALARM",
    );
  lines.push("END:VEVENT", "END:VCALENDAR");
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
