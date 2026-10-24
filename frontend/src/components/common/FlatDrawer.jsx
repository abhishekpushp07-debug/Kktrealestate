import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMasterOptions } from "@/hooks/useList";
import { inr, inrShort, sqft, num } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "./StatusChip";
import { KV, Field } from "./Bits";
import { Combobox } from "./Combobox";
import { HistoryTimeline } from "./HistoryTimeline";

export function FlatDrawer({ flatId, onClose, onChanged }) {
  const { can } = useAuth();
  const [flat, setFlat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState({ price: "", rate_per_sqft: "", notes: "", flat_type_id: null });
  const { options: ftOptions } = useMasterOptions("flat-types");

  useEffect(() => {
    if (!flatId) { setFlat(null); return; }
    setFlat(null);
    api.get(`/flats/${flatId}`).then((r) => { setFlat(r.data); setEdit({ price: r.data.price ?? "", rate_per_sqft: r.data.rate_per_sqft ?? "", notes: r.data.notes || "", flat_type_id: r.data.flat_type_id }); }).catch((e) => toast.error(errMsg(e)));
  }, [flatId]);

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      const r = await api.patch(`/flats/${flatId}/status`, { status, reason: reason || null, version: flat.version });
      setFlat((f) => ({ ...f, ...r.data })); setReason("");
      toast.success(`${r.data.flat_number} is now ${status}`); onChanged?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    const payload = { notes: edit.notes || null, version: flat.version };
    if (edit.flat_type_id && edit.flat_type_id !== flat.flat_type_id) payload.flat_type_id = edit.flat_type_id;
    if (edit.rate_per_sqft !== "" && Number(edit.rate_per_sqft) !== flat.rate_per_sqft) payload.rate_per_sqft = Number(edit.rate_per_sqft);
    else if (edit.price !== "" && Number(edit.price) !== flat.price) payload.price = Number(edit.price);
    try {
      const r = await api.patch(`/flats/${flatId}`, payload);
      setFlat((f) => ({ ...f, ...r.data })); toast.success("Flat updated"); onChanged?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const manual = flat && ["Available", "Hold", "Blocked"].includes(flat.status);
  return (
    <Sheet open={!!flatId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="flat-drawer">
        {!flat ? <div className="space-y-3 pt-6"><SheetTitle className="sr-only">Loading flat</SheetTitle><Skeleton className="h-8 w-40" /><Skeleton className="h-32" /></div> : <>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3 text-2xl font-extrabold text-navy"><span data-testid="flat-drawer-number">{flat.flat_number}</span><StatusChip status={flat.status} testId="flat-drawer-status" /></SheetTitle>
            <p className="text-sm text-slate-500">{flat.project_name} · {flat.block_name} · Floor {flat.floor} · Position {flat.position}</p>
          </SheetHeader>
          <div className="mt-6 rounded-xl bg-navy p-5 text-white">
            <p className="label-xs text-gold">Listed price</p>
            <p className="mt-1 text-3xl font-extrabold tabular" data-testid="flat-drawer-price">{inrShort(flat.price)}</p>
            <p className="text-xs text-slate-300">{inr(flat.price)}{flat.rate_per_sqft ? ` · ₹${num(flat.rate_per_sqft)}/sq.ft × ${num(flat.super_builtup_sqft)}` : " · lump sum"}{flat.rate_card?.name ? ` · ${flat.rate_card.name}` : ""}</p>
            {flat.price_breakup?.length > 0 && <ul className="mt-3 space-y-1 border-t border-white/10 pt-2 text-xs" data-testid="flat-price-breakup">{flat.price_breakup.map((b, i) => <li key={i} className="flex justify-between"><span className="text-slate-300">{b.label}</span><span className="tabular font-semibold">{inr(b.amount)}</span></li>)}</ul>}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <KV label="Type" value={`${flat.flat_type?.name} (${flat.flat_type?.bhk} BHK)`} /><KV label="Facing" value={flat.facing} /><KV label="Floor" value={flat.floor} mono />
            <KV label="Super built-up" value={sqft(flat.super_builtup_sqft)} mono /><KV label="Built-up" value={sqft(flat.builtup_sqft)} mono /><KV label="Carpet" value={sqft(flat.carpet_sqft)} mono />
          </div>
          <div className="mt-6">
            <p className="label-xs mb-2">Rooms snapshot</p>
            <table className="w-full text-sm" data-testid="flat-rooms-table"><tbody>{flat.rooms_snapshot?.map((r, i) => <tr key={i} className="border-b border-slate-100"><td className="py-1.5 text-slate-600">{r.label}<span className="ml-1 text-[10px] text-slate-400">{r.room_type_name}</span></td><td className="py-1.5 text-right tabular text-xs text-slate-500">{r.length_ft} × {r.width_ft} ft</td><td className="py-1.5 text-right font-semibold tabular">{num(r.area_sqft)} sq.ft</td></tr>)}</tbody></table>
            <p className="label-xs mb-2 mt-4">Areas snapshot</p>
            <div className="flex flex-wrap gap-2" data-testid="flat-areas-list">{flat.areas_snapshot?.map((a, i) => <span key={i} className="rounded-md border bg-slate-50 px-2 py-1 text-xs"><b className="text-navy">{a.area_type_name}</b> {num(a.value_sqft)}</span>)}</div>
            {flat.specifications?.length > 0 && <><p className="label-xs mb-2 mt-4">Specifications</p><div className="grid grid-cols-2 gap-1 text-xs" data-testid="flat-specs">{flat.specifications.map((s) => <div key={s.id} className="rounded border bg-white px-2 py-1"><span className="text-slate-400">{s.category}: </span><b className="text-navy">{s.name}</b>{s.brand ? <span className="text-slate-500"> · {s.brand}</span> : null}</div>)}</div></>}
            <details className="mt-4"><summary className="label-xs cursor-pointer">History</summary><div className="mt-2"><HistoryTimeline entityType="flat" entityId={flat.id} /></div></details>
          </div>
          {can("flat.status") && (
            <div className="mt-6 rounded-lg border p-4" data-testid="flat-status-section">
              <p className="label-xs mb-2">Change status</p>
              {manual ? <>
                <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="mb-2 h-9" data-testid="flat-status-reason" />
                <div className="flex flex-wrap gap-2">
                  {["Available", "Hold", "Blocked"].filter((s) => s !== flat.status).map((s) => <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => changeStatus(s)} data-testid={`flat-status-${s.toLowerCase()}-btn`} className={s === "Hold" ? "border-amber-300 text-amber-700 hover:bg-amber-50" : s === "Blocked" ? "border-slate-300 text-slate-700" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}>Mark {s}</Button>)}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Booked / Sold are set by the booking engine (Phase 2).</p>
              </> : <p className="text-sm text-slate-500">Status is controlled by the booking.</p>}
            </div>
          )}
          {can("flat.write") && (
            <div className="mt-4 rounded-lg border p-4 space-y-3" data-testid="flat-edit-section">
              <p className="label-xs">Edit flat</p>
              <Field label="Flat type" hint={flat.status !== "Available" ? "Only editable while Available" : "Changing re-snapshots rooms & areas"}><Combobox options={ftOptions} value={edit.flat_type_id} onChange={(v) => setEdit({ ...edit, flat_type_id: v })} disabled={flat.status !== "Available"} testId="flat-edit-type" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rate ₹/sq.ft"><Input type="number" value={edit.rate_per_sqft} onChange={(e) => setEdit({ ...edit, rate_per_sqft: e.target.value })} data-testid="flat-edit-rate" /></Field>
                <Field label="Price ₹"><Input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} data-testid="flat-edit-price" /></Field>
              </div>
              <Field label="Notes"><Textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} data-testid="flat-edit-notes" /></Field>
              <Button size="sm" disabled={busy} onClick={save} className="bg-navy hover:bg-navy-700" data-testid="flat-edit-save">Save changes</Button>
            </div>
          )}
        </>}
      </SheetContent>
    </Sheet>
  );
}
