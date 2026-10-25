import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { idbGet, idbSet } from "@/lib/idb";

const KEY = "catalogues_v1";
let mem = null;
const subs = new Set();

export async function loadCatalogues(force = false) {
  if (mem && !force) return mem;
  const cached = !force ? await idbGet(KEY) : null;
  const headers = cached?.etag ? { "If-None-Match": cached.etag } : {};
  try {
    const r = await api.get("/catalogues", { headers, validateStatus: (s) => s === 200 || s === 304 });
    mem = r.status === 304 ? cached.data : r.data;
    await idbSet(KEY, { etag: r.headers.etag, version: mem?.version, data: mem });
  } catch (e) {
    if (cached) mem = cached.data; else throw e;
  }
  subs.forEach((f) => f(mem));
  return mem;
}

export const invalidateCatalogues = () => loadCatalogues(true);

// Returns the whole bundle; `types[type]` is [{id, code, label, parent_id, meta}].
export function useCatalogues() {
  const [data, setData] = useState(mem);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const f = (d) => mounted.current && setData(d);
    subs.add(f);
    if (!mem) { idbGet(KEY).then((c) => { if (c?.data && !mem && mounted.current) setData(c.data); }); loadCatalogues().catch(() => {}); }
    return () => { mounted.current = false; subs.delete(f); };
  }, []);
  const opts = (type, parentId) => (data?.types?.[type] || []).filter((i) => !parentId || i.parent_id === parentId).map((i) => ({ value: i.id, label: i.label, sub: i.code, meta: i.meta, parent_id: i.parent_id }));
  const label = (type, id) => (data?.types?.[type] || []).find((i) => i.id === id)?.label || "";
  return { catalogues: data, loading: !data, opts, label, version: data?.version };
}
