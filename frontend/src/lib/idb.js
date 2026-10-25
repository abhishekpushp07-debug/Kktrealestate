// Tiny IndexedDB KV used for bootstrap/catalogue caches (falls back to localStorage).
const DB = "kkt-cache", STORE = "kv";
const open = () => new Promise((res, rej) => {
  if (typeof indexedDB === "undefined") return rej(new Error("no idb"));
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); }); };
export const idbGet = async (k) => { try { return await tx("readonly", (s) => s.get(k)); } catch { return JSON.parse(localStorage.getItem(`idb:${k}`) || "null"); } };
export const idbSet = async (k, v) => { try { await tx("readwrite", (s) => s.put(v, k)); } catch { try { localStorage.setItem(`idb:${k}`, JSON.stringify(v)); } catch {} } };
