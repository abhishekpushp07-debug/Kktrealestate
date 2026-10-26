import { Download, FileText, Link2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { ReportPresetRow } from "@kkt/contracts";
import { Button, EmptyState, ErrorState, exportErrorMessage, PageHeader, Skeleton } from "@/components/ui";
import { api, CSV_SYNC_MAX_ROWS, describeError } from "@/lib/api";
import { formatNumber, todayIST } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { ForbiddenPage } from "@/pages/ForbiddenPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PresetsMenu } from "./PresetsMenu";
import { ReportFilterBar } from "./ReportFilterBar";
import { exportReport, useReportData } from "./api";
import { buildReportQuery, missingRequired, pickReportParams, presetToParams } from "./reportQuery";
import { findReport, REPORT_GROUP_LABELS, type ReportDefinition } from "./reports";

/** `/reports/:key` — generic frame: URL-backed filters, strict query, totals footer tables, charts, CSV/PDF, presets. */
export default function ReportPage() {
  const { key } = useParams<{ key: string }>();
  const report = findReport(key);
  const { can } = useAuth();
  if (!report) return <NotFoundPage />;
  if (report.permission && !can(report.permission)) return <ForbiddenPage />;
  return <ReportFrame key={report.slug} report={report} />;
}

function parsePage(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

function ReportFrame({ report }: { report: ReportDefinition }) {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const today = todayIST();
  const params = useMemo(() => pickReportParams(report.filters, search), [report.filters, search]);
  const page = parsePage(search.get("page"), 1);
  const pageSize = Math.min(200, parsePage(search.get("page_size"), 50));
  const query = useMemo(
    () => buildReportQuery(report.filters, params, { today, paginated: report.paginated, page, pageSize }),
    [report.filters, report.paginated, params, today, page, pageSize],
  );
  const effective = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(query)
          .filter(([, value]) => typeof value === "string" || typeof value === "number")
          .map(([key, value]) => [key, String(value)]),
      ),
    [query],
  );
  const missing = missingRequired(report.filters, params);
  const data = useReportData<unknown>(report.path, query, missing.length === 0);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const update = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
          }
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  const reset = () => {
    const patch: Record<string, null> = { page: null, page_size: null };
    for (const key of Object.keys(params)) patch[key] = null;
    update(patch);
  };

  const applyPreset = (preset: ReportPresetRow) => {
    const next = presetToParams(report.filters, preset.params);
    const patch: Record<string, string | null> = {};
    for (const key of Object.keys(params)) patch[key] = null;
    Object.assign(patch, next);
    update(patch);
    toast.success(`Preset “${preset.name}” applied`);
  };

  const download = async (format: "csv" | "pdf") => {
    setExporting(format);
    try {
      const facts = await exportReport(report.path, query, format, `${report.slug}-${today}`);
      if (facts?.truncated) {
        toast.warning(
          `This CSV holds the first ${formatNumber(facts.rows ?? CSV_SYNC_MAX_ROWS)} of ${formatNumber(facts.total ?? 0)} rows.`,
          {
            description: "Export all rows in the background to get the complete file.",
            duration: 15_000,
            action: {
              label: "Export all",
              onClick: () => {
                api.startExport(report.path, { filters: query }).then(
                  () =>
                    toast.success("Export queued. You'll get a notification when the file is ready.", {
                      action: { label: "My exports", onClick: () => navigate("/exports") },
                    }),
                  (error: unknown) => toast.error(exportErrorMessage(error)),
                );
              },
            },
          },
        );
      }
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setExporting(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied — it carries these filters");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const context = {
    query,
    isFetching: data.isFetching,
    pagination: report.paginated
      ? {
          page,
          pageSize,
          total: 0,
          onPageChange: (next: number) => update({ page: next > 1 ? String(next) : null }, false),
          onPageSizeChange: (size: number) => update({ page_size: size === 50 ? null : String(size) }),
        }
      : undefined,
  };

  return (
    <>
      <PageHeader
        title={report.label}
        description={report.description}
        backTo="/reports"
        breadcrumbs={[
          { label: "Home", to: "/" },
          { label: "Reports", to: "/reports" },
          { label: REPORT_GROUP_LABELS[report.group] },
          { label: report.label },
        ]}
        actions={
          <>
            <PresetsMenu reportKey={report.key} params={params} onApply={applyPreset} />
            <Button
              variant="outline"
              leftIcon={Link2}
              onClick={() => void copyLink()}
              className="hidden sm:inline-flex"
              data-testid="report-copy-link"
            >
              Copy link
            </Button>
            {report.formats.includes("csv") && (
              <Button
                variant="outline"
                leftIcon={Download}
                loading={exporting === "csv"}
                disabled={missing.length > 0 || exporting !== null}
                onClick={() => void download("csv")}
                data-testid="report-export-csv"
              >
                CSV
              </Button>
            )}
            {report.formats.includes("pdf") && (
              <Button
                leftIcon={FileText}
                loading={exporting === "pdf"}
                disabled={missing.length > 0 || exporting !== null}
                onClick={() => void download("pdf")}
                data-testid="report-export-pdf"
              >
                PDF
              </Button>
            )}
          </>
        }
      />

      <ReportFilterBar
        filters={report.filters}
        params={params}
        effective={effective}
        onChange={(patch) => update(patch)}
        onReset={reset}
        today={today}
      />

      {missing.length > 0 ? (
        <EmptyState
          icon={report.icon}
          className="rounded-lg border border-border bg-card"
          title="Pick a project to run this report"
          description="This report is computed per project; choose one in the filters above."
        />
      ) : data.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : data.isError ? (
        <ErrorState
          error={data.error}
          onRetry={() => void data.refetch()}
          className="rounded-lg border border-border bg-card"
        />
      ) : (
        <div className="space-y-4" data-testid={`report-${report.slug}`}>
          {report.render(data.data, context)}
        </div>
      )}
    </>
  );
}
