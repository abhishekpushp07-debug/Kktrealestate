import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
  type RowSelectionState,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { BREAKPOINTS, cn, useMediaQuery } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { ErrorState } from "./error-state";
import { Pagination, type PaginationProps } from "./pagination";
import { Skeleton } from "./skeleton";
import type { ColumnChoice } from "./toolbar";

declare module "@tanstack/react-table" {
  // Module augmentation must repeat TanStack's type parameters verbatim, even though these fields do not use them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- TData/TValue are required by declaration merging
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Cell alignment; "right" also applies tabular figures (money). */
    align?: "left" | "right" | "center";
    /** Server sort field (defaults to the column id); false disables sorting for this column. */
    sortKey?: string | false;
    /** Fixed width (px or CSS length). */
    width?: number | string;
    headerClassName?: string;
    cellClassName?: string;
    /** Label for the column chooser / mobile cards (defaults to a string header). */
    label?: string;
    /** Cannot be hidden from the column chooser. */
    locked?: boolean;
    /** Hide from mobile cards. */
    hideOnMobile?: boolean;
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type DataTablePagination = Omit<PaginationProps, "className" | "disabled">;

export interface DataTableBulkContext<T> {
  ids: string[];
  /** Selected rows present on the current page. */
  rows: T[];
  clear: () => void;
}

export interface DataTableMobileContext {
  selected: boolean;
  toggle: () => void;
}

export interface DataTableProps<T> {
  /** Declare as `ColumnDef<Row>[]` with `accessorKey` and read `row.original` in cells. */
  columns: readonly ColumnDef<T, unknown>[];
  data: readonly T[];
  getRowId: (row: T, index: number) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Server-side sort: "field" | "-field" | null. */
  sort?: string | null;
  onSortChange?: (sort: string | null) => void;
  pagination?: DataTablePagination;
  selectable?: boolean;
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Rendered in the bulk bar while rows are selected. */
  bulkActions?: (context: DataTableBulkContext<T>) => ReactNode;
  onRowClick?: (row: T) => void;
  /** Card renderer for phones (<768 px). A generic label/value card is used when omitted. */
  mobileCard?: (row: T, context: DataTableMobileContext) => ReactNode;
  emptyState?: Partial<Pick<EmptyStateProps, "icon" | "title" | "description" | "action">>;
  /** Keep the first data column visible while scrolling horizontally (default true). */
  pinFirstColumn?: boolean;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (state: VisibilityState) => void;
  /** Scroll container height (sticky header + virtualisation). */
  maxHeight?: string;
  /** Rows above which the body is virtualised (default 100). */
  virtualizeAt?: number;
  rowClassName?: (row: T) => string | undefined;
  /** Extra bar under the table (totals, legends). */
  footer?: ReactNode;
  density?: "normal" | "compact";
  className?: string;
  "data-testid"?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function resolveColumnId<T>(def: ColumnDef<T, unknown>): string {
  if (def.id) return def.id;
  if ("accessorKey" in def && typeof def.accessorKey === "string") return def.accessorKey.replaceAll(".", "_");
  return typeof def.header === "string" ? def.header : "";
}

function resolveColumnLabel<T>(def: ColumnDef<T, unknown>): string {
  return def.meta?.label ?? (typeof def.header === "string" ? def.header : resolveColumnId(def));
}

/** Column chooser entries for the Toolbar. */
export function getColumnChoices<T>(
  columns: readonly ColumnDef<T, unknown>[],
  visibility: VisibilityState = {},
): ColumnChoice[] {
  return columns
    .map((def) => ({
      id: resolveColumnId(def),
      label: resolveColumnLabel(def),
      visible: visibility[resolveColumnId(def)] !== false,
      locked: def.meta?.locked,
    }))
    .filter((choice) => choice.id !== "");
}

function nextSort(current: string | null | undefined, key: string): string | null {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return null;
  return key;
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=menuitem],[data-no-row-click]";

const ROW_HEIGHT = { normal: 40, compact: 32 } as const;

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export function DataTable<T>({
  columns,
  data,
  getRowId,
  loading = false,
  error,
  onRetry,
  sort,
  onSortChange,
  pagination,
  selectable = false,
  selectedIds,
  onSelectionChange,
  bulkActions,
  onRowClick,
  mobileCard,
  emptyState,
  pinFirstColumn = true,
  columnVisibility,
  onColumnVisibilityChange,
  maxHeight = "calc(100dvh - 15rem)",
  virtualizeAt = 100,
  rowClassName,
  footer,
  density = "normal",
  className,
  ...rest
}: DataTableProps<T>) {
  const isMobile = useMediaQuery(BREAKPOINTS.mobile);
  const [internalVisibility, setInternalVisibility] = useState<VisibilityState>({});
  const [internalSelection, setInternalSelection] = useState<string[]>([]);
  const visibility = columnVisibility ?? internalVisibility;
  const setVisibility = onColumnVisibilityChange ?? setInternalVisibility;
  const selected = selectedIds ?? internalSelection;
  const setSelected = onSelectionChange ?? setInternalSelection;

  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries(selected.map((id) => [id, true])),
    [selected],
  );

  const handleSelectionChange = useCallback(
    (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setSelected(Object.keys(next).filter((id) => next[id]));
    },
    [rowSelection, setSelected],
  );

  const handleVisibilityChange = useCallback(
    (updater: Updater<VisibilityState>) => {
      setVisibility(typeof updater === "function" ? updater(visibility) : updater);
    },
    [visibility, setVisibility],
  );

  // TanStack Table returns non-memoisable functions; this app does not run the React Compiler and DataTable is not memoised.
  // eslint-disable-next-line react-hooks/incompatible-library -- useReactTable has no compiler-compatible alternative
  const table = useReactTable<T>({
    data: data as T[],
    columns: columns as ColumnDef<T, unknown>[],
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: { rowSelection, columnVisibility: visibility },
    enableRowSelection: selectable,
    onRowSelectionChange: handleSelectionChange,
    onColumnVisibilityChange: handleVisibilityChange,
    manualSorting: true,
    manualPagination: true,
  });

  const rows = table.getRowModel().rows;
  const leafColumns = table.getVisibleLeafColumns();
  const virtualize = !isMobile && rows.length > virtualizeAt;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowHeight = ROW_HEIGHT[density];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: virtualize,
    // First paint renders a full viewport of rows before the scroll element is measured.
    initialRect: { width: 1024, height: 640 },
  });

  const clearSelection = useCallback(() => setSelected([]), [setSelected]);
  const selectedRows = useMemo(
    () => rows.filter((row) => rowSelection[row.id]).map((row) => row.original),
    [rows, rowSelection],
  );

  const handleRowClick = (row: Row<T>) => (event: MouseEvent<HTMLElement>) => {
    if (!onRowClick) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick(row.original);
  };
  const handleRowKey = (row: Row<T>) => (event: KeyboardEvent<HTMLElement>) => {
    if (!onRowClick || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowClick(row.original);
    }
  };

  const hasError = error !== undefined && error !== null;
  const initialLoading = loading && rows.length === 0;
  const showError = hasError && !loading;
  const showEmpty = !loading && !hasError && rows.length === 0;
  const skeletonCount = Math.min(pagination?.pageSize ?? 8, 12);
  const colSpan = leafColumns.length + (selectable ? 1 : 0);
  const pinOffset = selectable ? 40 : 0;

  const bulkBar =
    selectable && selected.length > 0 ? (
      <div
        role="region"
        aria-label="Bulk actions"
        className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-navy-800 bg-navy-950 px-3 py-2 text-sm text-white shadow-card animate-slide-down"
      >
        <span className="money font-semibold">{selected.length.toLocaleString("en-IN")} selected</span>
        <div className="flex flex-wrap items-center gap-2">
          {bulkActions?.({ ids: [...selected], rows: selectedRows, clear: clearSelection })}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-navy-100 hover:bg-navy-800 hover:text-white"
          leftIcon={X}
          onClick={clearSelection}
        >
          Clear
        </Button>
      </div>
    ) : null;

  const paginationBar = pagination ? <Pagination {...pagination} className="mt-3" disabled={loading} /> : null;

  /* ---------------------------- mobile cards --------------------------- */

  if (isMobile) {
    return (
      <div className={cn("min-w-0", className)} data-testid={rest["data-testid"]}>
        {bulkBar}
        <div className="space-y-2" aria-busy={loading || undefined}>
          {initialLoading &&
            Array.from({ length: Math.min(skeletonCount, 6) }, (_, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          {showError && (
            <ErrorState error={error} onRetry={onRetry} compact className="rounded-lg border border-border bg-card" />
          )}
          {showEmpty && (
            <EmptyState
              compact
              className="rounded-lg border border-border bg-card"
              title="Nothing here yet"
              {...emptyState}
            />
          )}
          {!initialLoading &&
            !hasError &&
            rows.map((row) => {
              const isSelected = Boolean(rowSelection[row.id]);
              const toggle = () => row.toggleSelected();
              if (mobileCard) {
                return (
                  <div key={row.id} className={cn(loading && "opacity-60")}>
                    {mobileCard(row.original, { selected: isSelected, toggle })}
                  </div>
                );
              }
              const cells = row.getVisibleCells().filter((cell) => !cell.column.columnDef.meta?.hideOnMobile);
              const [titleCell, ...restCells] = cells;
              return (
                <div
                  key={row.id}
                  // focusable like a desktop row (Enter opens it) but not role=button: cards hold checkboxes and action menus
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={handleRowClick(row)}
                  onKeyDown={handleRowKey(row)}
                  className={cn(
                    "rounded-lg border bg-card p-3 shadow-card",
                    isSelected ? "border-gold ring-1 ring-gold/40" : "border-border",
                    onRowClick && "cursor-pointer focus-ring active:bg-navy-50",
                    loading && "opacity-60",
                    rowClassName?.(row.original),
                  )}
                >
                  <div className="flex items-start gap-2">
                    {selectable && (
                      <span className="pt-0.5">
                        <Checkbox checked={isSelected} onCheckedChange={toggle} aria-label="Select row" />
                      </span>
                    )}
                    {titleCell && (
                      <div className="min-w-0 flex-1 text-sm font-semibold text-navy-950">
                        {flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                      </div>
                    )}
                  </div>
                  {restCells.length > 0 && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {restCells.map((cell) => (
                        <div key={cell.id} className="min-w-0">
                          <dt className="label-caps truncate">{resolveColumnLabel(cell.column.columnDef)}</dt>
                          <dd
                            className={cn("truncate text-sm", cell.column.columnDef.meta?.align === "right" && "money")}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              );
            })}
        </div>
        {footer}
        {paginationBar}
      </div>
    );
  }

  /* ------------------------------ desktop ------------------------------ */

  const virtualRows = virtualize ? virtualizer.getVirtualItems() : null;
  const paddingTop = virtualRows && virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows && virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;
  const renderedRows = virtualRows
    ? virtualRows.map((virtual) => rows[virtual.index]).filter((row): row is Row<T> => row !== undefined)
    : rows;
  const hasFooter = leafColumns.some((column) => column.columnDef.footer !== undefined);

  return (
    <div className={cn("min-w-0", className)} data-testid={rest["data-testid"]}>
      {bulkBar}
      <div className="relative overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {loading && rows.length > 0 && (
          <div
            className="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-navy-50"
            role="progressbar"
            aria-label="Refreshing"
          >
            <div
              className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-gold to-transparent"
              style={{ backgroundSize: "200% 100%" }}
            />
          </div>
        )}
        {/* a scroll box with only text inside must itself be focusable so keyboard users can scroll it (WCAG 2.1.1) */}
        <div
          ref={scrollRef}
          className="overflow-auto scrollbar-thin focus-ring-inset"
          style={{ maxHeight }}
          aria-busy={loading || undefined}
          {...(onRowClick || selectable ? {} : { tabIndex: 0, role: "region", "aria-label": "Table" })}
        >
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {selectable && (
                    <th
                      scope="col"
                      className="sticky left-0 z-30 h-10 w-10 border-b border-border bg-surface px-3 text-left align-middle"
                    >
                      <Checkbox
                        aria-label="Select all rows on this page"
                        checked={
                          table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false
                        }
                        onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
                      />
                    </th>
                  )}
                  {headerGroup.headers.map((header, index) => {
                    const meta = header.column.columnDef.meta;
                    const sortKey = meta?.sortKey === false ? null : (meta?.sortKey ?? header.column.id);
                    const sortable =
                      Boolean(onSortChange) &&
                      sortKey !== null &&
                      (meta?.sortKey !== undefined || header.column.accessorFn !== undefined);
                    const active = sortKey !== null && (sort === sortKey || sort === `-${sortKey}`);
                    const direction = sortKey !== null && sort === `-${sortKey}` ? "desc" : active ? "asc" : null;
                    const pinned = pinFirstColumn && index === 0;
                    const SortIcon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          active ? (direction === "desc" ? "descending" : "ascending") : sortable ? "none" : undefined
                        }
                        style={
                          pinned
                            ? { left: pinOffset, width: meta?.width, minWidth: meta?.width }
                            : { width: meta?.width, minWidth: meta?.width }
                        }
                        className={cn(
                          "h-10 border-b border-border bg-surface px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-ink-subtle whitespace-nowrap",
                          meta?.align === "right" && "text-right",
                          meta?.align === "center" && "text-center",
                          pinned && "sticky z-30 pinned-shadow",
                          meta?.headerClassName,
                        )}
                      >
                        {header.isPlaceholder ? null : sortable && sortKey ? (
                          <button
                            type="button"
                            onClick={() => onSortChange?.(nextSort(sort, sortKey))}
                            className={cn(
                              "group -mx-1 inline-flex min-h-6 max-w-full items-center gap-1 rounded-xs px-1 py-0.5 hover:text-navy-950 focus-ring",
                              active && "text-navy-950",
                              meta?.align === "right" && "flex-row-reverse",
                            )}
                          >
                            <span className="truncate">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            <SortIcon
                              className={cn(
                                "size-3.5 shrink-0",
                                active ? "text-gold-text" : "text-ink-subtle/60 group-hover:text-ink-subtle",
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className={cn(loading && rows.length > 0 && "opacity-60 transition-opacity")}>
              {initialLoading &&
                Array.from({ length: skeletonCount }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                    {selectable && (
                      <td className="h-10 border-b border-border px-3">
                        <Skeleton className="size-4" />
                      </td>
                    )}
                    {leafColumns.map((column, index) => (
                      <td
                        key={column.id}
                        className={cn(
                          "h-10 border-b border-border px-3",
                          pinFirstColumn && index === 0 && "sticky left-0 bg-card",
                        )}
                        style={pinFirstColumn && index === 0 ? { left: pinOffset } : undefined}
                      >
                        <Skeleton className={cn("h-3.5", index === 0 ? "w-32" : "w-20")} />
                      </td>
                    ))}
                  </tr>
                ))}
              {showError && (
                <tr>
                  <td colSpan={colSpan} className="p-0">
                    <ErrorState error={error} onRetry={onRetry} compact />
                  </td>
                </tr>
              )}
              {showEmpty && (
                <tr>
                  <td colSpan={colSpan} className="p-0">
                    <EmptyState compact title="Nothing here yet" {...emptyState} />
                  </td>
                </tr>
              )}
              {paddingTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: paddingTop }} className="p-0" />
                </tr>
              )}
              {!initialLoading &&
                !hasError &&
                renderedRows.map((row) => {
                  const isSelected = Boolean(rowSelection[row.id]);
                  return (
                    <tr
                      key={row.id}
                      data-index={row.index}
                      data-state={isSelected ? "selected" : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={handleRowClick(row)}
                      onKeyDown={handleRowKey(row)}
                      className={cn(
                        "group/row",
                        onRowClick && "cursor-pointer focus-ring-inset",
                        isSelected ? "[&>td]:bg-gold-light/70" : "[&>td]:bg-card hover:[&>td]:bg-navy-50/70",
                        rowClassName?.(row.original),
                      )}
                    >
                      {selectable && (
                        <td
                          className={cn(
                            "sticky left-0 z-10 w-10 border-b border-border px-3 align-middle",
                            density === "normal" ? "h-10" : "h-8",
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => row.toggleSelected()}
                            aria-label="Select row"
                          />
                        </td>
                      )}
                      {row.getVisibleCells().map((cell, index) => {
                        const meta = cell.column.columnDef.meta;
                        const pinned = pinFirstColumn && index === 0;
                        return (
                          <td
                            key={cell.id}
                            style={
                              pinned
                                ? { left: pinOffset, width: meta?.width, minWidth: meta?.width }
                                : { width: meta?.width, minWidth: meta?.width }
                            }
                            className={cn(
                              "border-b border-border px-3 align-middle whitespace-nowrap text-ink",
                              density === "normal" ? "h-10" : "h-8 text-xs",
                              meta?.align === "right" && "money text-right",
                              meta?.align === "center" && "text-center",
                              pinned && "sticky z-10 font-medium text-navy-950 pinned-shadow",
                              meta?.cellClassName,
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: paddingBottom }} className="p-0" />
                </tr>
              )}
            </tbody>
            {hasFooter && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                {table.getFooterGroups().map((footerGroup) => (
                  <tr key={footerGroup.id}>
                    {selectable && <td className="sticky left-0 z-30 border-t border-border-strong bg-surface" />}
                    {footerGroup.headers.map((header, index) => {
                      const meta = header.column.columnDef.meta;
                      const pinned = pinFirstColumn && index === 0;
                      return (
                        <td
                          key={header.id}
                          style={pinned ? { left: pinOffset } : undefined}
                          className={cn(
                            "h-10 border-t border-border-strong bg-surface px-3 text-xs font-semibold text-navy-950 whitespace-nowrap",
                            meta?.align === "right" && "money text-right",
                            pinned && "sticky z-30 pinned-shadow",
                          )}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.footer, header.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
        {footer && (
          <div className="border-t border-border bg-surface/60 px-3 py-2 text-xs text-ink-muted">{footer}</div>
        )}
      </div>
      {paginationBar}
    </div>
  );
}
