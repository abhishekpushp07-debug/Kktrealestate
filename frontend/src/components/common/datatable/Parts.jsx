import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function TableToolbar({ testId, search, setSearch, searchPlaceholder, toolbar, mobile, dense, setDense, labelled, hidden, toggleCol, exportPath, exportCsv }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      {setSearch && (
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-txt-secondary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="h-9 pl-8" data-testid={`${testId}-search`} />
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}
        {!mobile && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-9" aria-label="Columns" data-testid={`${testId}-columns-btn`}><Columns3 className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuCheckboxItem checked={!dense} onCheckedChange={() => setDense(!dense)}>Comfortable density</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {labelled.map((c) => <DropdownMenuCheckboxItem key={c.key} checked={!hidden.has(c.key)} onCheckedChange={() => toggleCol(c.key)}>{c.label}</DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>}
        {exportPath && <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} data-testid={`${testId}-export-csv`}><Download className="mr-1 h-4 w-4" />CSV</Button>}
      </div>
    </div>
  );
}

export function TableHeader({ cols, sort, toggleSort, testId, selectable, allSelected, onSelectAll }) {
  return (
    <thead className="sticky top-0 z-10 bg-warm-50">
      <tr className="border-b border-warm-200">
        {selectable && <th className="w-8 px-3 py-2.5"><Checkbox checked={allSelected} onCheckedChange={onSelectAll} data-testid={`${testId}-select-all`} /></th>}
        {cols.map((c, i) => (
          <th key={c.key} style={{ minWidth: c.minWidth || (c.align === "right" ? 120 : 110) }} className={cn("whitespace-nowrap px-4 py-2.5 text-left label-xs", c.align === "right" && "text-right", c.sortable && "cursor-pointer select-none hover:text-ink-950", i === 0 && "sticky left-0 z-20 bg-warm-50", c.className)} onClick={() => c.sortable && toggleSort(c.key)} data-testid={`${testId}-col-${c.key}`}>
            <span className="inline-flex items-center gap-1">{c.label}
              {c.sortable && (sort === c.key ? <ArrowUp className="h-3 w-3 text-gold" /> : sort === `-${c.key}` ? <ArrowDown className="h-3 w-3 text-gold" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />)}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function TablePagination({ testId, total, page, pages, pageSize, setPage, setPageSize, pageSizes }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-txt-secondary">
      <span data-testid={`${testId}-total`}>{total} record{total === 1 ? "" : "s"} · page {page} of {pages}</span>
      <div className="flex items-center gap-2">
        {setPageSize && <select className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-ink-950" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page" data-testid={`${testId}-page-size`}>{pageSizes.map((n) => <option key={n} value={n}>{n} / page</option>)}</select>}
        <Button variant="outline" size="sm" className="h-7 border-slate-300 px-2 text-ink-950" disabled={page <= 1} onClick={() => setPage?.(page - 1)} aria-label="Previous page" data-testid={`${testId}-prev`}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        <Button variant="outline" size="sm" className="h-7 border-slate-300 px-2 text-ink-950" disabled={page >= pages} onClick={() => setPage?.(page + 1)} aria-label="Next page" data-testid={`${testId}-next`}><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}
