import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { WhereUsedButton } from "./WhereUsed";
import { useProjectTowers } from "./useProjectTowers";

export default function StagePlans() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [stages, setStages] = useState([]);
  const [qs] = useSearchParams();
  const [editing, setEditing] = useState(qs.get("new") === "1" ? {} : null);
  const [q, setQ] = useState("");
  const load = () => Promise.all([api.get("/stage-plans"), api.get("/master/construction-stages?page_size=100")]).then(([a, b]) => { setItems(a.data.items); setStages(b.data.items.filter((s) => s.is_active)); }).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  const shown = items.filter((p) => !q || `${p.name} ${p.project_name} ${p.block_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4" data-testid="stage-plans-page">
      <div className="flex flex-wrap items-center gap-3">
        <div><h1 className="font-display text-xl text-ink-950">Construction Stage Plans</h1><p className="text-xs text-txt-secondary">Name → Project → Tower → pick stages from the Stage master and order them. One active plan per tower.</p></div>
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto h-9 w-56" data-testid="stage-plans-search" />
        {can("masters.stage_plan.create") && <Button className="bg-ink-950 hover:bg-ink-800" onClick={() => setEditing({})} data-testid="stage-plan-new-btn"><Plus className="mr-1 h-4 w-4" />New stage plan</Button>}
      </div>
      {editing && <StagePlanForm plan={editing} stages={stages} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onStageAdded={load} />}
      <div className="grid gap-3 md:grid-cols-2" data-testid="stage-plans-list">
        {shown.map((p) => <div key={p.id} className="card !p-4" data-testid={`stage-plan-${p.id}`}>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="font-semibold text-ink-950">{p.name}</p><p className="text-xs text-txt-secondary">{p.project_name} · {p.block_name} · {p.stage_ids.length} stages{p.is_active ? "" : " · Inactive"}</p></div>
            <HistoryButton entityType="stage_plan" entityId={p.id} />
            <WhereUsedButton path={`/stage-plans/${p.id}/where-used`} testId={`stage-plan-where-used-${p.id}`} />
            {can("masters.stage_plan.edit") && <Button size="sm" variant="outline" onClick={() => setEditing(p)} data-testid={`stage-plan-edit-${p.id}`}>Edit</Button>}
          </div>
          <ol className="mt-2 flex flex-wrap gap-1">{p.stages.map((s) => <li key={s.stage_id} className="rounded-full bg-warm-50 px-2 py-0.5 text-[11px] text-ink-950">{s.seq}. {s.name}</li>)}</ol>
        </div>)}
        {shown.length === 0 && <p className="text-sm text-txt-secondary" data-testid="stage-plans-empty">No stage plans yet.</p>}
      </div>
    </div>
  );
}

function StagePlanForm({ plan, stages, onClose, onSaved, onStageAdded }) {
  const [name, setName] = useState(plan.name || "");
  const { projects, towers, projectId, setProjectId, blockId, setBlockId } = useProjectTowers(plan.project_id, plan.block_id);
  const [sel, setSel] = useState(plan.stage_ids || []);
  const [newStage, setNewStage] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [err, setErr] = useState(null);
  const byId = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const move = (i, d) => setSel((s) => { const a = [...s]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const addStage = async () => { if (!newStage.trim()) return; try { const r = await api.post("/master/construction-stages", { name: newStage.trim(), code: newStage.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20), seq_hint: 50 }); toast.success(`Stage "${r.data.name}" added to the master`); setNewStage(""); await onStageAdded(); setSel((s) => [...s, r.data.id]); } catch (e) { toast.error(errMsg(e)); } };
  const save = async () => {
    setErr(null);
    try { const body = { name, project_id: projectId, block_id: blockId, stage_ids: sel }; if (plan.id) await api.patch(`/stage-plans/${plan.id}`, body); else await api.post("/stage-plans", body); toast.success(`Stage plan "${name}" saved — tower sequence updated`); onSaved(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const copyTo = async (ids) => { try { const r = await api.post(`/stage-plans/${plan.id}/copy`, { block_ids: ids }); toast.success(`Copied to ${r.data.copied} tower(s)`); setCopyOpen(false); onSaved(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="card space-y-4 !p-5" data-testid="stage-plan-form">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm"><span className="label-xs">Plan name *</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. zed" data-testid="stage-plan-name" /></label>
        <label className="block text-sm"><span className="label-xs">Project *</span><select className="h-10 w-full rounded-md border px-3 text-sm" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }} disabled={!!plan.id} data-testid="stage-plan-project"><option value="">Select project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block text-sm"><span className="label-xs">Tower *</span><select className="h-10 w-full rounded-md border px-3 text-sm" value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId || !!plan.id} data-testid="stage-plan-tower"><option value="">Select tower…</option>{towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="label-xs mb-1">Stages (multi-select from Stage master)</p>
          <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2" data-testid="stage-plan-stage-picker">{stages.map((s) => <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-warm-50"><input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} data-testid={`stage-pick-${s.code || s.id}`} />{s.name}{s.auto_complete_on_booking && <span className="rounded-full bg-gold-light px-1.5 text-[10px] font-bold text-[#8a6d12]">at booking</span>}{s.is_possession && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-[#6B4E00]">possession</span>}</label>)}</div>
          <div className="mt-2 flex gap-2"><Input placeholder="Quick-add a stage name…" value={newStage} onChange={(e) => setNewStage(e.target.value)} className="h-9" data-testid="stage-quick-add-input" /><Button size="sm" variant="outline" onClick={addStage} data-testid="stage-quick-add-btn"><Plus className="h-4 w-4" /></Button></div>
        </div>
        <div><p className="label-xs mb-1">Order ({sel.length})</p>
          <ol className="space-y-1 rounded-md border p-2" data-testid="stage-plan-order">{sel.map((id, i) => <li key={id} className="flex items-center gap-2 rounded bg-warm-50/60 px-2 py-1 text-sm" data-testid={`stage-order-${i + 1}`}><span className="w-5 text-xs font-bold text-txt-secondary">{i + 1}</span><span className="flex-1">{byId[id]?.name}</span><button type="button" onClick={() => move(i, -1)} className="rounded p-1 hover:bg-white" data-testid={`stage-order-up-${i + 1}`}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(i, 1)} className="rounded p-1 hover:bg-white" data-testid={`stage-order-down-${i + 1}`}><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => toggle(id)} className="rounded p-1 text-brick hover:bg-white" data-testid={`stage-order-remove-${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button></li>)}{sel.length === 0 && <li className="px-2 py-3 text-xs text-txt-secondary">Tick stages on the left.</li>}</ol>
        </div>
      </div>
      {err && <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="stage-plan-error">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="bg-ink-950 hover:bg-ink-800" disabled={!name || !projectId || !blockId || !sel.length} onClick={save} data-testid="stage-plan-save">Save plan</Button>
        <Button variant="outline" onClick={onClose} data-testid="stage-plan-cancel">Cancel</Button>
        {plan.id && <Button variant="outline" onClick={() => setCopyOpen((o) => !o)} data-testid="stage-plan-copy-btn"><Copy className="mr-1 h-4 w-4" />Copy to other towers</Button>}
      </div>
      {copyOpen && <div className="flex flex-wrap gap-2 rounded-md border p-3" data-testid="stage-plan-copy-panel">{towers.filter((t) => t.id !== blockId).map((t) => <Button key={t.id} size="sm" variant="outline" onClick={() => copyTo([t.id])} data-testid={`stage-plan-copy-${t.id}`}>{t.name}</Button>)}{towers.length <= 1 && <span className="text-xs text-txt-secondary">No other towers in this project.</span>}</div>}
    </div>
  );
}
