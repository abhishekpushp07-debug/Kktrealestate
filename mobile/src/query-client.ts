// One QueryClient for the whole app. Refetches when the app returns to the
// foreground; does not retry 4xx (auth/404) errors. The cache is persisted to
// AsyncStorage (localStorage on web) so the app opens instantly with the last
// data while it refetches in the background.
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { focusManager, QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

import { ApiError } from "@/src/api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 24 * 60 * 60_000, // keep long enough to be worth persisting
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "kkt_portal_cache", throttleTime: 1500 });

// Never persist local file/blob URIs (attachments) — they don't survive a reload.
const NOT_PERSISTED = new Set(["p-att", "p-cats"]);

export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60_000,
  buster: "portal-v2",
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { queryKey: readonly unknown[]; state: { status: string } }) => q.state.status === "success" && !NOT_PERSISTED.has(String(q.queryKey[0])),
  },
};

export async function clearPersistedCache() {
  try {
    await persister.removeClient();
  } catch {
    /* ignore */
  }
}

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
}
