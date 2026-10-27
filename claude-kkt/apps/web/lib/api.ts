/**
 * The single typed module for every call the website makes to the public API
 * (docs/API-CONVENTIONS.md, Appendix B).
 *
 *  - Server fetchers (`get*`, `list*`) run in Server Components against the in-cluster API_INTERNAL_URL. Every read is
 *    cached for ISR (`unstable_cache`, tag `kkt-public`): catalog data 60 s, CMS content 300 s, purged on demand by the API
 *    after CMS / project-website writes (app/api/revalidate). A 404 is cached like any answer, so an unpublished project
 *    disappears; a 5xx or network failure is never cached (retried once with a 10 s lifetime) and degrades to an empty
 *    fallback for lists or to the error boundary for details. A 404 on a detail resource becomes `notFound()`.
 *  - Every server call carries `x-kkt-internal-token` (INTERNAL_API_TOKEN, contract C3) and `x-kkt-company`
 *    (KKT_COMPANY_SLUG, contract C4) when configured. Per-visitor (uncached) calls also forward the visitor's address as
 *    `x-kkt-client-ip` (+ the sanitised `x-forwarded-for` chain), so the API's per-IP limits apply per visitor.
 *  - Detail fetches are memoised per request with React `cache()`: generateMetadata and the page body share one call.
 *  - The browser client (`publicClient(apiUrl, companySlug)`) performs the form POSTs and the live availability
 *    GET, surfacing the API error envelope `{ error: { code, message } }` as `ApiError`
 *    (including 429 RATE_LIMITED with Retry-After and 409 SLOT_FULL).
 */
import { notFound } from "next/navigation";
import { cache } from "react";

import { companySlug, internalApiToken, internalApiUrl } from "@/lib/env";
import type {
  ApiErrorBody,
  BrochureRepeatRequest,
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
  SitemapEntry,
  VisitDay,
} from "@/lib/types";

export const API_PREFIX = "/api/v1/public";

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
  let body: unknown;
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
    res.status === 429
      ? "RATE_LIMITED"
      : res.status === 404
        ? "NOT_FOUND"
        : res.status >= 500
          ? "SERVER_ERROR"
          : "HTTP_ERROR";
  return new ApiError({
    status: res.status,
    code,
    message: res.statusText || `Request failed (${res.status})`,
    retryAfterSeconds,
  });
}

/** Human copy for the error codes the website can meaningfully explain. */
export function friendlyErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case "RATE_LIMITED": {
        const wait = error.retryAfterSeconds
          ? ` Please try again in about ${error.retryAfterSeconds} seconds.`
          : " Please try again in a minute.";
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

/** Serialisable outcome of one API GET (what the Data Cache stores: a 404 is an answer worth caching, a 5xx is not). */
type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/** Tag on every cached API read: the API's on-demand revalidation (POST /api/revalidate) purges them all at once. */
export const PUBLIC_TAG = "kkt-public";

/** Catalog data (projects, prices, availability grids) is refreshed every minute; CMS content every five (and on demand). */
export const CATALOG_REVALIDATE_SECONDS = 60;
export const CMS_REVALIDATE_SECONDS = 300;
/** Seconds a page rendered while the API was unreachable is kept before it is regenerated. */
export const RETRY_REVALIDATE_SECONDS = 10;

interface ServerGetOptions {
  tags: string[];
  /** Seconds the answer may be reused (ISR / Data Cache). 0 = per visitor, never cached (forwards the visitor's address). */
  revalidate: number;
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
 * Forwarding headers for an uncached (per-visitor) server fetch (contract C3): `x-kkt-client-ip` = the visitor's address (the right-most
 * hop of the `x-forwarded-for` chain the reverse proxy set, or `x-real-ip`), honoured by the API only together with a valid
 * `x-kkt-internal-token`; plus the sanitised `x-forwarded-for` chain for APIs that trust the web server as a proxy instead. Outside a
 * request (build, ISR regeneration, sitemap) there is no visitor and nothing is forwarded.
 */
export async function visitorForwardHeaders(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") return {};
  try {
    // dynamic import: this module is shared with client components, where next/headers must not be imported
    const { headers } = await import("next/headers");
    const h = await headers();
    const chain = sanitizeForwardedFor(h.get("x-forwarded-for")) ?? sanitizeForwardedFor(h.get("x-real-ip"));
    if (!chain) return {};
    const visitor = chain.split(",").at(-1)!.trim();
    return { "x-forwarded-for": chain, "x-kkt-client-ip": visitor };
  } catch {
    return {};
  }
}

/** Headers every server-side call carries: the internal token (contract C3) and the company slug (contract C4), when configured. */
export function serverIdentityHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  const token = internalApiToken();
  if (token) out["x-kkt-internal-token"] = token;
  const company = companySlug();
  if (company) out["x-kkt-company"] = company;
  return out;
}

/** One GET to the public API, never through the fetch-level Data Cache. Network failures throw. */
async function fetchOutcome<T>(url: string, headers: Record<string, string>): Promise<Outcome<T>> {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, cache: "no-store" });
  if (!res.ok) {
    const error = await errorFromResponse(res);
    return {
      ok: false,
      status: res.status,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return { ok: true, data: (await res.json()) as T };
}

function toResult<T>(outcome: Outcome<T>): FetchResult<T> {
  if (outcome.ok) return outcome;
  return {
    ok: false,
    status: outcome.status,
    error: new ApiError({
      status: outcome.status,
      code: outcome.code,
      message: outcome.message,
      ...(outcome.details ? { details: outcome.details } : {}),
    }),
  };
}

/** A 5xx / 429 is a transient failure: thrown inside the cache scope so it is never stored. */
class TransientFailure extends Error {
  readonly outcome: Outcome<never>;
  constructor(outcome: Outcome<never>) {
    super("transient API failure");
    this.outcome = outcome;
  }
}

/**
 * Cached read (ISR): the answer — including a 404, so an unpublished project/post disappears instead of the last good copy being served
 * forever — is kept in the Data Cache for `revalidate` seconds under the `kkt-public` tag (purged on demand by the API after CMS and
 * project-website writes). A transient failure is not stored: the call is retried once with a 10 s lifetime, which also shortens the
 * page's own revalidation, so a page rendered while the API was away regenerates within seconds instead of minutes.
 */
async function cachedOutcome<T>(url: string, revalidate: number, tags: string[]): Promise<Outcome<T>> {
  const { unstable_cache } = await import("next/cache");
  const headers = serverIdentityHeaders();
  const load = async (u: string): Promise<Outcome<T>> => {
    const outcome = await fetchOutcome<T>(u, headers);
    if (!outcome.ok && (outcome.status >= 500 || outcome.status === 429))
      throw new TransientFailure(outcome as Outcome<never>);
    return outcome;
  };
  const keyParts = ["kkt-public-get", headers["x-kkt-company"] ?? ""];
  const cacheTags = [PUBLIC_TAG, ...tags];
  try {
    return await unstable_cache(load, keyParts, { revalidate, tags: cacheTags })(url);
  } catch {
    return await unstable_cache(load, [...keyParts, "retry"], {
      revalidate: RETRY_REVALIDATE_SECONDS,
      tags: cacheTags,
    })(url);
  }
}

async function serverGet<T>(path: string, options: ServerGetOptions): Promise<FetchResult<T>> {
  const url = `${internalApiUrl()}${API_PREFIX}${path}${buildQuery(options.params)}`;
  try {
    if (options.revalidate === 0)
      return toResult(await fetchOutcome<T>(url, { ...serverIdentityHeaders(), ...(await visitorForwardHeaders()) }));
    return toResult(await cachedOutcome<T>(url, options.revalidate, options.tags));
  } catch (cause) {
    if (cause instanceof TransientFailure) return toResult(cause.outcome);
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        `[web] public API unreachable: GET ${url} — ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return {
      ok: false,
      status: 0,
      error: new ApiError({ status: 0, code: "NETWORK", message: "Public API unreachable" }),
    };
  }
}

/** Resolves a detail fetch: 404 → notFound(), other failures → throw (rendered by error.tsx). */
function unwrapDetail<T>(result: FetchResult<T>): T {
  if (result.ok) return result.data;
  if (result.status === 404) notFound();
  throw result.error;
}

/** True while `next build` prerenders the static routes: no API is expected to be reachable then. */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function unwrapOr<T>(result: FetchResult<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export async function getSiteSettings(): Promise<SiteSettings | null> {
  return unwrapOr(await serverGet<SiteSettings>("/site", { tags: ["site"], revalidate: CMS_REVALIDATE_SECONDS }), null);
}

export async function listProjects(filters: ProjectListFilters = {}): Promise<ProjectCard[]> {
  const result = await serverGet<ProjectCard[] | ListEnvelope<ProjectCard>>("/projects", {
    tags: ["projects"],
    revalidate: CATALOG_REVALIDATE_SECONDS,
    params: { city: filters.city, status: filters.status, bhk: filters.bhk, q: filters.q },
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : result.data.items;
}

/** One project detail fetch per request (React cache): metadata and page body share it. */
const projectDetail = cache((slug: string) =>
  serverGet<ProjectDetail>(`/projects/${encodeURIComponent(slug)}`, {
    tags: ["projects", `project:${slug}`],
    revalidate: CATALOG_REVALIDATE_SECONDS,
  }),
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
    await serverGet<ListEnvelope<PostCard>>("/posts", {
      tags: ["posts"],
      params: { page: String(page) },
      revalidate: CMS_REVALIDATE_SECONDS,
    }),
    { items: [], total: 0, page, page_size: 25, next_cursor: null },
  );
}

const postDetail = cache((slug: string) =>
  serverGet<PostDetail>(`/posts/${encodeURIComponent(slug)}`, {
    tags: ["posts", `post:${slug}`],
    revalidate: CMS_REVALIDATE_SECONDS,
  }),
);

export async function getPost(slug: string): Promise<PostDetail> {
  return unwrapDetail(await postDetail(slug));
}

export async function findPost(slug: string): Promise<PostDetail | null> {
  return unwrapOr(await postDetail(slug), null);
}

const pageDetail = cache((slug: string) =>
  serverGet<PageDetail>(`/pages/${encodeURIComponent(slug)}`, {
    tags: ["pages", `page:${slug}`],
    revalidate: CMS_REVALIDATE_SECONDS,
  }),
);

/**
 * A published CMS page; 404 → notFound(). During `next build` (no API) an unreachable API yields null — the prerendered placeholder is
 * regenerated within seconds of the first request (see RETRY_REVALIDATE_SECONDS) — while at runtime it throws to the error boundary.
 */
export async function getPage(slug: string): Promise<PageDetail | null> {
  const result = await pageDetail(slug);
  if (!result.ok && result.status === 0 && isBuildPhase()) return null;
  return unwrapDetail(result);
}

export async function findPage(slug: string): Promise<PageDetail | null> {
  return unwrapOr(await pageDetail(slug), null);
}

export async function getGallery(projectSlug?: string): Promise<GalleryResponse> {
  const result = await serverGet<GalleryResponse | GalleryResponse["items"]>("/gallery", {
    tags: ["gallery"],
    params: { project: projectSlug },
    revalidate: CMS_REVALIDATE_SECONDS,
  });
  if (!result.ok) return { items: [], projects: [] };
  return Array.isArray(result.data) ? { items: result.data, projects: [] } : result.data;
}

export async function getPeople(): Promise<Person[]> {
  const result = await serverGet<Person[] | ListEnvelope<Person>>("/people", {
    tags: ["people"],
    revalidate: CMS_REVALIDATE_SECONDS,
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : result.data.items;
}

/** Every public URL with its lastmod (GET /public/sitemap): all posts, CMS pages, projects and the static pages. */
export async function getSitemap(): Promise<SitemapEntry[] | null> {
  const result = await serverGet<{ entries: SitemapEntry[] }>("/sitemap", {
    tags: ["sitemap"],
    revalidate: CMS_REVALIDATE_SECONDS,
  });
  return result.ok ? result.data.entries : null;
}

/** Manage view for a signed visit token. Never cached: cancelling changes it immediately. */
const visitDetail = cache((token: string) =>
  serverGet<SiteVisitManage>(`/site-visits/${encodeURIComponent(token)}`, { tags: [], revalidate: 0 }),
);

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

async function browserFetch<TResponse>(apiUrl: string, path: string, init: RequestInit): Promise<TResponse> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${API_PREFIX}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
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
  requestBrochure(body: BrochureRequest | BrochureRepeatRequest): Promise<BrochureResult>;
  bookSiteVisit(body: SiteVisitRequest): Promise<SiteVisitResult>;
  cancelSiteVisit(token: string): Promise<SiteVisitManage | undefined>;
  /** POST /public/site-visits/:token/reschedule — 410 LINK_EXPIRED, 409 SLOT_FULL, 422 SLOT_INVALID. */
  rescheduleSiteVisit(token: string, body: SiteVisitRescheduleRequest): Promise<SiteVisitRescheduleResult>;
  getVisitAvailability(slug: string, from: string, to: string): Promise<VisitDay[]>;
}

/**
 * Browser client. `companySlug` (KKT_COMPANY_SLUG, via SiteConfig) is sent as `x-kkt-company` (contract C4) when the website serves one
 * builder of a multi-company API; single-company deployments leave it unset and the API resolves the only company.
 */
export function publicClient(apiUrl: string, companySlug?: string | null): PublicClient {
  const tenant: Record<string, string> = companySlug ? { "x-kkt-company": companySlug } : {};
  const browserRequest = <T>(base: string, path: string, init: RequestInit): Promise<T> =>
    browserFetch<T>(base, path, { ...init, headers: { ...tenant, ...(init.headers as Record<string, string>) } });
  const post = <TReq, TRes>(path: string, body: TReq): Promise<TRes> =>
    browserRequest<TRes>(apiUrl, path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "idempotency-key": idempotencyKey() },
    });

  return {
    createEnquiry: (body) => post<EnquiryRequest, EnquiryResult>("/enquiries", body),
    requestBrochure: (body) =>
      post<BrochureRequest | BrochureRepeatRequest, BrochureResult>("/brochure-requests", body),
    bookSiteVisit: (body) => post<SiteVisitRequest, SiteVisitResult>("/site-visits", body),
    cancelSiteVisit: (token) =>
      browserRequest<SiteVisitManage | undefined>(apiUrl, `/site-visits/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    rescheduleSiteVisit: (token, body) =>
      post<SiteVisitRescheduleRequest, SiteVisitRescheduleResult>(
        `/site-visits/${encodeURIComponent(token)}/reschedule`,
        body,
      ),
    getVisitAvailability: (slug, from, to) =>
      browserRequest<VisitDay[]>(
        apiUrl,
        `/projects/${encodeURIComponent(slug)}/visit-availability${buildQuery({ from, to })}`,
        { method: "GET" },
      ),
  };
}
