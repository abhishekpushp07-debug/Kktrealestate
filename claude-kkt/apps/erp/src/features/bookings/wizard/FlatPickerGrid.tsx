import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FLAT_STATUS_LABELS, type BlockGridCell, type BlockGridResponse } from "@kkt/contracts";
import { Input, Tooltip } from "@/components/ui";
import { formatDateTime, formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GridLegend, STATUS_CELL_CLASS } from "@/features/inventory/InventoryGrid";

export interface FlatPickerGridProps {
  grid: BlockGridResponse;
  value: string | null;
  onPick: (cell: BlockGridCell) => void;
  loading?: boolean;
}

/** A flat may be booked when it is Available or on Hold (the API checks the hold owner at confirm time). */
export function isPickable(cell: Pick<BlockGridCell, "status">): boolean {
  return cell.status === "AVAILABLE" || cell.status === "HOLD";
}

/**
 * Read-only tower grid in "pick" mode: only Available / Hold cells are selectable, with a
 * find-by-flat-number box that scrolls to and highlights the match, plus the status legend.
 */
export function FlatPickerGrid({ grid, value, onPick, loading = false }: FlatPickerGridProps) {
  const [find, setFind] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const floors = useMemo(() => [...grid.floors].sort((a, b) => b.floor - a.floor), [grid.floors]);
  const cells = useMemo(() => grid.floors.flatMap((floor) => floor.cells), [grid.floors]);
  const positions = Math.max(grid.positions, ...grid.floors.map((floor) => floor.cells.reduce((max, cell) => Math.max(max, cell.position), 0)));

  const match = useMemo(() => {
    const needle = find.trim().toLowerCase();
    if (!needle) return null;
    return cells.find((cell) => cell.flat_number.toLowerCase() === needle) ?? cells.find((cell) => cell.flat_number.toLowerCase().includes(needle)) ?? null;
  }, [find, cells]);

  useEffect(() => {
    if (!match) return;
    const node = cellRefs.current.get(match.flat_id);
    node?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    setFlash(match.flat_id);
    const handle = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(handle);
  }, [match]);

  const pickable = cells.filter(isPickable).length;

  return (
    <div className="space-y-3" data-testid="flat-picker">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          role="searchbox"
          aria-label="Find flat by number"
          placeholder="Find flat number…"
          leftIcon={Search}
          value={find}
          onChange={(event) => setFind(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && match && isPickable(match)) {
              event.preventDefault();
              onPick(match);
            }
          }}
          wrapperClassName="w-full sm:w-60"
          className="money"
          data-testid="flat-picker-find"
        />
        {find.trim() && (
          <span className="text-xs text-ink-subtle" aria-live="polite">
            {match ? (
              <>
                Found <span className="money font-semibold text-ink">{match.flat_number}</span> · {FLAT_STATUS_LABELS[match.status]}
                {isPickable(match) ? " · press Enter to pick" : " · cannot be booked"}
              </>
            ) : (
              "No flat matches"
            )}
          </span>
        )}
        <span className="ml-auto text-xs text-ink-subtle">
          <span className="money font-semibold text-ink">{formatNumber(pickable)}</span> of {formatNumber(cells.length)} bookable
        </span>
      </div>

      <div className={cn("relative overflow-x-auto rounded-lg border border-border bg-card shadow-card scrollbar-thin", loading && "opacity-60")}>
        <div className="min-w-max p-2" role="grid" aria-label={`${grid.block_name} flats — pick one`} aria-rowcount={floors.length + 1} style={{ display: "grid", gridTemplateColumns: `3.5rem repeat(${positions}, minmax(4.75rem, 1fr))`, gap: 4 }}>
          {/* rows are display:contents wrappers: the CSS grid lays out the cells, the ARIA grid gets proper rows */}
          <div role="row" className="contents">
            <div className="sticky left-0 z-10 bg-card" role="columnheader">
              <span className="sr-only">Floor</span>
            </div>
            {Array.from({ length: positions }, (_, index) => (
              <div key={index} role="columnheader" className="money px-1 text-center text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                P{index + 1}
              </div>
            ))}
          </div>
          {floors.map((floor) => {
            const byPosition = new Map(floor.cells.map((cell) => [cell.position, cell] as const));
            return (
              <div key={`row-${floor.floor}`} role="row" className="contents">
              <div role="rowheader" className="money sticky left-0 z-10 flex h-12 items-center justify-center rounded-sm border border-border bg-card text-xs font-bold text-navy-950">
                {floor.floor_label}
              </div>
              {floor.kind !== "UNITS" || floor.cells.length === 0 ? (
                <div
                  key={`band-${floor.floor}`}
                  role="gridcell"
                  className="flex h-12 items-center justify-center rounded-sm border border-dashed border-border-strong text-2xs font-semibold uppercase tracking-wider text-ink-subtle"
                  style={{ gridColumn: `span ${positions}`, backgroundImage: "repeating-linear-gradient(135deg, var(--color-border) 0 2px, transparent 2px 10px)" }}
                >
                  {floor.kind === "REFUGE" ? "Refuge floor" : floor.kind === "PODIUM" ? "Podium" : "No units"}
                </div>
              ) : (
                Array.from({ length: positions }, (_, index) => {
                  const cell = byPosition.get(index + 1);
                  if (!cell) return <div key={`empty-${floor.floor}-${index}`} role="gridcell" aria-hidden="true" className="h-12 rounded-sm border border-dashed border-border/60" />;
                  const selectable = isPickable(cell);
                  const selected = cell.flat_id === value;
                  return (
                    <Tooltip
                      key={cell.flat_id}
                      content={
                        <span className="block space-y-0.5 text-left">
                          <span className="block font-semibold">
                            {cell.flat_number} · {cell.flat_type_code}
                          </span>
                          <span className="money block">{formatINR(cell.price_paise)}</span>
                          <span className="block">
                            {FLAT_STATUS_LABELS[cell.status]}
                            {cell.facing ? ` · ${cell.facing}` : ""}
                            {cell.is_corner ? " · corner" : ""} · {cell.super_builtup_sqft} sq ft
                          </span>
                          {cell.customer_name && <span className="block">{cell.customer_name}</span>}
                          {cell.hold_until && <span className="block">Hold until {formatDateTime(cell.hold_until)}</span>}
                          {!selectable && <span className="block text-gold">Not bookable</span>}
                        </span>
                      }
                    >
                      <button
                        type="button"
                        role="gridcell"
                        ref={(node) => {
                          if (node) cellRefs.current.set(cell.flat_id, node);
                          else cellRefs.current.delete(cell.flat_id);
                        }}
                        aria-selected={selected}
                        aria-disabled={!selectable || undefined}
                        onClick={() => selectable && onPick(cell)}
                        data-status={cell.status}
                        data-testid={`pick-cell-${cell.flat_number}`}
                        className={cn(
                          "relative flex h-12 min-w-0 flex-col items-center justify-center rounded-sm border px-1 leading-tight transition-shadow focus-ring",
                          STATUS_CELL_CLASS[cell.status],
                          selectable ? "cursor-pointer hover:shadow-pop" : "cursor-not-allowed opacity-45 saturate-50",
                          selected && "ring-2 ring-gold ring-offset-2 ring-offset-card",
                          flash === cell.flat_id && "animate-pulse ring-2 ring-navy-950 ring-offset-2 ring-offset-card",
                        )}
                      >
                        <span className="money truncate text-xs font-bold">{cell.flat_number}</span>
                        <span className="money truncate text-[10px]">{cell.status === "AVAILABLE" ? formatINRShort(cell.price_paise) : FLAT_STATUS_LABELS[cell.status]}</span>
                        <span className="sr-only">
                          , {FLAT_STATUS_LABELS[cell.status]}, {formatINR(cell.price_paise)}
                          {selectable ? "" : ", not bookable"}
                        </span>
                        {cell.is_corner && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />}
                      </button>
                    </Tooltip>
                  );
                })
              )}
              </div>
            );
          })}
        </div>
      </div>

      <GridLegend grid={grid} colourBy="STATUS" />
      <p className="text-xs text-ink-subtle">Only Available and Hold flats can be picked. Booked, Sold and Blocked flats are dimmed.</p>
    </div>
  );
}
