import { useEffect, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";

// localStorage: theme — non-sensitive UI preference (CR-7); the server profile is the source of truth
const KEY = "kkt:theme";
export const THEMES = [
  ["night", "Night"],
  ["day", "Day"],
];
const META = { day: "#ffffff", night: "#05070c" };
// stored "light" (Phase 2 wording) is the Day theme; anything unset is Night (REQ-174)
export const normTheme = (t) => (t === "day" || t === "light" ? "day" : "night");
const root = document.documentElement;
let cur = normTheme(root.dataset.theme);
let pending = null;
let timer = null;
const subs = new Set();

function apply(t) {
  cur = t;
  root.dataset.theme = t;
  localStorage.setItem(KEY, t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[t]);
  subs.forEach((f) => f(t));
}

async function save(t) {
  try {
    await api.patch("/auth/me/preferences", { theme: t }, { unversioned: true });
    pending = null;
  } catch {
    pending = t; // kept for this session; retried until the profile accepts it
    toast.warning("Theme not saved — will retry", { id: "theme-save" });
    clearTimeout(timer);
    timer = setTimeout(() => pending && save(pending), 30_000);
  }
}

export function setTheme(t) {
  if (t === cur) return;
  apply(t);
  save(t);
}

/** After /auth/me: the profile wins (another device may have switched); an unsaved local choice is re-sent. */
export function reconcileTheme(serverTheme) {
  if (pending) return save(pending);
  const t = normTheme(serverTheme);
  if (t !== cur) apply(t);
}

export function useTheme() {
  const [t, setT] = useState(cur);
  useEffect(() => {
    subs.add(setT);
    return () => subs.delete(setT);
  }, []);
  return [t, setTheme];
}
