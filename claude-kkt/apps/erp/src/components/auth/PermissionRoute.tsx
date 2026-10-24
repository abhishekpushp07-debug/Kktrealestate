import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import type { PermissionRequirement } from "@/lib/permissions";
import { ForbiddenPage } from "@/pages/ForbiddenPage";

export interface PermissionRouteProps {
  /** One code, or several where any one grants access. Omit to allow every signed-in user. */
  permission?: PermissionRequirement;
  children: ReactNode;
}

/** Renders the Forbidden page in place (URL preserved) when the user lacks the permission. */
export function PermissionRoute({ permission, children }: PermissionRouteProps) {
  const { can } = useAuth();
  if (permission && !can(permission)) return <ForbiddenPage />;
  return <>{children}</>;
}
