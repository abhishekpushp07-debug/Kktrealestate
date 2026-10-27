import { useQuery } from "@tanstack/react-query";
import type {
  AdminBackupLinkResponse,
  AdminBackupListResponse,
  AdminBackupRow,
  AdminJobEnqueuedResponse,
  AdminJobRunRow,
  AdminJobsResponse,
  AdminSystemResponse,
  ExportLinkResponse,
  ExportRow,
  JobName,
} from "@kkt/contracts";
import { api, isApiClientError, type ApiClientError, type ListEnvelope } from "@/lib/api";
import { summariseMetrics, type MetricsSummary } from "./metrics";

export const JOBS_PATH = "/admin/jobs";
export const JOB_RUNS_PATH = "/admin/jobs/runs";
export const SYSTEM_PATH = "/admin/system";
export const METRICS_PATH = "/metrics";
export const BACKUPS_PATH = "/admin/backups";
export const EXPORTS_PATH = "/exports";

/** Polling interval while something is queued or running. */
export const ACTIVE_POLL_MS = 3000;

export const systemKeys = {
  jobs: [JOBS_PATH] as const,
  runs: (params: Record<string, unknown>) => [JOB_RUNS_PATH, params] as const,
  run: (id: string) => [JOB_RUNS_PATH, "one", id] as const,
  system: [SYSTEM_PATH] as const,
  metrics: [METRICS_PATH, "summary"] as const,
  backups: [BACKUPS_PATH] as const,
  exports: (params: Record<string, unknown>) => [EXPORTS_PATH, params] as const,
};

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

/** True when any row is still QUEUED or RUNNING (the page keeps polling). */
export function hasActive(rows: ReadonlyArray<{ status: string }> | undefined): boolean {
  return Boolean(rows?.some((row) => ACTIVE_STATUSES.has(row.status)));
}

export function useJobs() {
  return useQuery<AdminJobsResponse, ApiClientError>({
    queryKey: systemKeys.jobs,
    queryFn: ({ signal }) => api.get<AdminJobsResponse>(JOBS_PATH, { signal }),
    refetchInterval: (query) => (hasActive(query.state.data?.recent_runs) ? ACTIVE_POLL_MS : 30_000),
  });
}

export function useJobRuns(params: {
  job_name?: string | null;
  status?: string | null;
  page: number;
  page_size: number;
}) {
  return useQuery<ListEnvelope<AdminJobRunRow>, ApiClientError>({
    queryKey: systemKeys.runs(params),
    queryFn: ({ signal }) =>
      api.get<ListEnvelope<AdminJobRunRow>>(JOB_RUNS_PATH, {
        signal,
        query: {
          job_name: params.job_name,
          status: params.status,
          page: params.page > 1 ? params.page : undefined,
          page_size: params.page_size,
        },
      }),
  });
}

/** One run by id (404 until a worker picks the job up → null, keep polling). */
export function useJobRun(id: string | null) {
  return useQuery<AdminJobRunRow | null, ApiClientError>({
    queryKey: systemKeys.run(id ?? ""),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      try {
        return await api.get<AdminJobRunRow>(`${JOB_RUNS_PATH}/${id}`, { signal });
      } catch (error) {
        if (isApiClientError(error) && error.status === 404) return null;
        throw error;
      }
    },
    refetchInterval: (query) =>
      query.state.data === null || (query.state.data && ACTIVE_STATUSES.has(query.state.data.status))
        ? ACTIVE_POLL_MS
        : false,
  });
}

export function runJobNow(name: JobName): Promise<AdminJobEnqueuedResponse> {
  return api.post<AdminJobEnqueuedResponse>(`${JOBS_PATH}/${name}/run`, {});
}

export function useSystemFacts() {
  return useQuery<AdminSystemResponse, ApiClientError>({
    queryKey: systemKeys.system,
    queryFn: ({ signal }) => api.get<AdminSystemResponse>(SYSTEM_PATH, { signal }),
    refetchInterval: 30_000,
  });
}

/** GET /metrics (Prometheus text, admin.tools) summarised on the client. */
export function useMetricsSummary() {
  return useQuery<MetricsSummary, ApiClientError>({
    queryKey: systemKeys.metrics,
    queryFn: async ({ signal }) => {
      const result = await api.download(METRICS_PATH, { signal });
      return summariseMetrics(await result.blob.text());
    },
    refetchInterval: 30_000,
  });
}

export function useBackups() {
  return useQuery<AdminBackupListResponse, ApiClientError>({
    queryKey: systemKeys.backups,
    queryFn: ({ signal }) => api.get<AdminBackupListResponse>(BACKUPS_PATH, { signal }),
    refetchInterval: (query) => (hasActive(query.state.data?.items) ? ACTIVE_POLL_MS : false),
  });
}

export function createBackup(includeSensitive: boolean): Promise<AdminBackupRow> {
  return api.post<AdminBackupRow>("/admin/backup", { include_sensitive: includeSensitive });
}

export function backupLink(id: string): Promise<AdminBackupLinkResponse> {
  return api.post<AdminBackupLinkResponse>(`${BACKUPS_PATH}/${id}/link`, {});
}

export function useExports(params: { status?: string | null; page: number; page_size: number }) {
  return useQuery<ListEnvelope<ExportRow>, ApiClientError>({
    queryKey: systemKeys.exports(params),
    queryFn: ({ signal }) =>
      api.get<ListEnvelope<ExportRow>>(EXPORTS_PATH, {
        signal,
        query: { status: params.status, page: params.page > 1 ? params.page : undefined, page_size: params.page_size },
      }),
    refetchInterval: (query) => (hasActive(query.state.data?.items) ? ACTIVE_POLL_MS : false),
  });
}

export function exportLink(id: string): Promise<ExportLinkResponse> {
  return api.post<ExportLinkResponse>(`${EXPORTS_PATH}/${id}/link`, {});
}

/** Opens a signed download link (Content-Disposition: attachment) without leaving the page. */
export function openDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** "/api/v1/customers" → "Customers"; "/api/v1/reports/collections" → "Reports › collections". */
export function exportSourceLabel(path: string): string {
  const parts = path
    .replace(/^\/api\/v1\//, "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return path;
  const [head, ...rest] = parts;
  const title = (head ?? "").replace(/-/g, " ");
  return [title.charAt(0).toUpperCase() + title.slice(1), ...rest.map((part) => part.replace(/-/g, " "))].join(" › ");
}
