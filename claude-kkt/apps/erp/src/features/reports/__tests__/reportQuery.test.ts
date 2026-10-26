import { describe, expect, it } from "vitest";
import {
  buildReportQuery,
  datePresetRange,
  matchDatePreset,
  missingRequired,
  pickReportParams,
  presetToParams,
  type FilterDef,
} from "../reportQuery";

const TODAY = "2026-10-25"; // a Sunday

const COLLECTIONS: readonly FilterDef[] = [
  { kind: "dateRange", required: true },
  {
    kind: "enum",
    key: "group_by",
    label: "Group by",
    options: [
      { value: "DAY", label: "Daily" },
      { value: "WEEK", label: "Weekly" },
      { value: "MONTH", label: "Monthly" },
    ],
    defaultValue: "DAY",
  },
  { kind: "project" },
  { kind: "block" },
  {
    kind: "enum",
    key: "mode_code",
    label: "Mode",
    options: [
      { value: "CASH", label: "Cash" },
      { value: "UPI", label: "UPI" },
    ],
    clearable: true,
  },
  {
    kind: "enum",
    key: "status",
    label: "Status",
    options: [
      { value: "CLEARED", label: "Cleared" },
      { value: "PENDING", label: "Pending" },
    ],
    defaultValue: "CLEARED",
  },
];

describe("datePresetRange", () => {
  it("computes Indian FY, month, quarter and week ranges", () => {
    expect(datePresetRange("this_fy", TODAY)).toEqual({ from: "2026-04-01", to: TODAY });
    expect(datePresetRange("this_fy", "2026-02-10")).toEqual({ from: "2025-04-01", to: "2026-02-10" });
    expect(datePresetRange("last_fy", TODAY)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(datePresetRange("this_month", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(datePresetRange("last_month", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(datePresetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(datePresetRange("this_quarter", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(datePresetRange("this_week", TODAY)).toEqual({ from: "2026-10-19", to: TODAY });
    expect(datePresetRange("last_30", TODAY)).toEqual({ from: "2026-09-26", to: TODAY });
    expect(datePresetRange("yesterday", "2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });

  it("recognises the preset a range came from", () => {
    expect(matchDatePreset("2026-10-01", TODAY, TODAY)).toBe("this_month");
    expect(matchDatePreset("2026-10-02", TODAY, TODAY)).toBeNull();
    expect(matchDatePreset(undefined, TODAY, TODAY)).toBeNull();
  });
});

describe("buildReportQuery", () => {
  it("applies the default date range and enum defaults when the URL is empty", () => {
    expect(buildReportQuery(COLLECTIONS, {}, { today: TODAY })).toEqual({
      from: "2026-10-01",
      to: TODAY,
      group_by: "DAY",
      status: "CLEARED",
    });
  });

  it("keeps known params, drops unknown and empty ones, ignores invalid enum values", () => {
    const query = buildReportQuery(
      COLLECTIONS,
      {
        from: "2026-04-01",
        to: "2026-04-30",
        project_id: "p1",
        block_id: "",
        mode_code: "UPI",
        group_by: "BOGUS",
        foo: "bar",
        status: "PENDING",
      },
      { today: TODAY },
    );
    expect(query).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
      group_by: "DAY",
      project_id: "p1",
      mode_code: "UPI",
      status: "PENDING",
    });
    expect("foo" in query).toBe(false);
    expect("block_id" in query).toBe(false);
  });

  it("never emits from > to when only one side is given", () => {
    expect(buildReportQuery(COLLECTIONS, { from: "2026-12-01" }, { today: TODAY })).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-01",
    });
  });

  it("parses and clamps numeric filters, defaults dates flagged defaultToday", () => {
    const filters: readonly FilterDef[] = [
      { kind: "date", key: "as_of", label: "As of", defaultToday: true },
      { kind: "number", key: "top_n", label: "Top", min: 1, max: 100, defaultValue: 10 },
    ];
    expect(buildReportQuery(filters, {}, { today: TODAY })).toEqual({ as_of: TODAY, top_n: 10 });
    expect(buildReportQuery(filters, { as_of: "2026-01-01", top_n: "500" }, { today: TODAY })).toEqual({
      as_of: "2026-01-01",
      top_n: 100,
    });
    expect(buildReportQuery(filters, { top_n: "abc" }, { today: TODAY })).toEqual({ as_of: TODAY, top_n: 10 });
  });

  it("forwards pagination only for paginated reports", () => {
    const filters: readonly FilterDef[] = [
      {
        kind: "enum",
        key: "kind",
        label: "Kind",
        options: [{ value: "AUDIT", label: "Audit" }],
        defaultValue: "AUDIT",
      },
    ];
    expect(buildReportQuery(filters, {}, { today: TODAY, paginated: true, page: 3, pageSize: 50 })).toEqual({
      kind: "AUDIT",
      page: 3,
      page_size: 50,
    });
    expect(buildReportQuery(filters, {}, { today: TODAY, paginated: true, page: 1, pageSize: 25 })).toEqual({
      kind: "AUDIT",
      page_size: 25,
    });
    expect(buildReportQuery(filters, {}, { today: TODAY, page: 3, pageSize: 50 })).toEqual({ kind: "AUDIT" });
  });

  it("leaves an optional date range out entirely when both ends are blank", () => {
    const filters: readonly FilterDef[] = [{ kind: "dateRange", required: false }, { kind: "project" }];
    expect(buildReportQuery(filters, { project_id: "p1" }, { today: TODAY })).toEqual({ project_id: "p1" });
  });
});

describe("param helpers", () => {
  it("picks only owned keys from the URL and reports missing required filters", () => {
    const filters: readonly FilterDef[] = [{ kind: "project", required: true }, { kind: "block" }];
    expect(pickReportParams(filters, new URLSearchParams("project_id=p1&block_id=&view=table&x=1"))).toEqual({
      project_id: "p1",
    });
    expect(missingRequired(filters, {})).toEqual(["project_id"]);
    expect(missingRequired(filters, { project_id: "p1" })).toEqual([]);
  });

  it("coerces saved preset params to strings and drops unknown keys", () => {
    const filters: readonly FilterDef[] = [
      { kind: "dateRange", required: true },
      { kind: "number", key: "top_n", label: "Top", min: 1, max: 100, defaultValue: 10 },
    ];
    expect(
      presetToParams(filters, { from: "2026-01-01", to: "2026-01-31", top_n: 25, nested: { a: 1 }, other: "x" }),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31", top_n: "25" });
  });
});
