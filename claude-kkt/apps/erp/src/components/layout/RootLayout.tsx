import { Suspense, useEffect } from "react";
import { Outlet, useRouteError } from "react-router-dom";
import { NavigationGuardHost } from "@/components/NavigationGuard";
import { FullPageLoader } from "@/components/layout/FullPageLoader";
import { ErrorState } from "@/components/ui/error-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VersionConflictHost } from "@/components/ui/version-conflict-dialog";
import { AuthProvider } from "@/lib/auth";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";
import { reportClientError } from "@/lib/errorReporting";

/** Pathless root route of the data router: session, tooltips, the version-conflict prompt and the unsaved-changes guard. */
export function RootLayout() {
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={300} skipDelayDuration={200}>
        <Suspense fallback={<FullPageLoader />}>
          <Outlet />
        </Suspense>
      </TooltipProvider>
      <VersionConflictHost />
      <NavigationGuardHost />
    </AuthProvider>
  );
}

/**
 * errorElement of the root route: errors no page boundary caught (a lazy chunk that failed after a deploy, a guard that
 * threw). A chunk failure reloads once; anything else is reported (POST /client-errors) and shown with a reload button.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    if (chunk && reloadOnceForChunkError()) return;
    reportClientError(error, { source: "route" });
  }, [error, chunk]);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface p-4">
      <ErrorState
        title={chunk ? "A new version of the ERP is available" : "Something went wrong"}
        description={
          chunk
            ? "This page was updated while you had it open. Reload to continue."
            : "The error has been reported. Reload the page to continue."
        }
        error={error}
        onRetry={() => window.location.reload()}
        className="max-w-lg rounded-lg border border-border bg-card"
      />
    </div>
  );
}
