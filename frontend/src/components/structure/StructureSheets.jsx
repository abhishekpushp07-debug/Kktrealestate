import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { Field } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Add N floors to a tower — floor-plan template OR "N flats of one type per floor"; live numbering preview from POST /blocks/{id}/floors/preview. */
export function AddFloorsSheet({ tower: t, onClose, onSaved }) {
  const { data: tmpls } = useFetch("/master/floor-plan-templates?page_size=100");
  const [f, setF] = useState({ count: 1, mode: t.floor_plans?.length ? "same" : "simple", floor_plan_template_id: "", flats_per_floor: 4, flat_type_id: "" });
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = { count: Number(f.count) || 1, ...(f.mode === "template" ? { floor_plan_template_id: f.floor_plan_template_id || null } : f.mode === "simple" ? { flats_per_floor: Number(f.flats_per_floor) || 1, flat_type_id: f.flat_type_id || null } : {}) };
  const ready = body.count >= 1 && (f.mode === "same" || (f.mode === "template" && body.floor_plan_template_id) || (f.mode === "simple" && body.flat_type_id));
  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    const h = setTimeout(() => api.post(`/blocks/${t.id}/floors/preview`, body).then((r) => { setPreview(r.data); setErr(null); }).catch((e) => { setPreview(null); setErr(errMsg(e)); }), 250);
    return () => clearTimeout(h);
  }, [JSON.stringify(body), ready, t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try { const r = await api.post(`/blocks/${t.id}/floors`, body); onSaved(r.data.flats_added); } catch (e) { setErr(errMsg(e)); toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const from = t.all_floors?.length ? t.all_floors[t.all_floors.length - 1] + 1 : t.floor_start;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md" data-testid="add-floors-sheet">
      <SheetHeader><SheetTitle className="font-display text-2xl">Add floors · {t.name}</SheetTitle></SheetHeader>
      <div className="mt-5 space-y-4 text-sm">
        <Field label="Floors" hint={`From floor ${from} to ${from + (Number(f.count) || 1) - 1} (pattern ${t.numbering_pattern})`}>
          <div className="flex items-center gap-2"><span className="text-txt-muted">from</span><input className="input !h-10 w-20" value={from} disabled data-testid="floors-from" /><span className="text-txt-muted">to</span>
            <input type="number" min={from} max={from + 49} className="input !h-10 w-20" value={from + (Number(f.count) || 1) - 1} onChange={(e) => setF({ ...f, count: Math.max(1, Number(e.target.value) - from + 1) })} data-testid="floors-to" /></div></Field>
        <Field label="Flats on each new floor">
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {[["simple", "N flats of one type"], ["template", "Floor-plan template"], t.floor_plans?.length ? ["same", "Same as top floor"] : null].filter(Boolean).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={f.mode === k} onClick={() => setF({ ...f, mode: k })} className={`btn btn-sm ${f.mode === k ? "btn-primary" : "btn-secondary"}`} data-testid={`floors-mode-${k}`}>{l}</button>))}
          </div></Field>
        {f.mode === "simple" && <div className="grid grid-cols-[100px_1fr] gap-3">
          <Field label="Flats / floor"><input type="number" min="1" max="50" className="input !h-10" value={f.flats_per_floor} onChange={(e) => setF({ ...f, flats_per_floor: e.target.value })} data-testid="floors-per-floor" /></Field>
          <Field label="Flat type"><Select type="flat_types" value={f.flat_type_id} onChange={(v) => setF({ ...f, flat_type_id: v })} allowAdd={false} clearable={false} testId="floors-flat-type" /></Field></div>}
        {f.mode === "template" && <Field label="Template"><Select options={(tmpls?.items || []).map((x) => ({ value: x.id, label: x.name, sub: `${x.flats_per_floor} flats / floor` }))} value={f.floor_plan_template_id} onChange={(v) => setF({ ...f, floor_plan_template_id: v })} allowAdd={false} clearable={false} testId="floors-template" /></Field>}
        <div className="rounded-xl border border-warm-200 bg-white p-3" data-testid="floors-preview">
          <p className="label-xs mb-1">Preview</p>
          {err && <p className="text-xs text-brick" data-testid="floors-preview-error">{err}</p>}
          {!err && !preview && <p className="text-xs text-txt-muted">{ready ? "Computing…" : "Pick a flat type or template to preview numbering."}</p>}
          {preview && <>
            <p className="text-sm"><b data-testid="floors-preview-count">{preview.count}</b> flats on floor{preview.floors.length > 1 ? "s" : ""} {preview.floors.join(", ")}</p>
            <p className="mt-1 break-words font-mono text-xs text-txt-secondary" data-testid="floors-preview-numbers">{preview.flat_numbers.slice(0, 24).join(" · ")}{preview.flat_numbers.length > 24 ? ` · … +${preview.flat_numbers.length - 24}` : ""}</p>
            {preview.duplicates.length > 0 && <p className="mt-1 text-xs text-brick" data-testid="floors-preview-duplicates">Already exist: {preview.duplicates.join(", ")}</p>}</>}
        </div>
        <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !preview || preview.duplicates.length > 0} onClick={save} data-testid="floors-save">Generate {preview?.count ?? ""} flats</button></div>
      </div>
    </SheetContent></Sheet>
  );
}

/** Add one flat at floor/position with an explicit (or pattern) number; duplicates are rejected server-side (409) and shown inline. */
export function AddFlatSheet({ tower: t, floor, onClose, onSaved }) {
  const [f, setF] = useState({ floor: floor ?? t.unit_floors?.[0] ?? t.floor_start, position: "", flat_type_id: "", flat_number: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/blocks/${t.id}/flats`, { floor: Number(f.floor), position: Number(f.position), flat_type_id: f.flat_type_id, flat_number: f.flat_number || null }); onSaved(r.data); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md" data-testid="add-flat-sheet">
      <SheetHeader><SheetTitle className="font-display text-2xl">Add flat · {t.name}</SheetTitle></SheetHeader>
      <div className="mt-5 space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Floor" required><select className="input !h-10" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} data-testid="flat-floor">{(t.all_floors || []).map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label="Position" required><input type="number" min="1" max="50" className="input !h-10" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} data-testid="flat-position" /></Field>
        </div>
        <Field label="Flat type" required><Select type="flat_types" value={f.flat_type_id} onChange={(v) => setF({ ...f, flat_type_id: v })} allowAdd={false} clearable={false} testId="flat-type" /></Field>
        <Field label="Flat number" hint={`Leave blank to follow the tower pattern ${t.numbering_pattern}`}><input className="input !h-10" value={f.flat_number} onChange={(e) => setF({ ...f, flat_number: e.target.value })} placeholder={`${t.code}-${f.floor}${String(f.position || 1).padStart(2, "0")}`} data-testid="flat-number" /></Field>
        {err && <p className="rounded-lg border border-brick/30 bg-brick/5 px-3 py-2 text-xs text-brick" data-testid="flat-error">{err}</p>}
        <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.position || !f.flat_type_id} onClick={save} data-testid="flat-save">Add flat</button></div>
      </div>
    </SheetContent></Sheet>
  );
}
