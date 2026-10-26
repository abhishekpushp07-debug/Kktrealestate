import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { DASHBOARD_ROLE_LABELS, type DashboardResponse } from "@kkt/contracts";
import { Badge, Button, ErrorState, PageHeader, Select, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatRelative, istHour } from "@/lib/format";
import { useProjectOptions } from "@/features/shared/options";
import { AccountsDashboard } from "./AccountsDashboard";
import { EmployeeDashboard } from "./EmployeeDashboard";
import { OwnerDashboard } from "./OwnerDashboard";
import { ProjectAdminDashboard } from "./ProjectAdminDashboard";
import { SalesDashboard } from "./SalesDashboard";
import { useDashboard } from "./api";

function RoleDashboard({ response }: { response: DashboardResponse }) {
  switch (response.role) {
    case "OWNER":
      return <OwnerDashboard data={response.data} />;
    case "ACCOUNTS":
      return <AccountsDashboard data={response.data} />;
    case "SALES":
      return <SalesDashboard data={response.data} />;
    case "PROJECT_ADMIN":
      return <ProjectAdminDashboard data={response.data} />;
    case "EMPLOYEE":
      return <EmployeeDashboard data={response.data} />;
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-lg xl:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 rounded-lg xl:col-span-2" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

/** `/` — the role-specific dashboard from `GET /dashboard`, with an optional project scope for owners / admins. */
export default function DashboardPage() {
  const { user, scope } = useAuth();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project_id");
  const dashboard = useDashboard(projectId);
  const projects = useProjectOptions(scope.allProjects || scope.projectIds.length > 1);
  const firstName = user?.name.split(/\s+/)[0] ?? "";
  const hour = istHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const showProjectFilter = (projects.data?.length ?? 0) > 1 && dashboard.data?.role !== "SALES";

  return (
    <>
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        description={dashboard.data ? `${DASHBOARD_ROLE_LABELS[dashboard.data.role]} dashboard${dashboard.dataUpdatedAt ? ` · updated ${formatRelative(new Date(dashboard.dataUpdatedAt))}` : ""}` : "Loading your dashboard…"}
        titleAddon={user?.role.name ? <Badge variant="gold">{user.role.name}</Badge> : undefined}
        actions={
          <>
            {showProjectFilter && (
              <Select
                aria-label="Project"
                size="sm"
                className="w-full sm:w-52"
                value={projectId}
                onValueChange={(value) =>
                  setParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      if (value) next.set("project_id", value);
                      else next.delete("project_id");
                      return next;
                    },
                    { replace: true },
                  )
                }
                options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))}
                placeholder="All projects"
                allowClear
                data-testid="dashboard-project"
              />
            )}
            <Button variant="outline" size="sm" leftIcon={RefreshCw} loading={dashboard.isFetching && !dashboard.isPending} onClick={() => void dashboard.refetch()} data-testid="dashboard-refresh">
              Refresh
            </Button>
          </>
        }
      />
      {dashboard.isPending && <DashboardSkeleton />}
      {dashboard.isError && <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} className="rounded-lg border border-border bg-card" />}
      {dashboard.data && <RoleDashboard response={dashboard.data} />}
    </>
  );
}
