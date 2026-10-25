import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useCatalogues } from "@/hooks/useCatalogues";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field } from "@/components/v2";
import { Select } from "@/components/v2/Select";

export default function QuickCustomerSheet({ open, onOpenChange, onSaved }) {
  const { catalogues } = useCatalogues();
  const label = (t, id) => catalogues?.types?.[t]?.find((x) => x.id === id)?.label || null;
  const [f, setF] = useState({ salutation_id: null, name: "", phone: "", email: "", city_id: null });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post("/customers", { full_name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || null, salutation: label("salutation", f.salutation_id), address_current: f.city_id ? { city: label("city", f.city_id) } : null });
      const prof = Object.fromEntries(Object.entries({ salutation_id: f.salutation_id, city_id: f.city_id }).filter(([, v]) => v));
      if (Object.keys(prof).length) await api.patch(`/customers/${r.data.id}/profile`, { ...prof, version: r.data.version ?? 0 }).catch(() => {});
      toast.success("Customer created"); onSaved(r.data); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="v2 w-full bg-warm-50 sm:max-w-md" data-testid="quick-customer-sheet">
        <SheetHeader><p className="label">Customer</p><SheetTitle className="font-display text-2xl">Quick add</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Salutation"><Select type="salutation" value={f.salutation_id} onChange={(v) => set("salutation_id", v)} allowAdd={false} testId="qc-salutation" /></Field>
            <Field label="Full name" required><input className="input !h-10" value={f.name} onChange={(e) => set("name", e.target.value)} required data-testid="qc-name" /></Field>
          </div>
          <Field label="Phone" required><input className="input !h-10" value={f.phone} onChange={(e) => set("phone", e.target.value)} required placeholder="+91…" data-testid="qc-phone" /></Field>
          <Field label="Email"><input className="input !h-10" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} data-testid="qc-email" /></Field>
          <Field label="City"><Select type="city" value={f.city_id} onChange={(v) => set("city_id", v)} testId="qc-city" /></Field>
          <p className="text-xs text-txt-muted">KYC, address and co-applicants can be completed later from the customer's 360 page.</p>
          <button type="submit" disabled={busy} className="btn btn-primary w-full" data-testid="qc-submit">Create & select</button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
