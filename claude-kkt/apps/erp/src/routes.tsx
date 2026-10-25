import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { PermissionRoute } from "@/components/auth/PermissionRoute";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { NAV_ITEMS } from "@/lib/permissions";
import { ForbiddenPage } from "@/pages/ForbiddenPage";

const Placeholder = lazy(() => import("@/pages/_Placeholder"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

// Master data
const MastersLayout = lazy(() => import("@/features/masters/MastersLayout"));
const MastersIndexRedirect = lazy(() => import("@/features/masters/MastersLayout").then((module) => ({ default: module.MastersIndexRedirect })));
const MasterAliasRedirect = lazy(() => import("@/features/masters/MastersLayout").then((module) => ({ default: module.MasterAliasRedirect })));
const MasterListPage = lazy(() => import("@/features/masters/MasterListPage"));

// Inventory
const ProjectsPage = lazy(() => import("@/features/inventory/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("@/features/inventory/ProjectDetailPage"));
const BlockWizard = lazy(() => import("@/features/inventory/BlockWizard"));
const BlockDetailPage = lazy(() => import("@/features/inventory/BlockDetailPage"));
const FlatsPage = lazy(() => import("@/features/inventory/FlatsPage"));

// CRM
const CustomersPage = lazy(() => import("@/features/crm/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/features/crm/CustomerDetailPage"));
const LeadsPage = lazy(() => import("@/features/crm/LeadsPage"));
const EnquiriesInbox = lazy(() => import("@/features/crm/EnquiriesInbox"));
const SiteVisitsPage = lazy(() => import("@/features/crm/SiteVisitsPage"));

// Admin
const UsersPage = lazy(() => import("@/features/admin/UsersPage"));
const RolesPage = lazy(() => import("@/features/admin/RolesPage"));
const AuditLogPage = lazy(() => import("@/features/admin/AuditLogPage"));
const SettingsPage = lazy(() => import("@/features/admin/SettingsPage"));
const SessionsPage = lazy(() => import("@/features/admin/SessionsPage"));
const NotificationsPage = lazy(() => import("@/features/admin/NotificationsPage"));

// Dashboard
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));

// Bookings
const BookingsPage = lazy(() => import("@/features/bookings/BookingsPage"));
const BookingWizard = lazy(() => import("@/features/bookings/wizard/BookingWizard"));
const BookingDetailPage = lazy(() => import("@/features/bookings/BookingDetailPage"));

// Payments, demands, roznamcha
const PaymentsPage = lazy(() => import("@/features/payments/PaymentsPage"));
const ChequesPage = lazy(() => import("@/features/payments/ChequesPage"));
const PaymentRedirect = lazy(() => import("@/features/payments/PaymentRedirect"));
const DemandsPage = lazy(() => import("@/features/payments/DemandsPage"));
const RoznamchaPage = lazy(() => import("@/features/payments/RoznamchaPage"));
const ReceiptPrintPage = lazy(() => import("@/features/payments/ReceiptPrintPage"));
const DemandLetterPrint = lazy(() => import("@/features/payments/DemandLetterPrint"));

/** Nav items whose real screen has landed; everything else still renders the placeholder. */
const PAGES_BY_NAV_ID: Readonly<Record<string, LazyExoticComponent<ComponentType>>> = {
  dashboard: DashboardPage,
  flats: FlatsPage,
  leads: LeadsPage,
  visits: SiteVisitsPage,
  enquiries: EnquiriesInbox,
  demands: DemandsPage,
  roznamcha: RoznamchaPage,
  users: UsersPage,
  roles: RolesPage,
  audit: AuditLogPage,
  settings: SettingsPage,
};

/** Every nav item gets a (lazy) route; extra account routes and error pages live inside the shell. */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute allowForcedPasswordChange>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />
      {/* Print routes: authenticated, but outside the shell (letterhead layouts, A4 print CSS). */}
      <Route
        path="/print/receipt/:id"
        element={
          <ProtectedRoute>
            <PermissionRoute permission={["receipt.print", "payment.read"]}>
              <ReceiptPrintPage />
            </PermissionRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/print/demand/:bookingId/:demandId"
        element={
          <ProtectedRoute>
            <PermissionRoute permission={["payment.read", "booking.read"]}>
              <DemandLetterPrint />
            </PermissionRoute>
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {NAV_ITEMS.map((item) => {
          if (item.id === "masters") {
            return (
              <Route
                key={item.id}
                path={item.to}
                element={
                  <PermissionRoute permission={item.permission}>
                    <MastersLayout />
                  </PermissionRoute>
                }
              >
                <Route index element={<MastersIndexRedirect />} />
                <Route path=":slug" element={<MasterListPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            );
          }
          if (item.id === "projects") {
            return (
              <Route
                key={item.id}
                path={item.to}
                element={
                  <PermissionRoute permission={item.permission}>
                    <Outlet />
                  </PermissionRoute>
                }
              >
                <Route index element={<ProjectsPage />} />
                <Route path=":id" element={<ProjectDetailPage />} />
                <Route path=":id/blocks/new" element={<BlockWizard />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            );
          }
          if (item.id === "customers") {
            return (
              <Route
                key={item.id}
                path={item.to}
                element={
                  <PermissionRoute permission={item.permission}>
                    <Outlet />
                  </PermissionRoute>
                }
              >
                <Route index element={<CustomersPage />} />
                <Route path=":id" element={<CustomerDetailPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            );
          }
          if (item.id === "bookings") {
            return (
              <Route
                key={item.id}
                path={item.to}
                element={
                  <PermissionRoute permission={item.permission}>
                    <Outlet />
                  </PermissionRoute>
                }
              >
                <Route index element={<BookingsPage />} />
                <Route
                  path="new"
                  element={
                    <PermissionRoute permission="booking.create">
                      <BookingWizard />
                    </PermissionRoute>
                  }
                />
                <Route path=":id" element={<BookingDetailPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            );
          }
          if (item.id === "payments") {
            return (
              <Route
                key={item.id}
                path={item.to}
                element={
                  <PermissionRoute permission={item.permission}>
                    <Outlet />
                  </PermissionRoute>
                }
              >
                <Route index element={<PaymentsPage />} />
                <Route path="cheques" element={<ChequesPage />} />
                <Route path=":id" element={<PaymentRedirect />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            );
          }
          const Page = PAGES_BY_NAV_ID[item.id];
          return (
            <Route
              key={item.id}
              path={item.exact ? item.to : `${item.to}/*`}
              element={<PermissionRoute permission={item.permission}>{Page ? <Page /> : <Placeholder title={item.label} />}</PermissionRoute>}
            />
          );
        })}

        {/* Inventory & CRM routes outside the nav tree. */}
        <Route
          path="/blocks/:id"
          element={
            <PermissionRoute permission="project.read">
              <BlockDetailPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/enquiries"
          element={
            <PermissionRoute permission={["lead.read", "cms.read"]}>
              <EnquiriesInbox />
            </PermissionRoute>
          }
        />

        {/* Short aliases from the module briefs → canonical nav paths. */}
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/master" element={<Navigate to="/masters" replace />} />
        <Route path="/master/:kind" element={<MasterAliasRedirect />} />
        <Route path="/users" element={<Navigate to="/admin/users" replace />} />
        <Route path="/roles" element={<Navigate to="/admin/roles" replace />} />
        <Route path="/audit" element={<Navigate to="/admin/audit-log" replace />} />
        <Route path="/settings" element={<Navigate to="/admin/settings" replace />} />

        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
