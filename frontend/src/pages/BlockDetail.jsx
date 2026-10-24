import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Layers, RefreshCw, IndianRupee, ArrowUpFromLine, Printer, History, Milestone } from "lucide-react";
import { MilestonesPanel } from "@/components/common/MilestonesPanel";
import { ConstructionPhotos } from "@/components/common/ConstructionPhotos";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { inrShort, num } from "@/lib/format";
import { PageHeader, KV, Field } from "@/components/common/Bits";
import { StatusChip, STATUS_STYLES } from "@/components/common/StatusChip";
import { FlatDrawer } from "@/components/common/FlatDrawer";
import { HistoryTimeline } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const TYPE_COLORS = ["border-sky-300 bg-sky-50", "border-violet-300 bg-violet-50", "border-rose-300 bg-rose-50", "border-teal-300 bg-teal-50", "border-orange-300 bg-orange-50", "border-lime-300 bg-lime-50"];
const BAND_COLORS = ["border-emerald-200 bg-emerald-50", "border-lime-300 bg-lime-50", "border-amber-300 bg-amber-50", "border-orange-300 bg-orange-100", "border-red-300 bg-red-100"];

function BulkPriceDialog({ block, open, onOpenChange, onDone }) {
  const [form, setForm] = useState({ mode: "rate", rate_per_sqft: block.rate_per_sqft ?? "", floor_rise_per_sqft: block.floor_rise_per_sqft ?? "", price: "", floors: "", only_available: true });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const payload = { only_available: form.only_available, floors: form.floors ? form.floors.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n)) : null };
    if (form.mode === "rate") { payload.rate_per_sqft = Number(form.rate_per_sqft); payload.floor_rise_per_sqft = form.floor_rise_per_sqft === "" ? null : Number(form.floor_rise_per_sqft); } else payload.price = Number(form.price);
    try { const r = await api.post(`/blocks/${block.id}/bulk-price`, payload); toast.success(`${r.data.flats_updated} flats repriced`); onDone(); onOpenChange(false); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bulk-price-dialog">
        <DialogHeader><DialogTitle>Bulk price update · {block.name}</DialogTitle></DialogHeader>
        <div className="flex gap-2">{[["rate", "Rate per sq.ft"], ["price", "Flat amount"]].map(([m, l]) => <button key={m} onClick={() => setForm({ ...form, mode: m })} className={cn("flex-1 rounded-md border px-3 py-2 text-sm font-semibold", form.mode === m ? "border-navy bg-navy text-white" : "hover:bg-slate-50")} data-testid={`bulk-mode-${m}`}>{l}</button>)}</div>
        {form.mode === "rate" ? <div className="grid grid-cols-2 gap-3"><Field label="Rate ₹/sq.ft" required><Input type="number" value={form.rate_per_sqft} onChange={(e) => setForm({ ...form, rate_per_sqft: e.target.value })} data-testid="bulk-rate-input" /></Field><Field label="Floor rise ₹/sq.ft per floor"><Input type="number" value={form.floor_rise_per_sqft} onChange={(e) => setForm({ ...form, floor_rise_per_sqft: e.target.value })} data-testid="bulk-rise-input" /></Field></div>
          : <Field label="Price ₹ (lump sum)" required><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="bulk-amount-input" /></Field>}
        <Field label="Floors (comma separated, blank = all)"><Input value={form.floors} onChange={(e) => setForm({ ...form, floors: e.target.value })} placeholder="e.g. 1,2,3" data-testid="bulk-floors-input" /></Field>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.only_available} onCheckedChange={(c) => setForm({ ...form, only_available: !!c })} data-testid="bulk-only-available" />Only Available flats</label>
        <DialogFooter><Button onClick={submit} disabled={busy} className="bg-navy hover:bg-navy-700" data-testid="bulk-price-submit">Apply pricing</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BlockDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { data: grid, loading, reload } = useFetch(`/blocks/${id}/grid`);
  const { data: block, reload: reloadBlock } = useFetch(`/blocks/${id}`);
  const { can } = useAuth();
  const [selected, setSelected] = useState(sp.get("flat"));
  const [mode, setMode] = useState("status");
  const [multi, setMulti] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);
  const [floorCount, setFloorCount] = useState(1);
  const refresh = () => { reload(); reloadBlock(); };
  useEffect(() => { const f = sp.get("flat"); if (f) setSelected(f); }, [sp]);

  const regenerate = async () => {
    if (!window.confirm("Regenerate all flats for this block? Existing Available flats will be replaced.")) return;
    try { const r = await api.post(`/blocks/${id}/generate-flats`); toast.success(`${r.data.generated} flats regenerated`); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const addFloors = async () => {
    try { const r = await api.post(`/blocks/${id}/floors`, { count: Number(floorCount) }); toast.success(`${r.data.flats_added} flats added · now ${r.data.floors} floors`); setFloorsOpen(false); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const bulkStatus = async (status) => {
    try { const r = await api.post(`/blocks/${id}/bulk-status`, { flat_ids: [...multi], status }); toast.success(`${r.data.flats_updated} flats → ${status}${r.data.skipped ? ` · ${r.data.skipped} skipped` : ""}`); setMulti(new Set()); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const toggleMulti = (fid, shift) => {
    const n = new Set(multi);
    if (shift && grid) { const all = grid.floors.flatMap((f) => f.flats.map((x) => x.id)); const last = [...multi].pop(); const a = all.indexOf(last), b = all.indexOf(fid); if (a >= 0 && b >= 0) all.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => n.add(x)); }
    n.has(fid) && !shift ? n.delete(fid) : n.add(fid);
    setMulti(n);
  };

  if (loading || !grid) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-96" /></div>;
  const b = grid.block;
  const types = [...new Set(grid.floors.flatMap((f) => f.flats.map((x) => x.flat_type_code)))];
  const { min, max } = grid.price_range;
  const tileClass = (f) => {
    if (mode === "type") return TYPE_COLORS[types.indexOf(f.flat_type_code) % TYPE_COLORS.length];
    if (mode === "price" && f.price && max > min) return BAND_COLORS[Math.min(4, Math.floor(((f.price - min) / (max - min)) * 5))];
    return STATUS_STYLES[f.status].tile;
  };
  return (
    <div data-testid="block-detail-page">
      <PageHeader crumbs={[{ label: "Projects", to: "/projects" }, { label: block?.project_code || "…", to: `/projects/${b.project_id}` }, { label: b.code }]} title={b.name}
        subtitle={`${block?.block_type_name || ""} · ${b.floors} floors${b.skip_floors?.length ? ` (skips ${b.skip_floors.join(", ")})` : ""}${b.refuge_floors?.length ? ` · refuge ${b.refuge_floors.join(", ")}` : ""} · pattern ${b.numbering_pattern}`}
        actions={<>
          <Button variant="outline" onClick={() => window.print()} data-testid="print-grid-btn" className="print:hidden"><Printer className="mr-1.5 h-4 w-4" />Print</Button>
          <Button variant="outline" onClick={() => setShowMilestones(!showMilestones)} data-testid="block-milestones-btn"><Milestone className="mr-1.5 h-4 w-4" />Milestones</Button>
          <Button variant="outline" onClick={() => setShowHistory(!showHistory)} data-testid="block-history-btn"><History className="mr-1.5 h-4 w-4" />History</Button>
          {can("flat.write") && <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-price-btn"><IndianRupee className="mr-1.5 h-4 w-4" />Bulk price</Button>}
          {can("block.write") && <Button variant="outline" onClick={() => setFloorsOpen(true)} data-testid="add-floors-btn"><ArrowUpFromLine className="mr-1.5 h-4 w-4" />Add floors</Button>}
          {can("block.write") && <Button variant="outline" onClick={regenerate} data-testid="regenerate-flats-btn"><RefreshCw className="mr-1.5 h-4 w-4" />Regenerate</Button>}
        </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="card-elev p-4"><p className="label-xs">Units</p><p className="mt-1 text-2xl font-extrabold tabular text-navy" data-testid="grid-count-total">{grid.counts.total}</p></div>
        {["Available", "Hold", "Booked", "Sold", "Blocked"].map((s) => <div key={s} className={cn("rounded-xl border p-4", STATUS_STYLES[s].tile)} data-testid={`grid-count-${s.toLowerCase()}`}><p className="label-xs opacity-80">{s}</p><p className="mt-1 text-2xl font-extrabold tabular">{grid.counts[s]}</p></div>)}
      </div>
      {showHistory && <div className="card-elev mb-5 p-5" data-testid="block-history-panel"><h3 className="mb-3 text-base font-bold text-navy">Block history</h3><HistoryTimeline entityType="block" entityId={b.id} /></div>}
      {showMilestones && <div className="mb-5"><MilestonesPanel blockId={b.id} onChanged={refresh} /></div>}
      <div className="mb-5"><ConstructionPhotos blockId={b.id} milestones={b.milestones} /></div>
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="card-elev overflow-auto p-4" data-testid="inventory-grid">
          <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
            <span className="label-xs">Colour by</span>
            {[["status", "Status"], ["type", "Flat type"], ["price", "Price band"]].map(([m, l]) => <button key={m} onClick={() => setMode(m)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", mode === m ? "border-navy bg-navy text-white" : "bg-white hover:border-gold")} data-testid={`grid-mode-${m}`}>{l}</button>)}
            {multi.size > 0 && can("flat.status") && <div className="ml-auto flex items-center gap-2 rounded-md bg-gold-light px-3 py-1.5 text-xs" data-testid="grid-bulk-bar"><b>{multi.size} selected</b>
              {["Available", "Hold", "Blocked"].map((s) => <Button key={s} size="sm" variant="outline" className="h-7" onClick={() => bulkStatus(s)} data-testid={`grid-bulk-${s.toLowerCase()}`}>→ {s}</Button>)}
              <button onClick={() => setMulti(new Set())} className="text-slate-500 underline">clear</button></div>}
            {multi.size === 0 && <span className="ml-auto text-[11px] text-slate-400">Ctrl/⌘-click to multi-select · Shift for range</span>}
          </div>
          <TooltipProvider delayDuration={200}>
            <div className="min-w-max">
              <div className="mb-2 grid gap-2" style={{ gridTemplateColumns: `64px repeat(${grid.positions.length}, minmax(120px, 1fr))` }}>
                <div className="label-xs self-end">Floor</div>{grid.positions.map((p) => <div key={p} className="label-xs text-center">Pos {p}</div>)}
              </div>
              {grid.floors.map((fl) => (
                <div key={fl.floor} className="mb-2 grid gap-2" style={{ gridTemplateColumns: `64px repeat(${grid.positions.length}, minmax(120px, 1fr))` }} data-testid={`grid-floor-${fl.floor}`} data-kind={fl.kind}>
                  <div className={cn("sticky left-0 flex items-center justify-center rounded-lg text-sm font-extrabold", fl.kind === "units" ? "bg-navy text-gold" : "bg-slate-300 text-slate-600")}>{fl.label}</div>
                  {fl.kind !== "units" ? <div className="flex items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400" style={{ gridColumn: `span ${grid.positions.length}` }}>{fl.kind} floor · no units</div>
                    : grid.positions.map((p) => {
                      const f = fl.flats.find((x) => x.position === p);
                      if (!f) return <div key={p} className="grid-tile border-dashed border-slate-200 bg-slate-50" />;
                      return (
                        <Tooltip key={f.id}>
                          <TooltipTrigger asChild>
                            <button onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey) ? toggleMulti(f.id, e.shiftKey) : setSelected(f.id)} className={cn("grid-tile", tileClass(f), multi.has(f.id) && "ring-2 ring-gold ring-offset-1")} data-testid={`grid-flat-${f.flat_number}`} data-status={f.status}>
                              <div className="flex items-center justify-between"><span className="text-sm font-extrabold">{f.flat_number}</span><span className="text-[10px] font-semibold opacity-70">{f.flat_type_code}{f.is_corner ? " ◆" : ""}</span></div>
                              <div className="flex items-end justify-between"><span className="text-[10px] opacity-70">{num(f.super_builtup_sqft)} sq.ft</span><span className="text-xs font-bold tabular">{inrShort(f.price)}</span></div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs"><p className="font-bold">{f.flat_number} · {f.flat_type_code} · {f.facing || "—"}</p><p>{f.status} · {inrShort(f.price)} · {num(f.super_builtup_sqft)} sq.ft</p></TooltipContent>
                        </Tooltip>
                      );
                    })}
                </div>
              ))}
            </div>
          </TooltipProvider>
        </div>
        <div className="space-y-4 print:hidden">
          <div className="card-elev p-5">
            <h3 className="mb-3 text-base font-bold text-navy">Block details</h3>
            <div className="grid grid-cols-2 gap-3">
              <KV label="Status" value={b.status} /><KV label="Construction" value={`${b.construction_percent}%`} mono />
              <KV label="Rate" value={block?.rate_per_sqft ? `₹${num(block.rate_per_sqft)}/sq.ft` : "From flat type / rate card"} /><KV label="Floor rise" value={block?.floor_rise_per_sqft ? `₹${num(block.floor_rise_per_sqft)}/floor` : "—"} />
              <KV label="Floor start" value={b.floor_start} mono /><KV label="Milestone template" value={block?.milestone_template?.name} />
            </div>
            <p className="label-xs mb-2 mt-4">Floor plans</p>
            <div className="space-y-1">{block?.floor_plans?.map((p, i) => <div key={i} className="rounded bg-slate-50 px-2 py-1.5 text-xs"><div className="flex justify-between"><span className="text-slate-500">Floors {p.from_floor}–{p.to_floor}</span><b className="text-navy">{p.template_name || "Inline"}</b></div><p className="mt-0.5 text-[10px] text-slate-500">{p.resolved_positions?.map((x) => `${x.position}:${x.flat_type?.code}`).join("  ")}</p></div>)}</div>
          </div>
          <div className="card-elev p-5"><p className="label-xs mb-2">Legend</p><div className="flex flex-wrap gap-1.5">{mode === "status" ? ["Available", "Hold", "Booked", "Sold", "Blocked"].map((s) => <StatusChip key={s} status={s} />) : mode === "type" ? types.map((t, i) => <span key={t} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", TYPE_COLORS[i % TYPE_COLORS.length])}>{t}</span>) : <span className="text-xs text-slate-600">{inrShort(min)} → {inrShort(max)} (5 bands)</span>}</div><p className="mt-3 text-xs text-slate-500">◆ corner unit. Click a tile for the flat drawer with price breakup.</p></div>
        </div>
      </div>
      <FlatDrawer flatId={selected} onClose={() => { setSelected(null); if (sp.get("flat")) setSp({}); }} onChanged={refresh} />
      {bulkOpen && block && <BulkPriceDialog block={block} open={bulkOpen} onOpenChange={setBulkOpen} onDone={refresh} />}
      <Dialog open={floorsOpen} onOpenChange={setFloorsOpen}>
        <DialogContent data-testid="add-floors-dialog"><DialogHeader><DialogTitle>Append floors</DialogTitle></DialogHeader>
          <Field label="Number of floors to add" hint="Uses the last floor-plan range's template"><Input type="number" min={1} max={50} value={floorCount} onChange={(e) => setFloorCount(e.target.value)} data-testid="add-floors-count" /></Field>
          <DialogFooter><Button onClick={addFloors} className="bg-navy hover:bg-navy-700" data-testid="add-floors-submit"><Layers className="mr-1.5 h-4 w-4" />Add floors</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
