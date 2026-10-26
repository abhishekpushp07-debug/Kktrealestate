import { Table2, type LucideIcon } from "lucide-react";
import { Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@/components/ui";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Widget frame                                                         */
/* ------------------------------------------------------------------ */

export interface WidgetProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Link to the full page ("View all"). */
  to?: string;
  toLabel?: string;
  actions?: ReactNode;
  /** Accessible table view of the chart's data (relief for sub-3:1 fills; also the screen-reader path). */
  table?: ReactNode;
  loading?: boolean;
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}

/** Dashboard card: title, optional link, optional chart ↔ table toggle, Suspense for lazy charts. */
export function Widget({ title, description, icon: Icon, to, toLabel = "View all", actions, table, loading = false, className, children, ...rest }: WidgetProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn("flex min-w-0 flex-col", className)} data-testid={rest["data-testid"]}>
      <CardHeader
        actions={
          <>
            {actions}
            {table && (
              <Button size="xs" variant={showTable ? "primary" : "ghost"} leftIcon={Table2} onClick={() => setShowTable((value) => !value)} aria-pressed={showTable}>
                Table
              </Button>
            )}
            {to && (
              <Button asChild size="xs" variant="link">
                <Link to={to}>{toLabel}</Link>
              </Button>
            )}
          </>
        }
      >
        <CardTitle className="flex items-center gap-2 text-sm">
          {Icon && <Icon className="size-4 text-gold-text" aria-hidden="true" />}
          {title}
        </CardTitle>
        {description && <p className="text-xs text-ink-subtle">{description}</p>}
      </CardHeader>
      <CardContent className="min-w-0 flex-1 p-3 sm:p-4">
        {loading ? (
          <Skeleton className="h-48" />
        ) : showTable && table ? (
          <div className="overflow-x-auto">{table}</div>
        ) : (
          <Suspense fallback={<Skeleton className="h-48" />}>{children}</Suspense>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Small data pieces                                                    */
/* ------------------------------------------------------------------ */

export interface MiniColumn<T> {
  key: string;
  label: string;
  align?: "right";
  cell: (row: T) => ReactNode;
}

/** Compact table used by widgets (also the chart table-view). */
export function MiniTable<T>({ rows, columns, rowKey, empty = "Nothing to show", footer, dense = false }: { rows: readonly T[]; columns: ReadonlyArray<MiniColumn<T>>; rowKey: (row: T, index: number) => string; empty?: string; footer?: ReactNode; dense?: boolean }) {
  if (rows.length === 0) return <EmptyState compact title={empty} className="py-6" />;
  return (
    <div className="min-w-0 overflow-x-auto">
    <table className={cn("w-full min-w-[18rem] text-sm", dense && "text-xs")}>
      <thead>
        <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-ink-subtle">
          {columns.map((column) => (
            <th key={column.key} className={cn("px-2 py-1.5 font-semibold", column.align === "right" && "text-right")}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)} className="border-b border-border last:border-0">
            {columns.map((column) => (
              <td key={column.key} className={cn("px-2 py-1.5", dense ? "py-1" : "py-1.5", column.align === "right" && "money text-right")}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
    </div>
  );
}

/** Label + percent bar (construction progress, tower availability). */
export function ProgressRow({ label, sublabel, percent, trailing, tone = "navy" }: { label: ReactNode; sublabel?: ReactNode; percent: number; trailing?: ReactNode; tone?: "navy" | "gold" | "success" }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-ink">{label}</span>
        <span className="money shrink-0 text-xs text-ink-muted">{trailing ?? formatPercent(pct, 0)}</span>
      </div>
      {sublabel && <p className="truncate text-2xs text-ink-subtle">{sublabel}</p>}
      <div className="h-1.5 overflow-hidden rounded-full bg-navy-50" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={typeof label === "string" ? label : "Progress"}>
        <span className={cn("block h-full rounded-full", tone === "navy" && "bg-navy-950", tone === "gold" && "bg-gold", tone === "success" && "bg-success")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Horizontal stacked status bar with a legend (available / hold / booked / sold / blocked). */
export function StatusStack({ counts, colors }: { counts: ReadonlyArray<{ key: string; label: string; value: number }>; colors: Readonly<Record<string, string>> }) {
  const total = counts.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-navy-50" role="img" aria-label={counts.map((item) => `${item.label} ${item.value}`).join(", ")}>
        {counts.map((item) => (item.value > 0 ? <span key={item.key} style={{ width: `${(item.value / Math.max(1, total)) * 100}%`, backgroundColor: colors[item.key] }} /> : null))}
      </div>
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-muted">
        {counts.map((item) => (
          <div key={item.key} className="flex items-center gap-1">
            <span className="size-2 rounded-xs" style={{ backgroundColor: colors[item.key] }} aria-hidden="true" />
            <dt>{item.label}</dt>
            <dd className="money font-semibold text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Legend row for a chart (identity never by colour alone). */
export function ChartLegend({ items }: { items: ReadonlyArray<{ label: string; color: string }> }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs" style={{ backgroundColor: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** "Jan 26" from "2026-01". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const index = Number(m) - 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[index] ?? m} ${year?.slice(2) ?? ""}`.trim();
}
