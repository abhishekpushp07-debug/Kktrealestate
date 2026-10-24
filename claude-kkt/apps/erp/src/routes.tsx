import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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

// Admin
const UsersPage = lazy(() => import("@/features/admin/UsersPage"));
const RolesPage = lazy(() => import("@/features/admin/RolesPage"));
const AuditLogPage = lazy(() => import("@/features/admin/AuditLogPage"));
const SettingsPage = lazy(() => import("@/features/admin/SettingsPage"));
const SessionsPage = lazy(() => import("@/features/admin/SessionsPage"));
const NotificationsPage = lazy(() => import("@/features/admin/NotificationsPage"));

/** Nav items whose real screen has landed; everything else still renders the placeholder. */
const PAGES_BY_NAV_ID: Readonly<Record<string, LazyExoticComponent<ComponentType>>> = {
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
          const Page = PAGES_BY_NAV_ID[item.id];
          return (
            <Route
              key={item.id}
              path={item.exact ? item.to : `${item.to}/*`}
              element={<PermissionRoute permission={item.permission}>{Page ? <Page /> : <Placeholder title={item.label} />}</PermissionRoute>}
            />
          );
        })}

        {/* Short aliases from the module briefs → canonical nav paths. */}
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
