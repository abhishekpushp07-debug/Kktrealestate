import axios from "axios";

// Same-origin unless REACT_APP_BACKEND_URL points at this very host (deployed build must work on any domain).
function resolveBackend() {
  const env = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
  try { if (env && new URL(env).host === window.location.host) return env; } catch { /* ignore */ }
  return window.location.origin;
}
export const BACKEND = resolveBackend();
export const API = `${BACKEND}/api`;
export const portalHref = (portalUrl) => portalUrl || `${window.location.origin}/portal/`;
// Session hardening (CR-7): the access token lives only in memory; the refresh token is an httpOnly SameSite=Strict cookie
// scoped to /api/auth that the backend sets/rotates/clears. Nothing auth-related is persisted in localStorage.
// Tabs share the in-memory access token through a BroadcastChannel (a tab without one re-refreshes via the cookie).
const CSRF_COOKIE = "kkt_csrf";
export const BASE_PATH = (process.env.REACT_APP_BASE_PATH || process.env.PUBLIC_URL || "/").replace(/\/$/, "");
const onLogout = { fn: () => { tokens.clear(); window.location.assign(`${BASE_PATH}/login`); } };
const LEGACY_KEYS = ["kkt_access_token", "kkt_refresh_token"];
try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
let accessToken = null;
let csrfToken = null;
// sessionStorage: CSRF token mirror (NOT a credential — useless without the httpOnly refresh cookie) so a reload inside an
// embedded/iframe context, where the SameSite=Strict readable cookie is unavailable, can still refresh. Non-sensitive (CR-7).
const CSRF_SS = "kkt_csrf";
try { csrfToken = sessionStorage.getItem(CSRF_SS) || null; } catch { /* storage unavailable */ }
const chan = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("kkt-auth") : null;
export const readCookie = (name) => document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const setCsrf = (c) => { csrfToken = c || null; try { if (c) sessionStorage.setItem(CSRF_SS, c); else sessionStorage.removeItem(CSRF_SS); } catch { /* ignore */ } };
export const tokens = {
  get access() { return accessToken; },
  get csrf() { return csrfToken || readCookie(CSRF_COOKIE) || null; },
  set(a, csrf) { accessToken = a || null; if (csrf) setCsrf(csrf); chan?.postMessage({ type: "token", access: accessToken, csrf: csrfToken }); },
  clear() { accessToken = null; setCsrf(null); chan?.postMessage({ type: "logout" }); },
  adopt(a, csrf) { accessToken = a || null; if (csrf) setCsrf(csrf); },
};
if (chan) chan.onmessage = (e) => { if (e.data?.type === "token") tokens.adopt(e.data.access, e.data.csrf); else if (e.data?.type === "logout" && accessToken) { accessToken = null; setCsrf(null); onLogout.fn(); } };

const api = axios.create({ baseURL: API, withCredentials: true });

api.interceptors.request.use((config) => {
  const t = tokens.access;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  if (config.method === "post" && !config.headers["Idempotency-Key"]) config.headers["Idempotency-Key"] = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  if (config.method === "patch" && config.data && typeof config.data === "object" && config.data.version == null) {
    return Promise.reject(new Error(`PATCH ${config.url} requires a version (optimistic concurrency)`));
  }
  return config;
});

export const conflictHandler = { fn: null };

let refreshing = null;
export const lastError = { request_id: null, at: 0 };
export const setLogoutHandler = (fn) => { onLogout.fn = fn; };
const onDenied = { fn: null };
export const setPermissionDeniedHandler = (fn) => { onDenied.fn = fn; };

async function doRefresh() {
  const { data } = await axios.post(`${API}/auth/refresh`, {}, { withCredentials: true, headers: csrfHeaders() });
  tokens.set(data.access_token, data.csrf_token);
  return data.access_token;
}
/** Page load: rebuild the in-memory access token from the cookie session (single-flight). */
export const restoreSession = () => { refreshing = refreshing || doRefresh().finally(() => { refreshing = null; }); return refreshing; };
export const csrfHeaders = () => ({ "X-CSRF-Token": tokens.csrf || "" });

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error;
    const rid = response?.data?.error?.request_id || response?.data?.request_id || response?.headers?.["x-request-id"];
    if (rid) { lastError.request_id = rid; lastError.at = Date.now(); }
    if (response?.status === 409 && response.data?.code === "VERSION_CONFLICT" && conflictHandler.fn) conflictHandler.fn(response.data);
    if (response?.status === 403 && response.data?.code === "PERMISSION_DENIED" && onDenied.fn) onDenied.fn(response.data);
    if (response?.status === 503 && response.headers?.["retry-after"] && (config.method || "get").toLowerCase() === "get" && !config._retried503) {
      config._retried503 = true;  // Phase K.11: idempotent GET retried once after Retry-After (capped at 5 s)
      await new Promise((res) => setTimeout(res, Math.min(5, Number(response.headers["retry-after"]) || 2) * 1000));
      return api(config);
    }
    if (response?.status === 401 && !config._retry && !config.url.includes("/auth/login") && !config.url.includes("/auth/refresh")) {
      config._retry = true;
      try {
        refreshing = refreshing || doRefresh().finally(() => { refreshing = null; });
        const token = await refreshing;
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      } catch (e) {
        onLogout.fn();
      }
    }
    return Promise.reject(error);
  }
);

export const errFields = (e) => Object.fromEntries((e?.response?.data?.error?.details || e?.response?.data?.errors || []).filter((d) => d && d.field).map((d) => [d.field, d.message]));
export const errMsg = (e, fallback = "Something went wrong") => {
  const base = e?.response?.data?.error?.message || e?.response?.data?.detail || e?.message || fallback;
  const f = Object.entries(errFields(e)).slice(0, 4).map(([k, v]) => `${k.split(".").pop()}: ${v}`);
  return f.length && !f.some(([x]) => base.includes(x)) && !base.includes(f[0]) ? `${base.split(";")[0]} — ${f.join(" · ")}` : base;
};
export const errCode = (e) => e?.response?.data?.error?.code || e?.response?.data?.code || null;

export default api;
