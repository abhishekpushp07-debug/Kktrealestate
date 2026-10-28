import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../Bits";
import { Combobox } from "../Combobox";

const TARGET_CLASS = { Hold: "border-amber-300 text-amber2 hover:bg-amber2-50", Blocked: "border-slate-300 text-txt-secondary" };

/** Manual status change (Available / Hold / Blocked) — Booked / Sold belong to the booking engine. */
export function FlatStatusSection({ flat, manualTargets, reason, setReason, busy, onChange }) {
  const manual = ["Available", "Hold", "Blocked"].includes(flat.status);
  return (
    <div className="mt-6 rounded-lg border p-4" data-testid="flat-status-section">
      <p className="label-xs mb-2">Change status</p>
      {manual ? <>
        <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="mb-2 h-9" data-testid="flat-status-reason" />
        <div className="flex flex-wrap gap-2">
          {manualTargets.map((s) => <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => onChange(s)} data-testid={`flat-status-${s.toLowerCase()}-btn`} className={TARGET_CLASS[s] || "border-emerald-300 text-sage hover:bg-sage-50"}>Mark {s}</Button>)}
        </div>
        <p className="mt-2 text-[11px] text-txt-muted">Booked / Sold are set by the booking engine (Phase 2).</p>
      </> : <p className="text-sm text-txt-secondary">Status is controlled by the booking.</p>}
    </div>
  );
}

/** Price / rate / notes / flat-type edit form. */
export function FlatEditSection({ flat, edit, setEdit, ftOptions, busy, onSave }) {
  return (
    <div className="mt-4 rounded-lg border p-4 space-y-3" data-testid="flat-edit-section">
      <p className="label-xs">Edit flat</p>
      <Field label="Flat type" hint={flat.status !== "Available" ? "Only editable while Available" : "Changing re-snapshots rooms & areas"}><Combobox options={ftOptions} value={edit.flat_type_id} onChange={(v) => setEdit({ ...edit, flat_type_id: v })} disabled={flat.status !== "Available"} testId="flat-edit-type" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate ₹/sq.ft"><Input type="number" value={edit.rate_per_sqft} onChange={(e) => setEdit({ ...edit, rate_per_sqft: e.target.value })} data-testid="flat-edit-rate" /></Field>
        <Field label="Price ₹"><Input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} data-testid="flat-edit-price" /></Field>
      </div>
      <Field label="Notes"><Textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} data-testid="flat-edit-notes" /></Field>
      <Button size="sm" disabled={busy} onClick={onSave} className="bg-ink-950 hover:bg-ink-800" data-testid="flat-edit-save">Save changes</Button>
    </div>
  );
}
