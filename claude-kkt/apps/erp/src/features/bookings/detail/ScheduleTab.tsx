import { SCHEDULE_STATUS_LABELS, type ScheduleRow } from "@kkt/contracts";
import { EmptyState, ErrorState, Skeleton, StatusChip } from "@/components/ui";
import { formatDate, formatINR, formatINRShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBookingSchedule } from "../api";

function rowTint(status: ScheduleRow["status"]): string {
  switch (status) {
    case "OVERDUE":
      return "bg-danger-bg/50";
    case "PAID":
      return "bg-success-bg/40";
    case "PARTIALLY_PAID":
      return "bg-info-bg/40";
    case "RAISED":
      return "bg-warning-bg/40";
    case "NOT_YET_DUE":
      return "";
  }
}

function ProgressBar({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-navy-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label="Paid"
    >
      <span
        className={cn("block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-navy-950")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Installment rows with status chips, expected / raised / due dates, per-bucket amounts and paid progress. */
export function ScheduleTab({ bookingId, initial }: { bookingId: string; initial?: ScheduleRow[] }) {
  const schedule = useBookingSchedule(bookingId);
  const rows = schedule.data?.rows ?? initial ?? [];
  const totalPaid = rows.reduce((sum, row) => sum + row.paid_paise, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.total_paise, 0);

  if (schedule.isPending && !initial) return <Skeleton className="h-64" />;
  if (schedule.isError && !initial)
    return <ErrorState compact error={schedule.error} onRetry={() => void schedule.refetch()} />;
  if (rows.length === 0)
    return <EmptyState compact title="No installments" description="The plan snapshot has no installments." />;

  return (
    <div className="space-y-3" data-testid="schedule-tab">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-ink-muted">
            Paid <span className="money font-semibold text-success-fg">{formatINR(totalPaid)}</span> of{" "}
            <span className="money font-semibold text-navy-950">{formatINR(totalAmount)}</span>
          </span>
          <span className="money text-xs text-ink-subtle">
            {formatPercent(totalAmount > 0 ? (totalPaid / totalAmount) * 100 : 0, 1)} of the schedule
          </span>
        </div>
        <div className="mt-2">
          <ProgressBar paid={totalPaid} total={totalAmount} />
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-2xs uppercase tracking-wider text-ink-subtle">
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Installment</th>
              <th className="px-3 py-2 font-semibold">Trigger</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Expected</th>
              <th className="px-3 py-2 font-semibold">Raised</th>
              <th className="px-3 py-2 font-semibold">Due</th>
              <th className="money px-3 py-2 text-right font-semibold">%</th>
              <th className="money px-3 py-2 text-right font-semibold">Cash</th>
              <th className="money px-3 py-2 text-right font-semibold">Account</th>
              <th className="money px-3 py-2 text-right font-semibold">Total</th>
              <th className="money px-3 py-2 text-right font-semibold">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.seq}
                className={cn("border-b border-border last:border-0", rowTint(row.status))}
                data-testid={`schedule-row-${row.seq}`}
              >
                <td className="money px-3 py-2 text-ink-subtle">{row.seq}</td>
                <td className="px-3 py-2">
                  <span className="block font-medium">{row.name}</span>
                  {row.demand_number && (
                    <span className="money block text-2xs text-ink-subtle">{row.demand_number}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-muted">{row.trigger_label}</td>
                <td className="px-3 py-2">
                  <StatusChip status={row.status} label={SCHEDULE_STATUS_LABELS[row.status]} />
                </td>
                <td className="money px-3 py-2">
                  {row.expected_date ? (
                    formatDate(row.expected_date)
                  ) : (
                    <span className="text-ink-subtle">on stage</span>
                  )}
                </td>
                <td className="money px-3 py-2">{row.demand_date ? formatDate(row.demand_date) : "—"}</td>
                <td className={cn("money px-3 py-2", row.status === "OVERDUE" && "font-semibold text-danger-fg")}>
                  {row.due_date ? formatDate(row.due_date) : "—"}
                </td>
                <td className="money px-3 py-2 text-right">
                  {formatPercent(row.percent)}
                  <span className="block text-2xs text-ink-subtle">cum. {formatPercent(row.cumulative_percent)}</span>
                </td>
                <td className="money px-3 py-2 text-right">{formatINR(row.cash_paise)}</td>
                <td className="money px-3 py-2 text-right">{formatINR(row.account_paise)}</td>
                <td className="money px-3 py-2 text-right font-semibold text-navy-950">{formatINR(row.total_paise)}</td>
                <td className="px-3 py-2 text-right">
                  <span className="money block text-success-fg">{formatINR(row.paid_paise)}</span>
                  <ProgressBar paid={row.paid_paise} total={row.total_paise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.seq} className={cn("rounded-md border border-border bg-card p-3", rowTint(row.status))}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">
                <span className="money text-ink-subtle">{row.seq}.</span> {row.name}
              </p>
              <StatusChip status={row.status} label={SCHEDULE_STATUS_LABELS[row.status]} size="sm" />
            </div>
            <p className="text-xs text-ink-muted">
              {row.trigger_label} · {formatPercent(row.percent)} ·{" "}
              {row.expected_date ? `expected ${formatDate(row.expected_date)}` : "on stage"}
              {row.due_date ? ` · due ${formatDate(row.due_date)}` : ""}
            </p>
            <p className="money mt-1 text-xs">
              Cash {formatINRShort(row.cash_paise)} · Account {formatINRShort(row.account_paise)} ·{" "}
              <span className="font-semibold text-navy-950">{formatINRShort(row.total_paise)}</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar paid={row.paid_paise} total={row.total_paise} />
              <span className="money shrink-0 text-2xs text-success-fg">{formatINRShort(row.paid_paise)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
