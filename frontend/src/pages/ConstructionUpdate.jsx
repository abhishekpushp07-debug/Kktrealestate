import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HardHat } from "lucide-react";
import api from "@/lib/api";
import { ConstructionStatusPanel } from "@/components/common/ConstructionStatusPanel";
import { useProjectTowers } from "./masters/useProjectTowers";
import { QuickAddButton, useQuickCreate } from "@/components/common/QuickCreate";

export default function ConstructionUpdate() {
  const [sp, setSp] = useSearchParams();
  const { projects, towers, projectId, setProjectId, blockId, setBlockId, addProject, addTower } = useProjectTowers(sp.get("project") || "", sp.get("tower") || "");
  const [plan, setPlan] = useState(null);
  const [panelKey, setPanelKey] = useState(0);
  useEffect(() => { if (!blockId) { setPlan(null); return; } api.get(`/stage-plans?block_id=${blockId}`).then((r) => setPlan(r.data.items.find((p) => p.is_active) || null)).catch(() => setPlan(null)); }, [blockId]);
  useEffect(() => { setSp(projectId ? { project: projectId, ...(blockId ? { tower: blockId } : {}) } : {}, { replace: true }); }, [projectId, blockId, setSp]);
  return (
    <div className="space-y-5" data-testid="construction-update-page">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><h1 className="flex items-center gap-2 font-display text-2xl text-ink-950"><HardHat className="h-6 w-6" />Construction Update</h1><p className="text-sm text-txt-secondary">Project → Tower → mark a stage completed. Dues are raised on the Bill raised side of every linked booking's ledger.</p></div>
        <label className="block text-sm"><span className="label-xs">Project</span><select className="h-10 w-56 rounded-md border px-3 text-sm" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }} data-testid="cu-project"><option value="">Select project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><QuickAddButton kind="project" onCreated={addProject} testId="cu-quick-add-project" />
        <label className="block text-sm"><span className="label-xs">Tower</span><select className="h-10 w-56 rounded-md border px-3 text-sm" value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId} data-testid="cu-tower"><option value="">Select tower…</option>{towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><QuickAddButton kind="tower" prefill={{ project_id: projectId }} disabled={!projectId} onCreated={addTower} testId="cu-quick-add-tower" />
      </div>
      {blockId && <p className="flex items-center gap-2 text-sm text-txt-secondary" data-testid="cu-stage-plan">Stage plan: <b className="text-ink-950">{plan ? plan.name : "none — create one for this tower"}</b><QuickAddButton kind="stage_plan" prefill={{ project_id: projectId, block_id: blockId }} onCreated={(p) => { setPlan(p); setPanelKey((k) => k + 1); }} testId="cu-quick-add-stage-plan" /></p>}
      {blockId ? <ConstructionStatusPanel key={`${blockId}-${panelKey}`} blockId={blockId} /> : <div className="card p-8 text-center text-sm text-txt-secondary" data-testid="cu-empty">Pick a project and tower to see its stage plan and timeline.</div>}
    </div>
  );
}
