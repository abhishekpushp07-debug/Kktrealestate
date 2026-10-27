"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Traps Tab focus inside `ref` while `active`, restores focus to the opener on release. */
export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean, onEscape?: () => void) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the visitor asked for reduced motion; false while server rendering (hydration-safe). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

const noSubscription = () => () => undefined;

/** False during server rendering and hydration, true once running in the browser (portals, window-only UI). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
const NO_UTM: Record<string, string> = {};
let utmCache: { search: string; value: Record<string, string> } | null = null;

/** UTM parameters of the current URL, else those remembered for this browser session (cached per URL query). */
function readUtm(): Record<string, string> {
  const search = window.location.search;
  if (utmCache?.search === search) return utmCache.value;
  const params = new URLSearchParams(search);
  let found: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value) found[key] = value.slice(0, 200);
  }
  try {
    if (Object.keys(found).length) window.sessionStorage.setItem("kkt:utm", JSON.stringify(found));
    else {
      const stored = window.sessionStorage.getItem("kkt:utm");
      if (stored) found = JSON.parse(stored) as Record<string, string>;
    }
  } catch {
    // storage unavailable: use what the URL carries
  }
  utmCache = { search, value: Object.keys(found).length ? found : NO_UTM };
  return utmCache.value;
}

/** Captures UTM parameters from the current URL (or this session's landing URL); empty while server rendering. */
export function useUtmParams(): Record<string, string> {
  return useSyncExternalStore(noSubscription, readUtm, () => NO_UTM);
}
