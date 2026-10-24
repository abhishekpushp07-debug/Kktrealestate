import type { ActiveStateResponse, PermissionGroupResponse, UserRow } from "@kkt/contracts";
import { api } from "@/lib/api";

export const USERS_PATH = "/users";
export const ROLES_PATH = "/roles";
export const AUDIT_PATH = "/audit-logs";
export const LOGIN_EVENTS_PATH = "/audit-logs/login-events";
export const SETTINGS_PATH = "/settings/company";
export const SESSIONS_PATH = "/auth/sessions";
export const NOTIFICATIONS_PATH = "/notifications";

export interface VersionedBody {
  version: number;
}

export function deactivateUser(user: UserRow): Promise<ActiveStateResponse> {
  return api.post<ActiveStateResponse>(`${USERS_PATH}/${user.id}/deactivate`, { version: user.version } satisfies VersionedBody, { version: user.version });
}

export function activateUser(user: UserRow): Promise<ActiveStateResponse> {
  return api.post<ActiveStateResponse>(`${USERS_PATH}/${user.id}/activate`, { version: user.version } satisfies VersionedBody, { version: user.version });
}

export function unlockUser(user: UserRow): Promise<ActiveStateResponse> {
  return api.post<ActiveStateResponse>(`${USERS_PATH}/${user.id}/unlock`, { version: user.version } satisfies VersionedBody, { version: user.version });
}

export interface ResetPasswordResult {
  id?: string;
  version?: number;
  /** Contracts name (`UserResetPasswordResponse`). */
  temp_password?: string;
  /** Endpoint brief name. */
  temporary_password?: string;
}

/** Admin password reset: the API generates a temporary password returned exactly once. */
export async function resetUserPassword(user: UserRow): Promise<string | null> {
  const result = await api.post<ResetPasswordResult>(
    `${USERS_PATH}/${user.id}/reset-password`,
    { version: user.version, must_change_password: true },
    { version: user.version },
  );
  return result.temporary_password ?? result.temp_password ?? null;
}

/** `GET /permissions` may answer `{groups}` or a bare array. */
export function normalisePermissionCatalog(raw: unknown): PermissionGroupResponse[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null && Array.isArray((raw as { groups?: unknown }).groups) ? (raw as { groups: unknown[] }).groups : null;
  if (!list) return null;
  const groups: PermissionGroupResponse[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== "string" || typeof record.label !== "string" || !Array.isArray(record.permissions)) continue;
    const permissions = record.permissions.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const permission = item as Record<string, unknown>;
      return typeof permission.code === "string" && typeof permission.label === "string" ? [{ code: permission.code, label: permission.label }] : [];
    });
    groups.push({ key: record.key, label: record.label, permissions });
  }
  return groups;
}

/** True while the lockout timestamp is in the future. */
export function isLocked(lockedUntil: string | null, now: number = Date.now()): boolean {
  if (!lockedUntil) return false;
  const until = Date.parse(lockedUntil);
  return Number.isFinite(until) && until > now;
}
