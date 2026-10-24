import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FullPageLoader } from "@/components/layout/FullPageLoader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VersionConflictHost } from "@/components/ui/version-conflict-dialog";
import { isApiClientError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { AppRoutes } from "@/routes";

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  // Never retry client errors (4xx): they will not succeed on a second attempt.
  if (isApiClientError(error) && error.status >= 400 && error.status < 500) return false;
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider delayDuration={300} skipDelayDuration={200}>
              <Suspense fallback={<FullPageLoader />}>
                <AppRoutes />
              </Suspense>
            </TooltipProvider>
            <VersionConflictHost />
          </AuthProvider>
        </BrowserRouter>
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
