import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadBootstrap } from "@/lib/bootstrapCache";
import api, { setLogoutHandler, setPermissionDeniedHandler, tokens } from "@/lib/api";
import { canonical } from "@/lib/permissions";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [surfaces, setSurfaces] = useState({ public_website: false, customer_portal: false });
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try { if (tokens.access) await api.post("/auth/logout", { refresh_token: tokens.refresh }); } catch (e) { /* ignore */ }
    tokens.clear();
    setUser(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLogoutHandler(() => { tokens.clear(); setUser(null); });
    if (!tokens.access) { setLoading(false); return; }
    Promise.all([qc.fetchQuery({ queryKey: ["fetch", "/auth/me"], queryFn: () => api.get("/auth/me").then((r) => r.data), staleTime: 5 * 60_000 }), qc.fetchQuery({ queryKey: ["fetch", "/settings/company"], queryFn: () => api.get("/settings/company").then((r) => r.data), staleTime: 10 * 60_000 }), loadBootstrap().then((b) => b?.surfaces).catch(() => null)])
      .then(([u, c, sf]) => { setUser(u); setCompany(c); if (sf) setSurfaces(sf); })
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.mfa_required) return data;
    tokens.set(data.access_token, data.refresh_token);
    setUser(data.user);
    const c = await api.get("/settings/company");
    qc.setQueryData(["fetch", "/settings/company"], c.data);
    setCompany(c.data);
    loadBootstrap(true).then((b) => b?.surfaces && setSurfaces(b.surfaces)).catch(() => {});
    return data;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loginMfa = useCallback(async (mfa_token, code) => {
    const { data } = await api.post("/auth/login/mfa", { mfa_token, code });
    tokens.set(data.access_token, data.refresh_token);
    setUser(data.user);
    const c = await api.get("/settings/company");
    qc.setQueryData(["fetch", "/settings/company"], c.data);
    setCompany(c.data);
    loadBootstrap(true).then((b) => b?.surfaces && setSurfaces(b.surfaces)).catch(() => {});
    return data;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMe = useCallback(async () => {
    try { const { data } = await api.get("/auth/me"); qc.setQueryData(["fetch", "/auth/me"], data); setUser((u) => (u && JSON.stringify(u.permissions) === JSON.stringify(data.permissions) ? u : data)); } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return undefined;
    setPermissionDeniedHandler(refreshMe);
    const t = setInterval(refreshMe, 30_000);
    window.addEventListener("focus", refreshMe);
    return () => { clearInterval(t); window.removeEventListener("focus", refreshMe); setPermissionDeniedHandler(null); };
  }, [!!user, refreshMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({
    user, company, surfaces, loading, login, loginMfa, logout, setCompany, refreshMe,
    can: (perm) => !!user?.is_super_admin || !!user?.permissions?.includes(canonical(perm)),
    canAny: (...perms) => !!user?.is_super_admin || perms.some((p) => user?.permissions?.includes(canonical(p))),
  }), [user, company, surfaces, loading, login, loginMfa, logout, refreshMe]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
