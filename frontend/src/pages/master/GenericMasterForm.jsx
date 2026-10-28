import { useState } from "react";
import { toast } from "sonner";
import * as Icons from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/v2";
import { Combobox } from "@/components/common/Combobox";
import { useMasterOptions } from "@/hooks/useList";
import { cn } from "@/lib/utils";

const ICONS = ["Waves", "Dumbbell", "Trees", "ShieldCheck", "Camera", "Car", "Flame", "Baby", "Gamepad2", "BookOpen", "Coffee", "Bike", "Sun", "Zap", "Droplets", "Wind", "Lock", "Users", "Music", "Utensils", "Sprout", "Mountain", "Building2", "Footprints"];
function IconPicker({ value, onChange, testId }) {
  return <div className="grid grid-cols-8 gap-1.5 rounded-xl border border-warm-200 bg-white p-2" data-testid={testId}>{ICONS.map((n) => { const I = Icons[n]; return <button type="button" key={n} title={n} onClick={() => onChange(value === n ? "" : n)} className={cn("grid h-9 w-full place-items-center rounded-lg transition-colors", value === n ? "bg-ink-950 text-warm-50" : "text-txt-secondary hover:bg-warm-100")} data-testid={`${testId}-${n}`}><I className="h-4 w-4" strokeWidth={1.75} /></button>; })}</div>;
}
function MasterCombo({ field, value, onChange }) {
  const { options } = useMasterOptions(field.master);
  return <Combobox options={options} value={value || null} onChange={onChange} testId={`master-field-${field.name}`} />;
}
const singularOf = (l) => l.replace(/ies$/, "y").replace(/s$/, "");

export function GenericMasterForm({ cfg, item, open, onOpenChange, onSaved, existing = [] }) {
  const singular = singularOf(cfg.label);
  const init = {};
  cfg.fields.forEach((f) => { init[f.name] = item ? (item[f.name] ?? (f.type === "switch" ? false : "")) : (f.default ?? (f.type === "switch" ? false : "")); });
  if (cfg.kind === "bank-accounts") init.account_number = "";
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const nameKey = cfg.fields.find((f) => ["name", "title", "code"].includes(f.name))?.name;
  const dupe = nameKey && form[nameKey] && existing.find((r) => r.id !== item?.id && String(r[nameKey] || "").trim().toLowerCase() === String(form[nameKey]).trim().toLowerCase());
  const submit = async (e, addAnother = false) => {
    e.preventDefault(); setBusy(true);
    const payload = { version: item?.version };
    cfg.fields.forEach((f) => {
      let v = form[f.name];
      if (f.type === "number") v = v === "" || v === null ? null : Number(v);
      else if (f.type === "text" || f.type === "textarea") { v = v === "" ? null : v; if (v && f.upper) v = v.toUpperCase(); }
      if (item && f.name === "account_number" && !v) return;
      if (f.type === "master") v = v || null;
      if (v === null && !item && !f.required) return;
      payload[f.name] = v;
    });
    try {
      const r = item ? await api.patch(`/master/${cfg.kind}/${item.id}`, payload) : await api.post(`/master/${cfg.kind}`, payload);
      toast.success(item ? "Updated" : addAnother ? `Created · ${payload[nameKey] || ""} — add the next one` : "Created"); onSaved(r.data);
      if (addAnother) { setForm(init); setSaved((n) => n + 1); document.querySelector('[data-testid="master-form-sheet"] input')?.focus(); } else onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const inp = "input !h-10";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md" data-testid="master-form-sheet">
        <SheetHeader><p className="label">{cfg.label}</p><SheetTitle className="font-display text-2xl">{item ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}{saved > 0 && <span className="pill ml-2 bg-sage-50 text-sage" data-testid="master-form-saved-count">{saved} added</span>}</SheetTitle></SheetHeader>
        <form onSubmit={(e) => submit(e, false)} className="mt-6 space-y-5">
          {cfg.fields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required && !(item && f.name === "account_number")} hint={item && f.name === "account_number" ? `Current: ${item.account_number_masked || "—"} · leave blank to keep` : f.hint} error={f.name === nameKey && dupe ? `A ${singular.toLowerCase()} named “${dupe[nameKey]}” already exists${dupe.is_active === false ? " (inactive)" : ""}.` : undefined}>
              {f.type === "switch" ? <div className="flex h-10 items-center"><Switch checked={!!form[f.name]} onCheckedChange={(c) => set(f.name, c)} data-testid={`master-field-${f.name}`} /></div>
                : f.type === "select" ? <select className={inp} value={form[f.name] || ""} onChange={(e) => set(f.name, e.target.value)} data-testid={`master-field-${f.name}`}><option value="">Select…</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : f.type === "master" ? <MasterCombo field={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />
                : f.type === "textarea" ? <textarea className="input min-h-[72px] py-2" value={form[f.name] || ""} onChange={(e) => set(f.name, e.target.value)} data-testid={`master-field-${f.name}`} />
                : f.name === "icon" ? <IconPicker value={form.icon} onChange={(v) => set("icon", v)} testId="master-icon-picker" />
                : <input className={cn(inp, f.name === "account_number" && "font-mono")} type={f.type} value={form[f.name] ?? ""} onChange={(e) => set(f.name, f.upper ? e.target.value.toUpperCase() : e.target.value)} required={f.required && !(item && f.name === "account_number")} aria-invalid={f.name === nameKey && !!dupe} placeholder={f.name === "account_number" && item ? item.account_number_masked : undefined} data-testid={`master-field-${f.name}`} />}
            </Field>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={busy} className="btn btn-primary flex-1" data-testid="master-form-submit">{item ? "Save changes" : "Create"}</button>
            {!item && <button type="button" className="btn btn-secondary" disabled={busy} onClick={(e) => submit(e, true)} data-testid="master-form-submit-another">Save & add another</button>}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
