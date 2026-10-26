import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { useMemo } from "react";
import { DEMAND_STATUS_LABELS, type DemandRow } from "@kkt/contracts";
import { Badge, Button, DataTable, StatusChip } from "@/components/ui";
import { formatDate, formatINR, formatINRShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openDemandLetter } from "@/features/payments/DemandsPage";
import { AGEING_ROW_CLASS, ageingLabel, ageingTone } from "@/features/payments/paymentMath";
import { useBookingDemands } from "../api";

function DemandCard({ row }: { row: DemandRow }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="money text-sm font-bold text-navy-950">{row.demand_number}</p>
          <p className="truncate text-xs text-ink-muted">
            {row.installment_name} · {row.trigger_label}
          </p>
        </div>
        <StatusChip status={row.status} label={DEMAND_STATUS_LABELS[row.status]} size="sm" />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-ink-subtle">Total</dt>
          <dd className="money font-semibold">{formatINRShort(row.total_demand_paise)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Paid</dt>
          <dd className="money font-semibold text-success-fg">{formatINRShort(row.paid_paise)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Due</dt>
          <dd className={cn("money font-semibold", row.days_overdue > 0 && "text-danger-fg")}>
            {formatDate(row.due_date)}
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-2">
        {row.days_overdue > 0 ? <Badge variant="danger">{ageingLabel(row.days_overdue)}</Badge> : <span />}
        <Button
          size="xs"
          variant="outline"
          leftIcon={FileText}
          onClick={() => openDemandLetter(row.booking_id, row.id)}
        >
          Letter
        </Button>
      </div>
    </div>
  );
}

/** Demands raised on this booking with status, due date, amounts and the letter PDF. */
export function DemandsTab({ bookingId }: { bookingId: string }) {
  const demands = useBookingDemands(bookingId);
  const rows = demands.data ?? [];

  const columns = useMemo<ColumnDef<DemandRow, unknown>[]>(
    () => [
      {
        accessorKey: "demand_number",
        header: "Demand",
        meta: { locked: true, width: 150, sortKey: false },
        cell: ({ row }) => <span className="money font-semibold text-navy-950">{row.original.demand_number}</span>,
      },
      {
        accessorKey: "installment_name",
        header: "Installment",
        meta: { sortKey: false },
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="block">{row.original.installment_name}</span>
            <span className="block text-2xs text-ink-subtle">
              {row.original.trigger_label} · {formatPercent(row.original.percent)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "demand_date",
        header: "Raised",
        meta: { width: 110, sortKey: false },
        cell: ({ row }) => <span className="money">{formatDate(row.original.demand_date)}</span>,
      },
      {
        accessorKey: "due_date",
        header: "Due date",
        meta: { width: 110, sortKey: false },
        cell: ({ row }) => (
          <span className={cn("money", row.original.days_overdue > 0 && "font-semibold text-danger-fg")}>
            {formatDate(row.original.due_date)}
          </span>
        ),
      },
      {
        accessorKey: "cash_demand_paise",
        header: "Cash",
        meta: { align: "right", width: 130, sortKey: false },
        cell: ({ row }) => <span className="money">{formatINR(row.original.cash_demand_paise)}</span>,
      },
      {
        accessorKey: "account_demand_paise",
        header: "Account",
        meta: { align: "right", width: 130, sortKey: false },
        cell: ({ row }) => <span className="money">{formatINR(row.original.account_demand_paise)}</span>,
      },
      {
        accessorKey: "total_demand_paise",
        header: "Total",
        meta: { align: "right", width: 140, sortKey: false },
        cell: ({ row }) => (
          <span className="money font-semibold text-navy-950">{formatINR(row.original.total_demand_paise)}</span>
        ),
      },
      {
        accessorKey: "paid_paise",
        header: "Paid",
        meta: { align: "right", width: 130, sortKey: false },
        cell: ({ row }) => <span className="money text-success-fg">{formatINR(row.original.paid_paise)}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { width: 140, sortKey: false },
        cell: ({ row }) => (
          <span className="inline-flex flex-col gap-0.5">
            <StatusChip status={row.original.status} label={DEMAND_STATUS_LABELS[row.original.status]} />
            {row.original.days_overdue > 0 && (
              <span className="text-2xs font-semibold text-danger-fg">{ageingLabel(row.original.days_overdue)}</span>
            )}
          </span>
        ),
      },
      {
        id: "letter",
        header: "",
        meta: { align: "right", width: 110, sortKey: false, label: "Letter" },
        cell: ({ row }) => (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={FileText}
            onClick={() => openDemandLetter(row.original.booking_id, row.original.id)}
            aria-label={`Demand letter ${row.original.demand_number}`}
            data-no-row-click
          >
            Letter
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      loading={demands.isPending}
      error={demands.error}
      onRetry={() => void demands.refetch()}
      rowClassName={(row) =>
        row.status === "VOID" || row.status === "CANCELLED"
          ? "opacity-60"
          : AGEING_ROW_CLASS[ageingTone(row.days_overdue)] || undefined
      }
      mobileCard={(row) => <DemandCard row={row} />}
      emptyState={{
        title: "No demands yet",
        description:
          "Demands are raised when installments trigger — on booking, on stage completion, by date, or when dues are run.",
      }}
      data-testid="demands-tab"
    />
  );
}
