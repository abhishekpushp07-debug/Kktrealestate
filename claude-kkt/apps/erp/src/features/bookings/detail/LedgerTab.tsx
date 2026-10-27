import type { ColumnDef } from "@tanstack/react-table";
import { Download, History } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LEDGER_EVENT_LABELS, MONEY_CATEGORY_LABELS, type LedgerRow } from "@kkt/contracts";
import { Badge, Button, DataTable, ErrorState, Select, SimpleDialog } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatINR, formatINRShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BOOKINGS_PATH, LEDGER_PAGE_SIZE, useBookingLedger, useLedgerRebuilds } from "../api";
import {
  LEDGER_AMOUNT_CLASS,
  LEDGER_REBUILD_REASON_LABELS,
  ledgerAmountTone,
  ledgerCategory,
  ledgerFooterTotals,
  type LedgerFooterTotals,
} from "../bookingMath";
import { DueAmount } from "../components";

const EVENT_VARIANT: Readonly<
  Record<LedgerRow["event"], "navy" | "success" | "danger" | "warning" | "info" | "gold" | "neutral">
> = {
  DEMAND: "navy",
  PAYMENT: "success",
  REVERSAL: "danger",
  AGREEMENT_CHANGE: "warning",
  PLAN_CHANGE: "warning",
  OTHER_CHARGE_DEMAND: "gold",
  OTHER_CHARGE_PAYMENT: "success",
  OTHER_CHARGE_REVERSAL: "danger",
  CANCELLATION: "danger",
  DEMAND_VOIDED: "neutral",
  LEDGER_RESTATED: "info",
};

function CategoryChip({ row }: { row: LedgerRow }) {
  const category = ledgerCategory(row);
  if (!category) return <span className="text-ink-subtle">—</span>;
  return (
    <Badge variant={category === "CASH" ? "navy" : category === "ACCOUNT" ? "info" : "gold"}>
      {MONEY_CATEGORY_LABELS[category]}
    </Badge>
  );
}

function RefLink({ row }: { row: LedgerRow }) {
  if (!row.ref_number) return <span className="text-ink-subtle">—</span>;
  const isPayment =
    row.event === "PAYMENT" ||
    row.event === "REVERSAL" ||
    row.event === "OTHER_CHARGE_PAYMENT" ||
    row.event === "OTHER_CHARGE_REVERSAL";
  if (isPayment && row.ref_id) {
    return (
      <Link
        to={`/print/receipt/${row.ref_id}`}
        target="_blank"
        rel="noopener"
        className="money text-navy-800 underline underline-offset-2 hover:text-navy-950 focus-ring rounded-xs"
        onClick={(event) => event.stopPropagation()}
      >
        {row.ref_number}
      </Link>
    );
  }
  if ((row.event === "DEMAND" || row.event === "OTHER_CHARGE_DEMAND") && row.ref_id) {
    return (
      <Link
        to={`/print/demand/${row.booking_id}/${row.ref_id}`}
        target="_blank"
        rel="noopener"
        className="money text-navy-800 underline underline-offset-2 hover:text-navy-950 focus-ring rounded-xs"
        onClick={(event) => event.stopPropagation()}
      >
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
          <p className={cn("money text-base font-bold", LEDGER_AMOUNT_CLASS[tone])}>
            {formatINR(row.amount_paise, { signed: tone === "credit" })}
          </p>
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
        Paid cum. cash {formatINRShort(row.cash_paid_cum_paise)} · account {formatINRShort(row.account_paid_cum_paise)}{" "}
        · raised cash {formatINRShort(row.cash_order_raised_paise)} · account{" "}
        {formatINRShort(row.account_order_raised_paise)}
        {row.ref_number ? (
          <>
            {" "}
            · <RefLink row={row} />
          </>
        ) : null}
      </p>
    </div>
  );
}

/** Restatements of the ledger (GET /bookings/:id/ledger/rebuilds): from → to epoch, reason, who, when and the totals moved. */
function RebuildHistoryDialog({
  bookingId,
  open,
  onOpenChange,
  onViewEpoch,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewEpoch: (epoch: number) => void;
}) {
  const rebuilds = useLedgerRebuilds(bookingId, { enabled: open });
  const rows = rebuilds.data?.items ?? [];
  return (
    <SimpleDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Ledger rebuild history"
      description="The ledger is append-only: a restatement writes a new epoch and keeps the old one readable."
    >
      {rebuilds.isPending ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rebuilds.error ? (
        <ErrorState error={rebuilds.error} onRetry={() => void rebuilds.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="ledger-rebuilds-empty">
          This ledger has never been restated.
        </p>
      ) : (
        <ol className="space-y-3" data-testid="ledger-rebuilds">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-navy-950">
                  Epoch {row.from_epoch} → {row.to_epoch} · {LEDGER_REBUILD_REASON_LABELS[row.reason]}
                </p>
                <p className="text-xs text-ink-muted">
                  {formatDateTime(row.at)} · {row.actor?.name ?? "System"}
                </p>
              </div>
              <p className="money mt-1 text-xs text-ink-muted">
                Rows {row.summary.rows_before} → {row.summary.rows_after} · total due{" "}
                {formatINR(row.summary.before.total_due_paise)} → {formatINR(row.summary.after.total_due_paise)}
                {row.summary.differences.length > 0 ? ` · ${row.summary.differences.length} row difference(s)` : ""}
              </p>
              <Button
                size="xs"
                variant="link"
                className="mt-1 px-0"
                onClick={() => {
                  onViewEpoch(row.from_epoch);
                  onOpenChange(false);
                }}
              >
                View epoch {row.from_epoch}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </SimpleDialog>
  );
}

/** Totals under the ledger, from the server's C7 summary (or the epoch's own totals for an older epoch). */
function LedgerTotalsBar({ totals }: { totals: LedgerFooterTotals }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted" data-testid="ledger-totals">
      {totals.source === "epoch" && <span className="font-semibold text-warning-fg">End of epoch {totals.epoch}:</span>}
      <span>
        Cash due <DueAmount paise={totals.cash_due_paise} />
      </span>
      <span>
        Account due <DueAmount paise={totals.account_due_paise} />
      </span>
      <span>
        Total due <DueAmount paise={totals.total_due_paise} />
      </span>
      <span>
        Other charges due <DueAmount paise={totals.other_charges_due_paise} />
      </span>
      <span className="money">
        Paid cash {formatINR(totals.cash_paid_paise)} · account {formatINR(totals.account_paid_paise)}
      </span>
    </div>
  );
}

/**
 * SPEC §11 ledger table: one row per event with running balances; advances green, dues red. Pages through every row of the
 * chosen epoch (contract C7); the dues under the table come from the server summary, never from the last row on screen.
 */
export function LedgerTab({ bookingId }: { bookingId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LEDGER_PAGE_SIZE);
  const [epoch, setEpoch] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const ledger = useBookingLedger(bookingId, { page, page_size: pageSize, epoch });
  const [exporting, setExporting] = useState(false);
  const data = ledger.data;
  const rows = data?.items ?? [];
  const currentEpoch = data?.current_epoch ?? 1;
  const shownEpoch = data?.epoch ?? epoch ?? currentEpoch;
  const totals = data ? ledgerFooterTotals(data) : null;

  const viewEpoch = (next: number | null) => {
    setEpoch(next === null || next === currentEpoch ? null : next);
    setPage(1);
  };

  const columns = useMemo<ColumnDef<LedgerRow, unknown>[]>(
    () => [
      {
        accessorKey: "entry_date",
        header: "Date",
        meta: { locked: true, width: 110, sortKey: false },
        cell: ({ row }) => (
          <span className="money leading-tight">
            <span className="block">{formatDate(row.original.entry_date)}</span>
            <span className="block text-2xs text-ink-subtle">#{row.original.seq}</span>
          </span>
        ),
      },
      {
        accessorKey: "event",
        header: "Event",
        meta: { width: 150, sortKey: false },
        cell: ({ row }) => (
          <Badge variant={EVENT_VARIANT[row.original.event]}>{LEDGER_EVENT_LABELS[row.original.event]}</Badge>
        ),
      },
      {
        accessorKey: "label",
        header: "Stage / installment",
        meta: { sortKey: false },
        cell: ({ row }) => (
          <span className="block truncate leading-tight">
            <span className="block">{row.original.label ?? "—"}</span>
            {row.original.note && <span className="block truncate text-2xs text-ink-subtle">{row.original.note}</span>}
          </span>
        ),
      },
      {
        id: "category",
        header: "Category",
        meta: { width: 110, sortKey: false },
        cell: ({ row }) => <CategoryChip row={row.original} />,
      },
      {
        accessorKey: "amount_paise",
        header: "Amount",
        meta: { align: "right", width: 130, sortKey: false },
        cell: ({ row }) => (
          <span className={cn("money font-semibold", LEDGER_AMOUNT_CLASS[ledgerAmountTone(row.original)])}>
            {formatINR(row.original.amount_paise, { signed: ledgerAmountTone(row.original) === "credit" })}
          </span>
        ),
      },
      {
        accessorKey: "cash_paid_cum_paise",
        header: "Cash paid (cum.)",
        meta: { align: "right", width: 130, sortKey: false, label: "Cash paid" },
        cell: ({ row }) => <span className="money">{formatINR(row.original.cash_paid_cum_paise)}</span>,
      },
      {
        accessorKey: "account_paid_cum_paise",
        header: "Account paid (cum.)",
        meta: { align: "right", width: 140, sortKey: false, label: "Account paid" },
        cell: ({ row }) => <span className="money">{formatINR(row.original.account_paid_cum_paise)}</span>,
      },
      {
        accessorKey: "cash_order_raised_paise",
        header: "Cash raised",
        meta: { align: "right", width: 130, sortKey: false },
        cell: ({ row }) => (
          <span className="money text-ink-muted">{formatINR(row.original.cash_order_raised_paise)}</span>
        ),
      },
      {
        accessorKey: "account_order_raised_paise",
        header: "Account raised",
        meta: { align: "right", width: 140, sortKey: false },
        cell: ({ row }) => (
          <span className="money text-ink-muted">{formatINR(row.original.account_order_raised_paise)}</span>
        ),
      },
      {
        accessorKey: "cash_due_paise",
        header: "Cash due",
        meta: { align: "right", width: 150, sortKey: false },
        cell: ({ row }) => <DueAmount paise={row.original.cash_due_paise} />,
      },
      {
        accessorKey: "account_due_paise",
        header: "Account due",
        meta: { align: "right", width: 150, sortKey: false },
        cell: ({ row }) => <DueAmount paise={row.original.account_due_paise} />,
      },
      {
        accessorKey: "total_due_paise",
        header: "Total due",
        meta: { align: "right", width: 150, sortKey: false },
        cell: ({ row }) => <DueAmount paise={row.original.total_due_paise} className="text-sm" />,
      },
      {
        accessorKey: "ref_number",
        header: "Ref",
        meta: { width: 150, sortKey: false },
        cell: ({ row }) => <RefLink row={row.original} />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-3" data-testid="ledger-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          One row per event with running balances. <span className="font-semibold text-success-fg">Green</span> =
          advance (paid beyond what is raised), <span className="font-semibold text-danger-fg">red</span> = due.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted" data-testid="ledger-epoch">
            Epoch {shownEpoch}
            {shownEpoch === currentEpoch ? " (current)" : ` of ${currentEpoch} (superseded)`}
          </span>
          {currentEpoch > 1 && (
            <Select
              aria-label="Ledger epoch"
              size="sm"
              className="w-36"
              value={String(shownEpoch)}
              onValueChange={(value) => value && viewEpoch(Number(value))}
              options={Array.from({ length: currentEpoch }, (_, index) => currentEpoch - index).map((value) => ({
                value: String(value),
                label: value === currentEpoch ? `Epoch ${value} (current)` : `Epoch ${value}`,
              }))}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            leftIcon={History}
            onClick={() => setHistoryOpen(true)}
            data-testid="ledger-rebuilds-open"
          >
            Rebuild history
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={Download}
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await api.exportCsv(
                  `${BOOKINGS_PATH}/${bookingId}/ledger`,
                  { sort: "seq", filters: { epoch: epoch ?? undefined } },
                  "ledger.csv",
                );
              } finally {
                setExporting(false);
              }
            }}
            data-testid="ledger-csv"
          >
            CSV
          </Button>
        </div>
      </div>
      {shownEpoch !== currentEpoch && (
        <p className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
          You are viewing superseded epoch {shownEpoch}. The book of record is epoch {currentEpoch}.{" "}
          <button type="button" className="font-semibold underline" onClick={() => viewEpoch(null)}>
            Back to the current ledger
          </button>
        </p>
      )}
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
        pagination={
          data && data.total > 0
            ? {
                page,
                pageSize,
                total: data.total,
                onPageChange: setPage,
                onPageSizeChange: (size) => {
                  setPageSize(size);
                  setPage(1);
                },
              }
            : undefined
        }
        footer={totals ? <LedgerTotalsBar totals={totals} /> : undefined}
        data-testid="ledger-table"
      />
      <RebuildHistoryDialog
        bookingId={bookingId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onViewEpoch={(value) => viewEpoch(value)}
      />
    </div>
  );
}
