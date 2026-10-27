import {
  BarChart3,
  Building2,
  CalendarClock,
  FileCheck2,
  HardHat,
  Inbox,
  IndianRupee,
  PieChart,
  ReceiptText,
  TrendingUp,
  Users,
} from "lucide-react";
import { lazy } from "react";
import { Link } from "react-router-dom";
import { AGEING_BUCKET_LABELS, AGEING_BUCKETS, type OwnerDashboardResponse } from "@kkt/contracts";
import { Badge, StatCard } from "@/components/ui";
import { formatDate, formatINR, formatINRShort, formatNumber, formatPercent } from "@/lib/format";
import { BookingLink } from "@/features/bookings/components";
import { ageingLabel } from "@/features/payments/paymentMath";
import { MiniTable, ProgressRow, Widget, monthLabel } from "./widgets";

const CollectionsStackedBars = lazy(() =>
  import("./charts").then((module) => ({ default: module.CollectionsStackedBars })),
);
const AgeingDonut = lazy(() => import("./charts").then((module) => ({ default: module.AgeingDonut })));
const InventoryStackedBars = lazy(() =>
  import("./charts").then((module) => ({ default: module.InventoryStackedBars })),
);
const VelocityLine = lazy(() => import("./charts").then((module) => ({ default: module.VelocityLine })));

/** Owner: collections trend, ageing, inventory, velocity, top overdue, cheques, enquiries, construction, dues raised, upcoming. */
export function OwnerDashboard({ data }: { data: OwnerDashboardResponse }) {
  const thisMonth = data.collections_12m[data.collections_12m.length - 1];
  const lastMonth = data.collections_12m[data.collections_12m.length - 2];
  const delta =
    thisMonth && lastMonth && lastMonth.total_paise > 0
      ? ((thisMonth.total_paise - lastMonth.total_paise) / lastMonth.total_paise) * 100
      : null;

  return (
    <div className="space-y-4" data-testid="owner-dashboard">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected this month"
          value={formatINRShort(data.totals.collected_this_month_paise)}
          icon={IndianRupee}
          tone="navy"
          delta={
            delta !== null
              ? {
                  value: `${formatPercent(Math.abs(delta), 1)}`,
                  direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
                  label: "vs last month",
                }
              : undefined
          }
        />
        <StatCard
          label="Total due"
          value={formatINRShort(data.totals.total_due_paise)}
          hint={`Advances ${formatINRShort(data.totals.total_advance_paise)}`}
          icon={ReceiptText}
        />
        <StatCard
          label="Active bookings"
          value={formatNumber(data.totals.active_bookings)}
          hint={`${formatNumber(data.enquiries_this_week)} enquiries this week`}
          icon={Users}
        />
        <StatCard
          label="Cheques in hand"
          value={formatINRShort(data.pending_cheques.amount_paise)}
          hint={`${formatNumber(data.pending_cheques.count)} pending`}
          icon={FileCheck2}
          tone="gold"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Widget
          title="Collections — last 12 months"
          description="Cleared receipts by bucket"
          icon={BarChart3}
          to="/reports"
          className="xl:col-span-2"
          table={
            <MiniTable
              rows={data.collections_12m}
              rowKey={(row) => row.month}
              dense
              columns={[
                { key: "month", label: "Month", cell: (row) => monthLabel(row.month) },
                { key: "cash", label: "Cash", align: "right", cell: (row) => formatINR(row.cash_paise) },
                { key: "account", label: "Account", align: "right", cell: (row) => formatINR(row.account_paise) },
                { key: "other", label: "Other", align: "right", cell: (row) => formatINR(row.other_paise) },
                {
                  key: "total",
                  label: "Total",
                  align: "right",
                  cell: (row) => <span className="font-semibold">{formatINR(row.total_paise)}</span>,
                },
              ]}
            />
          }
        >
          <CollectionsStackedBars rows={data.collections_12m} />
        </Widget>
        <Widget
          title="Due ageing"
          description="Outstanding by demand due date"
          icon={PieChart}
          to="/demands?overdue_only=true"
          table={
            <MiniTable
              rows={AGEING_BUCKETS.map((bucket) => ({ bucket, amount: data.due_ageing[bucket] }))}
              rowKey={(row) => row.bucket}
              dense
              columns={[
                { key: "bucket", label: "Bucket", cell: (row) => AGEING_BUCKET_LABELS[row.bucket] },
                { key: "amount", label: "Amount", align: "right", cell: (row) => formatINR(row.amount) },
              ]}
            />
          }
        >
          <AgeingDonut ageing={data.due_ageing} />
        </Widget>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Widget
          title="Inventory by project"
          icon={Building2}
          to="/flats"
          className="xl:col-span-2"
          table={
            <MiniTable
              rows={data.inventory_by_project}
              rowKey={(row) => row.project_id}
              dense
              columns={[
                { key: "project", label: "Project", cell: (row) => row.project_name },
                { key: "available", label: "Available", align: "right", cell: (row) => formatNumber(row.available) },
                { key: "hold", label: "Hold", align: "right", cell: (row) => formatNumber(row.hold) },
                { key: "booked", label: "Booked", align: "right", cell: (row) => formatNumber(row.booked) },
                { key: "sold", label: "Sold", align: "right", cell: (row) => formatNumber(row.sold) },
                {
                  key: "total",
                  label: "Total",
                  align: "right",
                  cell: (row) => <span className="font-semibold">{formatNumber(row.total)}</span>,
                },
              ]}
            />
          }
        >
          <InventoryStackedBars rows={data.inventory_by_project} />
        </Widget>
        <Widget
          title="Sales velocity"
          description="Bookings per month"
          icon={TrendingUp}
          to="/bookings"
          table={
            <MiniTable
              rows={data.sales_velocity}
              rowKey={(row) => row.month}
              dense
              columns={[
                { key: "month", label: "Month", cell: (row) => monthLabel(row.month) },
                { key: "bookings", label: "Bookings", align: "right", cell: (row) => formatNumber(row.bookings) },
                { key: "value", label: "Value", align: "right", cell: (row) => formatINRShort(row.value_paise) },
              ]}
            />
          }
        >
          <VelocityLine rows={data.sales_velocity} />
        </Widget>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Widget title="Top overdue" icon={ReceiptText} to="/demands?overdue_only=true" className="xl:col-span-2">
          <MiniTable
            rows={data.top_overdue}
            rowKey={(row) => row.booking_id}
            empty="Nothing overdue"
            columns={[
              {
                key: "booking",
                label: "Booking",
                cell: (row) => <BookingLink id={row.booking_id} number={row.booking_number} />,
              },
              {
                key: "customer",
                label: "Customer",
                cell: (row) => (
                  <span className="block truncate">
                    <Link to={`/customers/${row.customer_id}`} className="hover:underline">
                      {row.customer_name}
                    </Link>
                    <span className="block text-2xs text-ink-subtle">
                      {row.project_name} · {row.flat_number}
                    </span>
                  </span>
                ),
              },
              {
                key: "since",
                label: "Oldest due",
                cell: (row) => (
                  <span className="block leading-tight">
                    <span className="money block">{formatDate(row.oldest_due_date)}</span>
                    <Badge variant={row.days_overdue > 60 ? "danger" : "warning"} className="mt-0.5">
                      {ageingLabel(row.days_overdue)}
                    </Badge>
                  </span>
                ),
              },
              {
                key: "overdue",
                label: "Overdue",
                align: "right",
                cell: (row) => <span className="font-semibold text-danger-fg">{formatINR(row.overdue_paise)}</span>,
              },
            ]}
          />
        </Widget>
        <div className="grid gap-4">
          <Widget title="This month" icon={CalendarClock}>
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-muted">Dues raised</dt>
                <dd className="money font-semibold text-navy-950">
                  {formatINRShort(data.dues_raised_this_month.amount_paise)}{" "}
                  <span className="text-2xs font-normal text-ink-subtle">
                    ({formatNumber(data.dues_raised_this_month.count)})
                  </span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-muted">Upcoming installments (30 d)</dt>
                <dd className="money font-semibold text-navy-950">
                  {formatINRShort(data.upcoming_installments_30d.amount_paise)}{" "}
                  <span className="text-2xs font-normal text-ink-subtle">
                    ({formatNumber(data.upcoming_installments_30d.count)})
                  </span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="flex items-center gap-1 text-ink-muted">
                  <Inbox className="size-3.5" aria-hidden="true" /> Enquiries this week
                </dt>
                <dd className="money font-semibold text-navy-950">{formatNumber(data.enquiries_this_week)}</dd>
              </div>
            </dl>
          </Widget>
          <Widget title="Construction progress" icon={HardHat} to="/construction">
            {data.construction_progress.length === 0 ? (
              <p className="text-xs text-ink-subtle">No towers under construction.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.construction_progress.slice(0, 6).map((tower) => (
                  <ProgressRow
                    key={tower.block_id}
                    label={
                      <Link to={`/blocks/${tower.block_id}`} className="hover:underline">
                        {tower.project_name} · {tower.block_name}
                      </Link>
                    }
                    sublabel={tower.current_stage ?? "Not started"}
                    percent={tower.percent}
                    tone="gold"
                  />
                ))}
              </div>
            )}
          </Widget>
        </div>
      </div>
    </div>
  );
}
