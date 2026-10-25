import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { CmsPostRow, DocumentRow, DocumentVariant, SiteSettingsRow } from "@kkt/contracts";
import { api, apiBaseUrl, isApiClientError, type ApiClientError } from "@/lib/api";
import { uploadDocument, useApiQuery } from "@/features/inventory/api";

/* ------------------------------------------------------------------ */
/* Paths & keys                                                         */
/* ------------------------------------------------------------------ */

export const CMS_PATH = "/cms";
export const SITE_PATH = `${CMS_PATH}/site`;
export const BANNERS_PATH = `${CMS_PATH}/banners`;
export const HOME_SECTIONS_PATH = `${CMS_PATH}/home-sections`;
export const TESTIMONIALS_PATH = `${CMS_PATH}/testimonials`;
export const GALLERY_PATH = `${CMS_PATH}/gallery`;
export const POSTS_PATH = `${CMS_PATH}/posts`;
export const PAGES_PATH = `${CMS_PATH}/pages`;
export const PEOPLE_PATH = `${CMS_PATH}/people`;
export const MEDIA_PATH = `${CMS_PATH}/media`;
export const NOTICES_PATH = "/notices";

export const cmsKeys = {
  site: [SITE_PATH] as const,
  post: (id: string) => [POSTS_PATH, "detail", id] as const,
};

/* ------------------------------------------------------------------ */
/* Site settings                                                        */
/* ------------------------------------------------------------------ */

export function useSiteSettings(): UseQueryResult<SiteSettingsRow, ApiClientError> {
  return useApiQuery<SiteSettingsRow>(cmsKeys.site, SITE_PATH, { staleTime: 30_000 });
}

export function usePost(id: string | null | undefined): UseQueryResult<CmsPostRow, ApiClientError> {
  return useApiQuery<CmsPostRow>(cmsKeys.post(id ?? ""), `${POSTS_PATH}/${id}`, { enabled: Boolean(id) });
}

/* ------------------------------------------------------------------ */
/* Media                                                                */
/* ------------------------------------------------------------------ */

/** Long-lived public URL of a CMS image rendition (`GET /public/media/:id?variant=`). */
export function publicMediaUrl(documentId: string | null | undefined, variant: DocumentVariant = "medium"): string | null {
  if (!documentId) return null;
  const suffix = variant === "original" ? "" : `?variant=${variant}`;
  return `${apiBaseUrl()}/public/media/${documentId}${suffix}`;
}

interface MediaUploadResponse {
  document?: DocumentRow;
  id?: string;
}

/**
 * Uploads a website image: `POST /cms/media` (multipart) first, falling back to the generic
 * documents endpoint with `entity_type: CMS` against the company when the CMS route is absent.
 */
export async function uploadCmsMedia(file: File, companyId: string | null, title?: string): Promise<DocumentRow> {
  try {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    const response = await api.upload<MediaUploadResponse | DocumentRow>(MEDIA_PATH, form);
    if ("document" in response && response.document) return response.document;
    if ("file_name" in response) return response;
    throw new Error("Unexpected upload response");
  } catch (error) {
    const missingRoute = isApiClientError(error) && (error.status === 404 || error.status === 405);
    if (!missingRoute || !companyId) throw error;
    return uploadDocument({ file, entity_type: "CMS", entity_id: companyId, title, is_sensitive: false, shared_with_customer: false });
  }
}

/* ------------------------------------------------------------------ */
/* Website origin                                                       */
/* ------------------------------------------------------------------ */

/** Marketing-site origin from the build-time env, when configured. */
export function websiteOrigin(): string | null {
  const env = import.meta.env.VITE_WEB_URL;
  return env ? env.replace(/\/+$/, "") : null;
}

/** Absolute website URL for a public path, or null when the origin is unknown. */
export function websiteUrl(path: string): string | null {
  const origin = websiteOrigin();
  return origin ? `${origin}${path.startsWith("/") ? path : `/${path}`}` : null;
}

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                 */
/* ------------------------------------------------------------------ */

/** "Hello World! 2026" → "hello-world-2026". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** `datetime-local` value ↔ RFC 3339. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Trim → null when empty. */
export function nullable(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

/** Shared "list that may come back as a bare array" guard. */
export function useArrayQuery<T>(key: readonly unknown[], path: string, enabled = true): UseQueryResult<T[], ApiClientError> {
  return useQuery<{ items: T[] } | T[], ApiClientError, T[], readonly unknown[]>({
    queryKey: key,
    queryFn: ({ signal }) => api.get<{ items: T[] } | T[]>(path, { signal }),
    select: (data) => (Array.isArray(data) ? data : data.items),
    enabled,
  });
}
