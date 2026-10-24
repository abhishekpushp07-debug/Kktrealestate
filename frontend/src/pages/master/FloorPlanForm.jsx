import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/common/Combobox";
import { Field } from "@/components/common/Bits";

const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"];

export function FloorPlanForm({ item, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(item ? { ...item } : { name: "", code: "", flats_per_floor: 4, positions: [] });
  const [busy, setBusy] = useState(false);
  const { options: ftOptions } = useMasterOptions("flat-types", (x) => ({ value: x.id, label: x.name, sub: `${x.bhk} BHK` }));
  const n = Number(form.flats_per_floor) || 0;
  const positions = Array.from({ length: n }, (_, i) => form.positions.find((p) => p.position === i + 1) || { position: i + 1, flat_type_id: null, facing: null, is_corner: i === 0 || i === n - 1 });
  const setPos = (i, k, v) => setForm({ ...form, positions: positions.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const submit = async (e) => {
    e.preventDefault();
    if (positions.some((p) => !p.flat_type_id)) { toast.error("Assign a flat type to every position"); return; }
    setBusy(true);
    const payload = { name: form.name, code: form.code || null, flats_per_floor: n, positions: positions.map((p) => ({ position: p.position, flat_type_id: p.flat_type_id, facing: p.facing || null, is_corner: !!p.is_corner })) };
    try { item ? await api.patch(`/master/floor-plan-templates/${item.id}`, { ...payload, version: item.version }) : await api.post("/master/floor-plan-templates", payload); toast.success("Saved"); onSaved(); onOpenChange(false); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="floor-plan-form-sheet">
        <SheetHeader><SheetTitle>{item ? "Edit floor plan" : "New floor plan template"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name" required className="col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="fp-name-input" /></Field>
            <Field label="Code"><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="fp-code-input" /></Field>
          </div>
          <Field label="Flats per floor" required><Input type="number" min={1} max={50} value={form.flats_per_floor} onChange={(e) => setForm({ ...form, flats_per_floor: e.target.value })} data-testid="fp-fpf-input" /></Field>
          <div className="space-y-2 rounded-md border p-3" data-testid="fp-positions">
            <div className="grid grid-cols-[60px_1fr_90px_70px] gap-2 label-xs"><span>Pos</span><span>Flat type</span><span>Facing</span><span>Corner</span></div>
            {positions.map((p, i) => (
              <div key={p.position} className="grid grid-cols-[60px_1fr_90px_70px] items-center gap-2" data-testid={`fp-position-${p.position}`}>
                <span className="text-sm font-bold text-navy">{p.position}</span>
                <Combobox options={ftOptions} value={p.flat_type_id} onChange={(v) => setPos(i, "flat_type_id", v)} testId={`fp-position-${p.position}-type`} />
                <Select value={p.facing || "none"} onValueChange={(v) => setPos(i, "facing", v === "none" ? null : v)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{FACINGS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select>
                <Checkbox checked={!!p.is_corner} onCheckedChange={(c) => setPos(i, "is_corner", !!c)} data-testid={`fp-position-${p.position}-corner`} />
              </div>
            ))}
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="fp-form-submit">{item ? "Save changes" : "Create template"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
