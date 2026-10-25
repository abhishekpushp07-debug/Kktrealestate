/**
 * Fetch-based API client for the KKT staff API.
 *
 * - Base URL = VITE_API_URL + "/api/v1" (empty VITE_API_URL = same origin, dev proxy).
 * - Access token lives in memory; the refresh token in localStorage ("kkt.erp.refresh").
 * - 401 TOKEN_EXPIRED → single-flight POST /auth/refresh, then the request is retried once.
 * - Every POST carries an Idempotency-Key (crypto.randomUUID) unless one is supplied.
 * - `version` option → `If-Match: "<version>"` header for optimistic concurrency.
 * - Error envelopes {error:{code,message,details,request_id}} become ApiClientError.
 */

export const REFRESH_TOKEN_KEY = "kkt.erp.refresh";

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

export interface ApiClientErrorInit {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiClientError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
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
  if (isEnvelope(body)) {
    const details =
      typeof body.error.details === "object" && body.error.details !== null ? body.error.details : undefined;
    return new ApiClientError({
      status,
      code: body.error.code,
      message: body.error.message,
      details,
      requestId: body.error.request_id ?? requestId,
      retryAfterSeconds,
    });
  }
  const text = typeof body === "string" && body.trim() ? body.trim().slice(0, 200) : undefined;
  return new ApiClientError({
    status,
    code: FALLBACK_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"),
    message: text ?? `Request failed with status ${status}`,
    requestId,
    retryAfterSeconds,
  });
}

/** Human-friendly message for any thrown value (used by toasts and forms). */
export function describeError(error: unknown): string {
  if (isApiClientError(error)) {
    switch (error.code) {
      case "NETWORK_ERROR":
        return "Cannot reach the server. Check your connection and try again.";
      case "VALIDATION_ERROR": {
        const firstIssue = error.validationIssues[0];
        return firstIssue ? `${firstIssue.path ? `${firstIssue.path}: ` : ""}${firstIssue.message}` : error.message;
      }
      case "VERSION_CONFLICT":
        return "Someone else changed this record. Reload to see the latest version.";
      case "RATE_LIMITED":
        return error.retryAfterSeconds
          ? `Too many attempts. Try again in ${error.retryAfterSeconds}s.`
          : "Too many attempts. Please wait a moment.";
      case "LOCKED":
        return error.message || "Account temporarily locked. Try again in 15 minutes.";
      case "FORBIDDEN":
        return "You don't have permission to do that.";
      case "NOT_FOUND":
        return "That record could not be found.";
      default:
        return error.message || "Something went wrong.";
    }
  }
  if (error instanceof Error) return error.message || "Something went wrong.";
  return "Something went wrong.";
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

export const tokens = {
  getAccess(): string | null {
    return accessToken;
  },
  setAccess(token: string | null): void {
    accessToken = token;
  },
  getRefresh(): string | null {
    return storageGet(REFRESH_TOKEN_KEY);
  },
  setRefresh(token: string | null): void {
    storageSet(REFRESH_TOKEN_KEY, token);
  },
  setPair(access: string, refresh: string): void {
    accessToken = access;
    storageSet(REFRESH_TOKEN_KEY, refresh);
  },
  clear(): void {
    accessToken = null;
    storageSet(REFRESH_TOKEN_KEY, null);
  },
  hasSession(): boolean {
    return accessToken !== null || storageGet(REFRESH_TOKEN_KEY) !== null;
  },
};

/* ------------------------------------------------------------------ */
/* Auth events (the AuthProvider listens for forced sign-out)           */
/* ------------------------------------------------------------------ */

export type AuthEvent = "unauthenticated";
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
}

/* ------------------------------------------------------------------ */
/* Core request                                                         */
/* ------------------------------------------------------------------ */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  /** Row version → `If-Match: "<version>"`. */
  version?: number;
  /** Override the generated Idempotency-Key (POST only). */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Attach the bearer token (default true). */
  auth?: boolean;
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

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

/** Rotates the refresh token. Single-flight: concurrent callers share one network call. */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  if (!tokens.getRefresh()) {
    tokens.clear();
    emitAuthEvent("unauthenticated");
    return Promise.resolve(false);
  }
  const rotate = async (): Promise<boolean> => {
    // Re-read inside the lock: another tab (print window, second tab) may have rotated the token meanwhile.
    const refreshToken = tokens.getRefresh();
    if (!refreshToken) {
      tokens.clear();
      emitAuthEvent("unauthenticated");
      return false;
    }
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          tokens.clear();
          emitAuthEvent("unauthenticated");
        }
        return false;
      }
      const data = (await readBody(response)) as Partial<RefreshResponse> | undefined;
      if (!data?.access_token || !data.refresh_token) {
        tokens.clear();
        emitAuthEvent("unauthenticated");
        return false;
      }
      tokens.setPair(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  };
  // Rotating refresh tokens are single-use and the server revokes the whole family on reuse, so tabs of the same
  // origin (a receipt print window, a second ERP tab) must never refresh concurrently: serialise through a Web Lock.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // Promises flatten at runtime; `.then` keeps the declared type honest without a cast.
  const granted: Promise<boolean> = locks ? locks.request(`${REFRESH_TOKEN_KEY}.rotate`, () => rotate()).then((value: unknown) => value === true) : rotate();
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
  if (options.version !== undefined) headers.set("If-Match", `"${options.version}"`);
  const url = `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}${buildQueryString(options.query)}`;
  return { url, headers, init: { method, body, signal: options.signal } };
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
  if (useAuth && !tokens.getAccess() && tokens.getRefresh()) {
    await refreshSession();
  }
  let response = await send(prepared, useAuth);
  if (response.status === 401 && useAuth) {
    const peek = await response.clone().json().catch(() => undefined);
    const code = isEnvelope(peek) ? peek.error.code : "UNAUTHENTICATED";
    if (code === "TOKEN_EXPIRED" || (code === "UNAUTHENTICATED" && tokens.getRefresh())) {
      const refreshed = await refreshSession();
      if (refreshed) response = await send(prepared, useAuth);
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
    return request<ListEnvelope<T>>("GET", path, { ...options, query: { ...options?.query, ...buildListQuery(params) } });
  },
  /** GET a list endpoint as CSV and hand it to the browser. */
  async exportCsv(path: string, params: ListParams = {}, filename?: string): Promise<void> {
    const result = await download(path, { query: { ...buildListQuery(params), format: "csv" } });
    saveBlob(result.blob, filename ?? result.filename);
  },
};

export type Api = typeof api;
