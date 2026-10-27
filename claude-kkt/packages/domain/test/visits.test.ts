import { describe, expect, it, vi } from "vitest";
import {
  availability,
  icsEscape,
  icsFold,
  icsForVisit,
  isVisitPast,
  slotKey,
  slotKeyForInstant,
  slotTimes,
  type VisitSettings,
} from "../src/index.js";

const settings: VisitSettings = {
  enabled: true,
  visitDays: [1, 2, 3, 4, 5, 6],
  startTime: "10:00",
  endTime: "17:00",
  slotMinutes: 60,
  seatsPerSlot: 3,
  minLeadHours: 2,
  maxDaysAhead: 14,
  blackoutDates: ["2026-10-27"],
};

// Saturday 24 Oct 2026, 11:30 IST
const now = "2026-10-24T11:30:00+05:30";

describe("slotTimes", () => {
  it("generates slots that fit between start and end", () => {
    expect(slotTimes("10:00", "12:00", 60)).toEqual([
      { start: "10:00", end: "11:00" },
      { start: "11:00", end: "12:00" },
    ]);
    expect(slotTimes("10:00", "11:30", 60)).toHaveLength(1);
    expect(slotTimes("10:00", "11:30", 30)).toHaveLength(3);
    expect(slotTimes("10:00", "11:00", 0)).toEqual([]);
  });
});

describe("availability", () => {
  it("drops past and lead-time slots today", () => {
    const days = availability({ settings, from: "2026-10-24", to: "2026-10-24", nowIST: now, bookedCounts: new Map() });
    expect(days).toHaveLength(1);
    // 11:30 + 2h lead = 13:30 → first slot 14:00
    expect(days[0]?.slots.map((s) => s.start)).toEqual(["14:00", "15:00", "16:00"]);
    expect(days[0]?.slots[0]).toEqual({ start: "14:00", end: "15:00", available: 3 });
  });
  it("skips non-visit days, blackouts, the past and beyond maxDaysAhead", () => {
    const days = availability({ settings, from: "2026-10-20", to: "2026-11-30", nowIST: now, bookedCounts: new Map() });
    const dates = days.map((d) => d.date);
    expect(dates[0]).toBe("2026-10-24");
    expect(dates).not.toContain("2026-10-23");
    expect(dates).not.toContain("2026-10-25"); // Sunday
    expect(dates).not.toContain("2026-11-01"); // Sunday
    expect(dates).not.toContain("2026-10-27"); // blackout
    expect(dates).toContain("2026-11-07"); // exactly 14 days ahead
    expect(dates).not.toContain("2026-11-08");
    expect(dates.at(-1)).toBe("2026-11-07");
    expect(days[1]?.slots).toHaveLength(7);
  });
  it("subtracts booked counts and hides full slots", () => {
    const booked = new Map([
      [slotKey("2026-10-26", "10:00"), 3],
      [slotKey("2026-10-26", "11:00"), 2],
      [slotKey("2026-10-26", "12:00"), 5],
    ]);
    const days = availability({ settings, from: "2026-10-26", to: "2026-10-26", nowIST: now, bookedCounts: booked });
    const slots = days[0]?.slots ?? [];
    expect(slots.map((s) => s.start)).toEqual(["13:00", "14:00", "15:00", "16:00", "11:00"].sort());
    expect(slots.find((s) => s.start === "11:00")?.available).toBe(1);
    expect(slots.every((s) => s.available > 0)).toBe(true);
  });
  it("omits days with no slots and returns nothing when disabled", () => {
    const allFull = new Map(slotTimes("10:00", "17:00", 60).map((t) => [slotKey("2026-10-26", t.start), 3] as const));
    expect(
      availability({ settings, from: "2026-10-26", to: "2026-10-26", nowIST: now, bookedCounts: allFull }),
    ).toEqual([]);
    expect(
      availability({
        settings: { ...settings, enabled: false },
        from: "2026-10-26",
        to: "2026-10-26",
        nowIST: now,
        bookedCounts: new Map(),
      }),
    ).toEqual([]);
    expect(
      availability({
        settings: { ...settings, maxDaysAhead: 0 },
        from: "2026-10-24",
        to: "2026-10-30",
        nowIST: now,
        bookedCounts: new Map(),
      }).map((d) => d.date),
    ).toEqual(["2026-10-24"]);
  });
  it("evaluates 'now' in IST regardless of the offset given", () => {
    const utcNow = "2026-10-24T06:00:00Z"; // 11:30 IST
    const a = availability({ settings, from: "2026-10-24", to: "2026-10-24", nowIST: utcNow, bookedCounts: new Map() });
    const b = availability({ settings, from: "2026-10-24", to: "2026-10-24", nowIST: now, bookedCounts: new Map() });
    expect(a).toEqual(b);
    // late evening IST: today has no slots; the date rolls correctly for a UTC instant
    const late = availability({
      settings,
      from: "2026-10-24",
      to: "2026-10-26",
      nowIST: "2026-10-24T18:45:00Z",
      bookedCounts: new Map(),
    });
    expect(late.map((d) => d.date)).toEqual(["2026-10-26"]);
  });
  it("30-minute slots", () => {
    const days = availability({
      settings: { ...settings, slotMinutes: 30 },
      from: "2026-10-26",
      to: "2026-10-26",
      nowIST: now,
      bookedCounts: new Map(),
    });
    expect(days[0]?.slots).toHaveLength(14);
    expect(days[0]?.slots[1]).toEqual({ start: "10:30", end: "11:00", available: 3 });
  });
});

describe("icsForVisit", () => {
  const ics = icsForVisit({
    uid: "SV-2526/0001@kkt",
    summary: "Site visit: Shree Ganesh Heights",
    description: "Visit number SV-2526/0001; 2 visitors, please carry ID",
    location: "Site office, Bailey Road, Patna",
    date: "2026-10-26",
    start: "10:00",
    end: "11:00",
    stamp: "2026-10-24T06:00:00Z",
    url: "https://www.example.com/visit/abc",
  });
  it("is a valid VCALENDAR in Asia/Kolkata with a VTIMEZONE and 1-hour alarm", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Asia/Kolkata");
    expect(ics).toContain("TZOFFSETFROM:+0530\r\nTZOFFSETTO:+0530");
    expect(ics).not.toContain("DAYLIGHT");
    expect(ics).toContain("DTSTART;TZID=Asia/Kolkata:20261026T100000");
    expect(ics).toContain("DTEND;TZID=Asia/Kolkata:20261026T110000");
    expect(ics).toContain("DTSTAMP:20261024T060000Z");
    expect(ics).toContain("BEGIN:VALARM\r\nACTION:DISPLAY");
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics).toContain("UID:SV-2526/0001@kkt");
    expect(ics).toContain("DESCRIPTION:Visit number SV-2526/0001\\; 2 visitors\\, please carry ID");
    expect(ics).toContain("URL:https://www.example.com/visit/abc");
    expect(
      ics
        .split("\r\n")
        .filter((l) => l.length > 0)
        .every((l) => new TextEncoder().encode(l).length <= 75),
    ).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it("escapes and folds", () => {
    expect(icsEscape("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const long = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = icsFold(long);
    expect(folded.split("\r\n")).toHaveLength(3);
    expect(folded.split("\r\n")[1]?.startsWith(" ")).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(icsFold("short")).toBe("short");
  });
  it("rejects bad dates/times", () => {
    expect(() =>
      icsForVisit({
        uid: "u",
        summary: "s",
        description: "",
        location: "",
        date: "2026-13-01",
        start: "10:00",
        end: "11:00",
      }),
    ).toThrow();
    expect(() =>
      icsForVisit({
        uid: "u",
        summary: "s",
        description: "",
        location: "",
        date: "2026-10-01",
        start: "10:60",
        end: "11:00",
      }),
    ).toThrow();
  });
});

describe("icsForVisit revisions (UID / SEQUENCE / DTSTAMP / METHOD)", () => {
  const base = {
    uid: "6f1c2a7e-0000-4000-8000-000000000001@kkt",
    summary: "Site visit: Shree Ganesh Heights",
    description: "Visit SV-2526/0001",
    location: "Bailey Road, Patna",
    date: "2026-10-30",
    start: "10:00",
    end: "11:00",
  };
  it("defaults to METHOD:REQUEST, SEQUENCE:0, STATUS:CONFIRMED with the reminder", () => {
    const ics = icsForVisit({ ...base, stamp: "2026-10-26T05:00:00Z" });
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).not.toContain("METHOD:PUBLISH");
    expect(ics).toContain(`UID:${base.uid}\r\nSEQUENCE:0\r\nDTSTAMP:20261026T050000Z\r\n`);
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("BEGIN:VALARM");
  });
  it("DTSTAMP is the generation time when no stamp is given (never the visit's start)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-27T08:09:10Z"));
      expect(icsForVisit(base)).toContain("DTSTAMP:20261027T080910Z");
    } finally {
      vi.useRealTimers();
    }
  });
  it("a reschedule keeps the UID and raises SEQUENCE", () => {
    const first = icsForVisit({ ...base, stamp: "2026-10-26T05:00:00Z" });
    const moved = icsForVisit({ ...base, start: "12:00", end: "13:00", sequence: 1, stamp: "2026-10-26T06:00:00Z" });
    const uid = (s: string) => /UID:(.*)\r\n/.exec(s)![1];
    expect(uid(moved)).toBe(uid(first));
    expect(moved).toContain("SEQUENCE:1");
    expect(moved).toContain("DTSTART;TZID=Asia/Kolkata:20261030T120000");
  });
  it("METHOD:CANCEL carries STATUS:CANCELLED and no reminder", () => {
    const ics = icsForVisit({ ...base, method: "CANCEL", sequence: 2, stamp: "2026-10-26T07:00:00Z" });
    expect(ics).toContain("METHOD:CANCEL\r\n");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).not.toContain("STATUS:CONFIRMED");
    expect(ics).not.toContain("VALARM");
    expect(ics.indexOf("STATUS:CANCELLED")).toBeLessThan(ics.indexOf("END:VEVENT"));
  });
  it("ORGANIZER / ATTENDEE are emitted (quoted CN, folded at 75 octets) and the sequence must be a non-negative integer", () => {
    const ics = icsForVisit({
      ...base,
      stamp: "2026-10-26T05:00:00Z",
      organizer: { name: "Shree Ganesh Builders", email: "sales@sgb.example" },
      attendee: { name: 'Rajesh "Raju" Kumar Sinha', email: "rajesh@example.com" },
    });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain('ORGANIZER;CN="Shree Ganesh Builders":mailto:sales@sgb.example');
    expect(unfolded).toContain(
      'ATTENDEE;CN="Rajesh  Raju  Kumar Sinha";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:rajesh@example.com',
    );
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(() => icsForVisit({ ...base, sequence: -1 })).toThrow(RangeError);
    expect(() => icsForVisit({ ...base, sequence: 1.5 })).toThrow(RangeError);
  });
  it("an e-mail that is not a plain address (line break, quotes, delimiters) is left out instead of injecting properties", () => {
    const ics = icsForVisit({
      ...base,
      stamp: "2026-10-26T05:00:00Z",
      organizer: { name: "Builder", email: "sales@sgb.example\r\nATTACH:https://evil.example/x" },
      attendee: { name: "Visitor", email: 'a"b@example.com' },
    });
    expect(ics).not.toContain("ORGANIZER");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).not.toContain("ATTACH");
    expect(ics).not.toContain("evil.example");
  });
});

describe("misc", () => {
  it("isVisitPast and slotKeyForInstant", () => {
    expect(isVisitPast("2026-10-24", "11:00", now)).toBe(true);
    expect(isVisitPast("2026-10-24", "12:00", now)).toBe(false);
    expect(slotKeyForInstant("2026-10-24T04:30:00Z")).toBe("2026-10-24|10:00");
  });
});
