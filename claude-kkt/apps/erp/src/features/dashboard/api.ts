import type { UseQueryResult } from "@tanstack/react-query";
import type { DashboardResponse } from "@kkt/contracts";
import type { ApiClientError } from "@/lib/api";
import { useApiQuery } from "@/features/inventory/api";

export const DASHBOARD_PATH = "/dashboard";

export const dashboardKeys = {
  root: (projectId: string | null) => [DASHBOARD_PATH, projectId ?? ""] as const,
};

/** `GET /dashboard` — discriminated by role. Refreshes every two minutes while the tab is visible. */
export function useDashboard(projectId: string | null = null): UseQueryResult<DashboardResponse, ApiClientError> {
  return useApiQuery<DashboardResponse>(dashboardKeys.root(projectId), DASHBOARD_PATH, {
    query: projectId ? { project_id: projectId } : undefined,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}

/* ------------------------------------------------------------------ */
/* Chart palette (validated with the dataviz validator, light surface)  */
/* ------------------------------------------------------------------ */

/** Categorical, fixed order: Cash, Account, Other charges. Gold is below 3:1 so every chart ships a legend + table view. */
export const SERIES_COLORS = { cash: "#24569a", account: "#c9a227", other: "#0f9d8a" } as const;

/** Ordinal navy ramp, light → dark (ageing buckets, funnel stages). */
export const ORDINAL_RAMP = ["#8ea9d1", "#5c80b5", "#3a5f98", "#1c4882", "#0b1f3a"] as const;

/** Status palette (reserved meanings) for inventory stacks. */
export const STATUS_COLORS = { available: "#10b981", hold: "#f59e0b", booked: "#163866", sold: "#c9a227", blocked: "#9ca3af" } as const;

export const CHART_INK = { grid: "#e5e9f0", axis: "#6b7280", text: "#0b1f3a" } as const;
