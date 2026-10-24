import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/common/Combobox";
import { Field } from "@/components/common/Bits";

const PATTERNS = [["{block}-{floor}{pos2}", "A-101 (block-floor+position)"], ["{floor}{pos2}", "101 (floor+position)"], ["{block}{seq}", "A1, A2 … (block+sequence)"]];
const STEPS = ["Type & floors", "Floor plans", "Pricing", "Preview"];
const parseList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n));

export function BlockForm({ open, onOpenChange, project, onSaved }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", code: "", block_type_id: null, floors: 8, floor_start: 1, ground_floor_label: "", skip_floors: "", refuge_floors: "", podium_floors: "", numbering_pattern: "{block}-{floor}{pos2}", milestone_template_id: project?.milestone_template_id || null, rate_per_sqft: "", floor_rise_per_sqft: "", status: "Planning", floor_plans: [{ from_floor: 1, to_floor: 8, floor_plan_template_id: null }] });
  const [busy, setBusy] = useState(false);
  const { options: btOptions, items: blockTypes } = useMasterOptions("block-types");
  const { options: fpOptions, items: templates } = useMasterOptions("floor-plan-templates", (x) => ({ value: x.id, label: x.name, sub: `${x.flats_per_floor}/floor` }));
  const { options: mtOptions } = useMasterOptions("milestone-templates", (x) => ({ value: x.id, label: x.name }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const bt = blockTypes.find((b) => b.id === form.block_type_id);
  const hasFloors = bt ? bt.has_floors : true;
  useEffect(() => { if (bt && !bt.has_floors) setForm((f) => ({ ...f, floors: 1, numbering_pattern: "{block}{seq}", skip_floors: "", refuge_floors: "", podium_floors: "", floor_plans: [{ from_floor: 1, to_floor: 1, floor_plan_template_id: f.floor_plans[0]?.floor_plan_template_id || null }] })); }, [bt]);

  const labels = useMemo(() => { const skip = new Set(parseList(form.skip_floors)); const out = []; let f = Number(form.floor_start) || 0; while (out.length < (Number(form.floors) || 0) && out.length < 300) { if (!skip.has(f)) out.push(f); f++; } return out; }, [form.floors, form.floor_start, form.skip_floors]);
  const noUnit = new Set([...parseList(form.refuge_floors), ...parseList(form.podium_floors)]);
  const unitFloors = labels.filter((f) => !noUnit.has(f));
  const planFor = (f) => form.floor_plans.find((p) => p.from_floor <= f && f <= p.to_floor);
  const gaps = unitFloors.filter((f) => !planFor(f) || !planFor(f).floor_plan_template_id);
  const preview = unitFloors.map((f) => { const t = templates.find((x) => x.id === planFor(f)?.floor_plan_template_id); return { floor: f, count: t?.flats_per_floor || 0, name: t?.name }; });
  const total = preview.reduce((s, p) => s + p.count, 0);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post("/blocks", {
        project_id: project.id, block_type_id: form.block_type_id, name: form.name, code: form.code, floors: Number(form.floors), floor_start: Number(form.floor_start),
        ground_floor_label: form.ground_floor_label || null, skip_floors: parseList(form.skip_floors), refuge_floors: parseList(form.refuge_floors), podium_floors: parseList(form.podium_floors),
        numbering_pattern: form.numbering_pattern, floor_plans: form.floor_plans.map((p) => ({ from_floor: Number(p.from_floor), to_floor: Number(p.to_floor), floor_plan_template_id: p.floor_plan_template_id })),
        milestone_template_id: form.milestone_template_id || null, rate_per_sqft: form.rate_per_sqft === "" ? null : Number(form.rate_per_sqft), floor_rise_per_sqft: form.floor_rise_per_sqft === "" ? null : Number(form.floor_rise_per_sqft), status: form.status,
      });
      toast.success(`Block created · ${r.data.flats_generated} flats generated`);
      onSaved?.(r.data); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const canNext = step === 0 ? form.name && form.code && form.block_type_id && form.floors > 0 : step === 1 ? gaps.length === 0 : true;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="block-form-sheet">
        <SheetHeader><SheetTitle>New block in {project?.name}</SheetTitle></SheetHeader>
        <ol className="mt-4 flex items-center gap-2 text-xs" data-testid="block-wizard-steps">{STEPS.map((s, i) => <li key={s} className={cn("flex items-center gap-1.5", i === step ? "font-bold text-navy" : "text-slate-400")}><span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px]", i <= step ? "bg-gold text-navy" : "bg-slate-200")}>{i + 1}</span>{s}{i < STEPS.length - 1 && <ChevronRight className="h-3 w-3" />}</li>)}</ol>
        <div className="mt-6 space-y-4">
          {step === 0 && <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Block name" required className="col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Tower D" data-testid="block-name-input" /></Field>
              <Field label="Code" required><Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="D" maxLength={10} data-testid="block-code-input" /></Field>
            </div>
            <Field label="Block type" required><Combobox options={btOptions} value={form.block_type_id} onChange={(v) => set("block_type_id", v)} testId="block-type-combobox" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Floors" required><Input type="number" min={1} value={form.floors} disabled={!hasFloors} onChange={(e) => { set("floors", e.target.value); }} data-testid="block-floors-input" /></Field>
              <Field label="Floor start" hint="0 for ground"><Input type="number" min={0} value={form.floor_start} onChange={(e) => set("floor_start", e.target.value)} data-testid="block-floor-start-input" /></Field>
              <Field label="Ground label" hint='e.g. "G"'><Input value={form.ground_floor_label} onChange={(e) => set("ground_floor_label", e.target.value)} maxLength={5} data-testid="block-ground-label-input" /></Field>
            </div>
            {hasFloors && <div className="grid grid-cols-3 gap-3">
              <Field label="Skip floor numbers" hint="e.g. 13"><Input value={form.skip_floors} onChange={(e) => set("skip_floors", e.target.value)} placeholder="13" data-testid="block-skip-floors-input" /></Field>
              <Field label="Refuge floors" hint="no units"><Input value={form.refuge_floors} onChange={(e) => set("refuge_floors", e.target.value)} placeholder="7" data-testid="block-refuge-floors-input" /></Field>
              <Field label="Podium floors" hint="no units"><Input value={form.podium_floors} onChange={(e) => set("podium_floors", e.target.value)} data-testid="block-podium-floors-input" /></Field>
            </div>}
            <Field label="Numbering pattern"><Select value={form.numbering_pattern} onValueChange={(v) => set("numbering_pattern", v)}><SelectTrigger data-testid="block-pattern-select"><SelectValue /></SelectTrigger><SelectContent>{PATTERNS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>
            <p className="rounded-md bg-navy-50 px-3 py-2 text-xs text-navy">Floor labels: {labels.join(", ") || "—"}</p>
          </>}
          {step === 1 && <>
            <p className="text-sm text-slate-600">Assign a floor plan template to each floor range. Templates define flats per floor, flat types, facing and corners.</p>
            <div className="space-y-2" data-testid="block-floor-plans">
              {form.floor_plans.map((p, i) => (
                <div key={i} className="grid grid-cols-[90px_90px_1fr_32px] items-center gap-2" data-testid={`floor-plan-row-${i}`}>
                  <Input type="number" value={p.from_floor} onChange={(e) => set("floor_plans", form.floor_plans.map((x, j) => j === i ? { ...x, from_floor: Number(e.target.value) } : x))} className="h-9" data-testid={`floor-plan-${i}-from`} />
                  <Input type="number" value={p.to_floor} onChange={(e) => set("floor_plans", form.floor_plans.map((x, j) => j === i ? { ...x, to_floor: Number(e.target.value) } : x))} className="h-9" data-testid={`floor-plan-${i}-to`} />
                  <Combobox options={fpOptions} value={p.floor_plan_template_id} onChange={(v) => set("floor_plans", form.floor_plans.map((x, j) => j === i ? { ...x, floor_plan_template_id: v } : x))} placeholder="Floor plan template" testId={`floor-plan-${i}-template`} />
                  <button type="button" onClick={() => set("floor_plans", form.floor_plans.filter((_, j) => j !== i))} disabled={form.floor_plans.length === 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { const last = form.floor_plans[form.floor_plans.length - 1]; set("floor_plans", [...form.floor_plans, { from_floor: last.to_floor + 1, to_floor: labels[labels.length - 1] || last.to_floor + 1, floor_plan_template_id: null }]); }} data-testid="add-floor-plan-range"><Plus className="mr-1 h-3.5 w-3.5" />Add range</Button>
            {gaps.length > 0 && <p className="text-xs font-semibold text-red-600" data-testid="floor-plan-gap-error">Floors without a plan: {gaps.join(", ")}</p>}
            <p className="text-xs text-slate-500">Need a new template? Create it under Master Data → Floor Plan Templates.</p>
          </>}
          {step === 2 && <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate ₹/sq.ft" hint="Overrides flat type base rate; rate cards can re-price later"><Input type="number" min={0} value={form.rate_per_sqft} onChange={(e) => set("rate_per_sqft", e.target.value)} data-testid="block-rate-input" /></Field>
              <Field label="Floor rise ₹/sq.ft per floor"><Input type="number" min={0} value={form.floor_rise_per_sqft} onChange={(e) => set("floor_rise_per_sqft", e.target.value)} data-testid="block-floor-rise-input" /></Field>
            </div>
            <Field label="Milestone template" hint="Defaults to project template"><Combobox options={mtOptions} value={form.milestone_template_id} onChange={(v) => set("milestone_template_id", v)} testId="block-milestone-combobox" /></Field>
            <Field label="Status"><Select value={form.status} onValueChange={(v) => set("status", v)}><SelectTrigger data-testid="block-status-select"><SelectValue /></SelectTrigger><SelectContent>{["Planning", "Under Construction", "Ready", "Completed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
          </>}
          {step === 3 && <>
            <div className="rounded-md bg-navy px-4 py-3 text-white" data-testid="block-generate-summary">Will generate <b className="text-gold">{total}</b> flats across {unitFloors.length} unit floors ({labels.length} physical floors).</div>
            <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-2" data-testid="block-preview-grid">
              {[...labels].reverse().map((f) => { const p = preview.find((x) => x.floor === f); return (
                <div key={f} className="flex items-center gap-2 text-xs"><span className="w-10 rounded bg-navy px-1.5 py-1 text-center font-bold text-gold">{f === 0 && form.ground_floor_label ? form.ground_floor_label : f}</span>
                  {p ? <div className="flex flex-1 gap-1">{Array.from({ length: p.count }).map((_, i) => <span key={i} className="flex-1 rounded border border-emerald-200 bg-emerald-50 py-1 text-center text-[10px] text-emerald-700">{form.numbering_pattern === "{block}{seq}" ? "" : `${form.code}-${f}${String(i + 1).padStart(2, "0")}`}</span>)}<span className="ml-1 text-slate-400">{p.name}</span></div> : <span className="flex-1 rounded border border-dashed border-slate-300 py-1 text-center text-[10px] text-slate-400">{noUnit.has(f) ? "refuge / podium — no units" : "—"}</span>}
                </div>); })}
            </div>
          </>}
        </div>
        <div className="mt-6 flex justify-between">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="block-wizard-back"><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
          {step < 3 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)} className="bg-navy hover:bg-navy-700" data-testid="block-wizard-next">Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            : <Button disabled={busy || total === 0} onClick={submit} className="bg-navy hover:bg-navy-700" data-testid="block-form-submit">Create block & generate {total} flats</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
