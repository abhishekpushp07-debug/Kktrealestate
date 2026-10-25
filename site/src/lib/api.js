// Same-origin by default: the committed site artifact must work on billpe.com and in preview.
function resolveBackend() {
  const env = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
  if (typeof window === "undefined") return env;
  try { if (env && new URL(env).host === window.location.host) return env; } catch { /* ignore */ }
  return window.location.origin;
}
export const BACKEND = resolveBackend();
export const API = `${BACKEND}/api`;
export const portalHref = (site) => site?.portal_url || `${typeof window !== "undefined" ? window.location.origin : ""}/portal/`;

async function request(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) { const err = new Error(data?.detail || r.statusText); err.response = { status: r.status, data }; throw err; }
  return { data, status: r.status };
}

const api = { get: (p) => request("GET", p), post: (p, b) => request("POST", p, b) };
export const errMsg = (e, fallback = "Something went wrong") => e?.response?.data?.detail || e?.message || fallback;
export default api;
