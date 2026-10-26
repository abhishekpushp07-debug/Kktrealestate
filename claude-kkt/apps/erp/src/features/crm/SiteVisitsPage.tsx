import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, List, Plus, UserX } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { VISIT_SOURCE_LABELS, VISIT_STATUSES, VISIT_STATUS_LABELS, type VisitRow } from "@kkt/contracts";
import {
  Badge,
  Button,
  Combobox,
  DataTable,
  DateInput,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  Tabs,
  TabsList,
  TabsTrigger,
  Toolbar,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber, formatPhone, todayIST } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useSalesUserOptions } from "@/features/inventory/api";
import { useProjectOptions } from "@/features/shared/options";
import { VISITS_PATH, addDays, crmKeys, formatSlotTime, startOfWeek, useVisitCalendar, useVisitsToday } from "./api";
import { VisitCalendar } from "./visits/VisitCalendar";
import { VisitDrawer, visitIsOpen } from "./visits/VisitDrawer";
import { VisitFormSheet } from "./visits/VisitFormSheet";

const VISIT_FILTERS = ["project_id", "status", "assignee_user_id", "from", "to", "needs_outcome"] as const;
type View = "day" | "week" | "list";

/** `/site-visits` — day / week calendar and list with outcomes, reschedule and the new-visit sheet. */
export default function SiteVisitsPage() {
  const { can } = useAuth();
  const canWrite = can("visit.write");
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "week" ? "week" : params.get("view") === "list" ? "list" : "day";
  const date = params.get("date") ?? todayIST();
  const selectedVisit = params.get("visit");
  const newOpen = params.get("new") === "1";
  const projects = useProjectOptions();
  const users = useSalesUserOptions();
  const projectParam = params.get("project");
  const projectId = projectParam ?? projects.data?.[0]?.id ?? null;
  const assignee = params.get("assignee");

  const setParam = (patch: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };

  const range = useMemo(
    () => (view === "week" ? { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) } : { from: date, to: date }),
    [view, date],
  );
  const calendar = useVisitCalendar(view === "list" ? null : projectId, range.from, range.to, assignee);

  const step = (direction: -1 | 1) =>
    setParam({ date: addDays(view === "week" ? startOfWeek(date) : date, direction * (view === "week" ? 7 : 1)) });

  return (
    <>
      <PageHeader
        title="Site visits"
        description="Capacity-checked visit slots per project. Mark outcomes so leads move on and the daily nudge stays quiet."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Site visits" }]}
        actions={
          canWrite ? (
            <Button leftIcon={Plus} onClick={() => setParam({ new: "1" })} data-testid="visit-new-btn">
              New visit
            </Button>
          ) : undefined
        }
      />

      <TodayStrip onOpen={(visit) => setParam({ visit: visit.id })} canWrite={canWrite} />

      <Toolbar
        filters={
          <>
            <Combobox
              aria-label="Project"
              size="sm"
              className="w-full sm:w-48"
              value={projectId}
              onValueChange={(value) => setParam({ project: value })}
              options={(projects.data ?? []).map((project) => ({
                value: project.id,
                label: project.name,
                description: project.code ?? undefined,
              }))}
              placeholder={projects.isPending ? "Loading…" : "Project"}
              data-testid="visits-project"
            />
            <Combobox
              aria-label="Assignee"
              size="sm"
              className="w-full sm:w-44"
              value={assignee}
              onValueChange={(value) => setParam({ assignee: value })}
              options={(users.data ?? []).map((user) => ({ value: user.id, label: user.name, keywords: [user.email] }))}
              placeholder="Anyone"
              allowClear
            />
            {view !== "list" && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={view === "week" ? "Previous week" : "Previous day"}
                  onClick={() => step(-1)}
                  className="px-2"
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <div className="w-40">
                  <DateInput
                    aria-label="Date"
                    value={date}
                    onChange={(value) => setParam({ date: value })}
                    className="h-12 text-xs sm:h-8"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={view === "week" ? "Next week" : "Next day"}
                  onClick={() => step(1)}
                  className="px-2"
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setParam({ date: null })}
                  disabled={date === todayIST()}
                >
                  Today
                </Button>
              </div>
            )}
          </>
        }
        actions={
          <Tabs value={view} onValueChange={(value) => setParam({ view: value === "day" ? null : value })}>
            <TabsList variant="pills" aria-label="View">
              <TabsTrigger
                value="day"
                icon={<CalendarCheck2 className="size-3.5" aria-hidden="true" />}
                data-testid="visits-view-day"
              >
                Day
              </TabsTrigger>
              <TabsTrigger
                value="week"
                icon={<CalendarDays className="size-3.5" aria-hidden="true" />}
                data-testid="visits-view-week"
              >
                Week
              </TabsTrigger>
              <TabsTrigger
                value="list"
                icon={<List className="size-3.5" aria-hidden="true" />}
                data-testid="visits-view-list"
              >
                List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {view === "list" ? (
        <VisitsTable onOpen={(visit) => setParam({ visit: visit.id })} projectId={projectId} />
      ) : !projectId ? (
        <ErrorState
          title="No project selected"
          description="Pick a project to see its visit calendar."
          className="rounded-lg border border-border bg-card"
        />
      ) : calendar.isPending ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : calendar.isError ? (
        <ErrorState
          error={calendar.error}
          onRetry={() => void calendar.refetch()}
          className="rounded-lg border border-border bg-card"
        />
      ) : (
        <div className={cn(calendar.isFetching && "opacity-70 transition-opacity")}>
          <VisitCalendar days={calendar.data} mode={view} onOpen={(visit) => setParam({ visit: visit.id })} />
        </div>
      )}

      <VisitDrawer visitId={selectedVisit} onClose={() => setParam({ visit: null })} />
      <VisitFormSheet
        open={newOpen}
        onOpenChange={(open) => !open && setParam({ new: null, lead_id: null, customer_id: null })}
        projectId={params.get("project") ?? projectId}
        leadId={params.get("lead_id")}
        customerId={params.get("customer_id")}
        onSaved={(visit) =>
          setParam({
            new: null,
            lead_id: null,
            customer_id: null,
            visit: visit.id,
            date: visit.visit_date,
            project: visit.project_id,
          })
        }
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Today's visits                                                       */
/* ------------------------------------------------------------------ */

function TodayStrip({ onOpen, canWrite }: { onOpen: (visit: VisitRow) => void; canWrite: boolean }) {
  const today = useVisitsToday();
  const outcome = useMutationWithToast<VisitRow, { visit: VisitRow; kind: "complete" | "no-show" }>({
    mutationFn: ({ visit, kind }) =>
      api.post<VisitRow>(`${VISITS_PATH}/${visit.id}/${kind}`, { version: visit.version }, { version: visit.version }),
    successMessage: (_saved, { kind }) => (kind === "complete" ? "Marked completed" : "Marked no-show"),
    invalidate: [[VISITS_PATH], crmKeys.today],
    entityLabel: "This visit",
  });
  const rows = (today.data ?? []).filter((visit) => visit.status !== "CANCELLED");
  if (today.isError || (today.data && rows.length === 0)) return null;
  const pending = rows.filter(visitIsOpen).length;
  return (
    <section
      aria-label="Today's visits"
      className="mb-3 rounded-lg border border-border bg-card p-3 shadow-card"
      data-testid="visits-today"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-950">
        <CalendarCheck2 className="size-4 text-gold-text" aria-hidden="true" /> Today's visits
        {today.data && (
          <Badge variant={pending > 0 ? "warning" : "success"} numeric>
            {pending} pending outcome
          </Badge>
        )}
      </div>
      {today.isPending ? (
        <Skeleton className="h-12" />
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {rows
            .sort((a, b) => a.slot_start.localeCompare(b.slot_start))
            .map((visit) => (
              <li
                key={visit.id}
                className="flex w-60 shrink-0 flex-col rounded-md border border-border bg-surface/60 p-2"
              >
                <button type="button" onClick={() => onOpen(visit)} className="text-left focus-ring rounded-xs">
                  <span className="money text-xs font-semibold text-navy-950">{formatSlotTime(visit.slot_start)}</span>
                  <span className="block truncate text-sm font-medium">{visit.name}</span>
                  <span className="block truncate text-2xs text-ink-subtle">
                    {visit.project_name} · {visit.visitors} {visit.visitors === 1 ? "visitor" : "visitors"}
                  </span>
                </button>
                <div className="mt-1.5 flex items-center gap-1">
                  <StatusChip status={visit.status} label={VISIT_STATUS_LABELS[visit.status]} size="sm" />
                  {canWrite && visitIsOpen(visit) && (
                    <span className="ml-auto flex gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        leftIcon={CheckCircle2}
                        loading={
                          outcome.isPending &&
                          outcome.variables?.visit.id === visit.id &&
                          outcome.variables.kind === "complete"
                        }
                        onClick={() => outcome.mutate({ visit, kind: "complete" })}
                        data-testid={`today-complete-${visit.id}`}
                      >
                        Done
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        leftIcon={UserX}
                        loading={
                          outcome.isPending &&
                          outcome.variables?.visit.id === visit.id &&
                          outcome.variables.kind === "no-show"
                        }
                        onClick={() => outcome.mutate({ visit, kind: "no-show" })}
                        data-testid={`today-no-show-${visit.id}`}
                      >
                        No-show
                      </Button>
                    </span>
                  )}
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

function VisitsTable({ onOpen, projectId }: { onOpen: (visit: VisitRow) => void; projectId: string | null }) {
  const list = useListParams({ filterKeys: VISIT_FILTERS, defaultSort: "-visit_date", prefix: "l_" });
  const users = useSalesUserOptions();
  // Seed the project filter from the calendar's project the first time the list opens.
  useEffect(() => {
    if (projectId && !list.filters.project_id && !list.hasActiveFilters) list.setFilter("project_id", projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time seed on mount; later project changes must not override the user's filter
  }, []);
  const query = useList<VisitRow>(VISITS_PATH, list.params);
  const columns = useMemo<ColumnDef<VisitRow, unknown>[]>(
    () => [
      {
        accessorKey: "visit_date",
        header: "When",
        meta: { locked: true, width: 170 },
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="money block font-semibold text-navy-950">
              {formatDate(row.original.visit_date)} · {formatSlotTime(row.original.slot_start)}
            </span>
            <span className="block font-mono text-2xs font-normal text-ink-subtle">{row.original.visit_number}</span>
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "Visitor",
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="block truncate">{row.original.name}</span>
            <span className="money block text-2xs text-ink-subtle">{formatPhone(row.original.phone)}</span>
          </span>
        ),
      },
      { accessorKey: "project_name", header: "Project" },
      { accessorKey: "visitors", header: "Visitors", meta: { align: "right", width: 80 } },
      {
        accessorKey: "status",
        header: "Status",
        meta: { width: 160 },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1">
            <StatusChip status={row.original.status} label={VISIT_STATUS_LABELS[row.original.status]} size="sm" />
            {row.original.rescheduled_from && <Badge variant="warning">Moved</Badge>}
          </span>
        ),
      },
      {
        accessorKey: "assignee_name",
        header: "Assignee",
        cell: ({ row }) => row.original.assignee_name ?? <span className="text-ink-subtle">—</span>,
      },
      {
        accessorKey: "source",
        header: "Source",
        meta: { hideOnMobile: true, width: 90 },
        cell: ({ row }) => VISIT_SOURCE_LABELS[row.original.source],
      },
    ],
    [],
  );
  const total = query.data?.total ?? 0;
  return (
    <>
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search visitor, phone or number…"
        filters={
          <>
            <Select
              aria-label="Status"
              size="sm"
              className="w-full sm:w-36"
              value={list.filters.status ?? null}
              onValueChange={(value) => list.setFilter("status", value)}
              options={VISIT_STATUSES.map((value) => ({ value, label: VISIT_STATUS_LABELS[value] }))}
              placeholder="Any status"
              allowClear
            />
            <Combobox
              aria-label="Assignee"
              size="sm"
              className="w-full sm:w-40"
              value={list.filters.assignee_user_id ?? null}
              onValueChange={(value) => list.setFilter("assignee_user_id", value)}
              options={(users.data ?? []).map((user) => ({ value: user.id, label: user.name }))}
              placeholder="Anyone"
              allowClear
            />
            <div className="w-full sm:w-40">
              <DateInput
                aria-label="From"
                value={list.filters.from ?? null}
                onChange={(value) => list.setFilter("from", value)}
                className="h-12 text-xs sm:h-8"
                max={list.filters.to}
              />
            </div>
            <div className="w-full sm:w-40">
              <DateInput
                aria-label="To"
                value={list.filters.to ?? null}
                onChange={(value) => list.setFilter("to", value)}
                className="h-12 text-xs sm:h-8"
                min={list.filters.from}
              />
            </div>
            <Select
              aria-label="Needs outcome"
              size="sm"
              className="w-full sm:w-40"
              value={list.filters.needs_outcome ?? null}
              onValueChange={(value) => list.setFilter("needs_outcome", value)}
              options={[{ value: "true", label: "Needs outcome" }]}
              placeholder="All visits"
              allowClear
            />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: VISITS_PATH, params: list.params, filename: "site-visits.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "visit" : "visits"}` : undefined}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={onOpen}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: CalendarCheck2,
          title: list.hasActiveFilters ? "No visits match" : "No site visits yet",
          description: list.hasActiveFilters
            ? "Try other filters."
            : "Website bookings and staff-created visits appear here.",
        }}
        data-testid="visits-table"
      />
    </>
  );
}
