import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatRelative, formatTime, instantToIstInput, istHour, istInputToInstant, toDateString } from "@/lib/format";
import { isoToLocal, localToIso } from "@/features/crm/LeadFormSheet";
import { isoToLocalInput, localInputToIso } from "@/features/cms/api";

/**
 * Instants are rendered in Asia/Kolkata whatever zone the browser runs in (audit H5). These tests force a non-IST zone: process.env.TZ
 * is applied by Node on assignment, and the first assertion proves the zone really changed.
 */
const zones = ["America/Los_Angeles", "UTC", "Pacific/Kiritimati"] as const;
let previousTz: string | undefined;

beforeAll(() => {
  previousTz = process.env.TZ;
});

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe.each(zones)("dates render in IST with the browser in %s", (zone) => {
  beforeAll(() => {
    process.env.TZ = zone;
  });

  it("the test really runs outside IST", () => {
    expect(new Date("2026-01-15T00:00:00Z").getTimezoneOffset()).not.toBe(-330);
  });

  it("formatDate puts an instant on its IST calendar day (00:30 IST is not the previous day; 23:30 IST is not the next day)", () => {
    // 2026-10-24 00:30 IST = 2026-10-23 19:00 UTC
    expect(formatDate("2026-10-23T19:00:00Z")).toBe("24 Oct 2026");
    expect(formatDate(new Date("2026-10-23T19:00:00Z"))).toBe("24 Oct 2026");
    // 2026-10-24 23:30 IST = 2026-10-24 18:00 UTC
    expect(formatDate("2026-10-24T18:00:00.000Z")).toBe("24 Oct 2026");
    expect(formatDate("2026-10-24T18:00:00Z", "dd MMM")).toBe("24 Oct");
    expect(formatDate("2026-10-24T18:00:00Z", "dd MMM yyyy, HH:mm")).toBe("24 Oct 2026, 23:30");
  });

  it("formatDate keeps business dates (YYYY-MM-DD) on their own day", () => {
    expect(formatDate("2026-10-24")).toBe("24 Oct 2026");
    expect(formatDate("2026-03-31", "dd MMM")).toBe("31 Mar");
    expect(formatDate("2026-01-01")).toBe("01 Jan 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });

  it("formatDateTime / formatTime / toDateString / istHour use the IST wall clock", () => {
    expect(formatDateTime("2026-10-23T19:00:00Z")).toBe("24 Oct 2026, 12:30 am");
    expect(formatDateTime("2026-10-23T19:00:00Z", { zone: true })).toBe("24 Oct 2026, 12:30 am IST");
    expect(formatTime("2026-10-24T10:15:00Z")).toBe("3:45 pm");
    expect(toDateString(new Date("2026-10-23T19:00:00Z"))).toBe("2026-10-24");
    expect(istHour(new Date("2026-10-23T19:00:00Z"))).toBe(0);
    expect(istHour(new Date("2026-10-24T10:15:00Z"))).toBe(15);
  });

  it("formatRelative falls back to the IST day", () => {
    expect(formatRelative("2026-10-01T19:00:00Z", new Date("2026-10-24T00:00:00Z"))).toBe("02 Oct 2026");
  });

  it("datetime-local inputs read and write the IST wall clock (lead follow-ups, CMS schedules)", () => {
    expect(instantToIstInput("2026-10-23T19:00:00Z")).toBe("2026-10-24T00:30");
    expect(istInputToInstant("2026-10-24T00:30")).toBe("2026-10-23T19:00:00.000Z");
    expect(istInputToInstant("2026-10-25T15:30")).toBe("2026-10-25T10:00:00.000Z");
    expect(istInputToInstant("")).toBeNull();
    expect(istInputToInstant("garbage")).toBeNull();
    expect(isoToLocal("2026-10-25T10:00:00Z")).toBe("2026-10-25T15:30");
    expect(localToIso("2026-10-25T15:30")).toBe("2026-10-25T10:00:00.000Z");
    expect(isoToLocalInput("2026-10-25T10:00:00Z")).toBe("2026-10-25T15:30");
    expect(localInputToIso("2026-10-25T15:30")).toBe("2026-10-25T10:00:00.000Z");
    // round trip
    expect(istInputToInstant(instantToIstInput("2026-03-08T21:45:00Z"))).toBe("2026-03-08T21:45:00.000Z");
  });
});
