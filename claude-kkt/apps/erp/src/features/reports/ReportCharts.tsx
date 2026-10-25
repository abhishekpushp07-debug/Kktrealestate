/**
 * Recharts views for the report frame. Loaded lazily (one chunk with the dashboard charts) so the
 * reports catalogue and tables never wait on the charts vendor bundle.
 */
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AGEING_BUCKETS, AGEING_BUCKET_LABELS, LEAD_SOURCE_LABELS, type CollectionsReportRow, type DemandVsCollectionRow, type InventoryReportResponse, type LeadStage, type OutstandingReportRow, type SalesFunnelResponse } from "@kkt/contracts";
import { formatDate, formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { CHART_INK, ORDINAL_RAMP, SERIES_COLORS, STATUS_COLORS } from "@/features/dashboard/api";
import { InventoryStackedBars, PipelineFunnel } from "@/features/dashboard/charts";
import { ChartLegend, monthLabel } from "@/features/dashboard/widgets";

const AXIS_TICK = { fontSize: 11, fill: CHART_INK.axis } as const;
const TOOLTIP_STYLE = { borderRadius: 8, border: "1px solid #e5e9f0", boxShadow: "0 10px 30px -10px rgb(11 31 58 / 0.25)", fontSize: 12, padding: "8px 10px" } as const;

function money(value: unknown): string {
  return formatINR(typeof value === "number" ? value : Number(value));
}
function count(value: unknown): string {
  return formatNumber(typeof value === "number" ? value : Number(value));
}
function heightFor(rows: number, min = 180, per = 34): number {
  return Math.max(min, rows * per + 48);
}

/* ------------------------------------------------------------------ */
/* Collections stacked by bucket                                         */
/* ------------------------------------------------------------------ */

export function CollectionsChart({ rows, groupBy }: { rows: readonly CollectionsReportRow[]; groupBy: string }) {
  const data = rows.map((row) => ({ ...row, label: groupBy === "MONTH" ? monthLabel(row.period_start.slice(0, 7)) : groupBy === "WEEK" ? `wk ${formatDate(row.period_start, "dd MMM")}` : formatDate(row.period_start, "dd MMM") }));
  return (
    <div data-testid="chart-collections">
      <div className="h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} interval="preserveStartEnd" />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => formatINRShort(value, { bare: true })} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [money(value), String(name)]} />
            <Bar dataKey="cash_paise" name="Cash" stackId="a" fill={SERIES_COLORS.cash} stroke="#fff" strokeWidth={2} maxBarSize={28} />
            <Bar dataKey="account_paise" name="Account" stackId="a" fill={SERIES_COLORS.account} stroke="#fff" strokeWidth={2} maxBarSize={28} />
            <Bar dataKey="other_paise" name="Other charges" stackId="a" fill={SERIES_COLORS.other} stroke="#fff" strokeWidth={2} maxBarSize={28} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: "Cash", color: SERIES_COLORS.cash }, { label: "Account", color: SERIES_COLORS.account }, { label: "Other charges", color: SERIES_COLORS.other }]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ageing stacked bars per group                                         */
/* ------------------------------------------------------------------ */

export function AgeingChart({ rows }: { rows: readonly OutstandingReportRow[] }) {
  const data = rows.map((row) => ({ label: row.label, ...row.ageing }));
  return (
    <div data-testid="chart-ageing">
      <div className="w-full min-w-0" style={{ height: heightFor(rows.length) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} tickFormatter={(value: number) => formatINRShort(value, { bare: true })} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={120} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [money(value), String(name)]} />
            {AGEING_BUCKETS.map((bucket, index) => (
              <Bar key={bucket} dataKey={bucket} name={AGEING_BUCKET_LABELS[bucket]} stackId="a" fill={ORDINAL_RAMP[index] ?? ORDINAL_RAMP[4]} stroke="#fff" strokeWidth={2} maxBarSize={22} radius={index === AGEING_BUCKETS.length - 1 ? [0, 4, 4, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={AGEING_BUCKETS.map((bucket, index) => ({ label: AGEING_BUCKET_LABELS[bucket], color: ORDINAL_RAMP[index] ?? ORDINAL_RAMP[4] }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Demand vs collection grouped bars                                     */
/* ------------------------------------------------------------------ */

export function DemandVsCollectionChart({ rows }: { rows: readonly DemandVsCollectionRow[] }) {
  const data = rows.map((row) => ({ label: row.block_name ? `${row.label} · ${row.block_name}` : row.label, demanded_paise: row.demanded_paise, collected_paise: row.collected_paise }));
  return (
    <div data-testid="chart-demand-vs-collection">
      <div className="w-full min-w-0" style={{ height: heightFor(rows.length, 200, 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%" barGap={2}>
            <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} tickFormatter={(value: number) => formatINRShort(value, { bare: true })} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={150} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [money(value), String(name)]} />
            <Bar dataKey="demanded_paise" name="Demanded" fill={ORDINAL_RAMP[1]} maxBarSize={12} radius={[0, 3, 3, 0]} />
            <Bar dataKey="collected_paise" name="Collected" fill={SERIES_COLORS.other} maxBarSize={12} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: "Demanded", color: ORDINAL_RAMP[1] }, { label: "Collected", color: SERIES_COLORS.other }]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month buckets (upcoming dues) & velocity                              */
/* ------------------------------------------------------------------ */

export function MonthlyAmountChart({ rows }: { rows: ReadonlyArray<{ month: string; total_paise: number; count: number }> }) {
  const data = rows.map((row) => ({ ...row, label: monthLabel(row.month) }));
  return (
    <div className="h-60 w-full min-w-0" data-testid="chart-monthly">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="35%">
          <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => formatINRShort(value, { bare: true })} />
          <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name, item) => [`${money(value)} · ${count((item.payload as { count?: number }).count ?? 0)} installments`, String(name)]} />
          <Bar dataKey="total_paise" name="Expected" fill={SERIES_COLORS.cash} maxBarSize={32} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VelocityChart({ rows }: { rows: InventoryReportResponse["velocity"] }) {
  const data = rows.map((row) => ({ ...row, label: monthLabel(row.month) }));
  return (
    <div data-testid="chart-velocity">
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%" barGap={2}>
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [count(value), String(name)]} />
            <Bar dataKey="bookings" name="Bookings" fill={SERIES_COLORS.cash} maxBarSize={18} radius={[3, 3, 0, 0]} />
            <Bar dataKey="cancellations" name="Cancellations" fill="#ef4444" maxBarSize={18} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: "Bookings", color: SERIES_COLORS.cash }, { label: "Cancellations", color: "#ef4444" }]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inventory & funnel (re-use dashboard marks)                           */
/* ------------------------------------------------------------------ */

export function InventoryBlocksChart({ rows }: { rows: InventoryReportResponse["by_block"] }) {
  return <InventoryStackedBars rows={rows.map((row) => ({ project_id: row.block_id, project_name: row.label, available: row.available, hold: row.hold, blocked: row.blocked, booked: row.booked, sold: row.sold, total: row.total }))} />;
}

export function StageFunnelChart({ rows }: { rows: ReadonlyArray<{ stage: LeadStage; count: number }> }) {
  return <PipelineFunnel rows={rows} />;
}

export function SourceConversionChart({ rows }: { rows: SalesFunnelResponse["by_source"] }) {
  const data = rows.map((row) => ({ ...row, label: LEAD_SOURCE_LABELS[row.source] }));
  return (
    <div data-testid="chart-sources">
      <div className="w-full min-w-0" style={{ height: heightFor(rows.length, 180, 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }} barCategoryGap="25%" barGap={2}>
            <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={100} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [count(value), String(name)]} />
            <Bar dataKey="leads" name="Leads" fill={ORDINAL_RAMP[1]} maxBarSize={12} radius={[0, 3, 3, 0]} />
            <Bar dataKey="converted" name="Converted" fill={STATUS_COLORS.available} maxBarSize={12} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: "Leads", color: ORDINAL_RAMP[1] }, { label: "Converted", color: STATUS_COLORS.available }]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bank-wise receipts                                                    */
/* ------------------------------------------------------------------ */

export function BankwiseChart({ rows }: { rows: ReadonlyArray<{ bank_account_label: string; amount_paise: number; count: number }> }) {
  return (
    <div className="w-full min-w-0" style={{ height: heightFor(rows.length, 160, 32) }} data-testid="chart-bankwise">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, left: 0, bottom: 0 }} barCategoryGap="28%">
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="bank_account_label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={160} />
          <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name, item) => [`${money(value)} · ${count((item.payload as { count?: number }).count ?? 0)} receipts`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="amount_paise" name="Receipts" maxBarSize={20} radius={[0, 4, 4, 0]}>
            {rows.map((row, index) => (
              <Cell key={`${row.bank_account_label}-${index}`} fill={ORDINAL_RAMP[Math.min(index, ORDINAL_RAMP.length - 1)] ?? ORDINAL_RAMP[0]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
