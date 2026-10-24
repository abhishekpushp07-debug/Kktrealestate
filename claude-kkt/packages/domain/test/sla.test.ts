import { describe, expect, it } from "vitest";
import { ageingBucket, ageingBucketLabel, isSlaBreached, slaDueAt } from "../src/index.js";

describe("slaDueAt", () => {
  it("adds the priority's hours", () => {
    expect(slaDueAt("2026-10-24T06:00:00Z", "URGENT")).toBe("2026-10-24T14:00:00.000Z");
    expect(slaDueAt("2026-10-24T06:00:00Z", "HIGH")).toBe("2026-10-25T06:00:00.000Z");
    expect(slaDueAt("2026-10-24T06:00:00Z", "MEDIUM")).toBe("2026-10-26T06:00:00.000Z");
    expect(slaDueAt("2026-10-24T06:00:00Z", "LOW")).toBe("2026-10-27T06:00:00.000Z");
    expect(slaDueAt("2026-10-24T06:00:00Z", "LOW", { LOW: 1, MEDIUM: 1, HIGH: 1, URGENT: 0.5 })).toBe("2026-10-24T07:00:00.000Z");
    expect(() => slaDueAt("garbage", "LOW")).toThrow();
    expect(() => slaDueAt("2026-10-24T06:00:00Z", "LOW", { LOW: -1, MEDIUM: 1, HIGH: 1, URGENT: 1 })).toThrow();
  });
  it("detects breaches", () => {
    expect(isSlaBreached("2026-10-24T14:00:00Z", "2026-10-24T14:00:01Z", false)).toBe(true);
    expect(isSlaBreached("2026-10-24T14:00:00Z", "2026-10-24T14:00:00Z", false)).toBe(false);
    expect(isSlaBreached("2026-10-24T14:00:00Z", "2026-10-25T14:00:00Z", true)).toBe(false);
  });
});

describe("ageingBucket", () => {
  it("buckets by days overdue", () => {
    expect(ageingBucket("2026-10-25", "2026-10-24")).toBe("NOT_DUE");
    expect(ageingBucket("2026-10-24", "2026-10-24")).toBe("D0_30");
    expect(ageingBucket("2026-09-24", "2026-10-24")).toBe("D0_30");
    expect(ageingBucket("2026-09-23", "2026-10-24")).toBe("D31_60");
    expect(ageingBucket("2026-08-25", "2026-10-24")).toBe("D31_60");
    expect(ageingBucket("2026-08-24", "2026-10-24")).toBe("D61_90");
    expect(ageingBucket("2026-07-26", "2026-10-24")).toBe("D61_90");
    expect(ageingBucket("2026-07-25", "2026-10-24")).toBe("D90_PLUS");
    expect(ageingBucket("2020-01-01", "2026-10-24")).toBe("D90_PLUS");
    expect(() => ageingBucket("2026-1-1", "2026-10-24")).toThrow();
    expect(ageingBucketLabel("D90_PLUS")).toBe("90+ days");
    expect(ageingBucketLabel("NOT_DUE")).toBe("Not due");
  });
});
