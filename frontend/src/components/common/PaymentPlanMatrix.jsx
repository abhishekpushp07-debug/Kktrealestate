import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

// Plan × tower assignment matrix for a project. Click a cell to assign/unassign; radio = default per tower.
export function PaymentPlanMatrix({ projectId, blocks }) {
  const { can } = useAuth();
  const [plans, setPlans] = useState([]);
  const [asg, setAsg] = useState([]);
  const load = useCallback(() => Promise.all([api.get("/master/payment-plans?page_size=100"), api.get(`/payment-plan-assignments?project_id=${projectId}`)]).then(([p, a]) => { setPlans(p.data.items); setAsg(a.data.items); }).catch((e) => toast.error(errMsg(e))), [projectId]);
  useEffect(() => { load(); }, [load]);
  const canEdit = can("master.write");
  const find = (planId, blockId) => asg.find((a) => a.payment_plan_id === planId && (a.block_id || null) === blockId);
  const toggle = async (plan, blockId) => {
    const a = find(plan.id, blockId);
    try { if (a) await api.delete(`/payment-plan-assignments/${a.id}`); else await api.post("/payment-plan-assignments", { payment_plan_id: plan.id, project_id: projectId, block_id: blockId, is_default: false }); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const setDefault = async (plan, blockId) => { try { await api.post("/payment-plan-assignments", { payment_plan_id: plan.id, project_id: projectId, block_id: blockId, is_default: true }); toast.success("Default updated"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const cols = [{ id: null, name: "Whole project" }, ...blocks];
  return (
    <div className="card-elev overflow-x-auto p-5" data-testid="payment-plan-matrix">
      <p className="mb-3 text-sm text-slate-600">Tick a cell to make a plan available for that tower (or the whole project). The radio marks the default plan shown first in the booking form.</p>
      <table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Plan</th>{cols.map((c) => <th key={c.id || "all"} className="px-3 py-2">{c.name}</th>)}</tr></thead>
        <tbody>{plans.map((p) => <tr key={p.id} className="border-t" data-testid={`ppm-row-${p.code}`}><td className="px-3 py-2"><p className="font-semibold text-navy">{p.name}</p><p className="text-xs text-slate-500">{p.plan_type} · {p.installments.length} installments</p></td>
          {cols.map((c) => { const a = find(p.id, c.id); return <td key={c.id || "all"} className="px-3 py-2"><label className="flex items-center gap-2"><input type="checkbox" checked={!!a} disabled={!canEdit} onChange={() => toggle(p, c.id)} data-testid={`ppm-${p.code}-${c.id || "all"}`} />{a && <input type="radio" name={`def-${c.id || "all"}`} checked={!!a.is_default} disabled={!canEdit} onChange={() => setDefault(p, c.id)} title="Default" data-testid={`ppm-default-${p.code}-${c.id || "all"}`} />}{a?.is_default && <span className="text-[10px] font-bold text-gold">default</span>}</label></td>; })}
        </tr>)}</tbody></table>
      {plans.length === 0 && <p className="text-sm text-slate-400">No payment plans yet — create them under Master Data → Payment Plans.</p>}
    </div>
  );
}

export function StageSequenceEditor({ entityType, entityId, sequence, onSaved }) {
  const { can } = useAuth();
  const [stages, setStages] = useState([]);
  const [seq, setSeq] = useState(sequence || []);
  useEffect(() => { api.get("/master/construction-stages?page_size=100").then((r) => setStages(r.data.items)).catch(() => {}); }, []);
  useEffect(() => { setSeq(sequence || []); }, [sequence]);
  const ids = seq.map((x) => x.stage_id);
  const toggle = (id) => setSeq(ids.includes(id) ? seq.filter((x) => x.stage_id !== id) : [...seq, { stage_id: id, seq: seq.length + 1 }]);
  const move = (i, d) => { const s = [...seq]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; setSeq(s.map((x, k) => ({ ...x, seq: k + 1 }))); };
  const save = async () => { try { await api.patch(`/${entityType}/${entityId}/stage-sequence`, { construction_stage_sequence: seq.map((x, k) => ({ stage_id: x.stage_id, seq: k + 1 })) }); toast.success("Stage sequence saved"); onSaved?.(); } catch (e) { toast.error(errMsg(e)); } };
  const name = (id) => stages.find((s) => s.id === id)?.name || id;
  return (
    <div className="card-elev p-5" data-testid="stage-sequence-editor">
      <p className="mb-3 text-sm text-slate-600">{seq.length ? `${seq.length} stages in sequence` : "Using the master's default order"} — pick the stages that apply, then order them.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="label-xs mb-2">Available stages</p><div className="flex flex-wrap gap-2">{stages.map((s) => <button key={s.id} type="button" onClick={() => can("project.write") && toggle(s.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${ids.includes(s.id) ? "border-navy bg-navy text-white" : "bg-white text-slate-600"}`} data-testid={`seq-stage-${s.code}`}>{s.name}</button>)}</div></div>
        <div><p className="label-xs mb-2">Order</p><ol className="space-y-1">{seq.map((x, i) => <li key={x.stage_id} className="flex items-center gap-2 rounded border bg-white px-2 py-1 text-sm"><span className="w-5 font-bold text-navy">{i + 1}</span><span className="flex-1">{name(x.stage_id)}</span>{can("project.write") && <><button type="button" onClick={() => move(i, -1)} className="px-1 text-slate-400">↑</button><button type="button" onClick={() => move(i, 1)} className="px-1 text-slate-400">↓</button></>}</li>)}</ol></div>
      </div>
      {can("project.write") && <Button className="mt-4 bg-navy hover:bg-navy-700" onClick={save} data-testid="seq-save">Save sequence</Button>}
    </div>
  );
}

export function ProjectStageList({ sequence }) {
  const [stages, setStages] = useState([]);
  useEffect(() => { api.get("/master/construction-stages?page_size=100").then((r) => setStages(r.data.items)).catch(() => {}); }, []);
  if (!sequence?.length) return <p className="text-sm text-slate-500" data-testid="project-stages-empty">No stage sequence yet — set it under the Construction tab.</p>;
  return <ol className="space-y-2 text-sm" data-testid="project-stage-list">{sequence.map((x) => { const st = stages.find((s) => s.id === x.stage_id); return <li key={x.stage_id} className="flex items-center justify-between border-b border-slate-100 pb-1.5"><span>{x.seq}. {st?.name || "…"}</span>{st?.is_possession && <span className="text-[10px] font-bold uppercase text-gold">Possession</span>}</li>; })}</ol>;
}
