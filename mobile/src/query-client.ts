// One QueryClient for the whole app. Refetches when the app returns to the
// foreground; does not retry 4xx (auth/404) errors.
import { AppState, Platform } from "react-native";
import { focusManager, QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/src/api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
}
