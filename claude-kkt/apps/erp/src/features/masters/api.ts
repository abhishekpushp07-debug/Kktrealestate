import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ActiveStateResponse, MasterCsvImportResponse, MasterKind, MasterRow } from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope } from "@/lib/api";
import type { MasterSlug } from "./types";

/** `FLOOR_PLAN_TEMPLATES` → `floor-plan-templates`. */
export function kindToSlug(kind: MasterKind): MasterSlug {
  return kind.toLowerCase().replaceAll("_", "-") as MasterSlug;
}

/** Base path of a master kind's endpoints. */
export function masterPath(slug: MasterSlug): string {
  return `/masters/${slug}`;
}

export const masterKeys = {
  all: (slug: MasterSlug) => [masterPath(slug)] as const,
  options: (slug: MasterSlug, includeInactive: boolean) => [masterPath(slug), "options", includeInactive] as const,
};

export interface MasterOptionsParams {
  includeInactive?: boolean;
  sort?: string;
  enabled?: boolean;
}

/** Up to 200 rows of a master kind for selects (active only unless asked otherwise). */
export function useMasterRows<Row extends MasterRow>(
  slug: MasterSlug,
  params: MasterOptionsParams = {},
): UseQueryResult<Row[], ApiClientError> {
  const { includeInactive = false, sort = "name", enabled = true } = params;
  return useQuery<ListEnvelope<Row>, ApiClientError, Row[]>({
    queryKey: [...masterKeys.options(slug, includeInactive), sort],
    queryFn: ({ signal }) =>
      api.list<Row>(masterPath(slug), { page_size: 200, sort, include_inactive: includeInactive }, { signal }),
    select: (data) => data.items,
    staleTime: 60_000,
    enabled,
  });
}

export interface ImportRequest {
  kind: MasterKind;
  csv: string;
  commit: boolean;
}

/** `POST /masters/import` — preview (`commit: false`) or apply. */
export function importMasterCsv(body: ImportRequest): Promise<MasterCsvImportResponse> {
  return api.post<MasterCsvImportResponse>("/masters/import", body);
}

export interface ActiveStateBody {
  version: number;
}

export function deactivateMaster(slug: MasterSlug, id: string, version: number): Promise<ActiveStateResponse> {
  return api.post<ActiveStateResponse>(`${masterPath(slug)}/${id}/deactivate`, { version } satisfies ActiveStateBody, {
    version,
  });
}

export function activateMaster(slug: MasterSlug, id: string, version: number): Promise<ActiveStateResponse> {
  return api.post<ActiveStateResponse>(`${masterPath(slug)}/${id}/activate`, { version } satisfies ActiveStateBody, {
    version,
  });
}
