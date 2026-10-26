import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, DatabaseBackup, Download, ShieldAlert, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { EXPORT_STATUS_LABELS, type AdminBackupRow } from "@kkt/contracts";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatusChip,
} from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { ForbiddenPage } from "@/pages/ForbiddenPage";
import { Notice } from "@/features/inventory/components";
import { BACKUPS_PATH, backupLink, createBackup, hasActive, openDownload, useBackups } from "./api";
import { formatBytes } from "./SystemHealthPage";

export const RESTORE_COMMAND =
  "pnpm --filter @kkt/api restore -- --file <backup.zip> --database-url postgres://…/<empty database> --confirm";

/** `/admin/backups` — Super Admin: queue an application backup (job BACKUP_EXPORT), follow its status, download it, restore instructions. */
export default function BackupsPage() {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const backups = useBackups();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const rows = backups.data?.items ?? [];
  const inFlight = hasActive(rows);

  const create = async () => {
    setCreating(true);
    try {
      const row = await createBackup(includeSensitive);
      toast.success("Backup queued — it runs on the worker; this page updates when it is ready");
      queryClient.setQueryData([BACKUPS_PATH], (previous: { items: AdminBackupRow[] } | undefined) => ({
        items: [row, ...(previous?.items ?? []).filter((item) => item.id !== row.id)],
      }));
    } finally {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: [BACKUPS_PATH] });
    }
  };

  const download = async (row: AdminBackupRow) => {
    setLinking(row.id);
    try {
      const link = await backupLink(row.id);
      openDownload(link.download_url);
      toast.success(`Downloading ${link.file_name} — the link works for 15 minutes`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLinking(null);
    }
  };

  const columns = useMemo<ColumnDef<AdminBackupRow, unknown>[]>(
    () => [
      {
        accessorKey: "generated_at",
        header: "Requested",
        meta: { locked: true, sortKey: false },
        cell: ({ row }) => (
          <span className="block leading-tight">
            <span className="block text-sm font-semibold text-navy-950">
              {formatDateTime(row.original.generated_at)}
            </span>
            <span className="block text-2xs text-ink-subtle">
              {row.original.generated_by ?? "—"}
              {row.original.include_sensitive ? " · with secrets" : " · secrets stripped"}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { sortKey: false, width: 110 },
        cell: ({ row }) => (
          <StatusChip status={row.original.status} label={EXPORT_STATUS_LABELS[row.original.status]} size="sm" />
        ),
      },
      {
        id: "contents",
        header: "Contents",
        meta: { sortKey: false },
        cell: ({ row }) =>
          row.original.status === "DONE" ? (
            <span className="money text-xs">
              {formatNumber(row.original.table_count ?? 0)} tables · {formatNumber(row.original.row_count ?? 0)} rows ·{" "}
              {formatBytes(row.original.size_bytes)}
            </span>
          ) : row.original.error ? (
            <span className="block max-w-md whitespace-normal break-words text-xs text-danger-fg">
              {row.original.error}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
          ),
      },
      {
        accessorKey: "storage_expires_at",
        header: "Kept until",
        meta: { sortKey: false, hideOnMobile: true },
        cell: ({ row }) =>
          row.original.storage_expires_at ? (
            <span className="text-xs" title={formatDateTime(row.original.storage_expires_at)}>
              {formatRelative(row.original.storage_expires_at)}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
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
              data-testid={`backup-download-${row.original.id}`}
            >
              Download
            </Button>
          ) : null,
      },
    ],
    [linking],
  );

  if (!isSuperAdmin) return <ForbiddenPage />;

  return (
    <>
      <PageHeader
        title="Backups"
        description="Application backups: every table of this company in one consistent snapshot, as a ZIP of NDJSON files with a manifest and checksums. Archives are kept for 24 hours."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "Backups" }]}
        actions={
          <>
            <Button variant="outline" leftIcon={Clock} asChild>
              <Link to="/admin/jobs">Jobs</Link>
            </Button>
            <Button
              leftIcon={DatabaseBackup}
              disabled={inFlight || creating}
              loading={creating}
              onClick={() => setConfirmOpen(true)}
              data-testid="backup-create-btn"
            >
              {inFlight ? "Backup in progress…" : "Create backup"}
            </Button>
          </>
        }
      />
      {inFlight && (
        <Notice tone="info" className="mb-4">
          A backup is being written. Only one backup per company runs at a time; this page refreshes until it is ready.
        </Notice>
      )}
      <Card className="mb-4">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            loading={backups.isFetching && !backups.data}
            error={backups.error}
            onRetry={() => void backups.refetch()}
            emptyState={{
              icon: DatabaseBackup,
              title: "No backups yet",
              description: "Create one before an upgrade or to move a company to another installation.",
            }}
            data-testid="backups-table"
          />
        </CardContent>
      </Card>
      <Card data-testid="restore-instructions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-ink-subtle" aria-hidden="true" /> Restoring a backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-ink-muted">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Download the ZIP while its link is valid and keep it somewhere safe; the server deletes it after 24 hours.
            </li>
            <li>Create a new, empty PostgreSQL database. The restore refuses a database that already holds rows.</li>
            <li>
              On a machine with the API code and its environment (the restore needs the same{" "}
              <span className="font-mono">FIELD_ENCRYPTION_KEY</span> and <span className="font-mono">JWT_SECRET</span>
              ), run:
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-navy-950 p-3 font-mono text-xs text-white">
                {RESTORE_COMMAND}
              </pre>
            </li>
            <li>
              The command checks every file's SHA-256, migrates the empty database, loads the tables in foreign-key
              order in one transaction, compares the row counts and runs the integrity report.
            </li>
            <li>
              A backup made without secrets cannot sign anyone in or decrypt PAN / Aadhaar; the command refuses it
              unless you add <span className="font-mono">--allow-stripped</span>.
            </li>
          </ol>
          <p className="text-xs">Full steps, point-in-time recovery and the nightly database dumps: docs/RESTORE.md.</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Create a backup now?"
        description="The worker reads every table of this company in one snapshot. Large companies take a few minutes; you get a notification when it is ready."
        confirmLabel="Create backup"
        onConfirm={create}
      >
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={includeSensitive}
            onCheckedChange={(checked) => setIncludeSensitive(checked === true)}
            aria-describedby="backup-sensitive-hint"
            data-testid="backup-include-sensitive"
          />
          <span>
            <span className="font-medium text-navy-950">Include secrets</span>
            <span id="backup-sensitive-hint" className="block text-xs text-ink-subtle">
              <ShieldAlert className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />
              Password hashes, MFA secrets and encrypted PAN / Aadhaar / bank numbers. Needed for a full
              disaster-recovery restore; handle the file as highly sensitive.
            </span>
          </span>
        </label>
      </ConfirmDialog>
    </>
  );
}
