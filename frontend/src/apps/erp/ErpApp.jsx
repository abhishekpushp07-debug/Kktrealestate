import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppShellLoading from "@/components/layout/AppShellLoading";
import Login from "@/pages/Login";
import { EmptyState } from "@/components/common/Bits";
import { ShieldAlert } from "lucide-react";

const AppShell = lazy(() => import("@/components/layout/AppShell"));
const PrintDocument = lazy(() => import("@/pages/PrintDocument"));

const Dashboard = lazy(() => import("@/pages/v2/Home"));
const Projects = lazy(() => import("@/pages/v2/Projects"));
const ProjectDetail = lazy(() => import("@/pages/v2/ProjectWorkspace"));
const ProjectSetup = lazy(() => import("@/pages/v2/ProjectSetup"));
const Catalogues = lazy(() => import("@/pages/v2/Catalogues"));
const BlockDetail = lazy(() => import("@/pages/BlockDetail"));
const Flats = lazy(() => import("@/pages/Flats"));
const MasterPage = lazy(() => import("@/pages/master/MasterPage"));
const Users = lazy(() => import("@/pages/Users"));
const Roles = lazy(() => import("@/pages/Roles"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));
const AccessControl = lazy(() => import("@/pages/AccessControl"));
const Settings = lazy(() => import("@/pages/Settings"));
const Definitions = lazy(() => import("@/pages/Definitions"));
const SiteSettingsPage = lazy(() => import("@/pages/cms/SiteSettings"));
const CmsCollection = lazy(() => import("@/pages/cms/CmsCollection"));
const Notices = lazy(() => import("@/pages/cms/Notices"));
const Reports = lazy(() => import("@/pages/Reports"));
const Customers = lazy(() => import("@/pages/v2/Customers"));
const CustomerDetail = lazy(() => import("@/pages/v2/Customer360"));
const CustomerForm = lazy(() => import("@/pages/v2/CustomerForm"));
const Leads = lazy(() => import("@/pages/v2/Leads"));
const Bookings = lazy(() => import("@/pages/v2/Bookings"));
const BookingWizard = lazy(() => import("@/pages/BookingWizard"));
const BookingDetail = lazy(() => import("@/pages/BookingDetail"));
const Payments = lazy(() => import("@/pages/v2/Payments"));
const Roznamcha = lazy(() => import("@/pages/Roznamcha"));
const ServiceRequests = lazy(() => import("@/pages/ServiceRequests"));

function Protected() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <AppShellLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Suspense fallback={<AppShellLoading />}><AppShell /></Suspense>;
}

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyState icon={ShieldAlert} title="Access restricted" description={`Your role lacks the ${perm} permission.`} testId="forbidden-page" />;
  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

function PrintGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Suspense fallback={<div className="min-h-screen bg-ink-950 p-6 text-sm text-warm-50/50">Loading…</div>}>{children}</Suspense>;
}

const R = [
  ["website/settings", "cms.read", SiteSettingsPage], ["website/notices", "cms.read", Notices], ["website/:coll", "cms.read", CmsCollection], ["dashboard", "project.read", Dashboard], ["projects", "project.read", Projects], ["projects/new", "project.write", ProjectSetup], ["projects/:id/setup", "project.write", ProjectSetup], ["projects/:id", "project.read", ProjectDetail], ["settings/catalogues", "master.read", Catalogues], ["blocks/:id", "project.read", BlockDetail], ["flats", "project.read", Flats],
  ["master/:kind", "master.read", MasterPage], ["users", "users.manage", Users], ["admin/access-control", "users.manage", AccessControl], ["admin/audit-logs", "audit.view", AuditLog], ["roles", "roles.manage", Roles], ["audit", "audit.view", AuditLog], ["settings", "settings.manage", Settings], ["settings/definitions", "project.read", Definitions], ["customers", "customer.read", Customers], ["customers/new", "customer.write", CustomerForm], ["customers/:id/edit", "customer.write", CustomerForm], ["customers/:id", "customer.read", CustomerDetail], ["leads", "lead.read", Leads],
  ["bookings", "booking.read", Bookings], ["bookings/new", "booking.create", BookingWizard], ["bookings/:id", "booking.read", BookingDetail], ["payments", "payment.read", Payments], ["roznamcha", "payment.read", Roznamcha], ["reports", "report.view", Reports], ["reports/:key", "report.view", Reports], ["service-requests", "service.read", ServiceRequests], ["service-requests/:id", "service.read", ServiceRequests],
];

export default function ErpApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route element={<Protected />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/master" element={<Navigate to="/master/flat-types" replace />} />
          <Route path="/site-visits" element={<Navigate to="/leads?tab=visits" replace />} />
          <Route path="/roznamcha" element={<Navigate to="/payments?tab=roznamcha" replace />} />
          {R.map(([p, perm, C]) => <Route key={p} path={`/${p}`} element={<Guard perm={perm}><C /></Guard>} />)}
        </Route>
        <Route path="/print/receipt/:id" element={<PrintGuard><PrintDocument kind="receipt" /></PrintGuard>} />
        <Route path="/print/demand/:bookingId/:demandId" element={<PrintGuard><PrintDocument kind="demand" /></PrintGuard>} />
        <Route path="/print/statement/:bookingId" element={<PrintGuard><PrintDocument kind="statement" /></PrintGuard>} />
        <Route path="/print/allotment/:bookingId" element={<PrintGuard><PrintDocument kind="allotment" /></PrintGuard>} />
        <Route path="/*" element={<Protected />}><Route path="*" element={<Navigate to="/dashboard" replace />} /></Route>
      </Routes>
    </AuthProvider>
  );
}
