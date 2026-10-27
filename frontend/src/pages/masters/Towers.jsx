/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { useProjectTowers } from "./useProjectTowers";

const sel = "h-10 w-full rounded-md border px-3 text-sm";

export default function Towers() {
  const { can } = useAuth();
  const { projects } = useProjectTowers();
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get(`/blocks?page_size=200${projectId ? `&project_id=${projectId}` : ""}`).then((r) => setItems(r.data.items)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line
  return (
    <div className="space-y-4" data-testid="towers-master-page">
      <div className="flex flex-wrap items-center gap-3">
        <div><h1 className="font-display text-xl text-ink-950">Towers</h1><p className="text-xs text-txt-secondary">Every tower across projects. Flats are generated from the floor template; stage plan and payment plans attach per tower.</p></div>
        <select className="ml-auto h-9 rounded-md border px-3 text-sm" value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="towers-project-filter"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {can("masters.tower.create") && <Button className="bg-ink-950 hover:bg-ink-800" onClick={() => setEditing({})} data-testid="tower-new-btn"><Plus className="mr-1 h-4 w-4" />New tower</Button>}
      </div>
      {editing && <TowerForm tower={editing} projects={projects} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <div className="card overflow-x-auto !p-0" data-testid="towers-list">
        <table className="w-full text-sm"><thead className="bg-warm-50/60 text-left text-[11px] font-semibold uppercase text-txt-secondary"><tr><th className="px-4 py-2">Tower</th><th className="px-4 py-2">Project</th><th className="px-4 py-2">Type</th><th className="px-4 py-2 text-right">Floors</th><th className="px-4 py-2 text-right">Flats</th><th className="px-4 py-2 text-right">Built %</th><th className="px-4 py-2 text-right">Cash %</th><th className="px-4 py-2" /></tr></thead>
          <tbody>{items.map((t) => <tr key={t.id} className="border-t" data-testid={`tower-row-${t.code}`}><td className="px-4 py-2 font-semibold text-ink-950">{t.name} <span className="text-xs font-normal text-txt-secondary">{t.code}</span></td><td className="px-4 py-2">{t.project_name || projects.find((p) => p.id === t.project_id)?.name}</td><td className="px-4 py-2">{t.block_type_name}</td><td className="px-4 py-2 text-right">{t.floors}</td><td className="px-4 py-2 text-right" data-testid={`tower-flats-${t.code}`}>{t.unit_counts?.total ?? t.flats_count ?? "—"}</td><td className="px-4 py-2 text-right">{t.construction_percent ?? 0}%</td><td className="px-4 py-2 text-right">{t.default_cash_percent ?? "—"}</td>
            <td className="px-4 py-2"><div className="flex justify-end gap-1"><HistoryButton entityType="block" entityId={t.id} /><Link to={`/masters/flats?tower=${t.id}`} className="rounded-md border px-2 py-1 text-xs" data-testid={`tower-flats-${t.code}`}>Flats</Link><Link to={`/construction?project=${t.project_id}&tower=${t.id}`} className="rounded-md border px-2 py-1 text-xs">Construction</Link>{can("masters.tower.edit") && <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => setEditing(t)} data-testid={`tower-edit-${t.code}`}>Edit</button>}</div></td></tr>)}
            {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-txt-secondary">No towers.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}

function TowerForm({ tower, projects, onClose, onSaved }) {
  const isNew = !tower.id;
  const [f, setF] = useState({ project_id: tower.project_id || "", name: tower.name || "", code: tower.code || "", block_type_id: tower.block_type_id || "", floors: tower.floors || 4, flats_per_floor: tower.flats_per_floor || 4, floor_start: tower.floor_start ?? 1, numbering_pattern: tower.numbering_pattern || "{block}-{floor}{pos2}", rate_per_sqft: tower.rate_per_sqft ?? "", default_cash_percent: tower.default_cash_percent ?? "", stage_plan_id: "" });
  const [types, setTypes] = useState([]);
  const [flatTypes, setFlatTypes] = useState([]);
  const [stagePlans, setStagePlans] = useState([]);
  const [positions, setPositions] = useState([]);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { api.get("/master/block-types?page_size=50").then((r) => setTypes(r.data.items)); api.get("/master/flat-types?page_size=100").then((r) => setFlatTypes(r.data.items)); }, []);
  useEffect(() => { if (f.project_id) api.get(`/stage-plans?project_id=${f.project_id}`).then((r) => setStagePlans(r.data.items.filter((p) => p.is_active))); }, [f.project_id]);
  useEffect(() => { setPositions((p) => Array.from({ length: Number(f.flats_per_floor) || 0 }, (_, i) => (p[i]?.flat_type_id ? p[i] : { position: i + 1, flat_type_id: flatTypes[0]?.id || "" }))); }, [f.flats_per_floor, flatTypes]);
  const missing = [["project_id", "Project"], ["name", "Name"], ["code", "Code"], ["block_type_id", "Block type"]].filter(([k]) => !String(f[k]).trim());
  const save = async () => {
    setErr(null);
    try {
      if (isNew) {
        const body = { project_id: f.project_id, block_type_id: f.block_type_id, name: f.name.trim(), code: f.code.trim().toUpperCase(), floors: Number(f.floors), flats_per_floor: Number(f.flats_per_floor), floor_start: Number(f.floor_start), numbering_pattern: f.numbering_pattern, position_flat_types: positions.filter((p) => p.flat_type_id), ...(f.rate_per_sqft !== "" ? { rate_per_sqft: Number(f.rate_per_sqft) } : {}), ...(f.default_cash_percent !== "" ? { default_cash_percent: Number(f.default_cash_percent) } : {}) };
        const r = await api.post("/blocks", body);
        if (f.stage_plan_id) await api.post(`/stage-plans/${f.stage_plan_id}/copy`, { block_ids: [r.data.id] });
        toast.success(`Tower ${r.data.name} created — ${r.data.flats_count ?? r.data.total_flats ?? ""} flats generated`);
      } else {
        await api.patch(`/blocks/${tower.id}`, { name: f.name.trim(), block_type_id: f.block_type_id, ...(f.rate_per_sqft !== "" ? { rate_per_sqft: Number(f.rate_per_sqft) } : {}), ...(f.default_cash_percent !== "" ? { default_cash_percent: Number(f.default_cash_percent) } : {}) });
        toast.success("Tower updated");
      }
      onSaved();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="card space-y-4 !p-5" data-testid="tower-form">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block text-sm"><span className="label-xs">Project *</span><select className={sel} value={f.project_id} onChange={(e) => set("project_id", e.target.value)} disabled={!isNew} data-testid="tower-project"><option value="">Select project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block text-sm"><span className="label-xs">Name *</span><Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="tower-name" /></label>
        <label className="block text-sm"><span className="label-xs">Code *</span><Input value={f.code} onChange={(e) => set("code", e.target.value)} disabled={!isNew} maxLength={10} data-testid="tower-code" /></label>
        <label className="block text-sm"><span className="label-xs">Block type *</span><select className={sel} value={f.block_type_id} onChange={(e) => set("block_type_id", e.target.value)} data-testid="tower-block-type"><option value="">Select…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {isNew && <>
          <label className="block text-sm"><span className="label-xs">Floors</span><Input type="number" min="1" value={f.floors} onChange={(e) => set("floors", e.target.value)} data-testid="tower-floors" /></label>
          <label className="block text-sm"><span className="label-xs">Flats per floor</span><Input type="number" min="1" max="50" value={f.flats_per_floor} onChange={(e) => set("flats_per_floor", e.target.value)} data-testid="tower-fpf" /></label>
          <label className="block text-sm"><span className="label-xs">First floor number</span><Input type="number" min="0" value={f.floor_start} onChange={(e) => set("floor_start", e.target.value)} data-testid="tower-floor-start" /></label>
          <label className="block text-sm"><span className="label-xs">Numbering pattern</span><select className={sel} value={f.numbering_pattern} onChange={(e) => set("numbering_pattern", e.target.value)} data-testid="tower-pattern">{["{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}"].map((p) => <option key={p}>{p}</option>)}</select></label>
        </>}
        <label className="block text-sm"><span className="label-xs">Rate / sq ft</span><Input type="number" min="0" value={f.rate_per_sqft} onChange={(e) => set("rate_per_sqft", e.target.value)} data-testid="tower-rate" /></label>
        <label className="block text-sm"><span className="label-xs">Default cash % override</span><Input type="number" min="0" max="100" value={f.default_cash_percent} onChange={(e) => set("default_cash_percent", e.target.value)} data-testid="tower-cash-pct" /></label>
        {isNew && <label className="block text-sm md:col-span-2"><span className="label-xs">Stage plan (optional — copied to this tower)</span><select className={sel} value={f.stage_plan_id} onChange={(e) => set("stage_plan_id", e.target.value)} disabled={!f.project_id} data-testid="tower-stage-plan"><option value="">None — assign later in Masters → Stage Plans</option>{stagePlans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.block_name})</option>)}</select></label>}
      </div>
      {isNew && <div data-testid="tower-positions"><p className="label-xs mb-1">Flat type per position (template for every floor)</p><div className="flex flex-wrap gap-2">{positions.map((p, i) => <label key={i} className="text-xs"><span className="mr-1 font-semibold">#{p.position}</span><select className="h-9 rounded-md border px-2 text-xs" value={p.flat_type_id} onChange={(e) => setPositions((a) => a.map((x, j) => j === i ? { ...x, flat_type_id: e.target.value } : x))} data-testid={`tower-pos-${p.position}`}>{flatTypes.map((ft) => <option key={ft.id} value={ft.id}>{ft.name}</option>)}</select></label>)}</div></div>}
      {missing.length > 0 && <p className="text-[11px] font-semibold text-brick" data-testid="tower-required">{missing.map(([, l]) => l).join(", ")} required</p>}
      {err && <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="tower-error">{err}</p>}
      <div className="flex gap-2"><Button className="bg-ink-950 hover:bg-ink-800" disabled={missing.length > 0} onClick={save} data-testid="tower-save">{isNew ? "Create tower & generate flats" : "Save"}</Button><Button variant="outline" onClick={onClose} data-testid="tower-cancel">Cancel</Button></div>
    </div>
  );
}
