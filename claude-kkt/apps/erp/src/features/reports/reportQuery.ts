/**
 * Pure helpers for the generic report frame: filter definitions, date presets and the URL-state →
 * strict query-string builder (every report rejects unknown parameters with VALIDATION_ERROR).
 */
import type { QueryParams } from "@/lib/api";

export interface EnumOption {
  value: string;
  label: string;
}

export type FilterDef =
  | { kind: "dateRange"; required: boolean; label?: string; defaultPreset?: DatePresetId }
  | { kind: "date"; key: string; label: string; defaultToday?: boolean }
  | { kind: "project"; required?: boolean }
  | { kind: "block" }
  | { kind: "customer" }
  | { kind: "user"; key: string; label: string }
  | { kind: "bankAccount" }
  | { kind: "enum"; key: string; label: string; options: readonly EnumOption[]; defaultValue?: string; clearable?: boolean }
  | { kind: "number"; key: string; label: string; min: number; max: number; defaultValue: number }
  | { kind: "text"; key: string; label: string; placeholder?: string };

/** Query keys a filter definition owns. */
export function filterKeys(filter: FilterDef): readonly string[] {
  switch (filter.kind) {
    case "dateRange":
      return ["from", "to"];
    case "project":
      return ["project_id"];
    case "block":
      return ["block_id"];
    case "customer":
      return ["customer_id"];
    case "bankAccount":
      return ["bank_account_id"];
    case "date":
    case "user":
    case "enum":
    case "number":
    case "text":
      return [filter.key];
  }
}

/* ------------------------------------------------------------------ */
/* Date presets (IST business dates)                                     */
/* ------------------------------------------------------------------ */

export const DATE_PRESETS = ["today", "yesterday", "this_week", "this_month", "last_month", "this_quarter", "this_fy", "last_fy", "last_30", "last_90"] as const;
export type DatePresetId = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Readonly<Record<DatePresetId, string>> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_fy: "This FY",
  last_fy: "Last FY",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
};

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function shift(date: string, days: number): string {
  const { y, m, d } = parts(date);
  return iso(y, m, d + days);
}

/** Inclusive range for a preset relative to `today` (YYYY-MM-DD). Indian FY runs April–March; weeks start Monday. */
export function datePresetRange(preset: DatePresetId, today: string): { from: string; to: string } {
  const { y, m, d } = parts(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = shift(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "this_week": {
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      const back = (weekday + 6) % 7;
      return { from: shift(today, -back), to: today };
    }
    case "this_month":
      return { from: iso(y, m, 1), to: today };
    case "last_month":
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case "this_quarter": {
      const startMonth = m - ((m - 1) % 3);
      return { from: iso(y, startMonth, 1), to: today };
    }
    case "this_fy": {
      const fyStartYear = m >= 4 ? y : y - 1;
      return { from: iso(fyStartYear, 4, 1), to: today };
    }
    case "last_fy": {
      const fyStartYear = (m >= 4 ? y : y - 1) - 1;
      return { from: iso(fyStartYear, 4, 1), to: iso(fyStartYear + 1, 3, 31) };
    }
    case "last_30":
      return { from: shift(today, -29), to: today };
    case "last_90":
      return { from: shift(today, -89), to: today };
  }
}

/** Preset whose range equals the given dates, if any (for highlighting the active chip). */
export function matchDatePreset(from: string | undefined, to: string | undefined, today: string): DatePresetId | null {
  if (!from || !to) return null;
  for (const preset of DATE_PRESETS) {
    const range = datePresetRange(preset, today);
    if (range.from === from && range.to === to) return preset;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Query builder                                                         */
/* ------------------------------------------------------------------ */

export interface BuildQueryOptions {
  today: string;
  /** Paginated (ListQuery) reports also forward page / page_size. */
  paginated?: boolean;
  page?: number;
  pageSize?: number;
}

/** True when a required filter has no value (the frame shows a prompt instead of fetching). */
export function missingRequired(filters: readonly FilterDef[], params: Readonly<Record<string, string>>): string[] {
  const missing: string[] = [];
  for (const filter of filters) {
    if (filter.kind === "project" && filter.required && !params.project_id) missing.push("project_id");
  }
  return missing;
}

/**
 * URL/search params → strict API query. Unknown keys are dropped, defaults are applied
 * (date range preset, enum defaults, numeric defaults), empty strings are skipped and
 * numbers are parsed. The result is deterministic so it doubles as the query cache key.
 */
export function buildReportQuery(filters: readonly FilterDef[], params: Readonly<Record<string, string>>, options: BuildQueryOptions): QueryParams {
  const query: QueryParams = {};
  const read = (key: string): string | undefined => {
    const value = params[key];
    return value === undefined || value === "" ? undefined : value;
  };

  for (const filter of filters) {
    switch (filter.kind) {
      case "dateRange": {
        let from = read("from");
        let to = read("to");
        if ((!from || !to) && filter.required) {
          const range = datePresetRange(filter.defaultPreset ?? "this_month", options.today);
          from = from ?? range.from;
          to = to ?? range.to;
          if (from > to) to = from;
        }
        if (from) query.from = from;
        if (to) query.to = to;
        break;
      }
      case "date": {
        const value = read(filter.key) ?? (filter.defaultToday ? options.today : undefined);
        if (value) query[filter.key] = value;
        break;
      }
      case "project":
      case "block":
      case "customer":
      case "bankAccount":
      case "user":
      case "text": {
        const [key] = filterKeys(filter);
        if (!key) break;
        const value = read(key);
        if (value) query[key] = value;
        break;
      }
      case "enum": {
        const value = read(filter.key) ?? filter.defaultValue;
        if (value && filter.options.some((option) => option.value === value)) query[filter.key] = value;
        else if (filter.defaultValue) query[filter.key] = filter.defaultValue;
        break;
      }
      case "number": {
        const raw = read(filter.key);
        const parsed = raw === undefined ? Number.NaN : Number(raw);
        const value = Number.isInteger(parsed) ? Math.min(filter.max, Math.max(filter.min, parsed)) : filter.defaultValue;
        query[filter.key] = value;
        break;
      }
    }
  }

  if (options.paginated) {
    if (options.page && options.page > 1) query.page = options.page;
    if (options.pageSize) query.page_size = options.pageSize;
  }
  return query;
}

/** Search params → plain record of the keys a report owns (plus page/page_size for paginated reports). */
export function pickReportParams(filters: readonly FilterDef[], search: URLSearchParams): Record<string, string> {
  const keys = new Set(filters.flatMap((filter) => filterKeys(filter)));
  const result: Record<string, string> = {};
  for (const [key, value] of search.entries()) {
    if (keys.has(key) && value !== "") result[key] = value;
  }
  return result;
}

/** Preset params (unknown JSON) → the string record the frame understands; unknown keys are ignored. */
export function presetToParams(filters: readonly FilterDef[], raw: Record<string, unknown>): Record<string, string> {
  const keys = new Set(filters.flatMap((filter) => filterKeys(filter)));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!keys.has(key)) continue;
    if (typeof value === "string" && value !== "") result[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") result[key] = String(value);
  }
  return result;
}
