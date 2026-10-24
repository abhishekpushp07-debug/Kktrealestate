import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { PermissionRoute } from "@/components/auth/PermissionRoute";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { NAV_ITEMS } from "@/lib/permissions";
import { ForbiddenPage } from "@/pages/ForbiddenPage";

const Placeholder = lazy(() => import("@/pages/_Placeholder"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

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
        {NAV_ITEMS.map((item) => (
          <Route
            key={item.id}
            path={item.exact ? item.to : `${item.to}/*`}
            element={
              <PermissionRoute permission={item.permission}>
                <Placeholder title={item.label} />
              </PermissionRoute>
            }
          />
        ))}
        <Route path="/sessions" element={<Placeholder title="Devices & sessions" description="Every signed-in device for your account, with revoke." />} />
        <Route path="/notifications" element={<Placeholder title="Notifications" description="Everything that needs your attention, newest first." />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
