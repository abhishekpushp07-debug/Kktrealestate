import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";

export const GO = { p: ["/projects", "Projects"], c: ["/customers", "Customers"], b: ["/bookings", "Bookings"], h: ["/dashboard", "Home"], y: ["/payments", "Payments"], l: ["/leads", "Leads"], s: ["/service-requests", "Service"], r: ["/reports", "Reports"] };
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

/** Global keyboard navigation: ⌘K palette, ⌘S submit nearest form, `/` focus search, `?` shortcuts sheet, `g` + key go-to. */
export function useKeyboardNav({ setOpen, setHelp }) {
  const navigate = useNavigate();
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {  // Ctrl/Cmd+S submits the nearest open form instead of "Save page"
        const form = document.activeElement?.closest?.("form") || document.querySelector("[role=dialog] form, form[data-save-on-shortcut]");
        if (form) { e.preventDefault(); form.requestSubmit(); }
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {  // `/` focuses the first search box on the page
        const s = document.querySelector("main input[type=search], main input[data-search], main input[placeholder*='Search' i], input[type=search], input[placeholder*='Search' i]");
        if (s) { e.preventDefault(); s.focus(); s.select?.(); }
        return;
      }
      if (e.key === "?") { e.preventDefault(); setHelp((h) => !h); return; }
      if (e.key === "g") { pendingG = Date.now(); return; }
      if (pendingG && Date.now() - pendingG < 1200 && GO[e.key]) { e.preventDefault(); pendingG = 0; navigate(GO[e.key][0]); return; }
      pendingG = 0;
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey); window.addEventListener("kkt:open-palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("kkt:open-palette", onOpen); };
  }, [navigate, setOpen, setHelp]);
}

/** Debounced global record search for the palette (200 ms, 6 per group). */
export function usePaletteSearch(q) {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setGroups([]); return; }
    const t = setTimeout(() => api.get("/search", { params: { q: q.trim(), limit: 6 } }).then((r) => setGroups(r.data.groups)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  return groups;
}
