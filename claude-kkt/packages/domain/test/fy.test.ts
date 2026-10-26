import { describe, expect, it } from "vitest";
import {
  NumberingError,
  addDays,
  dayOfWeek,
  diffDays,
  eachDate,
  financialYear,
  financialYearAt,
  formatClock,
  formatNumber,
  isValidDateString,
  istDateTime,
  parseClock,
  parseFYLabel,
  parseNumber,
  toISTDateString,
  toISTISOString,
  toISTTimeString,
  todayIST,
} from "../src/index.js";

describe("financialYear", () => {
  it("computes the Indian FY", () => {
    expect(financialYear("2025-04-01")).toEqual({
      label: "2526",
      start: "2025-04-01",
      end: "2026-03-31",
      startYear: 2025,
      endYear: 2026,
    });
    expect(financialYear("2026-03-31").label).toBe("2526");
    expect(financialYear("2026-04-01").label).toBe("2627");
    expect(financialYear("2025-01-15").label).toBe("2425");
    expect(financialYear("2024-02-29").end).toBe("2024-03-31");
  });
  it("supports other start months", () => {
    expect(financialYear("2025-06-15", 1)).toEqual({
      label: "2525",
      start: "2025-01-01",
      end: "2025-12-31",
      startYear: 2025,
      endYear: 2025,
    });
    expect(financialYear("2025-06-15", 7)).toEqual({
      label: "2425",
      start: "2024-07-01",
      end: "2025-06-30",
      startYear: 2024,
      endYear: 2025,
    });
    expect(() => financialYear("2025-06-15", 13)).toThrow(NumberingError);
    expect(() => financialYear("2025-13-01")).toThrow();
  });
  it("parses labels", () => {
    expect(parseFYLabel("2526")).toEqual({ startYear: 2025, endYear: 2026 });
    expect(() => parseFYLabel("2527")).toThrow(NumberingError);
    expect(() => parseFYLabel("25")).toThrow(NumberingError);
  });
});

describe("formatNumber / parseNumber", () => {
  it("formats with the default pattern", () => {
    expect(formatNumber("CUST-", "2526", 1)).toBe("CUST-2526/0001");
    expect(formatNumber("SGB/", "2526", 1)).toBe("SGB/2526/0001");
    expect(formatNumber("BK-", "2526", 12345)).toBe("BK-2526/12345");
    expect(formatNumber("SR-", "2526", 7, "{prefix}{seq:6}")).toBe("SR-000007");
    expect(formatNumber("X", "2526", 7, "{prefix}/{fy}/{seq}")).toBe("X/2526/7");
    expect(() => formatNumber("X", "2526", -1)).toThrow(NumberingError);
    expect(() => formatNumber("X", "2526", 1, "{prefix}{fy}")).toThrow(NumberingError);
  });
  it("parses back", () => {
    expect(parseNumber("CUST-2526/0001")).toEqual({ prefix: "CUST-", fy: "2526", seq: 1 });
    expect(parseNumber("SGB/2526/0123")).toEqual({ prefix: "SGB/", fy: "2526", seq: 123 });
    expect(parseNumber("SR-000007", "{prefix}{seq:6}")).toEqual({ prefix: "SR-", fy: "", seq: 7 });
    expect(parseNumber("garbage")).toBe(null);
  });
});

describe("dates", () => {
  it("validates and does arithmetic", () => {
    expect(isValidDateString("2024-02-29")).toBe(true);
    expect(isValidDateString("2023-02-29")).toBe(false);
    expect(isValidDateString("2023-2-9")).toBe(false);
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(diffDays("2025-04-01", "2025-03-01")).toBe(31);
    expect(dayOfWeek("2026-10-24")).toBe(6);
    expect(eachDate("2026-01-30", "2026-02-01")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
    expect(eachDate("2026-02-01", "2026-01-30")).toEqual([]);
  });
});

describe("IST", () => {
  it("converts instants to IST dates and times", () => {
    expect(toISTDateString("2026-10-24T19:00:00Z")).toBe("2026-10-25");
    expect(toISTDateString("2026-10-24T18:29:59Z")).toBe("2026-10-24");
    expect(todayIST(new Date("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
    expect(toISTTimeString("2026-10-24T05:00:00Z")).toBe("10:30");
    expect(istDateTime("2026-10-24", "10:30")).toBe("2026-10-24T05:00:00.000Z");
    expect(istDateTime("2026-10-24", "00:00")).toBe("2026-10-23T18:30:00.000Z");
    expect(toISTISOString("2026-10-24T05:00:00Z")).toBe("2026-10-24T10:30:00+05:30");
    expect(parseClock("09:05")).toBe(545);
    expect(formatClock(545)).toBe("09:05");
    expect(() => parseClock("25:00")).toThrow();
    expect(() => istDateTime("bad", "10:00")).toThrow();
  });
  it("FY uses the IST date", () => {
    expect(financialYearAt("2026-03-31T18:30:00Z").label).toBe("2627");
    expect(financialYearAt("2026-03-31T18:29:59Z").label).toBe("2526");
  });
});
