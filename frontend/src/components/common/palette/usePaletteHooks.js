import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";

export const GO = {
  p: ["/projects", "Projects"],
  c: ["/customers", "Customers"],
  b: ["/bookings", "Bookings"],
  h: ["/dashboard", "Home"],
  y: ["/payments", "Payments"],
  l: ["/leads", "Leads"],
  s: ["/service-requests", "Service"],
  r: ["/reports", "Reports"],
};
const typing = (e) =>
  /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

/** Global keyboard navigation: ⌘K palette, ⌘S submit nearest form, `/` focus search, `?` shortcuts sheet, `g` + key go-to. */
export function useKeyboardNav({ setOpen, setHelp }) {
  const navigate = useNavigate();
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        // Ctrl/Cmd+S submits the nearest open form instead of "Save page"
        const form =
          document.activeElement?.closest?.("form") ||
          document.querySelector("[role=dialog] form, form[data-save-on-shortcut]");
        if (form) {
          e.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        // `/` focuses the first search box on the page
        const s = document.querySelector(
          "main input[type=search], main input[data-search], main input[placeholder*='Search' i], input[type=search], input[placeholder*='Search' i]",
        );
        if (s) {
          e.preventDefault();
          s.focus();
          s.select?.();
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (e.key === "g") {
        pendingG = Date.now();
        return;
      }
      if (pendingG && Date.now() - pendingG < 1200 && GO[e.key]) {
        e.preventDefault();
        pendingG = 0;
        navigate(GO[e.key][0]);
        return;
      }
      pendingG = 0;
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("kkt:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("kkt:open-palette", onOpen);
    };
  }, [navigate, setOpen, setHelp]);
}

/** Debounced global record search (120 ms, 6 per group); `shownMs` = keystroke → results on screen. */
export function usePaletteSearch(q) {
  const [res, setRes] = useState({ q: "", groups: [], shownMs: null });
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRes({ q: "", groups: [], shownMs: null });
      return;
    }
    const t0 = performance.now();
    let live = true;
    const t = setTimeout(
      () =>
        api
          .get("/search", { params: { q: term, limit: 6 } })
          .then(
            (r) =>
              live &&
              setRes({
                q: term,
                groups: r.data.groups,
                shownMs: Math.round(performance.now() - t0),
              }),
          )
          .catch(() => live && setRes({ q: term, groups: [], shownMs: null })),
      120,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return res;
}
