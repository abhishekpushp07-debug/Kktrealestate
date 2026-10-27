/**
 * Chunk-load recovery (audit v3 H4). After a deploy the old index.html's lazy chunks (hashed file names) are gone, so a lazy
 * route import fails until the page reloads. Vite fires `vite:preloadError` for a failed dynamic import; a route error can also
 * surface the failure. Either way the ERP reloads ONCE (guarded through sessionStorage, so a really broken deploy shows the
 * error page instead of looping) and the new index.html brings the new chunk names.
 */

export const CHUNK_RELOAD_KEY = "kkt.erp.chunk-reload-at";
/** A second chunk failure within this window after a reload is shown, not reloaded again. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

const CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
];

/** True for the errors browsers raise when a lazy chunk (JS or CSS) cannot be fetched. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error);
  return CHUNK_PATTERNS.some((pattern) => pattern.test(`${name} ${message}`));
}

export interface ReloadEnv {
  now: () => number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
}

function defaultEnv(): ReloadEnv {
  let storage: ReloadEnv["storage"];
  try {
    storage = typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    storage = null;
  }
  return {
    now: () => Date.now(),
    storage,
    reload: () => window.location.reload(),
  };
}

/**
 * Reloads the page once for a chunk failure. Returns true when a reload was started, false when one already happened within
 * CHUNK_RELOAD_WINDOW_MS (or storage is unavailable, so the guard cannot be kept): the caller then shows its error UI.
 */
export function reloadOnceForChunkError(env: ReloadEnv = defaultEnv()): boolean {
  if (!env.storage) return false;
  try {
    const last = Number(env.storage.getItem(CHUNK_RELOAD_KEY) ?? "0");
    const now = env.now();
    if (Number.isFinite(last) && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    env.storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  env.reload();
  return true;
}

/** Installs the `vite:preloadError` listener (main.tsx). */
export function installChunkReload(target: Window = window): () => void {
  const handler = (event: Event) => {
    if (reloadOnceForChunkError()) event.preventDefault(); // stop Vite re-throwing while the page reloads
  };
  target.addEventListener("vite:preloadError", handler);
  return () => target.removeEventListener("vite:preloadError", handler);
}
