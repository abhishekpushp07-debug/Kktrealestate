import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { CustomerStatementResponse, ReportCatalogResponse, ReportKey, ReportPresetCreate, ReportPresetRow } from "@kkt/contracts";
import { api, csvExportFacts, saveBlob, type ApiClientError, type CsvExportResult, type QueryParams } from "@/lib/api";
import { useApiQuery } from "@/features/inventory/api";

export const REPORTS_PATH = "/reports";
export const PRESETS_PATH = `${REPORTS_PATH}/presets`;

export const reportKeys = {
  catalog: [REPORTS_PATH, "catalog"] as const,
  data: (path: string, query: QueryParams) => [REPORTS_PATH, "data", path, query] as const,
  presets: (reportKey: ReportKey | null) => [PRESETS_PATH, reportKey ?? "all"] as const,
  statement: (bookingId: string) => [REPORTS_PATH, "customer-statement", bookingId] as const,
};

/** `GET /reports` — which reports and formats the server offers (optional: the UI has its own catalogue). */
export function useReportCatalog(): UseQueryResult<ReportCatalogResponse, ApiClientError> {
  return useApiQuery<ReportCatalogResponse>(reportKeys.catalog, REPORTS_PATH, { staleTime: 5 * 60_000, retry: false });
}

/** JSON result of one report for the given strict query. */
export function useReportData<T>(path: string, query: QueryParams, enabled = true): UseQueryResult<T, ApiClientError> {
  return useQuery<T, ApiClientError, T, readonly unknown[]>({
    queryKey: reportKeys.data(path, query),
    queryFn: ({ signal }) => api.get<T>(path, { signal, query }),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

/** `GET /reports/customer-statement?booking_id=` */
export function useCustomerStatement(bookingId: string | null): UseQueryResult<CustomerStatementResponse, ApiClientError> {
  return useApiQuery<CustomerStatementResponse>(reportKeys.statement(bookingId ?? ""), `${REPORTS_PATH}/customer-statement`, { query: { booking_id: bookingId ?? undefined }, enabled: Boolean(bookingId) });
}

/** Streams the report as CSV or PDF and hands it to the browser; a CSV returns its X-Export-* facts (truncated at 10,000 rows → offer POST /exports). */
export async function exportReport(path: string, query: QueryParams, format: "csv" | "pdf", fallbackName: string): Promise<CsvExportResult | null> {
  const result = await api.download(path, { query: { ...query, format } });
  const fallback = `${fallbackName}.${format}`;
  const serverName = result.filename && !result.filename.includes("?") && result.filename !== path.split("/").pop() ? result.filename : fallback;
  saveBlob(result.blob, serverName);
  return format === "csv" ? csvExportFacts(result.headers, serverName) : null;
}

/* ------------------------------------------------------------------ */
/* Presets                                                              */
/* ------------------------------------------------------------------ */

interface PresetList {
  items?: ReportPresetRow[];
}

export function usePresets(reportKey: ReportKey, enabled = true): UseQueryResult<ReportPresetRow[], ApiClientError> {
  return useQuery<PresetList | ReportPresetRow[], ApiClientError, ReportPresetRow[], readonly unknown[]>({
    queryKey: reportKeys.presets(reportKey),
    queryFn: ({ signal }) => api.get<PresetList | ReportPresetRow[]>(PRESETS_PATH, { signal, query: { report_key: reportKey } }),
    select: (data) => (Array.isArray(data) ? data : (data.items ?? [])).filter((row) => row.report_key === reportKey),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function createPreset(body: ReportPresetCreate): Promise<ReportPresetRow> {
  return api.post<ReportPresetRow>(PRESETS_PATH, body);
}

export function deletePreset(id: string): Promise<void> {
  return api.delete(`${PRESETS_PATH}/${id}`);
}
