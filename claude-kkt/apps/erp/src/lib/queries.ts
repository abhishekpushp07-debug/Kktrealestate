import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, describeError, isApiClientError, type ApiClientError, type ListEnvelope, type ListParams, type QueryValue } from "@/lib/api";
import { conflictDetailsFrom, conflictStore } from "@/lib/conflict-store";

export { conflictStore, useVersionConflict } from "@/lib/conflict-store";

/* ------------------------------------------------------------------ */
/* Query keys                                                           */
/* ------------------------------------------------------------------ */

export const queryKeys = {
  all: (endpoint: string) => [endpoint] as const,
  list: (endpoint: string, params: ListParams) => [endpoint, "list", params] as const,
  item: (endpoint: string, id: string) => [endpoint, "item", id] as const,
};

/* ------------------------------------------------------------------ */
/* URL-synced list state                                                */
/* ------------------------------------------------------------------ */

export interface UseListParamsOptions {
  /** Query-string keys that are forwarded to the API as typed filters. */
  filterKeys?: readonly string[];
  defaultPageSize?: number;
  defaultSort?: string | null;
  /** Prefix for URL keys when two lists share a page (e.g. "p_" → p_page). */
  prefix?: string;
}

export interface ListState {
  page: number;
  pageSize: number;
  search: string;
  sort: string | null;
  includeInactive: boolean;
  filters: Record<string, string>;
}

export interface UseListParamsResult extends ListState {
  /** Ready to pass to useList / api.list. */
  params: ListParams;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (search: string) => void;
  setSort: (sort: string | null) => void;
  setFilter: (key: string, value: string | null | undefined) => void;
  setFilters: (filters: Record<string, string | null | undefined>) => void;
  setIncludeInactive: (value: boolean) => void;
  reset: () => void;
  hasActiveFilters: boolean;
}

function parseInt1(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** Page / page size / search / sort / filters kept in the URL so lists survive reload and back. */
export function useListParams(options: UseListParamsOptions = {}): UseListParamsResult {
  const { filterKeys = [], defaultPageSize = 25, defaultSort = null, prefix = "" } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const key = useCallback((name: string) => `${prefix}${name}`, [prefix]);

  const state = useMemo<ListState>(() => {
    const filters: Record<string, string> = {};
    for (const filterKey of filterKeys) {
      const value = searchParams.get(key(filterKey));
      if (value !== null && value !== "") filters[filterKey] = value;
    }
    return {
      page: parseInt1(searchParams.get(key("page")), 1),
      pageSize: Math.min(200, parseInt1(searchParams.get(key("page_size")), defaultPageSize)),
      search: searchParams.get(key("q")) ?? "",
      sort: searchParams.get(key("sort")) ?? defaultSort,
      includeInactive: searchParams.get(key("inactive")) === "1",
      filters,
    };
  }, [searchParams, filterKeys, key, defaultPageSize, defaultSort]);

  const update = useCallback(
    (patch: Record<string, string | null | undefined>, resetPage: boolean) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [name, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === "") next.delete(key(name));
            else next.set(key(name), value);
          }
          if (resetPage) next.delete(key("page"));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, key],
  );

  const setPage = useCallback((page: number) => update({ page: page > 1 ? String(page) : null }, false), [update]);
  const setPageSize = useCallback(
    (size: number) => update({ page_size: size === defaultPageSize ? null : String(size) }, true),
    [update, defaultPageSize],
  );
  const setSearch = useCallback((search: string) => update({ q: search }, true), [update]);
  const setSort = useCallback((sort: string | null) => update({ sort: sort === defaultSort ? null : sort }, false), [update, defaultSort]);
  const setFilter = useCallback((name: string, value: string | null | undefined) => update({ [name]: value }, true), [update]);
  const setFilters = useCallback((filters: Record<string, string | null | undefined>) => update(filters, true), [update]);
  const setIncludeInactive = useCallback((value: boolean) => update({ inactive: value ? "1" : null }, true), [update]);
  const reset = useCallback(() => {
    const patch: Record<string, null> = { page: null, page_size: null, q: null, sort: null, inactive: null };
    for (const filterKey of filterKeys) patch[filterKey] = null;
    update(patch, true);
  }, [update, filterKeys]);

  const params = useMemo<ListParams>(
    () => ({
      page: state.page,
      page_size: state.pageSize,
      search: state.search,
      sort: state.sort,
      include_inactive: state.includeInactive,
      filters: state.filters as Record<string, QueryValue>,
    }),
    [state],
  );

  return {
    ...state,
    params,
    setPage,
    setPageSize,
    setSearch,
    setSort,
    setFilter,
    setFilters,
    setIncludeInactive,
    reset,
    hasActiveFilters: Object.keys(state.filters).length > 0 || state.search !== "" || state.includeInactive,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

export type ListQueryOptions<T> = Omit<
  UseQueryOptions<ListEnvelope<T>, ApiClientError, ListEnvelope<T>, QueryKey>,
  "queryKey" | "queryFn"
>;

/** Paginated list from a standard list endpoint; keeps the previous page while loading the next. */
export function useList<T>(endpoint: string, params: ListParams, options: ListQueryOptions<T> = {}): UseQueryResult<ListEnvelope<T>, ApiClientError> {
  return useQuery<ListEnvelope<T>, ApiClientError, ListEnvelope<T>, QueryKey>({
    queryKey: queryKeys.list(endpoint, params),
    queryFn: ({ signal }) => api.list<T>(endpoint, params, { signal }),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export type ItemQueryOptions<T> = Omit<UseQueryOptions<T, ApiClientError, T, QueryKey>, "queryKey" | "queryFn">;

/** Single resource by id (`enabled` only when an id is present). */
export function useItem<T>(endpoint: string, id: string | null | undefined, options: ItemQueryOptions<T> = {}): UseQueryResult<T, ApiClientError> {
  return useQuery<T, ApiClientError, T, QueryKey>({
    queryKey: queryKeys.item(endpoint, id ?? ""),
    queryFn: ({ signal }) => api.get<T>(`${endpoint}/${id}`, { signal }),
    enabled: Boolean(id),
    ...options,
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                            */
/* ------------------------------------------------------------------ */

export interface MutationToastOptions<TData, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, ApiClientError, TVariables, TContext>, "onSuccess" | "onError"> {
  successMessage?: string | ((data: TData, variables: TVariables) => string) | false;
  errorMessage?: string | ((error: ApiClientError, variables: TVariables) => string) | false;
  /** Query keys (prefixes) to invalidate after success. */
  invalidate?: readonly QueryKey[];
  /** Label used by the version-conflict dialog ("This booking"). */
  entityLabel?: string;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void | Promise<unknown>;
  onError?: (error: ApiClientError, variables: TVariables, context: TContext | undefined) => void;
}

/**
 * useMutation with success / error toasts and 409 VERSION_CONFLICT routed to the
 * VersionConflictDialog, whose reload action invalidates the same keys.
 */
export function useMutationWithToast<TData = unknown, TVariables = void, TContext = unknown>(
  options: MutationToastOptions<TData, TVariables, TContext>,
): UseMutationResult<TData, ApiClientError, TVariables, TContext> {
  const queryClient = useQueryClient();
  const { successMessage = "Saved", errorMessage, invalidate = [], entityLabel, onSuccess, onError, ...rest } = options;

  const invalidateAll = useCallback(
    () => Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
    [queryClient, invalidate],
  );

  return useMutation<TData, ApiClientError, TVariables, TContext>({
    ...rest,
    onSuccess: async (data, variables, context) => {
      await invalidateAll();
      if (successMessage !== false) {
        toast.success(typeof successMessage === "function" ? successMessage(data, variables) : successMessage);
      }
      await onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      if (isApiClientError(error) && error.isVersionConflict) {
        conflictStore.show({
          entityLabel,
          ...conflictDetailsFrom(error.details),
          onReload: async () => {
            await (invalidate.length ? invalidateAll() : queryClient.invalidateQueries());
          },
        });
      } else if (errorMessage !== false) {
        toast.error(typeof errorMessage === "function" ? errorMessage(error, variables) : (errorMessage ?? describeError(error)));
      }
      onError?.(error, variables, context);
    },
  });
}
