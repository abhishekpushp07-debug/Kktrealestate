import { Columns3, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn, useDebouncedCallback } from "@/lib/utils";
import { Button, IconButton } from "./button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./dropdown-menu";
import { ExportControl, type ExportSource } from "./export-control";
import { Input } from "./input";

export interface ColumnChoice {
  id: string;
  label: string;
  visible: boolean;
  /** Pinned columns cannot be hidden. */
  locked?: boolean;
}

export interface ToolbarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchDelayMs?: number;
  /** Filter controls (Select, Combobox, DateInput…). */
  filters?: ReactNode;
  /** Shown when there are active filters. */
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  /** Custom CSV export; may return the X-Export-* facts (api.exportCsv) so a truncated file offers "Export all". */
  onExportCsv?: () => void | Promise<unknown>;
  exporting?: boolean;
  /** The list behind the toolbar: enables "Export all" (POST /exports) and, without onExportCsv, the CSV download itself. */
  exportSource?: ExportSource;
  /** Rows matching the filters; above 10,000 the export button becomes "Export all". */
  exportTotal?: number | null;
  columns?: readonly ColumnChoice[];
  onColumnToggle?: (id: string, visible: boolean) => void;
  /** Right-aligned slot (primary action, view switch). */
  actions?: ReactNode;
  /** Total count hint rendered after the search ("1,248 results"). */
  summary?: ReactNode;
  className?: string;
}

/** Search + filters + CSV export + column chooser row above a DataTable. */
export function Toolbar({
  search = "",
  onSearchChange,
  searchPlaceholder = "Search…",
  searchDelayMs = 300,
  filters,
  onClearFilters,
  hasActiveFilters = false,
  onExportCsv,
  exporting = false,
  exportSource,
  exportTotal,
  columns,
  onColumnToggle,
  actions,
  summary,
  className,
}: ToolbarProps) {
  const [draft, setDraft] = useState(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const emit = useDebouncedCallback((value: string) => onSearchChange?.(value), searchDelayMs);

  useEffect(() => {
    setDraft(search);
  }, [search]);

  const showSearch = Boolean(onSearchChange);
  const showFilters = Boolean(filters);

  return (
    <div className={cn("mb-3 flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {showSearch && (
          <div className="relative w-full min-w-0 sm:w-72">
            <Input
              type="search"
              role="searchbox"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              leftIcon={Search}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                emit(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearchChange?.(draft);
                if (event.key === "Escape" && draft) {
                  setDraft("");
                  onSearchChange?.("");
                }
              }}
              className="pr-8"
            />
            {draft && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-subtle hover:bg-navy-50 hover:text-navy-950 focus-ring"
                onClick={() => {
                  setDraft("");
                  onSearchChange?.("");
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {showFilters && (
          <Button
            variant="outline"
            leftIcon={SlidersHorizontal}
            className="sm:hidden"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters{hasActiveFilters ? " •" : ""}
          </Button>
        )}
        {showFilters && <div className="hidden flex-wrap items-center gap-2 sm:flex">{filters}</div>}
        {hasActiveFilters && onClearFilters && (
          <Button variant="ghost" size="sm" leftIcon={X} onClick={onClearFilters} className="hidden sm:inline-flex">
            Clear
          </Button>
        )}
        {summary && <span className="hidden text-xs text-ink-subtle md:inline">{summary}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {columns && onColumnToggle && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={Columns3} label="Choose columns" variant="outline" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto scrollbar-thin">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.visible}
                    disabled={column.locked}
                    onCheckedChange={(checked) => onColumnToggle(column.id, checked === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {(onExportCsv || exportSource) && <ExportControl source={exportSource} total={exportTotal} onExportCsv={onExportCsv} exporting={exporting} />}
          {actions}
        </div>
      </div>
      {showFilters && filtersOpen && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:hidden [&>*]:w-full">
          {filters}
          {hasActiveFilters && onClearFilters && (
            <Button variant="ghost" size="sm" leftIcon={X} onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
