import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { errMsg } from "@/lib/api";
import { toast } from "sonner";

export function useList(path, extra = {}, { pageSize: ps0 = 20, sort = "name" } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(ps0);
  const setPageSize = (n) => { setPageSizeRaw(n); setPage(1); };
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortKey, setSortKey] = useState(sort);
  const extraKey = JSON.stringify(extra);
  const timer = useRef();
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => setDebounced(search), search ? 300 : 0); return () => clearTimeout(timer.current); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, extraKey]);
  const params = { page, page_size: pageSize, search: debounced || undefined, sort: sortKey, ...JSON.parse(extraKey) };
  const q = useQuery({ queryKey: ["list", path, params], queryFn: () => api.get(path, { params }).then((r) => r.data), placeholderData: (prev) => prev, staleTime: 15_000 });
  useEffect(() => { if (q.error) toast.error(errMsg(q.error)); }, [q.error]);
  const qc = useQueryClient();
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["list", path] }), [qc, path]);
  const data = q.data || { items: [], total: 0 };
  return { ...data, loading: q.isPending || q.isFetching, page, setPage, pageSize, setPageSize, search, setSearch, sort: sortKey, setSort: setSortKey, reload };
}

export function useFetch(path, deps = []) {
  const qc = useQueryClient();
  const depsKey = JSON.stringify(deps);
  const key = useMemo(() => ["fetch", path, ...JSON.parse(depsKey)], [path, depsKey]);
  const q = useQuery({ queryKey: key, queryFn: () => api.get(path).then((r) => r.data), enabled: !!path, staleTime: 15_000 });
  const setData = useCallback((updater) => qc.setQueryData(key, (old) => (typeof updater === "function" ? updater(old) : updater)), [qc, key]);
  return { data: q.data ?? null, loading: q.isPending && !!path, error: q.error, reload: () => qc.invalidateQueries({ queryKey: key }), setData };
}

export function usePrefetch() {
  const qc = useQueryClient();
  return (path) => qc.prefetchQuery({ queryKey: ["fetch", path], queryFn: () => api.get(path).then((r) => r.data), staleTime: 15_000 });
}

export function useMasterOptions(kind, map = (x) => ({ value: x.id, label: x.name, sub: x.code })) {
  const { data } = useFetch(kind ? `/master/${kind}?page_size=100` : null);
  return { options: (data?.items || []).map(map), items: data?.items || [] };
}
