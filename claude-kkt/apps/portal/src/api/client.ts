// The ONLY place the portal talks HTTP. Fetch-based, typed against @kkt/contracts (Appendix C).
//  - base: EXPO_PUBLIC_API_URL + /api/v1/portal
//  - access token in memory; refresh token in SecureStore (native) / localStorage (web)
//  - single-flight refresh on 401 TOKEN_EXPIRED (and proactively when only a refresh token exists)
//  - Idempotency-Key on every POST; error envelope parsed into ApiError
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import {
  type PortalBankDetails,
  type PortalBookingSwitcherItem,
  type PortalChangePassword,
  type PortalConstructionTimelineResponse,
  type PortalDemandListResponse,
  type PortalDocumentListResponse,
  type PortalDocumentRow,
  type PortalHomeResponse,
  type PortalLedgerResponse,
  type PortalLogin,
  type PortalLoginResponse,
  type PortalMarkRead,
  type PortalMyFlatResponse,
  type PortalNoticeListResponse,
  type PortalNotificationListResponse,
  type PortalPdfLinkResponse,
  type PortalProfileResponse,
  type PortalProfileUpdate,
  type PortalReceiptListResponse,
  type PortalRequestCreate,
  type PortalRequestDetailResponse,
  type PortalRequestListResponse,
  type PortalRequestMessageCreate,
  type PortalRequestRate,
  type PortalRequestReopen,
  type PortalScheduleResponse,
  type PortalSessionRow,
  type PortalUser,
  type ServicePriority,
  type ServiceStatus,
  type TokenPair,
} from "@kkt/contracts";
import { secureStorage } from "@/lib/storage";
import { noteDeprecation } from "./deprecation";
import { ApiError, apiErrorFromBody } from "./errors";
import { buildMultipart, type LocalFile } from "@/lib/upload";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
export const PORTAL_BASE = `${API_ORIGIN}/api/v1/portal`;
export const ERP_URL = process.env.EXPO_PUBLIC_ERP_URL ?? "";

const REFRESH_KEY = "kkt.portal.refresh";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export { ApiError, errorMessage, isApiErrorInstance, type ClientErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshLoaded = false;

type SessionListener = (event: "expired") => void;
const sessionListeners = new Set<SessionListener>();

export const session = {
  get accessToken(): string | null {
    return accessToken;
  },
  get hasRefreshToken(): boolean {
    return refreshToken !== null;
  },
  async load(): Promise<boolean> {
    if (!refreshLoaded) {
      refreshToken = await secureStorage.get(REFRESH_KEY);
      refreshLoaded = true;
    }
    return refreshToken !== null;
  },
  async setTokens(pair: Pick<TokenPair, "access_token" | "refresh_token">): Promise<void> {
    accessToken = pair.access_token;
    refreshToken = pair.refresh_token;
    refreshLoaded = true;
    await secureStorage.set(REFRESH_KEY, pair.refresh_token);
  },
  async clear(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    refreshLoaded = true;
    await secureStorage.remove(REFRESH_KEY);
  },
  onExpired(listener: SessionListener): () => void {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  },
};

function notifyExpired(): void {
  for (const l of sessionListeners) l("expired");
}

// ---------------------------------------------------------------------------
// Low-level transport
// ---------------------------------------------------------------------------

interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  query?: Query;
  auth?: boolean;
  /** Set when the call is itself the refresh/login call (never triggers a refresh). */
  noRefresh?: boolean;
  idempotencyKey?: string;
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // RFC 4122 v4 fallback for runtimes without crypto.randomUUID.
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else {
      const r = Math.floor(Math.random() * 16);
      out += (i === 19 ? (r & 0x3) | 0x8 : r).toString(16);
    }
  }
  return out;
}

export function newIdempotencyKey(): string {
  return uuid();
}

function buildUrl(path: string, query?: Query): string {
  const url = `${PORTAL_BASE}${path}`;
  if (!query) return url;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `${url}?${parts.join("&")}` : url;
}

async function send(url: string, o: RequestOptions, token: string | null): Promise<HttpResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token && o.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;
  let body: string | FormData | undefined;
  if (o.form) {
    body = o.form; // the runtime adds the multipart boundary; never set Content-Type here
  } else if (o.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  const init = { method: o.method ?? "GET", headers, body };
  // Multipart on native must go through expo/fetch (it can serialise Blob parts read from file://).
  if (o.form && Platform.OS !== "web") return expoFetch(url, init);
  return fetch(url, init);
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function toApiError(res: HttpResponse): Promise<ApiError> {
  const retryAfterHeader = res.headers.get("Retry-After");
  const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  const ids = { requestId: res.headers.get("X-Request-Id") ?? undefined, traceId: res.headers.get("X-Trace-Id") ?? undefined };
  return apiErrorFromBody(res.status, parseJson(await res.text()), retryAfterSeconds, ids);
}

// Single-flight refresh: concurrent 401s share one refresh call.
let refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  await session.load();
  if (!refreshToken) throw new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "Please sign in again." });
  let res: HttpResponse;
  try {
    res = await send(buildUrl("/auth/refresh"), { method: "POST", body: { refresh_token: refreshToken }, auth: false }, null);
  } catch {
    throw new ApiError({ status: 0, code: "NETWORK", message: "Can't reach KKT right now. Check your internet connection." });
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401 || res.status === 403) {
      await session.clear();
      notifyExpired();
    }
    throw err;
  }
  const pair = parseJson(await res.text()) as TokenPair;
  await session.setTokens(pair);
  return pair.access_token;
}

export function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, o.query);
  const needsAuth = o.auth !== false;
  let token = accessToken;
  // Cold start: we only hold a refresh token → get an access token first (single-flight).
  if (needsAuth && !token && !o.noRefresh) {
    await session.load();
    if (refreshToken) token = await refreshAccessToken();
  }
  let res: HttpResponse;
  try {
    res = await send(url, o, token);
    noteDeprecation(path, res.headers);
    if (res.status === 401 && needsAuth && !o.noRefresh) {
      const err = await toApiError(res);
      if (err.code === "TOKEN_EXPIRED" || err.code === "UNAUTHENTICATED") {
        await session.load();
        if (refreshToken) {
          const fresh = await refreshAccessToken();
          res = await send(url, o, fresh);
          noteDeprecation(path, res.headers);
        } else {
          notifyExpired();
          throw err;
        }
      } else {
        throw err;
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError({ status: 0, code: "NETWORK", message: "Can't reach KKT right now. Check your internet connection." });
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401 && needsAuth && !o.noRefresh) notifyExpired();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return parseJson(await res.text()) as T;
}

const get = <T>(path: string, query?: Query) => request<T>(path, { query });
const post = <T>(path: string, body?: unknown, extra: Omit<RequestOptions, "method" | "body"> = {}) =>
  request<T>(path, { method: "POST", body: body ?? {}, idempotencyKey: extra.idempotencyKey ?? newIdempotencyKey(), ...extra });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** Accepts either a bare array or a `{ items }` envelope (sessions/bookings shapes are arrays in Appendix C). */
function itemsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) return (value as { items: T[] }).items;
  return [];
}

// ---------------------------------------------------------------------------
// Typed endpoints (Appendix C)
// ---------------------------------------------------------------------------

export interface PageQuery {
  page?: number;
  page_size?: number;
}

/** Not in Appendix C: the portal needs service-request categories to fill `category_id`. */
export interface PortalRequestCategory {
  id: string;
  name: string;
  default_priority: ServicePriority;
}

export const api = {
  auth: {
    login: (body: PortalLogin) => request<PortalLoginResponse>("/auth/login", { method: "POST", body, auth: false, noRefresh: true }),
    refresh: () => refreshAccessToken(),
    logout: (body: { refresh_token?: string; all_devices?: boolean }) => request<void>("/auth/logout", { method: "POST", body, noRefresh: true }),
    me: () => get<PortalUser>("/auth/me"),
    changePassword: (body: PortalChangePassword) => post<void>("/auth/change-password", body),
    sessions: async () => itemsOf<PortalSessionRow>(await get<unknown>("/auth/sessions")),
    revokeSession: (id: string) => del<void>(`/auth/sessions/${encodeURIComponent(id)}`),
    revokeOtherSessions: () => del<void>("/auth/sessions"),
  },
  bookings: {
    list: async () => itemsOf<PortalBookingSwitcherItem>(await get<unknown>("/bookings")),
    home: (id: string) => get<PortalHomeResponse>(`/bookings/${id}/home`),
    flat: (id: string) => get<PortalMyFlatResponse>(`/bookings/${id}/flat`),
    ledger: (id: string, q: PageQuery = {}) => get<PortalLedgerResponse>(`/bookings/${id}/ledger`, { page: q.page, page_size: q.page_size ?? 200 }),
    receipts: (id: string, q: PageQuery = {}) => get<PortalReceiptListResponse>(`/bookings/${id}/receipts`, { page: q.page, page_size: q.page_size ?? 200 }),
    receiptPdf: (id: string, paymentId: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/receipts/${paymentId}/pdf`),
    demands: (id: string, q: PageQuery = {}) => get<PortalDemandListResponse>(`/bookings/${id}/demands`, { page: q.page, page_size: q.page_size ?? 200 }),
    demandPdf: (id: string, demandId: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/demands/${demandId}/pdf`),
    schedule: (id: string) => get<PortalScheduleResponse>(`/bookings/${id}/schedule`),
    statementPdf: (id: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/statement.pdf`),
    allotmentLetterPdf: (id: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/allotment-letter.pdf`),
    construction: (id: string) => get<PortalConstructionTimelineResponse>(`/bookings/${id}/construction`),
    documents: (id: string) => get<PortalDocumentListResponse>(`/bookings/${id}/documents`),
    documentDownload: (id: string, docId: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/documents/${docId}/download`),
    bankDetails: (id: string) => get<PortalBankDetails>(`/bookings/${id}/bank-details`),
  },
  requests: {
    list: (q: { status?: ServiceStatus; booking_id?: string } & PageQuery = {}) =>
      get<PortalRequestListResponse>("/requests", { status: q.status, booking_id: q.booking_id, page: q.page, page_size: q.page_size ?? 100 }),
    get: (id: string) => get<PortalRequestDetailResponse>(`/requests/${id}`),
    create: (body: PortalRequestCreate, idempotencyKey?: string) => post<PortalRequestDetailResponse>("/requests", body, { idempotencyKey }),
    addMessage: (id: string, body: PortalRequestMessageCreate) => post<PortalRequestDetailResponse>(`/requests/${id}/messages`, body),
    reopen: (id: string, body: PortalRequestReopen) => post<PortalRequestDetailResponse>(`/requests/${id}/reopen`, body),
    rate: (id: string, body: PortalRequestRate) => post<PortalRequestDetailResponse>(`/requests/${id}/rate`, body),
    /** One file per call; `messageId` (one of the customer's own messages, e.g. the opening message after create) appends it to that message. */
    uploadAttachment: async (id: string, file: LocalFile, opts: { messageId?: string } = {}) =>
      request<PortalDocumentRow>(`/requests/${id}/attachments`, { method: "POST", form: await buildMultipart("file", file, opts.messageId ? { message_id: opts.messageId } : {}), idempotencyKey: newIdempotencyKey() }),
    categories: async () => itemsOf<PortalRequestCategory>(await get<unknown>("/requests/categories")),
  },
  notices: {
    list: (q: PageQuery = {}) => get<PortalNoticeListResponse>("/notices", { page: q.page, page_size: q.page_size ?? 100 }),
  },
  notifications: {
    list: (q: PageQuery = {}) => get<PortalNotificationListResponse>("/notifications", { page: q.page, page_size: q.page_size ?? 100 }),
    unreadCount: () => get<{ count: number }>("/notifications/unread-count"),
    markRead: (body: PortalMarkRead) => post<void>("/notifications/mark-read", body),
  },
  profile: {
    get: () => get<PortalProfileResponse>("/profile"),
    update: (body: PortalProfileUpdate) => patch<PortalProfileResponse>("/profile", body),
  },
};

export type Api = typeof api;
