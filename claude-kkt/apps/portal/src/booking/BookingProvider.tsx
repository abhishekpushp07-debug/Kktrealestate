// The selected booking (customers can be primary or co-applicant on several bookings).
// The choice is persisted so the app reopens on the same flat.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PortalBookingSwitcherItem } from "@kkt/contracts";
import { useBookings } from "@/api/queries";
import { useAuth } from "@/auth/AuthProvider";
import { kvStorage } from "@/lib/storage";

const KEY = "kkt.portal.booking";

interface BookingContextValue {
  bookings: PortalBookingSwitcherItem[];
  bookingId: string | null;
  current: PortalBookingSwitcherItem | null;
  select: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

const BookingContext = createContext<BookingContextValue | null>(null);

function pickDefault(items: PortalBookingSwitcherItem[]): string | null {
  const active = items.filter((b) => b.status === "ACTIVE");
  const primary = active.find((b) => b.role === "PRIMARY") ?? active[0] ?? items[0];
  return primary?.booking_id ?? null;
}

export function BookingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { status } = useAuth();
  const query = useBookings(status === "authenticated");
  const [stored, setStored] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void kvStorage.get(KEY).then((v) => setStored(v));
  }, []);

  const bookings = useMemo(() => query.data ?? [], [query.data]);

  const bookingId = useMemo(() => {
    if (stored === undefined) return null;
    if (stored && bookings.some((b) => b.booking_id === stored)) return stored;
    return pickDefault(bookings);
  }, [stored, bookings]);

  const select = useCallback((id: string) => {
    setStored(id);
    void kvStorage.set(KEY, id);
  }, []);

  const value = useMemo<BookingContextValue>(
    () => ({
      bookings,
      bookingId,
      current: bookings.find((b) => b.booking_id === bookingId) ?? null,
      select,
      isLoading: query.isPending || stored === undefined,
      isError: query.isError && bookings.length === 0,
      refetch: query.refetch,
    }),
    [bookings, bookingId, select, query.isPending, query.isError, query.refetch, stored],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking(): BookingContextValue {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error("useBooking must be used within BookingProvider");
  return ctx;
}
