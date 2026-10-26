import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LEDGER_EVENT_LABELS, MONEY_CATEGORY_LABELS, type LedgerRow } from "@kkt/contracts";
import { Badge, Button, DataTable } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR, formatINRShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BOOKINGS_PATH, useBookingLedger } from "../api";
import { LEDGER_AMOUNT_CLASS, ledgerAmountTone, ledgerCategory } from "../bookingMath";
import { DueAmount } from "../components";

const EVENT_VARIANT: Readonly<Record<LedgerRow["event"], "navy" | "success" | "danger" | "warning" | "info" | "gold" | "neutral">> = {
  DEMAND: "navy",
  PAYMENT: "success",
  REVERSAL: "danger",
  AGREEMENT_CHANGE: "warning",
  PLAN_CHANGE: "warning",
  OTHER_CHARGE_DEMAND: "gold",
  OTHER_CHARGE_PAYMENT: "success",
  OTHER_CHARGE_REVERSAL: "danger",
  CANCELLATION: "danger",
};

function CategoryChip({ row }: { row: LedgerRow }) {
  const category = ledgerCategory(row);
  if (!category) return <span className="text-ink-subtle">—</span>;
  return <Badge variant={category === "CASH" ? "navy" : category === "ACCOUNT" ? "info" : "gold"}>{MONEY_CATEGORY_LABELS[category]}</Badge>;
}

function RefLink({ row }: { row: LedgerRow }) {
  if (!row.ref_number) return <span className="text-ink-subtle">—</span>;
  const isPayment = row.event === "PAYMENT" || row.event === "REVERSAL" || row.event === "OTHER_CHARGE_PAYMENT" || row.event === "OTHER_CHARGE_REVERSAL";
  if (isPayment && row.ref_id) {
    return (
      <Link to={`/print/receipt/${row.ref_id}`} target="_blank" rel="noopener" className="money text-navy-800 underline underline-offset-2 hover:text-navy-950 focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
        {row.ref_number}
      </Link>
    );
  }
  if ((row.event === "DEMAND" || row.event === "OTHER_CHARGE_DEMAND") && row.ref_id) {
    return (
      <Link to={`/print/demand/${row.booking_id}/${row.ref_id}`} target="_blank" rel="noopener" className="money text-navy-800 underline underline-offset-2 hover:text-navy-950 focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
        {row.ref_number}
      </Link>
    );
  }
  return <span className="money">{row.ref_number}</span>;
}

function LedgerCard({ row }: { row: LedgerRow }) {
  const tone = ledgerAmountTone(row);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <Badge variant={EVENT_VARIANT[row.event]}>{LEDGER_EVENT_LABELS[row.event]}</Badge>
            <CategoryChip row={row} />
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{row.label ?? row.note ?? ""}</p>
        </div>
        <div className="text-right">
          <p className={cn("money text-base font-bold", LEDGER_AMOUNT_CLASS[tone])}>{formatINR(row.amount_paise, { signed: tone === "credit" })}</p>
          <p className="money text-2xs text-ink-subtle">
            #{row.seq} · {formatDate(row.entry_date)}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-ink-subtle">Cash due</dt>
          <dd>
            <DueAmount paise={row.cash_due_paise} short />
          </dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Account due</dt>
          <dd>
            <DueAmount paise={row.account_due_paise} short />
          </dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Total due</dt>
          <dd>
            <DueAmount paise={row.total_due_paise} short />
          </dd>
        </div>
      </dl>
      <p className="money text-2xs text-ink-subtle">
        Paid cum. cash {formatINRShort(row.cash_paid_cum_paise)} · account {formatINRShort(row.account_paid_cum_paise)} · raised cash {formatINRShort(row.cash_order_raised_paise)} · account {formatINRShort(row.account_order_raised_paise)}
        {row.ref_number ? <> · <RefLink row={row} /></> : null}
      </p>
    </div>
  );
}

/** SPEC §11 ledger table: one row per event with running balances; advances green, dues red. */
export function LedgerTab({ bookingId }: { bookingId: string }) {
  const ledger = useBookingLedger(bookingId);
  const [exporting, setExporting] = useState(false);
  const rows = ledger.data?.items ?? [];

  const columns = useMemo<ColumnDef<LedgerRow, unknown>[]>(
    () => [
      { accessorKey: "entry_date", header: "Date", meta: { locked: true, width: 110, sortKey: false }, cell: ({ row }) => <span className="money leading-tight"><span className="block">{formatDate(row.original.entry_date)}</span><span className="block text-2xs text-ink-subtle">#{row.original.seq}</span></span> },
      { accessorKey: "event", header: "Event", meta: { width: 150, sortKey: false }, cell: ({ row }) => <Badge variant={EVENT_VARIANT[row.original.event]}>{LEDGER_EVENT_LABELS[row.original.event]}</Badge> },
      { accessorKey: "label", header: "Stage / installment", meta: { sortKey: false }, cell: ({ row }) => <span className="block truncate leading-tight"><span className="block">{row.original.label ?? "—"}</span>{row.original.note && <span className="block truncate text-2xs text-ink-subtle">{row.original.note}</span>}</span> },
      { id: "category", header: "Category", meta: { width: 110, sortKey: false }, cell: ({ row }) => <CategoryChip row={row.original} /> },
      { accessorKey: "amount_paise", header: "Amount", meta: { align: "right", width: 130, sortKey: false }, cell: ({ row }) => <span className={cn("money font-semibold", LEDGER_AMOUNT_CLASS[ledgerAmountTone(row.original)])}>{formatINR(row.original.amount_paise, { signed: ledgerAmountTone(row.original) === "credit" })}</span> },
      { accessorKey: "cash_paid_cum_paise", header: "Cash paid (cum.)", meta: { align: "right", width: 130, sortKey: false, label: "Cash paid" }, cell: ({ row }) => <span className="money">{formatINR(row.original.cash_paid_cum_paise)}</span> },
      { accessorKey: "account_paid_cum_paise", header: "Account paid (cum.)", meta: { align: "right", width: 140, sortKey: false, label: "Account paid" }, cell: ({ row }) => <span className="money">{formatINR(row.original.account_paid_cum_paise)}</span> },
      { accessorKey: "cash_order_raised_paise", header: "Cash raised", meta: { align: "right", width: 130, sortKey: false }, cell: ({ row }) => <span className="money text-ink-muted">{formatINR(row.original.cash_order_raised_paise)}</span> },
      { accessorKey: "account_order_raised_paise", header: "Account raised", meta: { align: "right", width: 140, sortKey: false }, cell: ({ row }) => <span className="money text-ink-muted">{formatINR(row.original.account_order_raised_paise)}</span> },
      { accessorKey: "cash_due_paise", header: "Cash due", meta: { align: "right", width: 150, sortKey: false }, cell: ({ row }) => <DueAmount paise={row.original.cash_due_paise} /> },
      { accessorKey: "account_due_paise", header: "Account due", meta: { align: "right", width: 150, sortKey: false }, cell: ({ row }) => <DueAmount paise={row.original.account_due_paise} /> },
      { accessorKey: "total_due_paise", header: "Total due", meta: { align: "right", width: 150, sortKey: false }, cell: ({ row }) => <DueAmount paise={row.original.total_due_paise} className="text-sm" /> },
      { accessorKey: "ref_number", header: "Ref", meta: { width: 150, sortKey: false }, cell: ({ row }) => <RefLink row={row.original} /> },
    ],
    [],
  );

  const last = rows[rows.length - 1];

  return (
    <div className="space-y-3" data-testid="ledger-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          One row per event with running balances. <span className="font-semibold text-success-fg">Green</span> = advance (paid beyond what is raised), <span className="font-semibold text-danger-fg">red</span> = due.
        </p>
        <Button
          size="sm"
          variant="outline"
          leftIcon={Download}
          loading={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await api.exportCsv(`${BOOKINGS_PATH}/${bookingId}/ledger`, { page_size: 200, sort: "seq" }, "ledger.csv");
            } finally {
              setExporting(false);
            }
          }}
          data-testid="ledger-csv"
        >
          CSV
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        loading={ledger.isPending}
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        density="compact"
        maxHeight="60vh"
        mobileCard={(row) => <LedgerCard row={row} />}
        emptyState={{ title: "Ledger is empty", description: "Demands and payments will appear here as they happen." }}
        footer={
          last ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted">
              <span>
                Cash due <DueAmount paise={last.cash_due_paise} />
              </span>
              <span>
                Account due <DueAmount paise={last.account_due_paise} />
              </span>
              <span>
                Total due <DueAmount paise={last.total_due_paise} />
              </span>
              <span>
                Other charges due <DueAmount paise={last.other_charges_due_paise} />
              </span>
            </div>
          ) : undefined
        }
        data-testid="ledger-table"
      />
    </div>
  );
}
