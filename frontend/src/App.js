import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHostMap, resolveApp } from "@/apps/hostResolver";

const SiteApp = lazy(() => import("@/apps/site/SiteApp"));
const ErpApp = lazy(() => import("@/apps/erp/ErpApp"));
const PortalApp = lazy(() => import("@/apps/portal/PortalApp"));

const HOST_MAP = parseHostMap(process.env.REACT_APP_HOST_MAP);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Mount() {
  const loc = useLocation();
  const r = resolveApp(window.location.hostname, loc.pathname, HOST_MAP);
  useEffect(() => { document.documentElement.dataset.app = r.app; }, [r.app]);
  if (r.redirect && r.redirect !== loc.pathname) return <Navigate to={`${r.redirect}${loc.search}`} replace />;
  const fallback = <div className={`min-h-screen ${r.app === "erp" ? "bg-navy" : "bg-[#F8F6F1]"}`} />;
  return (
    <Suspense fallback={fallback}>
      {r.app === "erp" && <ErpApp hostMode={r.hostMode} />}
      {r.app === "portal" && <PortalApp base={r.base} />}
      {r.app === "site" && <SiteApp />}
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes><Route path="/*" element={<Mount />} /></Routes>
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
