// Portal API client — mirrors frontend/src/apps/portal/api.js (same endpoints,
// same token keys, silent refresh on 401 with a single shared refresh promise).
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";

import { storage } from "@/src/utils/storage";
import { fileNameFor, toFormDataPart, type LocalFile } from "@/src/utils/upload";

// Web: same-origin API (deployed at <domain>/portal) unless running on the expo preview host.
function resolveBackend(): string {
  const env = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    if (window.location.hostname.includes("expo.preview")) return env;
    return window.location.origin;
  }
  return env;
}
export const BACKEND = resolveBackend();
export const API = `${BACKEND}/api/portal`;

const ACCESS = "kkt_portal_token";
const REFRESH = "kkt_portal_refresh";

let access: string | null = null;
let refresh: string | null = null;

export const tokens = {
  get access() {
    return access;
  },
  get refresh() {
    return refresh;
  },
  async load() {
    access = await storage.secureGet<string | null>(ACCESS, null);
    refresh = await storage.secureGet<string | null>(REFRESH, null);
  },
  async set(a: string, r?: string | null) {
    access = a;
    await storage.secureSet(ACCESS, a);
    if (r !== undefined) {
      refresh = r ?? null;
      if (r) await storage.secureSet(REFRESH, r);
      else await storage.secureRemove(REFRESH);
    }
  },
  async clear() {
    access = null;
    refresh = null;
    await storage.secureRemove(ACCESS);
    await storage.secureRemove(REFRESH);
  },
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Called when the session can no longer be renewed (set by AuthProvider).
export const sessionHooks = { onExpired: () => {} };

let refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  if (!refresh) throw new ApiError(401, "Session expired");
  const res = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) throw new ApiError(401, "Session expired");
  const data = await res.json();
  await tokens.set(data.access_token, data.refresh_token);
  return data.access_token;
}

export function refreshAccess(): Promise<string> {
  refreshing = refreshing || doRefresh().finally(() => (refreshing = null));
  return refreshing;
}

function messageFor(status: number, body: any): string {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, "");
  if (status === 404) return "Not found";
  if (status >= 500) return "Our server had a hiccup. Please try again.";
  return "Something went wrong";
}

type Opts = { method?: string; json?: unknown; form?: FormData; auth?: boolean };

async function send(path: string, o: Opts, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token && o.auth !== false) headers.Authorization = `Bearer ${token}`;
  let body: any;
  if (o.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.form) body = o.form;
  const url = `${API}${path}`;
  const init = { method: o.method ?? "GET", headers, body };
  // Multipart on native must go through expo/fetch (see utils/upload.ts).
  if (o.form && Platform.OS !== "web") return expoFetch(url, init) as unknown as Response;
  return fetch(url, init);
}

export async function request<T = any>(path: string, o: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await send(path, o, access);
    if (res.status === 401 && o.auth !== false && !path.startsWith("/auth/") && refresh) {
      try {
        const t = await refreshAccess();
        res = await send(path, o, t);
      } catch {
        sessionHooks.onExpired();
        throw new ApiError(401, "Your session expired. Please sign in again.", "SESSION_EXPIRED");
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "Can't reach KKT right now. Check your internet connection.", "NETWORK");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && o.auth !== false && !path.startsWith("/auth/")) sessionHooks.onExpired();
    throw new ApiError(res.status, messageFor(res.status, data), data?.code);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>(p),
  post: <T = any>(p: string, json?: unknown) => request<T>(p, { method: "POST", json: json ?? {} }),
  patch: <T = any>(p: string, json: unknown) => request<T>(p, { method: "PATCH", json }),
  form: <T = any>(p: string, form: FormData) => request<T>(p, { method: "POST", form }),
};

export async function buildForm(fields: Record<string, string>, files: LocalFile[] = []): Promise<FormData> {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  for (const f of files) fd.append("file", (await toFormDataPart(f)) as any, fileNameFor(f));
  return fd;
}

export const errMsg = (e: unknown, fb = "Something went wrong") =>
  e instanceof ApiError ? e.message : (e as any)?.message || fb;
