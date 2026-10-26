import { ChevronDown, Download, FileDown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  api,
  CSV_SYNC_MAX_ROWS,
  describeError,
  isApiClientError,
  type CsvExportResult,
  type ListParams,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { Button, IconButton } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

/** The list behind a toolbar: its API path (e.g. "/customers"), the current filters/sort, and the CSV file name. */
export interface ExportSource {
  path: string;
  params: ListParams;
  filename?: string;
}

/** What the export control should do for a list of `total` rows: above the synchronous cap the default is the background export. */
export function exportMode(total: number | null | undefined): "sync" | "async" {
  return typeof total === "number" && total > CSV_SYNC_MAX_ROWS ? "async" : "sync";
}

/** Message for a failed POST /exports (429 = already 3 running for this user). */
export function exportErrorMessage(error: unknown): string {
  if (isApiClientError(error) && error.code === "RATE_LIMITED")
    return "You already have 3 exports running. Wait for one to finish, then try again.";
  return describeError(error);
}

export interface ExportControlProps {
  source?: ExportSource;
  /** Rows matching the current filters (the list's `total`). */
  total?: number | null;
  /** Custom synchronous export (pages that build their own query); its result may carry the truncation facts. */
  onExportCsv?: () => void | Promise<unknown>;
  exporting?: boolean;
}

function isCsvResult(value: unknown): value is CsvExportResult {
  return typeof value === "object" && value !== null && "truncated" in value;
}

/**
 * CSV export for a list toolbar. Up to 10,000 rows: "CSV" downloads straight away; the menu offers "Export all rows" (background job,
 * POST /exports). Above 10,000 rows the main button is "Export all". A synchronous file the server cut at 10,000 rows
 * (X-Export-Truncated) offers the background export in its toast.
 */
export function ExportControl({ source, total, onExportCsv, exporting = false }: ExportControlProps) {
  const navigate = useNavigate();
  const [syncBusy, setSyncBusy] = useState(false);
  const [asyncBusy, setAsyncBusy] = useState(false);
  const mode = exportMode(total);

  const exportAll = async () => {
    if (!source) return;
    setAsyncBusy(true);
    try {
      await api.startExport(source.path, source.params);
      toast.success(
        `Export queued${typeof total === "number" ? ` (${formatNumber(total)} rows)` : ""}. You'll get a notification when the file is ready.`,
        {
          action: { label: "My exports", onClick: () => navigate("/exports") },
        },
      );
    } catch (error) {
      toast.error(
        exportErrorMessage(error),
        isApiClientError(error) && error.code === "RATE_LIMITED"
          ? { action: { label: "My exports", onClick: () => navigate("/exports") } }
          : undefined,
      );
    } finally {
      setAsyncBusy(false);
    }
  };

  const exportSync = async () => {
    setSyncBusy(true);
    try {
      const result = onExportCsv
        ? await onExportCsv()
        : source
          ? await api.exportCsv(source.path, source.params, source.filename)
          : undefined;
      if (isCsvResult(result) && result.truncated && source) {
        toast.warning(
          `This CSV holds the first ${formatNumber(result.rows ?? CSV_SYNC_MAX_ROWS)} of ${formatNumber(result.total ?? total ?? 0)} rows.`,
          {
            description: "Export all rows in the background to get the complete file.",
            action: { label: "Export all", onClick: () => void exportAll() },
            duration: 15_000,
          },
        );
      }
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const busy = exporting || syncBusy || asyncBusy;
  const canAsync = Boolean(source);

  if (!canAsync) {
    return (
      <>
        <Button
          variant="outline"
          leftIcon={Download}
          loading={busy}
          onClick={() => void exportSync()}
          className="hidden sm:inline-flex"
        >
          CSV
        </Button>
        <IconButton
          icon={Download}
          label="Export CSV"
          variant="outline"
          loading={busy}
          onClick={() => void exportSync()}
          className="sm:hidden"
        />
      </>
    );
  }

  const primary = mode === "async" ? exportAll : exportSync;
  const primaryLabel = mode === "async" ? "Export all" : "CSV";
  return (
    <span className="inline-flex items-center" data-testid="export-control">
      <Button
        variant="outline"
        leftIcon={mode === "async" ? FileDown : Download}
        loading={busy}
        onClick={() => void primary()}
        className="hidden rounded-r-none sm:inline-flex"
        data-testid="export-primary"
      >
        {primaryLabel}
      </Button>
      <IconButton
        icon={mode === "async" ? FileDown : Download}
        label={mode === "async" ? "Export all rows" : "Export CSV"}
        variant="outline"
        loading={busy}
        onClick={() => void primary()}
        className="rounded-r-none sm:hidden"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={ChevronDown}
            label="More export options"
            variant="outline"
            disabled={busy}
            className="-ml-px rounded-l-none"
            data-testid="export-menu"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportSync()} data-testid="export-sync">
            <Download className="size-4" aria-hidden="true" />
            {mode === "async" ? `Download first ${formatNumber(CSV_SYNC_MAX_ROWS)} rows` : "Download CSV now"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportAll()} data-testid="export-all">
            <FileDown className="size-4" aria-hidden="true" />
            Export all rows in the background
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/exports")}>My exports</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
