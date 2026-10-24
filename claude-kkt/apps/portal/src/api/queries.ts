// TanStack Query layer: one hook per endpoint, keys scoped by booking id, cache persisted to
// AsyncStorage (7 days) so the last data renders instantly and refreshes in the background.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { focusManager, onlineManager, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PortalChangePassword,
  PortalMarkRead,
  PortalProfileUpdate,
  PortalRequestCreate,
  PortalRequestMessageCreate,
  PortalRequestRate,
  PortalRequestReopen,
  ServiceStatus,
} from "@kkt/contracts";
import { AppState, Platform } from "react-native";
import { api, ApiError } from "./client";
import type { LocalFile } from "@/lib/upload";

const DAY = 24 * 60 * 60_000;
export const CACHE_MAX_AGE = 7 * DAY;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      gcTime: CACHE_MAX_AGE,
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "kkt.portal.cache.v2", throttleTime: 1000 });

export const persistOptions = {
  persister,
  maxAge: CACHE_MAX_AGE,
  buster: "portal-2.0",
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { queryKey: readonly unknown[]; state: { status: string } }) =>
      q.state.status === "success" && q.queryKey[0] !== "pdf" && q.queryKey[0] !== "request-categories",
  },
};

export async function clearPersistedCache(): Promise<void> {
  queryClient.clear();
  try {
    await persister.removeClient();
  } catch {
    /* ignore */
  }
}

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
} else if (typeof window !== "undefined") {
  onlineManager.setEventListener((setOnline) => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  });
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const keys = {
  me: ["auth", "me"] as const,
  bookings: ["bookings"] as const,
  booking: (id: string) => ["booking", id] as const,
  home: (id: string) => ["booking", id, "home"] as const,
  flat: (id: string) => ["booking", id, "flat"] as const,
  ledger: (id: string) => ["booking", id, "ledger"] as const,
  receipts: (id: string) => ["booking", id, "receipts"] as const,
  demands: (id: string) => ["booking", id, "demands"] as const,
  schedule: (id: string) => ["booking", id, "schedule"] as const,
  construction: (id: string) => ["booking", id, "construction"] as const,
  documents: (id: string) => ["booking", id, "documents"] as const,
  bank: (id: string) => ["booking", id, "bank"] as const,
  requests: (f: { status?: ServiceStatus; booking_id?: string }) => ["requests", f.status ?? "ALL", f.booking_id ?? "ALL"] as const,
  request: (id: string) => ["request", id] as const,
  requestCategories: ["request-categories"] as const,
  notices: ["notices"] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  profile: ["profile"] as const,
  sessions: ["sessions"] as const,
};

const enabled = (id: string | null | undefined): id is string => typeof id === "string" && id.length > 0;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const useBookings = (on = true) => useQuery({ queryKey: keys.bookings, queryFn: api.bookings.list, enabled: on });
export const useHome = (id: string | null) => useQuery({ queryKey: keys.home(id ?? ""), queryFn: () => api.bookings.home(id ?? ""), enabled: enabled(id) });
export const useFlat = (id: string | null) => useQuery({ queryKey: keys.flat(id ?? ""), queryFn: () => api.bookings.flat(id ?? ""), enabled: enabled(id) });
export const useLedger = (id: string | null) => useQuery({ queryKey: keys.ledger(id ?? ""), queryFn: () => api.bookings.ledger(id ?? ""), enabled: enabled(id) });
export const useReceipts = (id: string | null) => useQuery({ queryKey: keys.receipts(id ?? ""), queryFn: () => api.bookings.receipts(id ?? ""), enabled: enabled(id) });
export const useDemands = (id: string | null) => useQuery({ queryKey: keys.demands(id ?? ""), queryFn: () => api.bookings.demands(id ?? ""), enabled: enabled(id) });
export const useSchedule = (id: string | null) => useQuery({ queryKey: keys.schedule(id ?? ""), queryFn: () => api.bookings.schedule(id ?? ""), enabled: enabled(id) });
export const useConstruction = (id: string | null) => useQuery({ queryKey: keys.construction(id ?? ""), queryFn: () => api.bookings.construction(id ?? ""), enabled: enabled(id) });
export const useDocuments = (id: string | null) => useQuery({ queryKey: keys.documents(id ?? ""), queryFn: () => api.bookings.documents(id ?? ""), enabled: enabled(id) });
export const useBankDetails = (id: string | null) => useQuery({ queryKey: keys.bank(id ?? ""), queryFn: () => api.bookings.bankDetails(id ?? ""), enabled: enabled(id) });

export const useRequests = (f: { status?: ServiceStatus; booking_id?: string } = {}) =>
  useQuery({ queryKey: keys.requests(f), queryFn: () => api.requests.list(f) });
export const useRequest = (id: string | null) => useQuery({ queryKey: keys.request(id ?? ""), queryFn: () => api.requests.get(id ?? ""), enabled: enabled(id) });
export const useRequestCategories = () => useQuery({ queryKey: keys.requestCategories, queryFn: api.requests.categories, staleTime: DAY });

export const useNotices = () => useQuery({ queryKey: keys.notices, queryFn: () => api.notices.list() });
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => api.notifications.list() });
export const useUnreadCount = (on = true) =>
  useQuery({ queryKey: keys.unread, queryFn: api.notifications.unreadCount, enabled: on, refetchInterval: 60_000, staleTime: 15_000 });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: api.profile.get });
export const useSessions = () => useQuery({ queryKey: keys.sessions, queryFn: api.auth.sessions, staleTime: 0 });

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: PortalRequestCreate; files: LocalFile[]; idempotencyKey: string }) => {
      const created = await api.requests.create(input.body, input.idempotencyKey);
      const failed: string[] = [];
      for (const f of input.files) {
        try {
          await api.requests.uploadAttachment(created.id, f);
        } catch {
          failed.push(f.name ?? "photo");
        }
      }
      const detail = failed.length ? await api.requests.get(created.id) : created;
      return { detail, failed };
    },
    onSuccess: ({ detail }) => {
      qc.setQueryData(keys.request(detail.id), detail);
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}

export function useAddRequestMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string; files: LocalFile[] }) => {
      const attachment_ids: string[] = [];
      for (const f of input.files) {
        const row = await api.requests.uploadAttachment(id, f);
        attachment_ids.push(row.document_id);
      }
      const payload: PortalRequestMessageCreate = { body: input.body, attachment_ids };
      return api.requests.addMessage(id, payload);
    },
    onSuccess: (detail) => {
      qc.setQueryData(keys.request(id), detail);
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}

export function useReopenRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PortalRequestReopen) => api.requests.reopen(id, body),
    onSuccess: (detail) => {
      qc.setQueryData(keys.request(id), detail);
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}

export function useRateRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PortalRequestRate) => api.requests.rate(id, body),
    onSuccess: (detail) => {
      qc.setQueryData(keys.request(id), detail);
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PortalMarkRead) => api.notifications.markRead(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.unread });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PortalProfileUpdate) => api.profile.update(body),
    onSuccess: (profile) => qc.setQueryData(keys.profile, profile),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (body: PortalChangePassword) => api.auth.changePassword(body) });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sessions }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.revokeOtherSessions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sessions }),
  });
}

/** Signed PDF links are short-lived: fetched on demand, never persisted. */
export function usePdfLink() {
  return useMutation({ mutationFn: (fn: () => Promise<import("@kkt/contracts").PortalPdfLinkResponse>) => fn() });
}

/** Invalidate everything scoped to a booking (pull-to-refresh on booking screens). */
export async function refreshBooking(id: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: keys.booking(id) });
}
