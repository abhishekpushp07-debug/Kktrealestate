import type { SchedulePreviewResponse } from "@kkt/contracts";
import { Badge } from "@/components/ui";
import { formatDate, formatINR, formatINRShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DueAmount } from "../components";

export interface SchedulePreviewTableProps {
  preview: SchedulePreviewResponse;
  loading?: boolean;
  /** Phone layout threshold is handled by CSS; set to force the compact card list. */
  compact?: boolean;
}

/** Installment / trigger / expected date / cash / account / total, with the catch-up total. */
export function SchedulePreviewTable({ preview, loading = false, compact = false }: SchedulePreviewTableProps) {
  const satisfied = preview.rows.filter((row) => row.already_satisfied).length;
  return (
    <div className={cn("space-y-2", loading && "opacity-60")} data-testid="schedule-preview">
      <div className={cn("hidden overflow-x-auto rounded-lg border border-border bg-card md:block", compact && "md:hidden")}>
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-2xs uppercase tracking-wider text-ink-subtle">
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Installment</th>
              <th className="px-3 py-2 font-semibold">Trigger</th>
              <th className="px-3 py-2 font-semibold">Expected</th>
              <th className="money px-3 py-2 text-right font-semibold">%</th>
              <th className="money px-3 py-2 text-right font-semibold">Cash</th>
              <th className="money px-3 py-2 text-right font-semibold">Account</th>
              <th className="money px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.seq} className={cn("border-b border-border last:border-0", row.already_satisfied && "bg-gold-light/60")}>
                <td className="money px-3 py-2 text-ink-subtle">{row.seq}</td>
                <td className="px-3 py-2 font-medium">
                  {row.name}
                  {row.already_satisfied && (
                    <Badge variant="gold" className="ml-2">
                      Raised at booking
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-muted">{row.trigger_label}</td>
                <td className="money px-3 py-2">{row.expected_date ? formatDate(row.expected_date) : <span className="text-ink-subtle">on stage</span>}</td>
                <td className="money px-3 py-2 text-right">{formatPercent(row.percent)}</td>
                <td className="money px-3 py-2 text-right">{formatINR(row.cash_paise)}</td>
                <td className="money px-3 py-2 text-right">{formatINR(row.account_paise)}</td>
                <td className="money px-3 py-2 text-right font-semibold text-navy-950">{formatINR(row.total_paise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-navy-50 font-semibold text-navy-950">
              <td className="px-3 py-2" colSpan={5}>
                Total
              </td>
              <td className="money px-3 py-2 text-right">{formatINR(preview.totals.cash_paise)}</td>
              <td className="money px-3 py-2 text-right">{formatINR(preview.totals.account_paise)}</td>
              <td className="money px-3 py-2 text-right">{formatINR(preview.totals.total_paise)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone cards */}
      <ul className={cn("space-y-2", !compact && "md:hidden")}>
        {preview.rows.map((row) => (
          <li key={row.seq} className={cn("rounded-md border border-border bg-card p-3", row.already_satisfied && "border-gold-border bg-gold-light/60")}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">
                <span className="money text-ink-subtle">{row.seq}.</span> {row.name}
              </p>
              <span className="money text-sm font-bold text-navy-950">{formatINRShort(row.total_paise)}</span>
            </div>
            <p className="text-xs text-ink-muted">
              {row.trigger_label} · {row.expected_date ? formatDate(row.expected_date) : "on stage"} · {formatPercent(row.percent)}
            </p>
            <p className="money mt-1 text-xs">
              Cash {formatINRShort(row.cash_paise)} · Account {formatINRShort(row.account_paise)}
            </p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        {satisfied > 0 && (
          <span>
            <span className="money font-semibold text-gold-text">{satisfied}</span> installment{satisfied === 1 ? "" : "s"} already triggered — demanded on confirm
          </span>
        )}
        {preview.catch_up_paise !== 0 && (
          <span>
            Catch-up on booking: <DueAmount paise={preview.catch_up_paise} advanceLabel={false} />
          </span>
        )}
      </div>
    </div>
  );
}
