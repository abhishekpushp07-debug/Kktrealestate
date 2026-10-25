import type { ColumnDef } from "@tanstack/react-table";
import { BarChart3, Table2 } from "lucide-react";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardContent, CardHeader, CardTitle, DataTable, Skeleton, StatCard, type DataTablePagination } from "@/components/ui";
import { formatINR, formatINRShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Typed, footer-aware table                                            */
/* ------------------------------------------------------------------ */

export interface ReportColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Sticky totals footer cell. */
  footer?: ReactNode;
  align?: "right" | "center";
  width?: number | string;
  hideOnMobile?: boolean;
}

export interface ReportTableProps<Row> {
  columns: readonly ReportColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row, index: number) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  pagination?: DataTablePagination;
  density?: "normal" | "compact";
  maxHeight?: string;
  rowClassName?: (row: Row) => string | undefined;
  className?: string;
}

/** DataTable with a sticky totals footer; sorting is off (reports come back fully computed). */
export function ReportTable<Row>({ columns, rows, getRowId, loading = false, emptyTitle = "No rows for these filters", emptyDescription, pagination, density = "compact", maxHeight = "32rem", rowClassName, className }: ReportTableProps<Row>) {
  const defs = useMemo<ColumnDef<Row, unknown>[]>(
    () =>
      columns.map((column, index) => ({
        id: column.id,
        header: column.header,
        cell: ({ row }) => column.cell(row.original),
        footer: column.footer === undefined ? undefined : () => column.footer,
        meta: { align: column.align, width: column.width, sortKey: false, hideOnMobile: column.hideOnMobile, locked: index === 0 },
      })),
    [columns],
  );
  return <DataTable columns={defs} data={rows} getRowId={getRowId} loading={loading} density={density} maxHeight={maxHeight} pagination={pagination} rowClassName={rowClassName} emptyState={{ title: emptyTitle, description: emptyDescription }} className={className} />;
}

/* ------------------------------------------------------------------ */
/* Section card with chart ↔ table toggle                               */
/* ------------------------------------------------------------------ */

export interface ReportSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Lazy chart; when present the section offers a chart ↔ table toggle. */
  chart?: ReactNode;
  defaultView?: "chart" | "table";
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function ReportSection({ title, description, chart, defaultView = "chart", actions, children, className, ...rest }: ReportSectionProps) {
  const [view, setView] = useState<"chart" | "table">(chart ? defaultView : "table");
  return (
    <Card className={cn("min-w-0", className)} data-testid={rest["data-testid"]}>
      <CardHeader
        actions={
          <>
            {actions}
            {chart && (
              <div className="flex items-center rounded-md bg-navy-50 p-0.5" role="tablist" aria-label="View">
                <Button size="xs" variant={view === "chart" ? "primary" : "ghost"} leftIcon={BarChart3} onClick={() => setView("chart")} aria-pressed={view === "chart"} className="h-7">
                  Chart
                </Button>
                <Button size="xs" variant={view === "table" ? "primary" : "ghost"} leftIcon={Table2} onClick={() => setView("table")} aria-pressed={view === "table"} className="h-7">
                  Table
                </Button>
              </div>
            )}
          </>
        }
      >
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <p className="text-xs text-ink-subtle">{description}</p>}
      </CardHeader>
      <CardContent className={cn("min-w-0", view === "table" ? "p-0" : "p-3 sm:p-4")}>{view === "chart" && chart ? <Suspense fallback={<Skeleton className="h-64" />}>{chart}</Suspense> : children}</CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stat grid                                                            */
/* ------------------------------------------------------------------ */

export interface StatItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "navy" | "gold";
}

export function StatGrid({ items, loading = false }: { items: readonly StatItem[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="report-stats">
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} hint={item.hint} tone={item.tone} loading={loading} className="p-3" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cells                                                                */
/* ------------------------------------------------------------------ */

export function Money({ paise, short = false, signed = false, className }: { paise: number | null | undefined; short?: boolean; signed?: boolean; className?: string }) {
  const negative = (paise ?? 0) < 0;
  return <span className={cn("money", negative && "text-success-fg", className)}>{short ? formatINRShort(paise) : formatINR(paise, { signed })}</span>;
}

/** Due figures: positive = due (red), negative = advance (green). */
export function Due({ paise }: { paise: number }) {
  if (paise === 0) return <span className="money text-ink-subtle">₹0</span>;
  return (
    <span className={cn("money font-semibold", paise > 0 ? "text-danger-fg" : "text-success-fg")}>
      {formatINR(Math.abs(paise))}
      {paise < 0 && <span className="ml-1 text-2xs font-medium">(adv)</span>}
    </span>
  );
}

export function BookingRef({ id, number }: { id: string | null; number: string }) {
  if (!id) return <span className="money">{number}</span>;
  return (
    <Link to={`/bookings/${id}`} className="money font-semibold text-navy-800 hover:text-navy-950 hover:underline focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
      {number}
    </Link>
  );
}

export function TwoLine({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate">{primary}</span>
      {secondary && <span className="block truncate text-2xs text-ink-subtle">{secondary}</span>}
    </span>
  );
}

export function Pct({ value }: { value: number }) {
  return <span className="money">{Number.isFinite(value) ? `${value.toFixed(value % 1 === 0 ? 0 : 1)}%` : "—"}</span>;
}
