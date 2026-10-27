// Authentication state for the portal: phone + password login, must_change_password gate,
// logout (this device / all devices), restore on launch (web: a refresh through the HttpOnly cookie; native: the refresh token in
// SecureStore, with a cached user snapshot so the shell renders instantly), and session-expiry handling. The web build keeps no
// user snapshot and no token in browser storage (contract C1, audit v3 D1).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { normalisePhone, PortalAuthLoginSchema, type PortalUser } from "@kkt/contracts";
import { Platform } from "react-native";
import { api, ApiError, session } from "@/api/client";
import { clearPersistedCache, queryClient, keys } from "@/api/queries";
import { kvStorage } from "@/lib/storage";
import { toLoginFailure, type LoginFailure } from "./loginFailure";

const USER_KEY = "kkt.portal.user";
/** Native only: the user snapshot that lets the shell render before /me answers. The browser keeps nothing (PII at rest). */
const KEEP_USER_SNAPSHOT = Platform.OS !== "web";
/** Company slug for multi-company installs (contract C4): a builder's portal build names its tenant; empty = resolved by host. */
const COMPANY_SLUG = (process.env.EXPO_PUBLIC_KKT_COMPANY ?? "").trim() || undefined;

export type AuthStatus = "booting" | "anonymous" | "authenticated";

export type { LoginFailure } from "./loginFailure";

interface AuthContextValue {
  status: AuthStatus;
  user: PortalUser | null;
  mustChangePassword: boolean;
  login: (phone: string, password: string) => Promise<{ ok: true } | { ok: false; failure: LoginFailure }>;
  logout: (opts?: { allDevices?: boolean }) => Promise<void>;
  refreshUser: () => Promise<void>;
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Phone input → 10 digits (drops +91 / 0 / punctuation). */
export function toTenDigitPhone(input: string): string {
  const out = normalisePhone(input);
  return typeof out === "string" ? out : "";
}

function deviceName(): string {
  if (Platform.OS === "web") {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const browser = /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Browser";
    return `${browser} on web`;
  }
  return Platform.OS === "ios" ? "iPhone app" : "Android app";
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [user, setUser] = useState<PortalUser | null>(null);
  const alive = useRef(true);

  const persistUser = useCallback(async (u: PortalUser | null) => {
    if (u && KEEP_USER_SNAPSHOT) await kvStorage.set(USER_KEY, JSON.stringify(u));
    else await kvStorage.remove(USER_KEY);
  }, []);

  const signOutLocally = useCallback(async () => {
    await session.clear();
    await persistUser(null);
    await clearPersistedCache();
    if (alive.current) {
      setUser(null);
      setStatus("anonymous");
    }
  }, [persistUser]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.auth.me();
      if (!alive.current) return;
      setUser(me);
      setStatus("authenticated");
      queryClient.setQueryData(keys.me, me);
      await persistUser(me);
    } catch (e) {
      if (e instanceof ApiError && e.isAuth) await signOutLocally();
      // Offline / server trouble: keep the cached session so the app stays usable.
    }
  }, [persistUser, signOutLocally]);

  // Restore on launch.
  useEffect(() => {
    alive.current = true;
    void (async () => {
      const hasRefresh = await session.load();
      if (!KEEP_USER_SNAPSHOT) await kvStorage.remove(USER_KEY); // a pre-C1 web build stored one
      if (!hasRefresh) {
        setStatus("anonymous");
        return;
      }
      const cached = KEEP_USER_SNAPSHOT ? await kvStorage.get(USER_KEY) : null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as PortalUser;
          if (alive.current) {
            setUser(parsed);
            setStatus("authenticated");
          }
        } catch {
          /* ignore a corrupt snapshot */
        }
      }
      await refreshUser();
      if (alive.current && !cached) {
        // No snapshot and /me failed without a 401 (offline): there is nothing to show → sign in.
        setStatus((s) => (s === "booting" ? "anonymous" : s));
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [refreshUser]);

  // The client tells us when the refresh token is rejected, or when the browser's session now belongs to another customer (signed in
  // in another tab): then everything of the previous customer is dropped and the new one is loaded.
  useEffect(
    () =>
      session.onExpired((event) => {
        if (event === "expired") {
          void signOutLocally();
          return;
        }
        queryClient.clear();
        void refreshUser();
      }),
    [signOutLocally, refreshUser],
  );

  const login = useCallback<AuthContextValue["login"]>(
    async (phoneInput, password) => {
      const parsed = PortalAuthLoginSchema.safeParse({
        phone: phoneInput,
        password,
        device_name: deviceName(),
        ...(COMPANY_SLUG ? { company: COMPANY_SLUG } : {}),
      });
      if (!parsed.success) {
        const phoneIssue = parsed.error.issues.find((i) => i.path[0] === "phone");
        return {
          ok: false,
          failure: {
            code: "VALIDATION",
            message: phoneIssue ? "Enter a valid 10-digit Indian mobile number." : "Enter your password.",
          },
        };
      }
      try {
        const res = await api.auth.login(parsed.data);
        await session.setTokens(res);
        await persistUser(res.user);
        queryClient.setQueryData(keys.me, res.user);
        setUser(res.user);
        setStatus("authenticated");
        return { ok: true };
      } catch (e) {
        return { ok: false, failure: toLoginFailure(e) };
      }
    },
    [persistUser],
  );

  const logout = useCallback<AuthContextValue["logout"]>(
    async (opts) => {
      try {
        await api.auth.logout({ all_devices: opts?.allDevices ?? false });
      } catch {
        /* the server session may already be gone; always clear locally */
      }
      await signOutLocally();
    },
    [signOutLocally],
  );

  const markPasswordChanged = useCallback(() => {
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, must_change_password: false };
      void persistUser(next);
      return next;
    });
  }, [persistUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      mustChangePassword: user?.must_change_password ?? false,
      login,
      logout,
      refreshUser,
      markPasswordChanged,
    }),
    [status, user, login, logout, refreshUser, markPasswordChanged],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
