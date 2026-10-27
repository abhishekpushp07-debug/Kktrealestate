import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, isApiClientError, onAuthEvent, tokens } from "@/lib/api";
import type { Permission, PermissionRequirement } from "@/lib/permissions";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** `is_system` marks the built-in roles (the Super Admin system role has powers beyond its permission list). */
  role: { id: string; name: string; is_system: boolean };
  permissions: Permission[];
  all_projects: boolean;
  project_ids: string[];
  must_change_password: boolean;
  mfa_enabled: boolean;
  avatar_url: string | null;
}

export interface AuthCompany {
  id: string;
  name: string;
  settings: Record<string, unknown>;
}

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export type LoginResult = { kind: "ok"; mustChangePassword: boolean } | { kind: "mfa"; mfaToken: string };

export interface ProjectScope {
  allProjects: boolean;
  projectIds: string[];
  /** True when the user may see this project (all projects, or in their scope list). */
  inScope: (projectId: string) => boolean;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  company: AuthCompany | null;
  mustChangePassword: boolean;
  scope: ProjectScope;
  /** `company` = the company slug, needed only on multi-company installs (400 COMPANY_REQUIRED). */
  login: (email: string, password: string, company?: string) => Promise<LoginResult>;
  completeMfa: (mfaToken: string, code: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<AuthUser | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (permission: PermissionRequirement) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
  /** The built-in Super Admin role (erase, backups, managing other Super Admins). */
  isSuperAdmin: boolean;
}

export const SUPER_ADMIN_ROLE_NAME = "Super Admin";

/** True for the built-in Super Admin system role (a custom role named the same is not). */
export function isSuperAdminUser(user: Pick<AuthUser, "role"> | null | undefined): boolean {
  return Boolean(user && user.role.name === SUPER_ADMIN_ROLE_NAME && user.role.is_system);
}

/* ------------------------------------------------------------------ */
/* Wire-shape normalisation (tolerates role:{} and role_id/role_name)   */
/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return typeof value === "object" && value !== null ? (value as Raw) : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normaliseUser(raw: unknown): AuthUser | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== "string") return null;
  const role = asRecord(record.role);
  return {
    id: record.id,
    name: str(record.name),
    email: str(record.email),
    phone: strOrNull(record.phone),
    role: {
      id: str(role?.id, str(record.role_id)),
      name: str(role?.name, str(record.role_name)),
      is_system: role?.is_system === true || record.is_system_role === true,
    },
    permissions: strArray(record.permissions) as Permission[],
    all_projects: record.all_projects === true,
    project_ids: strArray(record.project_ids),
    must_change_password: record.must_change_password === true,
    mfa_enabled: record.mfa_enabled === true,
    avatar_url: strOrNull(record.avatar_url),
  };
}

function normaliseCompany(raw: unknown): AuthCompany | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== "string") return null;
  const settings = asRecord(record.settings);
  const { id, name, ...rest } = record;
  return { id, name: str(name), settings: settings ?? rest };
}

interface MeResponse {
  user: AuthUser;
  company: AuthCompany | null;
}

/** GET /auth/me accepts both `{user, company}` and a bare user row. */
function normaliseMe(raw: unknown): MeResponse | null {
  const record = asRecord(raw);
  if (!record) return null;
  const user = normaliseUser(record.user ?? record);
  if (!user) return null;
  return { user, company: normaliseCompany(record.company) };
}

interface LoginPayload {
  mfa_required?: boolean;
  mfa_token?: string;
  access_token?: string;
  /** Absent in cookie mode (contract C1): the refresh token is the HttpOnly kkt_rt cookie. */
  refresh_token?: string;
  must_change_password?: boolean;
  user?: unknown;
}

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>(() => (tokens.hasSession() ? "loading" : "anonymous"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<AuthCompany | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearSession = useCallback(() => {
    tokens.clear();
    queryClient.clear();
    if (!mounted.current) return;
    setUser(null);
    setCompany(null);
    setStatus("anonymous");
  }, [queryClient]);

  const refreshMe = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const raw = await api.get<unknown>("/auth/me");
      const me = normaliseMe(raw);
      if (!me) throw new Error("Unexpected /auth/me response");
      if (mounted.current) {
        setUser(me.user);
        setCompany(me.company);
        setStatus("authenticated");
      }
      return me.user;
    } catch (error) {
      if (isApiClientError(error) && error.isUnauthenticated) {
        clearSession();
        return null;
      }
      // Network or server failure: keep whatever we had, but stop blocking the UI.
      if (mounted.current)
        setStatus((prev) => (prev === "loading" ? (tokens.hasSession() ? "authenticated" : "anonymous") : prev));
      throw error;
    }
  }, [clearSession]);

  // Restore the session on load.
  useEffect(() => {
    if (!tokens.hasSession()) return;
    // refreshMe sets state only after awaiting GET /auth/me (an external system); the compiler does not model the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set asynchronously, after the network response
    refreshMe().catch(() => undefined);
  }, [refreshMe]);

  // Forced sign-out (refresh failed / 401 after retry).
  useEffect(() => onAuthEvent(() => clearSession()), [clearSession]);

  const finishLogin = useCallback(
    async (payload: LoginPayload): Promise<LoginResult> => {
      if (payload.mfa_required && payload.mfa_token) {
        return { kind: "mfa", mfaToken: payload.mfa_token };
      }
      if (!payload.access_token) {
        throw new Error("Login response did not include an access token");
      }
      // The refresh token stays in the HttpOnly cookie; only the access token is kept, in memory.
      tokens.setAccess(payload.access_token);
      const provisional = normaliseUser(payload.user);
      const forced = payload.must_change_password === true || provisional?.must_change_password === true;
      if (provisional && mounted.current) {
        setUser({ ...provisional, must_change_password: forced });
        setStatus("authenticated");
      }
      const me = await refreshMe().catch(() => provisional);
      return { kind: "ok", mustChangePassword: forced || me?.must_change_password === true };
    },
    [refreshMe],
  );

  const login = useCallback(
    async (email: string, password: string, company?: string): Promise<LoginResult> => {
      const slug = company?.trim().toLowerCase();
      const payload = await api.post<LoginPayload>(
        "/auth/login",
        { email, password, ...(slug ? { company: slug } : {}) },
        { auth: false, cookieSession: true },
      );
      return finishLogin(payload);
    },
    [finishLogin],
  );

  const completeMfa = useCallback(
    async (mfaToken: string, code: string): Promise<LoginResult> => {
      const payload = await api.post<LoginPayload>(
        "/auth/login/mfa",
        { mfa_token: mfaToken, code },
        { auth: false, cookieSession: true },
      );
      return finishLogin(payload);
    },
    [finishLogin],
  );

  const logout = useCallback(async () => {
    try {
      // Revokes this session's refresh family and clears the HttpOnly cookie (contract C1).
      if (tokens.hasSession()) await api.post<void>("/auth/logout", undefined, { cookieSession: true });
    } catch {
      /* the session is gone either way */
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.post<void>("/auth/change-password", { current_password: currentPassword, new_password: newPassword });
      setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev));
      await refreshMe().catch(() => undefined);
    },
    [refreshMe],
  );

  const permissionSet = useMemo(() => new Set<string>(user?.permissions ?? []), [user]);

  const can = useCallback(
    (permission: PermissionRequirement): boolean => {
      if (typeof permission === "string") return permissionSet.has(permission);
      return permission.some((code) => permissionSet.has(code));
    },
    [permissionSet],
  );
  const canAny = useCallback(
    (codes: readonly Permission[]) => codes.some((code) => permissionSet.has(code)),
    [permissionSet],
  );
  const canAll = useCallback(
    (codes: readonly Permission[]) => codes.every((code) => permissionSet.has(code)),
    [permissionSet],
  );

  const scope = useMemo<ProjectScope>(() => {
    const ids = user?.project_ids ?? [];
    const all = user?.all_projects ?? false;
    const set = new Set(ids);
    return { allProjects: all, projectIds: ids, inScope: (projectId: string) => all || set.has(projectId) };
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      company,
      mustChangePassword: user?.must_change_password === true,
      scope,
      login,
      completeMfa,
      logout,
      refreshMe,
      changePassword,
      can,
      canAny,
      canAll,
      isSuperAdmin: isSuperAdminUser(user),
    }),
    [status, user, company, scope, login, completeMfa, logout, refreshMe, changePassword, can, canAny, canAll],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

/** `can(permission)` as a hook, for components that only need the check. */
export function useCan(): AuthContextValue["can"] {
  return useAuth().can;
}
