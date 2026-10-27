// The ONLY place the portal talks HTTP. Fetch-based, typed against @kkt/contracts (Appendix C).
//  - base: EXPO_PUBLIC_API_URL + /api/v1/portal
//  - sessions (contract C1, src/api/session.ts): access token in memory only; web uses the HttpOnly refresh cookie (X-KKT-Session:
//    cookie, nothing token-like in localStorage), native keeps the refresh token in SecureStore and sends it in the body
//  - single-flight refresh on 401 TOKEN_EXPIRED (and proactively on cold start, which restores the session); 401 SESSION_EXPIRED
//    (past the absolute lifetime) signs out
//  - If-Match: "v<version>" when the caller passes a version (contract C6)
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
  type PortalAuthLogin,
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
import { fetchAllPages } from "./paging";
import { createSession, tokenSubject } from "./session";
import { noteDeprecation } from "./deprecation";
import { ApiError, apiErrorFromBody } from "./errors";
import { buildMultipart, type LocalFile } from "@/lib/upload";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
export const PORTAL_BASE = `${API_ORIGIN}/api/v1/portal`;
export const ERP_URL = process.env.EXPO_PUBLIC_ERP_URL ?? "";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export { ApiError, errorMessage, isApiErrorInstance, type ClientErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** The session (src/api/session.ts): cookie transport in the browser, SecureStore + body mode in the native apps. */
export const session = createSession(Platform.OS === "web" ? "cookie" : "body", secureStorage);

function notifyExpired(): void {
  session.notifyExpired();
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
  /** Login / refresh / logout: the session transport (web: `X-KKT-Session: cookie` + credentials, so the API manages kkt_prt). */
  sessionTransport?: boolean;
  /** Resource version → `If-Match: "v<version>"` (contract C6). */
  version?: number;
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
  if (typeof o.version === "number") headers["If-Match"] = `"v${o.version}"`;
  let credentials: "include" | undefined;
  if (o.sessionTransport) {
    const transport = session.authTransport();
    Object.assign(headers, transport.headers);
    if (transport.includeCredentials) credentials = "include";
  }
  let body: string | FormData | undefined;
  if (o.form) {
    body = o.form; // the runtime adds the multipart boundary; never set Content-Type here
  } else if (o.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  const init = { method: o.method ?? "GET", headers, body, ...(credentials ? { credentials } : {}) };
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
  const ids = {
    requestId: res.headers.get("X-Request-Id") ?? undefined,
    traceId: res.headers.get("X-Trace-Id") ?? undefined,
  };
  return apiErrorFromBody(res.status, parseJson(await res.text()), retryAfterSeconds, ids);
}

// Single-flight refresh: concurrent 401s share one refresh call.
let refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  if (!(await session.load()))
    throw new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "Please sign in again." });
  let res: HttpResponse;
  try {
    res = await send(
      buildUrl("/auth/refresh"),
      { method: "POST", body: session.refreshBody(), auth: false, sessionTransport: true },
      null,
    );
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK",
      message: "Can't reach KKT right now. Check your internet connection.",
    });
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
  // The kkt_prt cookie is shared by every tab: after a sign-out and a sign-in as another customer in another tab, this refresh returns
  // THAT customer's token. Never carry on (or re-send the pending call) as someone other than the customer this tab shows.
  const before = tokenSubject(session.accessToken);
  const after = tokenSubject(pair.access_token);
  await session.setTokens(pair);
  if (before !== null && after !== null && before !== after) {
    session.notifyUserChanged();
    throw new ApiError({
      status: 409,
      code: "SESSION_CHANGED",
      message: "Another account signed in on this browser. The app has been reloaded for it.",
    });
  }
  return pair.access_token;
}

/** Web Lock that serialises cookie refreshes across tabs: a rotated refresh token is single-use, and reuse revokes the family. */
const REFRESH_LOCK = "kkt.portal.refresh.rotate";

function rotateSerialised(): Promise<string> {
  const locks = (
    globalThis.navigator as { locks?: { request<T>(name: string, cb: () => Promise<T>): Promise<T> } } | undefined
  )?.locks;
  if (session.mode !== "cookie" || !locks) return doRefresh();
  return locks.request(REFRESH_LOCK, doRefresh);
}

export function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = rotateSerialised().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, o.query);
  const needsAuth = o.auth !== false;
  let token = session.accessToken;
  // Cold start: no access token in memory but a session to restore (cookie / stored refresh token) → refresh first (single-flight).
  if (needsAuth && !token && !o.noRefresh) {
    if (await session.load()) token = await refreshAccessToken();
  }
  let res: HttpResponse;
  try {
    res = await send(url, o, token);
    noteDeprecation(path, res.headers);
    if (res.status === 401 && needsAuth && !o.noRefresh) {
      const err = await toApiError(res);
      if (err.code === "TOKEN_EXPIRED" || err.code === "UNAUTHENTICATED") {
        if (await session.load()) {
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
    throw new ApiError({
      status: 0,
      code: "NETWORK",
      message: "Can't reach KKT right now. Check your internet connection.",
    });
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
  request<T>(path, {
    method: "POST",
    body: body ?? {},
    idempotencyKey: extra.idempotencyKey ?? newIdempotencyKey(),
    ...extra,
  });
const patch = <T>(path: string, body: unknown, version?: number) =>
  request<T>(path, { method: "PATCH", body, version });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** Accepts either a bare array or a `{ items }` envelope (sessions/bookings shapes are arrays in Appendix C). */
function itemsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items))
    return (value as { items: T[] }).items;
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
    login: (body: PortalAuthLogin) =>
      request<PortalLoginResponse>("/auth/login", {
        method: "POST",
        body,
        auth: false,
        noRefresh: true,
        sessionTransport: true,
      }),
    refresh: () => refreshAccessToken(),
    /**
     * Revokes this session (or every device) and, on web, clears the kkt_prt cookie. The route needs a live access token, so an expired
     * one is refreshed first like any other call: with `noRefresh` a customer who left the app open past the access lifetime got a 401,
     * the server session stayed valid and the HttpOnly cookie stayed in the browser for up to REFRESH_ABSOLUTE_TTL_DAYS.
     */
    logout: (body: { refresh_token?: string; all_devices?: boolean }) =>
      request<void>("/auth/logout", { method: "POST", body, sessionTransport: true }),
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
    ledger: (id: string, q: PageQuery = {}) =>
      get<PortalLedgerResponse>(`/bookings/${id}/ledger`, { page: q.page, page_size: q.page_size ?? 200 }),
    /** Every ledger row (all pages, seq order): the dues shown are those after the true last row. */
    ledgerAll: (id: string) =>
      fetchAllPages((page, page_size) => get<PortalLedgerResponse>(`/bookings/${id}/ledger`, { page, page_size })),
    receipts: (id: string, q: PageQuery = {}) =>
      get<PortalReceiptListResponse>(`/bookings/${id}/receipts`, { page: q.page, page_size: q.page_size ?? 200 }),
    receiptsAll: (id: string) =>
      fetchAllPages((page, page_size) =>
        get<PortalReceiptListResponse>(`/bookings/${id}/receipts`, { page, page_size }),
      ),
    demandsAll: (id: string) =>
      fetchAllPages((page, page_size) => get<PortalDemandListResponse>(`/bookings/${id}/demands`, { page, page_size })),
    receiptPdf: (id: string, paymentId: string) =>
      get<PortalPdfLinkResponse>(`/bookings/${id}/receipts/${paymentId}/pdf`),
    demands: (id: string, q: PageQuery = {}) =>
      get<PortalDemandListResponse>(`/bookings/${id}/demands`, { page: q.page, page_size: q.page_size ?? 200 }),
    demandPdf: (id: string, demandId: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/demands/${demandId}/pdf`),
    schedule: (id: string) => get<PortalScheduleResponse>(`/bookings/${id}/schedule`),
    statementPdf: (id: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/statement.pdf`),
    allotmentLetterPdf: (id: string) => get<PortalPdfLinkResponse>(`/bookings/${id}/allotment-letter.pdf`),
    construction: (id: string) => get<PortalConstructionTimelineResponse>(`/bookings/${id}/construction`),
    documents: (id: string) => get<PortalDocumentListResponse>(`/bookings/${id}/documents`),
    documentDownload: (id: string, docId: string) =>
      get<PortalPdfLinkResponse>(`/bookings/${id}/documents/${docId}/download`),
    bankDetails: (id: string) => get<PortalBankDetails>(`/bookings/${id}/bank-details`),
  },
  requests: {
    list: (q: { status?: ServiceStatus; booking_id?: string } & PageQuery = {}) =>
      get<PortalRequestListResponse>("/requests", {
        status: q.status,
        booking_id: q.booking_id,
        page: q.page,
        page_size: q.page_size ?? 100,
      }),
    get: (id: string) => get<PortalRequestDetailResponse>(`/requests/${id}`),
    create: (body: PortalRequestCreate, idempotencyKey?: string) =>
      post<PortalRequestDetailResponse>("/requests", body, { idempotencyKey }),
    addMessage: (id: string, body: PortalRequestMessageCreate) =>
      post<PortalRequestDetailResponse>(`/requests/${id}/messages`, body),
    reopen: (id: string, body: PortalRequestReopen) =>
      post<PortalRequestDetailResponse>(`/requests/${id}/reopen`, body),
    rate: (id: string, body: PortalRequestRate) => post<PortalRequestDetailResponse>(`/requests/${id}/rate`, body),
    /** One file per call; `messageId` (one of the customer's own messages, e.g. the opening message after create) appends it to that message. */
    uploadAttachment: async (id: string, file: LocalFile, opts: { messageId?: string } = {}) =>
      request<PortalDocumentRow>(`/requests/${id}/attachments`, {
        method: "POST",
        form: await buildMultipart("file", file, opts.messageId ? { message_id: opts.messageId } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
    categories: async () => itemsOf<PortalRequestCategory>(await get<unknown>("/requests/categories")),
  },
  notices: {
    list: (q: PageQuery = {}) =>
      get<PortalNoticeListResponse>("/notices", { page: q.page, page_size: q.page_size ?? 100 }),
  },
  notifications: {
    list: (q: PageQuery = {}) =>
      get<PortalNotificationListResponse>("/notifications", { page: q.page, page_size: q.page_size ?? 100 }),
    unreadCount: () => get<{ count: number }>("/notifications/unread-count"),
    markRead: (body: PortalMarkRead) => post<void>("/notifications/mark-read", body),
  },
  profile: {
    get: () => get<PortalProfileResponse>("/profile"),
    /** `version` (when the profile carries one) → If-Match; a stale edit answers 409 VERSION_CONFLICT. */
    update: (body: PortalProfileUpdate, version?: number) => patch<PortalProfileResponse>("/profile", body, version),
  },
};

export type Api = typeof api;
