import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { ArchiveRestore, Download, Link2, MoreHorizontal, Pencil, Plus, Power, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import type { MasterRow } from "@kkt/contracts";
import {
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  getColumnChoices,
  IconButton,
  PageHeader,
  StatusChip,
  Switch,
  Toolbar,
} from "@/components/ui";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import NotFoundPage from "@/pages/NotFoundPage";
import { CsvImportDialog } from "./CsvImportDialog";
import { MasterFormSheet } from "./MasterFormSheet";
import { UsageDialog } from "./UsageDialog";
import { masterPath } from "./api";
import { getMasterConfig } from "./masterConfig";
import type { AnyMasterConfig } from "./types";
import { useMasterActiveToggle } from "./useMasterActiveToggle";

/** `/masters/:slug` — resolves the kind and renders its list (or its dedicated page). */
export default function MasterListPage() {
  const { slug } = useParams<{ slug: string }>();
  const config = getMasterConfig(slug);
  if (!config) return <NotFoundPage />;
  const Page = config.Page;
  // Key by kind so URL-synced state and dialogs reset when switching kinds.
  return Page ? <Page key={config.kind} config={config} /> : <GenericMasterList key={config.kind} config={config} />;
}

interface GenericMasterListProps {
  config: AnyMasterConfig;
}

function GenericMasterList({ config }: GenericMasterListProps) {
  const { can } = useAuth();
  const canWrite = can("master.write");
  const path = masterPath(config.slug);
  const list = useListParams({ defaultSort: config.defaultSort });
  const query = useList<MasterRow>(path, list.params);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [editing, setEditing] = useState<{ open: boolean; row: MasterRow | null }>({ open: false, row: null });
  const [importOpen, setImportOpen] = useState(false);
  const [usageRow, setUsageRow] = useState<MasterRow | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<MasterRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const { deactivate, activate, inUse, clearInUse } = useMasterActiveToggle(config);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.exportCsv(path, list.params, `${config.slug}.csv`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<ColumnDef<MasterRow, unknown>[]>(
    () => [
      ...config.columns,
      {
        id: "status",
        header: "Status",
        meta: { sortKey: "is_active", width: 110 },
        cell: ({ row }) => <StatusChip status={row.original.is_active ? "ACTIVE" : "INACTIVE"} size="sm" />,
      },
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, width: 56, align: "right", locked: true, hideOnMobile: false, label: "Actions" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={MoreHorizontal} label={`Actions for ${config.displayName(row.original)}`} size="sm" data-testid={`row-actions-${row.original.id}`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canWrite && (
                <DropdownMenuItem onSelect={() => setEditing({ open: true, row: row.original })}>
                  <Pencil /> Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setUsageRow(row.original)}>
                <Link2 /> Where used
              </DropdownMenuItem>
              {canWrite && (
                <>
                  <DropdownMenuSeparator />
                  {row.original.is_active ? (
                    <DropdownMenuItem destructive onSelect={() => setConfirmDeactivate(row.original)}>
                      <Power /> Deactivate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => activate.mutate(row.original)}>
                      <ArchiveRestore /> Restore
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [config, canWrite, activate],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title={config.label}
        description={config.description}
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Master data", to: "/masters" }, { label: config.label }]}
        actions={
          <>
            <Button variant="outline" leftIcon={Download} loading={exporting} onClick={() => void exportCsv()} data-testid="master-export-csv-btn">
              Export CSV
            </Button>
            {canWrite && (
              <Button variant="outline" leftIcon={Upload} onClick={() => setImportOpen(true)} data-testid="master-import-csv-btn">
                Import CSV
              </Button>
            )}
            {canWrite && (
              <Button leftIcon={Plus} onClick={() => setEditing({ open: true, row: null })} data-testid="master-new-btn">
                New
              </Button>
            )}
          </>
        }
      />

      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={config.searchPlaceholder}
        filters={<Switch size="sm" label="Show inactive" checked={list.includeInactive} onCheckedChange={list.setIncludeInactive} data-testid="master-include-inactive-switch" />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "record" : "records"}` : undefined}
        columns={getColumnChoices(columns, visibility)}
        onColumnToggle={(id, visible) => setVisibility((previous) => ({ ...previous, [id]: visible }))}
      />

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        columnVisibility={visibility}
        onColumnVisibilityChange={setVisibility}
        onRowClick={canWrite ? (row) => setEditing({ open: true, row }) : undefined}
        rowClassName={(row) => (row.is_active ? undefined : "[&>td]:text-ink-subtle")}
        pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        emptyState={{
          icon: config.icon,
          title: list.hasActiveFilters ? `No ${config.label.toLowerCase()} match` : `No ${config.label.toLowerCase()} yet`,
          description: list.hasActiveFilters ? "Try a different search or include inactive records." : `${config.description}`,
          action:
            canWrite && !list.hasActiveFilters ? (
              <>
                <Button leftIcon={Plus} onClick={() => setEditing({ open: true, row: null })}>
                  New {config.singular.toLowerCase()}
                </Button>
                <Button variant="outline" leftIcon={Upload} onClick={() => setImportOpen(true)}>
                  Import CSV
                </Button>
              </>
            ) : undefined,
        }}
        data-testid={`master-table-${config.slug}`}
      />

      <MasterFormSheet config={config} open={editing.open} onOpenChange={(open) => setEditing((state) => ({ ...state, open }))} row={editing.row} />
      <CsvImportDialog config={config} open={importOpen} onOpenChange={setImportOpen} />
      <UsageDialog config={config} row={usageRow} open={usageRow !== null} onOpenChange={(open) => !open && setUsageRow(null)} />
      <UsageDialog config={config} row={inUse?.row ?? null} preset={inUse?.usage ?? null} blocked open={inUse !== null} onOpenChange={(open) => !open && clearInUse()} />
      <ConfirmDialog
        open={confirmDeactivate !== null}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
        title={`Deactivate ${config.singular.toLowerCase()}?`}
        description={confirmDeactivate ? `${config.displayName(confirmDeactivate)} will disappear from dropdowns. Existing records that reference it keep working, and you can restore it later.` : undefined}
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={async () => {
          if (confirmDeactivate) await deactivate.mutateAsync(confirmDeactivate).catch(() => undefined);
        }}
      />
    </>
  );
}
