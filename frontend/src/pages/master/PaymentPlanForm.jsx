/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field } from "@/components/common/Bits";

export const TRIGGERS = [["ON_BOOKING", "On booking"], ["DAYS_AFTER_BOOKING", "Days after booking"], ["ON_STAGE", "On construction stage"], ["ON_POSSESSION", "On possession"], ["ON_DATE", "On a fixed date"]];
const PLAN_TYPES = ["CLP", "Down Payment", "Time Linked", "Flexi", "Custom"];
const blankIns = (seq) => ({ seq, name: "", percent: "", trigger_type: "ON_STAGE", trigger_days: "", trigger_stage_id: "", trigger_date: "", due_days: "" });

export function PaymentPlanForm({ item, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(item ? { ...item, installments: item.installments.map((i) => ({ ...i, trigger_days: i.trigger_days ?? "", trigger_stage_id: i.trigger_stage_id ?? "", trigger_date: i.trigger_date ?? "", due_days: i.due_days ?? "" })) } : { name: "", code: "", description: "", plan_type: "CLP", grace_days: 0, installments: [{ ...blankIns(1), name: "Booking amount", percent: 10, trigger_type: "ON_BOOKING" }, blankIns(2)] });
  const [stages, setStages] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/master/construction-stages?page_size=100").then((r) => setStages(r.data.items)).catch(() => {}); }, []);
  const setI = (i, k, v) => setForm((f) => ({ ...f, installments: f.installments.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)) }));
  const sum = Math.round(form.installments.reduce((s, i) => s + (Number(i.percent) || 0), 0) * 100) / 100;
  const ok = sum === 100;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const payload = { version: item?.version, name: form.name, code: form.code.toUpperCase(), description: form.description || null, plan_type: form.plan_type, grace_days: Number(form.grace_days) || 0, applies_percent_to: "BOTH_BUCKETS",
      installments: form.installments.map((i, idx) => ({ seq: idx + 1, name: i.name, percent: Number(i.percent), trigger_type: i.trigger_type, trigger_days: i.trigger_type === "DAYS_AFTER_BOOKING" ? Number(i.trigger_days) : null, trigger_stage_id: ["ON_STAGE", "ON_POSSESSION"].includes(i.trigger_type) ? (i.trigger_stage_id || stages.find((s) => s.is_possession)?.id || null) : null, trigger_date: i.trigger_type === "ON_DATE" ? i.trigger_date : null, due_days: i.due_days === "" ? null : Number(i.due_days), notes: null })) };
    try { item ? await api.patch(`/master/payment-plans/${item.id}`, payload) : await api.post("/master/payment-plans", payload); toast.success("Plan saved"); onSaved(); onOpenChange(false); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="payment-plan-form-sheet">
        <SheetHeader><SheetTitle>{item ? "Edit payment plan" : "New payment plan"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Plan name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="pp-name" /></Field>
            <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required data-testid="pp-code" /></Field>
            <Field label="Type"><select className="h-10 w-full rounded-md border px-3 text-sm" value={form.plan_type} onChange={(e) => setForm({ ...form, plan_type: e.target.value })} data-testid="pp-type">{PLAN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          </div>
          <Field label="Description"><Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between"><p className="label-xs">Installments (% applies equally to Cash and Account buckets)</p><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ok ? "bg-sage-50 text-sage" : "bg-brick-50 text-brick"}`} data-testid="pp-sum">Σ {sum.toFixed(2)}% {ok ? "✓" : "≠ 100"}</span></div>
            <div className="space-y-2">
              {form.installments.map((ins, i) => <div key={i} className="grid grid-cols-[28px_1fr_90px_170px_1fr_80px_32px] items-center gap-2" data-testid={`pp-row-${i}`}>
                <span className="text-sm font-bold text-ink-950">{i + 1}</span>
                <Input className="h-9" placeholder="Name" value={ins.name} onChange={(e) => setI(i, "name", e.target.value)} required data-testid={`pp-row-${i}-name`} />
                <Input className="h-9 tabular" type="number" step="0.01" min="0.01" max="100" placeholder="%" value={ins.percent} onChange={(e) => setI(i, "percent", e.target.value)} required data-testid={`pp-row-${i}-pct`} />
                <select className="h-9 rounded-md border px-2 text-xs" value={ins.trigger_type} onChange={(e) => setI(i, "trigger_type", e.target.value)} data-testid={`pp-row-${i}-trigger`}>{TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                {ins.trigger_type === "DAYS_AFTER_BOOKING" ? <Input className="h-9" type="number" min="0" placeholder="days" value={ins.trigger_days} onChange={(e) => setI(i, "trigger_days", e.target.value)} required data-testid={`pp-row-${i}-days`} />
                  : ins.trigger_type === "ON_STAGE" ? <select className="h-9 rounded-md border px-2 text-xs" value={ins.trigger_stage_id} onChange={(e) => setI(i, "trigger_stage_id", e.target.value)} required data-testid={`pp-row-${i}-stage`}><option value="">Select stage…</option>{stages.filter((s) => !s.is_possession).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  : ins.trigger_type === "ON_DATE" ? <DateInput className="h-9" value={ins.trigger_date} onChange={(e) => setI(i, "trigger_date", e.target.value)} required data-testid={`pp-row-${i}-date`} />
                  : <span className="text-xs text-txt-muted">{ins.trigger_type === "ON_POSSESSION" ? "Possession stage" : "At booking"}</span>}
                <Input className="h-9" type="number" min="0" placeholder="due d" title="Days to pay after trigger (blank = company default)" value={ins.due_days} onChange={(e) => setI(i, "due_days", e.target.value)} data-testid={`pp-row-${i}-due`} />
                <button type="button" onClick={() => setForm((f) => ({ ...f, installments: f.installments.filter((_, idx) => idx !== i) }))} className="grid h-8 w-8 place-items-center text-txt-muted hover:text-brick" data-testid={`pp-row-${i}-del`}><Trash2 className="h-4 w-4" /></button>
              </div>)}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setForm((f) => ({ ...f, installments: [...f.installments, blankIns(f.installments.length + 1)] }))} data-testid="pp-add-row"><Plus className="mr-1 h-3.5 w-3.5" />Add installment</Button>
          </div>
          <Button type="submit" disabled={busy || !ok} className="w-full bg-ink-950 hover:bg-ink-800" data-testid="pp-save">{busy ? "Saving…" : "Save plan"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
