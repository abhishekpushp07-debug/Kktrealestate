import { useMemo } from "react";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CELL, UNIT_COLORS } from "@/components/v2";

const LEGEND = ["Available", "Hold", "Booked", "Sold"];

export default function UnitGrid({ grid, flat, setFlat, flatQ, setFlatQ }) {
  const unitFloors = useMemo(() => (grid?.floors || []).filter((f) => f.kind === "units"), [grid]);
  if (!grid) return <p className="text-sm text-txt-muted" data-testid="wiz-grid">Loading grid…</p>;
  const pct = grid.block.construction_percent;
  return (
    <div data-testid="wiz-grid" className="max-h-[60vh] overflow-auto scroll-x">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-txt-secondary"><span>Only Available / Hold units are selectable · construction <b className="text-ink-950">{pct}%</b>{pct > 0 && " — installments linked to completed stages are raised on booking."}</span><span className="ml-auto flex items-center gap-3">{LEGEND.map((k) => <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNIT_COLORS[k] }} />{k}</span>)}</span><input value={flatQ} onChange={(e) => setFlatQ(e.target.value)} placeholder="Find flat no…" className="input !h-9 !w-36" data-testid="wiz-unit-search" /></div>
      <div className="space-y-2">{unitFloors.map((fl) => <div key={fl.floor} className="flex items-center gap-2"><span className="w-8 text-right font-display text-sm text-ink-950">{fl.label}</span>{fl.flats.filter((f) => !flatQ || String(f.flat_number).toLowerCase().includes(flatQ.toLowerCase())).map((f) => { const ok = ["Available", "Hold"].includes(f.status); return <button key={f.id} type="button" disabled={!ok} onClick={() => setFlat(f)} className={cn("min-w-[96px] rounded-[10px] px-2.5 py-2 text-left text-xs transition-all", CELL[f.status] || "bg-warm-100 text-txt-muted", ok && "hover:-translate-y-0.5 hover:shadow-warm", !ok && "cursor-not-allowed opacity-60", flat?.id === f.id && "ring-2 ring-gold ring-offset-2 ring-offset-white")} data-testid={`wiz-flat-${f.flat_number}`}><p className="font-semibold">{f.flat_number}</p><p className="text-[10px] opacity-80">{f.flat_type_code} · {inr(f.price)}</p></button>; })}</div>)}</div>
    </div>
  );
}
