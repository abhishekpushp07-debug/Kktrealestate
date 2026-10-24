import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppShell from "@/components/layout/AppShell";
import Login from "@/pages/Login";
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const BlockDetail = lazy(() => import("@/pages/BlockDetail"));
const Flats = lazy(() => import("@/pages/Flats"));
const MasterPage = lazy(() => import("@/pages/master/MasterPage"));
const Users = lazy(() => import("@/pages/Users"));
const Roles = lazy(() => import("@/pages/Roles"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));
const Settings = lazy(() => import("@/pages/Settings"));
import { lazy, Suspense } from "react";
const SiteSettingsPage = lazy(() => import("@/pages/cms/SiteSettings"));
const CmsCollection = lazy(() => import("@/pages/cms/CmsCollection"));
const SiteApp = lazy(() => import("@/site/SiteApp"));
const Reports = lazy(() => import("@/pages/Reports"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const Leads = lazy(() => import("@/pages/Leads"));
const Bookings = lazy(() => import("@/pages/Bookings"));
const BookingWizard = lazy(() => import("@/pages/BookingWizard"));
const BookingDetail = lazy(() => import("@/pages/BookingDetail"));
const Payments = lazy(() => import("@/pages/Payments"));
const Roznamcha = lazy(() => import("@/pages/Roznamcha"));
import { ReceiptPrint, DemandLetterPrint } from "@/pages/PrintViews";
import { EmptyState } from "@/components/common/Bits";
import { ShieldAlert } from "lucide-react";

function Protected() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-navy"><div className="h-10 w-10 animate-spin rounded-full border-4 border-gold border-t-transparent" /></div>;
  if (!user) return <Navigate to="/erp/login" replace state={{ from: loc.pathname }} />;
  return <AppShell />;
}

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyState icon={ShieldAlert} title="Access restricted" description={`Your role lacks the ${perm} permission.`} testId="forbidden-page" />;
  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/erp/dashboard" replace /> : children;
}

function LegacyRedirect() {
  const loc = useLocation();
  return <Navigate to={`/erp${loc.pathname === "/dashboard" ? "" : loc.pathname}${loc.search}`} replace />;
}

function PrintGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/erp/login" replace />;
  return <div className="min-h-screen bg-white"><Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>{children}</Suspense></div>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/erp/login" element={<PublicOnly><Login /></PublicOnly>} />
          {["login", "dashboard", "blocks/:id", "flats", "master", "master/:kind", "users", "roles", "audit", "settings", "customers", "customers/:id", "leads", "bookings", "bookings/new", "bookings/:id", "payments", "roznamcha"].map((p) => <Route key={p} path={`/${p}`} element={<LegacyRedirect />} />)}
          <Route element={<Protected />}>
            <Route path="/erp" element={<Navigate to="/erp/dashboard" replace />} />
            <Route path="/erp/website/settings" element={<Guard perm="cms.read"><SiteSettingsPage /></Guard>} />
            <Route path="/erp/website/:coll" element={<Guard perm="cms.read"><CmsCollection /></Guard>} />
            <Route path="/erp/dashboard" element={<Guard perm="project.read"><Dashboard /></Guard>} />
            <Route path="/erp/projects" element={<Guard perm="project.read"><Projects /></Guard>} />
            <Route path="/erp/projects/:id" element={<Guard perm="project.read"><ProjectDetail /></Guard>} />
            <Route path="/erp/blocks/:id" element={<Guard perm="project.read"><BlockDetail /></Guard>} />
            <Route path="/erp/flats" element={<Guard perm="project.read"><Flats /></Guard>} />
            <Route path="/erp/master" element={<Navigate to="/erp/master/flat-types" replace />} />
            <Route path="/erp/master/:kind" element={<Guard perm="master.read"><MasterPage /></Guard>} />
            <Route path="/erp/users" element={<Guard perm="users.manage"><Users /></Guard>} />
            <Route path="/erp/roles" element={<Guard perm="roles.manage"><Roles /></Guard>} />
            <Route path="/erp/audit" element={<Guard perm="audit.view"><AuditLog /></Guard>} />
            <Route path="/erp/settings" element={<Guard perm="settings.manage"><Settings /></Guard>} />
            <Route path="/erp/customers" element={<Guard perm="customer.read"><Customers /></Guard>} />
            <Route path="/erp/customers/:id" element={<Guard perm="customer.read"><CustomerDetail /></Guard>} />
            <Route path="/erp/leads" element={<Guard perm="lead.read"><Leads /></Guard>} />
            <Route path="/erp/bookings" element={<Guard perm="booking.read"><Bookings /></Guard>} />
            <Route path="/erp/bookings/new" element={<Guard perm="booking.create"><BookingWizard /></Guard>} />
            <Route path="/erp/bookings/:id" element={<Guard perm="booking.read"><BookingDetail /></Guard>} />
            <Route path="/erp/payments" element={<Guard perm="payment.read"><Payments /></Guard>} />
            <Route path="/erp/roznamcha" element={<Guard perm="payment.read"><Roznamcha /></Guard>} />
            <Route path="/erp/reports" element={<Guard perm="report.view"><Reports /></Guard>} />
            <Route path="/erp/reports/:key" element={<Guard perm="report.view"><Reports /></Guard>} />
          </Route>
          <Route path="/erp/print/receipt/:id" element={<PrintGuard><ReceiptPrint /></PrintGuard>} />
          <Route path="/erp/print/demand/:bookingId/:demandId" element={<PrintGuard><DemandLetterPrint /></PrintGuard>} />
          <Route path="/erp/*" element={<Protected />}><Route path="*" element={<Navigate to="/erp/dashboard" replace />} /></Route>
          <Route path="/*" element={<Suspense fallback={<div className="min-h-screen bg-[#F8F6F1]" />}><SiteApp /></Suspense>} />
        </Routes>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </BrowserRouter>
    </QueryClientProvider>
  );
}
