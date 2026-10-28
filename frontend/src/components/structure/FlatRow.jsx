import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Check, X } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { inrShort } from "@/lib/format";
import { StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";

/** One flat line in the structure tree; inline edit of number / type / price (₹) via PATCH /flats/{id}. */
export function FlatRow({ flat: f, can, onChanged }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ flat_number: f.flat_number, flat_type_id: f.flat_type_id, price: f.price ?? "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const body = { version: f.version };
    if (v.flat_number !== f.flat_number) body.flat_number = v.flat_number;
    if (v.flat_type_id !== f.flat_type_id) body.flat_type_id = v.flat_type_id;
    if (String(v.price) !== String(f.price ?? "")) body.price = Number(v.price);
    if (Object.keys(body).length === 1) { setEdit(false); return; }
    setBusy(true);
    try { await api.patch(`/flats/${f.id}`, body); toast.success(`${v.flat_number} updated`); setEdit(false); onChanged(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  if (!edit) return (
    <tr className="border-t border-warm-100 hover:bg-warm-50/60" data-testid={`flat-row-${f.flat_number}`}>
      <td className="w-28 px-6 py-1.5 font-semibold tabular-nums" data-testid={`flat-number-${f.id}`}>{f.flat_number}</td>
      <td className="px-3 py-1.5 text-txt-secondary">{f.flat_type_code}{f.super_builtup_sqft ? ` · ${f.super_builtup_sqft} sq.ft` : ""}{f.facing ? ` · ${f.facing}` : ""}</td>
      <td className="px-3 py-1.5"><StatusPill status={f.status} testId={`flat-status-${f.id}`} /></td>
      <td className="px-3 py-1.5 text-right tabular-nums" data-testid={`flat-price-${f.id}`}>{f.price != null ? inrShort(f.price) : <span className="text-brick">no price</span>}</td>
      <td className="w-16 px-3 py-1.5 text-right">{can("masters.flat.edit") && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)} data-testid={`flat-edit-${f.id}`} aria-label={`Edit ${f.flat_number}`}><Pencil className="h-3.5 w-3.5" /></button>}</td>
    </tr>);
  return (
    <tr className="border-t border-warm-100 bg-warm-50" data-testid={`flat-row-edit-${f.id}`}>
      <td className="px-6 py-1.5"><input className="input !h-8 w-24 text-sm" value={v.flat_number} onChange={(e) => setV({ ...v, flat_number: e.target.value })} data-testid={`flat-edit-number-${f.id}`} /></td>
      <td className="px-3 py-1.5"><Select type="flat_types" value={v.flat_type_id} onChange={(x) => setV({ ...v, flat_type_id: x })} disabled={f.status !== "Available"} allowAdd={false} clearable={false} className="!h-8 min-w-[160px]" testId={`flat-edit-type-${f.id}`} /></td>
      <td className="px-3 py-1.5 text-xs text-txt-muted">{f.status !== "Available" ? "type locked (not Available)" : ""}</td>
      <td className="px-3 py-1.5 text-right"><input type="number" min="0" className="input !h-8 w-36 text-right text-sm" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} placeholder="₹" data-testid={`flat-edit-price-${f.id}`} /></td>
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save} data-testid={`flat-edit-save-${f.id}`} aria-label="Save"><Check className="h-3.5 w-3.5" /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(false)} data-testid={`flat-edit-cancel-${f.id}`} aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
      </td>
    </tr>);
}
