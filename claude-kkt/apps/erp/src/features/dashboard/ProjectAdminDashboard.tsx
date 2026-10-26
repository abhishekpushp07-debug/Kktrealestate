import { Building2, CalendarClock, HardHat, LifeBuoy, ReceiptText } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectAdminDashboardResponse } from "@kkt/contracts";
import { Badge, StatCard } from "@/components/ui";
import { formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { STATUS_COLORS } from "./api";
import { MiniTable, ProgressRow, StatusStack, Widget } from "./widgets";

/** Project Admin: scoped progress, availability, upcoming stages and demands raised. */
export function ProjectAdminDashboard({ data }: { data: ProjectAdminDashboardResponse }) {
  return (
    <div className="space-y-4" data-testid="project-admin-dashboard">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Projects in scope"
          value={formatNumber(data.projects.length)}
          hint={`${formatNumber(data.projects.reduce((sum, project) => sum + project.available, 0))} flats available`}
          icon={Building2}
          tone="navy"
        />
        <StatCard label="Bookings this month" value={formatNumber(data.bookings_this_month)} icon={CalendarClock} />
        <StatCard
          label="Demands raised this month"
          value={formatINRShort(data.demands_raised_this_month.amount_paise)}
          hint={`${formatNumber(data.demands_raised_this_month.count)} demands`}
          icon={ReceiptText}
          tone="gold"
        />
        <StatCard label="Open tickets" value={formatNumber(data.open_tickets)} icon={LifeBuoy} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Widget title="Construction progress" icon={HardHat} to="/construction">
          {data.construction.length === 0 ? (
            <p className="text-xs text-ink-subtle">No towers under construction.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.construction.map((tower) => (
                <ProgressRow
                  key={tower.block_id}
                  label={
                    <Link to={`/blocks/${tower.block_id}?tab=construction`} className="hover:underline">
                      {tower.project_name} · {tower.block_name}
                    </Link>
                  }
                  sublabel={`${tower.current_stage ?? "Not started"}${tower.next_stage ? ` → next: ${tower.next_stage}` : ""}`}
                  percent={tower.percent}
                  tone="gold"
                />
              ))}
            </div>
          )}
        </Widget>
        <Widget title="Availability" icon={Building2} to="/flats">
          {data.projects.length === 0 ? (
            <p className="text-xs text-ink-subtle">No projects in scope.</p>
          ) : (
            <div className="space-y-3">
              {data.projects.map((project) => (
                <div key={project.project_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <Link to={`/projects/${project.project_id}`} className="truncate font-medium hover:underline">
                      {project.project_name}
                    </Link>
                    <span className="money text-xs text-ink-muted">
                      {formatNumber(project.total)} units · {Math.round(project.construction_percent)}% built
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
      </div>

      <Widget title="Upcoming stages" description="Stage completions that will raise installments" icon={CalendarClock}>
        <MiniTable
          rows={data.upcoming_stages}
          rowKey={(row, index) => `${row.block_id}-${row.stage_name}-${index}`}
          empty="No upcoming stages"
          columns={[
            {
              key: "tower",
              label: "Tower",
              cell: (row) => (
                <Link to={`/blocks/${row.block_id}?tab=construction`} className="font-medium hover:underline">
                  {row.block_name}
                </Link>
              ),
            },
            { key: "stage", label: "Next stage", cell: (row) => row.stage_name },
            {
              key: "bookings",
              label: "Active bookings",
              align: "right",
              cell: (row) => (
                <Badge variant="navy" numeric>
                  {formatNumber(row.active_bookings)}
                </Badge>
              ),
            },
            {
              key: "amount",
              label: "Installments to raise",
              align: "right",
              cell: (row) => (
                <span className="font-semibold text-navy-950">{formatINR(row.installment_total_paise)}</span>
              ),
            },
          ]}
        />
      </Widget>
    </div>
  );
}
