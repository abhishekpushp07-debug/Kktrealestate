/**
 * Catalogue of report definitions driving the generic ReportPage: strict filter set per report
 * (mirrors the contract query schemas), the endpoint, and a typed renderer of its response.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Banknote,
  BarChart3,
  Building2,
  CalendarClock,
  Clock3,
  FileText,
  Filter,
  IndianRupee,
  Landmark,
  PiggyBank,
  ReceiptText,
  Scale,
  Undo2,
  Wallet,
} from "lucide-react";
import { lazy, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AGEING_BUCKETS,
  AGEING_BUCKET_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  MONEY_CATEGORIES,
  MONEY_CATEGORY_LABELS,
  PAYMENT_BUCKETS,
  PAYMENT_BUCKET_LABELS,
  PAYMENT_MODE_CODES,
  PAYMENT_MODE_CODE_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  TRIGGER_TYPE_LABELS,
  VISIT_STATUS_LABELS,
  type ActivityReportResponse,
  type AdvancesReportResponse,
  type BankwiseReceiptsResponse,
  type CancellationsReportResponse,
  type ChequesReportResponse,
  type CollectionsReportResponse,
  type DemandVsCollectionResponse,
  type InventoryReportResponse,
  type OutstandingReportResponse,
  type ReportKey,
  type RoznamchaResponse,
  type SalesFunnelResponse,
  type UpcomingDuesResponse,
} from "@kkt/contracts";
import { Badge, StatusChip, type DataTablePagination } from "@/components/ui";
import type { QueryParams } from "@/lib/api";
import { formatDate, formatDateTime, formatINRShort, formatNumber, formatPercent } from "@/lib/format";
import type { PermissionRequirement } from "@/lib/permissions";
import { humanize } from "@/lib/utils";
import {
  BookingRef,
  Due,
  Money,
  Pct,
  ReportSection,
  ReportTable,
  StatGrid,
  TwoLine,
  type ReportColumn,
} from "./ReportSections";
import type { FilterDef } from "./reportQuery";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type ReportGroup = "money" | "sales" | "inventory" | "operations";
export const REPORT_GROUP_LABELS: Readonly<Record<ReportGroup, string>> = {
  money: "Money",
  sales: "Sales",
  inventory: "Inventory",
  operations: "Operations",
};
export const REPORT_GROUP_ORDER: readonly ReportGroup[] = ["money", "sales", "inventory", "operations"];

export interface RenderContext {
  query: QueryParams;
  isFetching: boolean;
  pagination?: DataTablePagination;
}

export interface ReportDefinition {
  key: ReportKey;
  slug: string;
  label: string;
  description: string;
  group: ReportGroup;
  icon: LucideIcon;
  path: string;
  filters: readonly FilterDef[];
  /** ListQuery-based reports page server-side. */
  paginated?: boolean;
  /** Export formats offered (every report supports CSV + PDF per the contract). */
  formats: readonly ("csv" | "pdf")[];
  /** Extra permission the API requires beyond report.view (the catalogue hides the card and the page shows Forbidden without it). */
  permission?: PermissionRequirement;
  render: (data: unknown, context: RenderContext) => ReactNode;
}

function defineReport<R>(
  definition: Omit<ReportDefinition, "render" | "formats"> & {
    formats?: readonly ("csv" | "pdf")[];
    render: (data: R, context: RenderContext) => ReactNode;
  },
): ReportDefinition {
  return {
    ...definition,
    formats: definition.formats ?? ["csv", "pdf"],
    render: (data, context) => definition.render(data as R, context),
  };
}

/* ------------------------------------------------------------------ */
/* Lazy charts                                                          */
/* ------------------------------------------------------------------ */

const CollectionsChart = lazy(() => import("./ReportCharts").then((module) => ({ default: module.CollectionsChart })));
const AgeingChart = lazy(() => import("./ReportCharts").then((module) => ({ default: module.AgeingChart })));
const DemandVsCollectionChart = lazy(() =>
  import("./ReportCharts").then((module) => ({ default: module.DemandVsCollectionChart })),
);
const MonthlyAmountChart = lazy(() =>
  import("./ReportCharts").then((module) => ({ default: module.MonthlyAmountChart })),
);
const VelocityChart = lazy(() => import("./ReportCharts").then((module) => ({ default: module.VelocityChart })));
const InventoryBlocksChart = lazy(() =>
  import("./ReportCharts").then((module) => ({ default: module.InventoryBlocksChart })),
);
const StageFunnelChart = lazy(() => import("./ReportCharts").then((module) => ({ default: module.StageFunnelChart })));
const SourceConversionChart = lazy(() =>
  import("./ReportCharts").then((module) => ({ default: module.SourceConversionChart })),
);
const BankwiseChart = lazy(() => import("./ReportCharts").then((module) => ({ default: module.BankwiseChart })));

/* ------------------------------------------------------------------ */
/* Shared filter pieces                                                 */
/* ------------------------------------------------------------------ */

const PROJECT: FilterDef = { kind: "project" };
const BLOCK: FilterDef = { kind: "block" };
const enumOptions = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>) =>
  values.map((value) => ({ value, label: labels[value] }));

const moneyTotal = (paise: number) => <Money paise={paise} className="font-semibold" />;

/* ------------------------------------------------------------------ */
/* Definitions                                                          */
/* ------------------------------------------------------------------ */

const collections = defineReport<CollectionsReportResponse>({
  key: "COLLECTIONS",
  slug: "collections",
  label: "Collections",
  description: "Cleared receipts by day, week or month, split by Cash / Account / Other charges with GST.",
  group: "money",
  icon: IndianRupee,
  path: "/reports/collections",
  filters: [
    { kind: "dateRange", required: true },
    {
      kind: "enum",
      key: "group_by",
      label: "Group by",
      options: enumOptions(REPORT_PERIODS, REPORT_PERIOD_LABELS),
      defaultValue: "DAY",
    },
    PROJECT,
    BLOCK,
    {
      kind: "enum",
      key: "mode_code",
      label: "Mode",
      options: enumOptions(PAYMENT_MODE_CODES, PAYMENT_MODE_CODE_LABELS),
      clearable: true,
    },
    {
      kind: "enum",
      key: "category",
      label: "Category",
      options: enumOptions(MONEY_CATEGORIES, MONEY_CATEGORY_LABELS),
      clearable: true,
    },
    {
      kind: "enum",
      key: "status",
      label: "Status",
      options: enumOptions(PAYMENT_STATUSES, PAYMENT_STATUS_LABELS),
      defaultValue: "CLEARED",
    },
  ],
  render: (data, context) => {
    const groupBy = String(context.query.group_by ?? "DAY");
    const columns: ReportColumn<CollectionsReportResponse["rows"][number]>[] = [
      {
        id: "period",
        header: "Period",
        cell: (row) => <TwoLine primary={row.period} secondary={formatDate(row.period_start)} />,
        footer: "Total",
      },
      {
        id: "count",
        header: "Receipts",
        align: "right",
        cell: (row) => formatNumber(row.count),
        footer: formatNumber(data.totals.count),
      },
      {
        id: "cash",
        header: "Cash",
        align: "right",
        cell: (row) => <Money paise={row.cash_paise} />,
        footer: moneyTotal(data.totals.cash_paise),
      },
      {
        id: "account",
        header: "Account",
        align: "right",
        cell: (row) => <Money paise={row.account_paise} />,
        footer: moneyTotal(data.totals.account_paise),
      },
      {
        id: "other",
        header: "Other charges",
        align: "right",
        cell: (row) => <Money paise={row.other_paise} />,
        footer: moneyTotal(data.totals.other_paise),
      },
      {
        id: "gst",
        header: "GST",
        align: "right",
        hideOnMobile: true,
        cell: (row) => <Money paise={row.gst_paise} />,
        footer: moneyTotal(data.totals.gst_paise),
      },
      {
        id: "total",
        header: "Total",
        align: "right",
        cell: (row) => <Money paise={row.total_paise} className="font-semibold" />,
        footer: moneyTotal(data.totals.total_paise),
      },
    ];
    const byMode = new Map<string, { amount: number; count: number }>();
    for (const row of data.rows)
      for (const mode of row.by_mode) {
        const current = byMode.get(mode.mode_code) ?? { amount: 0, count: 0 };
        byMode.set(mode.mode_code, { amount: current.amount + mode.amount_paise, count: current.count + mode.count });
      }
    const modeRows = [...byMode.entries()]
      .map(([mode_code, value]) => ({ mode_code, ...value }))
      .sort((a, b) => b.amount - a.amount);
    return (
      <>
        <StatGrid
          items={[
            {
              label: "Collected",
              value: formatINRShort(data.totals.total_paise),
              hint: `${formatNumber(data.totals.count)} receipts`,
              tone: "navy",
            },
            { label: "Cash", value: formatINRShort(data.totals.cash_paise) },
            { label: "Account", value: formatINRShort(data.totals.account_paise) },
            { label: "Other charges", value: formatINRShort(data.totals.other_paise) },
            { label: "GST", value: formatINRShort(data.totals.gst_paise) },
            {
              label: "Periods",
              value: formatNumber(data.rows.length),
              hint: REPORT_PERIOD_LABELS[groupBy as keyof typeof REPORT_PERIOD_LABELS] ?? groupBy,
            },
          ]}
          loading={context.isFetching && data.rows.length === 0}
        />
        <ReportSection
          title="Collections by period"
          description="Stacked by bucket; GST sits inside Other charges."
          chart={<CollectionsChart rows={data.rows} groupBy={groupBy} />}
        >
          <ReportTable columns={columns} rows={data.rows} getRowId={(row) => row.period} loading={context.isFetching} />
        </ReportSection>
        <ReportSection title="By payment mode" defaultView="table">
          <ReportTable
            columns={[
              {
                id: "mode",
                header: "Mode",
                cell: (row) =>
                  PAYMENT_MODE_CODE_LABELS[row.mode_code as keyof typeof PAYMENT_MODE_CODE_LABELS] ?? row.mode_code,
                footer: "Total",
              },
              {
                id: "count",
                header: "Receipts",
                align: "right",
                cell: (row) => formatNumber(row.count),
                footer: formatNumber(modeRows.reduce((sum, row) => sum + row.count, 0)),
              },
              {
                id: "amount",
                header: "Amount",
                align: "right",
                cell: (row) => <Money paise={row.amount} />,
                footer: moneyTotal(modeRows.reduce((sum, row) => sum + row.amount, 0)),
              },
            ]}
            rows={modeRows}
            getRowId={(row) => row.mode_code}
            loading={context.isFetching}
          />
        </ReportSection>
      </>
    );
  },
});

const outstanding = defineReport<OutstandingReportResponse>({
  key: "OUTSTANDING_AGEING",
  slug: "outstanding-ageing",
  label: "Outstanding & Ageing",
  description: "Dues per project, tower or customer, aged by demand due date, with the top overdue bookings.",
  group: "money",
  icon: Clock3,
  path: "/reports/outstanding-ageing",
  filters: [
    { kind: "date", key: "as_of", label: "As of", defaultToday: true },
    {
      kind: "enum",
      key: "group_by",
      label: "Group by",
      options: [
        { value: "PROJECT", label: "Project" },
        { value: "BLOCK", label: "Tower / block" },
        { value: "CUSTOMER", label: "Customer" },
      ],
      defaultValue: "PROJECT",
    },
    PROJECT,
    BLOCK,
    { kind: "customer" },
    { kind: "number", key: "top_n", label: "Top overdue", min: 1, max: 100, defaultValue: 10 },
  ],
  render: (data, context) => {
    const groupBy = String(context.query.group_by ?? "PROJECT");
    const groupLabel = groupBy === "BLOCK" ? "Tower" : groupBy === "CUSTOMER" ? "Customer" : "Project";
    const overdueTotal = AGEING_BUCKETS.filter((bucket) => bucket !== "NOT_DUE").reduce(
      (sum, bucket) => sum + data.totals.ageing[bucket],
      0,
    );
    const columns: ReportColumn<OutstandingReportResponse["rows"][number]>[] = [
      {
        id: "label",
        header: groupLabel,
        cell: (row) => <span className="font-medium">{row.label}</span>,
        footer: "Total",
      },
      {
        id: "bookings",
        header: "Bookings",
        align: "right",
        cell: (row) => formatNumber(row.bookings),
        footer: formatNumber(data.totals.bookings),
      },
      {
        id: "cash",
        header: "Cash due",
        align: "right",
        cell: (row) => <Due paise={row.cash_due_paise} />,
        footer: <Due paise={data.totals.cash_due_paise} />,
      },
      {
        id: "account",
        header: "Account due",
        align: "right",
        cell: (row) => <Due paise={row.account_due_paise} />,
        footer: <Due paise={data.totals.account_due_paise} />,
      },
      {
        id: "total",
        header: "Total due",
        align: "right",
        cell: (row) => <Due paise={row.total_due_paise} />,
        footer: <Due paise={data.totals.total_due_paise} />,
      },
      ...AGEING_BUCKETS.map<ReportColumn<OutstandingReportResponse["rows"][number]>>((bucket) => ({
        id: bucket,
        header: AGEING_BUCKET_LABELS[bucket],
        align: "right",
        hideOnMobile: bucket === "NOT_DUE",
        cell: (row) => <Money paise={row.ageing[bucket]} />,
        footer: moneyTotal(data.totals.ageing[bucket]),
      })),
    ];
    return (
      <>
        <StatGrid
          items={[
            {
              label: "Total due",
              value: formatINRShort(data.totals.total_due_paise),
              hint: `as of ${formatDate(data.as_of)}`,
              tone: "navy",
            },
            {
              label: "Overdue",
              value: formatINRShort(overdueTotal),
              hint: "past due date",
              tone: overdueTotal > 0 ? "gold" : "default",
            },
            { label: "Not yet due", value: formatINRShort(data.totals.ageing.NOT_DUE) },
            { label: "Cash due", value: formatINRShort(data.totals.cash_due_paise) },
            { label: "Account due", value: formatINRShort(data.totals.account_due_paise) },
            { label: "Bookings", value: formatNumber(data.totals.bookings) },
          ]}
        />
        <ReportSection
          title={`Ageing by ${groupLabel.toLowerCase()}`}
          description="Buckets by days past the demand due date."
          chart={<AgeingChart rows={data.rows} />}
        >
          <ReportTable columns={columns} rows={data.rows} getRowId={(row) => row.key_id} loading={context.isFetching} />
        </ReportSection>
        <ReportSection title={`Top ${data.top_overdue.length} overdue bookings`} defaultView="table">
          <ReportTable
            columns={[
              {
                id: "booking",
                header: "Booking",
                cell: (row) => <BookingRef id={row.booking_id} number={row.booking_number} />,
              },
              {
                id: "customer",
                header: "Customer",
                cell: (row) => (
                  <TwoLine
                    primary={
                      <Link
                        to={`/customers/${row.customer_id}`}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.customer_name}
                      </Link>
                    }
                    secondary={row.customer_phone}
                  />
                ),
              },
              {
                id: "flat",
                header: "Flat",
                cell: (row) => (
                  <TwoLine primary={<span className="money">{row.flat_number}</span>} secondary={row.project_name} />
                ),
              },
              {
                id: "overdue",
                header: "Overdue",
                align: "right",
                cell: (row) => <Money paise={row.overdue_paise} className="font-semibold text-danger-fg" />,
              },
              {
                id: "oldest",
                header: "Oldest due",
                cell: (row) => <span className="money">{formatDate(row.oldest_due_date)}</span>,
              },
              { id: "days", header: "Days", align: "right", cell: (row) => formatNumber(row.days_overdue) },
              {
                id: "bucket",
                header: "Bucket",
                cell: (row) => (
                  <Badge
                    variant={row.bucket === "D90_PLUS" ? "danger" : row.bucket === "D61_90" ? "warning" : "neutral"}
                  >
                    {AGEING_BUCKET_LABELS[row.bucket]}
                  </Badge>
                ),
              },
            ]}
            rows={data.top_overdue}
            getRowId={(row) => row.booking_id}
            loading={context.isFetching}
            emptyTitle="Nothing overdue"
          />
        </ReportSection>
      </>
    );
  },
});

const advances = defineReport<AdvancesReportResponse>({
  key: "ADVANCES",
  slug: "advances",
  label: "Advances",
  description: "Bookings that have paid ahead of their demands, per bucket, with the next installment.",
  group: "money",
  icon: PiggyBank,
  path: "/reports/advances",
  filters: [
    PROJECT,
    BLOCK,
    {
      kind: "enum",
      key: "bucket",
      label: "Bucket",
      options: enumOptions(PAYMENT_BUCKETS, PAYMENT_BUCKET_LABELS),
      clearable: true,
    },
  ],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          {
            label: "Total advance",
            value: formatINRShort(data.totals.total_advance_paise),
            hint: `${formatNumber(data.totals.count)} bookings`,
            tone: "navy",
          },
          { label: "Cash advance", value: formatINRShort(data.totals.cash_advance_paise) },
          { label: "Account advance", value: formatINRShort(data.totals.account_advance_paise) },
        ]}
      />
      <ReportSection title="Bookings in advance" defaultView="table">
        <ReportTable
          columns={[
            {
              id: "booking",
              header: "Booking",
              cell: (row) => <BookingRef id={row.booking_id} number={row.booking_number} />,
              footer: "Total",
            },
            { id: "customer", header: "Customer", cell: (row) => row.customer_name },
            {
              id: "flat",
              header: "Flat",
              cell: (row) => (
                <TwoLine
                  primary={<span className="money">{row.flat_number}</span>}
                  secondary={`${row.project_name} · ${row.block_name}`}
                />
              ),
            },
            {
              id: "cash",
              header: "Cash",
              align: "right",
              cell: (row) => <Money paise={row.cash_advance_paise} />,
              footer: moneyTotal(data.totals.cash_advance_paise),
            },
            {
              id: "account",
              header: "Account",
              align: "right",
              cell: (row) => <Money paise={row.account_advance_paise} />,
              footer: moneyTotal(data.totals.account_advance_paise),
            },
            {
              id: "total",
              header: "Advance",
              align: "right",
              cell: (row) => <Money paise={row.total_advance_paise} className="font-semibold text-success-fg" />,
              footer: moneyTotal(data.totals.total_advance_paise),
            },
            {
              id: "next",
              header: "Next installment",
              hideOnMobile: true,
              cell: (row) => row.next_installment_name ?? <span className="text-ink-subtle">—</span>,
            },
          ]}
          rows={data.rows}
          getRowId={(row) => row.booking_id}
          loading={context.isFetching}
          emptyTitle="No advances"
        />
      </ReportSection>
    </>
  ),
});

const demandVsCollection = defineReport<DemandVsCollectionResponse>({
  key: "DEMAND_VS_COLLECTION",
  slug: "demand-vs-collection",
  label: "Demand vs Collection",
  description: "For one project: what was demanded per installment or stage against what has come in.",
  group: "money",
  icon: Scale,
  path: "/reports/demand-vs-collection",
  filters: [
    { kind: "project", required: true },
    BLOCK,
    {
      kind: "enum",
      key: "group_by",
      label: "Group by",
      options: [
        { value: "INSTALLMENT", label: "Installment" },
        { value: "STAGE", label: "Construction stage" },
      ],
      defaultValue: "INSTALLMENT",
    },
  ],
  render: (data, context) => {
    const percent =
      data.totals.demanded_paise > 0 ? (data.totals.collected_paise / data.totals.demanded_paise) * 100 : 0;
    return (
      <>
        <StatGrid
          items={[
            { label: "Demanded", value: formatINRShort(data.totals.demanded_paise), tone: "navy" },
            { label: "Collected", value: formatINRShort(data.totals.collected_paise), hint: formatPercent(percent, 1) },
            {
              label: "Outstanding",
              value: formatINRShort(data.totals.outstanding_paise),
              tone: data.totals.outstanding_paise > 0 ? "gold" : "default",
            },
          ]}
        />
        <ReportSection title="Demanded vs collected" chart={<DemandVsCollectionChart rows={data.rows} />}>
          <ReportTable
            columns={[
              {
                id: "label",
                header: context.query.group_by === "STAGE" ? "Stage" : "Installment",
                cell: (row) => (
                  <TwoLine
                    primary={<span className="font-medium">{row.label}</span>}
                    secondary={row.block_name ?? undefined}
                  />
                ),
                footer: "Total",
              },
              {
                id: "trigger",
                header: "Trigger",
                hideOnMobile: true,
                cell: (row) => (row.trigger_type ? TRIGGER_TYPE_LABELS[row.trigger_type] : "—"),
              },
              { id: "demands", header: "Demands", align: "right", cell: (row) => formatNumber(row.demands_count) },
              {
                id: "demanded",
                header: "Demanded",
                align: "right",
                cell: (row) => <Money paise={row.demanded_paise} />,
                footer: moneyTotal(data.totals.demanded_paise),
              },
              {
                id: "collected",
                header: "Collected",
                align: "right",
                cell: (row) => <Money paise={row.collected_paise} className="text-success-fg" />,
                footer: moneyTotal(data.totals.collected_paise),
              },
              {
                id: "outstanding",
                header: "Outstanding",
                align: "right",
                cell: (row) => <Due paise={row.outstanding_paise} />,
                footer: <Due paise={data.totals.outstanding_paise} />,
              },
              {
                id: "percent",
                header: "Collected %",
                align: "right",
                cell: (row) => <Pct value={row.collection_percent} />,
                footer: <Pct value={percent} />,
              },
            ]}
            rows={data.rows}
            getRowId={(row) => `${row.key}-${row.block_id ?? ""}`}
            loading={context.isFetching}
          />
        </ReportSection>
      </>
    );
  },
});

const upcomingDues = defineReport<UpcomingDuesResponse>({
  key: "UPCOMING_DUES",
  slug: "upcoming-dues",
  label: "Upcoming Dues Forecast",
  description: "Installments expected in the window from time triggers and projected stage completion dates.",
  group: "money",
  icon: CalendarClock,
  path: "/reports/upcoming-dues",
  filters: [{ kind: "dateRange", required: true, defaultPreset: "this_quarter" }, PROJECT, BLOCK],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          {
            label: "Expected",
            value: formatINRShort(data.totals.total_paise),
            hint: `${formatNumber(data.totals.count)} installments`,
            tone: "navy",
          },
          { label: "Cash", value: formatINRShort(data.totals.cash_paise) },
          { label: "Account", value: formatINRShort(data.totals.account_paise) },
          {
            label: "Estimates",
            value: formatNumber(data.rows.filter((row) => row.is_estimate).length),
            hint: "stage-timing based",
          },
        ]}
      />
      <ReportSection title="By month" chart={<MonthlyAmountChart rows={data.by_month} />}>
        <ReportTable
          columns={[
            { id: "month", header: "Month", cell: (row) => row.month, footer: "Total" },
            {
              id: "count",
              header: "Installments",
              align: "right",
              cell: (row) => formatNumber(row.count),
              footer: formatNumber(data.totals.count),
            },
            {
              id: "total",
              header: "Expected",
              align: "right",
              cell: (row) => <Money paise={row.total_paise} />,
              footer: moneyTotal(data.totals.total_paise),
            },
          ]}
          rows={data.by_month}
          getRowId={(row) => row.month}
          loading={context.isFetching}
        />
      </ReportSection>
      <ReportSection title="Installments" defaultView="table">
        <ReportTable
          columns={[
            {
              id: "date",
              header: "Expected",
              cell: (row) => <span className="money">{formatDate(row.expected_date)}</span>,
              footer: "Total",
            },
            {
              id: "booking",
              header: "Booking",
              cell: (row) => <BookingRef id={row.booking_id} number={row.booking_number} />,
            },
            { id: "customer", header: "Customer", cell: (row) => row.customer_name },
            {
              id: "flat",
              header: "Flat",
              cell: (row) => (
                <TwoLine
                  primary={<span className="money">{row.flat_number}</span>}
                  secondary={`${row.project_name} · ${row.block_name}`}
                />
              ),
            },
            {
              id: "installment",
              header: "Installment",
              cell: (row) => (
                <TwoLine
                  primary={`${row.installment_seq}. ${row.installment_name}`}
                  secondary={
                    <>
                      {row.trigger_label}
                      {row.is_estimate && (
                        <Badge variant="warning" className="ml-1">
                          estimate
                        </Badge>
                      )}
                    </>
                  }
                />
              ),
            },
            {
              id: "cash",
              header: "Cash",
              align: "right",
              hideOnMobile: true,
              cell: (row) => <Money paise={row.cash_paise} />,
              footer: moneyTotal(data.totals.cash_paise),
            },
            {
              id: "account",
              header: "Account",
              align: "right",
              hideOnMobile: true,
              cell: (row) => <Money paise={row.account_paise} />,
              footer: moneyTotal(data.totals.account_paise),
            },
            {
              id: "total",
              header: "Total",
              align: "right",
              cell: (row) => <Money paise={row.total_paise} className="font-semibold" />,
              footer: moneyTotal(data.totals.total_paise),
            },
          ]}
          rows={data.rows}
          getRowId={(row) => `${row.booking_id}-${row.installment_seq}`}
          loading={context.isFetching}
          maxHeight="40rem"
        />
      </ReportSection>
    </>
  ),
});

const inventoryCountColumns = <Row extends InventoryReportResponse["totals"]>(
  labelHeader: string,
  totals: InventoryReportResponse["totals"],
): ReportColumn<Row>[] => [
  {
    id: "label",
    header: labelHeader,
    cell: (row) => <span className="font-medium">{row.label}</span>,
    footer: "Total",
  },
  {
    id: "available",
    header: "Available",
    align: "right",
    cell: (row) => formatNumber(row.available),
    footer: formatNumber(totals.available),
  },
  {
    id: "hold",
    header: "Hold",
    align: "right",
    hideOnMobile: true,
    cell: (row) => formatNumber(row.hold),
    footer: formatNumber(totals.hold),
  },
  {
    id: "blocked",
    header: "Blocked",
    align: "right",
    hideOnMobile: true,
    cell: (row) => formatNumber(row.blocked),
    footer: formatNumber(totals.blocked),
  },
  {
    id: "booked",
    header: "Booked",
    align: "right",
    cell: (row) => formatNumber(row.booked),
    footer: formatNumber(totals.booked),
  },
  {
    id: "sold",
    header: "Sold",
    align: "right",
    cell: (row) => formatNumber(row.sold),
    footer: formatNumber(totals.sold),
  },
  {
    id: "total",
    header: "Total",
    align: "right",
    cell: (row) => <span className="font-semibold">{formatNumber(row.total)}</span>,
    footer: formatNumber(totals.total),
  },
  {
    id: "available_value",
    header: "Available value",
    align: "right",
    cell: (row) => <Money paise={row.available_value_paise} short />,
    footer: <Money paise={totals.available_value_paise} short className="font-semibold" />,
  },
  {
    id: "sold_value",
    header: "Sold value",
    align: "right",
    cell: (row) => <Money paise={row.sold_value_paise} short />,
    footer: <Money paise={totals.sold_value_paise} short className="font-semibold" />,
  },
];

const inventory = defineReport<InventoryReportResponse>({
  key: "INVENTORY",
  slug: "inventory",
  label: "Inventory",
  description:
    "Availability by type, floor and tower; sold vs available value; sales velocity; realised rate against the rate card.",
  group: "inventory",
  icon: Building2,
  path: "/reports/inventory",
  filters: [PROJECT, BLOCK, { kind: "dateRange", required: false, label: "Velocity window" }],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          { label: "Total units", value: formatNumber(data.totals.total), tone: "navy" },
          {
            label: "Available",
            value: formatNumber(data.totals.available),
            hint: formatINRShort(data.totals.available_value_paise),
          },
          { label: "Booked", value: formatNumber(data.totals.booked) },
          { label: "Sold", value: formatNumber(data.totals.sold), hint: formatINRShort(data.totals.sold_value_paise) },
          {
            label: "Hold / Blocked",
            value: `${formatNumber(data.totals.hold)} / ${formatNumber(data.totals.blocked)}`,
          },
          {
            label: "Sold %",
            value: formatPercent(
              data.totals.total > 0 ? ((data.totals.sold + data.totals.booked) / data.totals.total) * 100 : 0,
              1,
            ),
            hint: "booked + sold",
          },
        ]}
      />
      <ReportSection title="By tower" chart={<InventoryBlocksChart rows={data.by_block} />}>
        <ReportTable
          columns={inventoryCountColumns("Tower", data.totals)}
          rows={data.by_block}
          getRowId={(row) => row.block_id}
          loading={context.isFetching}
        />
      </ReportSection>
      <ReportSection title="By flat type" defaultView="table">
        <ReportTable
          columns={inventoryCountColumns("Flat type", data.totals)}
          rows={data.by_type}
          getRowId={(row) => row.flat_type_id}
          loading={context.isFetching}
        />
      </ReportSection>
      <ReportSection title="By floor" defaultView="table">
        <ReportTable
          columns={inventoryCountColumns("Floor", data.totals)}
          rows={data.by_floor}
          getRowId={(row) => `${row.block_id}-${row.floor}`}
          loading={context.isFetching}
          maxHeight="28rem"
        />
      </ReportSection>
      <ReportSection
        title="Sales velocity"
        description="Bookings and cancellations per month in the window."
        chart={<VelocityChart rows={data.velocity} />}
      >
        <ReportTable
          columns={[
            { id: "month", header: "Month", cell: (row) => row.month, footer: "Total" },
            {
              id: "bookings",
              header: "Bookings",
              align: "right",
              cell: (row) => formatNumber(row.bookings),
              footer: formatNumber(data.velocity.reduce((sum, row) => sum + row.bookings, 0)),
            },
            {
              id: "cancellations",
              header: "Cancellations",
              align: "right",
              cell: (row) => formatNumber(row.cancellations),
              footer: formatNumber(data.velocity.reduce((sum, row) => sum + row.cancellations, 0)),
            },
            {
              id: "value",
              header: "Booked value",
              align: "right",
              cell: (row) => <Money paise={row.value_paise} />,
              footer: moneyTotal(data.velocity.reduce((sum, row) => sum + row.value_paise, 0)),
            },
          ]}
          rows={data.velocity}
          getRowId={(row) => row.month}
          loading={context.isFetching}
        />
      </ReportSection>
      <ReportSection
        title="Realised rate vs rate card"
        description="Average agreed rate per sq ft of bookings against the active rate card."
        defaultView="table"
      >
        <ReportTable
          columns={[
            {
              id: "type",
              header: "Flat type",
              cell: (row) => <span className="font-medium">{row.flat_type_name}</span>,
            },
            { id: "bookings", header: "Bookings", align: "right", cell: (row) => formatNumber(row.bookings) },
            {
              id: "card",
              header: "Rate card / sq ft",
              align: "right",
              cell: (row) => <Money paise={row.rate_card_rate_paise} />,
            },
            {
              id: "realised",
              header: "Realised / sq ft",
              align: "right",
              cell: (row) => <Money paise={row.realised_rate_paise} className="font-semibold" />,
            },
            {
              id: "delta",
              header: "Δ",
              align: "right",
              cell: (row) => {
                if (
                  row.rate_card_rate_paise === null ||
                  row.realised_rate_paise === null ||
                  row.rate_card_rate_paise === 0
                )
                  return <span className="text-ink-subtle">—</span>;
                const delta = ((row.realised_rate_paise - row.rate_card_rate_paise) / row.rate_card_rate_paise) * 100;
                return (
                  <span className={delta >= 0 ? "money text-success-fg" : "money text-danger-fg"}>
                    {delta >= 0 ? "+" : ""}
                    {formatPercent(delta, 1)}
                  </span>
                );
              },
            },
          ]}
          rows={data.realised_rate}
          getRowId={(row) => row.flat_type_id}
          loading={context.isFetching}
        />
      </ReportSection>
    </>
  ),
});

const cheques = defineReport<ChequesReportResponse>({
  key: "CHEQUES",
  slug: "cheques",
  label: "Cheques in Hand / Bounced",
  description: "Pending instruments by date with days in hand, or bounced cheques with their reasons.",
  group: "money",
  icon: ReceiptText,
  path: "/reports/cheques",
  paginated: true,
  filters: [
    {
      kind: "enum",
      key: "status",
      label: "Status",
      options: [
        { value: "PENDING", label: "In hand (pending)" },
        { value: "BOUNCED", label: "Bounced" },
      ],
      defaultValue: "PENDING",
    },
    PROJECT,
    { kind: "dateRange", required: false, label: "Payment date" },
  ],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          {
            label: context.query.status === "BOUNCED" ? "Bounced" : "In hand",
            value: formatINRShort(data.totals.amount_paise),
            hint: `${formatNumber(data.totals.count)} cheques`,
            tone: "navy",
          },
          { label: "On this page", value: formatNumber(data.items.length) },
        ]}
      />
      <ReportSection title="Cheques" defaultView="table">
        <ReportTable
          columns={[
            {
              id: "instrument",
              header: "Instrument",
              cell: (row) => (
                <TwoLine
                  primary={<span className="money font-semibold">{row.instrument?.number ?? row.receipt_number}</span>}
                  secondary={row.instrument?.bank_name ?? row.mode_code}
                />
              ),
              footer: "Total",
            },
            {
              id: "dates",
              header: "Dates",
              cell: (row) => (
                <TwoLine
                  primary={<span className="money">{formatDate(row.payment_date)}</span>}
                  secondary={row.instrument_date ? `instr. ${formatDate(row.instrument_date)}` : undefined}
                />
              ),
            },
            {
              id: "booking",
              header: "Booking",
              cell: (row) => (
                <TwoLine
                  primary={<span className="money">{row.booking_number}</span>}
                  secondary={`${row.project_name} · ${row.flat_number}`}
                />
              ),
            },
            { id: "customer", header: "Customer", cell: (row) => row.customer_name },
            {
              id: "amount",
              header: "Amount",
              align: "right",
              cell: (row) => <Money paise={row.amount_paise} className="font-semibold" />,
              footer: moneyTotal(data.totals.amount_paise),
            },
            {
              id: "days",
              header: "Days",
              align: "right",
              cell: (row) => (
                <Badge
                  variant={row.days_in_hand > 21 ? "danger" : row.days_in_hand > 7 ? "warning" : "neutral"}
                  numeric
                >
                  {row.days_in_hand} d
                </Badge>
              ),
            },
            {
              id: "status",
              header: "Status",
              cell: (row) => (
                <TwoLine
                  primary={<StatusChip status={row.status} size="sm" />}
                  secondary={row.bounce_reason ?? undefined}
                />
              ),
            },
          ]}
          rows={data.items}
          getRowId={(row) => row.id}
          loading={context.isFetching}
          pagination={context.pagination ? { ...context.pagination, total: data.total } : undefined}
        />
      </ReportSection>
    </>
  ),
});

const cancellations = defineReport<CancellationsReportResponse>({
  key: "CANCELLATIONS",
  slug: "cancellations",
  label: "Cancellations & Refunds",
  description: "Cancelled bookings in the window with paid, deducted and refunded amounts.",
  group: "money",
  icon: Undo2,
  path: "/reports/cancellations",
  filters: [{ kind: "dateRange", required: true, defaultPreset: "this_fy" }, PROJECT],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          { label: "Cancellations", value: formatNumber(data.totals.count), tone: "navy" },
          { label: "Paid before", value: formatINRShort(data.totals.paid_paise) },
          { label: "Deducted", value: formatINRShort(data.totals.deduction_paise) },
          { label: "Refunded", value: formatINRShort(data.totals.refund_paise) },
        ]}
      />
      <ReportSection title="Cancelled bookings" defaultView="table">
        <ReportTable
          columns={[
            {
              id: "booking",
              header: "Booking",
              cell: (row) => <BookingRef id={row.booking_id} number={row.booking_number} />,
              footer: "Total",
            },
            { id: "customer", header: "Customer", cell: (row) => row.customer_name },
            {
              id: "flat",
              header: "Flat",
              cell: (row) => (
                <TwoLine primary={<span className="money">{row.flat_number}</span>} secondary={row.project_name} />
              ),
            },
            {
              id: "dates",
              header: "Booked → cancelled",
              cell: (row) => (
                <TwoLine
                  primary={<span className="money">{formatDate(row.booking_date)}</span>}
                  secondary={<span className="money">{formatDateTime(row.cancelled_at)}</span>}
                />
              ),
            },
            { id: "by", header: "By", hideOnMobile: true, cell: (row) => row.cancelled_by_name ?? "—" },
            {
              id: "reason",
              header: "Reason",
              hideOnMobile: true,
              cell: (row) => (
                <span className="block max-w-[18rem] truncate" title={row.reason}>
                  {row.reason}
                </span>
              ),
            },
            {
              id: "paid",
              header: "Paid",
              align: "right",
              cell: (row) => <Money paise={row.paid_paise} />,
              footer: moneyTotal(data.totals.paid_paise),
            },
            {
              id: "deduction",
              header: "Deduction",
              align: "right",
              cell: (row) => <Money paise={row.deduction_paise} />,
              footer: moneyTotal(data.totals.deduction_paise),
            },
            {
              id: "refund",
              header: "Refund",
              align: "right",
              cell: (row) => <Money paise={row.refund_paise} className="font-semibold" />,
              footer: moneyTotal(data.totals.refund_paise),
            },
          ]}
          rows={data.rows}
          getRowId={(row) => row.booking_id}
          loading={context.isFetching}
          emptyTitle="No cancellations in this window"
        />
      </ReportSection>
    </>
  ),
});

const salesFunnel = defineReport<SalesFunnelResponse>({
  key: "SALES_FUNNEL",
  slug: "sales-funnel",
  label: "Sales & Leads Funnel",
  description:
    "Leads by stage and source, response time, bookings per salesperson, website enquiries, brochure downloads and site visits.",
  group: "sales",
  icon: Filter,
  path: "/reports/sales-funnel",
  filters: [
    { kind: "dateRange", required: true, defaultPreset: "this_quarter" },
    PROJECT,
    {
      kind: "enum",
      key: "source",
      label: "Source",
      options: enumOptions(LEAD_SOURCES, LEAD_SOURCE_LABELS),
      clearable: true,
    },
    { kind: "user", key: "assigned_user_id", label: "Salesperson" },
  ],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          { label: "Leads", value: formatNumber(data.totals.leads), tone: "navy" },
          {
            label: "Converted",
            value: formatNumber(data.totals.converted),
            hint: formatPercent(data.totals.leads > 0 ? (data.totals.converted / data.totals.leads) * 100 : 0, 1),
          },
          { label: "Lost", value: formatNumber(data.totals.lost) },
          { label: "Bookings", value: formatNumber(data.totals.bookings) },
          {
            label: "Avg first response",
            value: data.avg_response_hours === null ? "—" : `${data.avg_response_hours.toFixed(1)} h`,
          },
          {
            label: "Website enquiries",
            value: formatNumber(data.website.enquiries),
            hint: `${formatNumber(data.website.brochure_downloads)} brochures · ${formatNumber(data.website.site_visits_booked)} visits`,
          },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ReportSection title="Pipeline by stage" chart={<StageFunnelChart rows={data.by_stage} />}>
          <ReportTable
            columns={[
              { id: "stage", header: "Stage", cell: (row) => LEAD_STAGE_LABELS[row.stage] },
              { id: "count", header: "Leads", align: "right", cell: (row) => formatNumber(row.count) },
            ]}
            rows={data.by_stage}
            getRowId={(row) => row.stage}
            loading={context.isFetching}
          />
        </ReportSection>
        <ReportSection title="Conversion by source" chart={<SourceConversionChart rows={data.by_source} />}>
          <ReportTable
            columns={[
              { id: "source", header: "Source", cell: (row) => LEAD_SOURCE_LABELS[row.source] },
              { id: "leads", header: "Leads", align: "right", cell: (row) => formatNumber(row.leads) },
              { id: "converted", header: "Converted", align: "right", cell: (row) => formatNumber(row.converted) },
              {
                id: "percent",
                header: "Conversion",
                align: "right",
                cell: (row) => <Pct value={row.conversion_percent} />,
              },
            ]}
            rows={data.by_source}
            getRowId={(row) => row.source}
            loading={context.isFetching}
          />
        </ReportSection>
      </div>
      <ReportSection title="By salesperson" defaultView="table">
        <ReportTable
          columns={[
            {
              id: "user",
              header: "Salesperson",
              cell: (row) => <span className="font-medium">{row.user_name}</span>,
              footer: "Total",
            },
            {
              id: "leads",
              header: "Leads",
              align: "right",
              cell: (row) => formatNumber(row.leads),
              footer: formatNumber(data.by_salesperson.reduce((sum, row) => sum + row.leads, 0)),
            },
            {
              id: "visits",
              header: "Site visits",
              align: "right",
              cell: (row) => formatNumber(row.visits),
              footer: formatNumber(data.by_salesperson.reduce((sum, row) => sum + row.visits, 0)),
            },
            {
              id: "bookings",
              header: "Bookings",
              align: "right",
              cell: (row) => formatNumber(row.bookings),
              footer: formatNumber(data.by_salesperson.reduce((sum, row) => sum + row.bookings, 0)),
            },
            {
              id: "value",
              header: "Booked value",
              align: "right",
              cell: (row) => <Money paise={row.booking_value_paise} short />,
              footer: (
                <Money
                  paise={data.by_salesperson.reduce((sum, row) => sum + row.booking_value_paise, 0)}
                  short
                  className="font-semibold"
                />
              ),
            },
            {
              id: "response",
              header: "Avg response",
              align: "right",
              cell: (row) =>
                row.avg_first_response_hours === null ? "—" : `${row.avg_first_response_hours.toFixed(1)} h`,
            },
          ]}
          rows={data.by_salesperson}
          getRowId={(row) => row.user_id}
          loading={context.isFetching}
        />
      </ReportSection>
      <ReportSection title="Website site visits by status" defaultView="table">
        <ReportTable
          columns={[
            { id: "status", header: "Status", cell: (row) => VISIT_STATUS_LABELS[row.status] },
            { id: "count", header: "Visits", align: "right", cell: (row) => formatNumber(row.count) },
          ]}
          rows={data.website.site_visits_by_status}
          getRowId={(row) => row.status}
          loading={context.isFetching}
        />
      </ReportSection>
    </>
  ),
});

const bankwise = defineReport<BankwiseReceiptsResponse>({
  key: "BANKWISE_RECEIPTS",
  slug: "bankwise-receipts",
  label: "Bank-wise Receipts",
  description: "Receipts credited per company bank account in the window, with a mode split.",
  group: "money",
  icon: Landmark,
  path: "/reports/bankwise-receipts",
  filters: [{ kind: "dateRange", required: true }, { kind: "bankAccount" }, PROJECT],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          {
            label: "Receipts",
            value: formatINRShort(data.totals.amount_paise),
            hint: `${formatNumber(data.totals.count)} receipts`,
            tone: "navy",
          },
          { label: "Accounts", value: formatNumber(data.rows.length) },
        ]}
      />
      <ReportSection title="By bank account" chart={<BankwiseChart rows={data.rows} />}>
        <ReportTable
          columns={[
            {
              id: "bank",
              header: "Bank account",
              cell: (row) => <span className="font-medium">{row.bank_account_label}</span>,
              footer: "Total",
            },
            {
              id: "count",
              header: "Receipts",
              align: "right",
              cell: (row) => formatNumber(row.count),
              footer: formatNumber(data.totals.count),
            },
            {
              id: "amount",
              header: "Amount",
              align: "right",
              cell: (row) => <Money paise={row.amount_paise} className="font-semibold" />,
              footer: moneyTotal(data.totals.amount_paise),
            },
            {
              id: "modes",
              header: "By mode",
              cell: (row) => (
                <span className="flex flex-wrap gap-1">
                  {row.by_mode.map((mode) => (
                    <Badge key={mode.mode_code} variant="outline" numeric>
                      {PAYMENT_MODE_CODE_LABELS[mode.mode_code]} {formatINRShort(mode.amount_paise)}
                    </Badge>
                  ))}
                </span>
              ),
            },
          ]}
          rows={data.rows}
          getRowId={(row, index) => row.bank_account_id ?? `none-${index}`}
          loading={context.isFetching}
        />
      </ReportSection>
    </>
  ),
});

const roznamcha = defineReport<RoznamchaResponse>({
  key: "ROZNAMCHA",
  slug: "roznamcha",
  label: "Roznamcha (Day Book)",
  description: "Cash book for a date range: opening cash, receipts by mode and category, contra entries, closing cash.",
  group: "money",
  icon: Wallet,
  path: "/reports/roznamcha",
  filters: [{ kind: "dateRange", required: true, defaultPreset: "today" }, PROJECT],
  render: (data, context) => (
    <>
      <StatGrid
        items={[
          { label: "Opening cash", value: formatINRShort(data.opening_cash_paise) },
          { label: "Cash received", value: formatINRShort(data.cash_received_paise), tone: "navy" },
          { label: "Deposited", value: formatINRShort(data.cash_deposited_paise) },
          { label: "Withdrawn", value: formatINRShort(data.cash_withdrawn_paise) },
          { label: "Closing cash", value: formatINRShort(data.closing_cash_paise), tone: "gold" },
          {
            label: "All receipts",
            value: formatINRShort(data.totals.receipts_paise),
            hint: `${formatNumber(data.totals.receipts_count)} receipts · ${formatINRShort(data.totals.pending_cheques_paise)} cheques pending`,
          },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <ReportSection title="By mode" defaultView="table">
          <ReportTable
            columns={[
              { id: "mode", header: "Mode", cell: (row) => row.mode_name },
              { id: "count", header: "#", align: "right", cell: (row) => formatNumber(row.count) },
              { id: "amount", header: "Amount", align: "right", cell: (row) => <Money paise={row.amount_paise} /> },
            ]}
            rows={data.by_mode}
            getRowId={(row) => row.mode_code}
            loading={context.isFetching}
          />
        </ReportSection>
        <ReportSection title="By category" defaultView="table">
          <ReportTable
            columns={[
              { id: "category", header: "Category", cell: (row) => MONEY_CATEGORY_LABELS[row.category] },
              { id: "count", header: "#", align: "right", cell: (row) => formatNumber(row.count) },
              { id: "amount", header: "Amount", align: "right", cell: (row) => <Money paise={row.amount_paise} /> },
            ]}
            rows={data.by_category}
            getRowId={(row) => row.category}
            loading={context.isFetching}
          />
        </ReportSection>
        <ReportSection title="By project" defaultView="table">
          <ReportTable
            columns={[
              { id: "project", header: "Project", cell: (row) => row.project_name },
              { id: "count", header: "#", align: "right", cell: (row) => formatNumber(row.count) },
              { id: "amount", header: "Amount", align: "right", cell: (row) => <Money paise={row.amount_paise} /> },
            ]}
            rows={data.by_project}
            getRowId={(row) => row.project_id}
            loading={context.isFetching}
          />
        </ReportSection>
      </div>
      <ReportSection title="Receipts" defaultView="table">
        <ReportTable
          columns={[
            {
              id: "receipt",
              header: "Receipt",
              cell: (row) => (
                <Link
                  to={`/print/receipt/${row.payment_id}`}
                  target="_blank"
                  rel="noopener"
                  className="money font-semibold text-navy-800 hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {row.receipt_number}
                </Link>
              ),
              footer: "Total",
            },
            {
              id: "date",
              header: "Date",
              cell: (row) => <span className="money">{formatDate(row.payment_date)}</span>,
            },
            {
              id: "customer",
              header: "Customer",
              cell: (row) => (
                <TwoLine
                  primary={row.customer_name}
                  secondary={`${row.booking_number} · ${row.project_name} ${row.flat_number}`}
                />
              ),
            },
            {
              id: "mode",
              header: "Mode",
              cell: (row) => (
                <TwoLine
                  primary={row.mode_name}
                  secondary={row.instrument_number ?? row.bank_account_label ?? undefined}
                />
              ),
            },
            {
              id: "category",
              header: "Category",
              cell: (row) => (
                <Badge variant={row.category === "CASH" ? "navy" : row.category === "ACCOUNT" ? "info" : "gold"}>
                  {MONEY_CATEGORY_LABELS[row.category]}
                </Badge>
              ),
            },
            {
              id: "amount",
              header: "Amount",
              align: "right",
              cell: (row) => <Money paise={row.amount_paise} className="font-semibold" />,
              footer: moneyTotal(data.receipts.reduce((sum, row) => sum + row.amount_paise, 0)),
            },
          ]}
          rows={data.receipts}
          getRowId={(row) => row.payment_id}
          loading={context.isFetching}
          maxHeight="40rem"
        />
      </ReportSection>
      <ReportSection title="Contra entries" defaultView="table">
        <ReportTable
          columns={[
            { id: "date", header: "Date", cell: (row) => <span className="money">{formatDate(row.entry_date)}</span> },
            {
              id: "type",
              header: "Type",
              cell: (row) => <Badge variant={row.type === "DEPOSIT" ? "info" : "warning"}>{humanize(row.type)}</Badge>,
            },
            { id: "bank", header: "Bank account", cell: (row) => row.bank_account_label },
            { id: "amount", header: "Amount", align: "right", cell: (row) => <Money paise={row.amount_paise} /> },
            { id: "by", header: "By", hideOnMobile: true, cell: (row) => row.by_user_name ?? "—" },
            { id: "remarks", header: "Remarks", hideOnMobile: true, cell: (row) => row.remarks ?? "—" },
          ]}
          rows={data.contra_entries}
          getRowId={(row) => row.id}
          loading={context.isFetching}
          emptyTitle="No contra entries"
        />
      </ReportSection>
    </>
  ),
});

const activity = defineReport<ActivityReportResponse>({
  key: "ACTIVITY",
  slug: "activity",
  label: "Activity / Logins",
  description: "Audit actions, successful logins and failed attempts by user, with IP addresses.",
  group: "operations",
  icon: Activity,
  path: "/reports/activity",
  // GET /reports/activity is guarded by audit.view, not report.view (docs/TODO-integration.md item 10)
  permission: "audit.view",
  paginated: true,
  filters: [
    { kind: "dateRange", required: false },
    {
      kind: "enum",
      key: "kind",
      label: "Kind",
      options: [
        { value: "AUDIT", label: "Audit actions" },
        { value: "LOGIN", label: "Logins" },
        { value: "FAILED_LOGIN", label: "Failed logins" },
      ],
      defaultValue: "AUDIT",
    },
    { kind: "user", key: "user_id", label: "User" },
    { kind: "text", key: "entity_type", label: "Entity type", placeholder: "booking, payment…" },
  ],
  render: (data, context) => (
    <ReportSection title="Events" description={`${formatNumber(data.total)} events`} defaultView="table">
      <ReportTable
        columns={[
          { id: "at", header: "When", cell: (row) => <span className="money">{formatDateTime(row.at)}</span> },
          {
            id: "actor",
            header: "Actor",
            cell: (row) => (
              <TwoLine
                primary={row.actor_name ?? (row.actor_type === "SYSTEM" ? "System" : (row.identifier ?? "Unknown"))}
                secondary={row.identifier ?? undefined}
              />
            ),
          },
          {
            id: "kind",
            header: "Kind",
            cell: (row) => (
              <Badge variant={row.kind === "FAILED_LOGIN" ? "danger" : row.kind === "LOGIN" ? "info" : "neutral"}>
                {humanize(row.kind)}
              </Badge>
            ),
          },
          {
            id: "action",
            header: "Action",
            cell: (row) => (
              <code className="rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-xs text-navy-950">{row.action}</code>
            ),
          },
          {
            id: "entity",
            header: "Entity",
            cell: (row) =>
              row.entity_type ? (
                <TwoLine
                  primary={humanize(row.entity_type)}
                  secondary={row.entity_id ? `${row.entity_id.slice(0, 8)}…` : undefined}
                />
              ) : (
                "—"
              ),
          },
          {
            id: "ip",
            header: "IP",
            hideOnMobile: true,
            cell: (row) => <span className="money font-mono text-xs">{row.ip ?? "—"}</span>,
          },
          { id: "reason", header: "Reason", hideOnMobile: true, cell: (row) => row.reason ?? "—" },
        ]}
        rows={data.items}
        getRowId={(row, index) => `${row.at}-${index}`}
        loading={context.isFetching}
        pagination={context.pagination ? { ...context.pagination, total: data.total } : undefined}
        maxHeight="40rem"
      />
    </ReportSection>
  ),
});

export const REPORTS: readonly ReportDefinition[] = [
  collections,
  outstanding,
  advances,
  demandVsCollection,
  upcomingDues,
  cheques,
  cancellations,
  bankwise,
  roznamcha,
  salesFunnel,
  inventory,
  activity,
];

/** Generic reports this user may open (report.view is checked by the route; some reports need more, e.g. Activity → audit.view). */
export function reportsFor(can: (permission: PermissionRequirement) => boolean): ReportDefinition[] {
  return REPORTS.filter((report) => !report.permission || can(report.permission));
}

export function findReport(slug: string | undefined): ReportDefinition | undefined {
  return REPORTS.find((report) => report.slug === slug);
}

/** Catalogue entries that are not generic reports (dedicated pages). */
export const SPECIAL_REPORTS: ReadonlyArray<{
  key: ReportKey;
  slug: string;
  label: string;
  description: string;
  group: ReportGroup;
  icon: LucideIcon;
}> = [
  {
    key: "CUSTOMER_STATEMENT",
    slug: "customer-statement",
    label: "Customer Statement of Account",
    description:
      "Agreement, revisions, schedule, full ledger, other charges and pending cheques for one booking — with the branded PDF.",
    group: "money",
    icon: FileText,
  },
  {
    key: "ALLOTMENT_LETTER",
    slug: "customer-statement",
    label: "Allotment Letter & Payment Schedule",
    description: "Branded PDFs per booking, downloaded from the statement page.",
    group: "money",
    icon: Banknote,
  },
];

export const REPORT_GROUP_ICON: Readonly<Record<ReportGroup, LucideIcon>> = {
  money: IndianRupee,
  sales: Filter,
  inventory: Building2,
  operations: BarChart3,
};
