// Auth state for the portal — mirrors frontend PortalAuth.jsx.
// status: loading → out | pwchange (forced change with 10-min temp token) | in
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, sessionHooks, tokens } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { toast } from "@/src/ui/toast";

export type Me = {
  customer: {
    id: string;
    customer_code: string;
    full_name: string;
    salutation?: string | null;
    phone?: string | null;
    alt_phone?: string | null;
    email?: string | null;
    address_current?: { line1?: string; city?: string; state?: string; pincode?: string } | null;
    kyc_status?: string | null;
    pan_masked?: string | null;
    aadhaar_masked?: string | null;
  };
  co_applicants: { full_name: string; phone?: string }[];
  relationship_manager: { name: string; phone?: string | null } | null;
  bookings_count: number;
  must_change_password: boolean;
  last_login_at?: string | null;
  company?: { name?: string; legal_name?: string; letterhead_email?: string; letterhead_phone?: string } | null;
  unread_notices: number;
};

type Status = "loading" | "out" | "pwchange" | "in";

type Ctx = {
  status: Status;
  me: Me | null;
  pendingName: string | null;
  login: (phone: string, password: string) => Promise<{ must_change_password: boolean; name: string }>;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: (opts?: { everywhere?: boolean; silent?: boolean }) => Promise<void>;
  refreshMe: () => Promise<Me>;
};

const AuthCtx = createContext<Ctx | null>(null);
export const BOOKING_KEY = "kkt_portal_booking";

export function AuthProvider({ children }: PropsWithChildren) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);

  const reset = useCallback(async () => {
    await tokens.clear();
    await storage.removeItem(BOOKING_KEY);
    qc.clear();
    setMe(null);
    setPendingName(null);
    setStatus("out");
  }, [qc]);

  const refreshMe = useCallback(async () => {
    const data = await api.get<Me>("/me");
    setMe(data);
    return data;
  }, []);

  useEffect(() => {
    sessionHooks.onExpired = () => {
      if (!tokens.access && !tokens.refresh) return;
      toast.info("Your session expired. Please sign in again.");
      reset();
    };
    (async () => {
      await tokens.load();
      if (!tokens.access && !tokens.refresh) return setStatus("out");
      try {
        const m = await refreshMe();
        setStatus(m.must_change_password ? "pwchange" : "in");
      } catch (e: any) {
        // Offline with a stored session: let cached screens show; otherwise sign out.
        if (e?.code === "NETWORK" && tokens.refresh) setStatus("in");
        else await reset();
      }
    })();
  }, [refreshMe, reset]);

  const login = useCallback(
    async (phone: string, password: string) => {
      const data = await api.post<any>("/auth/login", { phone, password });
      await tokens.set(data.access_token, data.refresh_token ?? null);
      if (data.must_change_password) {
        setPendingName(data.name);
        setStatus("pwchange");
        return data;
      }
      await refreshMe();
      setStatus("in");
      return data;
    },
    [refreshMe],
  );

  const changePassword = useCallback(
    async (current_password: string, new_password: string) => {
      const data = await api.post<any>("/auth/change-password", { current_password, new_password });
      await tokens.set(data.access_token, data.refresh_token);
      await refreshMe();
      setPendingName(null);
      setStatus("in");
    },
    [refreshMe],
  );

  const logout = useCallback(
    async (opts?: { everywhere?: boolean; silent?: boolean }) => {
      try {
        if (opts?.everywhere) await api.post("/auth/logout-all");
        else if (tokens.refresh) await api.post("/auth/logout", { refresh_token: tokens.refresh });
      } catch {
        /* sign out locally regardless */
      }
      await reset();
      if (!opts?.silent) toast.success(opts?.everywhere ? "Signed out on all devices" : "Signed out");
    },
    [reset],
  );

  const value = useMemo(
    () => ({ status, me, pendingName, login, changePassword, logout, refreshMe }),
    [status, me, pendingName, login, changePassword, logout, refreshMe],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
