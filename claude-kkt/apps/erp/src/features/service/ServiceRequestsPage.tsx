import type { ColumnDef } from "@tanstack/react-table";
import { KanbanSquare, LifeBuoy, List, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SERVICE_PRIORITIES, SERVICE_PRIORITY_LABELS, SERVICE_STATUSES, SERVICE_STATUS_LABELS, type ServiceRequestRow, type ServiceStatus } from "@kkt/contracts";
import { Button, Combobox, DataTable, ErrorState, PageHeader, Select, Skeleton, Tabs, TabsList, TabsTrigger, Toolbar } from "@/components/ui";
import { api, type QueryParams } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { searchCustomers } from "@/features/crm/api";
import { useProjectOptions, useUserOptions } from "@/features/shared/options";
import { NewTicketSheet } from "./NewTicketSheet";
import { ServiceKanban } from "./ServiceKanban";
import { SlaBreachesWidget } from "./SlaBreachesWidget";
import { PriorityChip, SlaBadge, TicketCard, TicketStatusChip } from "./components";
import { SERVICE_PATH, serviceInvalidations, useServiceBoard, useServiceCategories } from "./api";

const TICKET_FILTERS = ["status", "priority", "category_id", "assignee_user_id", "project_id", "customer_id", "sla_breached", "unassigned"] as const;

/** `/service-requests` — tickets as a list or a status kanban, SLA breach strip, new-ticket sheet. */
export default function ServiceRequestsPage() {
  const { can } = useAuth();
  const canWrite = can("service.write");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "kanban" ? "kanban" : "list";
  const list = useListParams({ filterKeys: TICKET_FILTERS, defaultSort: "-created_at" });
  const query = useList<ServiceRequestRow>(SERVICE_PATH, list.params, { enabled: view === "list" });
  const categories = useServiceCategories();
  const projects = useProjectOptions();
  const users = useUserOptions(can("service.assign") || can("users.manage"));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);

  const setView = (next: "list" | "kanban") => {
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        if (next === "kanban") copy.set("view", "kanban");
        else copy.delete("view");
        return copy;
      },
      { replace: true },
    );
  };

  const boardFilters = useMemo<QueryParams>(() => {
    const filters: QueryParams = { column_limit: 50 };
    for (const key of ["priority", "category_id", "assignee_user_id", "project_id"] as const) {
      const value = list.filters[key];
      if (value) filters[key] = value;
    }
    return filters;
  }, [list.filters]);
  const board = useServiceBoard(boardFilters, view === "kanban");

  const move = useMutationWithToast<ServiceRequestRow, { ticket: ServiceRequestRow; status: ServiceStatus }>({
    mutationFn: ({ ticket, status }) => api.post<ServiceRequestRow>(`${SERVICE_PATH}/${ticket.id}/status`, { version: ticket.version, status }, { version: ticket.version }),
    successMessage: (saved) => `${saved.ticket_number} → ${SERVICE_STATUS_LABELS[saved.status]}`,
    invalidate: serviceInvalidations(),
    entityLabel: "This ticket",
  });

  const columns = useMemo<ColumnDef<ServiceRequestRow, unknown>[]>(
    () => [
      {
        accessorKey: "ticket_number",
        header: "Ticket",
        meta: { locked: true, width: 130 },
        cell: ({ row }) => (
          <Link to={`/service-requests/${row.original.id}`} className="money font-semibold text-navy-800 hover:text-navy-950 hover:underline focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
            {row.original.ticket_number}
          </Link>
        ),
      },
      { accessorKey: "subject", header: "Subject", cell: ({ row }) => <span className="block max-w-[22rem] truncate" title={row.original.subject}>{row.original.subject}</span> },
      {
        accessorKey: "customer_name",
        header: "Customer",
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate">{row.original.customer_name}</span>
            <span className="money block text-2xs text-ink-subtle">{row.original.customer_phone}</span>
          </span>
        ),
      },
      {
        id: "booking",
        header: "Booking",
        meta: { sortKey: false },
        cell: ({ row }) =>
          row.original.booking_id ? (
            <Link to={`/bookings/${row.original.booking_id}`} className="block min-w-0 text-navy-800 hover:underline focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
              <span className="money block">{row.original.booking_number}</span>
              <span className="block truncate text-2xs text-ink-subtle">
                {row.original.project_name} {row.original.flat_number}
              </span>
            </Link>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      { accessorKey: "category_name", header: "Category" },
      { accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityChip priority={row.original.priority} /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <TicketStatusChip status={row.original.status} /> },
      { accessorKey: "assignee_name", header: "Assignee", cell: ({ row }) => row.original.assignee_name ?? <span className="text-ink-subtle">Unassigned</span> },
      { accessorKey: "sla_due_at", header: "SLA", cell: ({ row }) => <SlaBadge ticket={row.original} /> },
      { accessorKey: "last_message_at", header: "Last activity", meta: { hideOnMobile: true }, cell: ({ row }) => <span className="money text-ink-muted" title={formatDateTime(row.original.last_message_at ?? row.original.updated_at)}>{formatRelative(row.original.last_message_at ?? row.original.updated_at)}</span> },
      { accessorKey: "created_at", header: "Raised", meta: { hideOnMobile: true }, cell: ({ row }) => <span className="money text-ink-muted">{formatDateTime(row.original.created_at)}</span> },
    ],
    [],
  );

  const filters = (
    <>
      {view === "list" && <Select aria-label="Status" size="sm" className="w-full sm:w-40" value={list.filters.status ?? null} onValueChange={(value) => list.setFilter("status", value)} options={SERVICE_STATUSES.map((value) => ({ value, label: SERVICE_STATUS_LABELS[value] }))} placeholder="Any status" allowClear data-testid="tickets-filter-status" />}
      <Select aria-label="Priority" size="sm" className="w-full sm:w-32" value={list.filters.priority ?? null} onValueChange={(value) => list.setFilter("priority", value)} options={SERVICE_PRIORITIES.map((value) => ({ value, label: SERVICE_PRIORITY_LABELS[value] }))} placeholder="Any priority" allowClear data-testid="tickets-filter-priority" />
      <Select aria-label="Category" size="sm" className="w-full sm:w-44" value={list.filters.category_id ?? null} onValueChange={(value) => list.setFilter("category_id", value)} options={(categories.data ?? []).map((row) => ({ value: row.id, label: row.name }))} placeholder="Any category" allowClear data-testid="tickets-filter-category" />
      <Combobox aria-label="Assignee" size="sm" className="w-full sm:w-44" value={list.filters.assignee_user_id ?? null} onValueChange={(value) => list.setFilter("assignee_user_id", value)} options={(users.data ?? []).map((user) => ({ value: user.id, label: user.name, keywords: [user.email] }))} placeholder="Anyone" allowClear data-testid="tickets-filter-assignee" />
      <Combobox aria-label="Project" size="sm" className="w-full sm:w-44" value={list.filters.project_id ?? null} onValueChange={(value) => list.setFilter("project_id", value)} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined }))} placeholder="Any project" allowClear data-testid="tickets-filter-project" />
      {view === "list" && (
        <>
          <Combobox aria-label="Customer" size="sm" className="w-full sm:w-48" value={list.filters.customer_id ?? null} onValueChange={(value, option) => { list.setFilter("customer_id", value); setCustomerLabel(option?.label ?? null); }} onSearch={searchCustomers} selectedLabel={customerLabel ?? (list.filters.customer_id ? "Selected customer" : undefined)} placeholder="Any customer" allowClear data-testid="tickets-filter-customer" />
          <Select aria-label="SLA" size="sm" className="w-full sm:w-36" value={list.filters.sla_breached === "true" ? "breached" : list.filters.unassigned === "true" ? "unassigned" : null} onValueChange={(value) => list.setFilters({ sla_breached: value === "breached" ? "true" : null, unassigned: value === "unassigned" ? "true" : null })} options={[{ value: "breached", label: "SLA breached" }, { value: "unassigned", label: "Unassigned" }]} placeholder="Any" allowClear data-testid="tickets-filter-flags" />
        </>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Service requests"
        description="Customer tickets with SLA clocks, assignment and threaded replies. Internal notes never reach the portal."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Service" }, { label: "Service requests" }]}
        actions={
          canWrite ? (
            <Button leftIcon={Plus} onClick={() => setSheetOpen(true)} data-testid="ticket-new-btn">
              New ticket
            </Button>
          ) : undefined
        }
      />

      <SlaBreachesWidget />

      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search ticket number, subject or customer…"
        filters={filters}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={view === "list" ? { path: SERVICE_PATH, params: list.params, filename: "service-requests.csv" } : undefined}
        exportTotal={query.data?.total}
        summary={view === "list" && query.data ? `${formatNumber(query.data.total)} tickets` : undefined}
        actions={
          <Tabs value={view} onValueChange={(value) => setView(value === "kanban" ? "kanban" : "list")}>
            <TabsList variant="pills" aria-label="View">
              <TabsTrigger value="list" icon={<List className="size-3.5" aria-hidden="true" />} data-testid="tickets-view-list">
                List
              </TabsTrigger>
              <TabsTrigger value="kanban" icon={<KanbanSquare className="size-3.5" aria-hidden="true" />} data-testid="tickets-view-kanban">
                Kanban
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {view === "list" ? (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => row.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          sort={list.sort}
          onSortChange={list.setSort}
          onRowClick={(row) => navigate(`/service-requests/${row.id}`)}
          pagination={{ page: list.page, pageSize: list.pageSize, total: query.data?.total ?? 0, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
          mobileCard={(row) => (
            <div onClick={() => navigate(`/service-requests/${row.id}`)} className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-card focus-within:ring-2 focus-within:ring-gold">
              <TicketCard ticket={row} />
            </div>
          )}
          emptyState={{ icon: LifeBuoy, title: "No tickets match", description: list.hasActiveFilters ? "Try clearing a filter." : canWrite ? "Raise the first ticket for a customer." : "Customer tickets will appear here." }}
          data-testid="tickets-table"
        />
      ) : board.isPending ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} className="rounded-lg border border-border bg-card" />
      ) : (
        <ServiceKanban columns={board.data.columns} canWrite={canWrite} loading={board.isFetching} onMove={(ticket, status) => move.mutate({ ticket, status })} />
      )}

      <NewTicketSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
