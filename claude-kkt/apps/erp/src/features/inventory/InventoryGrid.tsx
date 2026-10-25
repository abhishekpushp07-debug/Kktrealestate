import { CheckSquare, IndianRupee, Printer, Square, X } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { FLAT_STATUS_LABELS, GRID_COLOUR_MODES, GRID_COLOUR_MODE_LABELS, MANUAL_FLAT_STATUSES, type BlockGridCell, type BlockGridResponse, type FlatStatus, type GridColourMode, type ManualFlatStatus } from "@kkt/contracts";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, FieldWrapper, MoneyInput, NumberInput, Select, SimpleDialog, Textarea, Tooltip } from "@/components/ui";
import { formatDateTime, formatINR, formatINRShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toggleId } from "./inventoryMath";

/* ------------------------------------------------------------------ */
/* Colours                                                              */
/* ------------------------------------------------------------------ */

export const STATUS_CELL_CLASS: Readonly<Record<FlatStatus, string>> = {
  AVAILABLE: "border-status-available-border bg-status-available-bg text-status-available-fg",
  HOLD: "border-status-hold-border bg-status-hold-bg text-status-hold-fg",
  BOOKED: "border-status-booked-border bg-status-booked-bg text-status-booked-fg",
  SOLD: "border-status-sold-border bg-status-sold-bg text-status-sold-fg",
  BLOCKED: "border-status-blocked-border bg-status-blocked-bg text-status-blocked-fg",
};

const TYPE_PALETTE = [
  "border-navy-200 bg-navy-100 text-navy-950",
  "border-gold-border bg-gold-light text-gold-text",
  "border-info/30 bg-info-bg text-info-fg",
  "border-status-available-border bg-success-bg text-success-fg",
  "border-status-hold-border bg-warning-bg text-warning-fg",
  "border-danger/30 bg-danger-bg text-danger-fg",
  "border-navy-300 bg-navy-200 text-navy-950",
  "border-border-strong bg-surface text-ink",
] as const;

const BAND_PALETTE = [
  "border-navy-100 bg-navy-50 text-navy-950",
  "border-navy-200 bg-navy-100 text-navy-950",
  "border-navy-300 bg-navy-200 text-navy-950",
  "border-navy-400 bg-navy-300 text-white",
  "border-navy-500 bg-navy-500 text-white",
  "border-navy-700 bg-navy-700 text-white",
  "border-navy-900 bg-navy-900 text-white",
] as const;

function typeClass(index: number): string {
  return TYPE_PALETTE[index % TYPE_PALETTE.length] ?? TYPE_PALETTE[0];
}

/** Sequential navy ramp: band index is spread across the palette so few bands still read light → dark. */
function bandClass(index: number, total: number): string {
  const scaled = total > 1 ? Math.round((index / (total - 1)) * (BAND_PALETTE.length - 1)) : 0;
  return BAND_PALETTE[Math.max(0, Math.min(BAND_PALETTE.length - 1, scaled))] ?? BAND_PALETTE[0];
}

/* ------------------------------------------------------------------ */
/* Props                                                                */
/* ------------------------------------------------------------------ */

export interface BulkStatusInput {
  flatIds: string[];
  status: ManualFlatStatus;
  holdHours?: number;
  reason?: string;
}

export interface BulkPriceInput {
  flatIds: string[];
  mode: "PRICE" | "RATE";
  valuePaise: number;
  floorRiseStepPaise?: number;
}

export interface InventoryGridProps {
  grid: BlockGridResponse;
  colourBy: GridColourMode;
  onColourByChange: (mode: GridColourMode) => void;
  onCellClick: (cell: BlockGridCell) => void;
  canChangeStatus: boolean;
  canEditPrice: boolean;
  onBulkStatus: (input: BulkStatusInput) => Promise<unknown>;
  onBulkPrice: (input: BulkPriceInput) => Promise<unknown>;
  loading?: boolean;
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .kkt-print-area, .kkt-print-area * { visibility: visible !important; }
  .kkt-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; padding: 0 !important; font-size: 10px; }
  .kkt-print-area .kkt-no-print { display: none !important; }
  .kkt-print-area .kkt-print-scroll { overflow: visible !important; max-height: none !important; }
  .kkt-print-area .kkt-print-only { display: block !important; }
  @page { size: landscape; margin: 10mm; }
}`;

/** Stacked tower grid: floors descending, positions across, refuge/podium bands, colour modes, multi-select with bulk bar, print. */
export function InventoryGrid({ grid, colourBy, onColourByChange, onCellClick, canChangeStatus, canEditPrice, onBulkStatus, onBulkPrice, loading = false }: InventoryGridProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [holdDialog, setHoldDialog] = useState(false);
  const [priceDialog, setPriceDialog] = useState(false);
  const canBulk = canChangeStatus || canEditPrice;

  // Drop selections that vanished (regenerated grid).
  const cellIds = useMemo(() => new Set(grid.floors.flatMap((floor) => floor.cells.map((cell) => cell.flat_id))), [grid]);
  useEffect(() => {
    setSelected((prev) => prev.filter((id) => cellIds.has(id)));
  }, [cellIds]);

  const typeIndex = useMemo(() => new Map(grid.legend.by_flat_type.map((type, index) => [type.flat_type_id, index] as const)), [grid.legend.by_flat_type]);
  const bandCount = grid.legend.price_bands.length;
  const positions = Math.max(grid.positions, ...grid.floors.map((floor) => floor.cells.reduce((max, cell) => Math.max(max, cell.position), 0)));
  const floors = useMemo(() => [...grid.floors].sort((a, b) => b.floor - a.floor), [grid.floors]);

  const cellClass = (cell: BlockGridCell): string => {
    switch (colourBy) {
      case "STATUS":
        return STATUS_CELL_CLASS[cell.status];
      case "FLAT_TYPE":
        return typeClass(typeIndex.get(cell.flat_type_id) ?? 0);
      case "PRICE_BAND":
        return bandClass(cell.price_band, bandCount);
    }
  };

  const handleCell = (cell: BlockGridCell) => (event: MouseEvent<HTMLButtonElement>) => {
    const multi = selectMode || event.shiftKey || event.ctrlKey || event.metaKey;
    if (multi && canBulk) {
      event.preventDefault();
      setSelected((prev) => toggleId(prev, cell.flat_id));
      return;
    }
    onCellClick(cell);
  };

  const selectFloor = (floorCells: BlockGridCell[]) => {
    const ids = floorCells.map((cell) => cell.flat_id);
    setSelected((prev) => {
      const all = ids.every((id) => prev.includes(id));
      return all ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });
  };

  const selectedCells = useMemo(() => grid.floors.flatMap((floor) => floor.cells).filter((cell) => selected.includes(cell.flat_id)), [grid.floors, selected]);
  const selectedAvailable = selectedCells.filter((cell) => cell.status === "AVAILABLE").length;

  const runStatus = async (status: ManualFlatStatus) => {
    if (status === "HOLD") {
      setHoldDialog(true);
      return;
    }
    await onBulkStatus({ flatIds: selected, status });
    setSelected([]);
  };

  return (
    <div className="kkt-print-area space-y-3" data-testid="inventory-grid">
      <style>{PRINT_CSS}</style>
      <div className="kkt-print-only hidden">
        <h2 className="font-display text-lg font-bold">
          {grid.project_name} · {grid.block_name} — availability chart
        </h2>
        <p className="text-xs">Generated {formatDateTime(grid.generated_at, { zone: true })}</p>
      </div>

      <div className="kkt-no-print flex flex-wrap items-center gap-2">
        <Select aria-label="Colour by" size="sm" className="w-44" value={colourBy} onValueChange={(value) => value && onColourByChange(value)} options={GRID_COLOUR_MODES.map((mode) => ({ value: mode, label: GRID_COLOUR_MODE_LABELS[mode] }))} data-testid="grid-colour-by" />
        {canBulk && (
          <Button variant={selectMode ? "primary" : "outline"} size="sm" leftIcon={selectMode ? CheckSquare : Square} onClick={() => setSelectMode((value) => !value)} aria-pressed={selectMode} data-testid="grid-select-mode">
            Select
          </Button>
        )}
        <span className="hidden text-xs text-ink-subtle md:inline">Shift/Ctrl-click to multi-select · click a floor label to select the floor</span>
        <Button variant="outline" size="sm" leftIcon={Printer} className="ml-auto" onClick={() => window.print()} data-testid="grid-print">
          Print availability chart
        </Button>
      </div>

      {selected.length > 0 && canBulk && (
        <div role="region" aria-label="Bulk actions" className="kkt-no-print flex flex-wrap items-center gap-2 rounded-md border border-navy-800 bg-navy-950 px-3 py-2 text-sm text-white shadow-card animate-slide-down">
          <span className="money font-semibold">{formatNumber(selected.length)} selected</span>
          <span className="money text-2xs text-navy-200">({formatNumber(selectedAvailable)} available)</span>
          {canChangeStatus && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="gold" data-testid="grid-bulk-status">
                  Change status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Set status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {MANUAL_FLAT_STATUSES.map((status) => (
                  <DropdownMenuItem key={status} onSelect={() => void runStatus(status)}>
                    <span className={cn("size-2.5 rounded-full", status === "AVAILABLE" ? "bg-status-available" : status === "HOLD" ? "bg-status-hold" : "bg-status-blocked")} aria-hidden="true" />
                    {FLAT_STATUS_LABELS[status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canEditPrice && (
            <Button size="sm" variant="outline" leftIcon={IndianRupee} className="border-navy-700 bg-navy-900 text-white hover:bg-navy-800 hover:text-white" onClick={() => setPriceDialog(true)} data-testid="grid-bulk-price">
              Edit price
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto text-navy-100 hover:bg-navy-800 hover:text-white" leftIcon={X} onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      <div className={cn("kkt-print-scroll relative overflow-x-auto rounded-lg border border-border bg-card shadow-card scrollbar-thin", loading && "opacity-60")}>
        <div className="min-w-max p-2" role="grid" aria-label={`${grid.block_name} inventory grid`} aria-rowcount={floors.length + 1} style={{ display: "grid", gridTemplateColumns: `3.5rem repeat(${positions}, minmax(4.75rem, 1fr))`, gap: 4 }}>
          <div className="sticky left-0 z-10 bg-card" role="columnheader" aria-label="Floor" />
          {Array.from({ length: positions }, (_, index) => (
            <div key={index} role="columnheader" className="money px-1 text-center text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
              P{index + 1}
            </div>
          ))}
          {floors.map((floor) => {
            const byPosition = new Map(floor.cells.map((cell) => [cell.position, cell] as const));
            const floorSelected = floor.cells.length > 0 && floor.cells.every((cell) => selected.includes(cell.flat_id));
            return [
              <button
                key={`label-${floor.floor}`}
                type="button"
                role="rowheader"
                disabled={!canBulk || floor.cells.length === 0}
                aria-pressed={canBulk ? floorSelected : undefined}
                onClick={() => selectFloor(floor.cells)}
                title={floor.cells.length > 0 && canBulk ? `Select floor ${floor.floor_label}` : undefined}
                className={cn("money sticky left-0 z-10 flex h-11 items-center justify-center rounded-sm border bg-card text-xs font-bold text-navy-950 focus-ring disabled:cursor-default", floorSelected ? "border-gold bg-gold-light" : "border-border", canBulk && floor.cells.length > 0 && "hover:border-navy-300")}
              >
                {floor.floor_label}
              </button>,
              floor.kind !== "UNITS" || floor.cells.length === 0 ? (
                <div
                  key={`band-${floor.floor}`}
                  role="gridcell"
                  className="flex h-11 items-center justify-center rounded-sm border border-dashed border-border-strong text-2xs font-semibold uppercase tracking-wider text-ink-subtle"
                  style={{ gridColumn: `span ${positions}`, backgroundImage: "repeating-linear-gradient(135deg, var(--color-border) 0 2px, transparent 2px 10px)" }}
                >
                  {floor.kind === "REFUGE" ? "Refuge floor" : floor.kind === "PODIUM" ? "Podium" : "No units"}
                </div>
              ) : (
                Array.from({ length: positions }, (_, index) => {
                  const cell = byPosition.get(index + 1);
                  if (!cell) return <div key={`empty-${floor.floor}-${index}`} role="gridcell" aria-hidden="true" className="h-11 rounded-sm border border-dashed border-border/60" />;
                  const isSelected = selected.includes(cell.flat_id);
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
                        </span>
                      }
                    >
                      <button
                        type="button"
                        role="gridcell"
                        aria-selected={isSelected}
                        aria-label={`${cell.flat_number}, ${FLAT_STATUS_LABELS[cell.status]}, ${formatINR(cell.price_paise)}`}
                        onClick={handleCell(cell)}
                        data-status={cell.status}
                        data-testid={`grid-cell-${cell.flat_number}`}
                        className={cn("relative flex h-11 min-w-0 flex-col items-center justify-center rounded-sm border px-1 leading-tight transition-shadow focus-ring hover:shadow-pop", cellClass(cell), isSelected && "ring-2 ring-gold ring-offset-1 ring-offset-card")}
                      >
                        <span className="money truncate text-xs font-bold">{cell.flat_number}</span>
                        <span className="money truncate text-[10px] opacity-90">{colourBy === "PRICE_BAND" ? formatINRShort(cell.price_paise) : colourBy === "FLAT_TYPE" ? cell.flat_type_code : cell.status === "AVAILABLE" ? formatINRShort(cell.price_paise) : FLAT_STATUS_LABELS[cell.status]}</span>
                        {cell.is_corner && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />}
                      </button>
                    </Tooltip>
                  );
                })
              ),
            ];
          })}
        </div>
      </div>

      <GridLegend grid={grid} colourBy={colourBy} />

      <HoldDialog open={holdDialog} onOpenChange={setHoldDialog} count={selected.length} onConfirm={async (hours, reason) => {
        await onBulkStatus({ flatIds: selected, status: "HOLD", holdHours: hours, reason });
        setSelected([]);
      }} />
      <BulkPriceDialog open={priceDialog} onOpenChange={setPriceDialog} count={selected.length} availableCount={selectedAvailable} onConfirm={async (input) => {
        await onBulkPrice({ ...input, flatIds: selected });
        setSelected([]);
      }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                               */
/* ------------------------------------------------------------------ */

export function GridLegend({ grid, colourBy }: { grid: BlockGridResponse; colourBy: GridColourMode }) {
  const items: Array<{ key: string; className: string; label: string; count: number }> =
    colourBy === "STATUS"
      ? (Object.keys(FLAT_STATUS_LABELS) as FlatStatus[]).map((status) => ({ key: status, className: STATUS_CELL_CLASS[status], label: FLAT_STATUS_LABELS[status], count: grid.legend.by_status[status] }))
      : colourBy === "FLAT_TYPE"
        ? grid.legend.by_flat_type.map((type, index) => ({ key: type.flat_type_id, className: typeClass(index), label: `${type.code} · ${type.name}`, count: type.count }))
        : grid.legend.price_bands.map((band) => ({ key: String(band.band), className: bandClass(band.band, grid.legend.price_bands.length), label: band.label || `${formatINRShort(band.min_paise)} – ${formatINRShort(band.max_paise)}`, count: band.count }));
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-label="Legend">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-xs border", item.className)} aria-hidden="true" />
          <dt className="text-ink-muted">{item.label}</dt>
          <dd className="money font-semibold text-navy-950">{formatNumber(item.count)}</dd>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-1.5">
        <dt className="text-ink-muted">Total</dt>
        <dd className="money font-semibold text-navy-950">{formatNumber(grid.unit_counts.total)}</dd>
      </div>
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                              */
/* ------------------------------------------------------------------ */

export function HoldDialog({ open, onOpenChange, count, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; count: number; onConfirm: (hours: number, reason?: string) => Promise<unknown> }) {
  const [hours, setHours] = useState<number | null>(48);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setHours(48);
      setReason("");
      setBusy(false);
    }
  }, [open]);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(hours ?? 48, reason.trim() || undefined);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title={`Put ${count === 1 ? "flat" : `${formatNumber(count)} flats`} on hold`}
      description="Held flats cannot be booked by others until the hold expires or is released."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void confirm()} data-testid="hold-confirm">
            Hold
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldWrapper label="Hold for" required>
          {(control) => <NumberInput id={control.id} value={hours} onChange={setHours} decimals={0} min={1} max={720} suffix="hours" />}
        </FieldWrapper>
        <FieldWrapper label="Reason">{(control) => <Textarea id={control.id} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} placeholder="Token received from…" />}</FieldWrapper>
      </div>
    </SimpleDialog>
  );
}

export function BulkPriceDialog({ open, onOpenChange, count, availableCount, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; count: number; availableCount: number; onConfirm: (input: Omit<BulkPriceInput, "flatIds">) => Promise<unknown> }) {
  const [mode, setMode] = useState<"PRICE" | "RATE">("RATE");
  const [value, setValue] = useState<number | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setValue(null);
      setStep(null);
      setBusy(false);
    }
  }, [open]);
  const confirm = async () => {
    if (value === null) return;
    setBusy(true);
    try {
      await onConfirm({ mode, valuePaise: value, floorRiseStepPaise: mode === "RATE" && step ? step : undefined });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title="Bulk price edit"
      description={`${formatNumber(count)} selected · only the ${formatNumber(availableCount)} Available ${availableCount === 1 ? "flat is" : "flats are"} re-priced.`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} disabled={value === null || availableCount === 0} onClick={() => void confirm()} data-testid="bulk-price-confirm">
            Re-price {formatNumber(availableCount)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldWrapper label="Mode">
          {(control) => <Select id={control.id} value={mode} onValueChange={(next) => setMode(next === "PRICE" ? "PRICE" : "RATE")} options={[{ value: "RATE", label: "Rate per sq ft × super built-up" }, { value: "PRICE", label: "Set the same price on every flat" }]} />}
        </FieldWrapper>
        <FieldWrapper label={mode === "RATE" ? "Rate per sq ft" : "Price"} required>
          {(control) => <MoneyInput id={control.id} value={value} onChange={setValue} showShort={mode === "PRICE"} />}
        </FieldWrapper>
        {mode === "RATE" && <FieldWrapper label="Floor-rise step" hint="Added per floor above the first (per sq ft)">{(control) => <MoneyInput id={control.id} value={step} onChange={setStep} showShort={false} />}</FieldWrapper>}
      </div>
    </SimpleDialog>
  );
}
