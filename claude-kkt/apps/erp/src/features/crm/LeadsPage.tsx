import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, ClipboardList, Inbox, KanbanSquare, List, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STAGES, LEAD_STAGE_LABELS, type LeadRow, type LeadStage } from "@kkt/contracts";
import { Badge, Button, Combobox, ConfirmDialog, DataTable, ErrorState, PageHeader, Select, Skeleton, StatusChip, Tabs, TabsList, TabsTrigger, Toolbar } from "@/components/ui";
import { api, type QueryParams } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber, formatPhone, formatRelative } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useSalesUserOptions } from "@/features/inventory/api";
import { useProjectOptions } from "@/features/shared/options";
import { budgetLabel, LeadDrawer } from "./LeadDrawer";
import { LeadFormSheet } from "./LeadFormSheet";
import { LeadKanban } from "./LeadKanban";
import { LEADS_PATH, crmKeys, useEnquiryUnreadCount, useFollowUpsDue, useLeadBoard } from "./api";

const LEAD_FILTERS = ["stage", "source", "assigned_user_id", "project_id", "follow_up_due"] as const;

/** `/leads` — Kanban or list, follow-ups due strip, lead drawer (`?lead=`), new lead sheet. */
export default function LeadsPage() {
  const { can, user } = useAuth();
  const canWrite = can("lead.write");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "kanban";
  const selectedLead = params.get("lead");
  const list = useListParams({ filterKeys: LEAD_FILTERS, defaultSort: "-created_at" });
  const projects = useProjectOptions();
  const users = useSalesUserOptions();
  const unread = useEnquiryUnreadCount(can("lead.read"));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lost, setLost] = useState<LeadRow | null>(null);

  const setParam = (key: string, value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const boardFilters = useMemo<QueryParams>(() => {
    const filters: QueryParams = {};
    if (list.search) filters.search = list.search;
    if (list.filters.project_id) filters.project_id = list.filters.project_id;
    if (list.filters.assigned_user_id) filters.assigned_user_id = list.filters.assigned_user_id;
    if (list.filters.source) filters.source = list.filters.source;
    return filters;
  }, [list.search, list.filters.project_id, list.filters.assigned_user_id, list.filters.source]);
  const board = useLeadBoard(boardFilters, view === "kanban");

  const move = useMutationWithToast<LeadRow, { lead: LeadRow; stage: LeadStage; reason?: string }>({
    mutationFn: ({ lead, stage, reason }) => api.post<LeadRow>(`${LEADS_PATH}/${lead.id}/stage`, { version: lead.version, stage, lost_reason: reason ?? null }, { version: lead.version }),
    successMessage: (saved) => `${saved.full_name} → ${LEAD_STAGE_LABELS[saved.stage]}`,
    invalidate: [[LEADS_PATH], crmKeys.followUpsDue],
    entityLabel: "This lead",
  });

  const onMove = (lead: LeadRow, stage: LeadStage) => {
    if (stage === "LOST") {
      setLost(lead);
      return;
    }
    move.mutate({ lead, stage });
  };

  const filters = (
    <>
      <Combobox aria-label="Project" size="sm" className="w-full sm:w-44" value={list.filters.project_id ?? null} onValueChange={(value) => list.setFilter("project_id", value)} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined }))} placeholder="Any project" allowClear data-testid="leads-filter-project" />
      <Combobox aria-label="Assigned to" size="sm" className="w-full sm:w-44" value={list.filters.assigned_user_id ?? null} onValueChange={(value) => list.setFilter("assigned_user_id", value)} options={(users.data ?? []).map((item) => ({ value: item.id, label: item.name, keywords: [item.email] }))} placeholder="Anyone" allowClear data-testid="leads-filter-assignee" />
      <Select aria-label="Source" size="sm" className="w-full sm:w-36" value={list.filters.source ?? null} onValueChange={(value) => list.setFilter("source", value)} options={LEAD_SOURCES.map((value) => ({ value, label: LEAD_SOURCE_LABELS[value] }))} placeholder="Any source" allowClear data-testid="leads-filter-source" />
      {view === "list" && <Select aria-label="Stage" size="sm" className="w-full sm:w-44" value={list.filters.stage ?? null} onValueChange={(value) => list.setFilter("stage", value)} options={LEAD_STAGES.map((value) => ({ value, label: LEAD_STAGE_LABELS[value] }))} placeholder="Any stage" allowClear data-testid="leads-filter-stage" />}
    </>
  );

  return (
    <>
      <PageHeader
        title="Leads"
        description="Pipeline from first contact to conversion. Drag cards between stages; Lost asks for a reason."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Leads" }]}
        actions={
          <>
            <Button asChild variant="outline" leftIcon={Inbox}>
              <Link to="/enquiries" data-testid="leads-enquiries-link">
                <Inbox aria-hidden="true" /> Enquiries
                {(unread.data ?? 0) > 0 && (
                  <span className="money ml-1 rounded-full bg-gold px-1.5 text-[10px] font-bold text-navy-950" aria-label={`${unread.data} unread`}>
                    {unread.data}
                  </span>
                )}
              </Link>
            </Button>
            {canWrite && (
              <Button leftIcon={Plus} onClick={() => setSheetOpen(true)} data-testid="lead-new-btn">
                New lead
              </Button>
            )}
          </>
        }
      />

      <FollowUpsStrip currentUserId={user?.id ?? null} onOpen={(lead) => setParam("lead", lead.id)} />

      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search name, phone or lead number…"
        filters={filters}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        onExportCsv={view === "list" ? () => api.exportCsv(LEADS_PATH, list.params, "leads.csv") : undefined}
        actions={
          <Tabs value={view} onValueChange={(value) => setParam("view", value === "list" ? "list" : null)}>
            <TabsList variant="pills" aria-label="View">
              <TabsTrigger value="kanban" icon={<KanbanSquare className="size-3.5" aria-hidden="true" />} data-testid="leads-view-kanban">
                <span className="sr-only sm:not-sr-only">Kanban</span>
              </TabsTrigger>
              <TabsTrigger value="list" icon={<List className="size-3.5" aria-hidden="true" />} data-testid="leads-view-list">
                <span className="sr-only sm:not-sr-only">List</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {view === "kanban" ? (
        board.isPending ? (
          <div className="flex gap-3 overflow-hidden">
            {LEAD_STAGES.map((stage) => (
              <Skeleton key={stage} className="h-72 w-[17rem] shrink-0 rounded-lg" />
            ))}
          </div>
        ) : board.isError ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} className="rounded-lg border border-border bg-card" />
        ) : (
          <LeadKanban columns={board.data.columns} canWrite={canWrite} onOpen={(lead) => setParam("lead", lead.id)} onMove={onMove} loading={board.isFetching || move.isPending} />
        )
      ) : (
        <LeadsTable list={list} onOpen={(lead) => setParam("lead", lead.id)} />
      )}

      <LeadDrawer leadId={selectedLead} onClose={() => setParam("lead", null)} />
      <LeadFormSheet open={sheetOpen} onOpenChange={setSheetOpen} lead={null} onSaved={(saved) => navigate(`/leads?lead=${saved.id}`)} />
      <ConfirmDialog
        open={lost !== null}
        onOpenChange={(open) => !open && setLost(null)}
        title={`Mark ${lost?.full_name ?? "lead"} as lost?`}
        description="The lead leaves the pipeline. Record the reason so the team can learn from it."
        confirmLabel="Mark lost"
        variant="destructive"
        requireReason
        reasonLabel="Lost reason"
        onConfirm={async (reason) => {
          if (lost) await move.mutateAsync({ lead: lost, stage: "LOST", reason: reason ?? "" });
        }}
      />
    </>
  );
}

function FollowUpsStrip({ currentUserId, onOpen }: { currentUserId: string | null; onOpen: (lead: LeadRow) => void }) {
  const due = useFollowUpsDue();
  const rows = useMemo(() => {
    const all = due.data ?? [];
    const mine = currentUserId ? all.filter((lead) => lead.assigned_user_id === currentUserId) : [];
    return { mine, all };
  }, [due.data, currentUserId]);
  const shown = rows.mine.length > 0 ? rows.mine : rows.all;
  if (due.isError || (due.data && shown.length === 0)) return null;
  return (
    <section aria-label="Follow-ups due" className="mb-3 rounded-lg border border-status-hold-border bg-warning-bg/50 p-3" data-testid="follow-ups-strip">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning-fg">
        <CalendarClock className="size-4" aria-hidden="true" />
        {rows.mine.length > 0 ? "My follow-ups due today" : "Follow-ups due today"}
        {due.data && <Badge variant="warning">{shown.length}</Badge>}
      </div>
      {due.isPending ? (
        <Skeleton className="h-8" />
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {shown.map((lead) => {
            const overdue = lead.next_follow_up_at !== null && Date.parse(lead.next_follow_up_at) < Date.now() - 60 * 60 * 1000;
            return (
              <li key={lead.id} className="shrink-0">
                <button type="button" onClick={() => onOpen(lead)} className={cn("flex min-w-44 flex-col rounded-md border bg-card px-3 py-1.5 text-left shadow-card hover:border-navy-300 focus-ring", overdue ? "border-danger/40" : "border-border")} data-testid={`follow-up-${lead.id}`}>
                  <span className="truncate text-sm font-semibold text-navy-950">{lead.full_name}</span>
                  <span className="money truncate text-2xs text-ink-subtle">
                    {formatPhone(lead.phone)} · {lead.next_follow_up_at ? formatRelative(lead.next_follow_up_at) : "due"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LeadsTable({ list, onOpen }: { list: ReturnType<typeof useListParams>; onOpen: (lead: LeadRow) => void }) {
  const query = useList<LeadRow>(LEADS_PATH, list.params);
  const columns = useMemo<ColumnDef<LeadRow, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Lead",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0 leading-tight">
            <span className="block truncate font-semibold text-navy-950">{row.original.full_name}</span>
            <span className="money block truncate text-2xs font-normal text-ink-subtle">
              {row.original.lead_number} · {formatPhone(row.original.phone)}
            </span>
          </span>
        ),
      },
      { accessorKey: "stage", header: "Stage", meta: { width: 170 }, cell: ({ row }) => <StatusChip status={row.original.stage} label={LEAD_STAGE_LABELS[row.original.stage]} size="sm" /> },
      { accessorKey: "project_name", header: "Project", cell: ({ row }) => row.original.project_name ?? <span className="text-ink-subtle">—</span> },
      { id: "budget", header: "Budget", meta: { sortKey: "budget_max_paise", align: "right" }, cell: ({ row }) => budgetLabel(row.original) ?? <span className="text-ink-subtle">—</span> },
      { accessorKey: "source", header: "Source", cell: ({ row }) => LEAD_SOURCE_LABELS[row.original.source] },
      { accessorKey: "assigned_user_name", header: "Assigned", cell: ({ row }) => row.original.assigned_user_name ?? <span className="text-ink-subtle">Unassigned</span> },
      {
        accessorKey: "next_follow_up_at",
        header: "Next follow-up",
        cell: ({ row }) => {
          const at = row.original.next_follow_up_at;
          if (!at) return <span className="text-ink-subtle">—</span>;
          const overdue = Date.parse(at) < Date.now() && row.original.stage !== "CONVERTED" && row.original.stage !== "LOST";
          return <span className={cn("money", overdue && "font-semibold text-danger-fg")}>{formatDateTime(at)}</span>;
        },
      },
      { accessorKey: "created_at", header: "Created", meta: { hideOnMobile: true }, cell: ({ row }) => <span className="money">{formatRelative(row.original.created_at)}</span> },
    ],
    [],
  );
  const total = query.data?.total ?? 0;
  return (
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
      rowClassName={(row) => (row.is_read ? undefined : "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-gold")}
      pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
      emptyState={{ icon: ClipboardList, title: list.hasActiveFilters ? "No leads match" : "No leads yet", description: list.hasActiveFilters ? "Try another search or clear the filters." : "Website enquiries, brochure downloads and site-visit bookings create leads automatically." }}
      footer={query.data ? <p className="px-1 pt-2 text-xs text-ink-subtle">{formatNumber(total)} leads</p> : undefined}
      data-testid="leads-table"
    />
  );
}
