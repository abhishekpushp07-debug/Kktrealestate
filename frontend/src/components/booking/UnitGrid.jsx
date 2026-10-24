import { Input } from "@/components/ui/input";
import { STATUS_STYLES } from "@/components/common/StatusChip";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEGEND = [["Available", "bg-emerald-100 border-emerald-300"], ["Hold", "bg-amber-100 border-amber-300"], ["Booked", "bg-navy"], ["Sold", "bg-gold"]];

export default function UnitGrid({ grid, flat, setFlat, flatQ, setFlatQ }) {
  if (!grid) return <p className="text-sm text-slate-500" data-testid="wiz-grid">Loading grid…</p>;
  const pct = grid.block.construction_percent;
  return (
    <div data-testid="wiz-grid" className="max-h-[60vh] overflow-auto scroll-x">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-600"><span>Only Available / Hold units are selectable · construction <b>{pct}%</b>{pct > 0 && " — installments linked to completed stages are raised on booking."}</span><span className="ml-auto flex items-center gap-2">{LEGEND.map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className={`h-3 w-3 rounded border ${c}`} />{k}</span>)}</span><Input value={flatQ} onChange={(e) => setFlatQ(e.target.value)} placeholder="Find flat no…" className="h-8 w-32" data-testid="wiz-flat-search" /></div>
      <div className="space-y-1.5">{grid.floors.filter((f) => f.kind === "units").map((fl) => <div key={fl.floor} className="flex items-center gap-1.5"><span className="w-8 text-right text-xs font-bold text-navy">{fl.label}</span>{fl.flats.filter((f) => !flatQ || String(f.flat_number).toLowerCase().includes(flatQ.toLowerCase())).map((f) => { const ok = ["Available", "Hold"].includes(f.status); return <button key={f.id} disabled={!ok} onClick={() => setFlat(f)} className={cn("min-w-[88px] rounded-md border px-2 py-1.5 text-left text-xs transition-all", STATUS_STYLES[f.status]?.tile, !ok && "cursor-not-allowed opacity-50", flat?.id === f.id && "ring-2 ring-gold")} data-testid={`wiz-flat-${f.flat_number}`}><p className="font-semibold">{f.flat_number}</p><p className="text-[10px] opacity-80">{f.flat_type_code} · {inr(f.price)}</p></button>; })}</div>)}</div>
    </div>
  );
}
