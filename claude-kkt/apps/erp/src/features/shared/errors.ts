import { isApiClientError } from "@/lib/api";

export interface UsageBreakdown {
  usage_count: number;
  used_by: Array<{ entity_type: string; count: number }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Reads `details.usage_count` / `details.used_by[]` from a 409 IN_USE error (or a GET …/usage body). */
export function usageFromDetails(details: unknown): UsageBreakdown | null {
  const record = asRecord(details);
  if (!record) return null;
  const count = typeof record.usage_count === "number" ? record.usage_count : null;
  if (count === null) return null;
  const usedBy = Array.isArray(record.used_by)
    ? record.used_by.flatMap((entry) => {
        if (typeof entry === "string") return [{ entity_type: entry, count: 0 }];
        const item = asRecord(entry);
        if (!item || typeof item.entity_type !== "string") return [];
        return [{ entity_type: item.entity_type, count: typeof item.count === "number" ? item.count : 0 }];
      })
    : [];
  return { usage_count: count, used_by: usedBy };
}

/** True for 409 IN_USE. */
export function isInUseError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 409 && error.code === "IN_USE";
}

export interface BusinessRuleIssue {
  path: string | null;
  message: string;
}

/** 422 BUSINESS_RULE → `details.errors[]` (strings or `{path?, message}`), else the rule / message. */
export function businessRuleIssues(error: unknown): BusinessRuleIssue[] {
  if (!isApiClientError(error) || error.code !== "BUSINESS_RULE") return [];
  const details = asRecord(error.details);
  const raw = details?.errors;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.flatMap((entry) => {
      if (typeof entry === "string") return [{ path: null, message: entry }];
      const item = asRecord(entry);
      if (!item || typeof item.message !== "string") return [];
      return [{ path: typeof item.path === "string" ? item.path : null, message: item.message }];
    });
  }
  const rule = typeof details?.rule === "string" ? details.rule : null;
  return [{ path: null, message: error.message || rule || "The request breaks a business rule." }];
}
