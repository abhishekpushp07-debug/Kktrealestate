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
export const ACCESS_KEY = "kkt_access_token";
export const REFRESH_KEY = "kkt_refresh_token";

export const tokens = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(a, r) { localStorage.setItem(ACCESS_KEY, a); localStorage.setItem(REFRESH_KEY, r); },
  clear() { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); },
};

const api = axios.create({ baseURL: API });

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
export const BASE_PATH = (process.env.REACT_APP_BASE_PATH || "/").replace(/\/$/, "");
const onLogout = { fn: () => { tokens.clear(); window.location.assign(`${BASE_PATH}/login`); } };
export const setLogoutHandler = (fn) => { onLogout.fn = fn; };

async function doRefresh() {
  const rt = tokens.refresh;
  if (!rt) throw new Error("no refresh token");
  const { data } = await axios.post(`${API}/auth/refresh`, { refresh_token: rt });
  tokens.set(data.access_token, data.refresh_token);
  return data.access_token;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 409 && response.data?.code === "VERSION_CONFLICT" && conflictHandler.fn) conflictHandler.fn(response.data);
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

export const errMsg = (e, fallback = "Something went wrong") => e?.response?.data?.detail || e?.message || fallback;

export default api;
