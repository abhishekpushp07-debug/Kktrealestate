import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
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
const DocumentsPage = lazy(() => import("@/pages/v2/Documents"));
const DemandsPage = lazy(() => import("@/pages/v2/Demands"));
const MessagingPage = lazy(() => import("@/pages/v2/Messaging"));
const TemplatesMaster = lazy(() => import("@/pages/masters/Templates"));
const Flats = lazy(() => import("@/pages/Flats"));
const MasterPage = lazy(() => import("@/pages/master/MasterPage"));
const MastersHub = lazy(() => import("@/pages/masters/MastersHub"));
const TowersMaster = lazy(() => import("@/pages/masters/Towers"));
const FlatsMaster = lazy(() => import("@/pages/masters/Flats"));
const ProjectsMaster = lazy(() => import("@/pages/masters/ProjectsMaster"));
const CompanyMaster = lazy(() => import("@/pages/masters/Company"));
const StagePlans = lazy(() => import("@/pages/masters/StagePlans"));
const PaymentPlans = lazy(() => import("@/pages/masters/PaymentPlans"));
const ConstructionUpdate = lazy(() => import("@/pages/ConstructionUpdate"));
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
const Exports = lazy(() => import("@/pages/Exports"));
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
  ["website/settings", "website.cms.edit", SiteSettingsPage], ["website/notices", "website.cms.view", Notices], ["website/:coll", "website.cms.view", CmsCollection], ["dashboard", "masters.project.view", Dashboard], ["projects", "masters.project.view", Projects], ["projects/new", "masters.project.create", ProjectSetup], ["projects/:id/setup", "masters.project.edit", ProjectSetup], ["projects/:id", "masters.project.view", ProjectDetail], ["settings/catalogues", "masters.catalogue.view", Catalogues], ["blocks/:id", "masters.project.view", BlockDetail], ["flats", "masters.project.view", Flats],
["users", "admin.user.view", Users], ["admin/access-control", "admin.access_control.manage", AccessControl], ["admin/audit-logs", "admin.audit.view", AuditLog], ["roles", "admin.role.view", Roles], ["audit", "admin.audit.view", AuditLog], ["settings", "admin.settings.view", Settings], ["settings/definitions", "masters.project.view", Definitions], ["customers", "sales.customer.view", Customers], ["customers/new", "sales.customer.create", CustomerForm], ["customers/:id/edit", "sales.customer.edit", CustomerForm], ["customers/:id", "sales.customer.view", CustomerDetail], ["leads", "sales.lead.view", Leads],
  ["bookings", "sales.booking.view", Bookings], ["bookings/new", "sales.booking.create", BookingWizard], ["bookings/:id", "sales.booking.view", BookingDetail], ["payments", "finance.payment.view", Payments], ["documents", "documents.document.view", DocumentsPage], ["demands", "demands.register.view", DemandsPage], ["messaging", "messaging.message.view", MessagingPage], ["roznamcha", "finance.roznamcha.view", Roznamcha], ["reports/exports", "reports.*", Exports], ["reports", "reports.*", Reports], ["reports/:key", "reports.*", Reports], ["service-requests", "service.ticket.view", ServiceRequests], ["service-requests/:id", "service.ticket.view", ServiceRequests],
];

function MasterKindRedirect() { const { kind } = useParams(); return <Navigate to={`/masters/m/${kind}`} replace />; }

export default function ErpApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route element={<Protected />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/master" element={<Navigate to="/masters" replace />} />
          <Route path="/master/:kind" element={<MasterKindRedirect />} />
          <Route path="/construction" element={<Guard perm="construction.update.view"><ConstructionUpdate /></Guard>} />
          <Route path="/masters" element={<Guard perm="masters.*"><MastersHub /></Guard>}>
            <Route path="m/:kind" element={<MasterPage />} />
            <Route path="stage-plans" element={<Guard perm="masters.stage_plan.view"><StagePlans /></Guard>} />
            <Route path="towers" element={<Guard perm="masters.tower.view"><TowersMaster /></Guard>} />
            <Route path="flats" element={<Guard perm="masters.flat.view"><FlatsMaster /></Guard>} />
            <Route path="projects" element={<Guard perm="masters.project.view"><ProjectsMaster /></Guard>} />
            <Route path="company" element={<Guard perm="masters.company.view"><CompanyMaster /></Guard>} />
            <Route path="templates" element={<Guard perm="masters.template.view"><TemplatesMaster /></Guard>} />
            <Route path="payment-plans" element={<Guard perm="masters.payment_plan.view"><PaymentPlans /></Guard>} />
            <Route path="rate-cards" element={<Navigate to="/projects" replace />} />
          </Route>
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
