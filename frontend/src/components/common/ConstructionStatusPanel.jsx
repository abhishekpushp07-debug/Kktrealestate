import { useCallback, useEffect, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, inr } from "@/lib/format";
import { ConstructionPhotos } from "@/components/common/ConstructionPhotos";
import { JourneyPanel } from "@/components/common/JourneyPanel";

export function ConstructionStatusPanel({ blockId, onChanged }) {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [journey, setJourney] = useState(null);
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [reason, setReason] = useState("");
  const load = useCallback(() => api.get(`/blocks/${blockId}/construction`).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))), [blockId]);
  const savePlanned = async (s, v) => {
    if ((v || "") === (s.planned_date || "")) return;
    try { await api.patch(`/blocks/${blockId}/construction/stages/${s.stage_id}/planned-date`, { planned_date: v || null, version: data?.block?.version ?? 0 }); toast.success(v ? `Planned ${fmtDate(v)}` : "Planned date cleared"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="card p-5 text-sm text-txt-muted">Loading…</div>;
  const canEdit = can("construction.stage.update") || can("construction.update.complete");
  const pending = data.stages.filter((s) => s.status !== "Completed");
  const openConfirm = () => { const t = data.stages.find((s) => s.stage_id === target); if (!t) return; const today = new Date().toISOString().slice(0, 10); setConfirm({ target: t, rows: data.stages.filter((s) => s.status !== "Completed" && s.seq <= t.seq).map((s) => ({ ...s, date: today })) }); setPreview(null); api.get(`/blocks/${blockId}/stages/${t.stage_id}/preview`).then((r) => setPreview(r.data)).catch(() => setPreview({ error: true })); };
  const apply = async () => {
    setBusy(true);
    try { const r = await api.post(`/blocks/${blockId}/construction/stage`, { stage_id: confirm.target.stage_id, completed_on: confirm.rows.at(-1).date, dates: Object.fromEntries(confirm.rows.map((x) => [x.stage_id, x.date])), version: data.block.version, ...(notes.trim() ? { notes: notes.trim() } : {}) }); toast.success(`Stage ${r.data.stage_name} completed — ${r.data.demands_raised} demand(s) raised (${inr(r.data.demands_total)})`, { action: { label: "Where did this go?", onClick: () => setJourney(r.data.audit_id) }, duration: 8000 }); setConfirm(null); setTarget(""); load(); onChanged?.(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const undo = async () => { if (!reason.trim()) return; try { const r = await api.post(`/blocks/${blockId}/construction/undo`, { reason, version: data.block.version }); toast.success(`Stage ${r.data.stage_name} undone — ${r.data.demands_voided} demand(s) voided`, { action: { label: "Where did this go?", onClick: () => setJourney(r.data.audit_id) }, duration: 8000 }); setUndoOpen(false); setReason(""); load(); onChanged?.(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-5" data-testid="construction-status-panel">
      <JourneyPanel entityType="block" entityId={blockId} open={!!journey} onOpenChange={(o) => !o && setJourney(null)} initialAuditId={journey} />
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div><p className="label-xs">Construction status</p><p className="text-2xl font-bold text-ink-950" data-testid="cs-percent">{data.construction_percent}% <span className="text-sm font-normal text-txt-secondary">· {data.current_stage ? `current: ${data.current_stage.name}` : "not started"}{data.next_stage ? ` · next: ${data.next_stage.name}` : ""}</span></p></div>
          {canEdit && <div className="ml-auto flex items-center gap-2">
            <select className="h-10 rounded-md border px-3 text-sm" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="cs-stage-select"><option value="">Mark stage completed…</option>{pending.map((s) => <option key={s.stage_id} value={s.stage_id}>{s.seq}. {s.name}</option>)}</select>
            <Button className="bg-ink-950 hover:bg-ink-800" disabled={!target} onClick={openConfirm} data-testid="cs-mark-btn"><Check className="mr-1 h-4 w-4" />Update</Button>
            {(can("construction.stage.undo") || can("construction.update.undo")) && data.current_stage && <Button variant="outline" onClick={() => setUndoOpen(true)} data-testid="cs-undo-btn"><Undo2 className="mr-1 h-4 w-4" />Undo last</Button>}
          </div>}
        </div>
        <p className="mt-2 text-xs text-txt-secondary">{data.active_bookings} active booking(s) in this tower — completing a stage raises the linked plan installments automatically.</p>
        <ol className="mt-5 space-y-2" data-testid="cs-timeline">
          {data.stages.map((s) => <li key={s.stage_id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${s.status === "Completed" ? "border-emerald-200 bg-sage-50/50" : s.status === "In Progress" ? "border-gold-border bg-gold-light" : "bg-white"}`} data-testid={`cs-stage-${s.seq}`}>
            <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${s.status === "Completed" ? "bg-emerald-600 text-white" : "bg-warm-50 text-txt-secondary"}`}>{s.status === "Completed" ? <Check className="h-4 w-4" /> : s.seq}</span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-950">{s.name}{s.is_possession && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-[#6B4E00]">Possession</span>}</p><p className="text-xs text-txt-secondary">{s.status}{s.completed_on ? ` · ${fmtDate(s.completed_on)}` : ""}{s.completed_by_name ? ` · ${s.completed_by_name}` : ""}</p></div>
            {s.status !== "Completed" && <label className="flex items-center gap-1 text-xs text-txt-secondary" title="Planned completion date (drives the Receivables Forecast month)">Planned<input type="date" className="h-7 rounded border px-1 text-xs" defaultValue={s.planned_date || ""} data-testid={`cs-stage-${s.seq}-planned`}
              onKeyDown={(e) => { if (e.key === "Enter") savePlanned(s, e.currentTarget.value); }} /><button type="button" className="rounded border px-2 py-0.5 text-[11px] font-semibold text-ink-950 hover:bg-warm-100" data-testid={`cs-stage-${s.seq}-planned-save`} onClick={(e) => savePlanned(s, e.currentTarget.previousSibling.value)}>Save</button></label>}
            {s.demands?.count > 0 && <span className="text-xs text-txt-secondary" data-testid={`cs-stage-${s.seq}-demands`}>{s.demands.count} demand(s) · {inr(s.demands.total)} · paid {inr(s.demands.paid)}</span>}
          </li>)}
        </ol>
      </div>
      <ConstructionPhotos blockId={blockId} projectId={data.block?.project_id} milestones={data.stages.map((s) => ({ seq: s.seq, name: s.name, status: s.status, progress_note: s.progress_note }))} />
      <Dialog open={undoOpen} onOpenChange={setUndoOpen}><DialogContent data-testid="cs-undo-dialog"><DialogHeader><DialogTitle>Undo “{data.current_stage?.name}”</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-txt-secondary">The stage goes back to Pending and the installment demands it raised are voided for every active booking in this tower.</p>
          <p className="rounded-md bg-amber2-50 px-3 py-2 text-xs text-amber2" data-testid="cs-undo-rule">Rule: undo is blocked if a demand raised by this stage was paid by a payment dated on/after the stage completion. Advances received earlier and auto-applied (FIFO) do not block undo — they simply return to credit.</p>
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cs-undo-reason" />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setUndoOpen(false)}>Cancel</Button><Button className="bg-ink-950 hover:bg-ink-800" disabled={!reason.trim()} onClick={undo} data-testid="cs-undo-confirm">Undo stage</Button></div>
        </div>
      </DialogContent></Dialog>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}><DialogContent data-testid="cs-confirm-dialog"><DialogHeader><DialogTitle>Complete up to “{confirm?.target.name}”</DialogTitle></DialogHeader>
        {confirm && <div className="space-y-3"><p className="text-sm text-txt-secondary">The following {confirm.rows.length} stage(s) will be marked Completed and linked installments raised for all active bookings:</p>
          {confirm.rows.map((r, i) => <div key={r.stage_id} className="flex items-center gap-3 text-sm"><span className="w-40 font-semibold text-ink-950">{r.seq}. {r.name}</span><DateInput className="h-9 w-44" value={r.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setConfirm((c) => ({ ...c, rows: c.rows.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)) }))} data-testid={`cs-confirm-date-${r.seq}`} /></div>)}
          <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="cs-notes" />
          <div className="rounded-md border bg-warm-50/60 p-3 text-sm" data-testid="cs-preview">
            {!preview && <p className="text-txt-secondary">Calculating dues preview…</p>}
            {preview?.error && <p className="text-brick">Preview unavailable.</p>}
            {preview && !preview.error && <>
              <p className="font-semibold text-ink-950" data-testid="cs-preview-headline">This will raise dues for {preview.bookings_count} booking(s) on this tower{preview.stage_plan_name ? ` using plans linked to “${preview.stage_plan_name}”` : ""}: total {inr(preview.total)} <span className="font-normal text-txt-secondary">(Cash {inr(preview.cash)} / Account {inr(preview.account)})</span></p>
              {preview.bookings.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-auto">{preview.bookings.map((b) => <li key={b.booking_id} className="flex justify-between gap-2 text-xs" data-testid={`cs-preview-${b.booking_number}`}><span>{b.booking_number} · {b.customer_name} <span className="text-txt-muted">({b.plan_name}: {b.installments.join(", ")})</span></span><span className="tabular font-semibold">{inr(b.total)}</span></li>)}</ul>}
            </>}
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button className="bg-ink-950 hover:bg-ink-800" disabled={busy} onClick={apply} data-testid="cs-confirm-btn">{busy ? "Updating…" : "Confirm"}</Button></div></div>}
      </DialogContent></Dialog>
    </div>
  );
}
