import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "./Bits";

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => { const mq = window.matchMedia("(max-width: 767px)"); const h = (e) => setM(e.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, []);
  return m;
}

/* DataTable v2: min column widths, sticky first column, right-edge scroll affordance, card rows < 768px, sticky totals footer, page-size picker. */
export function DataTable({ columns, items = [], total = 0, loading, page = 1, pageSize = 20, setPage, setPageSize, pageSizes = [20, 50, 100], search, setSearch, sort, setSort, rowKey = "id", onRowClick, searchPlaceholder = "Search…", toolbar, empty, testId = "data-table", dense: denseDefault = true, exportPath, selectable, selected = new Set(), onSelect, footer, cardTitle, cardFields }) {
  const [dense, setDense] = useState(denseDefault);
  const scrollRef = useRef(null);
  const [atEnd, setAtEnd] = useState(true);
  const mobile = useIsMobile();
  const virtual = items.length > 100 && !mobile;
  const rowH = dense ? 38 : 46;
  const rv = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12, enabled: virtual });
  const vrows = virtual ? rv.getVirtualItems() : null;
  const padTop = vrows?.length ? vrows[0].start : 0;
  const padBottom = vrows?.length ? rv.getTotalSize() - vrows[vrows.length - 1].end : 0;
  const [hidden, setHidden] = useState(() => new Set(JSON.parse(localStorage.getItem(`kkt:cols:${testId}`) || "[]")));
  const toggleCol = (k) => { const n = new Set(hidden); n.has(k) ? n.delete(k) : n.add(k); setHidden(n); localStorage.setItem(`kkt:cols:${testId}`, JSON.stringify([...n])); };
  const cols = columns.filter((c) => !hidden.has(c.key));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const toggleSort = (key) => { if (setSort) setSort(sort === key ? `-${key}` : key); };
  const allSelected = selectable && items.length > 0 && items.every((r) => selected.has(r[rowKey]));
  const onScroll = () => { const el = scrollRef.current; if (el) setAtEnd(el.scrollWidth - el.clientWidth - el.scrollLeft < 4); };
  useEffect(() => { onScroll(); }, [items, cols.length]); // eslint-disable-line
  const exportCsv = async () => {
    const { default: api } = await import("@/lib/api");
    const r = await api.get(exportPath, { params: { format: "csv", search: search || undefined }, responseType: "blob" });
    const url = URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = url; a.download = `${testId}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const cell = (c, row) => (c.render ? c.render(row) : row[c.key] ?? "—");
  const cardCols = cardFields ? cols.filter((c) => cardFields.includes(c.key)) : cols.slice(0, 6);
  return (
    <div className="card-elev overflow-hidden" data-testid={testId}>
      {(setSearch || toolbar || exportPath) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {setSearch && (
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="h-9 pl-8" data-testid={`${testId}-search`} />
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}
            {!mobile && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-9" aria-label="Columns" data-testid={`${testId}-columns-btn`}><Columns3 className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuCheckboxItem checked={!dense} onCheckedChange={() => setDense(!dense)}>Comfortable density</DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {columns.filter((c) => c.label).map((c) => <DropdownMenuCheckboxItem key={c.key} checked={!hidden.has(c.key)} onCheckedChange={() => toggleCol(c.key)}>{c.label}</DropdownMenuCheckboxItem>)}
              </DropdownMenuContent>
            </DropdownMenu>}
            {exportPath && <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} data-testid={`${testId}-export-csv`}><Download className="mr-1 h-4 w-4" />CSV</Button>}
          </div>
        </div>
      )}
      {mobile ? (
        <div className="divide-y divide-slate-100" data-testid={`${testId}-cards`}>
          {loading ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="space-y-2 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>)
            : items.length === 0 ? <div className="p-6">{empty || <EmptyState title="No records found" description="Try adjusting your search or filters." />}</div>
            : items.map((row, idx) => {
              const [first, ...rest] = cardCols;
              return (
                <div key={row[rowKey] ?? idx} onClick={() => onRowClick?.(row)} className={cn("p-4", onRowClick && "cursor-pointer active:bg-slate-50")} data-testid={`${testId}-row-${row[rowKey] ?? idx}`}>
                  <div className="mb-2 flex items-start justify-between gap-3"><div className="min-w-0 text-sm font-semibold text-navy">{cardTitle ? cardTitle(row) : first && cell(first, row)}</div>{selectable && <Checkbox checked={selected.has(row[rowKey])} onClick={(e) => e.stopPropagation()} onCheckedChange={(c) => { const n = new Set(selected); c ? n.add(row[rowKey]) : n.delete(row[rowKey]); onSelect(n); }} />}</div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">{rest.map((c) => <div key={c.key} className="min-w-0"><dt className="label-xs !text-[10px]">{c.label}</dt><dd className="truncate text-sm text-navy">{cell(c, row)}</dd></div>)}</dl>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="scroll-fade" data-end={atEnd ? "true" : "false"}>
          <div ref={scrollRef} onScroll={onScroll} className="overflow-auto" style={{ maxHeight: "calc(100vh - 290px)" }} data-virtualized={virtual ? "true" : undefined}>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200">
                  {selectable && <th className="w-8 px-3 py-2.5"><Checkbox checked={allSelected} onCheckedChange={(c) => onSelect(c ? new Set([...selected, ...items.map((r) => r[rowKey])]) : new Set([...selected].filter((id) => !items.some((r) => r[rowKey] === id))))} data-testid={`${testId}-select-all`} /></th>}
                  {cols.map((c, i) => (
                    <th key={c.key} style={{ minWidth: c.minWidth || (c.align === "right" ? 120 : 110) }} className={cn("whitespace-nowrap px-4 py-2.5 text-left label-xs", c.align === "right" && "text-right", c.sortable && "cursor-pointer select-none hover:text-navy", i === 0 && "sticky left-0 z-20 bg-slate-50", c.className)} onClick={() => c.sortable && toggleSort(c.key)} data-testid={`${testId}-col-${c.key}`}>
                      <span className="inline-flex items-center gap-1">{c.label}
                        {c.sortable && (sort === c.key ? <ArrowUp className="h-3 w-3 text-gold" /> : sort === `-${c.key}` ? <ArrowDown className="h-3 w-3 text-gold" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">{cols.map((c) => <td key={c.key} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>)}</tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={cols.length + (selectable ? 1 : 0)} className="p-6">{empty || <EmptyState title="No records found" description="Try adjusting your search or filters." />}</td></tr>
                ) : <>{virtual && padTop > 0 && <tr style={{ height: padTop }} />}{(virtual ? vrows.map((v) => [items[v.index], v.index]) : items.map((row, idx) => [row, idx])).map(([row, idx]) => (
                  <tr key={row[rowKey] ?? idx} onClick={() => onRowClick?.(row)} data-testid={`${testId}-row-${row[rowKey] ?? idx}`}
                    className={cn("group border-b border-slate-100 transition-colors hover:bg-ivory", onRowClick && "cursor-pointer", !row.is_active && row.is_active !== undefined && "opacity-60", selected.has(row[rowKey]) && "bg-gold-light/40")}>
                    {selectable && <td className="px-3" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(row[rowKey])} onCheckedChange={(c) => { const n = new Set(selected); c ? n.add(row[rowKey]) : n.delete(row[rowKey]); onSelect(n); }} data-testid={`${testId}-select-${row[rowKey]}`} /></td>}
                    {cols.map((c, i) => <td key={c.key} className={cn("px-4 align-middle", dense ? "py-2.5" : "py-3.5", c.align === "right" && "text-right tabular", c.nowrap !== false && "whitespace-nowrap", i === 0 && "sticky left-0 z-[1] bg-white group-hover:bg-ivory", c.className)}>{cell(c, row)}</td>)}
                  </tr>
                ))}{virtual && padBottom > 0 && <tr style={{ height: padBottom }} />}</>}
              </tbody>
              {footer && !loading && items.length > 0 && <tfoot className="sticky bottom-0 z-10 bg-slate-50"><tr className="border-t-2 border-slate-200 font-semibold text-navy">{selectable && <td />}{cols.map((c, i) => <td key={c.key} className={cn("px-4 py-2.5 whitespace-nowrap", c.align === "right" && "text-right tabular", i === 0 && "sticky left-0 bg-slate-50")}>{footer[c.key] ?? (i === 0 ? "Total" : "")}</td>)}</tr></tfoot>}
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
        <span data-testid={`${testId}-total`}>{total} record{total === 1 ? "" : "s"} · page {page} of {pages}</span>
        <div className="flex items-center gap-2">
          {setPageSize && <select className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-navy" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page" data-testid={`${testId}-page-size`}>{pageSizes.map((n) => <option key={n} value={n}>{n} / page</option>)}</select>}
          <Button variant="outline" size="sm" className="h-7 border-slate-300 px-2 text-navy" disabled={page <= 1} onClick={() => setPage?.(page - 1)} aria-label="Previous page" data-testid={`${testId}-prev`}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <Button variant="outline" size="sm" className="h-7 border-slate-300 px-2 text-navy" disabled={page >= pages} onClick={() => setPage?.(page + 1)} aria-label="Next page" data-testid={`${testId}-next`}><ChevronRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}
