import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/Bits";
import { Combobox } from "@/components/common/Combobox";
import { useMasterOptions } from "@/hooks/useList";

function MasterCombo({ field, value, onChange }) {
  const { options } = useMasterOptions(field.master);
  return <Combobox options={options} value={value || null} onChange={onChange} testId={`master-field-${field.name}`} />;
}

export function GenericMasterForm({ cfg, item, open, onOpenChange, onSaved }) {
  const init = {};
  cfg.fields.forEach((f) => { init[f.name] = item ? (item[f.name] ?? (f.type === "switch" ? false : "")) : (f.default ?? (f.type === "switch" ? false : "")); });
  if (cfg.kind === "bank-accounts") init.account_number = "";
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
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
      item ? await api.patch(`/master/${cfg.kind}/${item.id}`, payload) : await api.post(`/master/${cfg.kind}`, payload);
      toast.success(item ? "Updated" : "Created"); onSaved(); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="master-form-sheet">
        <SheetHeader><SheetTitle>{item ? `Edit ${cfg.label.replace(/s$/, "")}` : `New ${cfg.label.replace(/s$/, "")}`}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {cfg.fields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required && !(item && f.name === "account_number")} hint={item && f.name === "account_number" ? `Current: ${item.account_number_masked || "—"} · leave blank to keep` : f.hint}>
              {f.type === "switch" ? <div><Switch checked={!!form[f.name]} onCheckedChange={(c) => set(f.name, c)} data-testid={`master-field-${f.name}`} /></div>
                : f.type === "select" ? <Select value={form[f.name] || ""} onValueChange={(v) => set(f.name, v)}><SelectTrigger data-testid={`master-field-${f.name}`}><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>
                : f.type === "master" ? <MasterCombo field={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />
                : f.type === "textarea" ? <Textarea value={form[f.name] || ""} onChange={(e) => set(f.name, e.target.value)} data-testid={`master-field-${f.name}`} />
                : <Input type={f.type} value={form[f.name] ?? ""} onChange={(e) => set(f.name, f.upper ? e.target.value.toUpperCase() : e.target.value)} required={f.required && !(item && f.name === "account_number")} data-testid={`master-field-${f.name}`} />}
            </Field>
          ))}
          <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="master-form-submit">{item ? "Save changes" : "Create"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
