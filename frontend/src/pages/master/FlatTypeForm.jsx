/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { num } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Combobox } from "@/components/common/Combobox";
import { Field } from "@/components/v2";
import { cn } from "@/lib/utils";

const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"];
const newRoom = () => ({ room_type_id: null, label: "", length_ft: "", width_ft: "", area_sqft: "" });
const newArea = () => ({ area_type_id: null, value_sqft: "" });
const Section = ({ title, aside, children, testId }) => <section className="rounded-2xl border border-warm-200 bg-warm-50/40 p-5" data-testid={testId}><div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-display text-lg text-ink-950">{title}</h3>{aside}</div>{children}</section>;

export function FlatTypeForm({ item, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(item ? { ...item, rooms: item.rooms.map((r) => ({ ...r })), areas: item.areas.map((a) => ({ ...a })), spec_item_ids: item.spec_item_ids || [] } : { name: "", code: "", bhk: 2, facing: null, description: "", rooms: [newRoom()], areas: [newArea()], base_rate_per_sqft: "", base_price: "", spec_item_ids: [] });
  const [busy, setBusy] = useState(false);
  const { options: roomOptions, items: roomTypes } = useMasterOptions("room-types");
  const { options: areaOptions, items: areaTypes } = useMasterOptions("area-types");
  const { items: specItems } = useMasterOptions("spec-items");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setRoom = (i, k, v) => setForm((f) => ({ ...f, rooms: f.rooms.map((r, idx) => {
    if (idx !== i) return r;
    const nr = { ...r, [k]: v };
    if (k === "length_ft" || k === "width_ft") { const L = Number(nr.length_ft), W = Number(nr.width_ft); nr.area_sqft = L > 0 && W > 0 ? Math.round(L * W * 100) / 100 : ""; }
    if (k === "room_type_id" && !nr.label) nr.label = roomTypes.find((t) => t.id === v)?.name || "";
    return nr;
  }) }));
  const setArea = (i, k, v) => setForm((f) => ({ ...f, areas: f.areas.map((a, idx) => (idx === i ? { ...a, [k]: v } : a)) }));
  const roomTotal = useMemo(() => form.rooms.reduce((s, r) => s + (Number(r.area_sqft) || 0), 0), [form.rooms]);
  const areaByCode = (code) => { const at = areaTypes.find((t) => t.code === code); return Number(form.areas.find((a) => a.area_type_id === at?.id)?.value_sqft) || null; };
  const carpet = areaByCode("CARPET"), builtup = areaByCode("BUILTUP"), sbu = areaByCode("SUPER_BUILTUP");
  const hierarchyError = (carpet && builtup && carpet > builtup) ? "Carpet area cannot exceed built-up" : (builtup && sbu && builtup > sbu) ? "Built-up cannot exceed super built-up" : (carpet && sbu && carpet > sbu) ? "Carpet cannot exceed super built-up" : (carpet && roomTotal > carpet * 1.05) ? "Rooms add up to more than the carpet area" : null;
  const dupArea = new Set(form.areas.map((a) => a.area_type_id).filter(Boolean)).size !== form.areas.filter((a) => a.area_type_id).length;
  const rate = Number(form.base_rate_per_sqft) || 0;
  const indicative = form.base_price ? Number(form.base_price) : rate && sbu ? rate * sbu : null;
  const toggleSpec = (id) => set("spec_item_ids", form.spec_item_ids.includes(id) ? form.spec_item_ids.filter((x) => x !== id) : [...form.spec_item_ids, id]);
  const specGroups = specItems.reduce((a, s) => { (a[s.spec_category_name || "Specifications"] ||= []).push(s); return a; }, {});

  const submit = async (e) => {
    e.preventDefault();
    if (hierarchyError || dupArea) { toast.error(hierarchyError || "Each area type may appear once"); return; }
    setBusy(true);
    const payload = {
      version: item?.version, name: form.name, code: form.code.toUpperCase(), bhk: Number(form.bhk), facing: form.facing || null, description: form.description || null, spec_item_ids: form.spec_item_ids,
      rooms: form.rooms.map((r) => ({ room_type_id: r.room_type_id, label: r.label, length_ft: Number(r.length_ft), width_ft: Number(r.width_ft), area_sqft: Number(r.area_sqft) || null })),
      areas: form.areas.map((a) => ({ area_type_id: a.area_type_id, value_sqft: Number(a.value_sqft) })),
      base_rate_per_sqft: form.base_rate_per_sqft === "" || form.base_rate_per_sqft == null ? null : Number(form.base_rate_per_sqft),
      base_price: form.base_price === "" || form.base_price == null ? null : Number(form.base_price),
    };
    try { item ? await api.patch(`/master/flat-types/${item.id}`, payload) : await api.post("/master/flat-types", payload); toast.success(item ? "Flat type updated" : "Flat type created"); onSaved(); onOpenChange(false); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const inp = "input !h-10";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-3xl" data-testid="flat-type-form-sheet">
        <SheetHeader><p className="label">Flat type</p><SheetTitle className="font-display text-2xl">{item ? `Edit ${item.name}` : "New flat type"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <Section title="Identity">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Name" required className="col-span-2"><input className={inp} value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="3BHK-A" data-testid="ft-name-input" /></Field>
              <Field label="Code" required><input className={inp} value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required data-testid="ft-code-input" /></Field>
              <Field label="BHK" required><input className={inp} type="number" step="0.5" min={0} value={form.bhk} onChange={(e) => set("bhk", e.target.value)} required data-testid="ft-bhk-input" /></Field>
              <Field label="Facing"><select className={inp} value={form.facing || ""} onChange={(e) => set("facing", e.target.value || null)} data-testid="ft-facing-select"><option value="">Not set</option>{FACINGS.map((f) => <option key={f}>{f}</option>)}</select></Field>
              <Field label="Base rate ₹ / sq ft"><input className={inp} type="number" min={0} value={form.base_rate_per_sqft ?? ""} onChange={(e) => set("base_rate_per_sqft", e.target.value)} data-testid="ft-rate-input" /></Field>
              <Field label="Base price ₹ (lump sum)" className="col-span-2"><input className={inp} type="number" min={0} value={form.base_price ?? ""} onChange={(e) => set("base_price", e.target.value)} data-testid="ft-price-input" /></Field>
              <Field label="Description" className="col-span-2 md:col-span-4"><textarea className="input min-h-[64px] py-2" rows={2} value={form.description || ""} onChange={(e) => set("description", e.target.value)} data-testid="ft-description-input" /></Field>
            </div>
          </Section>
          <Section title={`Rooms · ${form.rooms.length}`} testId="ft-rooms-section" aside={<span className="text-sm text-txt-secondary">Total <b className="font-display text-base text-ink-950 tabular-nums" data-testid="ft-rooms-total">{num(roomTotal)}</b> sq ft</span>}>
            <div className="mb-2 hidden grid-cols-[1.3fr_1.2fr_72px_72px_88px_32px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-txt-muted md:grid"><span>Room type</span><span>Label</span><span>L (ft)</span><span>W (ft)</span><span className="text-right">Sq ft</span><span /></div>
            <div className="space-y-2">
              {form.rooms.map((r, i) => <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-xl bg-white p-2 md:grid-cols-[1.3fr_1.2fr_72px_72px_88px_32px] md:bg-transparent md:p-0" data-testid={`ft-room-row-${i}`}>
                <Combobox options={roomOptions} value={r.room_type_id} onChange={(v) => setRoom(i, "room_type_id", v)} placeholder="Type" testId={`ft-room-${i}-type`} />
                <input className={inp} value={r.label} onChange={(e) => setRoom(i, "label", e.target.value)} placeholder="Master Bedroom" required data-testid={`ft-room-${i}-label`} />
                <input className={inp} type="number" step="0.1" min={0} value={r.length_ft} onChange={(e) => setRoom(i, "length_ft", e.target.value)} placeholder="L" required data-testid={`ft-room-${i}-length`} />
                <input className={inp} type="number" step="0.1" min={0} value={r.width_ft} onChange={(e) => setRoom(i, "width_ft", e.target.value)} placeholder="W" required data-testid={`ft-room-${i}-width`} />
                <input className={cn(inp, "text-right tabular-nums")} type="number" step="0.01" min={0} value={r.area_sqft} onChange={(e) => setRoom(i, "area_sqft", e.target.value)} data-testid={`ft-room-${i}-area`} />
                <button type="button" onClick={() => set("rooms", form.rooms.filter((_, idx) => idx !== i))} disabled={form.rooms.length === 1} className="grid h-10 w-8 place-items-center text-txt-muted hover:text-brick disabled:opacity-30" aria-label="Remove room" data-testid={`ft-room-${i}-remove`}><Trash2 className="h-4 w-4" /></button>
              </div>)}
            </div>
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => set("rooms", [...form.rooms, newRoom()])} data-testid="ft-add-room-btn"><Plus className="h-3.5 w-3.5" />Add room</button>
          </Section>
          <Section title={`Areas · ${form.areas.length}`} testId="ft-areas-section" aside={sbu ? <span className="text-sm text-txt-secondary">Super built-up <b className="font-display text-base text-ink-950 tabular-nums">{num(sbu)}</b> sq ft</span> : null}>
            <div className="space-y-2">
              {form.areas.map((a, i) => <div key={i} className="grid grid-cols-[1fr_140px_32px] items-center gap-2" data-testid={`ft-area-row-${i}`}>
                <Combobox options={areaOptions} value={a.area_type_id} onChange={(v) => setArea(i, "area_type_id", v)} placeholder="Area type" testId={`ft-area-${i}-type`} />
                <input className={cn(inp, "text-right tabular-nums")} type="number" step="0.01" min={0} value={a.value_sqft} onChange={(e) => setArea(i, "value_sqft", e.target.value)} placeholder="sq ft" required data-testid={`ft-area-${i}-value`} />
                <button type="button" onClick={() => set("areas", form.areas.filter((_, idx) => idx !== i))} disabled={form.areas.length === 1} className="grid h-10 w-8 place-items-center text-txt-muted hover:text-brick disabled:opacity-30" aria-label="Remove area" data-testid={`ft-area-${i}-remove`}><Trash2 className="h-4 w-4" /></button>
              </div>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className="btn btn-secondary btn-sm" onClick={() => set("areas", [...form.areas, newArea()])} data-testid="ft-add-area-btn"><Plus className="h-3.5 w-3.5" />Add area</button>
              {(hierarchyError || dupArea) && <span className="flex items-center gap-1.5 rounded-lg bg-brick-50 px-3 py-1.5 text-xs font-semibold text-brick" role="alert" data-testid="ft-hierarchy-error"><AlertTriangle className="h-3.5 w-3.5" />{hierarchyError || "Each area type may appear once"}</span>}
              {!hierarchyError && carpet && builtup && sbu && <span className="text-xs text-txt-muted">Carpet {num(carpet)} ≤ Built-up {num(builtup)} ≤ Super {num(sbu)} ✓</span>}</div>
          </Section>
          {specItems.length > 0 && <Section title={`Specifications · ${form.spec_item_ids.length}`} testId="ft-specs-section">
            <div className="space-y-3">{Object.entries(specGroups).map(([g, its]) => <div key={g}><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-txt-muted">{g}</p><div className="flex flex-wrap gap-2">{its.map((s) => <button type="button" key={s.id} onClick={() => toggleSpec(s.id)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition-colors", form.spec_item_ids.includes(s.id) ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary hover:border-gold")} data-testid={`ft-spec-${s.id}`}>{s.name}{s.brand ? ` · ${s.brand}` : ""}</button>)}</div></div>)}</div>
          </Section>}
          <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-4 border-t border-warm-200 bg-warm-50/95 px-6 py-4 backdrop-blur">
            <div><p className="text-xs text-txt-secondary">Indicative price</p><p className="font-display text-2xl text-ink-950 tabular-nums" data-testid="ft-indicative-price">{indicative ? `₹${new Intl.NumberFormat("en-IN").format(Math.round(indicative))}` : "—"}</p></div>
            <button type="submit" disabled={busy || !!hierarchyError} className="btn btn-primary" data-testid="ft-form-submit">{item ? "Save changes" : "Create flat type"}</button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
