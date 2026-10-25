import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type ReactNode } from "react";
import { PAYMENT_AGAINST_LABELS, PAYMENT_BUCKET_LABELS, PAYMENT_STATUS_LABELS, type PaymentRow } from "@kkt/contracts";
import { Badge, DataTable, StatusChip, type DataTablePagination } from "@/components/ui";
import { formatDate, formatINR, formatINRShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookingLink, UnitLabel } from "@/features/bookings/components";
import { PaymentActionButtons, PaymentActionDialogs, type PaymentActionState } from "./PaymentActions";

export interface PaymentsTableProps {
  rows: readonly PaymentRow[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  sort?: string | null;
  onSortChange?: (sort: string | null) => void;
  pagination?: DataTablePagination;
  /** Hide booking / customer / unit columns on the booking detail tab. */
  showBooking?: boolean;
  /** Extra query keys refreshed after clear / bounce / reverse. */
  invalidate?: readonly (readonly unknown[])[];
  highlightId?: string | null;
  emptyTitle?: string;
  emptyAction?: ReactNode;
  density?: "normal" | "compact";
}

/** Against + bucket / charge in one cell. */
function AgainstCell({ row }: { row: PaymentRow }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {row.against === "FLAT_VALUE" ? (
        <Badge variant={row.bucket === "CASH" ? "navy" : "info"}>{row.bucket ? PAYMENT_BUCKET_LABELS[row.bucket] : PAYMENT_AGAINST_LABELS.FLAT_VALUE}</Badge>
      ) : (
        <Badge variant="gold">{row.other_charge_name ?? PAYMENT_AGAINST_LABELS.OTHER_CHARGE}</Badge>
      )}
    </span>
  );
}

function ModeCell({ row }: { row: PaymentRow }) {
  return (
    <span className="block min-w-0 leading-tight">
      <span className="block text-sm">{row.mode_name}</span>
      {row.instrument && (
        <span className="money block truncate text-2xs text-ink-subtle">
          {row.instrument.number}
          {row.instrument.date ? ` · ${formatDate(row.instrument.date)}` : ""}
          {row.instrument.bank_name ? ` · ${row.instrument.bank_name}` : ""}
        </span>
      )}
      {row.bank_account_label && !row.instrument && <span className="block truncate text-2xs text-ink-subtle">{row.bank_account_label}</span>}
    </span>
  );
}

/** Payment status chip plus the cancellation hint on reversed receipts. */
export function PaymentStatusChip({ row, size }: { row: Pick<PaymentRow, "status" | "receipt_cancelled">; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusChip status={row.status} label={PAYMENT_STATUS_LABELS[row.status]} size={size} />
      {row.receipt_cancelled && <span className="text-2xs font-semibold uppercase text-danger-fg">Cancelled</span>}
    </span>
  );
}

function PaymentMobileCard({ row, showBooking, onAction }: { row: PaymentRow; showBooking: boolean; onAction: (state: PaymentActionState) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="money text-sm font-bold text-navy-950">{row.receipt_number}</p>
          <p className="text-xs text-ink-subtle">{formatDate(row.payment_date)}</p>
        </div>
        <PaymentStatusChip row={row} size="sm" />
      </div>
      {showBooking && (
        <div className="min-w-0 text-sm">
          <BookingLink id={row.booking_id} number={row.booking_number} /> <span className="text-ink">· {row.customer_name}</span>
          <UnitLabel project={row.project_name} block={row.block_name} flat={row.flat_number} className="text-xs" />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AgainstCell row={row} />
        <span className={cn("money text-base font-bold", row.status === "REVERSED" || row.status === "BOUNCED" ? "text-ink-subtle line-through" : "text-navy-950")}>{formatINR(row.amount_paise)}</span>
      </div>
      <ModeCell row={row} />
      <PaymentActionButtons payment={row} onAction={onAction} />
    </div>
  );
}

/** Payments list shared by `/payments` and the booking detail tab. */
export function PaymentsTable({ rows, loading = false, error, onRetry, sort, onSortChange, pagination, showBooking = true, invalidate, highlightId, emptyTitle = "No payments", emptyAction, density }: PaymentsTableProps) {
  const [action, setAction] = useState<PaymentActionState | null>(null);

  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(() => {
    const base: ColumnDef<PaymentRow, unknown>[] = [
      { accessorKey: "receipt_number", header: "Receipt", meta: { locked: true, width: 150 }, cell: ({ row }) => <span className="money font-semibold text-navy-950">{row.original.receipt_number}</span> },
      { accessorKey: "payment_date", header: "Date", meta: { width: 110 }, cell: ({ row }) => <span className="money">{formatDate(row.original.payment_date)}</span> },
    ];
    if (showBooking) {
      base.push(
        { accessorKey: "booking_number", header: "Booking", meta: { width: 150 }, cell: ({ row }) => <BookingLink id={row.original.booking_id} number={row.original.booking_number} /> },
        { accessorKey: "customer_name", header: "Customer", cell: ({ row }) => <span className="block truncate">{row.original.customer_name}</span> },
        { id: "unit", header: "Project · Tower · Flat", meta: { sortKey: "project_name", label: "Unit" }, cell: ({ row }) => <UnitLabel project={row.original.project_name} block={row.original.block_name} flat={row.original.flat_number} /> },
      );
    }
    base.push(
      { id: "against", header: "Against", meta: { sortKey: "against", width: 150 }, cell: ({ row }) => <AgainstCell row={row.original} /> },
      { accessorKey: "amount_paise", header: "Amount", meta: { align: "right", width: 140 }, cell: ({ row }) => <span className={cn("money font-semibold", row.original.status === "REVERSED" || row.original.status === "BOUNCED" ? "text-ink-subtle line-through" : "text-navy-950")}>{formatINR(row.original.amount_paise)}</span> },
      { id: "mode", header: "Mode / instrument", meta: { sortKey: "mode_code" }, cell: ({ row }) => <ModeCell row={row.original} /> },
      { accessorKey: "status", header: "Status", meta: { width: 130 }, cell: ({ row }) => <PaymentStatusChip row={row.original} /> },
      { accessorKey: "received_by_name", header: "Received by", meta: { hideOnMobile: true }, cell: ({ row }) => <span className="truncate text-ink-muted">{row.original.received_by_name ?? "—"}</span> },
      { id: "actions", header: "", meta: { sortKey: false, align: "right", width: 220, label: "Actions" }, cell: ({ row }) => <PaymentActionButtons payment={row.original} onAction={setAction} /> },
    );
    return base;
  }, [showBooking]);

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={onRetry}
        sort={sort}
        onSortChange={onSortChange}
        pagination={pagination}
        density={density}
        rowClassName={(row) => (highlightId && row.id === highlightId ? "bg-gold-light" : undefined)}
        mobileCard={(row) => <PaymentMobileCard row={row} showBooking={showBooking} onAction={setAction} />}
        emptyState={{ title: emptyTitle, description: "Posted payments appear here with their receipt numbers.", action: emptyAction }}
        footer={rows.length > 0 ? <PaymentsFooter rows={rows} /> : undefined}
        data-testid="payments-table"
      />
      <PaymentActionDialogs state={action} onClose={() => setAction(null)} invalidate={invalidate} />
    </>
  );
}

function PaymentsFooter({ rows }: { rows: readonly PaymentRow[] }) {
  const cleared = rows.filter((row) => row.status === "CLEARED").reduce((sum, row) => sum + row.amount_paise, 0);
  const pending = rows.filter((row) => row.status === "PENDING").reduce((sum, row) => sum + row.amount_paise, 0);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted">
      <span>
        On this page: cleared <span className="money font-semibold text-success-fg">{formatINRShort(cleared)}</span>
      </span>
      {pending > 0 && (
        <span>
          pending <span className="money font-semibold text-warning-fg">{formatINRShort(pending)}</span>
        </span>
      )}
    </div>
  );
}
