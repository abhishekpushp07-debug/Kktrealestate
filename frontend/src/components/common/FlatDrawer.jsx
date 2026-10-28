import { HistoryButton } from "@/components/common/HistoryTimeline";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { undoToast } from "@/lib/undo";
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
import { ContextActions } from "@/components/common/ContextActions";
import { ConnectedTo } from "@/components/common/ConnectedTo";

export function FlatDrawer({ flatId, onClose, onChanged }) {
  const { can } = useAuth();
  const [flat, setFlat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const manualTargets = useMemo(() => ["Available", "Hold", "Blocked"].filter((s) => s !== flat?.status), [flat?.status]);
  const [extendTo, setExtendTo] = useState("");
  const nav = useNavigate();
  const [edit, setEdit] = useState({ price: "", rate_per_sqft: "", notes: "", flat_type_id: null });
  const { options: ftOptions } = useMasterOptions("flat-types");

  useEffect(() => {
    if (!flatId) { setFlat(null); return; }
    setFlat(null);
    api.get(`/flats/${flatId}`).then((r) => { setFlat(r.data); setEdit({ price: r.data.price ?? "", rate_per_sqft: r.data.rate_per_sqft ?? "", notes: r.data.notes || "", flat_type_id: r.data.flat_type_id }); }).catch((e) => toast.error(errMsg(e)));
  }, [flatId]);

  const changeStatus = async (status) => {
    setBusy(true);
    const prev = flat;
    setFlat((f) => ({ ...f, status }));  // optimistic
    try {
      const r = await api.patch(`/flats/${flatId}/status`, { status, reason: reason || null, version: flat.version });
      setFlat((f) => ({ ...f, ...r.data })); setReason("");
      const revertible = ["Available", "Hold", "Blocked"].includes(prev.status);
      if (revertible) undoToast({ title: `${r.data.flat_number} is now ${status}`, description: `Was ${prev.status}`, testId: `flat-move-${flatId}`, onUndo: async () => {
        const u = await api.patch(`/flats/${flatId}/status`, { status: prev.status, reason: "Undo", version: r.data.version });
        setFlat((f) => ({ ...f, ...u.data })); onChanged?.();
        return `Reverted · ${u.data.flat_number} back to ${prev.status}`;
      } });
      else toast.success(`${r.data.flat_number} is now ${status}`);
      onChanged?.();
    } catch (e) { setFlat(prev); toast.error(errMsg(e)); } finally { setBusy(false); }
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
  const extendHold = async () => {
    setBusy(true);
    try { await api.post("/inventory/bulk", { flat_ids: [flatId], action: "extend_hold", expires_at: new Date(extendTo).toISOString() }); const r = await api.get(`/flats/${flatId}`); setFlat(r.data); setExtendTo(""); toast.success(`${r.data.flat_number}: hold extended`); onChanged?.(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!flatId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="flat-drawer">
        {!flat ? <div className="space-y-3 pt-6"><SheetTitle className="sr-only">Loading flat</SheetTitle><Skeleton className="h-8 w-40" /><Skeleton className="h-32" /></div> : <>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3 text-2xl font-extrabold text-ink-950"><span data-testid="flat-drawer-number">{flat.flat_number}</span><StatusChip status={flat.status} testId="flat-drawer-status" /><HistoryButton entityType="flat" entityId={flat.id} label={flat.flat_number} /></SheetTitle>
            <p className="text-sm text-txt-secondary">{flat.project_name} · {flat.block_name} · Floor {flat.floor} · Position {flat.position}</p>
            {flat.inventory_state && <div className="mt-2 flex flex-wrap gap-2 text-xs" data-testid="flat-layers"><span className="rounded bg-ink-100 px-2 py-0.5">Real: <b>{flat.inventory_state}</b></span><span className={`rounded px-2 py-0.5 ${flat.masked ? "bg-amber-100 text-amber-900" : "bg-ink-100"}`} data-testid="flat-display-layer">Displayed: <b>{flat.display_state}</b>{flat.masked ? " · masked" : ""}</span>{flat.allocation_category_code && <span className="rounded bg-ink-100 px-2 py-0.5" data-testid="flat-category">{flat.allocation_category_code}{flat.bookable ? "" : " · not saleable"}</span>}</div>}
            {flat.hold?.expires_at && <p className="mt-1 text-xs text-amber-700" data-testid="flat-hold-expiry">Hold expires {new Date(flat.hold.expires_at).toLocaleString()} ({Math.max(0, Math.round((new Date(flat.hold.expires_at) - Date.now()) / 36e5))} h left){flat.hold.for_customer_id ? " · reserved for a customer" : ""}</p>}
            {flat.status === "Hold" && (can("sales.booking.create") || can("inventory.hold.create")) && <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="flat-hold-actions">
              {can("sales.booking.create") && (flat.bookable !== false) && <Button size="sm" className="bg-ink-950 hover:bg-ink-800" onClick={() => nav(`/bookings/new?flat=${flat.id}${flat.hold?.for_customer_id ? `&customer_id=${flat.hold.for_customer_id}` : ""}`)} data-testid="flat-convert-hold-btn">Convert hold → booking</Button>}
              {can("inventory.hold.create") && <>
                <Input type="datetime-local" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} className="h-8 w-52 text-xs" data-testid="flat-extend-input" />
                <Button size="sm" variant="outline" disabled={busy || !extendTo} onClick={extendHold} data-testid="flat-extend-hold-btn">Extend hold</Button>
              </>}
            </div>}
          </SheetHeader>
          <ContextActions className="mt-4" testId="flat-context-actions" items={[
            { label: "Book this flat", to: `/bookings/new?project=${flat.project_id}&block=${flat.block_id}&flat=${flat.id}${flat.hold?.for_customer_id ? `&customer_id=${flat.hold.for_customer_id}` : ""}`, perm: "sales.booking.create", primary: true,
              disabledReason: flat.bookable === false ? `${flat.allocation_category_name || flat.allocation_category_code || "Non-saleable"} — not builder-saleable` : ["Booked", "Sold"].includes(flat.status) ? "Already booked" : flat.status === "Blocked" ? `Blocked${flat.block_reason ? ` — ${flat.block_reason}` : ""} — release first` : flat.status === "Hold" && !flat.hold?.for_customer_id ? "On hold — release or convert the hold first" : undefined },
            { label: "Construction update", to: `/construction?project=${flat.project_id}&tower=${flat.block_id}`, perm: "construction.stage.update" },
            { label: "Generate document", to: `/documents?mode=generate&project_id=${flat.project_id}&block_id=${flat.block_id}`, perm: "documents.document.generate" },
            { label: "Tower", to: `/blocks/${flat.block_id}`, perm: "masters.flat.view" },
          ]} />
          <div className="mt-6 rounded-xl bg-ink-950 p-5 text-white">
            <p className="label-xs text-gold">Listed price</p>
            <p className="mt-1 text-3xl font-extrabold tabular" data-testid="flat-drawer-price">{inrShort(flat.price)}</p>
            <p className="text-xs text-txt-muted">{inr(flat.price)}{flat.rate_per_sqft ? ` · ₹${num(flat.rate_per_sqft)}/sq.ft × ${num(flat.super_builtup_sqft)}` : " · lump sum"}{flat.rate_card?.name ? ` · ${flat.rate_card.name}` : ""}</p>
            {flat.price_source === "manual" && <p className="mt-2 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300" data-testid="flat-price-manual-override">Manual override{flat.rate_card_breakup?.length ? ` (was ${flat.rate_card_breakup.map((b) => b.label).join(" + ")})` : ""}</p>}
            {flat.price_breakup?.length > 0 && <ul className="mt-3 space-y-1 border-t border-white/10 pt-2 text-xs" data-testid="flat-price-breakup">{flat.price_breakup.map((b) => <li key={b.label} className="flex justify-between"><span className="text-txt-muted">{b.label}</span><span className="tabular font-semibold">{inr(b.amount)}</span></li>)}</ul>}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <KV label="Type" value={`${flat.flat_type?.name} (${flat.flat_type?.bhk} BHK)`} /><KV label="Facing" value={flat.facing} /><KV label="Floor" value={flat.floor} mono />
            <KV label="Super built-up" value={sqft(flat.super_builtup_sqft)} mono /><KV label="Built-up" value={sqft(flat.builtup_sqft)} mono /><KV label="Carpet" value={sqft(flat.carpet_sqft)} mono />
          </div>
          <div className="mt-6">
            <p className="label-xs mb-2">Rooms snapshot</p>
            <table className="w-full text-sm" data-testid="flat-rooms-table"><tbody>{flat.rooms_snapshot?.map((r) => <tr key={r.label} className="border-b border-slate-100"><td className="py-1.5 text-txt-secondary">{r.label}<span className="ml-1 text-[10px] text-txt-muted">{r.room_type_name}</span></td><td className="py-1.5 text-right tabular text-xs text-txt-secondary">{r.length_ft} × {r.width_ft} ft</td><td className="py-1.5 text-right font-semibold tabular">{num(r.area_sqft)} sq.ft</td></tr>)}</tbody></table>
            <p className="label-xs mb-2 mt-4">Areas snapshot</p>
            <div className="flex flex-wrap gap-2" data-testid="flat-areas-list">{flat.areas_snapshot?.map((a) => <span key={a.area_type_name || a.label} className="rounded-md border bg-warm-50 px-2 py-1 text-xs"><b className="text-ink-950">{a.area_type_name}</b> {num(a.value_sqft)}</span>)}</div>
            {flat.specifications?.length > 0 && <><p className="label-xs mb-2 mt-4">Specifications</p><div className="grid grid-cols-2 gap-1 text-xs" data-testid="flat-specs">{flat.specifications.map((s) => <div key={s.id} className="rounded border bg-white px-2 py-1"><span className="text-txt-muted">{s.category}: </span><b className="text-ink-950">{s.name}</b>{s.brand ? <span className="text-txt-secondary"> · {s.brand}</span> : null}</div>)}</div></>}
            <details className="mt-4"><summary className="label-xs cursor-pointer">History</summary><div className="mt-2"><HistoryTimeline entityType="flat" entityId={flat.id} /></div></details>
          </div>
          {can("sales.hold.create") && (
            <div className="mt-6 rounded-lg border p-4" data-testid="flat-status-section">
              <p className="label-xs mb-2">Change status</p>
              {manual ? <>
                <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="mb-2 h-9" data-testid="flat-status-reason" />
                <div className="flex flex-wrap gap-2">
                  {manualTargets.map((s) => <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => changeStatus(s)} data-testid={`flat-status-${s.toLowerCase()}-btn`} className={s === "Hold" ? "border-amber-300 text-amber2 hover:bg-amber2-50" : s === "Blocked" ? "border-slate-300 text-txt-secondary" : "border-emerald-300 text-sage hover:bg-sage-50"}>Mark {s}</Button>)}
                </div>
                <p className="mt-2 text-[11px] text-txt-muted">Booked / Sold are set by the booking engine (Phase 2).</p>
              </> : <p className="text-sm text-txt-secondary">Status is controlled by the booking.</p>}
            </div>
          )}
          {can("masters.flat.edit") && (
            <div className="mt-4 rounded-lg border p-4 space-y-3" data-testid="flat-edit-section">
              <p className="label-xs">Edit flat</p>
              <Field label="Flat type" hint={flat.status !== "Available" ? "Only editable while Available" : "Changing re-snapshots rooms & areas"}><Combobox options={ftOptions} value={edit.flat_type_id} onChange={(v) => setEdit({ ...edit, flat_type_id: v })} disabled={flat.status !== "Available"} testId="flat-edit-type" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rate ₹/sq.ft"><Input type="number" value={edit.rate_per_sqft} onChange={(e) => setEdit({ ...edit, rate_per_sqft: e.target.value })} data-testid="flat-edit-rate" /></Field>
                <Field label="Price ₹"><Input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} data-testid="flat-edit-price" /></Field>
              </div>
              <Field label="Notes"><Textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} data-testid="flat-edit-notes" /></Field>
              <Button size="sm" disabled={busy} onClick={save} className="bg-ink-950 hover:bg-ink-800" data-testid="flat-edit-save">Save changes</Button>
            </div>
          )}
          <ConnectedTo entity="flat" id={flat.id} className="mt-6" />
        </>}
      </SheetContent>
    </Sheet>
  );
}
