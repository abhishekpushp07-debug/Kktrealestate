import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import type {
  BlockConstructionResponse,
  BlockGridResponse,
  BlockRow,
  DocumentEntityType,
  DocumentRow,
  FlatDetailResponse,
  GridColourMode,
  ProjectRow,
  ProjectWebsiteSettingsRow,
  RateCardRow,
  UserRow,
  VisitSettingsRow,
} from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope, type QueryParams } from "@/lib/api";
import { useItem } from "@/lib/queries";

/* ------------------------------------------------------------------ */
/* Paths                                                                */
/* ------------------------------------------------------------------ */

export const PROJECTS_PATH = "/projects";
export const BLOCKS_PATH = "/blocks";
export const FLATS_PATH = "/flats";
export const RATE_CARDS_PATH = "/rate-cards";
export const DOCUMENTS_PATH = "/documents";
export const USERS_PATH = "/users";

export const inventoryKeys = {
  projectBlocks: (projectId: string) => [BLOCKS_PATH, "by-project", projectId] as const,
  blockGrid: (blockId: string, colourBy: GridColourMode) => [BLOCKS_PATH, "grid", blockId, colourBy] as const,
  blockConstruction: (blockId: string) => [BLOCKS_PATH, "construction", blockId] as const,
  flatDetail: (flatId: string) => [FLATS_PATH, "detail", flatId] as const,
  rateCards: (projectId: string) => [RATE_CARDS_PATH, "by-project", projectId] as const,
  parking: (projectId: string) => [PROJECTS_PATH, "parking", projectId] as const,
  website: (projectId: string) => [PROJECTS_PATH, "website", projectId] as const,
  brochureStats: (projectId: string) => [PROJECTS_PATH, "brochure-stats", projectId] as const,
  visitSettings: (projectId: string) => [PROJECTS_PATH, "visit-settings", projectId] as const,
  documents: (entityType: DocumentEntityType, entityId: string) => [DOCUMENTS_PATH, "entity", entityType, entityId] as const,
  salesUsers: [USERS_PATH, "options", "sales"] as const,
};

type QueryOpts<T> = Omit<UseQueryOptions<T, ApiClientError, T, readonly unknown[]>, "queryKey" | "queryFn">;

/** Thin typed wrapper around useQuery for one-off GETs. */
export function useApiQuery<T>(queryKey: readonly unknown[], path: string, options: QueryOpts<T> & { query?: QueryParams } = {}): UseQueryResult<T, ApiClientError> {
  const { query, ...rest } = options;
  return useQuery<T, ApiClientError, T, readonly unknown[]>({
    queryKey,
    queryFn: ({ signal }) => api.get<T>(path, { signal, query }),
    ...rest,
  });
}

/* ------------------------------------------------------------------ */
/* Projects                                                             */
/* ------------------------------------------------------------------ */

export function useProject(id: string | null | undefined) {
  return useItem<ProjectRow>(PROJECTS_PATH, id);
}

export function useProjectBlocks(projectId: string | null | undefined): UseQueryResult<BlockRow[], ApiClientError> {
  return useQuery<ListEnvelope<BlockRow>, ApiClientError, BlockRow[], readonly unknown[]>({
    queryKey: inventoryKeys.projectBlocks(projectId ?? ""),
    queryFn: ({ signal }) => api.list<BlockRow>(BLOCKS_PATH, { page_size: 200, sort: "sort_order", filters: { project_id: projectId ?? "" } }, { signal }),
    select: (data) => data.items,
    enabled: Boolean(projectId),
  });
}

export function useWebsiteSettings(projectId: string | null | undefined) {
  return useApiQuery<ProjectWebsiteSettingsRow>(inventoryKeys.website(projectId ?? ""), `${PROJECTS_PATH}/${projectId}/website`, { enabled: Boolean(projectId) });
}

export interface BrochureStats {
  download_count: number;
  sparkline: Array<{ date: string; count: number }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Accepts `{download_count, sparkline}` as well as the website-row spelling of the same data. */
export function normaliseBrochureStats(raw: unknown): BrochureStats {
  const record = asRecord(raw);
  const count = typeof record?.download_count === "number" ? record.download_count : typeof record?.brochure_download_count === "number" ? record.brochure_download_count : 0;
  const series = Array.isArray(record?.sparkline) ? record.sparkline : Array.isArray(record?.brochure_downloads_30d) ? record.brochure_downloads_30d : [];
  const sparkline = series.flatMap((point) => {
    const item = asRecord(point);
    if (!item || typeof item.date !== "string") return [];
    return [{ date: item.date, count: typeof item.count === "number" ? item.count : 0 }];
  });
  return { download_count: count, sparkline };
}

export function useBrochureStats(projectId: string | null | undefined): UseQueryResult<BrochureStats, ApiClientError> {
  return useQuery<unknown, ApiClientError, BrochureStats, readonly unknown[]>({
    queryKey: inventoryKeys.brochureStats(projectId ?? ""),
    queryFn: ({ signal }) => api.get<unknown>(`${PROJECTS_PATH}/${projectId}/brochure-stats`, { signal }),
    select: normaliseBrochureStats,
    enabled: Boolean(projectId),
    retry: false,
  });
}

export function useVisitSettings(projectId: string | null | undefined) {
  return useApiQuery<VisitSettingsRow>(inventoryKeys.visitSettings(projectId ?? ""), `${PROJECTS_PATH}/${projectId}/visit-settings`, { enabled: Boolean(projectId) });
}

/* ------------------------------------------------------------------ */
/* Blocks & flats                                                       */
/* ------------------------------------------------------------------ */

export function useBlock(id: string | null | undefined) {
  return useItem<BlockRow>(BLOCKS_PATH, id);
}

export function useBlockGrid(blockId: string | null | undefined, colourBy: GridColourMode) {
  return useApiQuery<BlockGridResponse>(inventoryKeys.blockGrid(blockId ?? "", colourBy), `${BLOCKS_PATH}/${blockId}/grid`, {
    query: { colour_by: colourBy },
    enabled: Boolean(blockId),
  });
}

export function useBlockConstruction(blockId: string | null | undefined) {
  return useApiQuery<BlockConstructionResponse>(inventoryKeys.blockConstruction(blockId ?? ""), `${BLOCKS_PATH}/${blockId}/construction`, { enabled: Boolean(blockId) });
}

export function useFlatDetail(flatId: string | null | undefined) {
  return useApiQuery<FlatDetailResponse>(inventoryKeys.flatDetail(flatId ?? ""), `${FLATS_PATH}/${flatId}`, { enabled: Boolean(flatId) });
}

/* ------------------------------------------------------------------ */
/* Rate cards                                                           */
/* ------------------------------------------------------------------ */

export function useRateCards(projectId: string | null | undefined): UseQueryResult<RateCardRow[], ApiClientError> {
  return useQuery<ListEnvelope<RateCardRow>, ApiClientError, RateCardRow[], readonly unknown[]>({
    queryKey: inventoryKeys.rateCards(projectId ?? ""),
    queryFn: ({ signal }) => api.list<RateCardRow>(RATE_CARDS_PATH, { page_size: 200, sort: "-effective_from", filters: { project_id: projectId ?? "" } }, { signal }),
    select: (data) => data.items,
    enabled: Boolean(projectId),
  });
}

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

export function useEntityDocuments(entityType: DocumentEntityType, entityId: string | null | undefined, enabled = true): UseQueryResult<DocumentRow[], ApiClientError> {
  return useQuery<ListEnvelope<DocumentRow>, ApiClientError, DocumentRow[], readonly unknown[]>({
    queryKey: inventoryKeys.documents(entityType, entityId ?? ""),
    queryFn: ({ signal }) => api.list<DocumentRow>(DOCUMENTS_PATH, { page_size: 200, sort: "-created_at", filters: { entity_type: entityType, entity_id: entityId ?? "" } }, { signal }),
    select: (data) => data.items,
    enabled: enabled && Boolean(entityId),
  });
}

export interface UploadDocumentInput {
  file: File;
  entity_type: DocumentEntityType;
  entity_id: string;
  document_type_id?: string | null;
  title?: string;
  is_sensitive?: boolean;
  shared_with_customer?: boolean;
}

interface UploadResponse {
  document?: DocumentRow;
  id?: string;
}

/** Multipart upload; the API answers `{document}` (contracts) or the bare row. */
export async function uploadDocument(input: UploadDocumentInput): Promise<DocumentRow> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("entity_type", input.entity_type);
  form.append("entity_id", input.entity_id);
  if (input.document_type_id) form.append("document_type_id", input.document_type_id);
  if (input.title) form.append("title", input.title);
  form.append("is_sensitive", String(input.is_sensitive ?? false));
  form.append("shared_with_customer", String(input.shared_with_customer ?? false));
  const response = await api.upload<UploadResponse | DocumentRow>(DOCUMENTS_PATH, form);
  if ("document" in response && response.document) return response.document;
  return response as DocumentRow;
}

interface LinkResponse {
  url?: string;
  download_url?: string;
}

/** Short-lived signed link for a document (optionally a thumb/medium variant). */
export async function fetchDocumentLink(documentId: string, variant?: "thumb" | "medium"): Promise<string> {
  const response = await api.post<LinkResponse>(`${DOCUMENTS_PATH}/${documentId}/link`, undefined, { query: variant ? { variant } : undefined });
  const url = response.url ?? response.download_url;
  if (!url) throw new Error("The server did not return a download link");
  return url;
}

/* ------------------------------------------------------------------ */
/* Users                                                                */
/* ------------------------------------------------------------------ */

/** Sales users for RM / assignee pickers; falls back to every active user when the role filter is unsupported. */
export function useSalesUserOptions(enabled = true): UseQueryResult<UserRow[], ApiClientError> {
  return useQuery<UserRow[], ApiClientError, UserRow[], readonly unknown[]>({
    queryKey: inventoryKeys.salesUsers,
    queryFn: async ({ signal }) => {
      try {
        const sales = await api.list<UserRow>(USERS_PATH, { page_size: 200, sort: "name" }, { signal, query: { role: "Sales" } });
        if (sales.items.length > 0) return sales.items;
      } catch {
        /* role filter not supported: fall through */
      }
      const all = await api.list<UserRow>(USERS_PATH, { page_size: 200, sort: "name" }, { signal });
      return all.items;
    },
    staleTime: 60_000,
    enabled,
  });
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                         */
/* ------------------------------------------------------------------ */

/** Body + If-Match for versioned POST actions. */
export function versioned<T extends object>(body: T, version: number): { body: T & { version: number }; options: { version: number } } {
  return { body: { ...body, version }, options: { version } };
}
