import type { ColumnDef } from "@tanstack/react-table";
import { FilePlus2 } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, type BookingRow, type PaymentPlanRow } from "@kkt/contracts";
import { Badge, Button, DataTable, PageHeader, Select, Toolbar } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { useProjectBlocks } from "@/features/inventory/api";
import { useMasterRows } from "@/features/masters/api";
import { useProjectOptions } from "@/features/shared/options";
import { BOOKINGS_PATH } from "./api";
import { BookingLink, BookingMobileCard, BookingStatusChip, DueAmount, UnitLabel } from "./components";

const FILTERS = ["project_id", "block_id", "status", "payment_plan_id", "has_due", "has_advance"] as const;

/** `/bookings` — every booking with per-bucket figures, filters, CSV and the New booking entry point. */
export default function BookingsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useListParams({ filterKeys: FILTERS, defaultSort: "-booking_date" });
  const query = useList<BookingRow>(BOOKINGS_PATH, list.params);
  const projects = useProjectOptions();
  const blocks = useProjectBlocks(list.filters.project_id ?? null);
  const plans = useMasterRows<PaymentPlanRow>("payment-plans");

  const columns = useMemo<ColumnDef<BookingRow, unknown>[]>(
    () => [
      { accessorKey: "booking_number", header: "Booking", meta: { locked: true, width: 150 }, cell: ({ row }) => <BookingLink id={row.original.id} number={row.original.booking_number} /> },
      { accessorKey: "customer_name", header: "Customer", cell: ({ row }) => <span className="block truncate leading-tight"><span className="block font-medium">{row.original.customer_name}</span>{row.original.co_applicants.length > 0 && <span className="block text-2xs text-ink-subtle">+{row.original.co_applicants.length} co-applicant{row.original.co_applicants.length === 1 ? "" : "s"}</span>}</span> },
      { id: "unit", header: "Project · Tower · Flat", meta: { sortKey: "project_name", label: "Unit" }, cell: ({ row }) => <UnitLabel project={row.original.project_name} block={row.original.block_name} flat={row.original.flat_number} /> },
      { id: "plan", header: "Plan", meta: { sortKey: false }, cell: ({ row }) => <Badge variant="outline" className="max-w-[12rem] truncate">{row.original.plan_snapshot.name}</Badge> },
      { accessorKey: "booking_date", header: "Booked", meta: { width: 110, hideOnMobile: true }, cell: ({ row }) => <span className="money">{formatDate(row.original.booking_date)}</span> },
      { accessorKey: "agreement_value_paise", header: "Agreement", meta: { align: "right", width: 140 }, cell: ({ row }) => <span className="money font-semibold text-navy-950">{formatINR(row.original.agreement_value_paise)}</span> },
      { id: "paid", header: "Paid", meta: { align: "right", width: 130, sortKey: false }, cell: ({ row }) => <span className="money text-success-fg">{formatINR(row.original.summary.total_paid_paise)}</span> },
      { id: "due", header: "Due", meta: { align: "right", width: 150, sortKey: false }, cell: ({ row }) => <span className="inline-flex flex-col items-end"><DueAmount paise={row.original.summary.total_due_paise} />{row.original.summary.pending_cheques_paise > 0 && <span className="text-2xs text-warning-fg">cheques in hand</span>}</span> },
      { accessorKey: "status", header: "Status", meta: { width: 120 }, cell: ({ row }) => <BookingStatusChip status={row.original.status} /> },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Agreements, buckets and dues for every unit sold. Advances show in green, dues in red."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Bookings" }]}
        actions={
          can("booking.create") ? (
            <Button asChild leftIcon={FilePlus2} data-testid="bookings-new-btn">
              <Link to="/bookings/new">New booking</Link>
            </Button>
          ) : undefined
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Booking no., customer, phone, flat…"
        summary={query.data ? `${formatNumber(query.data.total)} bookings` : undefined}
        filters={
          <>
            <Select aria-label="Project" size="sm" className="w-full sm:w-48" value={list.filters.project_id ?? null} onValueChange={(value) => list.setFilters({ project_id: value, block_id: null })} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))} placeholder="All projects" allowClear />
            <Select aria-label="Tower" size="sm" className="w-full sm:w-40" value={list.filters.block_id ?? null} onValueChange={(value) => list.setFilter("block_id", value)} options={(blocks.data ?? []).map((block) => ({ value: block.id, label: block.name }))} placeholder={list.filters.project_id ? "All towers" : "Pick a project"} disabled={!list.filters.project_id} allowClear />
            <Select aria-label="Status" size="sm" className="w-full sm:w-36" value={list.filters.status ?? null} onValueChange={(value) => list.setFilter("status", value)} options={BOOKING_STATUSES.map((status) => ({ value: status, label: BOOKING_STATUS_LABELS[status] }))} placeholder="Any status" allowClear />
            <Select aria-label="Plan" size="sm" className="w-full sm:w-44" value={list.filters.payment_plan_id ?? null} onValueChange={(value) => list.setFilter("payment_plan_id", value)} options={(plans.data ?? []).map((plan) => ({ value: plan.id, label: plan.name }))} placeholder="Any plan" allowClear />
            <Select aria-label="Money" size="sm" className="w-full sm:w-36" value={list.filters.has_due === "true" ? "due" : list.filters.has_advance === "true" ? "advance" : null} onValueChange={(value) => list.setFilters({ has_due: value === "due" ? "true" : null, has_advance: value === "advance" ? "true" : null })} options={[{ value: "due", label: "With dues" }, { value: "advance", label: "With advances" }]} placeholder="Dues / advances" allowClear />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: BOOKINGS_PATH, params: { ...list.params, page: 1, page_size: 200 }, filename: "bookings.csv" }}
        exportTotal={query.data?.total}
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
        onRowClick={(row) => navigate(`/bookings/${row.id}`)}
        pagination={{ page: list.page, pageSize: list.pageSize, total: query.data?.total ?? 0, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        mobileCard={(row) => <BookingMobileCard booking={row} />}
        emptyState={{ title: "No bookings yet", description: "Bookings are created from the wizard: flat → customer → agreement → plan → charges → confirm.", action: can("booking.create") ? <Button asChild size="sm" leftIcon={FilePlus2}><Link to="/bookings/new">New booking</Link></Button> : undefined }}
        data-testid="bookings-table"
      />
    </>
  );
}
