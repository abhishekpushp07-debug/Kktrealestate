import { clsx, type ClassValue } from "clsx";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind class lists, resolving conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "SITE_VISIT_DONE" → "Site visit done". */
export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "Shree Ganesh Builders" → "SG". */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Returns `value` after it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/** Stable debounced callback. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs = 300): (...args: A) => void {
  const fnRef = useRef(fn);
  const handle = useRef<number | null>(null);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useEffect(() => () => {
    if (handle.current !== null) window.clearTimeout(handle.current);
  }, []);
  return useCallback(
    (...args: A) => {
      if (handle.current !== null) window.clearTimeout(handle.current);
      handle.current = window.setTimeout(() => fnRef.current(...args), delayMs);
    },
    [delayMs],
  );
}

function subscribeMedia(query: string, onChange: () => void): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True when the CSS media query matches (SSR-safe, no layout flash on hydration). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(query, cb),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const BREAKPOINTS = {
  /** Phones: table rows render as cards. */
  mobile: "(max-width: 767px)",
  /** Below the desktop shell: sidebar becomes an off-canvas drawer. */
  compact: "(max-width: 1023px)",
} as const;

/** Reads JSON from localStorage; swallows quota / privacy-mode errors. */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Writes JSON to localStorage; swallows quota / privacy-mode errors. */
export function writeStorage<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** useState persisted in localStorage under `key`. */
export function useLocalStorageState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => readStorage(key, initial));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeStorage(key, value);
        return value;
      });
    },
    [key],
  );
  return [state, set];
}

/** Narrow helper: returns the first element or undefined without index noise. */
export function first<T>(list: readonly T[]): T | undefined {
  return list[0];
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Detects macOS for the ⌘ vs Ctrl label. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
}

let idCounter = 0;
/** Stable unique id for aria wiring when React.useId is not available (non-component code). */
export function uniqueId(prefix = "kkt"): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
