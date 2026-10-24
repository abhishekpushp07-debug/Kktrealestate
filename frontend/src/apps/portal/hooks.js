import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import papi from "./api";

export const inr = (n) => (n == null ? "—" : `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`);
export const inrShort = (n) => { if (n == null) return "—"; const a = Math.abs(n); if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`; if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`; return inr(n); };
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export const useBookings = () => useQuery({ queryKey: ["p-bookings"], queryFn: () => papi.get("/bookings").then((r) => r.data.items), staleTime: 30_000 });
export const useBookingSub = (id, sub, enabled = true) => useQuery({ queryKey: ["p-booking", id, sub], queryFn: () => papi.get(`/bookings/${id}${sub ? `/${sub}` : ""}`).then((r) => r.data), enabled: !!id && enabled, staleTime: 30_000 });

// Remembers the selected booking across pages (localStorage) and returns a switcher state.
export function useActiveBooking() {
  const q = useBookings();
  const [sel, setSel] = useState(() => localStorage.getItem("kkt_portal_booking"));
  const items = q.data || [];
  const active = items.find((b) => b.id === sel) || items[0] || null;
  useEffect(() => { if (active && active.id !== sel) { setSel(active.id); localStorage.setItem("kkt_portal_booking", active.id); } }, [active, sel]);
  return { ...q, items, active, select: (id) => { setSel(id); localStorage.setItem("kkt_portal_booking", id); } };
}

export function useRefresh(keys) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return { busy, refresh: async () => { setBusy(true); await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))); setTimeout(() => setBusy(false), 400); } };
}
