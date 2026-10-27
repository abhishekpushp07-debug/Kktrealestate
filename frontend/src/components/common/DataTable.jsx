/* eslint-disable react/no-array-index-key -- fixed-length skeleton placeholders (never reordered) */
import { useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "./Bits";
import { useTableState } from "./datatable/useTableState";
import { TableHeader, TablePagination, TableToolbar } from "./datatable/Parts";

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => { const mq = window.matchMedia("(max-width: 767px)"); const h = (e) => setM(e.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, []);
  return m;
}

/* DataTable v2: min column widths, sticky first column, right-edge scroll affordance, card rows < 768px, sticky totals footer, page-size picker. */
export function DataTable({ columns, items = [], total = 0, loading, page = 1, pageSize = 20, setPage, setPageSize, pageSizes = [20, 50, 100], search, setSearch, sort, setSort, rowKey = "id", onRowClick, searchPlaceholder = "Search…", toolbar, empty, testId = "data-table", dense: denseDefault = true, exportPath, selectable, selected = new Set(), onSelect, footer, cardTitle, cardFields }) {
  const mobile = useIsMobile();
  const { dense, setDense, hidden, toggleCol, cols, labelled, toggleSort, scrollRef, atEnd, onScroll } = useTableState({ columns, items, sort, setSort, testId, denseDefault });
  const virtual = items.length > 100 && !mobile;
  const rowH = dense ? 38 : 46;
  const rv = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12, enabled: virtual });
  const vrows = virtual ? rv.getVirtualItems() : null;
  const padTop = vrows?.length ? vrows[0].start : 0;
  const padBottom = vrows?.length ? rv.getTotalSize() - vrows[vrows.length - 1].end : 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = selectable && items.length > 0 && items.every((r) => selected.has(r[rowKey]));
  const onSelectAll = (c) => onSelect(c ? new Set([...selected, ...items.map((r) => r[rowKey])]) : new Set([...selected].filter((id) => !items.some((r) => r[rowKey] === id))));
  const exportCsv = async () => {
    const { default: api } = await import("@/lib/api");
    const r = await api.get(exportPath, { params: { format: "csv", search: search || undefined }, responseType: "blob" });
    const url = URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = url; a.download = `${testId}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const cell = (c, row) => (c.render ? c.render(row) : row[c.key] ?? "—");
  const cardCols = cardFields ? cols.filter((c) => cardFields.includes(c.key)) : cols.slice(0, 6);
  return (
    <div className="card overflow-hidden" data-testid={testId}>
      {(setSearch || toolbar || exportPath) && <TableToolbar {...{ testId, search, setSearch, searchPlaceholder, toolbar, mobile, dense, setDense, labelled, hidden, toggleCol, exportPath, exportCsv }} />}
      {mobile ? (
        <div className="divide-y divide-slate-100" data-testid={`${testId}-cards`}>
          {loading ? Array.from({ length: 4 }).map((_, i) => <div key={`sk-${i}`} className="space-y-2 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>)
            : items.length === 0 ? <div className="p-6">{empty || <EmptyState title="No records found" description="Try adjusting your search or filters." />}</div>
            : items.map((row, idx) => {
              const [first, ...rest] = cardCols;
              return (
                <div key={row[rowKey] ?? idx} onClick={() => onRowClick?.(row)} className={cn("p-4", onRowClick && "cursor-pointer active:bg-warm-50")} data-testid={`${testId}-row-${row[rowKey] ?? idx}`}>
                  <div className="mb-2 flex items-start justify-between gap-3"><div className="min-w-0 text-sm font-semibold text-ink-950">{cardTitle ? cardTitle(row) : first && cell(first, row)}</div>{selectable && <Checkbox checked={selected.has(row[rowKey])} onClick={(e) => e.stopPropagation()} onCheckedChange={(c) => { const n = new Set(selected); c ? n.add(row[rowKey]) : n.delete(row[rowKey]); onSelect(n); }} />}</div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">{rest.map((c) => <div key={c.key} className="min-w-0"><dt className="label-xs !text-[10px]">{c.label}</dt><dd className="truncate text-sm text-ink-950">{cell(c, row)}</dd></div>)}</dl>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="scroll-fade" data-end={atEnd ? "true" : "false"}>
          <div ref={scrollRef} onScroll={onScroll} className="overflow-auto" style={{ maxHeight: "calc(100vh - 290px)" }} data-virtualized={virtual ? "true" : undefined}>
            <table className="w-full text-[13px]">
              <TableHeader {...{ cols, sort, toggleSort, testId, selectable, allSelected, onSelectAll }} />
              <tbody>
                {loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-slate-100">{cols.map((c) => <td key={c.key} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>)}</tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={cols.length + (selectable ? 1 : 0)} className="p-6">{empty || <EmptyState title="No records found" description="Try adjusting your search or filters." />}</td></tr>
                ) : <>{virtual && padTop > 0 && <tr style={{ height: padTop }} />}{(virtual ? vrows.map((v) => [items[v.index], v.index]) : items.map((row, idx) => [row, idx])).map(([row, idx]) => (
                  <tr key={row[rowKey] ?? idx} onClick={() => onRowClick?.(row)} data-testid={`${testId}-row-${row[rowKey] ?? idx}`}
                    className={cn("group border-b border-slate-100 transition-colors hover:bg-warm-50", onRowClick && "cursor-pointer", !row.is_active && row.is_active !== undefined && "opacity-60", selected.has(row[rowKey]) && "bg-gold-light/40")}>
                    {selectable && <td className="px-3" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(row[rowKey])} onCheckedChange={(c) => { const n = new Set(selected); c ? n.add(row[rowKey]) : n.delete(row[rowKey]); onSelect(n); }} data-testid={`${testId}-select-${row[rowKey]}`} /></td>}
                    {cols.map((c, i) => <td key={c.key} className={cn("px-4 align-middle", dense ? "py-2.5" : "py-3.5", c.align === "right" && "text-right tabular", c.nowrap !== false && "whitespace-nowrap", i === 0 && "sticky left-0 z-[1] bg-white group-hover:bg-warm-50", c.className)}>{cell(c, row)}</td>)}
                  </tr>
                ))}{virtual && padBottom > 0 && <tr style={{ height: padBottom }} />}</>}
              </tbody>
              {footer && !loading && items.length > 0 && <tfoot className="sticky bottom-0 z-10 bg-warm-50"><tr className="border-t-2 border-warm-200 font-semibold text-ink-950">{selectable && <td />}{cols.map((c, i) => <td key={c.key} className={cn("px-4 py-2.5 whitespace-nowrap", c.align === "right" && "text-right tabular", i === 0 && "sticky left-0 bg-warm-50")}>{footer[c.key] ?? (i === 0 ? "Total" : "")}</td>)}</tr></tfoot>}
            </table>
          </div>
        </div>
      )}
      <TablePagination {...{ testId, total, page, pages, pageSize, setPage, setPageSize, pageSizes }} />
    </div>
  );
}
