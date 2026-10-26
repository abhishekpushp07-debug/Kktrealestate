import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EXPORT_STATUS_LABELS, EXPORT_STATUSES, type ExportRow } from "@kkt/contracts";
import { Button, Card, CardContent, DataTable, PageHeader, Select, StatusChip } from "@/components/ui";
import { describeError } from "@/lib/api";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { Notice } from "@/features/inventory/components";
import { exportLink, exportSourceLabel, hasActive, openDownload, useExports } from "./api";

function filterSummary(query: Record<string, unknown>): string {
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  return parts.length ? parts.join(" · ") : "All rows";
}

/** `/exports` — my background CSV exports (POST /exports from any list's "Export all"), with status and download. */
export default function ExportsPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const exportsQuery = useExports({ status, page, page_size: pageSize });
  const [linking, setLinking] = useState<string | null>(null);
  const rows = exportsQuery.data?.items ?? [];

  const download = async (row: ExportRow) => {
    setLinking(row.id);
    try {
      const link = await exportLink(row.id);
      openDownload(link.download_url);
      toast.success(`Downloading ${link.file_name} (${formatNumber(link.row_count)} rows)`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLinking(null);
    }
  };

  const columns = useMemo<ColumnDef<ExportRow, unknown>[]>(
    () => [
      {
        accessorKey: "path",
        header: "List",
        meta: { locked: true, sortKey: false },
        cell: ({ row }) => (
          <span className="block min-w-0 leading-tight">
            <span className="block truncate font-semibold text-navy-950">{exportSourceLabel(row.original.path)}</span>
            <span className="block truncate text-2xs text-ink-subtle" title={filterSummary(row.original.query)}>
              {filterSummary(row.original.query)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { width: 110 },
        cell: ({ row }) => (
          <StatusChip status={row.original.status} label={EXPORT_STATUS_LABELS[row.original.status]} size="sm" />
        ),
      },
      {
        accessorKey: "row_count",
        header: "Rows",
        meta: { sortKey: false, align: "right", width: 90 },
        cell: ({ row }) =>
          row.original.row_count === null ? (
            <span className="text-xs text-ink-subtle">—</span>
          ) : (
            <span className="money">{formatNumber(row.original.row_count)}</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: "Requested",
        meta: { width: 170 },
        cell: ({ row }) => <span className="text-xs">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "detail",
        header: "Detail",
        meta: { sortKey: false },
        cell: ({ row }) =>
          row.original.error ? (
            <span
              className="block max-w-md whitespace-normal break-words text-xs text-danger-fg"
              data-testid="export-error"
            >
              {row.original.error}
            </span>
          ) : row.original.status === "DONE" && row.original.expires_at ? (
            <span className="text-xs text-ink-subtle" title={formatDateTime(row.original.expires_at)}>
              {row.original.file_name} · available until {formatRelative(row.original.expires_at)}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">
              {row.original.status === "RUNNING"
                ? "Writing the file…"
                : row.original.status === "QUEUED"
                  ? "Waiting for the worker…"
                  : "—"}
            </span>
          ),
      },
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, align: "right" },
        cell: ({ row }) =>
          row.original.status === "DONE" ? (
            <Button
              size="sm"
              variant="outline"
              leftIcon={Download}
              loading={linking === row.original.id}
              onClick={() => void download(row.original)}
              data-testid={`export-download-${row.original.id}`}
            >
              Download
            </Button>
          ) : null,
      },
    ],
    [linking],
  );

  return (
    <>
      <PageHeader
        title="My exports"
        description="Background CSV exports of whole lists (more than 10,000 rows, or whenever you choose “Export all”). Files are kept for 7 days; you get a notification when one is ready."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Exports" }]}
      />
      {hasActive(rows) && (
        <Notice tone="info" className="mb-4">
          An export is being written. This page refreshes until it is ready. At most 3 exports can run for you at the
          same time.
        </Notice>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          aria-label="Status"
          size="sm"
          className="w-full sm:w-40"
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={EXPORT_STATUSES.map((value) => ({ value, label: EXPORT_STATUS_LABELS[value] }))}
          placeholder="Any status"
          allowClear
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            loading={exportsQuery.isFetching && !exportsQuery.data}
            error={exportsQuery.error}
            onRetry={() => void exportsQuery.refetch()}
            pagination={{
              page,
              pageSize,
              total: exportsQuery.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
            emptyState={{
              icon: FileSpreadsheet,
              title: "No exports yet",
              description: "Use “Export all” on any list to build a CSV of every row in the background.",
            }}
            data-testid="exports-table"
          />
        </CardContent>
      </Card>
    </>
  );
}
