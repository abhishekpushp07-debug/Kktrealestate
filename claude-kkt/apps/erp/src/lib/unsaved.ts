/**
 * Unsaved-changes guard (audit v3 H3). Every dirty form registers here; one NavigationGuardHost (components/NavigationGuard.tsx,
 * mounted once in the data router's root layout) blocks in-app navigation (sidebar, Cmd+K, browser back) with a confirm dialog
 * while anything is dirty, and sets `beforeunload` for reloads and tab closes. Sheets and dialogs (components/ui/sheet.tsx,
 * dialog.tsx) register their own dirty state and ask before closing on Esc, an outside click or the close button.
 *
 * react-router supports one blocker at a time, so forms do not call useBlocker themselves: they register a dirty flag and the
 * host's single blocker reads the registry when a navigation starts.
 */
import { useEffect, useId, useMemo } from "react";

interface Entry {
  dirty: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** A successful save opens a short window in which navigation is never blocked (save → navigate to the new record). */
let savedAt = Number.NEGATIVE_INFINITY;
export const SAVE_GRACE_MS = 1500;

function emit(): void {
  for (const listener of listeners) listener();
}

/** True while any registered form is dirty. */
export function hasUnsavedChanges(): boolean {
  for (const entry of entries.values()) if (entry.dirty) return true;
  return false;
}

/** Registers or updates one source (tests and the hook). */
export function setUnsavedSource(id: string, dirty: boolean): void {
  const entry = entries.get(id);
  if (entry) entry.dirty = dirty;
  else entries.set(id, { dirty });
  emit();
}

export function removeUnsavedSource(id: string): void {
  if (entries.delete(id)) emit();
}

/** Subscribe to registry changes (the host re-evaluates its beforeunload handler). */
export function subscribeUnsaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const savedListeners = new Set<() => void>();

/**
 * Called by the query client's mutation cache on every successful mutation. Sheets and dialogs that track "any edit" (no form dirty
 * flag of their own) treat it as "the edits so far were applied" and become clean again (e.g. a drawer whose status select and
 * reason were just saved); the next edit marks them dirty again.
 */
export function noteSaved(now = Date.now()): void {
  savedAt = now;
  for (const listener of savedListeners) listener();
}

/** Subscribe to successful saves (lib/unsaved.ts noteSaved). */
export function subscribeSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/** Test helper: forget every source and the last save. */
export function resetUnsavedRegistry(): void {
  entries.clear();
  savedAt = Number.NEGATIVE_INFINITY;
  emit();
}

export interface LocationLike {
  pathname: string;
  search: string;
}

/**
 * The blocker's decision: block when something is dirty, the navigation leaves the current page (path or query changes; a
 * hash change stays on the page) and no save just succeeded.
 */
export function shouldBlockNavigation(
  current: LocationLike,
  next: LocationLike,
  options: { dirty?: boolean; now?: number } = {},
): boolean {
  const dirty = options.dirty ?? hasUnsavedChanges();
  if (!dirty) return false;
  if ((options.now ?? Date.now()) - savedAt < SAVE_GRACE_MS) return false;
  return current.pathname !== next.pathname || current.search !== next.search;
}

export interface UnsavedChangesGuard {
  /**
   * Lets the next navigation / close through without asking: call it right before navigating away on purpose (after "Discard"
   * in your own dialog, or after a save that stays dirty until the page unmounts). The guard re-arms when `dirty` changes.
   */
  allowNavigation: () => void;
}

/**
 * Registers a dirty flag with the app-wide guard: while `dirty` is true, in-app navigation asks for confirmation and the
 * browser asks before a reload or tab close.
 */
export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const id = useId();
  useEffect(() => {
    setUnsavedSource(id, dirty);
  }, [id, dirty]);
  useEffect(() => () => removeUnsavedSource(id), [id]);
  return useMemo(() => ({ allowNavigation: () => setUnsavedSource(id, false) }), [id]);
}

/** Form controls whose edits mark a sheet/dialog dirty (search boxes and anything under [data-no-dirty] do not). */
export function isTrackedEdit(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target.closest("[data-no-dirty]")) return false;
  // hidden mirrors (Radix Select's native <select>, visually hidden inputs) are not something the user edits
  if (target.closest('[aria-hidden="true"]')) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return (target as HTMLElement).isContentEditable === true;
  const type = (target as HTMLInputElement).type;
  return type !== "search" && type !== "hidden" && target.getAttribute("role") !== "combobox";
}
