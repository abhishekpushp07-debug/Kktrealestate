import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { WhereUsedButton } from "./WhereUsed";
import { useProjectTowers } from "./useProjectTowers";

export default function PaymentPlans() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const load = () => api.get("/payment-plans/structured").then((r) => setItems(r.data.items)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  const shown = items.filter((p) => !q || `${p.name} ${p.description || ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4" data-testid="payment-plans-page">
      <div className="flex flex-wrap items-center gap-3">
        <div><h1 className="font-display text-xl text-ink-950">Payment Plans (project & tower wise)</h1><p className="text-xs text-txt-secondary">Name → Project → Tower → Stage Plan → % per stage (must total 100%). Appears in the booking wizard for that tower only.</p></div>
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto h-9 w-56" data-testid="payment-plans-search" />
        {can("masters.payment_plan.create") && <Button className="bg-ink-950 hover:bg-ink-800" onClick={() => setCreating(true)} data-testid="payment-plan-new-btn"><Plus className="mr-1 h-4 w-4" />New payment plan</Button>}
      </div>
      {creating && <PaymentPlanForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      <div className="grid gap-3 md:grid-cols-2" data-testid="payment-plans-list">
        {shown.map((p) => <div key={p.id} className="card !p-4" data-testid={`payment-plan-${p.id}`}>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="font-semibold text-ink-950">{p.name}</p><p className="text-xs text-txt-secondary">{p.description}{p.block_id ? "" : " · all towers (legacy template)"}</p></div><HistoryButton entityType="payment_plan" entityId={p.id} /><WhereUsedButton path={`/payment-plans/${p.id}/where-used`} testId={`payment-plan-where-used-${p.id}`} /></div>
          <div className="mt-2 flex flex-wrap gap-1">{p.installments.map((i) => <span key={i.seq} className="rounded-full bg-warm-50 px-2 py-0.5 text-[11px] text-ink-950">{i.name} <b>{i.percent}%</b></span>)}</div>
        </div>)}
        {shown.length === 0 && <p className="text-sm text-txt-secondary">No payment plans yet.</p>}
      </div>
    </div>
  );
}

function PaymentPlanForm({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const { projects, towers, projectId, setProjectId, blockId, setBlockId } = useProjectTowers();
  const [stagePlans, setStagePlans] = useState([]);
  const [spId, setSpId] = useState("");
  const [rows, setRows] = useState([]);
  const [adv, setAdv] = useState(false);
  const [advanced, setAdvanced] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => { if (!blockId) { setStagePlans([]); setSpId(""); return; } api.get(`/stage-plans?block_id=${blockId}`).then((r) => { const act = r.data.items.filter((p) => p.is_active); setStagePlans(act); setSpId(act[0]?.id || ""); }); }, [blockId]);
  const sp = stagePlans.find((p) => p.id === spId);
  useEffect(() => { setRows(sp ? sp.stages.map((s) => ({ stage_id: s.stage_id, percent: "" })) : []); }, [sp]);
  const stageName = useMemo(() => Object.fromEntries((sp?.stages || []).map((s) => [s.stage_id, s.name])), [sp]);
  const total = Math.round((rows.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0) + advanced.reduce((s, a) => s + (parseFloat(a.percent) || 0), 0)) * 100) / 100;
  const dupes = rows.map((r) => r.stage_id).filter((id, i, a) => a.indexOf(id) !== i);
  const unused = (sp?.stages || []).filter((s) => !rows.some((r) => r.stage_id === s.stage_id));
  const valid = name.trim().length >= 2 && projectId && blockId && spId && rows.length > 0 && total === 100 && dupes.length === 0;
  const save = async () => {
    setErr(null);
    try { const r = await api.post("/payment-plans/structured", { name: name.trim(), project_id: projectId, block_id: blockId, stage_plan_id: spId, rows: rows.map((x) => ({ stage_id: x.stage_id, percent: parseFloat(x.percent) || 0 })), advanced: advanced.map((a) => ({ ...a, percent: parseFloat(a.percent) || 0, trigger_days: a.trigger_days ? Number(a.trigger_days) : null })) }); toast.success(`Payment plan "${r.data.name}" saved — available in the booking wizard for this tower`); onSaved(); }
    catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="card space-y-4 !p-5" data-testid="payment-plan-form">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block text-sm"><span className="label-xs">Plan name *</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Construction Linked Plan - 10x10" data-testid="pp-name" /></label>
        <label className="block text-sm"><span className="label-xs">Project *</span><select className="h-10 w-full rounded-md border px-3 text-sm" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }} data-testid="pp-project"><option value="">Select project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block text-sm"><span className="label-xs">Tower *</span><select className="h-10 w-full rounded-md border px-3 text-sm" value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId} data-testid="pp-tower"><option value="">Select tower…</option>{towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="block text-sm"><span className="label-xs">Construction Stage Plan *</span><select className="h-10 w-full rounded-md border px-3 text-sm" value={spId} onChange={(e) => setSpId(e.target.value)} disabled={!blockId} data-testid="pp-stage-plan"><option value="">{blockId && !stagePlans.length ? "No stage plan for this tower — create one first" : "Select…"}</option>{stagePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      {sp && <div data-testid="pp-rows">
        <div className="mb-2 flex items-center gap-3"><p className="label-xs">Rows from stage plan “{sp.name}”</p><span className={cn("ml-auto rounded-full px-3 py-1 text-xs font-bold", total === 100 ? "bg-emerald-100 text-emerald-800" : "bg-brick-50 text-brick")} data-testid="pp-total-badge">Total {total.toFixed(2)}%{total !== 100 && " — must be exactly 100.00%"}</span></div>
        <table className="w-full text-sm"><thead className="text-left text-[11px] uppercase text-txt-secondary"><tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Stage</th><th className="px-2 py-1 w-40">%</th><th className="w-10" /></tr></thead>
          <tbody>{rows.map((r, i) => { const dup = dupes.includes(r.stage_id); return <tr key={i} className={cn("border-t", dup && "bg-brick-50/40")} data-testid={`pp-row-${i + 1}`}>
            <td className="px-2 py-1 text-xs text-txt-secondary">{i + 1}</td>
            <td className="px-2 py-1"><select className="h-9 w-full rounded-md border px-2 text-sm" value={r.stage_id} onChange={(e) => setRows((a) => a.map((x, j) => j === i ? { ...x, stage_id: e.target.value } : x))} data-testid={`pp-row-stage-${i + 1}`}>{sp.stages.map((s) => <option key={s.stage_id} value={s.stage_id}>{s.name}</option>)}</select>{dup && <p className="text-[11px] font-semibold text-brick" data-testid={`pp-row-dup-${i + 1}`}>This stage appears twice</p>}</td>
            <td className="px-2 py-1"><Input type="number" step="0.01" min="0" max="100" value={r.percent} onChange={(e) => setRows((a) => a.map((x, j) => j === i ? { ...x, percent: e.target.value } : x))} className="h-9 text-right" data-testid={`pp-row-pct-${i + 1}`} /></td>
            <td><button type="button" onClick={() => setRows((a) => a.filter((_, j) => j !== i))} className="rounded p-1 text-brick hover:bg-warm-50" data-testid={`pp-row-remove-${i + 1}`}><Trash2 className="h-4 w-4" /></button></td>
          </tr>; })}</tbody></table>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRows((a) => [...a, { stage_id: (unused[0] || sp.stages[0]).stage_id, percent: "" }])} data-testid="pp-add-row"><Plus className="mr-1 h-3.5 w-3.5" />Add stage row</Button>
          <button type="button" className="flex items-center gap-1 text-xs text-txt-secondary" onClick={() => setAdv((o) => !o)} data-testid="pp-advanced-toggle"><ChevronDown className={cn("h-3.5 w-3.5 transition-transform", adv && "rotate-180")} />Advanced (days-after-booking / on-date installments)</button>
        </div>
        {adv && <div className="mt-2 space-y-2 rounded-md border p-3" data-testid="pp-advanced">{advanced.map((a, i) => <div key={i} className="grid gap-2 md:grid-cols-5"><Input placeholder="Name" value={a.name} onChange={(e) => setAdvanced((x) => x.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} /><select className="h-10 rounded-md border px-2 text-sm" value={a.trigger_type} onChange={(e) => setAdvanced((x) => x.map((y, j) => j === i ? { ...y, trigger_type: e.target.value } : y))}><option value="DAYS_AFTER_BOOKING">Days after booking</option><option value="ON_DATE">On date</option></select>{a.trigger_type === "ON_DATE" ? <Input type="date" value={a.trigger_date || ""} onChange={(e) => setAdvanced((x) => x.map((y, j) => j === i ? { ...y, trigger_date: e.target.value } : y))} /> : <Input type="number" placeholder="Days" value={a.trigger_days || ""} onChange={(e) => setAdvanced((x) => x.map((y, j) => j === i ? { ...y, trigger_days: e.target.value } : y))} />}<Input type="number" step="0.01" placeholder="%" value={a.percent} onChange={(e) => setAdvanced((x) => x.map((y, j) => j === i ? { ...y, percent: e.target.value } : y))} /><Button size="sm" variant="outline" onClick={() => setAdvanced((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>)}<Button size="sm" variant="outline" onClick={() => setAdvanced((x) => [...x, { name: "", trigger_type: "DAYS_AFTER_BOOKING", trigger_days: "", percent: "" }])} data-testid="pp-advanced-add">Add advanced row</Button></div>}
      </div>}
      {err && <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="pp-error">{err}</p>}
      <div className="flex gap-2"><Button className="bg-ink-950 hover:bg-ink-800" disabled={!valid} onClick={save} data-testid="pp-save">Save payment plan</Button><Button variant="outline" onClick={onClose} data-testid="pp-cancel">Cancel</Button></div>
    </div>
  );
}
