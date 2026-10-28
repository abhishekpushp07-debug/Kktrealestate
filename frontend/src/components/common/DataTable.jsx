import { useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTableState } from "./datatable/useTableState";
import { TableHeader, TablePagination, TableToolbar } from "./datatable/Parts";
import { BodyRows, CardRows, FooterRow } from "./datatable/Body";

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => { const mq = window.matchMedia("(max-width: 767px)"); const h = (e) => setM(e.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, []);
  return m;
}

/* DataTable v2: min column widths, sticky first column, right-edge scroll affordance, card rows < 768px, sticky totals footer, page-size picker.
   CR-2 C10: rows / cards / footer live in datatable/Body.jsx; toolbar / header / pagination in datatable/Parts.jsx. */
export function DataTable({ columns, items = [], total = 0, loading, page = 1, pageSize = 20, setPage, setPageSize, pageSizes = [20, 50, 100], search, setSearch, sort, setSort, rowKey = "id", onRowClick, searchPlaceholder = "Search…", toolbar, empty, testId = "data-table", dense: denseDefault = true, exportPath, selectable, selected = new Set(), onSelect, footer, cardTitle, cardFields }) {
  const mobile = useIsMobile();
  const { dense, setDense, hidden, toggleCol, cols, labelled, toggleSort, scrollRef, atEnd, onScroll } = useTableState({ columns, items, sort, setSort, testId, denseDefault });
  const virtual = items.length > 100 && !mobile;
  const rv = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => (dense ? 38 : 46), overscan: 12, enabled: virtual });
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
  const rowProps = { items, loading, cols, rowKey, onRowClick, selectable, selected, onSelect, empty, testId };
  return (
    <div className="card overflow-hidden" data-testid={testId}>
      {(setSearch || toolbar || exportPath) && <TableToolbar {...{ testId, search, setSearch, searchPlaceholder, toolbar, mobile, dense, setDense, labelled, hidden, toggleCol, exportPath, exportCsv }} />}
      {mobile ? <CardRows {...rowProps} cardTitle={cardTitle} cardFields={cardFields} /> : (
        <div className="scroll-fade" data-end={atEnd ? "true" : "false"}>
          <div ref={scrollRef} onScroll={onScroll} className="overflow-auto" style={{ maxHeight: "calc(100vh - 290px)" }} data-virtualized={virtual ? "true" : undefined}>
            <table className="w-full text-[13px]">
              <TableHeader {...{ cols, sort, toggleSort, testId, selectable, allSelected, onSelectAll }} />
              <BodyRows {...rowProps} dense={dense} virtual={virtual} vrows={vrows} padTop={padTop} padBottom={padBottom} />
              {footer && !loading && items.length > 0 && <FooterRow footer={footer} cols={cols} selectable={selectable} />}
            </table>
          </div>
        </div>
      )}
      <TablePagination {...{ testId, total, page, pages, pageSize, setPage, setPageSize, pageSizes }} />
    </div>
  );
}
