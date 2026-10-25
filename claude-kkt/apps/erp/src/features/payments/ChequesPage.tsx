import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type ChequeRow } from "@kkt/contracts";
import { Badge, DataTable, PageHeader, Select, StatusChip, Tabs, TabsList, TabsTrigger, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { useListParams } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { UnitLabel } from "@/features/bookings/components";
import { useTabParam } from "@/features/inventory/components";
import { useProjectOptions } from "@/features/shared/options";
import { CHEQUES_PATH, useCheques } from "./api";
import { PaymentActionButtons, PaymentActionDialogs, type PaymentActionState } from "./PaymentActions";

const TABS = ["PENDING", "BOUNCED"] as const;
type Tab = (typeof TABS)[number];

/** Cheque rows carry the booking number only, so the link opens the bookings list filtered to it. */
function BookingNumberLink({ number }: { number: string }) {
  return (
    <Link to={`/bookings?q=${encodeURIComponent(number)}`} className="money font-semibold text-navy-800 hover:text-navy-950 hover:underline focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
      {number}
    </Link>
  );
}

function ageTone(days: number): "neutral" | "warning" | "danger" {
  if (days <= 7) return "neutral";
  if (days <= 21) return "warning";
  return "danger";
}

function ChequeCard({ row, onAction }: { row: ChequeRow; onAction: (state: PaymentActionState) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="money text-sm font-bold text-navy-950">{row.instrument?.number ?? row.receipt_number}</p>
          <p className="text-xs text-ink-subtle">
            {row.instrument?.bank_name ?? row.mode_code} · instrument date {formatDate(row.instrument_date)}
          </p>
        </div>
        <StatusChip status={row.status} size="sm" />
      </div>
      <div className="text-sm">
        <BookingNumberLink number={row.booking_number} />
        <span className="text-ink"> · {row.customer_name}</span>
        <UnitLabel project={row.project_name} block="" flat={row.flat_number} className="text-xs" />
      </div>
      <div className="flex items-center justify-between">
        <span className="money text-base font-bold text-navy-950">{formatINR(row.amount_paise)}</span>
        <Badge variant={ageTone(row.days_in_hand) === "danger" ? "danger" : ageTone(row.days_in_hand) === "warning" ? "warning" : "neutral"} numeric>
          {row.days_in_hand} d in hand
        </Badge>
      </div>
      {row.bounce_reason && <p className="text-xs text-danger-fg">{row.bounce_reason}</p>}
      <PaymentActionButtons payment={row} onAction={onAction} hidePrint />
    </div>
  );
}

/** `/payments/cheques` — cheques and DDs in hand sorted by instrument date, plus the bounced list. */
export default function ChequesPage() {
  const [tab, setTab] = useTabParam<Tab>(TABS, "PENDING", "status");
  const list = useListParams({ filterKeys: ["project_id"], defaultSort: "instrument_date" });
  const projects = useProjectOptions();
  const [action, setAction] = useState<PaymentActionState | null>(null);
  const [exporting, setExporting] = useState(false);

  const queryParams = useMemo(
    () => ({ status: tab, page: list.page, page_size: list.pageSize, sort: list.sort ?? undefined, search: list.search || undefined, project_id: list.filters.project_id }),
    [tab, list.page, list.pageSize, list.sort, list.search, list.filters.project_id],
  );
  const query = useCheques(queryParams);

  const columns = useMemo<ColumnDef<ChequeRow, unknown>[]>(
    () => [
      { accessorKey: "instrument_date", header: "Instrument date", meta: { locked: true, width: 130 }, cell: ({ row }) => <span className="money font-semibold">{formatDate(row.original.instrument_date)}</span> },
      { id: "instrument", header: "Instrument", meta: { sortKey: false }, cell: ({ row }) => <span className="money block leading-tight"><span className="block">{row.original.instrument?.number ?? "—"}</span><span className="block text-2xs text-ink-subtle">{row.original.instrument?.bank_name ?? row.original.mode_code}</span></span> },
      { accessorKey: "receipt_number", header: "Receipt", meta: { width: 140 }, cell: ({ row }) => <span className="money">{row.original.receipt_number}</span> },
      { accessorKey: "booking_number", header: "Booking", meta: { width: 140 }, cell: ({ row }) => <BookingNumberLink number={row.original.booking_number} /> },
      { accessorKey: "customer_name", header: "Customer" },
      { id: "unit", header: "Project · Flat", meta: { sortKey: "project_name" }, cell: ({ row }) => <span className="truncate">{row.original.project_name} · <span className="money font-semibold">{row.original.flat_number}</span></span> },
      { accessorKey: "amount_paise", header: "Amount", meta: { align: "right", width: 140 }, cell: ({ row }) => <span className="money font-semibold text-navy-950">{formatINR(row.original.amount_paise)}</span> },
      { accessorKey: "payment_date", header: "Received", meta: { width: 110, hideOnMobile: true }, cell: ({ row }) => <span className="money">{formatDate(row.original.payment_date)}</span> },
      {
        accessorKey: "days_in_hand",
        header: tab === "PENDING" ? "In hand" : "Age",
        meta: { align: "right", width: 100 },
        cell: ({ row }) => <span className={cn("money font-semibold", ageTone(row.original.days_in_hand) === "danger" && "text-danger-fg", ageTone(row.original.days_in_hand) === "warning" && "text-warning-fg")}>{row.original.days_in_hand} d</span>,
      },
      ...(tab === "BOUNCED" ? [{ accessorKey: "bounce_reason", header: "Reason", cell: ({ row }) => <span className="truncate text-danger-fg">{row.original.bounce_reason ?? "—"}</span> } satisfies ColumnDef<ChequeRow, unknown>] : []),
      { id: "actions", header: "", meta: { sortKey: false, align: "right", width: 180, label: "Actions" }, cell: ({ row }) => <PaymentActionButtons payment={row.original} onAction={setAction} hidePrint /> },
    ],
    [tab],
  );

  const totalInHand = (query.data?.items ?? []).reduce((sum, row) => sum + row.amount_paise, 0);

  return (
    <>
      <PageHeader
        title="Cheques in hand"
        description="Pending cheques and demand drafts by instrument date. Clear them once the bank credits the amount; bounce them with a reason otherwise."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Accounts" }, { label: "Payments", to: "/payments" }, { label: "Cheques" }]}
        backTo="/payments"
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="mb-3">
        <TabsList variant="pills">
          <TabsTrigger value="PENDING">In hand</TabsTrigger>
          <TabsTrigger value="BOUNCED">Bounced</TabsTrigger>
        </TabsList>
      </Tabs>
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Instrument no., customer, booking…"
        summary={query.data ? `${formatNumber(query.data.total)} · ${formatINRShort(totalInHand)} on this page` : undefined}
        filters={<Select aria-label="Project" size="sm" className="w-full sm:w-48" value={list.filters.project_id ?? null} onValueChange={(value) => list.setFilter("project_id", value)} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))} placeholder="All projects" allowClear />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exporting={exporting}
        onExportCsv={async () => {
          setExporting(true);
          try {
            await api.exportCsv(CHEQUES_PATH, { page: 1, page_size: 200, sort: list.sort, search: list.search, filters: { status: tab, project_id: list.filters.project_id } }, `cheques-${tab.toLowerCase()}.csv`);
          } finally {
            setExporting(false);
          }
        }}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isPending || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        pagination={{ page: list.page, pageSize: list.pageSize, total: query.data?.total ?? 0, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        mobileCard={(row) => <ChequeCard row={row} onAction={setAction} />}
        emptyState={{ title: tab === "PENDING" ? "No cheques in hand" : "No bounced instruments", description: tab === "PENDING" ? "Every cheque and DD has been cleared or bounced." : "Nothing has bounced recently." }}
        data-testid="cheques-table"
      />
      <PaymentActionDialogs state={action} onClose={() => setAction(null)} />
    </>
  );
}
