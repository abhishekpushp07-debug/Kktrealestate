import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Bits";

export function MilestoneForm({ item, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(item ? { name: item.name, milestones: item.milestones.map((m) => ({ ...m })) } : { name: "", milestones: [{ seq: 1, name: "Booking", cumulative_percent: 10 }, { seq: 2, name: "Possession", cumulative_percent: 100 }] });
  const [busy, setBusy] = useState(false);
  const setM = (i, k, v) => setForm((f) => ({ ...f, milestones: f.milestones.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)) }));
  const renumber = (ms) => ms.map((m, i) => ({ ...m, seq: i + 1 }));
  const pct = form.milestones.map((m) => Number(m.cumulative_percent));
  const bad = pct.some((p, i) => i > 0 && p <= pct[i - 1]) ? "Percentages must be strictly increasing" : pct[pct.length - 1] !== 100 ? "Last milestone must be 100%" : null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const payload = { version: item?.version, name: form.name, milestones: renumber(form.milestones).map((m) => ({ seq: m.seq, name: m.name, cumulative_percent: Number(m.cumulative_percent) })) };
    try {
      item ? await api.patch(`/master/milestone-templates/${item.id}`, payload) : await api.post("/master/milestone-templates", payload);
      toast.success("Saved"); onSaved(); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="milestone-form-sheet">
        <SheetHeader><SheetTitle>{item ? "Edit milestone template" : "New milestone template"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Template name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="mt-name-input" /></Field>
          <div className="rounded-lg border p-3">
            <div className="mb-1 grid grid-cols-[40px_1fr_110px_32px] gap-2 label-xs"><span>#</span><span>Milestone</span><span>Cumulative %</span><span /></div>
            <div className="space-y-2">
              {form.milestones.map((m, i) => (
                <div key={i} className="grid grid-cols-[40px_1fr_110px_32px] items-center gap-2" data-testid={`mt-row-${i}`}>
                  <span className="text-sm font-bold tabular text-navy">{i + 1}</span>
                  <Input value={m.name} onChange={(e) => setM(i, "name", e.target.value)} className="h-9" required data-testid={`mt-row-${i}-name`} />
                  <Input type="number" min={0.01} max={100} step="0.01" value={m.cumulative_percent} onChange={(e) => setM(i, "cumulative_percent", e.target.value)} className="h-9 tabular" required data-testid={`mt-row-${i}-pct`} />
                  <button type="button" onClick={() => setForm({ ...form, milestones: renumber(form.milestones.filter((_, idx) => idx !== i)) })} disabled={form.milestones.length === 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setForm({ ...form, milestones: renumber([...form.milestones, { name: "", cumulative_percent: "" }]) })} data-testid="mt-add-btn"><Plus className="mr-1 h-3.5 w-3.5" />Add milestone</Button>
          </div>
          {bad && <p className="text-xs font-semibold text-red-600" data-testid="mt-error">{bad}</p>}
          <Button type="submit" disabled={busy || !!bad} className="w-full bg-navy hover:bg-navy-700" data-testid="mt-form-submit">{item ? "Save changes" : "Create template"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
