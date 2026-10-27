import type { ColumnDef } from "@tanstack/react-table";
import { FileText, Play, ShieldCheck, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  DEMAND_STATUSES,
  DEMAND_STATUS_LABELS,
  INTEGRITY_FINDING_TYPE_LABELS,
  type DemandRow,
  type IntegrityFinding,
  type IntegrityReportResponse,
} from "@kkt/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  DateInput,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  Toolbar,
} from "@/components/ui";
import { describeError, isApiClientError, totalIsEstimate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR, formatINRShort, formatNumber, formatPercent } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { BookingLink, UnitLabel } from "@/features/bookings/components";
import { Notice } from "@/features/inventory/components";
import { useProjectOptions } from "@/features/shared/options";
import { DEMANDS_PATH, DUES_PATH, PAYMENT_INVALIDATIONS, repairIntegrity, runDues, useIntegrityReport } from "./api";
import { AGEING_ROW_CLASS, ageingLabel, ageingTone } from "./paymentMath";

const FILTERS = ["project_id", "block_id", "status", "from", "to", "overdue_only"] as const;

/** Opens the demand letter print route in a new tab. */
export function openDemandLetter(bookingId: string, demandId: string): void {
  window.open(`/print/demand/${bookingId}/${demandId}?autoprint=1`, "_blank", "noopener");
}

function AgeingChip({ days }: { days: number }) {
  const tone = ageingTone(days);
  const variant =
    tone === "danger"
      ? "danger"
      : tone === "gold"
        ? "gold"
        : tone === "warning"
          ? "warning"
          : tone === "info"
            ? "info"
            : "neutral";
  return (
    <Badge variant={variant} numeric>
      {ageingLabel(days)}
    </Badge>
  );
}

function DemandCard({ row }: { row: DemandRow }) {
  return (
    <div className={cn("-m-3 flex flex-col gap-2 rounded-md p-3", AGEING_ROW_CLASS[ageingTone(row.days_overdue)])}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="money text-sm font-bold text-navy-950">{row.demand_number}</p>
          <p className="truncate text-xs text-ink-muted">
            {row.installment_name} · {row.trigger_label}
          </p>
        </div>
        <StatusChip status={row.status} label={DEMAND_STATUS_LABELS[row.status]} size="sm" />
      </div>
      <div className="text-sm">
        <BookingLink id={row.booking_id} number={row.booking_number} />{" "}
        <span className="text-ink">· {row.customer_name}</span>
        <UnitLabel project={row.project_name} block={row.block_name} flat={row.flat_number} className="text-xs" />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-ink-subtle">Demanded</dt>
          <dd className="money font-semibold">{formatINRShort(row.total_demand_paise)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Paid</dt>
          <dd className="money font-semibold text-success-fg">{formatINRShort(row.paid_paise)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Due date</dt>
          <dd className="money font-semibold">{formatDate(row.due_date)}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-2">
        <AgeingChip days={row.days_overdue} />
        <Button
          size="xs"
          variant="outline"
          leftIcon={FileText}
          onClick={() => openDemandLetter(row.booking_id, row.id)}
        >
          Letter
        </Button>
      </div>
    </div>
  );
}

/** `/demands` — every demand across bookings with ageing colour, letters, "Run dues now" and the integrity panel. */
export default function DemandsPage() {
  const { can } = useAuth();
  const list = useListParams({ filterKeys: FILTERS, defaultSort: "due_date" });
  const query = useList<DemandRow>(DEMANDS_PATH, list.params);
  const projects = useProjectOptions();
  const [searchParams] = useSearchParams();
  // `/admin/integrity` (integrity bell link) lands here with the panel open.
  const [integrityOpen, setIntegrityOpen] = useState(() => searchParams.get("tab") === "integrity");
  const isAdmin = can("admin.tools");

  const run = useMutationWithToast<Awaited<ReturnType<typeof runDues>>, void>({
    mutationFn: () => runDues({}),
    successMessage: (result) =>
      `Dues run: ${formatNumber(result.bookings_processed)} bookings checked, ${formatNumber(result.demands_raised)} demand${result.demands_raised === 1 ? "" : "s"} raised`,
    invalidate: [...PAYMENT_INVALIDATIONS, [DUES_PATH]],
  });

  const columns = useMemo<ColumnDef<DemandRow, unknown>[]>(
    () => [
      {
        accessorKey: "demand_number",
        header: "Demand",
        meta: { locked: true, width: 150 },
        cell: ({ row }) => <span className="money font-semibold text-navy-950">{row.original.demand_number}</span>,
      },
      {
        accessorKey: "booking_number",
        header: "Booking",
        meta: { width: 140 },
        cell: ({ row }) => <BookingLink id={row.original.booking_id} number={row.original.booking_number} />,
      },
      {
        accessorKey: "customer_name",
        header: "Customer",
        cell: ({ row }) => <span className="block truncate">{row.original.customer_name}</span>,
      },
      {
        id: "unit",
        header: "Project · Tower · Flat",
        meta: { sortKey: "project_name", label: "Unit" },
        cell: ({ row }) => (
          <UnitLabel
            project={row.original.project_name}
            block={row.original.block_name}
            flat={row.original.flat_number}
          />
        ),
      },
      {
        accessorKey: "installment_name",
        header: "Installment",
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="block">{row.original.installment_name}</span>
            <span className="block text-2xs text-ink-subtle">
              {row.original.trigger_label} · {formatPercent(row.original.percent)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "demand_date",
        header: "Raised",
        meta: { width: 110, hideOnMobile: true },
        cell: ({ row }) => <span className="money">{formatDate(row.original.demand_date)}</span>,
      },
      {
        accessorKey: "due_date",
        header: "Due date",
        meta: { width: 110 },
        cell: ({ row }) => <span className="money font-semibold">{formatDate(row.original.due_date)}</span>,
      },
      {
        accessorKey: "cash_demand_paise",
        header: "Cash",
        meta: { align: "right", width: 120, hideOnMobile: true },
        cell: ({ row }) => <span className="money">{formatINR(row.original.cash_demand_paise)}</span>,
      },
      {
        accessorKey: "account_demand_paise",
        header: "Account",
        meta: { align: "right", width: 120, hideOnMobile: true },
        cell: ({ row }) => <span className="money">{formatINR(row.original.account_demand_paise)}</span>,
      },
      {
        accessorKey: "total_demand_paise",
        header: "Total",
        meta: { align: "right", width: 130 },
        cell: ({ row }) => (
          <span className="money font-semibold text-navy-950">{formatINR(row.original.total_demand_paise)}</span>
        ),
      },
      {
        accessorKey: "paid_paise",
        header: "Paid",
        meta: { align: "right", width: 120 },
        cell: ({ row }) => <span className="money text-success-fg">{formatINR(row.original.paid_paise)}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { width: 130 },
        cell: ({ row }) => (
          <StatusChip status={row.original.status} label={DEMAND_STATUS_LABELS[row.original.status]} />
        ),
      },
      {
        accessorKey: "days_overdue",
        header: "Ageing",
        meta: { width: 140 },
        cell: ({ row }) => <AgeingChip days={row.original.days_overdue} />,
      },
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, align: "right", width: 110, label: "Actions" },
        cell: ({ row }) => (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={FileText}
            onClick={() => openDemandLetter(row.original.booking_id, row.original.id)}
            aria-label={`Demand letter ${row.original.demand_number}`}
            data-no-row-click
          >
            Letter
          </Button>
        ),
      },
    ],
    [],
  );

  const unsupported =
    query.isError && isApiClientError(query.error) && (query.error.status === 404 || query.error.status === 405);

  return (
    <>
      <PageHeader
        title="Demands"
        description="Installment demands raised by the dues engine across every booking. Colour shows how long each one has been overdue."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Accounts" }, { label: "Demands" }]}
        actions={
          isAdmin ? (
            <>
              <Button
                variant="outline"
                leftIcon={ShieldCheck}
                onClick={() => setIntegrityOpen((value) => !value)}
                aria-expanded={integrityOpen}
                data-testid="demands-integrity-toggle"
              >
                Integrity report
              </Button>
              <Button
                leftIcon={Play}
                loading={run.isPending}
                onClick={() => run.mutate()}
                data-testid="demands-run-dues"
              >
                Run dues now
              </Button>
            </>
          ) : undefined
        }
      />

      {integrityOpen && isAdmin && <IntegrityPanel onClose={() => setIntegrityOpen(false)} />}

      {unsupported ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Global demand list is not available"
            description="This API build only exposes demands per booking. Open a booking and use its Demands tab; the dues engine and letters still work from there."
            action={
              <Button asChild variant="outline">
                <a href="/bookings">Go to bookings</a>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Toolbar
            search={list.search}
            onSearchChange={list.setSearch}
            searchPlaceholder="Demand no., booking, customer…"
            summary={query.data ? `${formatNumber(query.data.total)} demands` : undefined}
            filters={
              <>
                <Select
                  aria-label="Project"
                  size="sm"
                  className="w-full sm:w-48"
                  value={list.filters.project_id ?? null}
                  onValueChange={(value) => list.setFilters({ project_id: value, block_id: null })}
                  options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))}
                  placeholder="All projects"
                  allowClear
                />
                <Select
                  aria-label="Status"
                  size="sm"
                  className="w-full sm:w-40"
                  value={list.filters.status ?? null}
                  onValueChange={(value) => list.setFilter("status", value)}
                  options={DEMAND_STATUSES.map((status) => ({ value: status, label: DEMAND_STATUS_LABELS[status] }))}
                  placeholder="Any status"
                  allowClear
                />
                <Select
                  aria-label="Overdue"
                  size="sm"
                  className="w-full sm:w-36"
                  value={list.filters.overdue_only ?? null}
                  onValueChange={(value) => list.setFilter("overdue_only", value)}
                  options={[{ value: "true", label: "Overdue only" }]}
                  placeholder="All ages"
                  allowClear
                />
                <DateInput
                  aria-label="Due from"
                  className="h-12 text-xs sm:h-8"
                  wrapperClassName="w-full sm:w-40"
                  value={list.filters.from ?? null}
                  onChange={(value) => list.setFilter("from", value)}
                />
                <DateInput
                  aria-label="Due to"
                  className="h-12 text-xs sm:h-8"
                  wrapperClassName="w-full sm:w-40"
                  value={list.filters.to ?? null}
                  onChange={(value) => list.setFilter("to", value)}
                />
              </>
            }
            hasActiveFilters={list.hasActiveFilters}
            onClearFilters={list.reset}
            exportSource={{
              path: DEMANDS_PATH,
              params: { ...list.params, page: 1, page_size: 200 },
              filename: "demands.csv",
            }}
            exportTotal={query.data?.total}
          />
          <DataTable
            columns={columns}
            data={query.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={query.isPending || query.isFetching}
            error={query.error}
            onRetry={() => void query.refetch()}
            sort={list.sort}
            onSortChange={list.setSort}
            pagination={{
              page: list.page,
              pageSize: list.pageSize,
              total: query.data?.total ?? 0,
              totalIsEstimate: totalIsEstimate(query.data),
              onPageChange: list.setPage,
              onPageSizeChange: list.setPageSize,
            }}
            rowClassName={(row) => AGEING_ROW_CLASS[ageingTone(row.days_overdue)] || undefined}
            mobileCard={(row) => <DemandCard row={row} />}
            emptyState={{
              title: "No demands",
              description:
                "Demands appear as installments fall due — on booking, on stage completion, by date or when dues are run.",
            }}
            footer={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-xs bg-info-bg ring-1 ring-info/30" /> 1–30 d
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-xs bg-warning-bg ring-1 ring-status-hold-border" /> 31–60 d
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-xs bg-gold-light ring-1 ring-gold-border" /> 61–90 d
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-xs bg-danger-bg ring-1 ring-danger/30" /> 90+ d
                </span>
              </div>
            }
            data-testid="demands-table"
          />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Integrity panel (admin.tools)                                         */
/* ------------------------------------------------------------------ */

function countsOf(
  report: IntegrityReportResponse,
): Array<{ key: keyof IntegrityReportResponse["counts"]; count: number }> {
  return (Object.keys(report.counts) as Array<keyof IntegrityReportResponse["counts"]>).map((key) => ({
    key,
    count: report.counts[key],
  }));
}

function moneyRecord(record: Record<string, number> | null): string {
  if (!record) return "—";
  return Object.entries(record)
    .map(([key, value]) => `${key.replace(/_paise$/, "").replaceAll("_", " ")}: ${formatINR(value)}`)
    .join(" · ");
}

export function IntegrityPanel({ onClose }: { onClose: () => void }) {
  const report = useIntegrityReport(true);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const repair = useMutationWithToast<Awaited<ReturnType<typeof repairIntegrity>>, void>({
    mutationFn: () => repairIntegrity(report.data?.run_id ?? null),
    successMessage: (result) =>
      `Repair done: ${formatNumber(result.demands_voided)} voided, ${formatNumber(result.demands_raised)} raised, ${formatNumber(result.ledgers_rebuilt)} ledgers rebuilt`,
    invalidate: [...PAYMENT_INVALIDATIONS, [DUES_PATH]],
    onSuccess: (result) => {
      if (result.skipped_with_payments.length > 0)
        toast.warning(
          `${result.skipped_with_payments.length} demand(s) with payments were left untouched: ${result.skipped_with_payments.slice(0, 5).join(", ")}${result.skipped_with_payments.length > 5 ? "…" : ""}`,
        );
    },
  });

  const columns = useMemo<ColumnDef<IntegrityFinding, unknown>[]>(
    () => [
      {
        accessorKey: "type",
        header: "Finding",
        meta: { locked: true, sortKey: false },
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="block font-medium">{INTEGRITY_FINDING_TYPE_LABELS[row.original.type]}</span>
            <span className="block text-2xs text-ink-subtle">{row.original.type}</span>
          </span>
        ),
      },
      {
        accessorKey: "booking_number",
        header: "Booking",
        meta: { sortKey: false, width: 140 },
        cell: ({ row }) => <BookingLink id={row.original.booking_id} number={row.original.booking_number} />,
      },
      {
        id: "installment",
        header: "Installment / demand",
        meta: { sortKey: false },
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="block">
              {row.original.installment_name ?? "—"}
              {row.original.installment_seq !== null ? ` (#${row.original.installment_seq})` : ""}
            </span>
            {row.original.demand_number && (
              <span className="money block text-2xs text-ink-subtle">{row.original.demand_number}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "detail",
        header: "Detail",
        meta: { sortKey: false },
        cell: ({ row }) => <span className="block whitespace-normal text-xs">{row.original.detail}</span>,
      },
      {
        id: "figures",
        header: "Stored → recomputed",
        meta: { sortKey: false, hideOnMobile: true },
        cell: ({ row }) => (
          <span className="money block whitespace-normal text-2xs text-ink-muted">
            {moneyRecord(row.original.stored)} → {moneyRecord(row.original.recomputed)}
          </span>
        ),
      },
      {
        accessorKey: "repairable",
        header: "Repairable",
        meta: { sortKey: false, width: 110 },
        cell: ({ row }) => (
          <Badge variant={row.original.repairable ? "success" : "neutral"}>
            {row.original.repairable ? "Yes" : "Manual"}
          </Badge>
        ),
      },
    ],
    [],
  );

  const repairable = (report.data?.findings ?? []).filter((finding) => finding.repairable).length;

  return (
    <Card className="mb-4" data-testid="integrity-panel">
      <CardHeader
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void report.refetch()} loading={report.isFetching}>
              Re-run check
            </Button>
            {repairable > 0 && (
              <Button
                size="sm"
                variant="danger-outline"
                leftIcon={Wrench}
                onClick={() => setConfirmRepair(true)}
                data-testid="integrity-repair-btn"
              >
                Repair {formatNumber(repairable)}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        }
      >
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold-text" aria-hidden="true" /> Dues integrity report
        </CardTitle>
        {report.data && (
          <p className="text-xs text-ink-subtle">
            Ran {formatDateTime(report.data.ran_at)} by {report.data.triggered_by} ·{" "}
            {formatNumber(report.data.bookings_checked)} bookings checked ·{" "}
            <span className={report.data.ok ? "font-semibold text-success-fg" : "font-semibold text-danger-fg"}>
              {report.data.ok ? "no findings" : `${formatNumber(report.data.findings.length)} findings`}
            </span>
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {report.isPending && <Skeleton className="h-24" />}
        {report.isError && <ErrorState compact error={report.error} onRetry={() => void report.refetch()} />}
        {report.data && (
          <>
            <div className="flex flex-wrap gap-2">
              {countsOf(report.data).map(({ key, count }) => (
                <Badge key={key} variant={count > 0 ? "danger" : "success"} numeric>
                  {INTEGRITY_FINDING_TYPE_LABELS[key]}: {formatNumber(count)}
                </Badge>
              ))}
            </div>
            {(report.data.counts.PLAN_STAGE_MISSING ?? 0) > 0 && (
              <Notice tone="warning" data-testid="integrity-plan-stage-missing">
                {formatNumber(report.data.counts.PLAN_STAGE_MISSING ?? 0)} installment(s) wait on a construction stage
                their tower no longer has, so they can never be raised. Repair cannot fix this: add the stage back to
                the tower (Projects › tower › stage sequence) or move the booking to a plan that fits.
              </Notice>
            )}
            {report.data.ok ? (
              <Notice tone="success">
                Every demand maps to a satisfied trigger and the stored summaries match recomputation.
              </Notice>
            ) : (
              <DataTable
                columns={columns}
                data={report.data.findings}
                getRowId={(row, index) => `${row.booking_id}-${row.type}-${row.demand_id ?? index}`}
                density="compact"
                maxHeight="24rem"
                emptyState={{ title: "No findings" }}
                pinFirstColumn={false}
              />
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmRepair}
        onOpenChange={setConfirmRepair}
        title="Repair integrity findings?"
        description="Voids unsatisfied or duplicate demands that have no payments applied, raises missing ones and rebuilds the affected ledgers. Demands with payments are skipped and listed."
        confirmLabel="Repair now"
        variant="destructive"
        onConfirm={async () => {
          try {
            await repair.mutateAsync();
          } catch (cause) {
            throw new Error(describeError(cause), { cause });
          }
        }}
      >
        <Notice tone="warning">This rewrites ledger rows for the affected bookings. The action is audited.</Notice>
      </ConfirmDialog>
    </Card>
  );
}
