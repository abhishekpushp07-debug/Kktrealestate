import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadBootstrap } from "@/lib/bootstrapCache";
import { reconcileTheme } from "@/lib/theme";
import api, {
  csrfHeaders,
  restoreSession,
  setLogoutHandler,
  setPermissionDeniedHandler,
  tokens,
} from "@/lib/api";
import { canonical } from "@/lib/permissions";
import { setBusinessTz } from "@/lib/businessDay";
import { switchSession, uidFromToken } from "@/lib/session";
import { fetchKey } from "@/hooks/useList";

// Home is the landing page: its chunk and data start loading the moment we know who is signed in (no waterfall)
const warmHome = (qc) => {
  import("@/pages/v2/Home");
  qc.prefetchQuery({
    queryKey: fetchKey("/home/bundle?period=month"),
    queryFn: () => api.get("/home/bundle?period=month").then((r) => r.data),
    staleTime: 15_000,
  });
};

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  useEffect(() => setBusinessTz(company?.time_zone), [company?.time_zone]);
  const [surfaces, setSurfaces] = useState({ public_website: false, customer_portal: false });
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try {
      if (tokens.access) await api.post("/auth/logout", {}, { headers: csrfHeaders() });
    } catch (e) {
      /* ignore */
    }
    tokens.clear();
    switchSession(qc, null);
    setUser(null);
  }, [qc]);

  useEffect(() => {
    setLogoutHandler(() => {
      tokens.clear();
      switchSession(qc, null);
      setUser(null);
    });
    // No token in memory (fresh tab / reload): try to restore the session from the httpOnly refresh cookie first.
    (tokens.access ? Promise.resolve() : restoreSession())
      .catch(() => null)
      .then(() => {
        if (!tokens.access) {
          setLoading(false);
          return;
        }
        switchSession(qc, uidFromToken(tokens.access));
        if (window.location.pathname === "/dashboard" || window.location.pathname === "/")
          warmHome(qc);
        Promise.all([
          qc.fetchQuery({
            queryKey: fetchKey("/auth/me"),
            queryFn: () => api.get("/auth/me").then((r) => r.data),
            staleTime: 5 * 60_000,
          }),
          qc.fetchQuery({
            queryKey: fetchKey("/settings/company"),
            queryFn: () => api.get("/settings/company").then((r) => r.data),
            staleTime: 10 * 60_000,
          }),
          loadBootstrap()
            .then((b) => b?.surfaces)
            .catch(() => null),
        ])
          .then(([u, c, sf]) => {
            setUser(u);
            reconcileTheme(u?.ui_theme);
            setCompany(c);
            if (sf) setSurfaces(sf);
          })
          .catch(() => tokens.clear())
          .finally(() => setLoading(false));
      });
  }, [qc]);

  const signIn = useCallback(
    (data) => {
      tokens.set(data.access_token, data.csrf_token);
      switchSession(qc, data.user?.id || uidFromToken(data.access_token)); // new user → nothing of the last one survives
      warmHome(qc);
      setUser(data.user);
      reconcileTheme(data.user?.ui_theme);
      api
        .get("/settings/company")
        .then((c) => {
          qc.setQueryData(fetchKey("/settings/company"), c.data);
          setCompany(c.data);
        })
        .catch(() => {});
      loadBootstrap(true)
        .then((b) => b?.surfaces && setSurfaces(b.surfaces))
        .catch(() => {});
      return data;
    },
    [qc],
  );

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post("/auth/login", { email, password });
      return data.mfa_required ? data : signIn(data);
    },
    [signIn],
  );

  const loginMfa = useCallback(
    async (mfa_token, code) =>
      signIn((await api.post("/auth/login/mfa", { mfa_token, code })).data),
    [signIn],
  );

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      qc.setQueryData(fetchKey("/auth/me"), data);
      setUser((u) =>
        u && JSON.stringify(u.permissions) === JSON.stringify(data.permissions) ? u : data,
      );
    } catch {
      /* ignore */
    }
  }, [qc]);

  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return undefined;
    setPermissionDeniedHandler(refreshMe);
    const t = setInterval(refreshMe, 30_000);
    window.addEventListener("focus", refreshMe);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refreshMe);
      setPermissionDeniedHandler(null);
    };
  }, [signedIn, refreshMe]);

  // CR-2 B5: permission helpers are stable callbacks keyed on the user's permission set; the context value is composed from small memos
  // "a|b" = either permission (e.g. Sales opens the display-layer inventory reports with masters.flat.view)
  const can = useCallback(
    (perm) =>
      !!user?.is_super_admin ||
      perm
        .split("|")
        .some((p) =>
          p.endsWith(".*")
            ? !!user?.permissions?.some((c) => c.startsWith(p.slice(0, -1)))
            : !!user?.permissions?.includes(canonical(p)),
        ),
    [user],
  );
  const canAny = useCallback(
    (...perms) =>
      !!user?.is_super_admin || perms.some((p) => user?.permissions?.includes(canonical(p))),
    [user],
  );
  const actions = useMemo(
    () => ({ login, loginMfa, logout, setCompany, refreshMe, can, canAny }),
    [login, loginMfa, logout, refreshMe, can, canAny],
  );
  const value = useMemo(
    () => ({ user, company, surfaces, loading, ...actions }),
    [user, company, surfaces, loading, actions],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
