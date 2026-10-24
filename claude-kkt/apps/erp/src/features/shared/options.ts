import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RoleRow, UserRow } from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope } from "@/lib/api";

/** Lightweight project row for scope pickers (`GET /projects`). */
export interface ProjectOption {
  id: string;
  name: string;
  code: string | null;
}

interface ProjectRowLite {
  id: string;
  name: string;
  code?: string | null;
}

/** Every project visible to the caller (scoped users only see their own). */
export function useProjectOptions(enabled = true): UseQueryResult<ProjectOption[], ApiClientError> {
  return useQuery<ListEnvelope<ProjectRowLite>, ApiClientError, ProjectOption[]>({
    queryKey: ["/projects", "options"],
    queryFn: ({ signal }) => api.list<ProjectRowLite>("/projects", { page_size: 200, sort: "name" }, { signal }),
    select: (data) => data.items.map((row) => ({ id: row.id, name: row.name, code: row.code ?? null })),
    staleTime: 60_000,
    enabled,
  });
}

/** Active roles for the user form / filter. */
export function useRoleOptions(enabled = true): UseQueryResult<RoleRow[], ApiClientError> {
  return useQuery<ListEnvelope<RoleRow>, ApiClientError, RoleRow[]>({
    queryKey: ["/roles", "options"],
    queryFn: ({ signal }) => api.list<RoleRow>("/roles", { page_size: 200, sort: "name" }, { signal }),
    select: (data) => data.items,
    staleTime: 60_000,
    enabled,
  });
}

/** Staff users for actor pickers. */
export function useUserOptions(enabled = true): UseQueryResult<UserRow[], ApiClientError> {
  return useQuery<ListEnvelope<UserRow>, ApiClientError, UserRow[]>({
    queryKey: ["/users", "options"],
    queryFn: ({ signal }) => api.list<UserRow>("/users", { page_size: 200, sort: "name", include_inactive: true }, { signal }),
    select: (data) => data.items,
    staleTime: 60_000,
    enabled,
  });
}
