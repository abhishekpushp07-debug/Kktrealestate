import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import papi, { onPortalLogout, ptokens } from "./api";

const Ctx = createContext(null);

export function PortalAuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const logout = useCallback(async () => {
    try { if (ptokens.refresh) await papi.post("/auth/logout", { refresh_token: ptokens.refresh }); } catch (e) { /* ignore */ }
    ptokens.clear(); setMe(null); qc.clear();
  }, [qc]);

  const refreshMe = useCallback(async () => { const { data } = await papi.get("/me"); setMe(data); return data; }, []);

  useEffect(() => {
    onPortalLogout.fn = () => { ptokens.clear(); setMe(null); };
    if (!ptokens.access) { setLoading(false); return; }
    refreshMe().catch(() => ptokens.clear()).finally(() => setLoading(false));
  }, [refreshMe]);

  const login = useCallback(async (phone, password) => {
    const { data } = await papi.post("/auth/login", { phone, password });
    ptokens.set(data.access_token, data.refresh_token);
    if (data.must_change_password) { setMe({ must_change_password: true, pending: true, customer: { full_name: data.name } }); return data; }
    await refreshMe();
    return data;
  }, [refreshMe]);

  const changePassword = useCallback(async (current_password, new_password) => {
    const { data } = await papi.post("/auth/change-password", { current_password, new_password });
    ptokens.set(data.access_token, data.refresh_token);
    await refreshMe();
  }, [refreshMe]);

  return <Ctx.Provider value={{ me, loading, login, logout, changePassword, refreshMe }}>{children}</Ctx.Provider>;
}

export const usePortalAuth = () => useContext(Ctx);
