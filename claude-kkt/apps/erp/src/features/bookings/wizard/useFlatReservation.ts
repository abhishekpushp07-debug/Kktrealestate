import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatRow } from "@kkt/contracts";
import { api, describeError, isApiClientError } from "@/lib/api";

/** Minutes a wizard reservation lasts (POST /flats/:id/reserve accepts 1–30). */
export const RESERVE_MINUTES = 15;
/** Extend automatically when less than this is left and the user did something recently. */
export const AUTO_EXTEND_BELOW_SECONDS = 120;
/** "Recently" for the automatic extension. */
export const ACTIVE_WITHIN_MS = 5 * 60_000;

export type ReservationStatus = "idle" | "reserving" | "held" | "expired" | "unavailable" | "error";

export interface FlatUnavailable {
  current_status: string | null;
  hold_until: string | null;
  message: string;
}

/** Seconds left until `holdUntil` (0 when past or unknown). */
export function secondsLeft(holdUntil: string | null, now: number = Date.now()): number {
  if (!holdUntil) return 0;
  const at = Date.parse(holdUntil);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
}

/** 754 → "12:34". */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * A hold the wizard may release on cancel: one it created (≤ the reserve length). A longer hold of the same user (e.g. a 48 h manual
 * hold the server kept instead of shortening) is left alone.
 */
export function isWizardHold(holdUntil: string | null, reservedAt: number): boolean {
  if (!holdUntil) return false;
  return Date.parse(holdUntil) - reservedAt <= (RESERVE_MINUTES + 1) * 60_000;
}

export interface UseFlatReservationOptions {
  flatId: string | null;
  /** Pause (e.g. after the booking was confirmed: the flat is BOOKED now). */
  enabled: boolean;
  /** Timestamp of the user's last change in the wizard (drives the automatic extension). */
  lastActivityAt: number;
  /** Someone else holds / booked the flat: the wizard clears its selection. */
  onUnavailable: (info: FlatUnavailable) => void;
}

export interface UseFlatReservationResult {
  status: ReservationStatus;
  holdUntil: string | null;
  secondsLeft: number;
  error: string | null;
  /** Reserve again / extend by RESERVE_MINUTES. */
  extend: () => Promise<void>;
  /** Release the wizard's hold (cancel). Safe to call when nothing is held. */
  release: (reason?: string) => Promise<void>;
  /** Forget the hold without releasing it (the booking was created: the flat is BOOKED). */
  forget: () => void;
}

/**
 * Short flat reservation for the booking wizard (money track, SPEC §4): POST /flats/:id/reserve when a flat is picked (repeat = extend),
 * a live countdown, POST /flats/:id/release when the flat changes or the wizard is cancelled. 409 FLAT_NOT_AVAILABLE → onUnavailable.
 */
export function useFlatReservation({
  flatId,
  enabled,
  lastActivityAt,
  onUnavailable,
}: UseFlatReservationOptions): UseFlatReservationResult {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReservationStatus>("idle");
  const [holdUntil, setHoldUntilState] = useState<string | null>(null);
  const holdUntilRef = useRef<string | null>(null);
  const setHoldUntil = useCallback((value: string | null) => {
    holdUntilRef.current = value;
    setHoldUntilState(value);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** The flat the wizard holds; `releasable` is null until the first reserve answered. */
  const held = useRef<{ flatId: string; releasable: boolean | null } | null>(null);
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    unavailableRef.current = onUnavailable;
  });
  const extending = useRef(false);

  const refreshFlat = useCallback(
    (id: string) => {
      void queryClient.invalidateQueries({ queryKey: ["/flats"] });
      void queryClient.invalidateQueries({ queryKey: ["/blocks"] });
      void queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(id) });
    },
    [queryClient],
  );

  const releaseFlat = useCallback(
    async (id: string, reason: string) => {
      try {
        await api.post<FlatRow>(`/flats/${id}/release`, { reason });
      } catch {
        /* lapsed already, booked, or not ours any more: nothing to give back */
      }
      refreshFlat(id);
    },
    [refreshFlat],
  );

  const reserve = useCallback(
    async (id: string) => {
      setStatus((previous) => (previous === "held" ? previous : "reserving"));
      setError(null);
      const startedAt = Date.now();
      try {
        const row = await api.post<FlatRow>(`/flats/${id}/reserve`, { minutes: RESERVE_MINUTES });
        if (held.current?.flatId !== id) {
          // the user picked another flat (or cancelled) while this was in flight: give this one back
          if (isWizardHold(row.hold_until, startedAt)) void releaseFlat(id, "Booking wizard: another flat was picked");
          return;
        }
        held.current = { flatId: id, releasable: held.current.releasable ?? isWizardHold(row.hold_until, startedAt) };
        setHoldUntil(row.hold_until);
        setStatus("held");
        refreshFlat(id);
      } catch (cause) {
        if (isApiClientError(cause) && cause.status === 409 && cause.code === "FLAT_NOT_AVAILABLE") {
          held.current = null;
          setHoldUntil(null);
          setStatus("unavailable");
          const details = cause.details ?? {};
          unavailableRef.current({
            current_status: typeof details.current_status === "string" ? details.current_status : null,
            hold_until: typeof details.hold_until === "string" ? details.hold_until : null,
            message: cause.message,
          });
          refreshFlat(id);
          return;
        }
        setStatus("error");
        setError(describeError(cause));
      }
    },
    [refreshFlat, releaseFlat, setHoldUntil],
  );

  // Pick → reserve; change → release the previous one first.
  useEffect(() => {
    if (!enabled) return;
    const previous = held.current;
    if (previous && previous.flatId !== flatId) {
      held.current = null;
      if (previous.releasable !== false && secondsLeft(holdUntilRef.current) > 0)
        void releaseFlat(previous.flatId, "Booking wizard: another flat was picked");
    }
    if (!flatId || held.current?.flatId === flatId) return;
    held.current = { flatId, releasable: null };
    void reserve(flatId);
  }, [flatId, enabled, reserve, releaseFlat]);

  // Countdown tick.
  useEffect(() => {
    if (status !== "held") return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [status]);

  const left = status === "held" ? secondsLeft(holdUntil, now) : 0;
  // derived, not stored: no flat → idle; a held reservation whose time ran out → expired
  const effectiveStatus: ReservationStatus = !flatId ? "idle" : status === "held" && left === 0 ? "expired" : status;

  // Extend automatically while the user is working.
  useEffect(() => {
    if (status !== "held" || !flatId || left === 0) return;
    if (left < AUTO_EXTEND_BELOW_SECONDS && Date.now() - lastActivityAt < ACTIVE_WITHIN_MS && !extending.current) {
      extending.current = true;
      void reserve(flatId).finally(() => {
        extending.current = false;
      });
    }
  }, [left, status, flatId, lastActivityAt, reserve]);

  const extend = useCallback(async () => {
    if (flatId) await reserve(flatId);
  }, [flatId, reserve]);

  const release = useCallback(
    async (reason = "Booking wizard cancelled") => {
      const current = held.current;
      const live = secondsLeft(holdUntilRef.current) > 0; // a lapsed hold is released by HOLD_EXPIRY (or already AVAILABLE)
      held.current = null;
      setStatus("idle");
      setHoldUntil(null);
      if (current && current.releasable !== false && live) await releaseFlat(current.flatId, reason);
    },
    [releaseFlat, setHoldUntil],
  );

  const forget = useCallback(() => {
    held.current = null;
    setStatus("idle");
    setHoldUntil(null);
  }, [setHoldUntil]);

  return { status: effectiveStatus, holdUntil, secondsLeft: left, error, extend, release, forget };
}
