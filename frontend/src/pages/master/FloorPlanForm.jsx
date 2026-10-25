import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Combobox } from "@/components/common/Combobox";
import { Field } from "@/components/v2";
import { cn } from "@/lib/utils";

const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"];

export function FloorPlanForm({ item, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(item ? { ...item } : { name: "", code: "", flats_per_floor: 4, positions: [] });
  const [busy, setBusy] = useState(false);
  const { options: ftOptions, items: fts } = useMasterOptions("flat-types", (x) => ({ value: x.id, label: x.name, sub: `${x.bhk} BHK` }));
  const n = Math.min(Number(form.flats_per_floor) || 0, 50);
  const positions = Array.from({ length: n }, (_, i) => form.positions.find((p) => p.position === i + 1) || { position: i + 1, flat_type_id: null, facing: null, is_corner: i === 0 || i === n - 1 });
  const setPos = (i, k, v) => setForm({ ...form, positions: positions.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const missing = positions.filter((p) => !p.flat_type_id).length;
  const submit = async (e) => {
    e.preventDefault();
    if (missing) { toast.error("Assign a flat type to every position"); return; }
    setBusy(true);
    const payload = { name: form.name, code: form.code || null, flats_per_floor: n, positions: positions.map((p) => ({ position: p.position, flat_type_id: p.flat_type_id, facing: p.facing || null, is_corner: !!p.is_corner })) };
    try { item ? await api.patch(`/master/floor-plan-templates/${item.id}`, { ...payload, version: item.version }) : await api.post("/master/floor-plan-templates", payload); toast.success("Floor plan saved"); onSaved(); onOpenChange(false); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const inp = "input !h-10";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-2xl" data-testid="floor-plan-form-sheet">
        <SheetHeader><p className="label">Floor plan template</p><SheetTitle className="font-display text-2xl">{item ? `Edit ${item.name}` : "New floor plan template"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <section className="rounded-2xl border border-warm-200 bg-warm-50/40 p-5"><div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Name" required className="col-span-2"><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="fp-name-input" /></Field>
            <Field label="Code"><input className={inp} value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="fp-code-input" /></Field>
            <Field label="Flats per floor" required><input className={inp} type="number" min={1} max={50} value={form.flats_per_floor} onChange={(e) => setForm({ ...form, flats_per_floor: e.target.value })} data-testid="fp-fpf-input" /></Field>
          </div></section>
          <section className="rounded-2xl border border-warm-200 bg-warm-50/40 p-5" data-testid="fp-preview"><h3 className="mb-3 font-display text-lg text-ink-950">Preview</h3>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(n, 6) || 1}, minmax(0, 1fr))` }}>{positions.map((p) => { const ft = fts.find((x) => x.id === p.flat_type_id); return <div key={p.position} className={cn("rounded-xl border p-3 text-center", ft ? "border-ink-950 bg-ink-950 text-warm-50" : "border-dashed border-warm-200 bg-white text-txt-muted", p.is_corner && "ring-2 ring-gold/60")} data-testid={`fp-preview-${p.position}`}><p className="text-[11px] uppercase tracking-wider opacity-70">Pos {p.position}</p><p className="mt-1 truncate text-sm font-semibold">{ft?.name || "—"}</p><p className="text-[11px] opacity-70">{p.facing || "facing ?"}{p.is_corner ? " · corner" : ""}</p></div>; })}</div>
          </section>
          <section className="rounded-2xl border border-warm-200 bg-warm-50/40 p-5" data-testid="fp-positions"><h3 className="mb-3 font-display text-lg text-ink-950">Positions</h3>
            <div className="mb-2 hidden grid-cols-[56px_1fr_110px_80px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-txt-muted md:grid"><span>Pos</span><span>Flat type</span><span>Facing</span><span>Corner</span></div>
            <div className="space-y-2">{positions.map((p, i) => <div key={p.position} className="grid grid-cols-[56px_1fr_110px_80px] items-center gap-2" data-testid={`fp-position-${p.position}`}>
              <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-warm-100 font-display text-base text-ink-950">{p.position}</span>
              <Combobox options={ftOptions} value={p.flat_type_id} onChange={(v) => setPos(i, "flat_type_id", v)} testId={`fp-position-${p.position}-type`} />
              <select className={inp} value={p.facing || ""} onChange={(e) => setPos(i, "facing", e.target.value || null)} data-testid={`fp-position-${p.position}-facing`}><option value="">—</option>{FACINGS.map((f) => <option key={f}>{f}</option>)}</select>
              <label className="flex items-center gap-2 text-xs text-txt-secondary"><input type="checkbox" className="h-4 w-4 accent-[#0A0C10]" checked={!!p.is_corner} onChange={(e) => setPos(i, "is_corner", e.target.checked)} data-testid={`fp-position-${p.position}-corner`} />Corner</label>
            </div>)}</div>
          </section>
          <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-warm-200 bg-warm-50/95 px-6 py-4 backdrop-blur"><span className={cn("text-sm", missing ? "text-brick" : "text-sage")} data-testid="fp-missing">{missing ? `${missing} position${missing > 1 ? "s" : ""} without a flat type` : "All positions assigned"}</span><button type="submit" disabled={busy} className="btn btn-primary" data-testid="fp-form-submit">{item ? "Save changes" : "Create template"}</button></div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
