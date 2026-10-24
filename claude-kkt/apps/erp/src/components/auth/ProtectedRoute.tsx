import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { FullPageLoader } from "@/components/layout/FullPageLoader";

export interface ProtectedRouteProps {
  children?: ReactNode;
  /** Allow this route while a password change is still pending (the change-password page itself). */
  allowForcedPasswordChange?: boolean;
}

/** Requires a signed-in staff user; redirects to /login (remembering where the user was going). */
export function ProtectedRoute({ children, allowForcedPasswordChange = false }: ProtectedRouteProps) {
  const { status, mustChangePassword } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  if (mustChangePassword && !allowForcedPasswordChange) {
    return <Navigate to="/change-password" replace state={{ forced: true, from: `${location.pathname}${location.search}` }} />;
  }
  return children ? <>{children}</> : <Outlet />;
}

/** Login page guard: sends signed-in users to where they came from. */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const state = location.state as { from?: string } | null;
  if (status === "loading") return <FullPageLoader />;
  if (status === "authenticated") return <Navigate to={state?.from && state.from !== "/login" ? state.from : "/"} replace />;
  return <>{children}</>;
}
