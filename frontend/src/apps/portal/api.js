import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api/portal`;
const ACCESS = "kkt_portal_token";
const REFRESH = "kkt_portal_refresh";

export const ptokens = {
  get access() { return localStorage.getItem(ACCESS); },
  get refresh() { return localStorage.getItem(REFRESH); },
  set(a, r) { localStorage.setItem(ACCESS, a); if (r) localStorage.setItem(REFRESH, r); },
  clear() { localStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH); },
};

const papi = axios.create({ baseURL: API });
papi.interceptors.request.use((c) => { const t = ptokens.access; if (t) c.headers.Authorization = `Bearer ${t}`; return c; });

export const onPortalLogout = { fn: () => { ptokens.clear(); } };
let refreshing = null;
papi.interceptors.response.use((r) => r, async (error) => {
  const { config, response } = error;
  if (response?.status === 401 && !config._retry && !config.url.includes("/auth/") && ptokens.refresh) {
    config._retry = true;
    try {
      refreshing = refreshing || axios.post(`${API}/auth/refresh`, { refresh_token: ptokens.refresh }).then(({ data }) => { ptokens.set(data.access_token, data.refresh_token); return data.access_token; }).finally(() => { refreshing = null; });
      config.headers.Authorization = `Bearer ${await refreshing}`;
      return papi(config);
    } catch (e) { onPortalLogout.fn(); }
  }
  return Promise.reject(error);
});

export const perr = (e, fb = "Something went wrong") => e?.response?.data?.detail || e?.message || fb;
export const pdfUrl = (path) => `${API}${path}`;
export async function openPdf(path, name) {
  const { data } = await papi.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; a.rel = "noopener"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export default papi;
