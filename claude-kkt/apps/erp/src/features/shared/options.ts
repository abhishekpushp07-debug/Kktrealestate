import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RoleRow, UserRow } from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

/** The fields pickers need from a staff user (a subset of `UserRow`, also served by the lighter directory endpoints). */
export type StaffOption = Pick<UserRow, "id" | "name" | "email" | "role_name" | "is_active">;

/**
 * Staff directory for actor / assignee / RM pickers. `GET /users` needs `users.manage`, so other roles read the
 * lighter directories their own permissions allow: `GET /leads/assignees` (lead.read) or `GET /customers/relationship-managers` (customer.read).
 */
export function useStaffOptions(enabled = true): UseQueryResult<StaffOption[], ApiClientError> {
  const { can } = useAuth();
  const source = can("users.manage") ? "users" : can("lead.read") ? "assignees" : can("customer.read") ? "relationship-managers" : "none";
  return useQuery<StaffOption[], ApiClientError, StaffOption[]>({
    queryKey: ["/users", "options", source],
    queryFn: async ({ signal }) => {
      if (source === "users") {
        const data = await api.list<UserRow>("/users", { page_size: 200, sort: "name", include_inactive: true }, { signal });
        return data.items.map((user) => ({ id: user.id, name: user.name, email: user.email, role_name: user.role_name, is_active: user.is_active }));
      }
      if (source === "assignees") {
        const data = await api.get<{ items: Array<{ id: string; name: string; role_name: string }> }>("/leads/assignees", { signal });
        return data.items.map((user) => ({ id: user.id, name: user.name, email: "", role_name: user.role_name, is_active: true }));
      }
      if (source === "relationship-managers") {
        const data = await api.get<{ items: Array<{ id: string; name: string; email: string }> }>("/customers/relationship-managers", { signal });
        return data.items.map((user) => ({ id: user.id, name: user.name, email: user.email, role_name: "Sales", is_active: true }));
      }
      return [];
    },
    staleTime: 60_000,
    enabled: enabled && source !== "none",
  });
}

/** Staff users for actor pickers (alias of `useStaffOptions`). */
export function useUserOptions(enabled = true): UseQueryResult<StaffOption[], ApiClientError> {
  return useStaffOptions(enabled);
}

/** Sales users for RM / assignee pickers; every staff user when the directory has no Sales user. */
export function useSalesUserOptions(enabled = true): UseQueryResult<StaffOption[], ApiClientError> {
  const query = useStaffOptions(enabled);
  const data = useMemo(() => {
    if (!query.data) return query.data;
    const sales = query.data.filter((user) => user.role_name.toLowerCase() === "sales");
    return sales.length > 0 ? sales : query.data;
  }, [query.data]);
  return { ...query, data } as UseQueryResult<StaffOption[], ApiClientError>;
}
