import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BookingDraftRow } from "@kkt/contracts";
import { readStorage, useOnChange, writeStorage } from "@/lib/utils";
import { bookingKeys, deleteDraft, saveDraft } from "../api";
import { toDraftPayload, wizardHasContent, type WizardState } from "../bookingMath";

export const LOCAL_DRAFT_KEY = "kkt.erp.booking-draft";

/** What the browser keeps: the full UI state (incl. split mode) plus the server draft id. */
export interface LocalDraft {
  id: string | null;
  step: number;
  payload: Record<string, unknown>;
  updated_at: string;
}

export function readLocalDraft(): LocalDraft | null {
  const raw = readStorage<LocalDraft | null>(LOCAL_DRAFT_KEY, null);
  if (!raw || typeof raw !== "object" || typeof raw.payload !== "object" || raw.payload === null) return null;
  return raw;
}

export function clearLocalDraft(): void {
  try {
    localStorage.removeItem(LOCAL_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export type DraftStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseBookingDraftOptions {
  state: WizardState;
  /** 1-based step for the server payload. */
  step: number;
  /** Server draft id when resuming. */
  draftId: string | null;
  onDraftId: (id: string) => void;
  /** Pause autosave (e.g. after a successful confirm). */
  enabled: boolean;
  /** The draft already exists on the server (resumed); otherwise discard deletes only after the first successful save. */
  persisted?: boolean;
  delayMs?: number;
}

export interface UseBookingDraftResult {
  status: DraftStatus;
  lastSavedAt: string | null;
  /** Save immediately (used before navigating away). */
  flush: () => Promise<void>;
  /** Delete the server draft and the local copy. */
  discard: () => Promise<void>;
}

/**
 * Debounced autosave of the wizard: the contract-shaped payload goes to `PUT/POST /booking-drafts`
 * and the full UI state to localStorage as a fallback (so an API hiccup never loses the work).
 */
export function useBookingDraft({
  state,
  step,
  draftId,
  onDraftId,
  enabled,
  persisted = false,
  delayMs = 1500,
}: UseBookingDraftOptions): UseBookingDraftResult {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const lastServerSnapshot = useRef<string>("");
  const timer = useRef<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const latest = useRef({ state, step, draftId });
  // Read by timers and handlers only (never while rendering), so it is refreshed right after each commit.
  useLayoutEffect(() => {
    latest.current = { state, step, draftId };
  });
  /** Whether the current draft id exists on the server (resumed, or saved at least once): discard only deletes those. */
  const persistedRef = useRef(persisted);
  useEffect(() => {
    if (persisted) persistedRef.current = true;
  }, [persisted]);

  const persistLocal = useCallback((current: WizardState, currentStep: number, id: string | null) => {
    writeStorage<LocalDraft>(LOCAL_DRAFT_KEY, {
      id,
      step: currentStep,
      payload: { ...toDraftPayload(current), split_mode: current.split_mode },
      updated_at: new Date().toISOString(),
    });
  }, []);

  const save = useCallback(async (): Promise<void> => {
    const { state: current, step: currentStep, draftId: id } = latest.current;
    if (!wizardHasContent(current)) return;
    const payload = toDraftPayload(current);
    const snapshot = JSON.stringify({ payload, step: currentStep });
    persistLocal(current, currentStep, id);
    if (snapshot === lastServerSnapshot.current) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    try {
      const row: BookingDraftRow = await saveDraft({ id: id ?? undefined, step: currentStep, payload });
      lastServerSnapshot.current = snapshot;
      persistedRef.current = true;
      if (row.id !== id) onDraftId(row.id);
      persistLocal(current, currentStep, row.id);
      setLastSavedAt(row.updated_at);
      setStatus("saved");
      void queryClient.invalidateQueries({ queryKey: bookingKeys.drafts });
    } catch {
      setStatus("error");
    }
  }, [onDraftId, persistLocal, queryClient]);

  // Every state / step change marks the draft dirty (while rendering) and restarts the debounce timer (effect).
  const dirtyState = enabled && wizardHasContent(state) ? state : null;
  const markDirty = () => setStatus((previous) => (previous === "saving" ? previous : "dirty"));
  useOnChange(dirtyState, (changed) => {
    if (changed) markDirty();
  });
  useOnChange(step, () => {
    if (dirtyState) markDirty();
  });
  useEffect(() => {
    if (!enabled) return;
    if (!wizardHasContent(state)) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      inFlight.current = save().finally(() => {
        inFlight.current = null;
      });
    }, delayMs);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [state, step, enabled, delayMs, save]);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    await save();
  }, [save]);

  const discard = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const id = persistedRef.current ? latest.current.draftId : null;
    clearLocalDraft();
    lastServerSnapshot.current = "";
    setStatus("idle");
    setLastSavedAt(null);
    if (id) {
      try {
        await deleteDraft(id);
      } catch {
        /* already gone */
      }
      void queryClient.invalidateQueries({ queryKey: bookingKeys.drafts });
    }
  }, [queryClient]);

  return { status, lastSavedAt, flush, discard };
}
