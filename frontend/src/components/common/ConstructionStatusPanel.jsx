import { Check, Undo2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useConstructionStatus } from "./construction/useConstructionStatus";
import { StageRow } from "./construction/StageRow";
import { ConfirmStagesDialog, UndoStageDialog } from "./construction/StageDialogs";
import { ConstructionPhotos } from "@/components/common/ConstructionPhotos";
import { JourneyPanel } from "@/components/common/JourneyPanel";

export function ConstructionStatusPanel({ blockId, onChanged }) {
  const { can } = useAuth();
  const { data, journey, setJourney, target, setTarget, confirm, setConfirm, preview, notes, setNotes, busy, undoOpen, setUndoOpen, reason, setReason, savePlanned, openConfirm, apply, undo } = useConstructionStatus(blockId, onChanged);
  if (!data) return <div className="card p-5 text-sm text-txt-muted">Loading…</div>;
  const canEdit = can("construction.stage.update") || can("construction.update.complete");
  const pending = data.stages.filter((s) => s.status !== "Completed");
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
          {data.stages.map((s) => <StageRow key={s.stage_id} s={s} canEdit={canEdit} savePlanned={savePlanned} setJourney={setJourney} />)}
        </ol>
      </div>
      <ConstructionPhotos blockId={blockId} projectId={data.block?.project_id} milestones={data.stages.map((s) => ({ seq: s.seq, name: s.name, status: s.status, progress_note: s.progress_note }))} />
      <UndoStageDialog {...{ data, undoOpen, setUndoOpen, reason, setReason, undo }} />
      <ConfirmStagesDialog {...{ confirm, setConfirm, preview, notes, setNotes, busy, apply }} />
    </div>
  );
}
