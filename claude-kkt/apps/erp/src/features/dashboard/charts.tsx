/**
 * Recharts widgets, loaded lazily so the charts vendor chunk only ships on the dashboard.
 * Palette and mark specs follow the dataviz method: fixed categorical order, ordinal ramp
 * for ordered buckets, status colours for inventory, thin marks, hairline grid, hover layer,
 * legend + table view for every multi-series chart.
 */
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AGEING_BUCKET_LABELS, AGEING_BUCKETS, LEAD_STAGE_LABELS, type AgeingAmounts, type LeadStage } from "@kkt/contracts";
import { formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { CHART_INK, ORDINAL_RAMP, SERIES_COLORS, STATUS_COLORS } from "./api";
import { ChartLegend, monthLabel } from "./widgets";

const AXIS_TICK = { fontSize: 11, fill: CHART_INK.axis } as const;
const TOOLTIP_STYLE = { borderRadius: 8, border: "1px solid #e5e9f0", boxShadow: "0 10px 30px -10px rgb(11 31 58 / 0.25)", fontSize: 12, padding: "8px 10px" } as const;

function money(value: unknown): string {
  return formatINR(typeof value === "number" ? value : Number(value));
}

/* ------------------------------------------------------------------ */
/* Collections 12 months by bucket                                      */
/* ------------------------------------------------------------------ */

export interface MonthBucket {
  month: string;
  cash_paise: number;
  account_paise: number;
  other_paise: number;
  total_paise: number;
}

export function CollectionsStackedBars({ rows }: { rows: readonly MonthBucket[] }) {
  const data = rows.map((row) => ({ ...row, label: monthLabel(row.month) }));
  return (
    <div data-testid="chart-collections">
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeWidth={1} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} interval="preserveStartEnd" />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => formatINRShort(value, { bare: true })} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [money(value), String(name)]} labelFormatter={(label) => String(label)} />
            <Bar dataKey="cash_paise" name="Cash" stackId="a" fill={SERIES_COLORS.cash} stroke="#ffffff" strokeWidth={2} maxBarSize={24} />
            <Bar dataKey="account_paise" name="Account" stackId="a" fill={SERIES_COLORS.account} stroke="#ffffff" strokeWidth={2} maxBarSize={24} />
            <Bar dataKey="other_paise" name="Other charges" stackId="a" fill={SERIES_COLORS.other} stroke="#ffffff" strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: "Cash", color: SERIES_COLORS.cash }, { label: "Account", color: SERIES_COLORS.account }, { label: "Other charges", color: SERIES_COLORS.other }]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ageing donut (ordinal ramp)                                          */
/* ------------------------------------------------------------------ */

export function AgeingDonut({ ageing }: { ageing: AgeingAmounts }) {
  const data = AGEING_BUCKETS.map((bucket, index) => ({ key: bucket, name: AGEING_BUCKET_LABELS[bucket], value: ageing[bucket], color: ORDINAL_RAMP[index] ?? ORDINAL_RAMP[ORDINAL_RAMP.length - 1] }));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const overdue = total - ageing.NOT_DUE;
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="chart-ageing">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="#ffffff" strokeWidth={2} startAngle={90} endAngle={-270}>
              {data.map((item) => (
                <Cell key={item.key} fill={item.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [money(value), String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="label-caps">Overdue</span>
          <span className="money font-display text-base font-extrabold text-navy-950">{formatINRShort(overdue)}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {data.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span className="size-2.5 rounded-xs" style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.name}
            </span>
            <span className="money font-semibold text-ink">{formatINRShort(item.value)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2 border-t border-border pt-1 font-semibold text-navy-950">
          <span>Total outstanding</span>
          <span className="money">{formatINRShort(total)}</span>
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inventory by project (status stacks)                                  */
/* ------------------------------------------------------------------ */

export interface ProjectInventory {
  project_id: string;
  project_name: string;
  available: number;
  hold: number;
  blocked: number;
  booked: number;
  sold: number;
  total: number;
}

export function InventoryStackedBars({ rows }: { rows: readonly ProjectInventory[] }) {
  return (
    <div data-testid="chart-inventory">
      <div className="w-full min-w-0" style={{ height: Math.max(160, rows.length * 36 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke={CHART_INK.grid} strokeWidth={1} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} allowDecimals={false} />
            <YAxis type="category" dataKey="project_name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={110} />
            <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [formatNumber(typeof value === "number" ? value : Number(value)), String(name)]} />
            <Bar dataKey="available" name="Available" stackId="s" fill={STATUS_COLORS.available} stroke="#ffffff" strokeWidth={2} maxBarSize={22} />
            <Bar dataKey="hold" name="Hold" stackId="s" fill={STATUS_COLORS.hold} stroke="#ffffff" strokeWidth={2} maxBarSize={22} />
            <Bar dataKey="booked" name="Booked" stackId="s" fill={STATUS_COLORS.booked} stroke="#ffffff" strokeWidth={2} maxBarSize={22} />
            <Bar dataKey="sold" name="Sold" stackId="s" fill={STATUS_COLORS.sold} stroke="#ffffff" strokeWidth={2} maxBarSize={22} />
            <Bar dataKey="blocked" name="Blocked" stackId="s" fill={STATUS_COLORS.blocked} stroke="#ffffff" strokeWidth={2} maxBarSize={22} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={[
          { label: "Available", color: STATUS_COLORS.available },
          { label: "Hold", color: STATUS_COLORS.hold },
          { label: "Booked", color: STATUS_COLORS.booked },
          { label: "Sold", color: STATUS_COLORS.sold },
          { label: "Blocked", color: STATUS_COLORS.blocked },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sales velocity line                                                  */
/* ------------------------------------------------------------------ */

export function VelocityLine({ rows }: { rows: ReadonlyArray<{ month: string; bookings: number; value_paise: number }> }) {
  const data = rows.map((row) => ({ ...row, label: monthLabel(row.month) }));
  return (
    <div className="h-48 w-full min-w-0" data-testid="chart-velocity">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeWidth={1} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} interval="preserveStartEnd" />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name, item) => [`${formatNumber(typeof value === "number" ? value : Number(value))} · ${formatINRShort(typeof item.payload === "object" && item.payload !== null && typeof (item.payload as { value_paise?: unknown }).value_paise === "number" ? (item.payload as { value_paise: number }).value_paise : 0)}`, String(name)]} />
          <Line type="monotone" dataKey="bookings" name="Bookings" stroke={SERIES_COLORS.cash} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: SERIES_COLORS.cash }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pipeline funnel (ordinal horizontal bars)                             */
/* ------------------------------------------------------------------ */

export function PipelineFunnel({ rows }: { rows: ReadonlyArray<{ stage: LeadStage; count: number }> }) {
  const data = rows.map((row, index) => ({ stage: row.stage, name: LEAD_STAGE_LABELS[row.stage], count: row.count, color: ORDINAL_RAMP[Math.min(index, ORDINAL_RAMP.length - 1)] ?? ORDINAL_RAMP[0] }));
  return (
    <div className="w-full min-w-0" style={{ height: Math.max(160, data.length * 32 + 24) }} data-testid="chart-funnel">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, left: 0, bottom: 0 }} barCategoryGap="28%">
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={130} />
          <Tooltip cursor={{ fill: "#f0f4fa" }} contentStyle={TOOLTIP_STYLE} formatter={(value) => [formatNumber(typeof value === "number" ? value : Number(value)), "Leads"]} />
          <Bar dataKey="count" name="Leads" maxBarSize={20} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: CHART_INK.text }}>
            {data.map((item) => (
              <Cell key={item.stage} fill={item.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
