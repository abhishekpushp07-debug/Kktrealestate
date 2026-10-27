/**
 * Fetch-based API client for the KKT staff API.
 *
 * - Base URL = VITE_API_URL + "/api/v1" (empty VITE_API_URL = same origin, dev proxy).
 * - Sessions (contract C1): the access token lives in memory only; the refresh token is an HttpOnly cookie (kkt_rt, Path=/api/v1/auth)
 *   the API sets when login/refresh/logout carry `X-KKT-Session: cookie`. No script can read it and nothing token-like is stored in
 *   localStorage — only a "signed in on this browser" hint (kkt.erp.session = "1"), so a first visit does not probe /auth/refresh.
 *   On load the session is restored by a cookie refresh.
 * - 401 TOKEN_EXPIRED → single-flight POST /auth/refresh (cookie), then the request is retried once.
 * - Every POST carries an Idempotency-Key (crypto.randomUUID) unless one is supplied.
 * - `version` option → `If-Match: "v<version>"` header for optimistic concurrency (contract C6).
 * - Error envelopes {error:{code,message,details,request_id}} become ApiClientError.
 */

import { messageForError } from "./errorMessages";

/** Legacy key of the refresh token (pre-C1 builds kept it in localStorage); removed on load. */
export const LEGACY_REFRESH_TOKEN_KEY = "kkt.erp.refresh";
/** "Signed in on this browser" hint: a flag, never a token. */
export const SESSION_HINT_KEY = "kkt.erp.session";
/** Header that selects the HttpOnly refresh cookie (contract C1). */
export const SESSION_MODE_HEADER = "X-KKT-Session";
/** Web Lock name that serialises refreshes across tabs (a rotated refresh token is single-use). */
export const REFRESH_LOCK = "kkt.erp.refresh.rotate";

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
    /** Present when the API runs with tracing on (32-hex OpenTelemetry trace id). */
    trace_id?: string;
  };
}

export interface ApiClientErrorInit {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  traceId?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiClientError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.traceId = init.traceId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isVersionConflict(): boolean {
    return this.status === 409 && this.code === "VERSION_CONFLICT";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** `details.issues[]` for VALIDATION_ERROR, else []. */
  get validationIssues(): Array<{ path: string; message: string }> {
    const issues = this.details?.issues;
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue) => {
      if (typeof issue !== "object" || issue === null) return [];
      const record = issue as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path : "";
      const message = typeof record.message === "string" ? record.message : "";
      return message ? [{ path, message }] : [];
    });
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

function isEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.message === "string";
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

const FALLBACK_CODES: Readonly<Record<number, string>> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "BUSINESS_RULE",
  423: "LOCKED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "SERVICE_UNAVAILABLE",
  503: "SERVICE_UNAVAILABLE",
  504: "SERVICE_UNAVAILABLE",
};

/** Turns a failed response (status + parsed body + headers) into an ApiClientError. */
export function parseErrorEnvelope(status: number, body: unknown, headers?: Headers): ApiClientError {
  const retryAfterSeconds = parseRetryAfter(headers);
  const requestId = headers?.get("X-Request-Id") ?? undefined;
  const traceId = headers?.get("X-Trace-Id") ?? undefined;
  if (isEnvelope(body)) {
    const details =
      typeof body.error.details === "object" && body.error.details !== null ? body.error.details : undefined;
    return new ApiClientError({
      status,
      code: body.error.code,
      message: body.error.message,
      details,
      requestId: body.error.request_id ?? requestId,
      traceId: body.error.trace_id ?? traceId,
      retryAfterSeconds,
    });
  }
  const text = typeof body === "string" && body.trim() ? body.trim().slice(0, 200) : undefined;
  return new ApiClientError({
    status,
    code: FALLBACK_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"),
    message: text ?? `Request failed with status ${status}`,
    requestId,
    traceId,
    retryAfterSeconds,
  });
}

/** Human-friendly message for any thrown value (used by toasts and forms). Codes not in lib/errorMessages.ts show the server's message. */
export function describeError(error: unknown): string {
  if (isApiClientError(error)) {
    if (error.code === "VALIDATION_ERROR") {
      const firstIssue = error.validationIssues[0];
      return firstIssue ? `${firstIssue.path ? `${firstIssue.path}: ` : ""}${firstIssue.message}` : error.message;
    }
    return messageForError(error) ?? (error.message || "Something went wrong.");
  }
  if (error instanceof Error) return error.message || "Something went wrong.";
  return "Something went wrong.";
}

/** "Ref <request id> · trace <trace id>" for support (toasts and error panels); null when the error carries neither. */
export function errorReference(error: unknown): string | null {
  if (!isApiClientError(error)) return null;
  const parts = [
    error.requestId ? `Ref ${error.requestId}` : null,
    error.traceId ? `trace ${error.traceId}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/* ------------------------------------------------------------------ */
/* Tokens                                                               */
/* ------------------------------------------------------------------ */

let accessToken: string | null = null;

function storageGet(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / quota: ignore */
  }
}

// A refresh token left by a pre-cookie build must not linger in localStorage.
storageSet(LEGACY_REFRESH_TOKEN_KEY, null);

export const tokens = {
  getAccess(): string | null {
    return accessToken;
  },
  setAccess(token: string | null): void {
    accessToken = token;
    if (token) storageSet(SESSION_HINT_KEY, "1");
  },
  clear(): void {
    accessToken = null;
    storageSet(SESSION_HINT_KEY, null);
  },
  /** True when a session may exist: an access token in memory, or the hint that a refresh cookie was issued on this browser. */
  hasSession(): boolean {
    return accessToken !== null || storageGet(SESSION_HINT_KEY) === "1";
  },
};

/* ------------------------------------------------------------------ */
/* Auth events (the AuthProvider listens for forced sign-out)           */
/* ------------------------------------------------------------------ */

/**
 * "unauthenticated": the session is over (sign in again). "user-changed": the browser's refresh cookie now belongs to another user
 * (signed out and in as someone else in another tab); this tab must drop the previous user's data and load the new user.
 */
export type AuthEvent = "unauthenticated" | "user-changed";
type AuthListener = (event: AuthEvent) => void;
const authListeners = new Set<AuthListener>();

export function onAuthEvent(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function emitAuthEvent(event: AuthEvent): void {
  for (const listener of authListeners) listener(event);
}

/* ------------------------------------------------------------------ */
/* URL helpers                                                          */
/* ------------------------------------------------------------------ */

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>;
export type QueryParams = Record<string, QueryValue>;

export function apiBaseUrl(): string {
  const origin = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
  return `${origin}/api/v1`;
}

/** {page:2, status:["A","B"], q:""} → "?page=2&status=A&status=B" (empty/null/undefined skipped). */
export function buildQueryString(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface ListParams {
  page?: number;
  page_size?: number;
  search?: string;
  /** "field" ascending or "-field" descending. */
  sort?: string | null;
  include_inactive?: boolean;
  filters?: Record<string, QueryValue>;
}

/** Flattens list parameters into the API's query shape. */
export function buildListQuery(params: ListParams): QueryParams {
  const query: QueryParams = {};
  if (params.page && params.page > 1) query.page = params.page;
  if (params.page_size) query.page_size = params.page_size;
  if (params.search && params.search.trim()) query.search = params.search.trim();
  if (params.sort) query.sort = params.sort;
  if (params.include_inactive) query.include_inactive = true;
  for (const [key, value] of Object.entries(params.filters ?? {})) {
    if (value !== undefined && value !== null && value !== "") query[key] = value;
  }
  return query;
}

export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  next_cursor: string | null;
  /** List facts (platform track): `total_is_estimate` when a large filtered total is the planner's estimate. */
  meta?: { total_is_estimate: boolean; total_included: boolean };
}

/** True when a list's total is an estimate (show "about n"; the last page number is approximate). */
export function totalIsEstimate(list: { meta?: { total_is_estimate?: boolean } } | undefined | null): boolean {
  return list?.meta?.total_is_estimate === true;
}

/* ------------------------------------------------------------------ */
/* Core request                                                         */
/* ------------------------------------------------------------------ */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  /** Row version → `If-Match: "v<version>"` (the API's ETag form, contract C6). */
  version?: number;
  /** Send `X-KKT-Session: cookie` with credentials (login / logout: the API sets or clears the HttpOnly refresh cookie). */
  cookieSession?: boolean;
  /** Override the generated Idempotency-Key (POST only). */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Attach the bearer token (default true). */
  auth?: boolean;
}

/** `If-Match` value for a row version: the API's ETag form `"v<n>"` (contract C6). */
export function versionTag(version: number): string {
  return `"v${version}"`;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const type = response.headers.get("Content-Type") ?? "";
  const text = await response.text();
  if (!text) return undefined;
  if (type.includes("json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

let refreshInFlight: Promise<boolean> | null = null;
/** Why the last refresh failed WITHOUT ending the session (overload, lock timeout, rate limit, network); null after a success. */
let lastTransientRefreshError: ApiClientError | null = null;

interface RefreshResponse {
  access_token: string;
  expires_in?: number;
}

/**
 * True when a failed refresh answer means the session is over (401 invalid / reused / expired / SESSION_EXPIRED, 403, 400, 404).
 * A 408, 409 (refresh-token lock timeout), 425, 429 (refresh rate limit, e.g. an office behind one NAT) or any 5xx is transient: the
 * API keeps the cookie for those (auth/cookies.ts isDeadSession), so the browser must keep the session too and try again later.
 */
export function isDeadRefreshStatus(status: number): boolean {
  if (status < 400 || status >= 500) return false;
  return status !== 408 && status !== 409 && status !== 425 && status !== 429;
}

/** `sub` of a JWT access token (the user id); null when it cannot be read. Only compared, never trusted for authorisation. */
export function tokenSubject(token: string | null): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(
      payload
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(payload.length / 4) * 4, "="),
    );
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/** The transient failure of the last refresh (thrown to the caller instead of signing the user out). */
function transientRefreshError(): ApiClientError {
  return (
    lastTransientRefreshError ??
    new ApiClientError({ status: 0, code: "NETWORK_ERROR", message: "Could not renew the session; try again." })
  );
}

/**
 * Rotates the session through the HttpOnly refresh cookie (contract C1: empty body + `X-KKT-Session: cookie`). Single-flight:
 * concurrent callers share one network call. A dead-session answer (isDeadRefreshStatus: no cookie, reused or expired token,
 * SESSION_EXPIRED past the absolute lifetime) signs the user out; a transient one (409 lock timeout, 429, 5xx, network) keeps the
 * session for a later retry and the caller sees that error instead.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  if (!tokens.hasSession()) {
    tokens.clear();
    emitAuthEvent("unauthenticated");
    return Promise.resolve(false);
  }
  const rotate = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", [SESSION_MODE_HEADER]: "cookie" },
      });
      if (!response.ok) {
        const body = await readBody(response).catch(() => undefined);
        if (isDeadRefreshStatus(response.status)) {
          lastTransientRefreshError = null;
          tokens.clear();
          emitAuthEvent("unauthenticated");
        } else {
          lastTransientRefreshError = parseErrorEnvelope(response.status, body, response.headers);
        }
        return false;
      }
      const data = (await readBody(response)) as Partial<RefreshResponse> | undefined;
      if (!data?.access_token) {
        tokens.clear();
        emitAuthEvent("unauthenticated");
        return false;
      }
      lastTransientRefreshError = null;
      // The cookie is shared by every tab: if another tab signed out and in as someone else, this refresh returns THAT user's token.
      // Never carry on (or retry the pending call) as a different user than the one this tab shows.
      const before = tokenSubject(tokens.getAccess());
      const after = tokenSubject(data.access_token);
      tokens.setAccess(data.access_token);
      if (before !== null && after !== null && before !== after) {
        lastTransientRefreshError = new ApiClientError({
          status: 409,
          code: "SESSION_CHANGED",
          message: "Another user signed in on this browser. Your view has been reloaded for them.",
        });
        emitAuthEvent("user-changed");
        return false;
      }
      return true;
    } catch (cause) {
      lastTransientRefreshError = new ApiClientError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "Network request failed",
        cause,
      });
      return false;
    }
  };
  // Rotating refresh tokens are single-use and the server revokes the whole family on reuse, so tabs of the same origin
  // (a receipt print window, a second ERP tab) share the cookie and must never refresh concurrently: serialise through a Web Lock.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // Promises flatten at runtime; `.then` keeps the declared type honest without a cast.
  const granted: Promise<boolean> = locks
    ? locks.request(REFRESH_LOCK, () => rotate()).then((value: unknown) => value === true)
    : rotate();
  const pending: Promise<boolean> = granted.finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = pending;
  return pending;
}

interface PreparedRequest {
  url: string;
  init: RequestInit;
  headers: Headers;
}

function prepare(method: HttpMethod, path: string, options: RequestOptions): PreparedRequest {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (isForm) {
      body = options.body as FormData;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }
  if (method === "POST") headers.set("Idempotency-Key", options.idempotencyKey ?? newIdempotencyKey());
  if (options.version !== undefined) headers.set("If-Match", versionTag(options.version));
  const url = `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}${buildQueryString(options.query)}`;
  // Cookie-carrying calls (login / logout) say so; everything else is bearer-only.
  const credentials: RequestCredentials | undefined = options.cookieSession ? "include" : undefined;
  if (options.cookieSession) headers.set(SESSION_MODE_HEADER, "cookie");
  return { url, headers, init: { method, body, signal: options.signal, ...(credentials ? { credentials } : {}) } };
}

async function send(prepared: PreparedRequest, useAuth: boolean): Promise<Response> {
  // Fresh Headers per attempt so a retry after refresh never shares state with the first call.
  const headers = new Headers(prepared.headers);
  if (useAuth) {
    const token = tokens.getAccess();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  try {
    return await fetch(prepared.url, { ...prepared.init, headers });
  } catch (cause) {
    throw new ApiClientError({ status: 0, code: "NETWORK_ERROR", message: "Network request failed", cause });
  }
}

async function execute(method: HttpMethod, path: string, options: RequestOptions): Promise<Response> {
  const useAuth = options.auth !== false;
  const prepared = prepare(method, path, options);
  if (useAuth && !tokens.getAccess() && tokens.hasSession()) {
    // A transient refresh failure keeps the session: report it instead of sending the call without a token (a 401 → sign-out).
    if (!(await refreshSession()) && tokens.hasSession()) throw transientRefreshError();
  }
  let response = await send(prepared, useAuth);
  if (response.status === 401 && useAuth) {
    const peek = await response
      .clone()
      .json()
      .catch(() => undefined);
    const code = isEnvelope(peek) ? peek.error.code : "UNAUTHENTICATED";
    if (code === "TOKEN_EXPIRED" || (code === "UNAUTHENTICATED" && tokens.hasSession())) {
      const refreshed = await refreshSession();
      if (refreshed) response = await send(prepared, useAuth);
      else if (tokens.hasSession()) throw transientRefreshError();
    }
    if (response.status === 401) {
      tokens.clear();
      emitAuthEvent("unauthenticated");
    }
  }
  return response;
}

async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await execute(method, path, options);
  const body = await readBody(response);
  if (!response.ok) throw parseErrorEnvelope(response.status, body, response.headers);
  return body as T;
}

export interface DownloadResult {
  blob: Blob;
  filename: string;
  contentType: string;
  /** Response headers (CSV lists carry X-Export-Total / X-Export-Rows / X-Export-Truncated). */
  headers: Headers;
}

/** Rows a synchronous CSV download carries at most; above it the list must be exported in the background (POST /exports). */
export const CSV_SYNC_MAX_ROWS = 10_000;

/** Facts of a synchronous CSV download (X-Export-* headers; null when the route does not send them). */
export interface CsvExportResult {
  filename: string;
  rows: number | null;
  total: number | null;
  /** True when the server cut the file at CSV_SYNC_MAX_ROWS: offer the background export. */
  truncated: boolean;
}

function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Reads the X-Export-* facts of a CSV response. */
export function csvExportFacts(headers: Headers, filename: string): CsvExportResult {
  const rows = headerInt(headers, "X-Export-Rows");
  const total = headerInt(headers, "X-Export-Total");
  const truncated = headers.get("X-Export-Truncated") === "true" || (rows !== null && total !== null && total > rows);
  return { filename, rows, total, truncated };
}

/** Query keys the export job controls itself (sending them is a 400). */
export const EXPORT_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "page",
  "page_size",
  "cursor",
  "limit",
  "format",
  "exact",
]);

export type ExportQuery = Record<string, string | number | boolean | string[]>;

/** List parameters → the `query` of POST /exports (paging/format keys dropped, arrays as strings). */
export function exportQueryFromParams(params: ListParams): ExportQuery {
  const query: ExportQuery = {};
  for (const [key, value] of Object.entries(buildListQuery(params))) {
    if (EXPORT_RESERVED_KEYS.has(key) || value === undefined || value === null || value === "") continue;
    query[key] = Array.isArray(value) ? value.map((item) => String(item)) : (value as string | number | boolean);
  }
  return query;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

/** Streams a file (CSV/PDF) as a Blob with the server-provided filename. */
async function download(path: string, options: RequestOptions = {}): Promise<DownloadResult> {
  const response = await execute("GET", path, { ...options, headers: { ...options.headers, Accept: "*/*" } });
  if (!response.ok) {
    const body = await readBody(response);
    throw parseErrorEnvelope(response.status, body, response.headers);
  }
  const blob = await response.blob();
  const fallback = path.split("/").filter(Boolean).pop() ?? "download";
  return {
    blob,
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), fallback),
    contentType: response.headers.get("Content-Type") ?? blob.type,
    headers: response.headers,
  };
}

/** Triggers a browser download for a Blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  request,
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("GET", path, options);
  },
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, { ...options, body });
  },
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PATCH", path, { ...options, body });
  },
  put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PUT", path, { ...options, body });
  },
  delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("DELETE", path, options);
  },
  upload<T>(path: string, form: FormData, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, { ...options, body: form });
  },
  download,
  /** GET a list endpoint with the standard envelope. */
  list<T>(path: string, params: ListParams = {}, options?: RequestOptions): Promise<ListEnvelope<T>> {
    return request<ListEnvelope<T>>("GET", path, {
      ...options,
      query: { ...options?.query, ...buildListQuery(params) },
    });
  },
  /**
   * GET a list endpoint as CSV and hand it to the browser. Returns the X-Export-* facts: when `truncated` the file holds the first
   * 10,000 rows only and the caller should offer the background export (startExport).
   */
  async exportCsv(path: string, params: ListParams = {}, filename?: string): Promise<CsvExportResult> {
    const { page: _page, page_size: _pageSize, ...rest } = params;
    const result = await download(path, { query: { ...buildListQuery(rest), format: "csv" } });
    const name = filename ?? result.filename;
    saveBlob(result.blob, name);
    return csvExportFacts(result.headers, name);
  },
  /** Queue a background CSV export of every row of a list (POST /exports → 202 export row; poll GET /exports/:id). */
  startExport<T = unknown>(path: string, params: ListParams = {}): Promise<T> {
    const fullPath = `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
    return request<T>("POST", "/exports", { body: { path: fullPath, query: exportQueryFromParams(params) } });
  },
};

export type Api = typeof api;

/** Result of fetchAllPages: every row, the server's total and whether the row ceiling cut the walk short. */
export interface AllPages<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

/**
 * Walks a list endpoint page by page (page_size 200, the server's page bound is 1000) until every row is read, instead of
 * silently keeping the first page. `maxRows` is a safety ceiling; `truncated` tells the caller when it was hit.
 */
export async function fetchAllPages<T>(
  path: string,
  params: Omit<ListParams, "page" | "page_size"> = {},
  options: { signal?: AbortSignal; pageSize?: number; maxRows?: number } = {},
): Promise<AllPages<T>> {
  const pageSize = options.pageSize ?? 200;
  const maxRows = options.maxRows ?? 20_000;
  const items: T[] = [];
  let total = 0;
  for (let page = 1; page <= 1000; page += 1) {
    const envelope = await api.list<T>(path, { ...params, page, page_size: pageSize }, { signal: options.signal });
    items.push(...envelope.items);
    total = envelope.total;
    if (envelope.items.length < pageSize || items.length >= total) break;
    if (items.length >= maxRows) return { items, total, truncated: true };
  }
  return { items, total: Math.max(total, items.length), truncated: false };
}
