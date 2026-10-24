import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { setLogoutHandler, tokens } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try { if (tokens.access) await api.post("/auth/logout", { refresh_token: tokens.refresh }); } catch (e) { /* ignore */ }
    tokens.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setLogoutHandler(() => { tokens.clear(); setUser(null); });
    if (!tokens.access) { setLoading(false); return; }
    Promise.all([api.get("/auth/me"), api.get("/settings/company")])
      .then(([u, c]) => { setUser(u.data); setCompany(c.data); })
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.mfa_required) return data;
    tokens.set(data.access_token, data.refresh_token);
    setUser(data.user);
    const c = await api.get("/settings/company");
    setCompany(c.data);
    return data;
  }, []);

  const loginMfa = useCallback(async (mfa_token, code) => {
    const { data } = await api.post("/auth/login/mfa", { mfa_token, code });
    tokens.set(data.access_token, data.refresh_token);
    setUser(data.user);
    const c = await api.get("/settings/company");
    setCompany(c.data);
    return data;
  }, []);

  const value = useMemo(() => ({
    user, company, loading, login, loginMfa, logout, setCompany,
    can: (perm) => !!user?.permissions?.includes(perm),
    canAny: (...perms) => perms.some((p) => user?.permissions?.includes(p)),
  }), [user, company, loading, login, loginMfa, logout]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
