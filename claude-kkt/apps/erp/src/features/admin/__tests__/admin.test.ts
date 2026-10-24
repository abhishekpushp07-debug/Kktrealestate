import { describe, expect, it } from "vitest";
import { isLocked, normalisePermissionCatalog } from "../adminApi";
import { diffSnapshots, entityHref, formatDiffValue } from "../auditDiff";
import { financialYearCode, renderNumber } from "../numbering";

describe("numbering preview", () => {
  it("derives the financial-year code from the start month", () => {
    expect(financialYearCode(new Date(2025, 9, 15), 4)).toBe("2526");
    expect(financialYearCode(new Date(2026, 1, 1), 4)).toBe("2526");
    expect(financialYearCode(new Date(2026, 3, 1), 4)).toBe("2627");
    expect(financialYearCode(new Date(2026, 9, 24), 1)).toBe("2627");
  });

  it("renders the default and custom formats", () => {
    expect(renderNumber("CUST-", undefined, "2526", 1)).toBe("CUST-2526/0001");
    expect(renderNumber("SGB/", "{prefix}{fy}/{seq:4}", "2526", 12)).toBe("SGB/2526/0012");
    expect(renderNumber("BK", "{prefix}-{seq:6}", "2526", 7)).toBe("BK-000007");
    expect(renderNumber("X", "{prefix}{seq}", "2526", 42)).toBe("X42");
  });
});

describe("audit diff", () => {
  it("classifies keys and puts changed ones first", () => {
    const rows = diffSnapshots({ name: "A", code: "X", gone: 1, nested: { a: 1 } }, { name: "B", code: "X", added: true, nested: { a: 1 } });
    expect(rows.map((row) => [row.key, row.status])).toEqual([
      ["name", "changed"],
      ["added", "added"],
      ["gone", "removed"],
      ["code", "same"],
      ["nested", "same"],
    ]);
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue(null)).toBe("null");
    expect(formatDiffValue("")).toBe('""');
  });

  it("links known entity types and ignores the rest", () => {
    expect(entityHref("booking", "abc")).toBe("/bookings/abc");
    expect(entityHref("SERVICE_REQUEST", "t1")).toBe("/service-requests/t1");
    expect(entityHref("ledger_row", "x")).toBeNull();
    expect(entityHref("booking", null)).toBeNull();
  });
});

describe("users helpers", () => {
  it("treats a future locked_until as locked", () => {
    const now = Date.parse("2026-10-24T10:00:00Z");
    expect(isLocked("2026-10-24T10:10:00Z", now)).toBe(true);
    expect(isLocked("2026-10-24T09:50:00Z", now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });

  it("accepts both catalog shapes and drops malformed entries", () => {
    const groups = normalisePermissionCatalog({ groups: [{ key: "a", label: "A", permissions: [{ code: "x.y", label: "X" }, { nope: true }] }, { bad: true }] });
    expect(groups).toEqual([{ key: "a", label: "A", permissions: [{ code: "x.y", label: "X" }] }]);
    expect(normalisePermissionCatalog([{ key: "b", label: "B", permissions: [] }])).toEqual([{ key: "b", label: "B", permissions: [] }]);
    expect(normalisePermissionCatalog("nope")).toBeNull();
  });
});
