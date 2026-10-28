import { useEffect, useRef, useState } from "react";

/** CR-2 A3: unsaved Booking Wizard draft in sessionStorage — ids, step and scalar form fields only (no customer object / names / phones).
 * Debounced writes; cleared on booking success or discard. */
export function useBookingDraft(key, slice, active) {
  const [draft, setDraft] = useState(() => {
    try { const d = JSON.parse(sessionStorage.getItem(key) || "null"); return d && (d.step > 0 || d.projectId) ? d : null; } catch { return null; }
  });
  const timer = useRef();
  useEffect(() => {
    if (!active) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { try { sessionStorage.setItem(key, JSON.stringify({ ...slice, saved_at: Date.now() })); } catch { /* quota / private mode: draft is best-effort */ } }, 400);
    return () => clearTimeout(timer.current);
  }, [key, slice, active]);
  const clear = () => { clearTimeout(timer.current); sessionStorage.removeItem(key); setDraft(null); };
  return { draft, clear, dismiss: () => setDraft(null) };
}
