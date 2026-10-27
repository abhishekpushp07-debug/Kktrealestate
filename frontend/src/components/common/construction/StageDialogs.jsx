import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inr } from "@/lib/format";

export function UndoStageDialog({ data, undoOpen, setUndoOpen, reason, setReason, undo }) {
  return (
    <Dialog open={undoOpen} onOpenChange={setUndoOpen}><DialogContent data-testid="cs-undo-dialog"><DialogHeader><DialogTitle>Undo “{data.current_stage?.name}”</DialogTitle></DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-txt-secondary">The stage goes back to Pending and the installment demands it raised are voided for every active booking in this tower.</p>
        <p className="rounded-md bg-amber2-50 px-3 py-2 text-xs text-amber2" data-testid="cs-undo-rule">Rule: undo is blocked if a demand raised by this stage was paid by a payment dated on/after the stage completion. Advances received earlier and auto-applied (FIFO) do not block undo — they simply return to credit.</p>
        <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cs-undo-reason" />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setUndoOpen(false)}>Cancel</Button><Button className="bg-ink-950 hover:bg-ink-800" disabled={!reason.trim()} onClick={undo} data-testid="cs-undo-confirm">Undo stage</Button></div>
      </div>
    </DialogContent></Dialog>
  );
}

export function ConfirmStagesDialog({ confirm, setConfirm, preview, notes, setNotes, busy, apply }) {
  return (
    <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}><DialogContent data-testid="cs-confirm-dialog"><DialogHeader><DialogTitle>Complete up to “{confirm?.target.name}”</DialogTitle></DialogHeader>
      {confirm && <div className="space-y-3"><p className="text-sm text-txt-secondary">The following {confirm.rows.length} stage(s) will be marked Completed and linked installments raised for all active bookings:</p>
        {confirm.rows.map((r, i) => <div key={r.stage_id} className="flex items-center gap-3 text-sm"><span className="w-40 font-semibold text-ink-950">{r.seq}. {r.name}</span><DateInput className="h-9 w-44" value={r.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setConfirm((c) => ({ ...c, rows: c.rows.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)) }))} data-testid={`cs-confirm-date-${r.seq}`} /></div>)}
        <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="cs-notes" />
        <div className="rounded-md border bg-warm-50/60 p-3 text-sm" data-testid="cs-preview">
          {!preview && <p className="text-txt-secondary">Calculating dues preview…</p>}
          {preview?.error && <p className="text-brick">Preview unavailable.</p>}
          {preview && !preview.error && preview.no_dues_reason && <p className="font-semibold text-amber-700" data-testid="cs-preview-no-dues">{preview.no_dues_reason}</p>}
          {preview && !preview.error && !preview.no_dues_reason && <>
            <p className="font-semibold text-ink-950" data-testid="cs-preview-headline">This will raise dues for {preview.bookings_count} booking(s) on this tower{preview.stage_plan_name ? ` using plans linked to “${preview.stage_plan_name}”` : ""}: total {inr(preview.total)} <span className="font-normal text-txt-secondary">(Cash {inr(preview.cash)} / Account {inr(preview.account)})</span></p>
            {preview.bookings.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-auto">{preview.bookings.map((b) => <li key={b.booking_id} className="flex justify-between gap-2 text-xs" data-testid={`cs-preview-${b.booking_number}`}><span>{b.booking_number} · {b.customer_name} <span className="text-txt-muted">({b.plan_name}: {b.installments.join(", ")})</span></span><span className="tabular font-semibold">{inr(b.total)}</span></li>)}</ul>}
          </>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button className="bg-ink-950 hover:bg-ink-800" disabled={busy} onClick={apply} data-testid="cs-confirm-btn">{busy ? "Updating…" : "Confirm"}</Button></div></div>}
    </DialogContent></Dialog>
  );
}
