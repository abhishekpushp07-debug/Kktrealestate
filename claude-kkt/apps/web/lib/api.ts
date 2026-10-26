/**
 * The single typed module for every call the website makes to the public API
 * (docs/API-CONVENTIONS.md, Appendix B).
 *
 *  - Server fetchers (`get*`, `list*`) run in Server Components, use the in-cluster API_INTERNAL_URL
 *    and, for lists and site settings, the Next.js Data Cache (`next: { revalidate: 60, tags }`); detail
 *    resources are always fetched fresh (see DETAIL). Network failures degrade to empty fallbacks so a
 *    build or a request never dies because the backend is briefly away; a 404 on a detail resource
 *    becomes `notFound()`.
 *  - Uncached server fetches forward the visitor's address (`x-forwarded-for` of the incoming request) so the API's per-IP
 *    limits apply per visitor, not to the web server as a whole (the API honours it only from proxies in its TRUST_PROXY list —
 *    see apps/web/README.md). Cached list fetches are shared by every visitor and are sent without it.
 *  - Detail fetches are memoised per request with React `cache()`: generateMetadata and the page body share one API call.
 *  - The browser client (`publicClient(apiUrl)`) performs the form POSTs and the live availability
 *    GET, surfacing the API error envelope `{ error: { code, message } }` as `ApiError`
 *    (including 429 RATE_LIMITED with Retry-After and 409 SLOT_FULL).
 */
import { notFound } from "next/navigation";
import { cache } from "react";

import { internalApiUrl } from "@/lib/env";
import type {
  ApiErrorBody,
  BrochureRequest,
  BrochureResult,
  EnquiryRequest,
  EnquiryResult,
  GalleryResponse,
  ListEnvelope,
  PageDetail,
  Person,
  PostCard,
  PostDetail,
  ProjectCard,
  ProjectDetail,
  ProjectListFilters,
  SiteSettings,
  SiteVisitManage,
  SiteVisitRequest,
  SiteVisitRescheduleRequest,
  SiteVisitRescheduleResult,
  SiteVisitResult,
  VisitDay,
} from "@/lib/types";

export const API_PREFIX = "/api/v1/public";
const REVALIDATE_SECONDS = 60;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string";
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const retryAfterHeader = res.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  if (isErrorBody(body)) {
    return new ApiError({
      status: res.status,
      code: body.error.code,
      message: body.error.message,
      details: body.error.details,
      requestId: body.error.request_id,
      retryAfterSeconds,
    });
  }
  const code =
    res.status === 429 ? "RATE_LIMITED" : res.status === 404 ? "NOT_FOUND" : res.status >= 500 ? "SERVER_ERROR" : "HTTP_ERROR";
  return new ApiError({ status: res.status, code, message: res.statusText || `Request failed (${res.status})`, retryAfterSeconds });
}

/** Human copy for the error codes the website can meaningfully explain. */
export function friendlyErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case "RATE_LIMITED": {
        const wait = error.retryAfterSeconds ? ` Please try again in about ${error.retryAfterSeconds} seconds.` : " Please try again in a minute.";
        return `You have sent a few requests in quick succession.${wait}`;
      }
      case "SLOT_FULL":
        return "That slot has just filled up. We have refreshed the available times — please pick another.";
      case "SLOT_INVALID":
        return "That time is not open for visits any more. Please pick another slot.";
      case "LINK_EXPIRED":
        return "This visit link has expired. Use the link in your latest confirmation, or book a new visit.";
      case "GONE":
        return error.message || "This feature has been retired. Please refresh the page.";
      case "VALIDATION_ERROR":
        return error.message || "Please check the highlighted fields and try again.";
      case "NOT_FOUND":
        return "We could not find that item. It may no longer be available.";
      case "NETWORK":
        return "We could not reach our servers. Please check your connection and try again.";
      default:
        return error.message || "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Server-side fetchers
// ---------------------------------------------------------------------------

type FetchResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

interface ServerGetOptions {
  tags: string[];
  /** Seconds. Defaults to 60; pass 0 for no-store. */
  revalidate?: number;
  params?: Record<string, string | undefined>;
}

function buildQuery(params: Record<string, string | undefined> | undefined): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Valid `x-forwarded-for` chain: comma-separated IPv4/IPv6 tokens only (anything else is dropped, never forwarded). */
export function sanitizeForwardedFor(value: string | null | undefined): string | null {
  if (!value) return null;
  const hops = value
    .split(",")
    .map((h) => h.trim())
    .filter((h) => /^[0-9a-fA-F:.]{2,45}$/.test(h) && (h.includes(".") || h.includes(":")));
  if (hops.length === 0) return null;
  return hops.slice(-10).join(", ");
}

/**
 * Forwarding headers for an uncached server fetch: the visitor chain the web server received (`x-forwarded-for`, set by the
 * reverse proxy / Next.js server) or, failing that, `x-real-ip`. Outside a request (build, sitemap generation) there is none.
 */
export async function visitorForwardHeaders(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") return {};
  try {
    // dynamic import: this module is shared with client components, where next/headers must not be imported
    const { headers } = await import("next/headers");
    const h = await headers();
    const chain = sanitizeForwardedFor(h.get("x-forwarded-for")) ?? sanitizeForwardedFor(h.get("x-real-ip"));
    return chain ? { "x-forwarded-for": chain } : {};
  } catch {
    return {};
  }
}

async function serverGet<T>(path: string, options: ServerGetOptions): Promise<FetchResult<T>> {
  const url = `${internalApiUrl()}${API_PREFIX}${path}${buildQuery(options.params)}`;
  const revalidate = options.revalidate ?? REVALIDATE_SECONDS;
  // Only uncached requests carry the visitor's address: a header on a cached fetch would split the Data Cache per visitor.
  const forward = revalidate === 0 ? await visitorForwardHeaders() : {};
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ...forward },
      ...(revalidate === 0 ? { cache: "no-store" as const } : { next: { revalidate, tags: options.tags } }),
    });
    if (!res.ok) {
      const error = await errorFromResponse(res);
      return { ok: false, status: res.status, error };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (cause) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[web] public API unreachable: GET ${url} — ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return {
      ok: false,
      status: 0,
      error: new ApiError({ status: 0, code: "NETWORK", message: "Public API unreachable" }),
    };
  }
}

/**
 * Detail resources are fetched without the Next.js Data Cache. The cache only stores 200s and keeps serving the last
 * good entry while a revalidation returns anything else, so a project/post/page that is unpublished (API → 404) would
 * stay live on the website until the server restarts. The API answers these from its own 60 s cache, so the cost is
 * one small request per render.
 */
const DETAIL: Pick<ServerGetOptions, "revalidate"> = { revalidate: 0 };

/** Resolves a detail fetch: 404 → notFound(), other failures → throw (rendered by error.tsx). */
function unwrapDetail<T>(result: FetchResult<T>): T {
  if (result.ok) return result.data;
  if (result.status === 404) notFound();
  throw result.error;
}

function unwrapOr<T>(result: FetchResult<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export async function getSiteSettings(): Promise<SiteSettings | null> {
  return unwrapOr(await serverGet<SiteSettings>("/site", { tags: ["site"] }), null);
}

export async function listProjects(filters: ProjectListFilters = {}): Promise<ProjectCard[]> {
  const result = await serverGet<ProjectCard[] | ListEnvelope<ProjectCard>>("/projects", {
    tags: ["projects"],
    params: { city: filters.city, status: filters.status, bhk: filters.bhk, q: filters.q },
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : result.data.items;
}

/** One project detail fetch per request (React cache): metadata and page body share it. */
const projectDetail = cache((slug: string) =>
  serverGet<ProjectDetail>(`/projects/${encodeURIComponent(slug)}`, { tags: ["projects", `project:${slug}`], ...DETAIL }),
);

export async function getProject(slug: string): Promise<ProjectDetail> {
  return unwrapDetail(await projectDetail(slug));
}

/** Same as getProject but never throws — used for metadata and the sitemap. */
export async function findProject(slug: string): Promise<ProjectDetail | null> {
  return unwrapOr(await projectDetail(slug), null);
}

export async function getVisitAvailability(slug: string, from: string, to: string): Promise<VisitDay[]> {
  return unwrapOr(
    await serverGet<VisitDay[]>(`/projects/${encodeURIComponent(slug)}/visit-availability`, {
      tags: [`visits:${slug}`],
      params: { from, to },
      revalidate: 0,
    }),
    [],
  );
}

export async function listPosts(page = 1): Promise<ListEnvelope<PostCard>> {
  return unwrapOr(
    await serverGet<ListEnvelope<PostCard>>("/posts", { tags: ["posts"], params: { page: String(page) } }),
    { items: [], total: 0, page, page_size: 25, next_cursor: null },
  );
}

const postDetail = cache((slug: string) => serverGet<PostDetail>(`/posts/${encodeURIComponent(slug)}`, { tags: ["posts", `post:${slug}`], ...DETAIL }));

export async function getPost(slug: string): Promise<PostDetail> {
  return unwrapDetail(await postDetail(slug));
}

export async function findPost(slug: string): Promise<PostDetail | null> {
  return unwrapOr(await postDetail(slug), null);
}

const pageDetail = cache((slug: string) => serverGet<PageDetail>(`/pages/${encodeURIComponent(slug)}`, { tags: ["pages", `page:${slug}`], ...DETAIL }));

export async function getPage(slug: string): Promise<PageDetail> {
  return unwrapDetail(await pageDetail(slug));
}

export async function findPage(slug: string): Promise<PageDetail | null> {
  return unwrapOr(await pageDetail(slug), null);
}

export async function getGallery(projectSlug?: string): Promise<GalleryResponse> {
  const result = await serverGet<GalleryResponse | GalleryResponse["items"]>("/gallery", {
    tags: ["gallery"],
    params: { project: projectSlug },
  });
  if (!result.ok) return { items: [], projects: [] };
  return Array.isArray(result.data) ? { items: result.data, projects: [] } : result.data;
}

export async function getPeople(): Promise<Person[]> {
  const result = await serverGet<Person[] | ListEnvelope<Person>>("/people", { tags: ["people"] });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : result.data.items;
}

/** Manage view for a signed visit token. Never cached: cancelling changes it immediately. */
const visitDetail = cache((token: string) => serverGet<SiteVisitManage>(`/site-visits/${encodeURIComponent(token)}`, { tags: [], revalidate: 0 }));

export async function getVisit(token: string): Promise<SiteVisitManage> {
  return unwrapDetail(await visitDetail(token));
}

// ---------------------------------------------------------------------------
// URL builders (shared)
// ---------------------------------------------------------------------------

export function visitIcsUrl(apiUrl: string, token: string): string {
  return `${apiUrl}${API_PREFIX}/site-visits/${encodeURIComponent(token)}.ics`;
}

export function brochureStreamUrl(apiUrl: string, token: string): string {
  return `${apiUrl}${API_PREFIX}/brochure/${encodeURIComponent(token)}`;
}

/** Resolves an API-provided URL that may be relative to the API origin. */
export function absoluteApiUrl(apiUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ---------------------------------------------------------------------------
// Browser client (form POSTs + live availability)
// ---------------------------------------------------------------------------

async function browserRequest<TResponse>(apiUrl: string, path: string, init: RequestInit): Promise<TResponse> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${API_PREFIX}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError({ status: 0, code: "NETWORK", message: "Network error" });
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as TResponse;
  return (await res.json()) as TResponse;
}

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface PublicClient {
  createEnquiry(body: EnquiryRequest): Promise<EnquiryResult>;
  requestBrochure(body: BrochureRequest): Promise<BrochureResult>;
  bookSiteVisit(body: SiteVisitRequest): Promise<SiteVisitResult>;
  cancelSiteVisit(token: string): Promise<SiteVisitManage | undefined>;
  /** POST /public/site-visits/:token/reschedule — 410 LINK_EXPIRED, 409 SLOT_FULL, 422 SLOT_INVALID. */
  rescheduleSiteVisit(token: string, body: SiteVisitRescheduleRequest): Promise<SiteVisitRescheduleResult>;
  getVisitAvailability(slug: string, from: string, to: string): Promise<VisitDay[]>;
}

export function publicClient(apiUrl: string): PublicClient {
  const post = <TReq, TRes>(path: string, body: TReq): Promise<TRes> =>
    browserRequest<TRes>(apiUrl, path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "idempotency-key": idempotencyKey() },
    });

  return {
    createEnquiry: (body) => post<EnquiryRequest, EnquiryResult>("/enquiries", body),
    requestBrochure: (body) => post<BrochureRequest, BrochureResult>("/brochure-requests", body),
    bookSiteVisit: (body) => post<SiteVisitRequest, SiteVisitResult>("/site-visits", body),
    cancelSiteVisit: (token) =>
      browserRequest<SiteVisitManage | undefined>(apiUrl, `/site-visits/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    rescheduleSiteVisit: (token, body) => post<SiteVisitRescheduleRequest, SiteVisitRescheduleResult>(`/site-visits/${encodeURIComponent(token)}/reschedule`, body),
    getVisitAvailability: (slug, from, to) =>
      browserRequest<VisitDay[]>(
        apiUrl,
        `/projects/${encodeURIComponent(slug)}/visit-availability${buildQuery({ from, to })}`,
        { method: "GET" },
      ),
  };
}
