import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  ActiveStateResponse,
  ImportUnknownColumnsDetails,
  MasterCsvImportResponse,
  MasterImportTemplate,
  MasterKind,
  MasterRow,
} from "@kkt/contracts";
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
  importTemplate: (slug: MasterSlug) => [masterPath(slug), "import-template"] as const,
};

/**
 * The canonical CSV template of a master (`GET /masters/{path}/import-template`): header in create-schema order, column types,
 * required flags, enum values and an example row valid for this company. The ERP keeps no column lists of its own.
 */
export function useImportTemplate(
  slug: MasterSlug,
  enabled = true,
): UseQueryResult<MasterImportTemplate, ApiClientError> {
  return useQuery<MasterImportTemplate, ApiClientError>({
    queryKey: masterKeys.importTemplate(slug),
    queryFn: ({ signal }) => api.get<MasterImportTemplate>(`${masterPath(slug)}/import-template`, { signal }),
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** One line per template column: "default_amount_paise (number, required)" / "demand_at (one of: ON_BOOKING, …)". */
export function describeTemplateColumns(template: MasterImportTemplate): string[] {
  return template.columns.map((column) => {
    const facts: string[] = [
      column.type === "enum" && column.values ? `one of: ${column.values.join(", ")}` : column.type,
    ];
    if (column.type === "list")
      facts[0] = column.values ? `list of ${column.values.join(" | ")}, "|"-separated` : `"|"-separated list`;
    if (column.type === "json") facts[0] = "JSON";
    if (column.required) facts.push("required");
    if (column.key) facts.push("match key");
    return `${column.name} (${facts.join(", ")})`;
  });
}

/** 422 IMPORT_UNKNOWN_COLUMNS details → readable lines ("default_amount → did you mean default_amount_paise?"). */
export function unknownColumnLines(details: Record<string, unknown> | undefined): string[] {
  const data = details as Partial<ImportUnknownColumnsDetails> | undefined;
  const unknown = Array.isArray(data?.unknown_columns) ? data.unknown_columns : [];
  const suggestions = data?.suggestions && typeof data.suggestions === "object" ? data.suggestions : {};
  return unknown.map((column) =>
    suggestions[column]
      ? `“${column}” is not a column — did you mean “${suggestions[column]}”?`
      : `“${column}” is not a column.`,
  );
}

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
