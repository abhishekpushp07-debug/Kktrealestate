import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "../Bits";

const cell = (c, row) => (c.render ? c.render(row) : row[c.key] ?? "—");
const emptyNode = (empty) => empty || <EmptyState title="No records found" description="Try adjusting your search or filters." />;

function RowCheckbox({ row, rowKey, selected, onSelect, testId }) {
  return <Checkbox checked={selected.has(row[rowKey])} onClick={(e) => e.stopPropagation()} onCheckedChange={(c) => { const n = new Set(selected); c ? n.add(row[rowKey]) : n.delete(row[rowKey]); onSelect(n); }} data-testid={testId} />;
}

/** < 768px: one card per row. */
export function CardRows({ items, loading, cols, cardTitle, cardFields, rowKey, onRowClick, selectable, selected, onSelect, empty, testId }) {
  const cardCols = cardFields ? cols.filter((c) => cardFields.includes(c.key)) : cols.slice(0, 6);
  const [first, ...rest] = cardCols;
  return (
    <div className="divide-y divide-slate-100" data-testid={`${testId}-cards`}>
      {loading ? Array.from({ length: 4 }, (_, n) => n).map((n) => <div key={`sk-${n}`} className="space-y-2 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>)
        : items.length === 0 ? <div className="p-6">{emptyNode(empty)}</div>
        : items.map((row, idx) => (
          <div key={row[rowKey] ?? idx} onClick={() => onRowClick?.(row)} className={cn("p-4", onRowClick && "cursor-pointer active:bg-warm-50")} data-testid={`${testId}-row-${row[rowKey] ?? idx}`}>
            <div className="mb-2 flex items-start justify-between gap-3"><div className="min-w-0 text-sm font-semibold text-ink-950">{cardTitle ? cardTitle(row) : first && cell(first, row)}</div>{selectable && <RowCheckbox row={row} rowKey={rowKey} selected={selected} onSelect={onSelect} />}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">{rest.map((c) => <div key={c.key} className="min-w-0"><dt className="label-xs !text-[10px]">{c.label}</dt><dd className="truncate text-sm text-ink-950">{cell(c, row)}</dd></div>)}</dl>
          </div>))}
    </div>
  );
}

/** Desktop <tbody>: skeleton / empty / (virtualised) rows. */
export function BodyRows({ items, loading, cols, dense, rowKey, onRowClick, selectable, selected, onSelect, empty, testId, virtual, vrows, padTop, padBottom }) {
  if (loading) return <tbody>{Array.from({ length: 6 }, (_, n) => n).map((n) => <tr key={`sk-${n}`} className="border-b border-slate-100">{cols.map((c) => <td key={c.key} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)}</tbody>;
  if (items.length === 0) return <tbody><tr><td colSpan={cols.length + (selectable ? 1 : 0)} className="p-6">{emptyNode(empty)}</td></tr></tbody>;
  const rows = virtual ? vrows.map((v) => [items[v.index], v.index]) : items.map((row, idx) => [row, idx]);
  return (
    <tbody>
      {virtual && padTop > 0 && <tr style={{ height: padTop }} />}
      {rows.map(([row, idx]) => (
        <tr key={row[rowKey] ?? idx} onClick={() => onRowClick?.(row)} data-testid={`${testId}-row-${row[rowKey] ?? idx}`}
          className={cn("group border-b border-slate-100 transition-colors hover:bg-warm-50", onRowClick && "cursor-pointer", !row.is_active && row.is_active !== undefined && "opacity-60", selected.has(row[rowKey]) && "bg-gold-light/40")}>
          {selectable && <td className="px-3" onClick={(e) => e.stopPropagation()}><RowCheckbox row={row} rowKey={rowKey} selected={selected} onSelect={onSelect} testId={`${testId}-select-${row[rowKey]}`} /></td>}
          {cols.map((c, i) => <td key={c.key} className={cn("px-4 align-middle", dense ? "py-2.5" : "py-3.5", c.align === "right" && "text-right tabular", c.nowrap !== false && "whitespace-nowrap", i === 0 && "sticky left-0 z-[1] bg-white group-hover:bg-warm-50", c.className)}>{cell(c, row)}</td>)}
        </tr>))}
      {virtual && padBottom > 0 && <tr style={{ height: padBottom }} />}
    </tbody>
  );
}

export function FooterRow({ footer, cols, selectable }) {
  return <tfoot className="sticky bottom-0 z-10 bg-warm-50"><tr className="border-t-2 border-warm-200 font-semibold text-ink-950">{selectable && <td />}{cols.map((c, i) => <td key={c.key} className={cn("px-4 py-2.5 whitespace-nowrap", c.align === "right" && "text-right tabular", i === 0 && "sticky left-0 bg-warm-50")}>{footer[c.key] ?? (i === 0 ? "Total" : "")}</td>)}</tr></tfoot>;
}
