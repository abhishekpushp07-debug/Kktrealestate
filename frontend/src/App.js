import { lazy, Suspense } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { lastError } from "@/lib/api";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE_PATH } from "@/lib/api";

// Every error toast carries the correlating request id (matches the backend JSON log line) in its "details".
const _toastError = toast.error.bind(toast);
toast.error = (msg, opts = {}) => {
  const fresh = lastError.request_id && Date.now() - lastError.at < 5000;
  return _toastError(msg, fresh && !opts.description ? { ...opts, description: `Request ID ${lastError.request_id}` } : opts);
};

const ErpApp = lazy(() => import("@/apps/erp/ErpApp"));
const PortalRedirect = lazy(() => import("@/apps/erp/PortalRedirect"));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30000, gcTime: 300000 } } });
// /portal* on the ERP origin redirects to the Expo customer portal (Site Settings → portal_url).
const isPortal = /^\/portal(\/|$)/.test(window.location.pathname);
// Phase C: the ERP lives at the root. Old /erp bookmarks redirect permanently to the same path without the prefix.
if (!BASE_PATH && /^\/erp(\/|$)/.test(window.location.pathname)) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${pathname.replace(/^\/erp/, "") || "/"}${search}${hash}`);
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={isPortal ? "/" : BASE_PATH || "/"}>
        <Suspense fallback={<div className={`min-h-screen ${isPortal ? "bg-[#F8F6F1]" : "bg-navy"}`} />}>
          {isPortal ? <PortalRedirect /> : <ErpApp />}
        </Suspense>
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 6000 }} containerAriaLabel="Notifications" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
