import type { ColumnDef } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm, type Control, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { applyServerErrors, Button, ConfirmDialog, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, ErrorState, FormError, IconButton, PageHeader, Pagination, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Skeleton, Toolbar, type SheetSize } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useList, useListParams, useMutationWithToast, type UseListParamsResult } from "@/lib/queries";
import { controlOf } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { CMS_BREADCRUMBS } from "./CmsLayout";

export interface CmsRowBase {
  id: string;
  version: number;
  is_published?: boolean;
  is_active?: boolean;
}

export interface FieldsContext<Values extends FieldValues, Row> {
  control: Control<Values>;
  form: UseFormReturn<Values, unknown, unknown>;
  row: Row | null;
  disabled: boolean;
}

export interface CmsCollectionConfig<Row extends CmsRowBase, Values extends FieldValues> {
  title: string;
  description: string;
  singular: string;
  icon: LucideIcon;
  path: string;
  filterKeys?: readonly string[];
  defaultSort?: string;
  searchPlaceholder?: string;
  filters?: (list: UseListParamsResult) => ReactNode;
  columns: ColumnDef<Row, unknown>[];
  mobileCard?: (row: Row, actions: ReactNode) => ReactNode;
  /** Grid renderer (gallery). When set, the table is replaced by a masonry grid. */
  grid?: (row: Row, actions: ReactNode) => ReactNode;
  /** Create pipeline (form values → contract body). */
  schema: z.ZodType<unknown>;
  /** Update pipeline (defaults to `schema`). */
  updateSchema?: z.ZodType<unknown>;
  defaultValues: () => Values;
  toValues: (row: Row) => Values;
  fields: (context: FieldsContext<Values, Row>) => ReactNode;
  /** Boolean flag toggled from the row menu. */
  flagKey?: "is_published" | "is_active";
  flagLabels?: [on: string, off: string];
  sheetSize?: SheetSize;
  emptyDescription?: string;
  /** Extra row actions (e.g. "Open on site"). */
  rowActions?: (row: Row) => ReactNode;
  headerActions?: ReactNode;
}

/** Generic CRUD page for a CMS collection: list (table or grid), create/edit sheet, flag toggle and delete. */
export function CmsCollectionPage<Row extends CmsRowBase, Values extends FieldValues>(config: CmsCollectionConfig<Row, Values>) {
  const { can } = useAuth();
  const canWrite = can("cms.write");
  const list = useListParams({ filterKeys: config.filterKeys ?? [], defaultSort: config.defaultSort ?? "sort_order" });
  const query = useList<Row>(config.path, list.params);
  const [sheet, setSheet] = useState<{ open: boolean; row: Row | null }>({ open: false, row: null });
  const [deleting, setDeleting] = useState<Row | null>(null);
  const invalidate = [[config.path]];
  const flagKey = config.flagKey;
  const [flagOn, flagOff] = config.flagLabels ?? (flagKey === "is_active" ? ["Active", "Inactive"] : ["Published", "Draft"]);

  const toggle = useMutationWithToast<Row, Row>({
    mutationFn: (row) => api.patch<Row>(`${config.path}/${row.id}`, { version: row.version, ...(flagKey ? { [flagKey]: !row[flagKey] } : {}) }, { version: row.version }),
    successMessage: (saved) => (flagKey && saved[flagKey] ? `${config.singular} ${flagOn.toLowerCase()}` : `${config.singular} ${flagOff.toLowerCase()}`),
    invalidate,
    entityLabel: `This ${config.singular.toLowerCase()}`,
  });

  const remove = useMutationWithToast<void, Row>({
    mutationFn: (row) => api.delete(`${config.path}/${row.id}`, { version: row.version }),
    successMessage: `${config.singular} deleted`,
    invalidate,
    entityLabel: `This ${config.singular.toLowerCase()}`,
    onSuccess: () => setDeleting(null),
  });

  const rowMenu = (row: Row): ReactNode =>
    canWrite ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={MoreHorizontal} label={`Actions for ${config.singular.toLowerCase()}`} size="sm" data-no-row-click />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setSheet({ open: true, row })}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {flagKey && <DropdownMenuItem onSelect={() => toggle.mutate(row)}>{row[flagKey] ? `Mark ${flagOff.toLowerCase()}` : `Mark ${flagOn.toLowerCase()}`}</DropdownMenuItem>}
          {config.rowActions?.(row)}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setDeleting(row)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      config.rowActions?.(row) ?? null
    );

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      ...config.columns,
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, width: 56, align: "right", label: "Actions", locked: true },
        cell: ({ row }) => rowMenu(row.original),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.columns, canWrite],
  );

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        breadcrumbs={[...CMS_BREADCRUMBS, { label: config.title }]}
        actions={
          <>
            {config.headerActions}
            {canWrite && (
              <Button leftIcon={Plus} onClick={() => setSheet({ open: true, row: null })} data-testid="cms-new-btn">
                New {config.singular.toLowerCase()}
              </Button>
            )}
          </>
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={config.searchPlaceholder ?? `Search ${config.title.toLowerCase()}…`}
        filters={config.filters?.(list)}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? config.singular.toLowerCase() : config.title.toLowerCase()}` : undefined}
      />

      {config.grid ? (
        <div className="min-w-0">
          {query.isPending && <Skeleton className="h-72 rounded-lg" />}
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} className="rounded-lg border border-border bg-card" />}
          {query.data && rows.length === 0 && <EmptyState icon={config.icon} className="rounded-lg border border-border bg-card" title={`No ${config.title.toLowerCase()} yet`} description={config.emptyDescription} action={canWrite ? <Button leftIcon={Plus} onClick={() => setSheet({ open: true, row: null })}>New {config.singular.toLowerCase()}</Button> : undefined} />}
          {rows.length > 0 && (
            <div className={query.isFetching ? "opacity-70 transition-opacity" : undefined}>
              <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid" data-testid="cms-grid">
                {rows.map((row) => (
                  <div key={row.id}>{config.grid?.(row, rowMenu(row))}</div>
                ))}
              </div>
              <Pagination page={list.page} pageSize={list.pageSize} total={total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} className="mt-3" />
            </div>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          sort={list.sort}
          onSortChange={list.setSort}
          onRowClick={canWrite ? (row) => setSheet({ open: true, row }) : undefined}
          pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
          mobileCard={config.mobileCard ? (row) => <div className="rounded-lg border border-border bg-card p-3 shadow-card">{config.mobileCard?.(row, rowMenu(row))}</div> : undefined}
          emptyState={{ icon: config.icon, title: `No ${config.title.toLowerCase()} yet`, description: config.emptyDescription, action: canWrite ? <Button leftIcon={Plus} onClick={() => setSheet({ open: true, row: null })}>New {config.singular.toLowerCase()}</Button> : undefined }}
          data-testid="cms-table"
        />
      )}

      <CmsFormSheet config={config} open={sheet.open} row={sheet.row} onOpenChange={(open) => setSheet((state) => ({ ...state, open }))} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete this ${config.singular.toLowerCase()}?`}
        description="It disappears from the website immediately. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit sheet                                                  */
/* ------------------------------------------------------------------ */

function CmsFormSheet<Row extends CmsRowBase, Values extends FieldValues>({ config, open, row, onOpenChange }: { config: CmsCollectionConfig<Row, Values>; open: boolean; row: Row | null; onOpenChange: (open: boolean) => void }) {
  const mode = row ? "edit" : "create";
  const schema = mode === "edit" ? (config.updateSchema ?? config.schema) : config.schema;
  const resolver = useMemo(() => contractResolver<Values, unknown>(schema), [schema]);
  const form = useForm<Values, unknown, unknown>({ resolver, defaultValues: (row ? config.toValues(row) : config.defaultValues()) as DefaultValues<Values>, mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      form.reset(row ? config.toValues(row) : config.defaultValues());
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id, row?.version]);

  const save = useMutationWithToast<Row, unknown>({
    mutationFn: (body) => (row ? api.patch<Row>(`${config.path}/${row.id}`, { ...(body as Record<string, unknown>), version: row.version }, { version: row.version }) : api.post<Row>(config.path, body)),
    successMessage: row ? `${config.singular} updated` : `${config.singular} created`,
    invalidate: [[config.path]],
    entityLabel: `This ${config.singular.toLowerCase()}`,
    errorMessage: false,
    onError: (error) => {
      if (error.isVersionConflict) return;
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Sheet open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <SheetContent size={config.sheetSize ?? "lg"}>
        <SheetHeader>
          <SheetTitle>{row ? `Edit ${config.singular.toLowerCase()}` : `New ${config.singular.toLowerCase()}`}</SheetTitle>
          <SheetDescription>{config.description}</SheetDescription>
        </SheetHeader>
        <form
          noValidate
          className="contents"
          onSubmit={form.handleSubmit((output) => {
            setServerError(null);
            save.mutate(output);
          })}
        >
          <SheetBody className="space-y-4">
            <FormError error={serverError} />
            {config.fields({ control, form, row, disabled: save.isPending })}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} data-testid="cms-save">
              {row ? "Save changes" : `Create ${config.singular.toLowerCase()}`}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
