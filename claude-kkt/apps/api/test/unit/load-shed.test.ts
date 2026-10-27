import { describe, expect, it } from "vitest";
import { inflightCap } from "../../src/plugins/loadShed.js";

describe("load shedding cap (plugins/loadShed.ts)", () => {
  it("is API_MAX_INFLIGHT normally (0 = no cap)", () => {
    expect(inflightCap(256, false)).toBe(256);
    expect(inflightCap(0, false)).toBe(0);
  });

  it("drops to a quarter under event-loop pressure, never below 8 and never above the normal cap, and always admits work", () => {
    expect(inflightCap(256, true)).toBe(64);
    expect(inflightCap(20, true)).toBe(8);
    expect(inflightCap(4, true)).toBe(4);
    expect(inflightCap(1, true)).toBe(1);
    // with the in-flight cap off, pressure still bounds concurrency (a quarter of 256) instead of refusing everything
    expect(inflightCap(0, true)).toBe(64);
    for (const limit of [0, 1, 2, 8, 64, 256, 10_000]) expect(inflightCap(limit, true)).toBeGreaterThan(0);
  });
});
