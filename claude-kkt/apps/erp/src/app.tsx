import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportClientError } from "@/lib/errorReporting";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/queryRetry";
import { noteSaved } from "@/lib/unsaved";
import { createAppRouter } from "@/routes";

export const queryClient = new QueryClient({
  // A successful save opens a short grace window for the navigation that usually follows it (lib/unsaved.ts).
  mutationCache: new MutationCache({ onSuccess: () => noteSaved() }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function App() {
  // The data router is created once per app mount (not at import time, so modules importing app.tsx stay testable in Node).
  const [router] = useState(createAppRouter);
  return (
    <ErrorBoundary
      onError={(error, info) => reportClientError(error, { source: "boundary", componentStack: info.componentStack })}
    >
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster
          position="top-right"
          richColors
          closeButton
          duration={4000}
          toastOptions={{
            classNames: {
              toast: "!rounded-md !border !border-border !bg-card !text-ink !shadow-pop !font-sans !text-sm",
              title: "!font-semibold",
              description: "!text-ink-muted",
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
