import { useSyncExternalStore } from "react";

/** What the 409 VERSION_CONFLICT dialog needs to show. */
export interface VersionConflictState {
  entityLabel?: string;
  currentVersion: number | null;
  changedBy: string | null;
  changedAt: string | null;
  /** Re-fetches the record (and closes the dialog). */
  onReload: () => void | Promise<unknown>;
}

type Listener = () => void;

let state: VersionConflictState | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const conflictStore = {
  show(next: VersionConflictState): void {
    state = next;
    emit();
  },
  dismiss(): void {
    if (state === null) return;
    state = null;
    emit();
  },
  get(): VersionConflictState | null {
    return state;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Current version-conflict dialog state (null = hidden). */
export function useVersionConflict(): VersionConflictState | null {
  return useSyncExternalStore(conflictStore.subscribe, conflictStore.get, () => null);
}

/** Reads VERSION_CONFLICT details from an error envelope. */
export function conflictDetailsFrom(details: Record<string, unknown> | undefined): {
  currentVersion: number | null;
  changedBy: string | null;
  changedAt: string | null;
} {
  // contract C6: `current_version` (the legacy `current` is read when an older API answers)
  const current = typeof details?.current_version === "number" ? details.current_version : details?.current;
  const changedBy = details?.changed_by;
  const changedAt = details?.changed_at;
  return {
    currentVersion: typeof current === "number" ? current : null,
    changedBy: typeof changedBy === "string" ? changedBy : null,
    changedAt: typeof changedAt === "string" ? changedAt : null,
  };
}
