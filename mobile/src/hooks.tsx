// Data hooks — same query keys/endpoints as frontend/src/apps/portal/hooks.js.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, ApiError, request } from "@/src/api/client";
import { BOOKING_KEY, useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";

export type Booking = {
  id: string;
  booking_number: string;
  booking_date: string;
  status: string;
  project_name: string;
  block_name: string;
  flat_number: string;
  floor: number;
  flat_type: string;
  super_builtup_sqft: number;
  construction_percent: number;
  current_milestone?: string | null;
  next_milestone?: string | null;
  cover_image?: string | null;
  agreement_value: number;
  cash_agreed: number;
  account_agreed: number;
  paid: number;
  cash_paid: number;
  account_paid: number;
  cash_due: number;
  account_due: number;
  other_charges_due: number;
  total_due: number;
  pending_cheques: number;
  is_primary: boolean;
  next_due?: { due_date: string; amount: number; milestone: string } | null;
};

export type PortalConfig = {
  brand_name?: string;
  logo_url?: string | null;
  primary_phone?: string | null;
  whatsapp?: string | null;
  support_email?: string | null;
  erp_url?: string | null;
  portal_url?: string | null;
};

const STALE = 30_000;

export const useBookings = () => {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["p-bookings"],
    queryFn: () => api.get<{ items: Booking[] }>("/bookings").then((r) => r.items),
    staleTime: STALE,
    enabled: status === "in",
  });
};

export function useBookingSub<T = any>(id: string | undefined, sub: string, enabled = true) {
  return useQuery({
    queryKey: ["p-booking", id, sub],
    queryFn: () => api.get<T>(`/bookings/${id}${sub ? `/${sub}` : ""}`),
    enabled: !!id && enabled,
    staleTime: STALE,
  });
}

export const useNotices = () => {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["p-notices"],
    queryFn: () => api.get<{ items: any[]; unread: number }>("/notices"),
    staleTime: 60_000,
    enabled: status === "in",
  });
};

export const useRequests = () =>
  useQuery({
    queryKey: ["p-requests"],
    queryFn: () => api.get<{ items: any[] }>("/service-requests").then((r) => r.items),
    staleTime: STALE,
  });

// GET /api/portal/config (unauthenticated). Falls back to company info from /me, then defaults.
export function useConfig(): PortalConfig & { brand: string } {
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ["p-config"],
    queryFn: async () => {
      try {
        return await request<PortalConfig>("/config", { auth: false });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return {} as PortalConfig;
        throw e;
      }
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const c = q.data || {};
  return {
    ...c,
    brand: c.brand_name || me?.company?.name || "KKT Home",
    primary_phone: c.primary_phone || me?.company?.letterhead_phone || null,
    support_email: c.support_email || me?.company?.letterhead_email || null,
    whatsapp: c.whatsapp || null,
  };
}

// Selected booking shared across all tabs, remembered on the device.
type ActiveCtx = { selected: string | null; select: (id: string) => void };
const ActiveBookingCtx = createContext<ActiveCtx>({ selected: null, select: () => {} });

export function ActiveBookingProvider({ children }: PropsWithChildren) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    storage.getItem<string | null>(BOOKING_KEY, null).then((v) => v && setSelected(v));
  }, []);
  const select = useCallback((id: string) => {
    setSelected(id);
    storage.setItem(BOOKING_KEY, id);
  }, []);
  const value = useMemo(() => ({ selected, select }), [selected, select]);
  return <ActiveBookingCtx.Provider value={value}>{children}</ActiveBookingCtx.Provider>;
}

export function useActiveBooking() {
  const q = useBookings();
  const { selected, select } = useContext(ActiveBookingCtx);
  const items = q.data || [];
  const active = items.find((b) => b.id === selected) || items[0] || null;
  return { ...q, items, active, select };
}
