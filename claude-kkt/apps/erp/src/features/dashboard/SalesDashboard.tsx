import { CalendarCheck2, CheckCircle2, ClipboardList, Download, Filter, Inbox, PhoneCall, UserX } from "lucide-react";
import { lazy } from "react";
import { Link } from "react-router-dom";
import { LEAD_STAGE_LABELS, type SalesDashboardResponse } from "@kkt/contracts";
import { Badge, Button, StatCard, StatusChip } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatINRShort, formatNumber, formatPhone } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { formatSlotTime, VISITS_PATH, crmKeys, whatsappLink } from "@/features/crm/api";
import { STATUS_COLORS } from "./api";
import { MiniTable, StatusStack, Widget } from "./widgets";

const PipelineFunnel = lazy(() => import("./charts").then((module) => ({ default: module.PipelineFunnel })));

type VisitRow = SalesDashboardResponse["todays_visits"][number];

/** Sales: pipeline funnel, follow-ups due, enquiries, brochure leads, today's visits with outcomes, availability, my bookings. */
export function SalesDashboard({ data }: { data: SalesDashboardResponse }) {
  const { can } = useAuth();
  const canWriteVisits = can("visit.write");
  const outcome = useMutationWithToast<unknown, { visit: VisitRow; kind: "complete" | "no-show" }>({
    mutationFn: ({ visit, kind }) => api.post(`${VISITS_PATH}/${visit.visit_id}/${kind}`, { version: visit.version }, { version: visit.version }),
    successMessage: (_result, { kind }) => (kind === "complete" ? "Marked completed — lead moves to Site Visit Done" : "Marked no-show"),
    invalidate: [["/dashboard"], [VISITS_PATH], crmKeys.today, ["/leads"]],
    entityLabel: "This visit",
  });
  const openVisits = data.todays_visits.filter((visit) => visit.status === "CONFIRMED" || visit.status === "RESCHEDULED");
  const totalLeads = data.pipeline.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-4" data-testid="sales-dashboard">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Follow-ups due" value={formatNumber(data.follow_ups_due.length)} hint="Today or overdue" icon={PhoneCall} tone={data.follow_ups_due.length > 0 ? "gold" : "default"} />
        <StatCard label="New enquiries" value={formatNumber(data.new_enquiries)} hint={`${formatNumber(data.brochure_leads_this_week)} brochure leads this week`} icon={Inbox} />
        <StatCard label="Today's site visits" value={formatNumber(data.todays_visits.length)} hint={`${formatNumber(openVisits.length)} awaiting outcome`} icon={CalendarCheck2} />
        <StatCard label="My bookings this month" value={formatNumber(data.my_bookings.this_month)} hint={`${formatINRShort(data.my_bookings.value_paise)} · ${formatNumber(data.my_bookings.total)} total`} icon={ClipboardList} tone="navy" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Widget title="Pipeline" description={`${formatNumber(totalLeads)} open leads by stage`} icon={Filter} to="/leads" table={<MiniTable rows={data.pipeline} rowKey={(row) => row.stage} dense columns={[{ key: "stage", label: "Stage", cell: (row) => LEAD_STAGE_LABELS[row.stage] }, { key: "count", label: "Leads", align: "right", cell: (row) => formatNumber(row.count) }]} />}>
          <PipelineFunnel rows={data.pipeline} />
        </Widget>
        <Widget title="Follow-ups due" icon={PhoneCall} to="/leads" className="xl:col-span-2">
          <MiniTable
            rows={data.follow_ups_due}
            rowKey={(row) => row.lead_id}
            empty="No follow-ups due — nice"
            columns={[
              { key: "lead", label: "Lead", cell: (row) => <span className="block leading-tight"><Link to={`/leads/${row.lead_id}`} className="block font-medium text-navy-800 hover:underline">{row.full_name}</Link><span className="money block text-2xs text-ink-subtle">{row.lead_number}{row.project_name ? ` · ${row.project_name}` : ""}</span></span> },
              { key: "phone", label: "Phone", cell: (row) => <a href={whatsappLink(row.phone, `Hello ${row.full_name}, following up on your enquiry`)} target="_blank" rel="noopener noreferrer" className="money text-navy-800 hover:underline">{formatPhone(row.phone)}</a> },
              { key: "due", label: "Due", cell: (row) => <span className="money text-xs">{formatDateTime(row.next_follow_up_at)}</span> },
            ]}
          />
        </Widget>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Widget title="Today's site visits" icon={CalendarCheck2} to="/site-visits" className="xl:col-span-2">
          <MiniTable
            rows={data.todays_visits}
            rowKey={(row) => row.visit_id}
            empty="No visits scheduled today"
            columns={[
              { key: "slot", label: "Slot", cell: (row) => <span className="money font-semibold">{formatSlotTime(row.slot_start)}–{formatSlotTime(row.slot_end)}</span> },
              { key: "visitor", label: "Visitor", cell: (row) => <span className="block truncate leading-tight"><span className="block">{row.name}{row.visitors > 1 ? ` (+${row.visitors - 1})` : ""}</span><span className="money block text-2xs text-ink-subtle">{formatPhone(row.phone)} · {row.project_name}</span></span> },
              { key: "status", label: "Status", cell: (row) => <StatusChip status={row.status} size="sm" /> },
              {
                key: "outcome",
                label: "",
                cell: (row) =>
                  canWriteVisits && (row.status === "CONFIRMED" || row.status === "RESCHEDULED") ? (
                    <span className="flex justify-end gap-1">
                      <Button size="xs" variant="outline" leftIcon={CheckCircle2} loading={outcome.isPending && outcome.variables?.visit.visit_id === row.visit_id && outcome.variables.kind === "complete"} onClick={() => outcome.mutate({ visit: row, kind: "complete" })} data-testid={`dash-visit-complete-${row.visit_id}`}>
                        Done
                      </Button>
                      <Button size="xs" variant="ghost" leftIcon={UserX} loading={outcome.isPending && outcome.variables?.visit.visit_id === row.visit_id && outcome.variables.kind === "no-show"} onClick={() => outcome.mutate({ visit: row, kind: "no-show" })} data-testid={`dash-visit-no-show-${row.visit_id}`}>
                        No-show
                      </Button>
                    </span>
                  ) : row.lead_id ? (
                    <Link to={`/leads/${row.lead_id}`} className="text-xs text-navy-800 hover:underline">
                      Lead
                    </Link>
                  ) : null,
              },
            ]}
          />
        </Widget>
        <Widget title="Availability snapshot" icon={Download} to="/flats">
          {data.availability.length === 0 ? (
            <p className="text-xs text-ink-subtle">No projects in scope.</p>
          ) : (
            <div className="space-y-3">
              {data.availability.map((project) => (
                <div key={project.project_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{project.project_name}</span>
                    <Badge variant="success" numeric>
                      {formatNumber(project.available)} available
                    </Badge>
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
    </div>
  );
}
