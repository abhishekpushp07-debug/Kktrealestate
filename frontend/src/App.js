import { lazy, Suspense } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE_PATH } from "@/lib/api";

const ErpApp = lazy(() => import("@/apps/erp/ErpApp"));
const PortalRedirect = lazy(() => import("@/apps/erp/PortalRedirect"));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
// /portal* on the ERP origin redirects to the Expo customer portal (Site Settings → portal_url).
const isPortal = /^\/portal(\/|$)/.test(window.location.pathname);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={isPortal ? "/" : BASE_PATH || "/"}>
        <Suspense fallback={<div className={`min-h-screen ${isPortal ? "bg-[#F8F6F1]" : "bg-navy"}`} />}>
          {isPortal ? <PortalRedirect /> : <ErpApp />}
        </Suspense>
        <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 4500 }} containerAriaLabel="Notifications" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
