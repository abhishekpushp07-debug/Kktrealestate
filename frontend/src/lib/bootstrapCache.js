// IndexedDB-cached /api/bootstrap with ETag revalidation + version-stamp invalidation (Phase D2).
import api from "@/lib/api";
import { idbGet, idbSet } from "@/lib/idb";

const KEY = "bootstrap_v1";
let mem = null;
let inflight = null;

export async function loadBootstrap(force = false) {
  if (mem && !force) return mem;
  if (inflight) return inflight;  // dedupe concurrent callers
  inflight = (async () => {
    const cached = await idbGet(KEY);
    const headers = cached?.etag ? { "If-None-Match": cached.etag } : {};
    try {
      const r = await api.get("/bootstrap", { headers, validateStatus: (s) => s === 200 || s === 304 });
      const data = r.status === 304 ? cached.data : r.data;
      const stamp = data?.version || data?.catalogues_version || data?.company?.version;
      if (cached && stamp && cached.stamp && cached.stamp !== stamp) { /* version changed → replace cache */ }
      mem = data;
      await idbSet(KEY, { etag: r.headers.etag, stamp, data, at: Date.now() });
    } catch (e) {
      if (cached?.data) mem = cached.data; else throw e;
    }
    return mem;
  })().finally(() => { inflight = null; });
  return inflight;
}

export const getBootstrapSync = () => mem;
