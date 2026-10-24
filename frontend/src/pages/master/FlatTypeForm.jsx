import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { num } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/common/Combobox";
import { Field } from "@/components/common/Bits";

const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"];
const newRoom = () => ({ room_type_id: null, label: "", length_ft: "", width_ft: "", area_sqft: "" });
const newArea = () => ({ area_type_id: null, value_sqft: "" });

export function FlatTypeForm({ item, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(item ? { ...item, rooms: item.rooms.map((r) => ({ ...r })), areas: item.areas.map((a) => ({ ...a })) } : { name: "", code: "", bhk: 2, facing: null, description: "", rooms: [newRoom()], areas: [newArea()], base_rate_per_sqft: "", base_price: "" });
  const [busy, setBusy] = useState(false);
  const { options: roomOptions, items: roomTypes } = useMasterOptions("room-types");
  const { options: areaOptions, items: areaTypes } = useMasterOptions("area-types");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setRoom = (i, k, v) => setForm((f) => {
    const rooms = f.rooms.map((r, idx) => {
      if (idx !== i) return r;
      const nr = { ...r, [k]: v };
      if (k === "length_ft" || k === "width_ft") { const L = Number(k === "length_ft" ? v : nr.length_ft), W = Number(k === "width_ft" ? v : nr.width_ft); nr.area_sqft = L > 0 && W > 0 ? Math.round(L * W * 100) / 100 : ""; }
      if (k === "room_type_id" && !nr.label) nr.label = roomTypes.find((t) => t.id === v)?.name || "";
      return nr;
    });
    return { ...f, rooms };
  });
  const setArea = (i, k, v) => setForm((f) => ({ ...f, areas: f.areas.map((a, idx) => (idx === i ? { ...a, [k]: v } : a)) }));

  const roomTotal = useMemo(() => form.rooms.reduce((s, r) => s + (Number(r.area_sqft) || 0), 0), [form.rooms]);
  const areaByCode = (code) => { const at = areaTypes.find((t) => t.code === code); return Number(form.areas.find((a) => a.area_type_id === at?.id)?.value_sqft) || null; };
  const carpet = areaByCode("CARPET"), builtup = areaByCode("BUILTUP"), sbu = areaByCode("SUPER_BUILTUP");
  const hierarchyError = (carpet && builtup && carpet > builtup) ? "Carpet > built-up" : (builtup && sbu && builtup > sbu) ? "Built-up > super built-up" : (carpet && sbu && carpet > sbu) ? "Carpet > super built-up" : null;
  const rate = Number(form.base_rate_per_sqft) || 0;
  const indicative = form.base_price ? Number(form.base_price) : rate && sbu ? rate * sbu : null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const payload = {
      version: item?.version, name: form.name, code: form.code.toUpperCase(), bhk: Number(form.bhk), facing: form.facing || null, description: form.description || null,
      rooms: form.rooms.map((r) => ({ room_type_id: r.room_type_id, label: r.label, length_ft: Number(r.length_ft), width_ft: Number(r.width_ft), area_sqft: Number(r.area_sqft) || null })),
      areas: form.areas.map((a) => ({ area_type_id: a.area_type_id, value_sqft: Number(a.value_sqft) })),
      base_rate_per_sqft: form.base_rate_per_sqft === "" || form.base_rate_per_sqft == null ? null : Number(form.base_rate_per_sqft),
      base_price: form.base_price === "" || form.base_price == null ? null : Number(form.base_price),
    };
    try {
      item ? await api.patch(`/master/flat-types/${item.id}`, payload) : await api.post("/master/flat-types", payload);
      toast.success(item ? "Flat type updated" : "Flat type created"); onSaved(); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="flat-type-form-sheet">
        <SheetHeader><SheetTitle>{item ? "Edit flat type" : "New flat type"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Name" required className="col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="3BHK-A" data-testid="ft-name-input" /></Field>
            <Field label="Code" required><Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required data-testid="ft-code-input" /></Field>
            <Field label="BHK" required><Input type="number" step="0.5" min={0} value={form.bhk} onChange={(e) => set("bhk", e.target.value)} required data-testid="ft-bhk-input" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Facing"><Select value={form.facing || "none"} onValueChange={(v) => set("facing", v === "none" ? null : v)}><SelectTrigger data-testid="ft-facing-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not set</SelectItem>{FACINGS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Base rate ₹/sq.ft"><Input type="number" min={0} value={form.base_rate_per_sqft ?? ""} onChange={(e) => set("base_rate_per_sqft", e.target.value)} data-testid="ft-rate-input" /></Field>
            <Field label="Base price ₹ (lump sum)"><Input type="number" min={0} value={form.base_price ?? ""} onChange={(e) => set("base_price", e.target.value)} data-testid="ft-price-input" /></Field>
          </div>
          <Field label="Description"><Textarea rows={2} value={form.description || ""} onChange={(e) => set("description", e.target.value)} data-testid="ft-description-input" /></Field>

          <div className="rounded-lg border p-3" data-testid="ft-rooms-section">
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold text-navy">Rooms <span className="text-xs font-normal text-slate-500">({form.rooms.length})</span></p><span className="text-xs text-slate-500">Total <b className="tabular text-navy" data-testid="ft-rooms-total">{num(roomTotal)}</b> sq.ft</span></div>
            <div className="mb-1 grid grid-cols-[1.3fr_1.2fr_70px_70px_80px_32px] gap-2 label-xs"><span>Room type</span><span>Label</span><span>L (ft)</span><span>W (ft)</span><span>Sq.ft</span><span /></div>
            <div className="space-y-2">
              {form.rooms.map((r, i) => (
                <div key={i} className="grid grid-cols-[1.3fr_1.2fr_70px_70px_80px_32px] items-center gap-2" data-testid={`ft-room-row-${i}`}>
                  <Combobox options={roomOptions} value={r.room_type_id} onChange={(v) => setRoom(i, "room_type_id", v)} placeholder="Type" testId={`ft-room-${i}-type`} />
                  <Input value={r.label} onChange={(e) => setRoom(i, "label", e.target.value)} placeholder="Master Bedroom" className="h-9" required data-testid={`ft-room-${i}-label`} />
                  <Input type="number" step="0.1" min={0} value={r.length_ft} onChange={(e) => setRoom(i, "length_ft", e.target.value)} className="h-9" required data-testid={`ft-room-${i}-length`} />
                  <Input type="number" step="0.1" min={0} value={r.width_ft} onChange={(e) => setRoom(i, "width_ft", e.target.value)} className="h-9" required data-testid={`ft-room-${i}-width`} />
                  <Input type="number" step="0.01" min={0} value={r.area_sqft} onChange={(e) => setRoom(i, "area_sqft", e.target.value)} className="h-9 tabular" data-testid={`ft-room-${i}-area`} />
                  <button type="button" onClick={() => set("rooms", form.rooms.filter((_, idx) => idx !== i))} disabled={form.rooms.length === 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30" data-testid={`ft-room-${i}-remove`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => set("rooms", [...form.rooms, newRoom()])} data-testid="ft-add-room-btn"><Plus className="mr-1 h-3.5 w-3.5" />Add room</Button>
          </div>

          <div className="rounded-lg border p-3" data-testid="ft-areas-section">
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold text-navy">Areas <span className="text-xs font-normal text-slate-500">({form.areas.length})</span></p>{hierarchyError ? <span className="text-xs font-semibold text-red-600" data-testid="ft-hierarchy-error">{hierarchyError}</span> : sbu ? <span className="text-xs text-slate-500">Super built-up <b className="tabular text-navy">{num(sbu)}</b> sq.ft</span> : null}</div>
            <div className="space-y-2">
              {form.areas.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_32px] items-center gap-2" data-testid={`ft-area-row-${i}`}>
                  <Combobox options={areaOptions} value={a.area_type_id} onChange={(v) => setArea(i, "area_type_id", v)} placeholder="Area type" testId={`ft-area-${i}-type`} />
                  <Input type="number" step="0.01" min={0} value={a.value_sqft} onChange={(e) => setArea(i, "value_sqft", e.target.value)} placeholder="sq.ft" className="h-9 tabular" required data-testid={`ft-area-${i}-value`} />
                  <button type="button" onClick={() => set("areas", form.areas.filter((_, idx) => idx !== i))} disabled={form.areas.length === 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30" data-testid={`ft-area-${i}-remove`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => set("areas", [...form.areas, newArea()])} data-testid="ft-add-area-btn"><Plus className="mr-1 h-3.5 w-3.5" />Add area</Button>
          </div>

          <div className="flex items-center justify-between rounded-md bg-navy-50 px-3 py-2 text-sm"><span className="text-slate-600">Indicative price</span><b className="tabular text-navy" data-testid="ft-indicative-price">{indicative ? `₹${new Intl.NumberFormat("en-IN").format(Math.round(indicative))}` : "—"}</b></div>
          <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="ft-form-submit">{item ? "Save changes" : "Create flat type"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
