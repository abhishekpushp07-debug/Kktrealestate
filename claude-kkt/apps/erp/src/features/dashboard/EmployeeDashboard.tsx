import { Building2, Megaphone } from "lucide-react";
import { Link } from "react-router-dom";
import type { EmployeeDashboardResponse } from "@kkt/contracts";
import { StatCard } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { STATUS_COLORS } from "./api";
import { MiniTable, StatusStack, Widget } from "./widgets";

/** Employee: read-only inventory snapshot plus company notices. */
export function EmployeeDashboard({ data }: { data: EmployeeDashboardResponse }) {
  const totals = data.projects.reduce(
    (sum, project) => ({
      available: sum.available + project.available,
      total: sum.total + project.total,
      sold: sum.sold + project.sold,
    }),
    { available: 0, total: 0, sold: 0 },
  );
  return (
    <div className="space-y-4" data-testid="employee-dashboard">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Projects" value={formatNumber(data.projects.length)} icon={Building2} tone="navy" />
        <StatCard
          label="Flats available"
          value={formatNumber(totals.available)}
          hint={`of ${formatNumber(totals.total)} units`}
        />
        <StatCard label="Sold" value={formatNumber(totals.sold)} tone="gold" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Widget title="Inventory snapshot" icon={Building2} className="xl:col-span-2">
          {data.projects.length === 0 ? (
            <p className="text-xs text-ink-subtle">No projects to show.</p>
          ) : (
            <div className="space-y-3">
              {data.projects.map((project) => (
                <div key={project.project_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{project.project_name}</span>
                    <span className="money text-xs text-ink-muted">
                      {formatNumber(project.available)} available · {Math.round(project.construction_percent)}% built
                    </span>
                  </div>
                  <StatusStack
                    counts={[
                      { key: "available", label: "Avail.", value: project.available },
                      { key: "hold", label: "Hold", value: project.hold },
                      { key: "booked", label: "Booked", value: project.booked },
                      { key: "sold", label: "Sold", value: project.sold },
                      { key: "blocked", label: "Blocked", value: project.blocked },
                    ]}
                    colors={STATUS_COLORS}
                  />
                </div>
              ))}
            </div>
          )}
        </Widget>
        <Widget title="Notices" icon={Megaphone}>
          <MiniTable
            rows={data.notices}
            rowKey={(row) => row.id}
            empty="No notices"
            columns={[
              {
                key: "title",
                label: "Notice",
                cell: (row) => (
                  <Link to="/website/notices" className="font-medium hover:underline">
                    {row.title}
                  </Link>
                ),
              },
              {
                key: "at",
                label: "Published",
                cell: (row) => <span className="money text-xs text-ink-muted">{formatDateTime(row.publish_at)}</span>,
              },
            ]}
          />
        </Widget>
      </div>
    </div>
  );
}
