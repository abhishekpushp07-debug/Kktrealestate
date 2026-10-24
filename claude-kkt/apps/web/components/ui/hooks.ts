"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Traps Tab focus inside `ref` while `active`, restores focus to the opener on release. */
export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean, onEscape?: () => void) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const initial = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? root;
    const raf = requestAnimationFrame(() => initial.focus({ preventScroll: true }));

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

/** Prevents background scrolling while `locked`. */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [locked]);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Reads and writes a JSON value in localStorage, tolerating private mode / blocked storage. */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // storage unavailable
    }
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
    },
    [key],
  );
  return [value, update];
}

/** Captures UTM parameters from the current URL once on mount. */
export function useUtmParams(): Record<string, string> {
  const [utm, setUtm] = useState<Record<string, string>>({});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const key of ["source", "medium", "campaign", "term", "content"]) {
      const value = params.get(`utm_${key}`);
      if (value) found[key] = value.slice(0, 200);
    }
    if (Object.keys(found).length) {
      setUtm(found);
      try {
        window.sessionStorage.setItem("kkt:utm", JSON.stringify(found));
      } catch {
        // ignore
      }
    } else {
      try {
        const stored = window.sessionStorage.getItem("kkt:utm");
        if (stored) setUtm(JSON.parse(stored) as Record<string, string>);
      } catch {
        // ignore
      }
    }
  }, []);
  return utm;
}
