import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCopy, FileUp, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import type { MasterCsvImportResponse, MasterCsvImportRow } from "@kkt/contracts";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormError, StatusChip, Textarea, type StatusTone } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { importMasterCsv, masterPath } from "./api";
import type { AnyMasterConfig } from "./types";

export interface CsvImportDialogProps {
  config: AnyMasterConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACTION_TONES: Readonly<Record<MasterCsvImportRow["action"], StatusTone>> = {
  CREATE: "success",
  UPDATE: "info",
  SKIP: "neutral",
  ERROR: "danger",
};

const MAX_CSV_BYTES = 2_000_000;

function summariseData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

/** Paste or upload a CSV, preview every row's action and errors, then commit when clean. */
export function CsvImportDialog({ config, open, onOpenChange }: CsvImportDialogProps) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<MasterCsvImportResponse | null>(null);
  const [previewedCsv, setPreviewedCsv] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [headerCopied, setHeaderCopied] = useState(false);

  useEffect(() => {
    if (open) return;
    setCsv("");
    setFileName(null);
    setPreview(null);
    setPreviewedCsv(null);
    setBusy(null);
    setError(null);
  }, [open]);

  const header = config.csv.columns.join(",");
  const stale = preview !== null && previewedCsv !== csv;
  const canPreview = csv.trim().length > 0 && busy === null;
  const canCommit = preview !== null && !preview.committed && !stale && preview.summary.error === 0 && preview.summary.create + preview.summary.update > 0 && busy === null;

  const run = async (commit: boolean) => {
    setBusy(commit ? "commit" : "preview");
    setError(null);
    try {
      const result = await importMasterCsv({ kind: config.kind, csv, commit });
      setPreview(result);
      setPreviewedCsv(csv);
      if (commit && result.committed) {
        await queryClient.invalidateQueries({ queryKey: [masterPath(config.slug)] });
        toast.success(`${formatNumber(result.summary.create)} created, ${formatNumber(result.summary.update)} updated`);
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      toast.error("CSV is larger than 2 MB. Split it into smaller files.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(typeof reader.result === "string" ? reader.result : "");
      setFileName(file.name);
      setPreview(null);
    };
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsText(file);
  };

  const copyHeader = async () => {
    try {
      await navigator.clipboard.writeText(`${header}\n${config.csv.example}`);
      setHeaderCopied(true);
      window.setTimeout(() => setHeaderCopied(false), 1500);
    } catch {
      toast.error("Could not copy the template.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
      <DialogContent size="xl" data-testid={`csv-import-dialog-${config.slug}`}>
        <DialogHeader>
          <DialogTitle>Import {config.label.toLowerCase()} from CSV</DialogTitle>
          <DialogDescription>Rows are matched on code (or name) — existing records are updated, new ones created. Nothing is written until you commit.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-md border border-border bg-surface/60 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="label-caps">Expected columns</span>
              <Button variant="ghost" size="xs" leftIcon={headerCopied ? Check : ClipboardCopy} onClick={() => void copyHeader()} data-testid="csv-copy-template-btn">
                {headerCopied ? "Copied" : "Copy template"}
              </Button>
            </div>
            <code className="mt-1 block break-all font-mono text-ink">{header}</code>
            <code className="block break-all font-mono text-ink-subtle">{config.csv.example}</code>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="csv-import-text" className="text-xs font-semibold text-ink-muted">
                CSV text {fileName && <span className="font-normal text-ink-subtle">· {fileName}</span>}
              </label>
              <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} data-testid="csv-file-input" />
              <Button variant="outline" size="sm" leftIcon={FileUp} onClick={() => fileInput.current?.click()} data-testid="csv-upload-btn">
                Upload .csv
              </Button>
            </div>
            <Textarea
              id="csv-import-text"
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                setError(null);
              }}
              rows={6}
              placeholder={`${header}\n${config.csv.example}`}
              className="font-mono text-xs"
              spellCheck={false}
              data-testid="csv-import-textarea"
            />
            <p className="money text-2xs text-ink-subtle">
              {csv ? `${formatNumber(csv.split(/\r?\n/).filter((line) => line.trim()).length)} lines` : "Paste rows including the header line, or upload a file."}
            </p>
          </div>

          {error !== null && <FormError error={error} />}

          {preview && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="label-caps">{preview.committed ? "Imported" : stale ? "Preview (out of date)" : "Preview"}</span>
                <Badge variant="success" numeric>
                  {preview.summary.create} create
                </Badge>
                <Badge variant="info" numeric>
                  {preview.summary.update} update
                </Badge>
                <Badge variant="neutral" numeric>
                  {preview.summary.skip} skip
                </Badge>
                <Badge variant={preview.summary.error > 0 ? "danger" : "neutral"} numeric>
                  {preview.summary.error} error
                </Badge>
                {stale && <span className="text-warning-fg">The text changed since this preview — run it again.</span>}
              </div>
              <div className="max-h-72 overflow-auto rounded-md border border-border scrollbar-thin">
                <table className="w-full min-w-[36rem] text-xs">
                  <thead className="sticky top-0 bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-2 py-1.5 text-right">Line</th>
                      <th className="px-2 py-1.5">Action</th>
                      <th className="px-2 py-1.5">Data</th>
                      <th className="px-2 py-1.5">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.line} className={cn("border-t border-border", row.action === "ERROR" && "bg-danger-bg/40")} data-testid={`csv-row-${row.line}`}>
                        <td className="money px-2 py-1.5 text-right text-ink-subtle">{row.line}</td>
                        <td className="px-2 py-1.5">
                          <StatusChip status={row.action} tone={ACTION_TONES[row.action]} size="sm" />
                        </td>
                        <td className="px-2 py-1.5 text-ink">{summariseData(row.data) || <span className="text-ink-subtle">—</span>}</td>
                        <td className="px-2 py-1.5 text-danger-fg">
                          {row.errors.length > 0 ? (
                            <ul className="list-disc pl-4">
                              {row.errors.map((message, index) => (
                                <li key={index}>{message}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-ink-subtle">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {preview.rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-4 text-center text-ink-subtle">
                          No data rows found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null} data-testid="csv-close-btn">
            {preview?.committed ? "Done" : "Cancel"}
          </Button>
          {!preview?.committed && (
            <>
              <Button variant={preview && !stale ? "outline" : "primary"} leftIcon={Upload} loading={busy === "preview"} disabled={!canPreview} onClick={() => void run(false)} data-testid="csv-preview-btn">
                {preview ? "Re-run preview" : "Preview"}
              </Button>
              <Button variant="gold" loading={busy === "commit"} disabled={!canCommit} onClick={() => void run(true)} data-testid="csv-commit-btn">
                Commit {preview && !stale && preview.summary.error === 0 ? `${formatNumber(preview.summary.create + preview.summary.update)} rows` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
