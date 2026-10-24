import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppShell from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import { ReceiptPrint, DemandLetterPrint } from "@/pages/PrintViews";
import { EmptyState } from "@/components/common/Bits";
import { ShieldAlert } from "lucide-react";

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
const SiteSettingsPage = lazy(() => import("@/pages/cms/SiteSettings"));
const CmsCollection = lazy(() => import("@/pages/cms/CmsCollection"));
const Notices = lazy(() => import("@/pages/cms/Notices"));
const Reports = lazy(() => import("@/pages/Reports"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const Leads = lazy(() => import("@/pages/Leads"));
const Bookings = lazy(() => import("@/pages/Bookings"));
const BookingWizard = lazy(() => import("@/pages/BookingWizard"));
const BookingDetail = lazy(() => import("@/pages/BookingDetail"));
const Payments = lazy(() => import("@/pages/Payments"));
const Roznamcha = lazy(() => import("@/pages/Roznamcha"));
const ServiceRequests = lazy(() => import("@/pages/ServiceRequests"));

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

const R = [
  ["website/settings", "cms.read", SiteSettingsPage], ["website/notices", "cms.read", Notices], ["website/:coll", "cms.read", CmsCollection], ["dashboard", "project.read", Dashboard], ["projects", "project.read", Projects], ["projects/:id", "project.read", ProjectDetail], ["blocks/:id", "project.read", BlockDetail], ["flats", "project.read", Flats],
  ["master/:kind", "master.read", MasterPage], ["users", "users.manage", Users], ["roles", "roles.manage", Roles], ["audit", "audit.view", AuditLog], ["settings", "settings.manage", Settings], ["customers", "customer.read", Customers], ["customers/:id", "customer.read", CustomerDetail], ["leads", "lead.read", Leads],
  ["bookings", "booking.read", Bookings], ["bookings/new", "booking.create", BookingWizard], ["bookings/:id", "booking.read", BookingDetail], ["payments", "payment.read", Payments], ["roznamcha", "payment.read", Roznamcha], ["reports", "report.view", Reports], ["reports/:key", "report.view", Reports], ["service-requests", "service.read", ServiceRequests], ["service-requests/:id", "service.read", ServiceRequests],
];

export default function ErpApp({ hostMode }) {
  const loc = useLocation();
  // Host mode (erp.example.com): canonical internal paths stay /erp/*; bare paths are prefixed transparently.
  if (hostMode && !loc.pathname.startsWith("/erp")) return <Navigate to={`/erp${loc.pathname === "/" ? "" : loc.pathname}${loc.search}`} replace />;
  return (
    <AuthProvider>
      <Routes>
        <Route path="/erp/login" element={<PublicOnly><Login /></PublicOnly>} />
        {["login", "dashboard", "blocks/:id", "flats", "master", "master/:kind", "users", "roles", "audit", "settings", "customers", "customers/:id", "leads", "bookings", "bookings/new", "bookings/:id", "payments", "roznamcha"].map((p) => <Route key={p} path={`/${p}`} element={<LegacyRedirect />} />)}
        <Route element={<Protected />}>
          <Route path="/erp" element={<Navigate to="/erp/dashboard" replace />} />
          <Route path="/erp/master" element={<Navigate to="/erp/master/flat-types" replace />} />
          {R.map(([p, perm, C]) => <Route key={p} path={`/erp/${p}`} element={<Guard perm={perm}><C /></Guard>} />)}
        </Route>
        <Route path="/erp/print/receipt/:id" element={<PrintGuard><ReceiptPrint /></PrintGuard>} />
        <Route path="/erp/print/demand/:bookingId/:demandId" element={<PrintGuard><DemandLetterPrint /></PrintGuard>} />
        <Route path="/erp/*" element={<Protected />}><Route path="*" element={<Navigate to="/erp/dashboard" replace />} /></Route>
        <Route path="/*" element={<LegacyRedirect />} />
      </Routes>
    </AuthProvider>
  );
}
